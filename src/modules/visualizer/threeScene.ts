/**
 * Three.js 可视化场景管理器
 * 管理 Three.js 场景生命周期、渲染循环、预设切换。
 * 内置预设：封面粒子(cover)、封面球幕(tiles)、音频律动(reactive)、封面透镜(lens)、核璇(crystalBloom)、雾扰(nuage)
 */

import * as THREE from 'three'
import type { AudioSpectrumData } from './audioAnalyzer'
import { CoverParticleVisualizer } from './coverParticleVisualizer'
import { CoverTileGridVisualizer } from './coverTileGridVisualizer'
import { AudioReactiveParticlesVisualizer, type AudioReactiveShape } from './audioReactiveParticles'
import { CoverLensVisualizer } from './coverLensVisualizer'
import { CrystalBloomVisualizer } from './crystalBloomVisualizer'
import { AURORA_VERT, AURORA_FRAG } from './auroraShader'

export type { AudioReactiveShape }
export type PresetName = 'cover' | 'tiles' | 'reactive' | 'lens' | 'crystalBloom' | 'nuage'

export class VisualizerScene {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private animationId: number | null = null
  private container: HTMLElement | null = null
  private currentPreset: PresetName | null = null
  private clock = new THREE.Clock()
  private isRunning = false
  private quality: 'high' | 'medium' | 'low' = 'high'

  // ===== Idle frame-rate throttling =====
  // When music is paused, the render loop drops to a low frame rate (default
  // 5fps) to reduce GPU usage by ~92%. The Aurora shader is slow-moving FBM
  // noise, so 5fps looks nearly identical to 60fps. When music starts playing,
  // the throttle is cleared (0 = full speed). Camera movement (WASD keys)
  // temporarily bypasses the throttle for smooth interaction.
  private idleThrottleFps = 0          // 0 = no throttle (full 60fps)
  private idleThrottleInterval = 0     // milliseconds between frames when throttled
  private lastRenderTime = 0           // timestamp of last actual render

  // ===== Aurora background (merged from AuroraBackground.vue) =====
  // 全屏 FBM 极光背景, 渲染在所有预设之前 (two-pass: aurora → visualizer)
  private auroraScene: THREE.Scene | null = null
  private auroraCamera: THREE.OrthographicCamera | null = null
  private auroraUniforms: Record<string, THREE.IUniform> = {}
  private auroraMouseX = 0.5
  private auroraMouseY = 0.5
  private auroraTargetMouseX = 0.5
  private auroraTargetMouseY = 0.5
  private auroraSmoothBass = 0
  private auroraBassValue = 0 // set externally via updateAuroraBass()
  // Aurora shader is now imported from auroraShader.ts (single source of truth)

  private static readonly AURORA_C_ICE = new THREE.Color(0x7ec8e3)
  private static readonly AURORA_C_WARM = new THREE.Color(0xe8a87c)
  private auroraColorCur = new THREE.Color()

// ===== Aurora custom colors (user-configurable) =====
// idleColor: shown when not playing (default: dark near-black with white tint)
// playingColor: shown when playing (default: extracted from album cover)
// When user sets custom colors via ControlPanel, these take priority.
// 'auto' mode: playingColor is null → fall back to cover-extracted color.
private auroraIdleColor: THREE.Color | null = null     // null = default dark
private auroraPlayingColor: THREE.Color | null = null  // null = auto (cover-derived)
private auroraCoverColor: THREE.Color = new THREE.Color(0x7ec8e3) // extracted from cover
private auroraHasCoverColor = false

// Aurora color callback — AuroraBackground.vue reads the computed accent color
// each frame via this callback. This avoids a second set of color logic.
private auroraColorCallback: ((r: number, g: number, b: number) => void) | null = null

setAuroraColorCallback(cb: ((r: number, g: number, b: number) => void) | null): void {
  this.auroraColorCallback = cb
}

  // 相机基准 Z 位置 — 切换预设或停止播放时重置相机到此位置
  private cameraBaseZ = 11.5

  // ===== Smooth camera movement (WASD + QE for full 3D) =====
  // Target position/rotation the camera eases towards every frame.
  // Keyboard sets targetVelocity; the animate loop integrates it.
  private cameraTargetPos = new THREE.Vector3(0, 0, 11.5)
  private cameraVelocity = new THREE.Vector3()
  // Keys currently held down — drives velocity each frame
  private heldKeys = new Set<string>()
  // Persistence key for localStorage
  private static readonly CAMERA_STORAGE_KEY = 'beatzfit-camera-offset'
  private cameraOffsetSaved = false

  // Cover particle visualizer is managed separately because it is async
  private coverVisualizer: CoverParticleVisualizer | null = null
  private currentCoverUrl: string | null = null
  // Load token for aurora cover color extraction — prevents race conditions
  // when setCover is called multiple times in quick succession (e.g. brand
  // poster → track cover). Only the latest call's result is applied.
  private auroraColorLoadToken = 0
  // Cover tile-grid visualizer (the "封面球幕" preset) — also async because
  // it loads and slices the cover image. Lives alongside coverVisualizer and
  // is mutually exclusive with it (only one is active at a time).
  private tileGridVisualizer: CoverTileGridVisualizer | null = null
  private reactiveVisualizer: AudioReactiveParticlesVisualizer | null = null
  private lensVisualizer: CoverLensVisualizer | null = null
  private crystalBloomVisualizer: CrystalBloomVisualizer | null = null
  private isPlaying = false
  private reactiveShape: AudioReactiveShape = 'box'
  private currentInteractionContainer: HTMLElement | null = null
  private onTransformChangeCallback: ((t: { rotationX: number; rotationY: number; scale: number }) => void) | null = null

