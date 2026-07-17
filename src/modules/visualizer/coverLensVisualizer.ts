/**
 * 封面透镜可视化器
 *
 * 将专辑封面渲染为 3D 空间中的圆角矩形，鼠标驱动的圆形"透镜"会柔化和
 * 拉扯矩形边界产生水滴形变效果。音频能量驱动边框厚度、圆角和整体缩放。
 *
 * 特性:
 * - SDF (Signed Distance Field) 圆角矩形渲染，透镜区域边界扩展和水滴拉扯
 * - 鼠标透镜 + 自动旋转边缘透镜 (变速, 角落处加速) 通过 max() 共存
 * - 音频映射: 低频→边框脉冲+SDF拉扯, 中低频→圆角微变, 高频→色散, RMS→发光
 * - 拖拽旋转 / 滚轮缩放 / 触摸手势交互
 * - 封面加载预分配 Canvas + 预分配 scratch 对象避免每帧 GC
 * - dispose 时 gsap.killTweensOf 防止内存泄漏
 */

import * as THREE from 'three'
import gsap from 'gsap'
import type { AudioSpectrumData } from './audioAnalyzer'
import { AudioAnimationController } from './audioAnimationLayer'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SCALE = 0.5
const MAX_SCALE = 2.0
const DEFAULT_SCALE = 1.0
const ROTATION_SENSITIVITY = 0.005
const ZOOM_SENSITIVITY = 0.0015
const MAX_PITCH = 1.2

// Maximum world-space size of the visible rounded-rectangle card.
const MAX_RECT_SIZE = 2.8

// The lens mesh must be larger than the visible card so the water-drop
// boundary glow can extend outward without being clipped by the geometry.
// In the reference project the SDF is computed on a fullscreen quad; here we
// approximate that with a large plane that covers the viewport at z=6.
const PLANE_SIZE = 16.0

// Texture long edge — same rationale as CoverTileGridVisualizer: decouple
// texture resolution from source, keep VRAM low, and let mipmaps do final AA.
const TEX_LONG_EDGE = 1152

// Base SDF parameters. These map directly to the reference project values
// used in `3d_Design/专辑扰动/shaders/fragment.glsl`:
//   size = 1.2, roundness = 0.4, borderSize = 0.05
// The reference multiplies the SDF coordinate by 4.2, so we scale the
// roundness and border by the same factor to keep the same visual proportions
// in our normalized [0,1] UV space.
const REF_SCALE = 4.2
const BASE_ROUNDNESS = 0.4 / REF_SCALE        // ~0.095
const BASE_BORDER_SIZE = 0.05 / REF_SCALE     // ~0.012, thinner frame

// Mouse-lens parameters matching the reference project.
// (3d_Design/专辑扰动/shaders/fragment.glsl: circleSize=0.3, circleEdge=0.5)
const CIRCLE_SIZE = 0.3
const CIRCLE_EDGE = 0.5

// Extra SDF pull: pushes the boundary outward directly under the mouse lens.
// A larger value creates the long, beam-like water-drop tail seen in the
// reference image.
const LENS_PULL = 0.12

