/**
 * 封面球幕可视化器
 *
 * 将专辑封面切成 12×12=144 张小方块，铺成横跨 120°、纵跨 90° 的球面弯曲穹顶。
 * 卡片之间保留间距，缩放到最小时透视变平使卡片自然合拢成完整封面。
 * 支持正反面切换 (0° ↔ 180°)，动态 Z 补偿确保正反面观看距离一致。
 * 切歌时旧卡片沿径向飞散 → 新封面从中心爆开重组。
 * 拖拽旋转整个穹顶、滚轮缩放。
 */

import * as THREE from 'three'
import type { AudioSpectrumData } from './audioAnalyzer'
import { AudioAnimationController } from './audioAnimationLayer'

export type CoverTileGridQuality = 'low' | 'medium' | 'high'

export interface CoverTileGridOptions {
  quality?: CoverTileGridQuality
  onLoad?: () => void
  onError?: (err: Error) => void
}

export interface CoverTileGridTransform {
  rotationX: number
  rotationY: number
  scale: number
}

interface TileData {
  mesh: THREE.Mesh
  basePosition: THREE.Vector3
  baseQuaternion: THREE.Quaternion
  baseScale: THREE.Vector2
  phaseSeed: number
  staggerDelay: number
  currentZOffset: number
  // Normalized distance from dome center (0-1) for radial wave propagation
  normalizedDist: number
}

// ===== Tunable layout constants =====
const COLS = 12
const ROWS = 12
const TILE_COUNT = COLS * ROWS
const TILE_SIZE = 1.0                    // geometry unit size; real visual size is set via scale
const SPHERE_RADIUS = 8                  // smaller radius so tiles sit closer together
const LON_SPAN = (Math.PI * 120) / 180   // 120° horizontal — less edge stretch
const LAT_SPAN = (Math.PI * 90) / 180    // 90° vertical
// Smaller coverage = bigger gaps between tiles in the default view. At the
// minimum zoom (MIN_SCALE) the perspective flattening makes the tiles
// visually slide together so the album cover reads as a coherent image.
const TILE_COVERAGE = 0.78

// ===== Anti-aliasing tuning =====
// How many source-texture pixels go into a single tile. With 144 tiles and
// 12 columns, each slice takes 1/12 of the cover's long edge. We render the
// texture at 12 × TILE_TEX_PIXELS per side, so each tile gets a clean
// TILE_TEX_PIXELS-wide block of source pixels — that ratio is the single
// biggest lever against aliasing, since low per-tile resolution is what
// produces the blocky / stair-step look.
const TILE_TEX_PIXELS = 96
const TEX_LONG_EDGE = COLS * TILE_TEX_PIXELS  // 1152 px

// ===== Animation timing =====
const BURST_DURATION = 420  // ms — old tiles fly out
const BURST_DISTANCE = 5    // world units the burst travels along the local +Z
const ASSEMBLE_DURATION = 700  // ms — new tiles pop in
const STAGGER_SPREAD = 280  // ms spread of per-tile assemble stagger

// ===== Interaction limits =====
const MIN_SCALE = 0.7
const MAX_SCALE = 1.4
const DEFAULT_SCALE = 1.0
const MAX_ROT_X = 1.0  // clamp to keep the dome from going upside-down
const MAX_ROT_Y = Math.PI  // allow full horizontal spin

// ===== 简化动效参数 =====
// 音频响应基于低/中/高频能量均值 + RMS 音量
const TILE_DISP_SCALE = 0.35    // 基础位移幅度倍率

// Reused for sphere-coord math
const _normal = new THREE.Vector3()
const _tileNormal = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _right = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _zAxis = new THREE.Vector3(0, 0, 1)

export class CoverTileGridVisualizer {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private renderer: THREE.WebGLRenderer
  private quality: CoverTileGridQuality

  // Container for the dome — interaction (drag/zoom) rotates/scales this
  // group, so we never touch individual tile transforms for input.
  private domeGroup: THREE.Group

  // All currently-mapped tiles. Empty before the first loadCover.
  private tiles: TileData[] = []
  private sharedGeometry: THREE.PlaneGeometry | null = null
  private sharedMaterial: THREE.ShaderMaterial | null = null
  private coverTexture: THREE.Texture | null = null
  // Reused cover canvas + 2d context. Allocating one and resizing on demand
  // is much cheaper than creating a fresh canvas per track switch.
  private coverCanvas: HTMLCanvasElement | null = null
  private coverCtx: CanvasRenderingContext2D | null = null

  private clock = new THREE.Clock()
  private clockTime = 0
  private disposed = false
  private isPlaying = false

  /** 简化动效控制器 */
  private animController: AudioAnimationController