  // ===== Nuage (雾扰) 独立交互处理器 =====
  // Nuage 预设没有可视化器对象, 无法复用各预设的 attachInteraction。
  // 这里维护一套独立的拖拽/缩放交互, 确保该主题下也能 3D 交互 (相机轨道)
  // 并消费 wheel 事件 (防止页面翻页导航)。
  private nuageDragContainer: HTMLElement | null = null
  private nuageIsDragging = false
  private nuageLastPX = 0
  private nuageLastPY = 0
  private nuageRotX = 0
  private nuageRotY = 0
  private nuageTargetRotX = 0
  private nuageTargetRotY = 0
  private nuageScale = 1.0
  private nuageTargetScale = 1.0
  private nuageBoundDown = (e: PointerEvent): void => {
    this.nuageIsDragging = true
    this.nuageLastPX = e.clientX
    this.nuageLastPY = e.clientY
  }
  private nuageBoundMove = (e: PointerEvent): void => {
    if (!this.nuageIsDragging) return
    const dx = e.clientX - this.nuageLastPX
    const dy = e.clientY - this.nuageLastPY
    this.nuageLastPX = e.clientX
    this.nuageLastPY = e.clientY
    this.nuageTargetRotY += dx * 0.005
    this.nuageTargetRotX += dy * 0.005
    this.nuageTargetRotX = Math.max(-0.8, Math.min(0.8, this.nuageTargetRotX))
    this.onTransformChangeCallback?.({ rotationX: this.nuageTargetRotX, rotationY: this.nuageTargetRotY, scale: this.nuageTargetScale })
  }
  private nuageBoundUp = (): void => { this.nuageIsDragging = false }
  private nuageBoundWheel = (e: WheelEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const delta = -e.deltaY * 0.0015
    this.nuageTargetScale = Math.max(0.5, Math.min(2.5, this.nuageTargetScale + delta))
    this.onTransformChangeCallback?.({ rotationX: this.nuageTargetRotX, rotationY: this.nuageTargetRotY, scale: this.nuageTargetScale })
  }
  private nuageBoundTouchStart = (e: TouchEvent): void => {
    if (!e.touches || !e.touches[0]) return
    e.preventDefault()
    this.nuageIsDragging = true
    this.nuageLastPX = e.touches[0].clientX
    this.nuageLastPY = e.touches[0].clientY
  }
  private nuageBoundTouchMove = (e: TouchEvent): void => {
    if (!this.nuageIsDragging || !e.touches || !e.touches[0]) return
    e.preventDefault()
    const dx = e.touches[0].clientX - this.nuageLastPX
    const dy = e.touches[0].clientY - this.nuageLastPY
    this.nuageLastPX = e.touches[0].clientX
    this.nuageLastPY = e.touches[0].clientY
    this.nuageTargetRotY += dx * 0.005
    this.nuageTargetRotX += dy * 0.005
    this.nuageTargetRotX = Math.max(-0.8, Math.min(0.8, this.nuageTargetRotX))
    this.onTransformChangeCallback?.({ rotationX: this.nuageTargetRotX, rotationY: this.nuageTargetRotY, scale: this.nuageTargetScale })
  }
  private nuageBoundTouchEnd = (): void => { this.nuageIsDragging = false }

  // ===== Visual DIY parameters (user-configurable from ControlPanel) =====
  private visualDiyParams = { scale: 1.0, particleDensity: 1.0, depth: 1.0, glow: 1.0 }
  private lastAppliedDensity = -1
  private originalOpacities = new WeakMap<THREE.Material, number>()

  /**
   * Set visual DIY parameters (scale, rotation speed, particle density, depth, glow).
   * Applied every frame in the animate loop.
   */
  setVisualDiy(params: { scale: number; particleDensity: number; depth: number; glow: number }): void {
    this.visualDiyParams = { ...params }
  }

  /**
   * 初始化极光背景场景 (全屏 FBM 着色器)
   */
  private initAurora(): void {
    if (!this.renderer) return

    this.auroraScene = new THREE.Scene()
    this.auroraCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.auroraUniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uBass: { value: 0 },
      uAccent: { value: new THREE.Color(0x7ec8e3) },
      uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    }

