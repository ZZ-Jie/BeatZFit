/**
 * 封面粒子可视化器
 *
 * 超密有序网格采样 + 高斯平滑高度场 + 实心点精灵渲染。
 * 粒子从屏幕外随机方向飞入网格位置，形成"爆炸恢复"动态效果。
 *
 * 音频动效采用 4 频段方案 (参考 docs/粒子律动方案.md) :
 *   不分组 — 所有粒子统一响应:
 *   低频 → Z 轴脉冲 + burst 爆发 (视觉最强)
 *   中低频 → Y 轴正弦浮动
 *   高频 → 颜色亮度增益
 *   RMS → 整体透明度
 *   待机 → 轻微呼吸
 */

import * as THREE from 'three'
import type { AudioSpectrumData } from './audioAnalyzer'
import { AudioAnimationController } from './audioAnimationLayer'

export type CoverParticleQuality = 'low' | 'medium' | 'high'

export interface CoverParticleOptions {
  quality?: CoverParticleQuality
  onLoad?: () => void
  onError?: (err: Error) => void
}

export interface CoverParticleTransform {
  rotationX: number
  rotationY: number
  scale: number
}

// ═══════════════════════════════════════════════════════════
//  粒子密度：修改此处三个返回值即可调整各质量等级的网格密度
//  数值 = 每行/每列的粒子数，总粒子数 = value²
// ═══════════════════════════════════════════════════════════
function getGridSize(q: CoverParticleQuality): number {
  switch (q) {
    case 'low': return 150     // 22500 particles
    case 'medium': return 180  // 48400 particles
    case 'high': return 220    // 102400 particles
  }
}

// Subtle height field — enough for gentle 3D depth without distorting particle sizes
const HEIGHT_SCALE = 1.0
const PLANE_SIZE = 8.0
// Height-field Gaussian smoothing radius (7×7 equivalent kernel)
const HEIGHT_SMOOTH_RADIUS = 3
// ═══════════════════════════════════════════════════════════
//  粒子大小：修改此常量即可调整粒子直径占网格间距的比例
// ═══════════════════════════════════════════════════════════
const POINT_SIZE_FACTOR = 0.80

// ═══════════════════════════════════════════════════════════
//  缩小时的粒子放大上限
// ═══════════════════════════════════════════════════════════
const ZOOM_OUT_BOOST_MAX = 1.8

// ═══════════════════════════════════════════════════════════
//  粒子整体亮度系数
// ═══════════════════════════════════════════════════════════
const PARTICLE_BRIGHTNESS = 1.0

const MIN_SCALE = 0.5
const MAX_SCALE = 2.0
const DEFAULT_SCALE = 1.0

interface ParticleAttributes {
  positions: Float32Array
  targets: Float32Array
  colors: Float32Array
  sizes: Float32Array
  luminance: Float32Array
  random: Float32Array
}

export class CoverParticleVisualizer {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private renderer: THREE.WebGLRenderer
  private points: THREE.Points | null = null
  private group: THREE.Group | null = null
  private geometry: THREE.BufferGeometry | null = null
  private material: THREE.ShaderMaterial | null = null
  private clock = new THREE.Clock()
  private quality: CoverParticleQuality = 'high'
  private gridSize = 320
  private particleCount = 320 * 320
  private coverUrl: string | null = null
  private isLoading = false
  private morphProgress = 0
  private targetMorphProgress = 1
  private disposed = false
  private isPlaying = false

  private currentTransform: CoverParticleTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
  private targetTransform: CoverParticleTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
  private isDragging = false
  private lastPointerX = 0
  private lastPointerY = 0
  private interactionContainer: HTMLElement | null = null
  private onTransformChange: ((t: CoverParticleTransform) => void) | null = null

  private boundPointerDown = (e: PointerEvent) => this.onPointerDown(e)
  private boundPointerMove = (e: PointerEvent) => this.onPointerMove(e)
  private boundPointerUp = (e: PointerEvent) => this.onPointerUp(e)
  private boundWheel = (e: WheelEvent) => this.onWheel(e)
  private boundTouchStart = (e: TouchEvent) => this.onTouchStart(e)
  private boundTouchMove = (e: TouchEvent) => this.onTouchMove(e)
  private boundTouchEnd = (e: TouchEvent) => this.onTouchEnd(e)

  private uniforms: {
    uTime: { value: number }
    uProgress: { value: number }
    uLowFreq: { value: number }
    uMidLowFreq: { value: number }
    uMidHighFreq: { value: number }
    uHighFreq: { value: number }
    uRms: { value: number }
    uBurst: { value: number }
    uPixelRatio: { value: number }
    uResolution: { value: THREE.Vector2 }
    uScale: { value: number }
    uStandbyBlend: { value: number }
  }