  // ===== Cover loading =====
  private loadToken = 0
  private coverUrl: string | null = null
  private isLoading = false
  // Per-tile entrance state. 'idle' = steady-state animation; 'assembling' =
  // bursting in from scale 0; 'bursting' = flying out for old-cover transition.
  private tilePhase: 'idle' | 'assembling' | 'bursting' = 'idle'
  private phaseStartTime = 0  // performance.now() when current phase began

  // ===== Interaction =====
  private currentTransform: CoverTileGridTransform = {
    rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE
  }
  private targetTransform: CoverTileGridTransform = {
    rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE
  }
  private isDragging = false
  private lastPointerX = 0
  private lastPointerY = 0
  private interactionContainer: HTMLElement | null = null
  private onTransformChange: ((t: CoverTileGridTransform) => void) | null = null

  // Pre-bound handlers so add/remove pair up cleanly.
  private boundPointerDown = (e: PointerEvent) => this.onPointerDown(e)
  private boundPointerMove = (e: PointerEvent) => this.onPointerMove(e)
  private boundPointerUp = (e: PointerEvent) => this.onPointerUp(e)
  private boundWheel = (e: WheelEvent) => this.onWheel(e)
  private boundTouchStart = (e: TouchEvent) => this.onTouchStart(e)
  private boundTouchMove = (e: TouchEvent) => this.onTouchMove(e)
  private boundTouchEnd = (e: TouchEvent) => this.onTouchEnd(e)

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options: CoverTileGridOptions = {}
  ) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.quality = options.quality || 'high'

    this.domeGroup = new THREE.Group()
    this.scene.add(this.domeGroup)

    this.animController = new AudioAnimationController()
  }

  // ====================== Public API ======================

  /**
   * Load (or reload) the album cover. On change, the previous tile set bursts
   * radially outward, then the new cover explodes in tile-by-tile with a
   * staggered cascade.
   */
  async loadCover(url: string): Promise<boolean> {
    if (this.disposed) return false
    if (this.coverUrl === url && this.tiles.length > 0) return true

    const myToken = ++this.loadToken
    this.coverUrl = url
    this.isLoading = true

    // Empty URL (no embedded cover art) — show a deterministic fallback color
    // so the dome doesn't disappear. The fallback skips the burst entirely
    // because there's nothing to "explode away" from.
    if (!url) {
      this.coverUrl = null
      this.disposeTiles()
      this.disposeCoverTexture()
      this.buildFallbackTiles(myToken)
      this.isLoading = false
      return false
    }

    // If old tiles exist, kick off the burst immediately. The new image can
    // load in parallel — by the time the 350ms burst is over, the cached
    // remote image is usually already decoded.
    if (this.tiles.length > 0) {
      this.startBurst()
    }

    try {
      const image = await this.loadImage(url)
      if (myToken !== this.loadToken) {
        // A newer loadCover superseded us — drop this result.
        this.isLoading = false
        return false
      }
      // Pre-render the cover at TEX_LONG_EDGE on the long side. This decouples
      // the texture from the source file's resolution: a tiny 100×100 cover
      // still produces clean per-tile blocks, and a 3000×3000 cover is
      // downsampled to a manageable 1152² to keep VRAM low. `high` quality
      // also smooths aliasing during the downsample.
      const prepared = this.prepareCoverCanvas(image)

      this.disposeCoverTexture()
      this.coverTexture = new THREE.CanvasTexture(prepared)
      // Use default flipY=true. UV mapping is set up for this mode.
      this.coverTexture.colorSpace = THREE.SRGBColorSpace
      // Mipmaps + trilinear filtering is the single most effective AA
      // setting for these tiles. Each tile samples only a 1/12 slice of the
      // cover, so without mipmaps the GPU has to fall back to a single
      // bilinear tap and the result is sharp but blocky / stair-stepped
      // along the slice boundaries.
      this.coverTexture.minFilter = THREE.LinearMipmapLinearFilter
      this.coverTexture.magFilter = THREE.LinearFilter
      this.coverTexture.generateMipmaps = true
      this.coverTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
      this.coverTexture.needsUpdate = true

      // Wait for burst to finish before swapping meshes so the old tiles
      // visually clear the stage. If burst already finished (token advanced
      // burst state), the wait is a no-op.
      await this.waitForPhaseComplete('bursting', BURST_DURATION, myToken)
      if (myToken !== this.loadToken) {
        this.isLoading = false
        return false
      }

      this.disposeTiles()
      this.buildTileDome()
      this.startAssemble()
      this.isLoading = false
      return true
    } catch (e) {
      if (myToken !== this.loadToken) {
        this.isLoading = false
        return false
      }
      console.error('[CoverTileGrid] Failed to load cover:', e)
      this.disposeTiles()
      this.disposeCoverTexture()
      this.buildFallbackTiles(myToken)
      this.isLoading = false
      return false
    }
  }

  /**
   * Per-frame update. Receives the current audio spectrum and animates every
   * tile along its normal axis based on band energy.
   */
  update(data: AudioSpectrumData): void {
    if (this.disposed) return

    const dt = Math.min(this.clock.getDelta(), 0.1)
    this.clockTime += dt
    const t = this.clockTime
    const now = performance.now()

    // ── 简化动效控制器更新 ──
    this.animController.update(data, dt, this.camera)

    // ---- Smoothly damp the user-driven transform toward target ----
    // Use shortest-path angle interpolation for rotationY so wrapping
    // from +π to -π (or vice versa) doesn't cause a 360° spin.
    const k = 1 - Math.pow(0.001, dt)
    this.currentTransform.rotationX = lerp(this.currentTransform.rotationX, this.targetTransform.rotationX, k)
    this.currentTransform.rotationY = wrapAngle(lerpAngle(this.currentTransform.rotationY, this.targetTransform.rotationY, k))
    this.currentTransform.scale = lerp(this.currentTransform.scale, this.targetTransform.scale, k)

    this.domeGroup.rotation.x = this.currentTransform.rotationX
    this.domeGroup.rotation.y = this.currentTransform.rotationY

    // ── 动态调整 Z 位置: 保持正/背面视角距离一致 ──
    // 穹顶中心 (local z = -SPHERE_RADIUS) 在 Y 轴旋转后移动到
    // world z = -R*cos(θ) + group.z。设 group.z = Z_TARGET + R*cos(θ)
    // 可让中心始终位于 world z = Z_TARGET，正/背面距离相机一致。
    // Z_TARGET = -4 是正面原距离(≈19.5)和背面原距离(≈3.5)的折中值。
    const DOME_Z_TARGET = -4
    this.domeGroup.position.z = DOME_Z_TARGET + SPHERE_RADIUS * Math.cos(this.currentTransform.rotationY)

    // ── 应用简化动效缩放 ──
    this.domeGroup.scale.setScalar(this.currentTransform.scale * this.animController.blendedScale)

    // ---- 4 频段音频特征 (从控制器获取, 参考 粒子律动方案.md) ----
    const lowFreq = this.animController.lowFreq
    const midLowFreq = this.animController.midLowFreq
    const midHighFreq = this.animController.midHighFreq
    const highFreq = this.animController.highFreq
    const rms = this.animController.rms
    const burst = this.animController.burstIntensity
    const standbyBlend = this.animController.standbyBlend
    const volumeBoost = 1 + rms * 0.35

    // ---- Drive each tile ----
    const phaseElapsed = now - this.phaseStartTime

    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i]
      const mesh = tile.mesh

      let entrance = 1
      let zOffset = 0

      if (this.tilePhase === 'assembling') {
        const tileStart = tile.staggerDelay
        const local = (phaseElapsed - tileStart) / ASSEMBLE_DURATION
        if (local < 0) {
          entrance = 0
        } else if (local < 1) {
          entrance = easeOutCubic(local)
        } else {
          entrance = 1
        }
      } else if (this.tilePhase === 'bursting') {
        const tileStart = tile.staggerDelay * 0.25
        const local = clamp((phaseElapsed - tileStart) / BURST_DURATION, 0, 1)
        zOffset = BURST_DISTANCE * easeOutCubic(local)
      }

      // ══ 4 频段分组响应 (参考 粒子律动方案.md) ══
      // 瓦片按行分为 4 组: 顶部→低频, 中上→中低频, 中下→中高频, 底部→高频
      const rowRatio = tile.basePosition.y > 0
        ? 0.5 - tile.basePosition.y / SPHERE_RADIUS  // top half → 0~0.5
        : 0.5 - tile.basePosition.y / SPHERE_RADIUS  // bottom half → 0.5~1
      const groupIdx = rowRatio < 0.25 ? 0 : rowRatio < 0.5 ? 1 : rowRatio < 0.75 ? 2 : 3

      // 1. 低频 → Z 轴深度脉冲 + burst
      const bassDisp = (groupIdx === 0 ? 1.0 : 0.4) * lowFreq * TILE_DISP_SCALE
        + (groupIdx === 0 ? burst * 0.15 : 0)

      // 2. 中低频 → Z 轴波纹 (沿穹顶表面传播)
      const wavePhase = tile.normalizedDist * Math.PI * 2.5 + t * 1.8 + tile.phaseSeed * 0.5
      const midWave = Math.sin(wavePhase) * midLowFreq * TILE_DISP_SCALE * 0.5

      // 3. 中高频 → 细微抖动 (径向方向, 避免与波纹冲突)
      const shimmer = groupIdx === 2
        ? Math.sin(t * 6.5 + tile.phaseSeed * 3.0) * midHighFreq * 0.04
        : 0

      // 4. 高频 → 顶部瓦片亮度 (在材质中处理)
      const highShimmer = groupIdx === 3
        ? Math.sin(t * 8.0 + tile.phaseSeed * 5.0) * highFreq * 0.02
        : 0

      // 4. 待机呼吸
      const standbyBreath = Math.sin(t * 0.8) * 0.02 * standbyBlend

      const audioZ = (bassDisp + midWave + shimmer + highShimmer + standbyBreath) * volumeBoost

      // ---- Apply ----
      tile.currentZOffset = zOffset + audioZ
      mesh.position.copy(tile.basePosition)
      mesh.translateZ(tile.currentZOffset)
      mesh.quaternion.copy(tile.baseQuaternion)
      _scale.set(
        tile.baseScale.x * entrance,
        tile.baseScale.y * entrance,
        1
      )
      mesh.scale.copy(_scale)
    }

    // ---- Advance phase if the entrance animation has finished ----
    if (this.tilePhase === 'assembling' && phaseElapsed > ASSEMBLE_DURATION + STAGGER_SPREAD) {
      this.tilePhase = 'idle'
    } else if (this.tilePhase === 'bursting' && phaseElapsed > BURST_DURATION) {
      this.tilePhase = 'idle'
    }

    // ---- 材质亮度: 高频驱动 ----
    if (this.sharedMaterial && this.coverUrl) {
      const brightness = 1.0 + highFreq * 0.15 + burst * 0.1
      this.sharedMaterial.uniforms.uColor.value.setRGB(brightness, brightness, brightness)
    }
  }

  /**
   * Reset rotation and zoom to defaults. Call from the preset switcher so
   * coming back to this preset doesn't inherit a stale angle.
   */
  resetTransform(): void {
    this.targetTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
  }

  /**
   * Toggle between the front view (rotationY ≈ 0) and the back view
   * (rotationY ≈ π). The dome's tiles use DoubleSide so the back face
   * is visible — the cover image appears mirrored, which is the expected
   * "back of the dome" perspective.
   *
   * The existing lerp-based damping in update() smoothly animates to the
   * new target, so the flip feels like a gentle 180° spin rather than a
   * hard cut.
   *
   * Returns the new angle label: 'front' or 'back'.
   */
  flipAngle(): 'front' | 'back' {
    // Determine which side we're currently closest to.
    const y = wrapAngle(this.targetTransform.rotationY)
    const isFront = Math.abs(y) < Math.PI / 2
    this.targetTransform.rotationY = isFront ? Math.PI : 0
    return isFront ? 'back' : 'front'
  }

  /**
   * Returns 'front' if the dome's target angle is closest to 0°, 'back' if
   * closest to 180°. Used by the UI to show the correct toggle state.
   */
  getAngleMode(): 'front' | 'back' {
    const y = wrapAngle(this.targetTransform.rotationY)
    return Math.abs(y) < Math.PI / 2 ? 'front' : 'back'
  }

  /**
   * Pre-render the source cover image to a fixed-resolution canvas.
   * Returns the same canvas instance across calls so we don't allocate a
   * fresh one per track (only the pixel contents change).
   *
   * Why this exists: with 144 tiles sampling from a single texture, the
   * per-tile source-pixel budget is the dominant AA lever. If the cover
   * comes in at 200x200 each tile effectively gets ~17 source pixels —
   * those 17 pixels get upscaled to fill the tile, producing exactly the
   * stair-stepped look the user is seeing. Resampling to TEX_LONG_EDGE
   * forces a consistent 96-px-per-tile budget, and the GPU's mipmap
   * chain (LinearMipmapLinear + anisotropy) handles the final screen-
   * space AA from there.
   */
  private prepareCoverCanvas(source: HTMLImageElement): HTMLCanvasElement {
    if (!this.coverCanvas) {
      this.coverCanvas = document.createElement('canvas')
      this.coverCtx = this.coverCanvas.getContext('2d', { willReadFrequently: false })
    }
    const ctx = this.coverCtx
    if (!ctx) return this.coverCanvas

    const sw = source.naturalWidth || source.width
    const sh = source.naturalHeight || source.height
    if (sw === 0 || sh === 0) return this.coverCanvas

    // Center-crop to SQUARE so the COLS×ROWS grid divides the image uniformly.
    let sx = 0, sy = 0, sSize = 0
    if (sw >= sh) {
      sSize = sh
      sx = (sw - sh) / 2
    } else {
      sSize = sw
      sy = (sh - sw) / 2
    }

    const tw = TEX_LONG_EDGE
    const th = TEX_LONG_EDGE

    if (this.coverCanvas.width !== tw || this.coverCanvas.height !== th) {
      this.coverCanvas.width = tw
      this.coverCanvas.height = th
    }

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, tw, th)
    ctx.drawImage(source, sx, sy, sSize, sSize, 0, 0, tw, th)
    return this.coverCanvas
  }

  /**
   * Build the shared ShaderMaterial. The fragment shader does the work
   * that MeshBasicMaterial can't: fwidth-driven edge softening.
   *
   * Each tile's UVs are remapped so v=0 is the slice's top edge and v=1
   * the bottom edge. The fragment shader treats those UVs as a 0..1
   * "slice-local" coordinate and computes the distance to the nearest
   * slice edge. That distance, normalized to be a stable width in screen
   * space (via fwidth — the screen-space derivative of the UV), drives
   * an alpha falloff. The result: tiles still tile, but their edges
   * smoothly fade into the neighbours instead of showing a hard plane
   * boundary. This is the dominant anti-aliasing technique for the dome.
   *
   * The shader also feeds a 1px feather ring along the SOURCE-CONTENT
   * edges, so the colour transition between two adjacent tiles is
   * gradient-smoothed in the underlying texture — that handles the
   * secondary source of aliasing, which is high-frequency content
   * crossing the slice boundary.
   */
  private createShaderMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.coverTexture },
        uColor: { value: new THREE.Color(0xffffff) },
        uEdgeFeather: { value: 0.18 },   // 18% of the slice radius fades to transparent
        uColorFeather: { value: 0.02 }   // 2% pixel-radius softens the texture sample itself
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uEdgeFeather;
        uniform float uColorFeather;
        varying vec2 vUv;

        void main() {
          // Source color, sampled with explicit mipmap-aware filtering.
          // textureLod picks the level the GPU would have chosen anyway,
          // but with explicit control. Bias 0 = default trilinear result.
          vec4 c = texture2D(uMap, vUv, 0.0);
          vec3 rgb = c.rgb * uColor;
          float a  = c.a;

          // ---- Geometry-edge anti-aliasing ----
          // Compute screen-space UV derivative, then take distance to the
          // nearest slice edge (v=0, v=1, u=0, u=1 in slice-local UV).
          // The smoothstep turns that distance into a soft mask that
          // fades 1 → 0 over uEdgeFeather of the slice.
          vec2 duv = fwidth(vUv);
          vec2 edge = min(vUv, 1.0 - vUv);
          float edgeDist = min(edge.x, edge.y);
          float aa = smoothstep(0.0, duv.x * (uEdgeFeather * 30.0), edgeDist);
          // Multiply by alpha to keep opaque pixels opaque.
          a *= aa;

          // ---- Source-content anti-aliasing ----
          // A 1-pixel mipmap-level push softens texture detail so very
          // high-frequency content (small text, fine faces) doesn't
          // shimmer across slice boundaries.
          vec3 softened = textureLod(uMap, vUv, uColorFeather * 8.0).rgb;
          rgb = mix(rgb, softened * uColor, 0.5);

          gl_FragColor = vec4(rgb, a);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false
    })
  }

  getTransform(): CoverTileGridTransform {
    return { ...this.currentTransform }
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing
  }

  /**
   * Attach pointer / wheel / touch listeners to a DOM element so the user
   * can drag-rotate the dome and wheel-zoom. Mirrors the
   * CoverParticleVisualizer pattern.
   */
  attachInteraction(container: HTMLElement, onChange?: (t: CoverTileGridTransform) => void): void {
    this.detachInteraction()
    this.interactionContainer = container
    this.onTransformChange = onChange || null

    // Use document-level listeners for move/up to ensure we capture events
    // even when pointer leaves the container. This fixes the drag bug.
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

  resize(): void {
    // No resolution-dependent uniforms; placeholder for API symmetry.
  }

  dispose(): void {
    this.disposed = true
    this.animController.dispose()
    this.detachInteraction()
    this.disposeTiles()
    this.disposeCoverTexture()
    if (this.sharedMaterial) {
      this.sharedMaterial.dispose()
      this.sharedMaterial = null
    }
    if (this.sharedGeometry) {
      this.sharedGeometry.dispose()
      this.sharedGeometry = null
    }
    // Release the canvas backing store. The 2d context holds onto a
    // reference too, so clear both.
    this.coverCtx = null
    if (this.coverCanvas) {
      this.coverCanvas.width = 0
      this.coverCanvas.height = 0
      this.coverCanvas = null
    }
    if (this.domeGroup.parent) {
      this.domeGroup.parent.remove(this.domeGroup)
    }
  }

  // ====================== Internal ======================

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      // Always set crossOrigin — beat:// is cross-origin; without it
      // getImageData() throws SecurityError (tainted canvas).
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to load image: ' + url))
      img.src = url
    })
  }

  /**
   * Build the 12x12 tile dome for the currently-loaded cover texture. Each
   * tile's UV array is rewired to point at its region of the shared texture,
   * so we use a single 1MB-ish texture instead of 144 ImageBitmaps.
   */
  private buildTileDome(): void {
    if (!this.coverTexture) return

    // One geometry per tile so we can have per-tile UVs. PlaneGeometry is 2
    // triangles, ~96 bytes — 144 of them is ~14 KB, negligible.
    // The geometry is shared via a template; we clone the UV attribute per
    // tile so each points to its slice of the cover.
    const templateGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE)

    // Shared shader material — one material, all 144 tiles. Uses a custom
    // fragment shader so we can apply per-tile edge softening (fwidth-based
    // alpha falloff) at the GPU level. This is what kills the visible
    // "card grid" edges: every tile fades smoothly to its own slice
    // boundary, so neighbouring tiles blend into each other rather than
    // showing a hard geometry edge.
    if (!this.sharedMaterial) {
      this.sharedMaterial = this.createShaderMaterial()
    } else {
      // Reuse the existing material; rebind the texture AND reset the
      // colour uniform to white. The fallback path mutates uColor to a
      // dim purple (0x3a2a44); if we don't reset it here the next cover
      // load would still render tinted — the same "dim/grey on first
      // load" bug but for a different reason than the original.
      this.sharedMaterial.uniforms.uMap.value = this.coverTexture
      this.sharedMaterial.uniforms.uColor.value.setHex(0xffffff)
    }

    const tiles: TileData[] = []

    // Arc-length step between adjacent tile centers.
    const hArcStep = SPHERE_RADIUS * LON_SPAN / (COLS - 1)
    const vArcStep = SPHERE_RADIUS * LAT_SPAN / (ROWS - 1)

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col
        // ---- Spherical position ----
        // lon: -60° .. +60° centered on the camera's forward axis
        const lon = ((col - (COLS - 1) / 2) / (COLS - 1)) * LON_SPAN
        // lat: +45° (top of image) .. -45° (bottom). row 0 is the image's
        // top, so we INVERT the sign of lat so the layout reads as expected.
        const lat = -((row - (ROWS - 1) / 2) / (ROWS - 1)) * LAT_SPAN

        const cosLat = Math.cos(lat)
        const sinLat = Math.sin(lat)
        const cosLon = Math.cos(lon)
        const sinLon = Math.sin(lon)

        _pos.set(
          SPHERE_RADIUS * cosLat * sinLon,
          SPHERE_RADIUS * sinLat,
          -SPHERE_RADIUS * cosLat * cosLon
        )

        // ---- Per-tile UVs ----
        // PlaneGeometry vertex order (verified from three.js source):
        //   vertex 0 = top-left  (Y=+0.5, X=-0.5)
        //   vertex 1 = top-right (Y=+0.5, X=+0.5)
        //   vertex 2 = bottom-left  (Y=-0.5, X=-0.5)
        //   vertex 3 = bottom-right (Y=-0.5, X=+0.5)
        // With flipY=true (default): v=1 → top of image, v=0 → bottom.
        // row 0 = top of image → needs high v (v1) on top vertices.
        const u0 = col / COLS
        const u1 = (col + 1) / COLS
        const v1 = 1.0 - row / ROWS           // top edge of this row's slice
        const v0 = 1.0 - (row + 1) / ROWS     // bottom edge of this row's slice

        const geo = templateGeo.clone()
        const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
        const uvArray = uvAttr.array as Float32Array
        uvArray[0] = u0; uvArray[1] = v1   // vertex 0: top-left    → top-left of slice
        uvArray[2] = u1; uvArray[3] = v1   // vertex 1: top-right   → top-right of slice
        uvArray[4] = u0; uvArray[5] = v0   // vertex 2: bottom-left → bottom-left of slice
        uvArray[6] = u1; uvArray[7] = v0   // vertex 3: bottom-right→ bottom-right of slice
        uvAttr.needsUpdate = true

        // ---- Tile size on the sphere ----
        // Make each tile cover its arc step so the image slices sit tightly
        // together. Horizontal width shrinks with cos(latitude); vertical
        // height stays constant. A coverage < 1 leaves a hairline gap that
        // emphasizes the "tiled" nature while still reading as one image.
        const tileWidth = (hArcStep * cosLat / TILE_SIZE) * TILE_COVERAGE
        const tileHeight = (vArcStep / TILE_SIZE) * TILE_COVERAGE

        const mesh = new THREE.Mesh(geo, this.sharedMaterial)
        mesh.position.copy(_pos)
        // Orient using parametric tangent vectors — mathematically
        // well-defined for ALL tiles, no degeneracy at any latitude.
        //
        // Sphere param: P(lon,lat) = (R*cosLat*sinLon, R*sinLat, -R*cosLat*cosLon)
        //   right = dP/dlon normalized = (cosLon, 0, sinLon)
        //   up    = dP/dlat normalized = (-sinLat*sinLon, cosLat, sinLat*cosLon)
        //   inward = -P/|P| = (-cosLat*sinLon, -sinLat, cosLat*cosLon)
        //
        // right × up = inward (right-handed), so makeBasis(right, up, inward)
        // creates a proper rotation. Local +Z (front face) faces inward
        // (toward camera), local +Y points toward top of dome (row 0).
        _right.set(cosLon, 0, sinLon)
        _up.set(-sinLat * sinLon, cosLat, sinLat * cosLon)
        _normal.set(-cosLat * sinLon, -sinLat, cosLat * cosLon)
        _matrix.makeBasis(_right, _up, _normal)
        _quat.setFromRotationMatrix(_matrix)
        mesh.quaternion.copy(_quat)
        mesh.scale.set(0, 0, 1)
        mesh.frustumCulled = false

        this.domeGroup.add(mesh)

        // Stagger goes from 0 to STAGGER_SPREAD ms, biased by distance from
        // center so the assemble reads as an outward shockwave.
        const dx = col - (COLS - 1) / 2
        const dy = row - (ROWS - 1) / 2
        const dist = Math.sqrt(dx * dx + dy * dy)
        const maxDist = Math.sqrt(((COLS - 1) / 2) ** 2 + ((ROWS - 1) / 2) ** 2)
        const staggerDelay = (dist / maxDist) * STAGGER_SPREAD

        tiles.push({
          mesh,
          basePosition: _pos.clone(),
          baseQuaternion: mesh.quaternion.clone(),
          baseScale: new THREE.Vector2(tileWidth, tileHeight),
          phaseSeed: Math.random(),
          staggerDelay,
          currentZOffset: 0,
          normalizedDist: maxDist > 0 ? dist / maxDist : 0
        })

        // Mark _pos for next iteration — Quaternion/Vector3 set() already
        // mutate in place so we just reuse the same scratch.
        void idx
      }
    }

    // Track the template so we can dispose it on tear-down.
    if (this.sharedGeometry && this.sharedGeometry !== templateGeo) {
      this.sharedGeometry.dispose()
    }
    this.sharedGeometry = templateGeo

    this.tiles = tiles
  }

  /**
   * Build a placeholder dome when no cover is available (e.g. local MP3
   * without an embedded picture). Tiles use a flat dark color so the
   * geometry still reacts to audio without showing a broken texture.
   */
  private buildFallbackTiles(myToken: number): void {
    if (myToken !== this.loadToken) return

    if (!this.sharedMaterial) {
      // Use a 1x1 black dummy texture so the shader can still sample.
      const dummy = new THREE.DataTexture(
        new Uint8Array([0, 0, 0, 255]),
        1, 1,
        THREE.RGBAFormat
      )
      dummy.needsUpdate = true
      this.sharedMaterial = this.createShaderMaterial()
      // Swap to the placeholder color and detach the real cover texture.
      this.sharedMaterial.uniforms.uMap.value = dummy
      this.sharedMaterial.uniforms.uColor.value.setHex(0x2a2a2a)
    } else {
      // Switch the color uniform; leave the existing texture in place —
      // for a fallback we just darken whatever is shown via uColor.
      this.sharedMaterial.uniforms.uColor.value.setHex(0x2a2a2a)
    }

    const templateGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE)
    if (this.sharedGeometry && this.sharedGeometry !== templateGeo) {
      this.sharedGeometry.dispose()
    }
    this.sharedGeometry = templateGeo

    const tiles: TileData[] = []

    // Arc-length step between adjacent tile centers (same as buildTileDome).
    const hArcStep = SPHERE_RADIUS * LON_SPAN / (COLS - 1)
    const vArcStep = SPHERE_RADIUS * LAT_SPAN / (ROWS - 1)

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const lon = ((col - (COLS - 1) / 2) / (COLS - 1)) * LON_SPAN
        const lat = -((row - (ROWS - 1) / 2) / (ROWS - 1)) * LAT_SPAN
        const cosLat = Math.cos(lat)
        const sinLat = Math.sin(lat)
        const cosLon = Math.cos(lon)
        const sinLon = Math.sin(lon)

        _pos.set(
          SPHERE_RADIUS * cosLat * sinLon,
          SPHERE_RADIUS * sinLat,
          -SPHERE_RADIUS * cosLat * cosLon
        )

        const tileWidth = (hArcStep * cosLat / TILE_SIZE) * TILE_COVERAGE
        const tileHeight = (vArcStep / TILE_SIZE) * TILE_COVERAGE

        const geo = templateGeo.clone()
        const mesh = new THREE.Mesh(geo, this.sharedMaterial)
        mesh.position.copy(_pos)
        // Same parametric tangent orientation as buildTileDome.
        _right.set(cosLon, 0, sinLon)
        _up.set(-sinLat * sinLon, cosLat, sinLat * cosLon)
        _normal.set(-cosLat * sinLon, -sinLat, cosLat * cosLon)
        _matrix.makeBasis(_right, _up, _normal)
        _quat.setFromRotationMatrix(_matrix)
        mesh.quaternion.copy(_quat)
        mesh.scale.set(0, 0, 1)
        mesh.frustumCulled = false
        this.domeGroup.add(mesh)

        const dx = col - (COLS - 1) / 2
        const dy = row - (ROWS - 1) / 2
        const dist = Math.sqrt(dx * dx + dy * dy)
        const maxDist = Math.sqrt(((COLS - 1) / 2) ** 2 + ((ROWS - 1) / 2) ** 2)

        tiles.push({
          mesh,
          basePosition: _pos.clone(),
          baseQuaternion: mesh.quaternion.clone(),
          baseScale: new THREE.Vector2(tileWidth, tileHeight),
          phaseSeed: Math.random(),
          staggerDelay: (dist / maxDist) * STAGGER_SPREAD,
          currentZOffset: 0,
          normalizedDist: maxDist > 0 ? dist / maxDist : 0
        })
      }
    }
    this.tiles = tiles
    this.startAssemble()
  }

  private startBurst(): void {
    this.tilePhase = 'bursting'
    this.phaseStartTime = performance.now()
    // Reset all tile stagger offsets to 0 so they all begin the burst in
    // sync — the wave shape comes from the assemble phase, not the burst.
    for (const t of this.tiles) t.staggerDelay = 0
  }

  private startAssemble(): void {
    this.tilePhase = 'assembling'
    this.phaseStartTime = performance.now()
  }

  private disposeTiles(): void {
    for (const tile of this.tiles) {
      this.domeGroup.remove(tile.mesh)
      // Each tile owns its own geometry clone; the material is shared so we
      // don't dispose it here. The base template geometry is disposed in
      // dispose() (or in buildTileDome when replaced).
      tile.mesh.geometry.dispose()
    }
    this.tiles = []
  }

  private disposeCoverTexture(): void {
    if (this.coverTexture) {
      this.coverTexture.dispose()
      this.coverTexture = null
    }
  }

  /**
   * Wait for a phase to complete, polling at ~30Hz. Used so the burst has
   * time to play out before we swap the meshes underneath it. Resolves
   * immediately if the phase isn't actually active (e.g. interrupted by
   * a newer loadCover).
   */
  private waitForPhaseComplete(phase: 'assembling' | 'bursting', duration: number, myToken: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.tilePhase !== phase || myToken !== this.loadToken) {
        resolve()
        return
      }
      const start = performance.now()
      const tick = () => {
        if (myToken !== this.loadToken) {
          resolve()
          return
        }
        if (this.tilePhase !== phase) {
          resolve()
          return
        }
        if (performance.now() - this.phaseStartTime >= duration) {
          resolve()
          return
        }
        // Token may have been bumped but phase may also have moved on;
        // check both. Bound the loop at 4x the expected duration as a
        // safety valve.
        if (performance.now() - start > duration * 4) {
          resolve()
          return
        }
        setTimeout(tick, 16)
      }
      tick()
    })
  }

  // ====================== Input handlers ======================

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
    this.targetTransform.rotationY = wrapAngle(
      this.targetTransform.rotationY + dx * 0.004
    )
    this.targetTransform.rotationX = clamp(
      this.targetTransform.rotationX + dy * 0.004,
      -MAX_ROT_X,
      MAX_ROT_X
    )
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
    const factor = 1 - delta * 0.0012
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
      this.targetTransform.rotationY = wrapAngle(
        this.targetTransform.rotationY + dx * 0.004
      )
      this.targetTransform.rotationX = clamp(
        this.targetTransform.rotationX + dy * 0.004,
        -MAX_ROT_X,
        MAX_ROT_X
      )
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
}

// ====================== Math helpers ======================

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 最短路径角度插值。对差值取模 2π，使插值始终走较短旋转方向。
 * 避免从 +π 到 -π 时穿过 0 (完整 360° 旋转) 而非跨越边界的微小步进。
 */
function lerpAngle(a: number, b: number, t: number): number {
  const TWO_PI = 2 * Math.PI
  let diff = ((b - a) % TWO_PI + TWO_PI) % TWO_PI
  if (diff > Math.PI) diff -= TWO_PI
  return a + diff * t
}

function easeOutCubic(t: number): number {
  const inv = 1 - t
  return 1 - inv * inv * inv
}

/**
 * 将角度归一化到 [-π, π]，使穹顶可自由水平旋转而不累积浮点漂移。
 * 早期实现使用 `range * 2` (4π) 作为步长，在值跨越 ±π 边界时产生死循环
 * — 这是拖拽球幕背面到正面时"跳回"bug 的根因。
 */
function wrapAngle(v: number): number {
  const TWO_PI = 2 * Math.PI
  return ((v + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI
}