// Fallback gradient colors when no cover is available
const FALLBACK_COLORS = [
  new THREE.Color(0x2a2a2a),
  new THREE.Color(0x3a3a3a),
  new THREE.Color(0x1a1a2a),
  new THREE.Color(0x0a0a1a),
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverLensTransform {
  rotationX: number
  rotationY: number
  scale: number
}

interface LensOptions {
  quality: 'high' | 'medium' | 'low'
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class CoverLensVisualizer {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private renderer: THREE.WebGLRenderer
  private options: LensOptions

  // Three.js objects
  private group: THREE.Group
  private mesh: THREE.Mesh | null = null
  private geometry: THREE.PlaneGeometry | null = null
  private material: THREE.ShaderMaterial | null = null
  private coverTexture: THREE.CanvasTexture | null = null
  private coverCanvas: HTMLCanvasElement | null = null
  private coverCtx: CanvasRenderingContext2D | null = null

  // State
  private isPlaying = false
  private disposed = false
  private loadToken = 0
  private coverUrl: string | null = null

  // Transform / interaction
  private currentTransform: CoverLensTransform
  private targetTransform: CoverLensTransform
  private isDragging = false
  private lastPointerX = 0
  private lastPointerY = 0
  private interactionContainer: HTMLElement | null = null
  private onTransformChange: ((t: CoverLensTransform) => void) | null = null

  // Mouse lens state (in UV space 0-1)
  private targetMouseUv = new THREE.Vector2(0.5, 0.5)
  private currentMouseUv = new THREE.Vector2(0.5, 0.5)

  // Pre-allocated scratch objects for updateMouseUv (avoids per-frame GC)
  private _raycaster = new THREE.Raycaster()
  private _ndc = new THREE.Vector2()
  private _planeNormal = new THREE.Vector3()
  private _planePoint = new THREE.Vector3()
  private _plane = new THREE.Plane()
  private _hitPoint = new THREE.Vector3()
  private _worldQuat = new THREE.Quaternion()
  private _meshSize = new THREE.Vector2()

  // Auto-rotating virtual mouse that traces the card edge clockwise.
  // Provides a continuous lens-deformation animation even when the user
  // is not interacting. Coexists with the real mouse via max() in the
  // shader — neither effect blocks the other.
  private autoMouseUv = new THREE.Vector2(0.5, 0.5)
  // Phase accumulator for the auto-mouse angle. Using a phase instead of
  // raw u_time allows variable-speed rotation (speeding up at corners).
  private autoMousePhase = 0

  /** 简化动效控制器 */
  private animController: AudioAnimationController

  // Bound event handlers
  private boundPointerDown = this.onPointerDown.bind(this)
  private boundPointerMove = this.onPointerMove.bind(this)
  private boundPointerUp = this.onPointerUp.bind(this)
  private boundWheel = this.onWheel.bind(this)
  private boundTouchStart = this.onTouchStart.bind(this)
  private boundTouchMove = this.onTouchMove.bind(this)
  private boundTouchEnd = this.onTouchEnd.bind(this)

  // Touch state
  private touchStartDist = 0
  private touchStartScale = 1

  // Shader uniforms
  private uniforms: {
    u_cover: { value: THREE.Texture | null }
    u_mouse: { value: THREE.Vector2 }
    u_autoMouse: { value: THREE.Vector2 }
    u_time: { value: number }
    u_bass: { value: number }
    u_mid: { value: number }
    u_volume: { value: number }
    u_aspect: { value: number }
    u_rectScale: { value: number }
    u_borderColor: { value: THREE.Color }
    u_pixelRatio: { value: number }
    u_resolution: { value: THREE.Vector2 }
    u_globalAlpha: { value: number }
    u_treble: { value: number }
  }

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options: LensOptions
  ) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.options = options

    this.currentTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
    this.targetTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }

    this.uniforms = {
      u_cover: { value: null },
      u_mouse: { value: this.currentMouseUv },
      u_autoMouse: { value: this.autoMouseUv },
      u_time: { value: 0 },
      u_bass: { value: 0 },
      u_mid: { value: 0 },
      u_volume: { value: 0 },
      u_aspect: { value: 1 },
      u_rectScale: { value: MAX_RECT_SIZE / PLANE_SIZE },
      u_borderColor: { value: new THREE.Color(0xffffff) },
      u_pixelRatio: { value: renderer.getPixelRatio() },
      u_resolution: { value: new THREE.Vector2(renderer.domElement.width, renderer.domElement.height) },
      u_globalAlpha: { value: 1 },
      u_treble: { value: 0 },
    }

    this.group = new THREE.Group()
    this.group.name = 'coverLensGroup'
    this.group.position.z = 6
    this.scene.add(this.group)

    this.animController = new AudioAnimationController()

    // Start with a fallback gradient rectangle until a cover loads.
    this.buildFallbackMesh()
  }

  // ---------------------------------------------------------------------------
  // Cover loading
  // ---------------------------------------------------------------------------

  async loadCover(url: string): Promise<boolean> {
    if (!url) {
      if (this.coverUrl === null) return true
      this.coverUrl = null
      this.buildFallbackMesh()
      return true
    }

    // Skip redundant loads when the same album cover is already active.
    if (url === this.coverUrl) return true

    this.coverUrl = url
    const myToken = ++this.loadToken

    try {
      const image = await this.loadImage(url)
      if (myToken !== this.loadToken) return false

      const prepared = this.prepareCoverCanvas(image)
      this.disposeCoverTexture()

      this.coverTexture = new THREE.CanvasTexture(prepared)
      this.coverTexture.flipY = false
      this.coverTexture.colorSpace = THREE.SRGBColorSpace
      this.coverTexture.minFilter = THREE.LinearMipmapLinearFilter
      this.coverTexture.magFilter = THREE.LinearFilter
      this.coverTexture.generateMipmaps = true
      this.coverTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
      this.coverTexture.needsUpdate = true

      this.buildMesh(prepared.width / prepared.height)
      return true
    } catch (e) {
      if (myToken !== this.loadToken) return false
      console.error('[CoverLens] Failed to load cover:', e)
      this.buildFallbackMesh()
      return false
    }
  }