  /** 简化动效控制器 */
  private animController: AudioAnimationController

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options: CoverParticleOptions = {}
  ) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.quality = options.quality || 'high'
    this.gridSize = getGridSize(this.quality)
    this.particleCount = this.gridSize * this.gridSize

    this.uniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uLowFreq: { value: 0 },
      uMidLowFreq: { value: 0 },
      uMidHighFreq: { value: 0 },
      uHighFreq: { value: 0 },
      uRms: { value: 0 },
      uBurst: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uResolution: { value: new THREE.Vector2(renderer.domElement.width, renderer.domElement.height) },
      uScale: { value: 1.0 },
      uStandbyBlend: { value: 1.0 },
    }

    this.animController = new AudioAnimationController()
  }

  private loadToken = 0

  async loadCover(url: string): Promise<boolean> {
    if (this.disposed) return false
    if (this.coverUrl === url && this.points) return true

    const myToken = ++this.loadToken
    this.coverUrl = url
    this.isLoading = true
    this.morphProgress = 0
    this.targetMorphProgress = 1

    if (!url) {
      this.coverUrl = null
      if (myToken !== this.loadToken && this.points) {
        this.isLoading = false
        return false
      }
      this.clearParticles()
      this.isLoading = false
      return false
    }

    try {
      const imageData = await this.loadImageData(url)
      if (myToken !== this.loadToken) {
        this.isLoading = false
        return false
      }
      const attrs = this.sampleGridFromImage(imageData)
      this.buildPoints(attrs)
      this.isLoading = false
      return true
    } catch (e) {
      if (myToken !== this.loadToken) {
        this.isLoading = false
        return false
      }
      console.error('[CoverParticle] Failed to load cover:', e)
      this.clearParticles()
      this.isLoading = false
      return false
    }
  }

  private loadImageData(url: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('Cannot get 2d context'))

          const gs = this.gridSize
          const sw = img.naturalWidth || img.width
          const sh = img.naturalHeight || img.height

          let sx = 0, sy = 0, sSize = 0
          if (sw >= sh) {
            sSize = sh
            sx = (sw - sh) / 2
          } else {
            sSize = sw
            sy = (sh - sw) / 2
          }

          canvas.width = gs
          canvas.height = gs
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, gs, gs)
          resolve(ctx.getImageData(0, 0, gs, gs))
        } catch (err) {
          reject(err)
        }
      }
      img.onerror = () => reject(new Error('Failed to load image: ' + url))
      img.src = url
    })
  }

  private sampleGridFromImage(imageData: ImageData): ParticleAttributes {
    const { width, data } = imageData
    const gs = this.gridSize
    const count = gs * gs

    const positions = new Float32Array(count * 3)
    const targets = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const luminance = new Float32Array(count)
    const random = new Float32Array(count)

    const halfPlane = PLANE_SIZE / 2
    const step = PLANE_SIZE / gs

    // ── Pass 1: compute raw luminance ──
    const rawLum = new Float32Array(count)
    for (let row = 0; row < gs; row++) {
      for (let col = 0; col < gs; col++) {
        const idx = row * gs + col
        const pixelIdx = (row * width + col) * 4
        const r = data[pixelIdx] / 255
        const g = data[pixelIdx + 1] / 255
        const b = data[pixelIdx + 2] / 255
        const a = data[pixelIdx + 3] / 255
        rawLum[idx] = (0.299 * r + 0.587 * g + 0.114 * b) * a
      }
    }

    const smoothLum = gaussianSmoothHeight(rawLum, gs)

    for (let row = 0; row < gs; row++) {
      for (let col = 0; col < gs; col++) {
        const idx = row * gs + col
        const pixelIdx = (row * width + col) * 4
        const r = data[pixelIdx] / 255
        const g = data[pixelIdx + 1] / 255
        const b = data[pixelIdx + 2] / 255

        const lum = smoothLum[idx]

        const tx = -halfPlane + col * step + step * 0.5
        const ty = halfPlane - row * step - step * 0.5
        const tz = lum * HEIGHT_SCALE

        targets[idx * 3] = tx
        targets[idx * 3 + 1] = ty
        targets[idx * 3 + 2] = tz

        const angle = Math.random() * Math.PI * 2
        const elev = (Math.random() - 0.5) * Math.PI * 0.8
        const dist = 30 + Math.random() * 25
        positions[idx * 3]     = tx + Math.cos(angle) * Math.cos(elev) * dist
        positions[idx * 3 + 1] = ty + Math.sin(elev) * dist
        positions[idx * 3 + 2] = tz + Math.sin(angle) * Math.cos(elev) * dist

        colors[idx * 3] = r
        colors[idx * 3 + 1] = g
        colors[idx * 3 + 2] = b

        sizes[idx] = step * POINT_SIZE_FACTOR
        luminance[idx] = lum
        random[idx] = Math.random()
      }
    }

    return { positions, targets, colors, sizes, luminance, random }
  }

  private clearParticles(): void {
    if (this.group) {
      this.scene.remove(this.group)
      this.group = null
    }
    this.points = null
    this.disposeGeometry()
  }

  private buildPoints(attrs: ParticleAttributes): void {
    if (this.group) {
      this.scene.remove(this.group)
      this.group = null
    }
    this.points = null
    this.disposeGeometry()

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(attrs.positions, 3))
    this.geometry.setAttribute('target', new THREE.BufferAttribute(attrs.targets, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(attrs.colors, 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(attrs.sizes, 1))
    this.geometry.setAttribute('aLuminance', new THREE.BufferAttribute(attrs.luminance, 1))
    this.geometry.setAttribute('aRandom', new THREE.BufferAttribute(attrs.random, 1))

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false

    this.group = new THREE.Group()
    this.group.add(this.points)
    this.scene.add(this.group)

    this.morphProgress = 0
    this.targetMorphProgress = 1
  }

  private getVertexShader(): string {
    return `
      uniform float uTime;
      uniform float uProgress;
      uniform float uLowFreq;
      uniform float uMidLowFreq;
      uniform float uMidHighFreq;
      uniform float uHighFreq;
      uniform float uRms;
      uniform float uBurst;
      uniform float uPixelRatio;
      uniform vec2 uResolution;
      uniform float uScale;
      uniform float uStandbyBlend;

      attribute vec3 target;
      attribute float size;
      attribute float aLuminance;
      attribute float aRandom;

      varying vec3 vColor;
      varying float vLuminance;
      varying float vAlpha;
      varying float vHighColorBoost;

      void main() {
        vColor = color;
        vLuminance = aLuminance;
        vHighColorBoost = uHighFreq;

        // ══ Morph progress: linear interpolation position → target ══
        float p = uProgress;
        vec3 pos = mix(position, target, p);

        // ══ Audio-driven displacement (only after morph settles) ══
        // 不分组 — 所有粒子统一响应:
        // 低频 → Z 轴脉冲 + burst 爆发 (保留, 视觉最强)
        // 中低频 → Y 轴正弦浮动 (保留, 与 Z 轴不冲突)
        // (移除中高频径向扩散 — 会与低频 Z 轴 + Y 轴浮动产生位移叠加)
        // (移除高频随机微动 — 会与整体动效产生杂乱叠加)
        // 高频 → 仅用于亮度增益, 在 fragment shader 中处理
        float audioWeight = smoothstep(0.85, 1.0, p);

        // 低频: Z 轴脉冲 + burst 爆发
        float bassDisp = (uLowFreq * 0.12 + uBurst * 0.08) * audioWeight * (0.4 + aLuminance * 0.6);
        pos.z += bassDisp;

        // 中低频: Y 轴正弦浮动 (与 Z 轴不冲突)
        float yOffset = sin(target.x * 2.0 + uTime * 2.5) * uMidLowFreq * 0.08 * audioWeight;
        pos.y += yOffset;

        // Perspective-correct point size
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float projScale = uResolution.y * projectionMatrix[1].y * 0.5;
        float perspective = projScale / max(-mvPosition.z, 0.1);

        // Scale-aware sizing
        float scaleFactor = clamp(1.0 / uScale, 1.0, ${ZOOM_OUT_BOOST_MAX.toFixed(1)});
        // Anti-Moiré: per-particle size variation (±10%) breaks regular grid interference
        // without moving particles from their aligned positions
        float sizeJitter = 0.9 + aRandom * 0.2;
        gl_PointSize = size * scaleFactor * uPixelRatio * perspective * sizeJitter;

        // Alpha: RMS-driven opacity (0.85 + rms * 0.15), morph fade-in
        // 提高基础透明度避免放大后粒子间隙导致整体偏暗
        // Alpha: balanced opacity — not too dark, not oversaturated
        vAlpha = (0.88 + uRms * 0.12) * (0.95 + uRms * 0.05);
        vAlpha *= smoothstep(0.7, 1.0, p);

        gl_Position = projectionMatrix * mvPosition;
      }
    `
  }

  private getFragmentShader(): string {
    return `
      precision highp float;

      varying vec3 vColor;
      varying float vLuminance;
      varying float vAlpha;
      varying float vHighColorBoost;

      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        // Soft edge anti-aliasing (replaces hard discard, reduces aliasing artifacts)
        float mask = smoothstep(0.5, 0.15, dist);
        if (mask < 0.01) discard;

        // Solid point — color from source image with high-freq brightness boost
        float brightness = ${PARTICLE_BRIGHTNESS.toFixed(2)} + vHighColorBoost * 0.3;
        vec3 finalColor = vColor * brightness;
        finalColor = pow(finalColor, vec3(0.85));

        // Anti-Moiré: per-pixel hash dithering breaks regular grid interference.
        // Uses screen-space coordinates so the pattern is different per pixel,
        // not per-particle (keeps particles perfectly aligned).
        float hash = fract(sin(dot(gl_FragCoord.xy, vec2(12.989, 78.233))) * 43758.5453);
        float dither = (hash - 0.5) * 0.06; // ±3% alpha variation
        gl_FragColor = vec4(finalColor, vAlpha * mask + dither);
      }
    `
  }

  // ===== 3D interaction =====

  attachInteraction(container: HTMLElement, onChange?: (t: CoverParticleTransform) => void): void {
    this.detachInteraction()
    this.interactionContainer = container
    this.onTransformChange = onChange || null

    container.addEventListener('pointerdown', this.boundPointerDown)
    document.addEventListener('pointermove', this.boundPointerMove)
    document.addEventListener('pointerup', this.boundPointerUp)
    document.addEventListener('pointercancel', this.boundPointerUp)
    container.addEventListener('wheel', this.boundWheel, { passive: false })
    container.addEventListener('touchstart', this.boundTouchStart, { passive: true })
    document.addEventListener('touchmove', this.boundTouchMove, { passive: false })
    document.addEventListener('touchend', this.boundTouchEnd)
  }

  detachInteraction(): void {
    if (!this.interactionContainer) return
    this.interactionContainer.removeEventListener('pointerdown', this.boundPointerDown)
    document.removeEventListener('pointermove', this.boundPointerMove)
    document.removeEventListener('pointerup', this.boundPointerUp)
    document.removeEventListener('pointercancel', this.boundPointerUp)
    this.interactionContainer.removeEventListener('wheel', this.boundWheel)
    this.interactionContainer.removeEventListener('touchstart', this.boundTouchStart)
    document.removeEventListener('touchmove', this.boundTouchMove)
    document.removeEventListener('touchend', this.boundTouchEnd)
    this.interactionContainer = null
    this.onTransformChange = null
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

  private onPointerDown(e: PointerEvent): void {
    if (this.isOnInteractiveChild(e.target)) return
    if (!this.interactionContainer) return
    this.isDragging = true
    this.lastPointerX = e.clientX
    this.lastPointerY = e.clientY
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDragging) return
    const dx = e.clientX - this.lastPointerX
    const dy = e.clientY - this.lastPointerY
    this.lastPointerX = e.clientX
    this.lastPointerY = e.clientY
    this.targetTransform.rotationY += dx * 0.005
    this.targetTransform.rotationX = clamp(this.targetTransform.rotationX + dy * 0.005, -0.5, 0.5)
  }

  private onPointerUp(_e: PointerEvent): void {
    this.isDragging = false
  }

  private onWheel(e: WheelEvent): void {
    if (!this.interactionContainer) return
    e.preventDefault()
    let delta = e.deltaY
    if (e.deltaMode === 1) delta *= 16
    else if (e.deltaMode === 2) delta *= 400
    const factor = 1 - delta * 0.0015
    this.targetTransform.scale = clamp(this.targetTransform.scale * factor, MIN_SCALE, MAX_SCALE)
  }

  private touchStartX = 0
  private touchStartY = 0
  private touchStartDist = 0
  private touchStartScale = 1

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      this.touchStartX = e.touches[0].clientX
      this.touchStartY = e.touches[0].clientY
      this.isDragging = true
    } else if (e.touches.length === 2) {
      this.isDragging = false
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      this.touchStartDist = Math.hypot(dx, dy) || 1
      this.touchStartScale = this.targetTransform.scale
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1 && this.isDragging) {
      e.preventDefault()
      const dx = e.touches[0].clientX - this.touchStartX
      const dy = e.touches[0].clientY - this.touchStartY
      this.touchStartX = e.touches[0].clientX
      this.touchStartY = e.touches[0].clientY
      this.targetTransform.rotationY += dx * 0.005
      this.targetTransform.rotationX = clamp(this.targetTransform.rotationX + dy * 0.005, -0.5, 0.5)
    } else if (e.touches.length === 2) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy) || 1
      const factor = dist / this.touchStartDist
      this.targetTransform.scale = clamp(this.touchStartScale * factor, MIN_SCALE, MAX_SCALE)
    }
  }

  private onTouchEnd(_e: TouchEvent): void {
    this.isDragging = false
  }

  // ===== Update / lifecycle =====

  update(data: AudioSpectrumData): void {
    if (this.disposed || !this.points || !this.group) return

    const dt = Math.min(this.clock.getDelta(), 0.1)
    this.uniforms.uTime.value += dt

    // ── 简化动效控制器更新 ──
    this.animController.update(data, dt, this.camera)

    this.morphProgress += (this.targetMorphProgress - this.morphProgress) * Math.min(dt * 3.5, 1)
    this.uniforms.uProgress.value = this.morphProgress

    // ── 传递 4 频段音频特征到着色器 ──
    this.uniforms.uLowFreq.value = this.animController.lowFreq
    this.uniforms.uMidLowFreq.value = this.animController.midLowFreq
    this.uniforms.uMidHighFreq.value = this.animController.midHighFreq
    this.uniforms.uHighFreq.value = this.animController.highFreq
    this.uniforms.uRms.value = this.animController.rms
    this.uniforms.uBurst.value = this.animController.burstIntensity
    this.uniforms.uStandbyBlend.value = this.animController.standbyBlend

    // Interaction damping
    const k = 1 - Math.pow(0.001, dt)
    this.currentTransform.rotationX = lerp(this.currentTransform.rotationX, this.targetTransform.rotationX, k)
    this.currentTransform.rotationY = lerp(this.currentTransform.rotationY, this.targetTransform.rotationY, k)
    this.currentTransform.scale = lerp(this.currentTransform.scale, this.targetTransform.scale, k)

    this.group.rotation.x = this.currentTransform.rotationX
    this.group.rotation.y = this.currentTransform.rotationY

    // ── 应用简化动效缩放 ──
    this.group.scale.setScalar(this.currentTransform.scale * this.animController.blendedScale)
    this.uniforms.uScale.value = this.currentTransform.scale

    if (this.onTransformChange) {
      this.onTransformChange({ ...this.currentTransform })
    }
  }

  triggerRemorph(): void {
    this.morphProgress = 0
    this.targetMorphProgress = 1
  }

  resetTransform(): void {
    this.targetTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
  }

  getTransform(): CoverParticleTransform {
    return { ...this.currentTransform }
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing
  }

  resize(): void {
    if (this.renderer) {
      this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
      this.uniforms.uResolution.value.set(this.renderer.domElement.width, this.renderer.domElement.height)
    }
  }

  setQuality(q: CoverParticleQuality): void {
    if (this.quality === q) return
    this.quality = q
    this.gridSize = getGridSize(q)
    this.particleCount = this.gridSize * this.gridSize
    if (this.coverUrl) {
      this.loadCover(this.coverUrl)
    }
  }

  dispose(): void {
    this.disposed = true
    this.animController.dispose()
    this.detachInteraction()
    this.disposeGeometry()
    if (this.group) {
      this.scene.remove(this.group)
      this.group = null
    }
    this.points = null
  }

  private disposeGeometry(): void {
    if (this.geometry) {
      this.geometry.dispose()
      this.geometry = null
    }
    if (this.material) {
      this.material.dispose()
      this.material = null
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 可分离高斯模糊用于高度场平滑。
 * 两遍处理 (水平 + 垂直), clamp 边缘处理。
 * sigma = radius * 0.5, 权重归一化。
 */
function gaussianSmoothHeight(src: Float32Array, gs: number): Float32Array {
  const radius = HEIGHT_SMOOTH_RADIUS
  const sigma = radius * 0.5
  const kernelSize = 2 * radius + 1

  const kernel = new Float32Array(kernelSize)
  let weightSum = 0
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = w
    weightSum += w
  }
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= weightSum
  }

  const count = gs * gs
  const temp = new Float32Array(count)
  const out = new Float32Array(count)

  // Pass 1: horizontal
  for (let row = 0; row < gs; row++) {
    for (let col = 0; col < gs; col++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        const c = clamp(col + k, 0, gs - 1)
        sum += src[row * gs + c] * kernel[k + radius]
      }
      temp[row * gs + col] = sum
    }
  }

  // Pass 2: vertical
  for (let row = 0; row < gs; row++) {
    for (let col = 0; col < gs; col++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        const r = clamp(row + k, 0, gs - 1)
        sum += temp[r * gs + col] * kernel[k + radius]
      }
      out[row * gs + col] = sum
    }
  }

  return out
}