    const mat = new THREE.ShaderMaterial({
      uniforms: this.auroraUniforms,
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    mesh.frustumCulled = false
    this.auroraScene.add(mesh)
  }

  /**
   * 更新极光背景的音频数据 (外部调用)
   */
updateAuroraBass(bass: number): void {
this.auroraBassValue = bass
}

/**
 * Set custom Aurora idle (not-playing) color.
 * Pass null to reset to default (dark near-black).
 */
setAuroraIdleColor(hex: string | null): void {
  this.auroraIdleColor = hex ? new THREE.Color(hex) : null
}

/**
 * Set custom Aurora playing color.
 * Pass null for 'auto' mode (extract from album cover).
 */
setAuroraPlayingColor(hex: string | null): void {
  this.auroraPlayingColor = hex ? new THREE.Color(hex) : null
}

/**
 * Extract dominant color from cover image and apply to Aurora background.
 * Called automatically when setCover receives a valid URL.
 * Uses a load token to prevent race conditions when setCover is called
 * multiple times in quick succession.
 */
private async extractAuroraCoverColor(url: string): Promise<void> {
  const myToken = ++this.auroraColorLoadToken
  try {
    const color = await this.sampleDominantColor(url)
    // Discard if a newer setCover call has superseded this one
    if (myToken !== this.auroraColorLoadToken) return
    this.auroraCoverColor.copy(color)
    this.auroraHasCoverColor = true
  } catch (e) {
    if (myToken !== this.auroraColorLoadToken) return
    this.auroraHasCoverColor = false
    console.warn('[VisualizerScene] Aurora cover color extraction failed for:', url, e)
  }
}

private sampleDominantColor(url: string): Promise<THREE.Color> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No canvas context')); return }
      ctx.drawImage(img, 0, 0, 32, 32)
      const data = ctx.getImageData(0, 0, 32, 32).data
      let r = 0, g = 0, b = 0, count = 0
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2]
        if (pr + pg + pb > 90) {
          r += pr; g += pg; b += pb; count++
        }
      }
      if (count === 0) { reject(new Error('No usable colors')); return }
      resolve(new THREE.Color(r / count / 255, g / count / 255, b / count / 255))
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

  /**
   * 鼠标移动 → 极光着色器鼠标位置
   */
  private onAuroraMouseMove = (e: MouseEvent): void => {
    this.auroraTargetMouseX = e.clientX / window.innerWidth
    this.auroraTargetMouseY = 1 - e.clientY / window.innerHeight
  }

  /**
   * 每帧更新极光 uniforms
   */
  private updateAurora(t: number): void {
// Smooth mouse
this.auroraMouseX += (this.auroraTargetMouseX - this.auroraMouseX) * 0.05
this.auroraMouseY += (this.auroraTargetMouseY - this.auroraMouseY) * 0.05

// Smooth bass
this.auroraSmoothBass += (this.auroraBassValue - this.auroraSmoothBass) * 0.1

if (this.auroraUniforms.uTime) this.auroraUniforms.uTime.value = t
if (this.auroraUniforms.uMouse) {
(this.auroraUniforms.uMouse.value as THREE.Vector2).set(this.auroraMouseX, this.auroraMouseY)
}
if (this.auroraUniforms.uBass) this.auroraUniforms.uBass.value = this.auroraSmoothBass

// ── Color logic: blend between idle and playing colors ──
// Determine the effective idle and playing colors
const idleCol = this.auroraIdleColor ?? new THREE.Color(0xe8e8f0) // default: moon-white
const playingCol = this.auroraPlayingColor
  ?? (this.auroraHasCoverColor ? this.auroraCoverColor : VisualizerScene.AURORA_C_ICE)

// Blend based on smoothed bass (0 = idle, 1 = full playing)
this.auroraColorCur.copy(idleCol).lerp(playingCol, Math.min(1, this.auroraSmoothBass * 3))

if (this.auroraUniforms.uAccent) {
  (this.auroraUniforms.uAccent.value as THREE.Color).copy(this.auroraColorCur)
}

// Notify AuroraBackground.vue of the computed accent color
if (this.auroraColorCallback) {
  this.auroraColorCallback(this.auroraColorCur.r, this.auroraColorCur.g, this.auroraColorCur.b)
}
}

  /**
   * 在容器元素中初始化可视化场景
   */
  init(container: HTMLElement, quality: 'high' | 'medium' | 'low' = 'high'): boolean {
    try {
      this.container = container
      this.quality = quality

      // Renderer
      // MSAA is only enabled for high/medium quality. On low quality the
      // extra resolve cost outweighs the visual benefit on integrated GPUs,
      // and the lower DPR further reduces aliasing visibility.
      this.renderer = new THREE.WebGLRenderer({
        antialias: quality !== 'low',
        alpha: true, // Transparent canvas — enables reparenting into preserve-3d stages
        powerPreference: 'high-performance'
      })
      // Cap DPR based on quality. Low quality uses DPR=1 to minimise GPU
      // fill-rate; the presets still look acceptable at this resolution
      // because the background is viewed from a distance.
      const dpr = quality === 'high' ? Math.min(window.devicePixelRatio, 2)
                 : quality === 'medium' ? Math.min(window.devicePixelRatio, 1.5)
                 : 1.0
      this.renderer.setPixelRatio(dpr)
      this.renderer.setSize(window.innerWidth, window.innerHeight)
      // Transparent clear — .app-shell background (#050507) provides the dark base.
      // Canvas is reparented into stage elements; transparent areas show .app-shell.
      this.renderer.setClearColor(0x050507, 0)
      // P1: 与 R3F/drei 默认值对齐。歌词环预设依赖与教程相同的渲染器配置，
      // 因此显式设置每个标志而非依赖 three.js 版本相关的默认值
      // (r150 ~ r160 之间部分默认值发生了变化)。
      // 低画质跳过 ACES 色调映射以节省每帧 GPU 开销。
      this.renderer.toneMapping = quality === 'low' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.0
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      // r155+ 中 useLegacyLights 默认为 false, 显式设置以确保光照能量模型一致
      ;(this.renderer as unknown as { useLegacyLights: boolean }).useLegacyLights = false
      container.appendChild(this.renderer.domElement)

      // Scene
      this.scene = new THREE.Scene()

      // Camera
      this.camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        100
      )
      // 相机拉远以使整个 360° 歌词环保持在画面内
      // (环位于 z=6; 距离为 11.5 而非 4)
      this.camera.position.z = 11.5
      this.cameraBaseZ = 11.5
      // Restore any saved camera offset from a previous session
      this.restoreCameraOffset()
      if (this.cameraOffsetSaved) {
        this.camera.position.copy(this.cameraTargetPos)
      }

      // 监听窗口大小变化
      window.addEventListener('resize', this.handleResize)

      // 初始化极光背景 (合并自 AuroraBackground.vue)
      this.initAurora()
      // 鼠标追踪 (极光用)
      window.addEventListener('mousemove', this.onAuroraMouseMove)

      return true
    } catch (e) {
      console.error('Failed to init visualizer:', e)
      return false
    }
  }

  /**
   * 设置封面图片 URL，供封面相关预设 (cover / tiles / reactive / lens) 使用。
   * 当前激活的预设会立即加载新图片；之后切换到其他预设时会重新应用最近的 URL。
   */
  async setCover(url: string | null | undefined): Promise<void> {
    if (!url) {
      this.currentCoverUrl = null
      this.auroraHasCoverColor = false
      ++this.auroraColorLoadToken // invalidate any in-flight extraction
      if (this.currentPreset === 'cover' && this.coverVisualizer) {
        await this.coverVisualizer.loadCover('')
      } else if (this.currentPreset === 'tiles' && this.tileGridVisualizer) {
        await this.tileGridVisualizer.loadCover('')
      } else if (this.currentPreset === 'reactive' && this.reactiveVisualizer) {
        await this.reactiveVisualizer.loadCover('')
      } else if (this.currentPreset === 'lens' && this.lensVisualizer) {
        await this.lensVisualizer.loadCover('')
      } else if (this.currentPreset === 'crystalBloom' && this.crystalBloomVisualizer) {
        await this.crystalBloomVisualizer.loadCover('')
      }
      return
    }
    this.currentCoverUrl = url
    // Extract dominant color from cover for Aurora background.
    // This runs BEFORE the renderer/scene/camera check so that color
    // extraction always happens — even if the 3D renderer isn't ready yet
    // (e.g. during HMR re-initialization). The extracted color is stored
    // and will be used by updateAurora() once rendering starts.
    this.extractAuroraCoverColor(url).catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))
    if (!this.renderer || !this.scene || !this.camera) return
    if (this.currentPreset === 'cover') {
      await this.coverVisualizer?.loadCover(url)
    } else if (this.currentPreset === 'tiles') {
      await this.tileGridVisualizer?.loadCover(url)
    } else if (this.currentPreset === 'reactive') {
      await this.reactiveVisualizer?.loadCover(url)
    } else if (this.currentPreset === 'lens') {
      await this.lensVisualizer?.loadCover(url)
    } else if (this.currentPreset === 'crystalBloom') {
      await this.crystalBloomVisualizer?.loadCover(url)
    }
  }

  /**
   * 订阅封面可视化器的变换回调 (旋转、缩放)。
   * 播放页使用此回调驱动歌词区域的视差/缩放联动效果。
   */
  setOnTransformChange(cb: ((t: { rotationX: number; rotationY: number; scale: number }) => void) | null): void {
    this.onTransformChangeCallback = cb
  }

  /**
   * 绑定指针/滚轮/触摸监听到可视化容器，使用户可以拖拽旋转和滚轮缩放。
   * 容器必须允许指针事件 (CSS `pointer-events: auto`)。
   * 所有预设共享同一容器，切换预设时无需重新绑定。
   */
  attachInteraction(container: HTMLElement): void {
    // Detach from previous container first to avoid duplicate listeners
    this.detachInteraction()
    this.currentInteractionContainer = container
    this.coverVisualizer?.attachInteraction(container, (t) => {
      this.onTransformChangeCallback?.(t)
    })
    this.tileGridVisualizer?.attachInteraction(container, (t) => {
      this.onTransformChangeCallback?.(t)
    })
    this.reactiveVisualizer?.attachInteraction(container, (t) => {
      this.onTransformChangeCallback?.(t)
    })
    this.lensVisualizer?.attachInteraction(container, (t) => {
      this.onTransformChangeCallback?.(t)
    })
    this.crystalBloomVisualizer?.attachInteraction(container, (t) => {
      this.onTransformChangeCallback?.(t)
    })
    // Nuage 预设没有可视化器对象, 使用独立交互处理器
    if (this.currentPreset === 'nuage') {
      this.attachNuageInteraction(container)
    }
  }

  /**
   * 从当前容器移除所有交互监听器。调用后 3D 预设不再响应拖拽/滚轮。
   */
  detachInteraction(): void {
    this.coverVisualizer?.detachInteraction()
    this.tileGridVisualizer?.detachInteraction()
    this.reactiveVisualizer?.detachInteraction()
    this.lensVisualizer?.detachInteraction()
    this.crystalBloomVisualizer?.detachInteraction()
    this.detachNuageInteraction()
    this.currentInteractionContainer = null
  }

  /**
   * Nuage 独立交互: 拖拽旋转 + 滚轮缩放, 消费事件防止页面导航。
   */
  private attachNuageInteraction(container: HTMLElement): void {
    this.detachNuageInteraction()
    this.nuageDragContainer = container
    container.addEventListener('pointerdown', this.nuageBoundDown)
    container.addEventListener('pointermove', this.nuageBoundMove)
    container.addEventListener('pointerup', this.nuageBoundUp)
    container.addEventListener('pointercancel', this.nuageBoundUp)
    container.addEventListener('wheel', this.nuageBoundWheel, { passive: false })
    container.addEventListener('touchstart', this.nuageBoundTouchStart, { passive: false })
    container.addEventListener('touchmove', this.nuageBoundTouchMove, { passive: false })
    container.addEventListener('touchend', this.nuageBoundTouchEnd)
  }

  private detachNuageInteraction(): void {
    if (this.nuageDragContainer) {
      this.nuageDragContainer.removeEventListener('pointerdown', this.nuageBoundDown)
      this.nuageDragContainer.removeEventListener('pointermove', this.nuageBoundMove)
      this.nuageDragContainer.removeEventListener('pointerup', this.nuageBoundUp)
      this.nuageDragContainer.removeEventListener('pointercancel', this.nuageBoundUp)
      this.nuageDragContainer.removeEventListener('wheel', this.nuageBoundWheel)
      this.nuageDragContainer.removeEventListener('touchstart', this.nuageBoundTouchStart)
      this.nuageDragContainer.removeEventListener('touchmove', this.nuageBoundTouchMove)
      this.nuageDragContainer.removeEventListener('touchend', this.nuageBoundTouchEnd)
    }
    this.nuageDragContainer = null
  }

  /**
   * 获取底层 WebGL canvas 元素，供动态 reparent 场景使用。
   * 当需要将 canvas 移入页面的 3D stage 以实现真正的 CSS 3D 穿插时调用。
   */
  getCanvasElement(): HTMLCanvasElement | null {
    return this.renderer?.domElement ?? null
  }

  /**
   * 获取当前封面变换 (旋转 + 缩放)。无激活预设时返回 null。
   */
  getCoverTransform(): { rotationX: number; rotationY: number; scale: number } | null {
    return this.coverVisualizer?.getTransform()
      ?? this.tileGridVisualizer?.getTransform()
      ?? this.reactiveVisualizer?.getTransform()
      ?? this.lensVisualizer?.getTransform()
      ?? this.crystalBloomVisualizer?.getTransform()
      ?? (this.currentPreset === 'nuage' ? { rotationX: this.nuageRotX, rotationY: this.nuageRotY, scale: this.nuageScale } : null)
  }

  /**
   * 重置封面到默认角度/缩放。切换回封面预设时调用，避免继承上次的朝向。
   */
  resetCoverTransform(): void {
    this.coverVisualizer?.resetTransform()
    this.tileGridVisualizer?.resetTransform()
    this.reactiveVisualizer?.resetTransform()
    this.lensVisualizer?.resetTransform()
    this.crystalBloomVisualizer?.resetTransform()
    // 重置 Nuage 交互状态
    this.nuageTargetRotX = 0
    this.nuageTargetRotY = 0
    this.nuageTargetScale = 1.0
  }

  /**
   * 翻转封面球幕的正反面 (0° ↔ 180°)。仅在 'tiles' 预设激活时有效。
   * 返回翻转后的角度模式，若球幕不存在则返回 null。
   */
  flipDomeAngle(): 'front' | 'back' | null {
    return this.tileGridVisualizer?.flipAngle() ?? null
  }

  /**
   * 返回当前球幕角度模式，tiles 预设未激活时返回 null。
   */
  getDomeAngleMode(): 'front' | 'back' | null {
    return this.tileGridVisualizer?.getAngleMode() ?? null
  }

  /**
   * 按名称切换预设。支持 'cover' / 'tiles' / 'reactive' / 'lens' / 'crystalBloom' / 'nuage'。
   * 未知名称将被静默忽略，避免旧版本设置 (如 'galaxy'/'aurora') 导致崩溃。
   */
  switchPreset(name: PresetName): void {
    // 先解除 Nuage 独立交互 (若当前在 Nuage 预设), 避免新旧监听器并存
    this.detachNuageInteraction()
    // 恢复默认相机设置（FOV=60, z=11.5），清除上一预设可能留下的偏移
    // crystalBloom 预设会改为 FOV=75, z=5，切换离开时需恢复
    //
    // 关键：必须同步重置 cameraTargetPos 和 cameraVelocity，否则 animate
    // 循环中的 updateCameraSmooth 会将 camera.position lerp 回旧的
    // cameraTargetPos，导致相机距离错误 (如 crystalBloom 被拉回 z=11.5)。
    if (this.camera) {
      this.camera.fov = 60
      this.camera.updateProjectionMatrix()
      this.cameraBaseZ = 11.5
      this.camera.position.set(0, 0, this.cameraBaseZ)
      // 重置相机朝向 — Nuage 轨道交互通过 lookAt() 修改了 camera.rotation，
      // 切换到其他预设时若不重置，相机会从 (0,0,11.5) 位置以斜角看向原点，
      // 导致所有 3D 物体错位。必须同步重置 rotation。
      this.camera.rotation.set(0, 0, 0)
      this.cameraTargetPos.set(0, 0, this.cameraBaseZ)
      this.cameraVelocity.set(0, 0, 0)
      this.heldKeys.clear()
    }
    // 清除 localStorage 中保存的旧相机偏移 — 不同预设的 baseZ 不同，
    // 旧偏移对新预设无意义
    try { localStorage.removeItem(VisualizerScene.CAMERA_STORAGE_KEY) } catch (e) { /* ignore */ }

    if (name === 'cover') {
      this.switchToCoverPreset()
      return
    }
    if (name === 'tiles') {
      this.switchToTileGridPreset()
      return
    }
    if (name === 'reactive') {
      this.switchToReactivePreset()
      return
    }
    if (name === 'lens') {
      this.switchToLensPreset()
      return
    }
    if (name === 'crystalBloom') {
      this.switchToCrystalBloomPreset()
      return
    }
    if (name === 'nuage') {
      this.switchToNuagePreset()
      return
    }
    // 未知/过期的预设名称 — 忽略
  }

  private switchToCoverPreset(): void {
    // 释放其他预设
    this.tileGridVisualizer?.dispose()
    this.tileGridVisualizer = null
    this.reactiveVisualizer?.dispose()
    this.reactiveVisualizer = null
    this.crystalBloomVisualizer?.dispose()
    this.crystalBloomVisualizer = null

    // 清空场景对象
    if (this.scene) {
      while (this.scene.children.length > 0) {
        this.scene.children[0].removeFromParent()
      }
    }

    if (!this.renderer || !this.scene || !this.camera) return

    this.coverVisualizer = new CoverParticleVisualizer(
      this.scene,
      this.camera,
      this.renderer,
      { quality: this.quality === 'high' ? 'high' : this.quality === 'medium' ? 'medium' : 'low' }
    )

    // 重新绑定交互容器 (如果已存在)
    if (this.currentInteractionContainer) {
      this.coverVisualizer.attachInteraction(this.currentInteractionContainer, (t) => {
        this.onTransformChangeCallback?.(t)
      })
    }

    if (this.currentCoverUrl) {
      this.coverVisualizer.loadCover(this.currentCoverUrl).catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))
    } else {
      this.coverVisualizer.loadCover('').catch((e) => console.warn('[VisualizerScene] Cover load failed:', e)) // 无封面 — 场景保持空
    }

    this.currentPreset = 'cover'
    this.coverVisualizer?.setPlaying?.(this.isPlaying)
  }

  private switchToTileGridPreset(): void {
    // 释放其他预设
    this.coverVisualizer?.dispose()
    this.coverVisualizer = null
    this.reactiveVisualizer?.dispose()
    this.reactiveVisualizer = null
    this.crystalBloomVisualizer?.dispose()
    this.crystalBloomVisualizer = null

    // 清空场景对象
    if (this.scene) {
      while (this.scene.children.length > 0) {
        this.scene.children[0].removeFromParent()
      }
    }

    if (!this.renderer || !this.scene || !this.camera) return

    this.tileGridVisualizer = new CoverTileGridVisualizer(
      this.scene,
      this.camera,
      this.renderer,
      { quality: this.quality === 'high' ? 'high' : this.quality === 'medium' ? 'medium' : 'low' }
    )

    // 重新绑定交互容器 (如果已存在)，
    // 这样切换预设后拖拽/缩放无需页面重新调用 attachInteraction()
    if (this.currentInteractionContainer) {
      this.tileGridVisualizer.attachInteraction(this.currentInteractionContainer, (t) => {
        this.onTransformChangeCallback?.(t)
      })
    }

    if (this.currentCoverUrl) {
      this.tileGridVisualizer.loadCover(this.currentCoverUrl).catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))
    } else {
      this.tileGridVisualizer.loadCover('').catch((e) => console.warn('[VisualizerScene] Cover load failed:', e)) // 触发 fallback
    }

    this.currentPreset = 'tiles'
    this.tileGridVisualizer?.setPlaying?.(this.isPlaying)
  }

  private switchToReactivePreset(): void {
    // 释放其他预设
    this.coverVisualizer?.dispose()
    this.coverVisualizer = null
    this.tileGridVisualizer?.dispose()
    this.tileGridVisualizer = null
    this.crystalBloomVisualizer?.dispose()
    this.crystalBloomVisualizer = null

    // 清空场景对象
    if (this.scene) {
      while (this.scene.children.length > 0) {
        this.scene.children[0].removeFromParent()
      }
    }

    if (!this.renderer || !this.scene || !this.camera) return

    this.reactiveVisualizer = new AudioReactiveParticlesVisualizer(
      this.scene,
      this.camera,
      this.renderer,
      {
        quality: this.quality === 'high' ? 'high' : this.quality === 'medium' ? 'medium' : 'low',
        shape: this.reactiveShape
      }
    )

    // 重新绑定交互容器 (如果已存在)
    if (this.currentInteractionContainer) {
      this.reactiveVisualizer.attachInteraction(this.currentInteractionContainer, (t) => {
        this.onTransformChangeCallback?.(t)
      })
    }

    if (this.currentCoverUrl) {
      this.reactiveVisualizer.loadCover(this.currentCoverUrl).catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))
    } else {
      this.reactiveVisualizer.loadCover('').catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))
    }

    this.currentPreset = 'reactive'
    this.reactiveVisualizer?.setPlaying(this.isPlaying)
  }

  private switchToLensPreset(): void {
    // 释放其他预设
    this.coverVisualizer?.dispose()
    this.coverVisualizer = null
    this.tileGridVisualizer?.dispose()
    this.tileGridVisualizer = null
    this.reactiveVisualizer?.dispose()
    this.reactiveVisualizer = null
    this.crystalBloomVisualizer?.dispose()
    this.crystalBloomVisualizer = null

    // 清空场景对象
    if (this.scene) {
      while (this.scene.children.length > 0) {
        this.scene.children[0].removeFromParent()
      }
    }

    if (!this.renderer || !this.scene || !this.camera) return

    this.lensVisualizer = new CoverLensVisualizer(

      this.scene,
      this.camera,
      this.renderer,
      { quality: this.quality === 'high' ? 'high' : this.quality === 'medium' ? 'medium' : 'low' }
    )

    // 重新绑定交互容器 (如果已存在)
    if (this.currentInteractionContainer) {
      this.lensVisualizer.attachInteraction(this.currentInteractionContainer, (t) => {
        this.onTransformChangeCallback?.(t)
      })
    }

    if (this.currentCoverUrl) {
      this.lensVisualizer.loadCover(this.currentCoverUrl).catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))
    } else {
      this.lensVisualizer.loadCover('').catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))
    }

    this.currentPreset = 'lens'
    this.lensVisualizer?.setPlaying(this.isPlaying)
  }

  private switchToCrystalBloomPreset(): void {
    // 释放其他预设
    this.coverVisualizer?.dispose()
    this.coverVisualizer = null
    this.tileGridVisualizer?.dispose()
    this.tileGridVisualizer = null
    this.reactiveVisualizer?.dispose()
    this.reactiveVisualizer = null
    this.lensVisualizer?.dispose()
    this.lensVisualizer = null

    // 清空场景对象
    if (this.scene) {
      while (this.scene.children.length > 0) {
        this.scene.children[0].removeFromParent()
      }
    }

    if (!this.renderer || !this.scene || !this.camera) return

    // crystalBloom 预设：调整相机以匹配原始 demo（z=5, FOV=75）
    // 这样 group 可放在原点无缩放，世界空间坐标与原始完全一致
    // 同步重置 cameraTargetPos — 否则 updateCameraSmooth 会将相机
    // lerp 回 switchPreset 设置的 z=11.5，导致水晶球看起来很小
    this.camera.fov = 75
    this.camera.updateProjectionMatrix()
    this.cameraBaseZ = 5
    this.camera.position.set(0, 0, 5)
    this.cameraTargetPos.set(0, 0, 5)
    this.cameraVelocity.set(0, 0, 0)

    this.crystalBloomVisualizer = new CrystalBloomVisualizer(
      this.scene,
      this.camera,
      this.renderer,
      { quality: this.quality === 'high' ? 'high' : this.quality === 'medium' ? 'medium' : 'low' }
    )

    // 重新绑定交互容器 (如果已存在)
    if (this.currentInteractionContainer) {
      this.crystalBloomVisualizer.attachInteraction(this.currentInteractionContainer, (t) => {
        this.onTransformChangeCallback?.(t)
      })
    }

    // crystalBloom 不使用封面图片，但调用 loadCover 以保持接口一致
    this.crystalBloomVisualizer.loadCover(this.currentCoverUrl ?? '').catch((e) => console.warn('[VisualizerScene] Cover load failed:', e))

    this.currentPreset = 'crystalBloom'
    this.crystalBloomVisualizer?.setPlaying(this.isPlaying)
  }

  /**
   * 雾扰 (Nuage) 预设：空状态，不创建任何 3D 物体。
   * 场景保持空白，底层 Aurora 烟雾流体背景直接透出。
   * canvas 透明 (alpha:true)，渲染空场景 = 完全透明 → Aurora 可见。
   */
  private switchToNuagePreset(): void {
    // 释放所有其他预设
    this.coverVisualizer?.dispose()
    this.coverVisualizer = null
    this.tileGridVisualizer?.dispose()
    this.tileGridVisualizer = null
    this.reactiveVisualizer?.dispose()
    this.reactiveVisualizer = null
    this.lensVisualizer?.dispose()
    this.lensVisualizer = null
    this.crystalBloomVisualizer?.dispose()
    this.crystalBloomVisualizer = null

    // 清空场景对象 — 空场景，仅渲染透明背景
    if (this.scene) {
      while (this.scene.children.length > 0) {
        this.scene.children[0].removeFromParent()
      }
    }

    this.currentPreset = 'nuage'

    // 绑定独立交互 (拖拽旋转 + 滚轮缩放), 确保该主题也能 3D 交互
    if (this.currentInteractionContainer) {
      this.attachNuageInteraction(this.currentInteractionContainer)
    }
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing
    this.coverVisualizer?.setPlaying?.(playing)
    this.tileGridVisualizer?.setPlaying?.(playing)
    this.reactiveVisualizer?.setPlaying(playing)
    this.lensVisualizer?.setPlaying(playing)
    this.crystalBloomVisualizer?.setPlaying(playing)
    if (!playing && this.camera) {
      this.camera.position.set(0, 0, this.cameraBaseZ)
      this.cameraTargetPos.set(0, 0, this.cameraBaseZ)
      this.cameraVelocity.set(0, 0, 0)
    }
  }

  // ===== Smooth WASD camera control =====

  /**
   * Handle keydown for camera movement. Stores the key in a Set so the
   * animate loop can integrate velocity every frame for smooth motion.
   */
  cameraKeyDown(key: string): void {
    this.heldKeys.add(key.toLowerCase())
  }

  /**
   * Handle keyup — removes the key, stopping velocity accumulation.
   */
  cameraKeyUp(key: string): void {
    this.heldKeys.delete(key.toLowerCase())
  }

  /**
   * Per-frame camera update — called from the animate loop.
   * Integrates held-key velocity with exponential decay for smooth stop.
   */
  private updateCameraSmooth(dt: number): void {
    if (!this.camera) return

    // Build desired velocity from held keys (units per second)
    const speed = 12 // base movement speed
    const targetVel = new THREE.Vector3()

    // W/S = forward/backward (Z axis: W moves closer = -Z)
    if (this.heldKeys.has('w')) targetVel.z -= speed
    if (this.heldKeys.has('s')) targetVel.z += speed
    // A/D = left/right (X axis)
    if (this.heldKeys.has('a')) targetVel.x -= speed
    if (this.heldKeys.has('d')) targetVel.x += speed
    // Q/E = up/down (Y axis) for full 3D freedom
    if (this.heldKeys.has('q')) targetVel.y -= speed
    if (this.heldKeys.has('e')) targetVel.y += speed

    // Smoothly accelerate towards target velocity (damping)
    const damping = 1 - Math.pow(0.001, dt) // frame-rate independent lerp
    this.cameraVelocity.lerp(targetVel, damping)

    // Apply velocity to position
    this.cameraTargetPos.addScaledVector(this.cameraVelocity, dt)

    // Clamp to reasonable bounds
    this.cameraTargetPos.x = Math.max(-10, Math.min(10, this.cameraTargetPos.x))
    this.cameraTargetPos.y = Math.max(-8, Math.min(8, this.cameraTargetPos.y))
    this.cameraTargetPos.z = Math.max(2, Math.min(30, this.cameraTargetPos.z))

    // Smoothly move actual camera position towards target
    const posLerp = 1 - Math.pow(0.0001, dt)
    this.camera.position.lerp(this.cameraTargetPos, posLerp)
  }

  /**
   * Reset camera to default position. Also clears saved offset.
   */
  resetCameraPosition(): void {
    this.cameraTargetPos.set(0, 0, this.cameraBaseZ)
    this.cameraVelocity.set(0, 0, 0)
    this.heldKeys.clear()
    if (this.camera) {
      this.camera.position.set(0, 0, this.cameraBaseZ)
      // 重置相机朝向 — 与 switchPreset 保持一致，避免 Nuage 轨道交互
      // 通过 lookAt() 修改的 rotation 残留
      this.camera.rotation.set(0, 0, 0)
    }
    // Clear saved offset from localStorage
    try { localStorage.removeItem(VisualizerScene.CAMERA_STORAGE_KEY) } catch (e) { console.warn('[threeScene] Failed to remove camera offset from localStorage:', e) }
  }

  /**
   * Save the current camera offset (relative to base) to localStorage.
   */
  private saveCameraOffset(): void {
    if (!this.camera) return
    try {
      const data = {
        x: this.cameraTargetPos.x,
        y: this.cameraTargetPos.y,
        z: this.cameraTargetPos.z,
      }
      localStorage.setItem(VisualizerScene.CAMERA_STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.warn('[threeScene] Failed to save camera offset to localStorage:', e)
    }
  }

  /**
   * Restore saved camera offset from localStorage. Called during init.
   */
  private restoreCameraOffset(): void {
    try {
      const raw = localStorage.getItem(VisualizerScene.CAMERA_STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        if (typeof data.x === 'number' && typeof data.y === 'number' && typeof data.z === 'number') {
          this.cameraTargetPos.set(data.x, data.y, data.z)
          this.cameraOffsetSaved = true
        }
      }
    } catch (e) {
      console.warn('[threeScene] Failed to restore camera offset from localStorage:', e)
    }
  }

  /**
   * Check if camera has been moved from its default position.
   */
  isCameraAtDefault(): boolean {
    return Math.abs(this.cameraTargetPos.x) < 0.01 &&
           Math.abs(this.cameraTargetPos.y) < 0.01 &&
           Math.abs(this.cameraTargetPos.z - this.cameraBaseZ) < 0.01
  }
  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.clock.start()
    this.animate()
  }

  /**
   * 停止渲染循环
   */
  stop(): void {
    this.isRunning = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /**
   * Set the render quality level dynamically.
   * Updates pixel ratio and tone mapping to adjust GPU load.
   * (antialias can't be changed after renderer creation — only affects new scenes)
   */
  setQuality(quality: 'high' | 'medium' | 'low'): void {
    if (this.quality === quality) return
    this.quality = quality
    if (!this.renderer) return
    const dpr = quality === 'high' ? Math.min(window.devicePixelRatio, 2)
               : quality === 'medium' ? Math.min(window.devicePixelRatio, 1.5)
               : 1.0
    this.renderer.setPixelRatio(dpr)
    this.renderer.toneMapping = quality === 'low' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    // Trigger a resize to apply the new DPR
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    console.log('[VisualizerScene] Quality set to', quality, 'DPR:', dpr)
  }

  /**
   *
   * When music is paused, call setIdleThrottle(5) to reduce the render loop
   * to ~5fps — cutting GPU usage by ~92% while keeping the Aurora background
   * alive (it's slow-moving FBM noise, visually identical at 5fps).
   *
   * When music starts playing, call setIdleThrottle(0) to restore full 60fps.
   *
   * @param fps  0 = full speed (no throttle); >0 = target fps when idle
   */
  setIdleThrottle(fps: number): void {
    this.idleThrottleFps = fps > 0 ? fps : 0
    this.idleThrottleInterval = fps > 0 ? 1000 / fps : 0
    this.lastRenderTime = performance.now() // reset so the next frame renders immediately
  }

  /**
   * 更新频谱数据 (由音频分析器每帧调用)
   */
  private lastSpectrumData: AudioSpectrumData = {
    bass: 0, mid: 0, treble: 0, volume: 0, beat: 0,
    rawFrequencies: new Uint8Array(),
    lowFreq: 0, midLowFreq: 0, midHighFreq: 0, highFreq: 0,
    rmsTimeDomain: 0, burstIntensity: 0, subBassTremor: 0,
    subBass: 0, lowMid: 0, highMid: 0, presence: 0,
    spectralFlux: 0, spectralCentroid: 0,
    onset: 0, drumOnset: 0, musicalOnset: 0, beatStrength: 0,
    tempo: 0, tempoConfidence: 0,
    subBassPunch: 0, kickPunch: 0, bassTransient: 0,
  }

  updateSpectrum(data: AudioSpectrumData): void {
    this.lastSpectrumData = data
  }

  /**
   * 渲染循环。两路渲染: 极光背景 → 可视化器预设。
   */
  private animate = (): void => {
    if (!this.isRunning) return

    // ===== Idle frame-rate throttling =====
    // When music is paused (idleThrottleFps > 0), skip rendering unless enough
    // time has passed since the last frame. This reduces GPU usage by ~92%
    // while keeping the Aurora background alive.
    // Camera movement (WASD keys) bypasses the throttle for smooth interaction.
    const now = performance.now()
    if (this.idleThrottleFps > 0 && this.heldKeys.size === 0) {
      if (now - this.lastRenderTime < this.idleThrottleInterval) {
        this.animationId = requestAnimationFrame(this.animate)
        return
      }
      this.lastRenderTime = now
    }

    // Smooth camera movement — integrate velocity from held WASD/QE keys
    const dt = Math.min(this.clock.getDelta(), 0.1)
    this.updateCameraSmooth(dt)

    // Save camera offset periodically (every ~2s when keys are held)
    if (this.heldKeys.size > 0) {
      this.saveCameraOffset()
    }

    const t = now * 0.001

// ── Pass 1: 极光背景 — SKIPPED (aurora rendered by AuroraBackground.vue) ──
// Still update aurora uniforms + color callback so AuroraBackground gets the
// correct accent color (idle/playing/cover-derived).
this.updateAurora(t)
if (this.renderer) {
  this.renderer.autoClear = false
  this.renderer.clear()
}

    // 驱动激活的可视化器。注意: 不传递 dt — 每个可视化器有自己的 THREE.Clock
    // 并独立调用 getDelta()。
    if (this.currentPreset === 'cover') {
      this.coverVisualizer?.update(this.lastSpectrumData)
    } else if (this.currentPreset === 'tiles') {
      this.tileGridVisualizer?.update(this.lastSpectrumData)
    } else if (this.currentPreset === 'reactive') {
      this.reactiveVisualizer?.update(this.lastSpectrumData)
    } else if (this.currentPreset === 'lens') {
      this.lensVisualizer?.update(this.lastSpectrumData)
    } else if (this.currentPreset === 'crystalBloom') {
      this.crystalBloomVisualizer?.update(this.lastSpectrumData)
    }

    // ── Nuage 交互: 平滑阻尼 + 相机轨道 ──
    // 即使无 3D 物体, 相机轨道赋予空间控制感, 且事件已被消费
    if (this.currentPreset === 'nuage' && this.camera) {
      // 平滑插值
      this.nuageRotX += (this.nuageTargetRotX - this.nuageRotX) * 0.12
      this.nuageRotY += (this.nuageTargetRotY - this.nuageRotY) * 0.12
      this.nuageScale += (this.nuageTargetScale - this.nuageScale) * 0.12
      // 轨道相机: 围绕原点旋转
      const r = this.cameraBaseZ / this.nuageScale
      this.camera.position.x = Math.sin(this.nuageRotY) * r
      this.camera.position.y = Math.sin(this.nuageRotX) * r
      this.camera.position.z = Math.cos(this.nuageRotY) * Math.cos(this.nuageRotX) * r
      this.camera.lookAt(0, 0, 0)
    }

    // ── Apply Visual DIY parameters ──
    const diy = this.visualDiyParams
    if (this.scene) {
      // Scale: uniform multiplier on the entire scene
      this.scene.scale.setScalar(diy.scale)
      // Particle density: adjust material opacity (only when value changes)
      if (Math.abs(diy.particleDensity - this.lastAppliedDensity) > 0.01) {
        this.lastAppliedDensity = diy.particleDensity
        this.scene.traverse((obj) => {
          if (obj instanceof THREE.Points) {
            const mat = obj.material as THREE.Material & { opacity: number; transparent: boolean }
            if (mat) {
              if (!this.originalOpacities.has(mat)) {
                this.originalOpacities.set(mat, mat.opacity ?? 1)
              }
              const orig = this.originalOpacities.get(mat) ?? 1
              mat.opacity = Math.max(0, Math.min(1, orig * diy.particleDensity))
              mat.transparent = true
            }
          }
        })
      }
    }
    // Depth: adjust camera FOV (higher depth = wider FOV = more perspective distortion)
    if (this.camera) {
      const targetFov = 55 + (diy.depth - 1) * 20
      if (Math.abs(this.camera.fov - targetFov) > 0.1) {
        this.camera.fov = targetFov
        this.camera.updateProjectionMatrix()
      }
    }
    // Glow: adjust tone mapping exposure (0 → dim, 1 → normal, 2 → bright)
    if (this.renderer) {
      const targetExposure = 0.4 + diy.glow * 0.6
      if (Math.abs(this.renderer.toneMappingExposure - targetExposure) > 0.01) {
        this.renderer.toneMappingExposure = targetExposure
      }
    }

    // ── Pass 2: 可视化器预设 (透视相机) ──
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera)
    }

    this.animationId = requestAnimationFrame(this.animate)
  }

  /**
   * 公开 resize 入口 — reparentCanvas 后由 useGlobalVisualizer 调用,
   * 确保渲染器大小和相机宽高比与视口同步。
   */
  resize(): void {
    this.handleResize()
  }

  /**
   * 处理容器大小变化
   * 始终使用 window 尺寸 — canvas CSS 为视口大小 (100vw × 100vh
   * 或视口大小容器的 100%), 渲染器 buffer 必须匹配以防止
   * 在非视口大小容器页面 (如 DataPage) 上宽高比拉伸。
   */
  private handleResize = (): void => {
    if (!this.container || !this.renderer || !this.camera) return

    const w = window.innerWidth
    const h = window.innerHeight

    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.coverVisualizer?.resize()
    this.tileGridVisualizer?.resize()
    this.reactiveVisualizer?.resize()
    this.lensVisualizer?.resize()
    this.crystalBloomVisualizer?.resize()

    // 极光背景分辨率同步
    if (this.auroraUniforms.uRes) {
      (this.auroraUniforms.uRes.value as THREE.Vector2).set(window.innerWidth, window.innerHeight)
    }
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    this.stop()

    this.coverVisualizer?.dispose()
    this.coverVisualizer = null
    this.tileGridVisualizer?.dispose()
    this.tileGridVisualizer = null
    this.reactiveVisualizer?.dispose()
    this.reactiveVisualizer = null
    this.lensVisualizer?.dispose()
    this.lensVisualizer = null
    this.crystalBloomVisualizer?.dispose()
    this.crystalBloomVisualizer = null
    this.onTransformChangeCallback = null
    this.detachNuageInteraction()
    this.currentInteractionContainer = null

    // 极光背景清理
    window.removeEventListener('mousemove', this.onAuroraMouseMove)
    this.auroraScene = null
    this.auroraCamera = null
    this.auroraUniforms = {}

    window.removeEventListener('resize', this.handleResize)

    if (this.renderer) {
      this.renderer.dispose()
      if (this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
      }
      this.renderer = null
    }

    this.scene = null
    this.camera = null
    this.currentPreset = null
  }
}