private loadImage(url: string): Promise<HTMLImageElement> {
return new Promise((resolve, reject) => {
const img = new Image()
// Always set crossOrigin — beat:// is cross-origin; without it
// getImageData() throws SecurityError (tainted canvas).
img.crossOrigin = 'anonymous'
img.onload = () => resolve(img)
img.onerror = () => reject(new Error('Failed to load cover image'))
img.src = url
})
}

  private prepareCoverCanvas(source: HTMLImageElement): HTMLCanvasElement {
    if (!this.coverCanvas) {
      this.coverCanvas = document.createElement('canvas')
      this.coverCtx = this.coverCanvas.getContext('2d', { willReadFrequently: false })
    }
    const ctx = this.coverCtx
    if (!ctx) return this.coverCanvas!

    const sw = source.naturalWidth || source.width
    const sh = source.naturalHeight || source.height

    let tw: number
    let th: number
    if (sw >= sh) {
      tw = TEX_LONG_EDGE
      th = Math.max(1, Math.round((sh * TEX_LONG_EDGE) / sw))
    } else {
      th = TEX_LONG_EDGE
      tw = Math.max(1, Math.round((sw * TEX_LONG_EDGE) / sh))
    }

    if (this.coverCanvas.width !== tw || this.coverCanvas.height !== th) {
      this.coverCanvas.width = tw
      this.coverCanvas.height = th
    }

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, tw, th)
    ctx.drawImage(source, 0, 0, sw, sh, 0, 0, tw, th)

    return this.coverCanvas
  }

  private buildFallbackMesh(): void {
    this.disposeMeshObjects()

    // Create a small fallback texture with a horizontal gradient.
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const grd = ctx.createLinearGradient(0, 0, 256, 256)
      grd.addColorStop(0, `#${FALLBACK_COLORS[0].getHexString()}`)
      grd.addColorStop(0.33, `#${FALLBACK_COLORS[1].getHexString()}`)
      grd.addColorStop(0.66, `#${FALLBACK_COLORS[2].getHexString()}`)
      grd.addColorStop(1, `#${FALLBACK_COLORS[3].getHexString()}`)
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, 256, 256)
    }

    this.disposeCoverTexture()
    this.coverTexture = new THREE.CanvasTexture(canvas)
    this.coverTexture.colorSpace = THREE.SRGBColorSpace
    this.coverTexture.minFilter = THREE.LinearFilter
    this.coverTexture.magFilter = THREE.LinearFilter
    this.coverTexture.needsUpdate = true

    this.buildMesh(1, true)
  }

  private buildMesh(aspect: number, isFallback = false): void {
    this.disposeMeshObjects()

    // The mesh is a large square plane that covers the viewport so the
    // water-drop boundary glow can extend well outside the visible card.
    // The visible rounded-rectangle itself is defined by the SDF inside the
    // shader, not by the geometry edges.
    this.geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      depthWrite: false
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'coverLensMesh'
    this.group.add(this.mesh)

    this.uniforms.u_aspect.value = aspect
    this.uniforms.u_rectScale.value = MAX_RECT_SIZE / PLANE_SIZE
    this.uniforms.u_cover.value = this.coverTexture
    this.uniforms.u_borderColor.value.set(isFallback ? 0xaaccff : 0xffffff)

    // Intro animation for every cover switch (skipped automatically when the
    // same cover URL is loaded consecutively).
    this.mesh.scale.setScalar(0.01)
    this.uniforms.u_globalAlpha.value = 0
    gsap.to(this.mesh.scale, {
      x: 1,
      y: 1,
      z: 1,
      duration: 0.7,
      ease: 'expo.out',
    })
    gsap.to(this.uniforms.u_globalAlpha, {
      value: 1,
      duration: 0.55,
      ease: 'power2.out',
    })
  }

  private disposeMeshObjects(): void {
    if (this.mesh) {
      this.group.remove(this.mesh)
      this.mesh = null
    }
    if (this.geometry) {
      this.geometry.dispose()
      this.geometry = null
    }
    if (this.material) {
      this.material.dispose()
      this.material = null
    }
  }

  private disposeCoverTexture(): void {
    if (this.coverTexture) {
      this.coverTexture.dispose()
      this.coverTexture = null
      this.uniforms.u_cover.value = null
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  update(data: AudioSpectrumData): void {
    if (this.disposed) return

    const dt = Math.min(0.1, 1 / 60) // stable dt for damping

    // ── 简化动效控制器更新 ──
    this.animController.update(data, dt, this.camera)

    this.uniforms.u_time.value += dt
    // 传递 4 频段音频特征到着色器
    // 透镜无粒子, 选择不冲突的响应行为应用到整体:
    //   低频 → 边框厚度脉冲 + SDF 拉扯 (不与 Y 轴浮动/随机微动冲突)
    //   中低频 → 圆角微变 (替代 Y 轴浮动, 透镜是 2D 平面无 Y 轴上下文)
    //   中高频 → 不应用径向扩散 (与透镜的 SDF 边界冲突), 留空
    //   高频 → 颜色亮度 + 色散 (不与低频冲突)
    //   RMS → 整体发光强度
    //   burst → 边界脉冲增强
    this.uniforms.u_bass.value = this.animController.lowFreq + this.animController.burstIntensity * 0.5
    this.uniforms.u_mid.value = this.animController.midLowFreq
    this.uniforms.u_volume.value = this.animController.rms
    this.uniforms.u_treble.value = this.animController.highFreq

    // Damp user-driven transform.
    const k = 1 - Math.pow(0.001, dt)
    this.currentTransform.rotationX = lerp(this.currentTransform.rotationX, this.targetTransform.rotationX, k)
    this.currentTransform.rotationY = lerp(this.currentTransform.rotationY, this.targetTransform.rotationY, k)
    this.currentTransform.scale = lerp(this.currentTransform.scale, this.targetTransform.scale, k)

    this.group.rotation.x = this.currentTransform.rotationX
    this.group.rotation.y = this.currentTransform.rotationY

    // ── 应用简化动效缩放 ──
    this.group.scale.setScalar(this.currentTransform.scale * this.animController.blendedScale)

    // Damp mouse UV for the lens.
    this.currentMouseUv.x = THREE.MathUtils.damp(this.currentMouseUv.x, this.targetMouseUv.x, 8, dt)
    this.currentMouseUv.y = THREE.MathUtils.damp(this.currentMouseUv.y, this.targetMouseUv.y, 8, dt)

    // ── Auto-rotating edge lens (variable speed) ──
    // A virtual mouse traces a circle along the card edge clockwise,
    // creating a continuous lens-deformation animation. The shader
    // combines this with the real mouse via max(), so both effects
    // coexist: the user's hover is never blocked, and the auto
    // animation never stops.
    //
    // Variable speed: the mouse accelerates when approaching the four
    // rounded corners (at 45°, 135°, 225°, 315°), creating a lively
    // "linger-then-dash" rhythm. The boost is a Gaussian peaked at each
    // corner angle, added to the base angular speed.
    const AUTO_BASE_SPEED = 0.25 // rad/s — ~25s per revolution at constant speed
    // Distance from current phase to the nearest corner (π/4 + k*π/2).
    // Within each quadrant [0, π/2], the corner is at π/4.
    const phaseInQuad = this.autoMousePhase % (Math.PI / 2)
    const distToCorner = Math.abs(phaseInQuad - Math.PI / 4)
    // Gaussian boost: peaks (1.0) at corner, decays to ~0 at mid-edges.
    const cornerBoost = Math.exp(-(distToCorner * distToCorner) * 12.0) * 0.6
    this.autoMousePhase += (AUTO_BASE_SPEED + cornerBoost) * dt

    const autoAngle = this.autoMousePhase
    const autoRadius = 0.42
    const rectScale = this.uniforms.u_rectScale.value
    const aspect = this.uniforms.u_aspect.value || 1
    // SDF position → UV: u_mouse = (mouseP / aspect * rectScale + 0.5, mouseP * rectScale + 0.5)
    // Negative sin for clockwise rotation on screen (Y-up UV space).
    this.autoMouseUv.x = (Math.cos(autoAngle) * autoRadius / aspect) * rectScale + 0.5
    this.autoMouseUv.y = (-Math.sin(autoAngle) * autoRadius) * rectScale + 0.5

    // Notify subscribers (lyric parallax linkage).
    if (this.onTransformChange) {
      this.onTransformChange({ ...this.currentTransform })
    }
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing
  }

  // ---------------------------------------------------------------------------
  // Interaction (drag rotate + wheel zoom + mouse-move lens)
  // ---------------------------------------------------------------------------

  attachInteraction(container: HTMLElement, onChange?: (t: CoverLensTransform) => void): void {
    this.interactionContainer = container
    this.onTransformChange = onChange || null

    container.addEventListener('pointerdown', this.boundPointerDown)
    container.addEventListener('wheel', this.boundWheel, { passive: false })
    container.addEventListener('touchstart', this.boundTouchStart, { passive: true })

    document.addEventListener('pointermove', this.boundPointerMove)
    document.addEventListener('pointerup', this.boundPointerUp)
    document.addEventListener('pointercancel', this.boundPointerUp)
    document.addEventListener('touchmove', this.boundTouchMove, { passive: false })
    document.addEventListener('touchend', this.boundTouchEnd)
  }

  detachInteraction(): void {
    if (this.interactionContainer) {
      this.interactionContainer.removeEventListener('pointerdown', this.boundPointerDown)
      this.interactionContainer.removeEventListener('wheel', this.boundWheel)
      this.interactionContainer.removeEventListener('touchstart', this.boundTouchStart)
      this.interactionContainer = null
    }

    document.removeEventListener('pointermove', this.boundPointerMove)
    document.removeEventListener('pointerup', this.boundPointerUp)
    document.removeEventListener('pointercancel', this.boundPointerUp)
    document.removeEventListener('touchmove', this.boundTouchMove)
    document.removeEventListener('touchend', this.boundTouchEnd)

    this.onTransformChange = null
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.isOnInteractiveChild(e.target)) return
    this.isDragging = true
    this.lastPointerX = e.clientX
    this.lastPointerY = e.clientY
    this.updateMouseUv(e.clientX, e.clientY)
  }

  private onPointerMove(e: PointerEvent): void {
    // Always feed mouse position to the lens, even while dragging.
    this.updateMouseUv(e.clientX, e.clientY)

    if (!this.isDragging) return

    const dx = e.clientX - this.lastPointerX
    const dy = e.clientY - this.lastPointerY
    this.lastPointerX = e.clientX
    this.lastPointerY = e.clientY

    this.targetTransform.rotationY += dx * ROTATION_SENSITIVITY
    this.targetTransform.rotationX = clamp(
      this.targetTransform.rotationX + dy * ROTATION_SENSITIVITY,
      -MAX_PITCH,
      MAX_PITCH
    )
  }

  private onPointerUp(): void {
    this.isDragging = false
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    let delta = e.deltaY
    if (e.deltaMode === 1) delta *= 16
    else if (e.deltaMode === 2) delta *= 400

    const factor = 1 - delta * ZOOM_SENSITIVITY
    this.targetTransform.scale = clamp(
      this.targetTransform.scale * factor,
      MIN_SCALE,
      MAX_SCALE
    )
  }

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      this.touchStartDist = Math.hypot(dx, dy)
      this.touchStartScale = this.targetTransform.scale
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1 && this.isDragging) {
      e.preventDefault()
      const dx = e.touches[0].clientX - this.lastPointerX
      const dy = e.touches[0].clientY - this.lastPointerY
      this.lastPointerX = e.touches[0].clientX
      this.lastPointerY = e.touches[0].clientY

      this.targetTransform.rotationY += dx * ROTATION_SENSITIVITY
      this.targetTransform.rotationX = clamp(
        this.targetTransform.rotationX + dy * ROTATION_SENSITIVITY,
        -MAX_PITCH,
        MAX_PITCH
      )
    } else if (e.touches.length === 2) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy) || 1
      const factor = dist / this.touchStartDist
      this.targetTransform.scale = clamp(
        this.touchStartScale * factor,
        MIN_SCALE,
        MAX_SCALE
      )
    }

    if (e.touches.length > 0) {
      this.updateMouseUv(e.touches[0].clientX, e.touches[0].clientY)
    }
  }

  private onTouchEnd(): void {
    this.isDragging = false
  }

  /**
   * Convert screen pointer position to UV space on the lens rectangle.
   * Uses a ray-plane intersection against the mesh's current world plane so
   * dragging/rotating the rectangle does not break the lens mapping.
   */
  private updateMouseUv(clientX: number, clientY: number): void {
    if (!this.mesh || !this.renderer) return

    const rect = this.renderer.domElement.getBoundingClientRect()
    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1

    // Ensure world matrix is current before building the intersection plane.
    this.mesh.updateMatrixWorld()

    this._raycaster.setFromCamera(this._ndc, this.camera)

    // Plane defined by the mesh's current world orientation.
    this._planeNormal.set(0, 0, 1).applyQuaternion(this.mesh.getWorldQuaternion(this._worldQuat))
    this._planePoint.setFromMatrixPosition(this.mesh.matrixWorld)
    this._plane.setFromNormalAndCoplanarPoint(this._planeNormal, this._planePoint)

    if (!this._raycaster.ray.intersectPlane(this._plane, this._hitPoint)) {
      // Off-screen or behind camera: keep previous target.
      return
    }

    // Convert world hit point to local UV space.
    this.mesh.worldToLocal(this._hitPoint)
    const size = this.getMeshLocalSize()
    this.targetMouseUv.x = clamp(this._hitPoint.x / size.x + 0.5, 0, 1)
    this.targetMouseUv.y = clamp(this._hitPoint.y / size.y + 0.5, 0, 1)
  }

  private getMeshLocalSize(): THREE.Vector2 {
    if (!this.geometry) return this._meshSize.set(1, 1)
    // PlaneGeometry parameters are stored on the geometry.
    const params = this.geometry.parameters
    return this._meshSize.set(params.width, params.height)
  }

  private isOnInteractiveChild(target: EventTarget | null): boolean {
    let el = target as HTMLElement | null
    while (el && el !== this.interactionContainer) {
      if (el.dataset && el.dataset.noRotate !== undefined) return true
      if (el.classList && (
        el.classList.contains('preset-floater') ||
        el.classList.contains('stage-header') ||
        el.classList.contains('cover-thumb')
      )) return true
      el = el.parentElement
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getTransform(): CoverLensTransform {
    return { ...this.currentTransform }
  }

  resetTransform(): void {
    this.targetTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
  }

  resize(): void {
    if (this.renderer) {
      this.uniforms.u_pixelRatio.value = this.renderer.getPixelRatio()
      this.uniforms.u_resolution.value.set(this.renderer.domElement.width, this.renderer.domElement.height)
    }
  }

  dispose(): void {
    this.disposed = true
    this.animController.dispose()
    this.detachInteraction()
    // Kill any running gsap tweens before disposing meshes to prevent
    // orphaned tween references from updating disposed/null objects.
    if (this.mesh) gsap.killTweensOf(this.mesh.scale)
    gsap.killTweensOf(this.uniforms.u_globalAlpha)
    this.disposeMeshObjects()
    this.disposeCoverTexture()
    if (this.coverCanvas) {
      this.coverCanvas.width = 1
      this.coverCanvas.height = 1
      this.coverCanvas = null
      this.coverCtx = null
    }
    if (this.group) {
      this.scene.remove(this.group)
    }
  }

  // ---------------------------------------------------------------------------
  // GLSL Shaders
  // ---------------------------------------------------------------------------

  private getVertexShader(): string {
    return /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
  }

  private getFragmentShader(): string {
    return /* glsl */ `
      varying vec2 vUv;

      uniform sampler2D u_cover;
      uniform vec2 u_mouse;
      uniform vec2 u_autoMouse;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_volume;
      uniform float u_treble;
      uniform float u_aspect;
      uniform float u_rectScale;
      uniform vec3 u_borderColor;
      uniform float u_pixelRatio;
      uniform float u_globalAlpha;

      /* Signed-distance round rectangle (standard Inigo Quilez formulation).
         Coordinates are in aspect-corrected [-0.5,0.5] space so roundness
         stays visually circular for any cover aspect ratio. */
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 d = abs(p) - b + vec2(r);
        return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
      }

      float sdCircle(vec2 p, vec2 center) {
        return length(p - center) * 2.0;
      }

      float fill(float x, float size, float edge) {
        return 1.0 - smoothstep(size - edge, size + edge, x);
      }

      float stroke(float x, float size, float w, float edge) {
        float d = smoothstep(size - edge, size + edge, x + w * 0.5)
                - smoothstep(size - edge, size + edge, x - w * 0.5);
        return clamp(d, 0.0, 1.0);
      }

      void main() {
        // The mesh UV covers a large square plane. First shrink the coordinate
        // to the visible-card region, then aspect-correct it. This lets the
        // SDF boundary glow render outside the card without being clipped by
        // the mesh edges (mimicking the reference fullscreen-quad approach).
        vec2 p = (vUv - 0.5) / u_rectScale;
        p.x *= u_aspect;

        // Rectangle half-extents in this aspect-corrected space.
        vec2 b = vec2(0.5 * u_aspect, 0.5);

        // Parameters are converted from the reference project
        // (3d_Design/专辑扰动/shaders/fragment.glsl) by dividing by its 4.2
        // SDF scaling factor, giving identical visual proportions in our
        // normalized coordinate system.
        float roundness = ${BASE_ROUNDNESS.toFixed(3)} + u_mid * 0.03;
        float borderSize = ${BASE_BORDER_SIZE.toFixed(3)} + u_bass * 0.008;

        float circleSize = ${CIRCLE_SIZE.toFixed(3)};
        float circleEdge = ${CIRCLE_EDGE.toFixed(3)};

        // Real mouse position mapped into the same aspect-corrected SDF space.
        vec2 mouseP = (u_mouse - 0.5) / u_rectScale;
        mouseP.x *= u_aspect;

        // Auto-rotating virtual mouse (traces the card edge clockwise).
        vec2 autoMouseP = (u_autoMouse - 0.5) / u_rectScale;
        autoMouseP.x *= u_aspect;

        // Real mouse lens: filled circle around the cursor. In the reference this
        // value is fed directly into stroke() as the edge width; that is the
        // exact mechanism that widens/softens the boundary and creates the
        // water-drop bulge.
        float sdfCircleReal = fill(
          sdCircle(p, mouseP),
          circleSize,
          circleEdge
        );

        // Auto mouse lens: same circle effect, traces the edge continuously.
        float sdfCircleAuto = fill(
          sdCircle(p, autoMouseP),
          circleSize,
          circleEdge
        );

        // Combine via max so both effects coexist: the user's hover is never
        // blocked, and the auto animation never stops. Wherever both are
        // active, the stronger one naturally dominates.
        float sdfCircle = max(sdfCircleReal, sdfCircleAuto);

        // Base SDF of the rounded rectangle, then pull it outward under the
        // mouse lens for a more pronounced water-drop stretch.
        float sdf = sdRoundRect(p, b, roundness);
        sdf -= sdfCircle * ${LENS_PULL.toFixed(3)};
        // Bass-driven SDF pull: brief distortion impulse
        sdf -= u_bass * 0.012;

        // Boundary glow using the reference's exact recipe:
        //   stroke(sdf, 0.0, borderSize, sdfCircle) * 4.0
        // sdfCircle acts as the edge width, so near the cursor the boundary
        // becomes much wider and softer, producing the water-drop pull.
        // A tiny minimum edge width keeps the boundary feathered even when the
        // mouse is far away, eliminating the hard "frame" look.
        float boundary = stroke(sdf, 0.0, borderSize, max(sdfCircle, 0.008)) * (5.0 + u_bass * 3.5);

        // Cover is visible inside the rounded rectangle, but the edge is
        // feathered so the card blends into the background instead of showing
        // a hard cut. The feather width is also widened by the lens.
        float edgeFeather = 0.005 + sdfCircle * 0.05;
        float coverMask = 1.0 - smoothstep(-edgeFeather, edgeFeather, sdf);

        // Sample the cover only inside the visible rectangle region. The UV
        // is remapped from the large plane back to [0,1] of the cover texture.
        vec2 coverUv = (vUv - 0.5) / u_rectScale + 0.5;
        coverUv.y = 1.0 - coverUv.y;
        vec3 cover = texture2D(u_cover, coverUv).rgb;

        // Gaussian mist glow: a soft, semi-transparent light cone that follows
        // the pulled boundary and fades outward. This produces the volumetric,
        // beam-diffused look from the reference image rather than a crisp line.
        float mistSigma = 0.015 + sdfCircle * 0.10;
        float mist = exp(-sdf * sdf / (2.0 * mistSigma * mistSigma)) * (0.12 + sdfCircle * 0.50 + u_volume * 0.3);

        // Compose: cover inside, crisp boundary plus soft mist glow at the edge
        // and outside. The glow is dimmed so it reads as a translucent light
        // cone rather than an opaque white tail.
        vec3 glow = u_borderColor * (boundary + mist * 0.55);
        vec3 finalColor = cover * coverMask + glow;

        // Alpha allows the glow to live outside the rectangle shape while
        // keeping the background transparent where nothing is drawn.
        float alpha = min(1.0, coverMask + (boundary + mist * 0.6) * 0.95) * u_globalAlpha;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
