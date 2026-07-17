/**
 * RecordShelfVisualizer
 *
 * 3D 唱片架可视化器 — 将专辑封面渲染为 3D 空间中的薄盒（唱片），
 * 以约 62° 侧角水平排列在有界传送带上，缓慢向右自动滚动。
 *
 * ★ 虚拟滚动 + 大库优化 (2026-07-12):
 * - 仅创建视口内可见的唱片 (~20 个)，而非全部 500+ 个
 * - 滚动时动态创建/销毁唱片，销毁的纹理进入缓存供复用
 * - 有界滚动：第一首前禁止左滑，最后一首后停止
 * - 纹理缓存：URL → THREE.Texture，避免重复 canvas 绘制
 * - 离主线程解码：createImageBitmap 替代 ImageLoader，解码不阻塞 UI
 * - 方向感知预取：根据滚动方向/速度动态调整缓冲区，预加载前方封面
 * - 彩色占位纹理：8 种渐变色替代黑胶占位，滚动时用户不再看到"黑卡"
 * - 大缓存：纹理缓存 200 张 + 图片缓存 300 张，支持万首库流畅滚动
 *
 * 交互：
 * - 悬停：唱片翻转一周 → 旋转至正面 0° → 抽出到中心区域放大显示（GSAP timeline）
 * - 左键点击：触发 onSelect 回调（播放）
 * - 右键点击：触发 onContext 回调（上下文菜单）
 * - 鼠标拖拽：手动滑动唱片架（有界，到边界停止）
 * - 鼠标移出唱片区域 → 自动收回
 *
 * 性能优化：
 * - 虚拟滚动：仅 ~20 个活跃 Mesh（vs 500+），GPU/CPU 开销降低 96%
 * - 纹理缓存：60 个 CanvasTexture 缓存，记录重建时 O(1) 复用
 * - 悬停检测仅在 mousemove 事件中执行，不再每帧 raycast
 * - 已悬停时使用屏幕空间包围盒做 sticky 检测，避免误收回
 * - 所有材质使用 MeshBasicMaterial（无光照计算），移除场景光源
 * - needsRender 标志：仅在场景变化时渲染，空闲时不调用 renderer.render()
 * - 透明度变化检测：仅在值实际改变时写入 material.opacity
 * - 边框渐变纹理全局共享，每首歌曲不重复创建
 * - 页面隐藏时暂停渲染（visibilitychange）
 * - 临时向量预分配，避免 GC 压力
 */

import * as THREE from 'three'
import gsap from 'gsap'
import type { Track } from '@/types'
import { useSfx } from '@/composables/useSfx'

// ── Constants ──────────────────────────────────────────────

const RECORD_W = 1.5
const RECORD_H = 2.25 // 2:3 aspect ratio
const RECORD_D = 0.05

/** 唱片间距 — 负值让唱片略微重叠, 防止鼠标移到空白处
 *  增大重叠量 (-0.25) 使唱片更紧凑, 更容易区分唱片交互区与 3D 交互区 */
const DEFAULT_SPACING = -0.25

/** 侧角弧度 — 约 62°, 可看到约 47% 的封面 */
const ANGLE_RAD = 62 * Math.PI / 180

/** 自动滚动速度 (units/second) */
const SCROLL_SPEED = 0.35

/** 当前播放曲目缩放 */
const CURRENT_SCALE = 1.05

/** 透明度衰减起始/结束距离 (距中心 |x|) */
const FADE_START = 3.5
const FADE_END = 5.5

/** fallback 纹理画布尺寸 */
const FALLBACK_W = 512
const FALLBACK_H = 768

/** 彩色占位纹理调色板 — 基于曲目标题哈希分配，避免"黑卡" */
const PLACEHOLDER_COLORS: Array<{ bottom: string; top: string }> = [
  { bottom: '#1a3a5c', top: '#2d6a9f' }, // blue
  { bottom: '#3a1a5c', top: '#6a2d9f' }, // purple
  { bottom: '#5c1a3a', top: '#9f2d6a' }, // pink
  { bottom: '#5c3a1a', top: '#9f6a2d' }, // orange
  { bottom: '#1a5c3a', top: '#2d9f6a' }, // green
  { bottom: '#3a5c1a', top: '#6a9f2d' }, // lime
  { bottom: '#1a2a5c', top: '#2d4a9f' }, // indigo
  { bottom: '#5c2a1a', top: '#9f4a2d' }, // brown
]

/** 拖拽阈值 (px) — 超过此距离视为拖拽而非点击
 *  降低阈值 (3px) 使拖拽响应更快 */
const DRAG_THRESHOLD = 3

/** 拖拽灵敏度 — px → world units
 *  提高灵敏度 (0.012) 使拖拽更跟手 */
const DRAG_SENSITIVITY = 0.012

/** 悬停动画参数 — 缩短持续时间使交互更跟手 */
const FLIP_DURATION = 0.35
const EXTRACT_Z = 1.2
const EXTRACT_SCALE = 1.6
const EXTRACT_DURATION = 0.25

// ── Types ──────────────────────────────────────────────────

interface RecordEntry {
  group: THREE.Group
  mesh: THREE.Mesh
  coverMaterial: THREE.MeshBasicMaterial
  edgeGradientMaterial: THREE.MeshBasicMaterial
  edgeDarkMaterial: THREE.MeshBasicMaterial
  backMaterial: THREE.MeshBasicMaterial
  /** 所有材质引用，用于批量设置 opacity */
  allMaterials: THREE.MeshBasicMaterial[]
  trackId: string
  trackIndex: number
  isHovered: boolean
  textureLoaded: boolean
  lastOpacity: number
  source: 'local' | 'netease'
}

// ── Shared Resources ───────────────────────────────────────

/** 创建边框渐变纹理（垂直方向：底部饱和色 → 顶部浅色）
 *  高分辨率，渐变沿唱片高度方向，质感更细腻 */
function createEdgeGradientTexture(source: 'local' | 'netease'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 256, 0, 0) // bottom → top
  if (source === 'local') {
    grad.addColorStop(0, '#2a6dd6')    // 深蓝
    grad.addColorStop(0.3, '#5a9aee')  // 中蓝
    grad.addColorStop(0.7, '#a8ccf5')  // 浅蓝白
    grad.addColorStop(1, '#e8f2ff')    // 近白
  } else {
    grad.addColorStop(0, '#d63850')    // 深红
    grad.addColorStop(0.3, '#ee6a7a')  // 中红
    grad.addColorStop(0.7, '#f5b0b8')  // 浅红白
    grad.addColorStop(1, '#ffe8ea')    // 近白
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 16, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  return texture
}

// ── Module-level image cache (shared across instances + preloading) ──

/** 模块级图片缓存：URL → HTMLImageElement | ImageBitmap。
 *  在 RecordShelfVisualizer 实例创建前就可预加载封面。
 *  实例创建后直接从此缓存读取，实现 0 延迟封面显示。
 *  使用 createImageBitmap 离主线程解码，不阻塞 UI。 */
const sharedImageCache = new Map<string, HTMLImageElement | ImageBitmap>()
const SHARED_IMAGE_CACHE_MAX = 300

/**
 * 预加载封面图片到模块级缓存（离主线程解码）。
 * 在应用启动后、用户进入音乐页之前调用，让封面提前加载完毕。
 * 当 RecordShelfVisualizer 实例创建时，直接从缓存读取，0 延迟显示。
 *
 * 使用 fetch → blob → createImageBitmap 替代 new Image()，
 * createImageBitmap 在 Chromium 中离主线程解码图片，不阻塞 UI。
 *
 * @param urls 封面 URL 列表
 * @param maxCount 最多预加载前 N 张（默认 40）
 */
export function preloadCoverImages(urls: string[], maxCount = 40): void {
  const toLoad = urls.slice(0, maxCount)
  let activeLoads = 0
  const MAX_CONCURRENT = 8
  const queue: string[] = []

  async function loadOne(url: string): Promise<void> {
    try {
      const response = await fetch(url)
      if (!response.ok) return
      const blob = await response.blob()
      // createImageBitmap decodes the image OFF the main thread
      const bitmap = await createImageBitmap(blob)

      // Evict oldest entry if cache is full
      if (sharedImageCache.size >= SHARED_IMAGE_CACHE_MAX) {
        const oldest = sharedImageCache.keys().next().value
        if (oldest) {
          const oldVal = sharedImageCache.get(oldest)
          if (oldVal instanceof ImageBitmap) oldVal.close()
          sharedImageCache.delete(oldest)
        }
      }
      sharedImageCache.set(url, bitmap)
    } catch {
      // Fallback: try Image element if createImageBitmap fails
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('image load failed'))
          img.src = url
        })
        if (sharedImageCache.size >= SHARED_IMAGE_CACHE_MAX) {
          const oldest = sharedImageCache.keys().next().value
          if (oldest) {
            const oldVal = sharedImageCache.get(oldest)
            if (oldVal instanceof ImageBitmap) oldVal.close()
            sharedImageCache.delete(oldest)
          }
        }
        sharedImageCache.set(url, img)
      } catch {
        // Both methods failed — skip this cover
      }
    }
  }

  function processQueue() {
    while (activeLoads < MAX_CONCURRENT && queue.length > 0) {
      const url = queue.shift()!
      activeLoads++
      loadOne(url).finally(() => {
        activeLoads--
        processQueue()
      })
    }
  }

  for (const url of toLoad) {
    if (!sharedImageCache.has(url)) {
      queue.push(url)
    }
  }
  processQueue()
}

// ── Main Class ─────────────────────────────────────────────

export class RecordShelfVisualizer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private container: HTMLElement

  private shelfGroup: THREE.Group
  /** 活跃记录 — 虚拟滚动窗口，仅包含当前可见 ± buffer 的记录 */
  private activeRecords = new Map<number, RecordEntry>()

  private geometry: THREE.BoxGeometry

  private raycaster: THREE.Raycaster
  private mouseNDC: THREE.Vector2
  /** 当前悬停的 track index（-1 = 无悬停） */
  private hoveredTrackIndex = -1
  private currentTrackId: string | null = null

  private animationId: number | null = null
  private clock = new THREE.Clock()
  private scrollOffset = 0
  private lastScrollOffset = 0
  private scrollDirection = 0  // 1 = right, -1 = left, 0 = idle
  private scrollVelocity = 0   // units per second
  private isPaused = false
  private disposed = false

  /** 唱片间距 (可动态调整, 允许负值让唱片微微重叠) */
  private spacing = DEFAULT_SPACING

  /** 当前 unit = RECORD_W + spacing */
  private get unit(): number { return RECORD_W + this.spacing }

  // ── Virtual scrolling bounds ──
  private minScrollOffset = 0
  private maxScrollOffset = 0

  // ── Drag state ──
  private isDragging = false
  private dragStartX = 0
  private dragStartScroll = 0
  private dragMoved = false

  // ── Hover animation ──
  private hoverTimeline: gsap.core.Timeline | null = null
  /** 正在进行的收回动画计数，用于 needsRender 判断 */
private unhoverAnimatingCount = 0
/** 正在收回的唱片索引, 防止 checkHover 在收回过程中重新 hover */
private retractingTrackIndex = -1
/** 点击动画是否进行中 (防止重复触发) */
private isClickAnimating = false
/** 正在点击动画的唱片索引, 渲染循环跳过其 position 更新 */
private clickAnimatingTrackIndex = -1

  private selectCallback: ((trackId: string) => void) | null = null
  private contextCallback: ((trackId: string, x: number, y: number) => void) | null = null

  // ── SFX ──
  private sfx = useSfx()
  private lastShelfFocusIdx = -1

  private coverUrlFn: ((t: Track) => string | undefined) | null = null
  private tracks: Track[] = []

  // ── Image cache: URL → HTMLImageElement | ImageBitmap (reused across setTracks calls) ──
  private imageCache = sharedImageCache // Use module-level shared cache
  private readonly IMAGE_CACHE_MAX = SHARED_IMAGE_CACHE_MAX

  // ── Texture cache: URL → THREE.CanvasTexture (reused when records are re-created) ──
  /** 当记录被销毁时，其封面纹理移入此缓存而非 dispose。
   *  当记录被重新创建时（虚拟滚动滑回），从缓存 O(1) 取回，无需重新 canvas 绘制。 */
  private textureCache = new Map<string, THREE.Texture>()
  private readonly TEXTURE_CACHE_MAX = 200

  // ── Concurrency limiter: max simultaneous image loads ──
  private activeLoads = 0
  private readonly MAX_CONCURRENT_LOADS = 8
  private loadQueue: Array<() => void> = []

  // ── Shared gradient textures ──
  private edgeGradientLocal: THREE.CanvasTexture
  private edgeGradientNetease: THREE.CanvasTexture

  // ── Pre-rendered colored placeholder textures — 8 gradient variants ──
  // Assigned by track title hash. No canvas operations during scrolling.
  private placeholderTextures: THREE.CanvasTexture[] = []

  // ── Virtual scrolling: extra records beyond visible area ──
  private readonly VIRTUAL_BUFFER = 5

  // ── Pre-allocated temp vectors (avoid GC) ──
  private _tmpVec3 = new THREE.Vector3()

  // ── Render optimization ──
  private _needsRender = true
  private _pageVisible = true

  private boundMouseMove: (e: MouseEvent) => void
  private boundClick: (e: MouseEvent) => void
  private boundContextMenu: (e: MouseEvent) => void
  private boundMouseLeave: () => void
  private boundResize: () => void
  private boundPointerDown: (e: PointerEvent) => void
  private boundPointerMove: (e: PointerEvent) => void
  private boundPointerUp: (e: PointerEvent) => void
  private boundVisibilityChange: () => void
  private boundWheel: (e: WheelEvent) => void
  private scrollProxy = { v: 0 }

  constructor(container: HTMLElement) {
    this.container = container
    this.raycaster = new THREE.Raycaster()
    this.mouseNDC = new THREE.Vector2(-2, -2)

    // Create shared gradient textures
    this.edgeGradientLocal = createEdgeGradientTexture('local')
    this.edgeGradientNetease = createEdgeGradientTexture('netease')

    // Pre-render colored placeholder textures (8 variants)
    this.initPlaceholderTextures()

    this.geometry = new THREE.BoxGeometry(RECORD_W, RECORD_H, RECORD_D)

    this.scene = new THREE.Scene()

    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100)
    this.camera.position.set(0, 0.3, 8)
    this.camera.lookAt(0, 0, 0)

    this.shelfGroup = new THREE.Group()
    this.scene.add(this.shelfGroup)

    // No lights needed — all materials are MeshBasicMaterial (unlit)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    const canvas = this.renderer.domElement
    canvas.classList.add('record-shelf-canvas')
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.pointerEvents = 'none' // canvas 不接收事件, 事件由 container (stage) 处理
    canvas.style.zIndex = '1'
    canvas.style.touchAction = 'none'
    container.appendChild(canvas)

    this.boundMouseMove = this.onMouseMove.bind(this)
    this.boundClick = this.onClick.bind(this)
    this.boundContextMenu = this.onContextMenu.bind(this)
    this.boundMouseLeave = this.onMouseLeave.bind(this)
    this.boundResize = this.onResize.bind(this)
    this.boundPointerDown = this.onPointerDown.bind(this)
    this.boundPointerMove = this.onPointerMove.bind(this)
    this.boundPointerUp = this.onPointerUp.bind(this)
    this.boundVisibilityChange = this.onVisibilityChange.bind(this)
    this.boundWheel = this.onWheel.bind(this)
    // 事件绑定到 container (stage) 而非 canvas
    // canvas pointer-events: none, 不拦截事件
    // stage 上的 RecordShelfVisualizer 处理器先于 visualizer 处理器注册
    // 用 stopImmediatePropagation() 阻止 visualizer 的同元素处理器
    container.addEventListener('mousemove', this.boundMouseMove)
    container.addEventListener('click', this.boundClick)
    container.addEventListener('contextmenu', this.boundContextMenu)
    container.addEventListener('mouseleave', this.boundMouseLeave)
    container.addEventListener('pointerdown', this.boundPointerDown)
    container.addEventListener('wheel', this.boundWheel, { passive: false })
    window.addEventListener('pointermove', this.boundPointerMove)
    window.addEventListener('pointerup', this.boundPointerUp)
    window.addEventListener('resize', this.boundResize)
    document.addEventListener('visibilitychange', this.boundVisibilityChange)

    this.startLoop()
  }

  // ── Public API ────────────────────────────────────────────

  setTracks(tracks: Track[], coverUrlFn: (t: Track) => string | undefined): void {
    this.tracks = tracks
    this.coverUrlFn = coverUrlFn
    this.scrollOffset = 0
    this.lastScrollOffset = 0
    this.scrollDirection = 0
    this.scrollVelocity = 0
    this.setHoveredTrackIndex(-1)
    this.isPaused = false
    this.clearActiveRecords()
    this.updateScrollBounds()
    // Virtual scrolling: records are created lazily in update()
    this._needsRender = true
  }

  getTracks(): Track[] {
    return this.tracks
  }

  /** 设置唱片间距 (越小显示越多, 允许负值让唱片微微重叠) */
  setSpacing(spacing: number): void {
    this.spacing = Math.max(-0.5, spacing)
    this.updateScrollBounds()
    for (const entry of this.activeRecords.values()) {
      if (!entry.isHovered) {
        entry.mesh.position.x = entry.trackIndex * this.unit - this.scrollOffset
      }
    }
    this._needsRender = true
  }

  getSpacing(): number {
    return this.spacing
  }

  /**
   * Re-attach the canvas to a new container (used when the page is
   * re-mounted in the single-page architecture). This avoids the expensive
   * WebGL context creation + record rebuilding that would happen if we
   * disposed and created a new instance.
   */
  reattach(container: HTMLElement): void {
    if (this.disposed) return
    // If already attached to this container, nothing to do
    if (this.container === container) {
      this.resumeRendering()
      return
    }
    // Remove event listeners from old container
    const oldContainer = this.container
    oldContainer.removeEventListener('mousemove', this.boundMouseMove)
    oldContainer.removeEventListener('click', this.boundClick)
    oldContainer.removeEventListener('contextmenu', this.boundContextMenu)
    oldContainer.removeEventListener('mouseleave', this.boundMouseLeave)
    oldContainer.removeEventListener('pointerdown', this.boundPointerDown)
    oldContainer.removeEventListener('wheel', this.boundWheel)

    this.container = container
    // Move the existing canvas to the new container
    const canvas = this.renderer.domElement
    if (canvas.parentElement) {
      canvas.parentElement.removeChild(canvas)
    }
    container.appendChild(canvas)
    // Re-register event listeners on new container
    container.addEventListener('mousemove', this.boundMouseMove)
    container.addEventListener('click', this.boundClick)
    container.addEventListener('contextmenu', this.boundContextMenu)
    container.addEventListener('mouseleave', this.boundMouseLeave)
    container.addEventListener('pointerdown', this.boundPointerDown)
    container.addEventListener('wheel', this.boundWheel, { passive: false })
    // Update camera aspect ratio for the new container size
    this.onResize()
    this.resumeRendering()
  }

  /**
   * Check if the tracks array is the same as the current one.
   * Used to skip expensive record rebuilding when the page is re-mounted
   * with the same data (which is the common case in the single-page architecture).
   */
  hasSameTracks(tracks: Track[]): boolean {
    if (this.tracks === tracks) return true
    if (this.tracks.length !== tracks.length) return false
    // Shallow check: compare first/last/id samples (fast path)
    if (this.tracks.length > 0) {
      const a0 = this.tracks[0], b0 = tracks[0]
      if (a0.id !== b0.id) return false
      const n = this.tracks.length
      const aN = this.tracks[n - 1], bN = tracks[n - 1]
      if (aN.id !== bN.id) return false
    }
    return true
  }

  /** Check if this instance has been permanently disposed. */
  isDisposed(): boolean {
    return this.disposed
  }

  onSelect(cb: (trackId: string) => void): void {
    this.selectCallback = cb
  }

  onContext(cb: (trackId: string, x: number, y: number) => void): void {
    this.contextCallback = cb
  }

  setCurrentTrack(trackId: string | null): void {
    this.currentTrackId = trackId
    this.updateCurrentTrackVisual()
    this._needsRender = true
  }

  resize(): void {
    this.onResize()
  }

  dispose(): void {
    this.disposed = true
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    if (this.hoverTimeline) {
      this.hoverTimeline.kill()
      this.hoverTimeline = null
    }
    gsap.killTweensOf(this.scrollProxy)

    const canvas = this.renderer.domElement
    const container = this.container
    container.removeEventListener('mousemove', this.boundMouseMove)
    container.removeEventListener('click', this.boundClick)
    container.removeEventListener('contextmenu', this.boundContextMenu)
    container.removeEventListener('mouseleave', this.boundMouseLeave)
    container.removeEventListener('pointerdown', this.boundPointerDown)
    container.removeEventListener('wheel', this.boundWheel)
    window.removeEventListener('pointermove', this.boundPointerMove)
    window.removeEventListener('pointerup', this.boundPointerUp)
    window.removeEventListener('resize', this.boundResize)
    document.removeEventListener('visibilitychange', this.boundVisibilityChange)

    this.clearActiveRecords()
    // Dispose texture cache
    for (const tex of this.textureCache.values()) {
      tex.dispose()
    }
    this.textureCache.clear()

    this.geometry.dispose()
    this.edgeGradientLocal.dispose()
    this.edgeGradientNetease.dispose()
    for (const tex of this.placeholderTextures) tex.dispose()
    this.placeholderTextures = []
    this.renderer.dispose()

    if (canvas.parentElement) {
      canvas.parentElement.removeChild(canvas)
    }
  }

  // ── Scroll Bounds ─────────────────────────────────────────

  /** 更新滚动边界。有界滚动：第一首前有半 unit 缓冲，最后一首后有半 unit 缓冲。 */
  private updateScrollBounds(): void {
    const N = this.tracks.length
    if (N === 0) {
      this.minScrollOffset = 0
      this.maxScrollOffset = 0
      return
    }
    this.minScrollOffset = -this.unit * 0.5
    this.maxScrollOffset = (N - 1) * this.unit + this.unit * 0.5
  }

  /** 将 scrollOffset 钳制到有效范围 */
  private clampScrollOffset(): void {
    if (this.scrollOffset < this.minScrollOffset) {
      this.scrollOffset = this.minScrollOffset
    } else if (this.scrollOffset > this.maxScrollOffset) {
      this.scrollOffset = this.maxScrollOffset
    }
  }

  // ── Virtual Scrolling ────────────────────────────────────

  /**
   * 虚拟滚动核心：根据当前 scrollOffset 计算可见范围，
   * 创建缺失的记录，销毁超出范围的记录。
   *
   * 可见范围 = [centerIndex - visibleRadius, centerIndex + visibleRadius]
   * visibleRadius 基于 FADE_END 和 VIRTUAL_BUFFER 计算。
   *
   * 此方法在每帧 update() 中调用，开销极小（仅 Map 遍历 + 少量比较）。
   */
  private updateActiveRecords(): void {
    const N = this.tracks.length
    if (N === 0) return

    const unit = this.unit
    if (unit <= 0) return

    // 中心 track index（浮点数）
    const centerIndex = this.scrollOffset / unit

    // 可见半径 = FADE_END / unit
    const visibleRadius = Math.ceil(FADE_END / unit)

    // 方向感知动态缓冲：滚动方向的前方缓冲更大
    // velocityBuffer 基于滚动速度，最大 15，确保快速滚动时前方封面提前加载
    const velocityBuffer = Math.min(Math.ceil(this.scrollVelocity * 2), 15)
    const leadingBuffer = this.VIRTUAL_BUFFER + (this.scrollDirection > 0 ? velocityBuffer : 0)
    const trailingBuffer = this.VIRTUAL_BUFFER + (this.scrollDirection < 0 ? velocityBuffer : 0)

    const startIndex = Math.max(0, Math.floor(centerIndex - visibleRadius - trailingBuffer))
    const endIndex = Math.min(N - 1, Math.ceil(centerIndex + visibleRadius + leadingBuffer))

    // 销毁超出范围的记录
    const toDestroy: number[] = []
    for (const idx of this.activeRecords.keys()) {
      if (idx < startIndex || idx > endIndex) {
        toDestroy.push(idx)
      }
    }
    for (const idx of toDestroy) {
      const entry = this.activeRecords.get(idx)!
      this.destroyRecord(idx, entry)
    }

    // 创建缺失的记录（按距中心远近排序，优先创建中心附近的记录）
    const toCreate: number[] = []
    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.activeRecords.has(i)) {
        toCreate.push(i)
      }
    }
    // Sort by distance from center — closest first (ensures center covers load first)
    toCreate.sort((a, b) => Math.abs(a - centerIndex) - Math.abs(b - centerIndex))
    for (const i of toCreate) {
      this.createRecord(this.tracks[i], i)
    }
  }

  // ── Record Creation ──────────────────────────────────────

  /**
   * 预渲染 8 种彩色渐变占位纹理。在构造函数中调用一次。
   * 滚动时根据曲目标题哈希分配，无需 canvas 绘制，0ms 开销。
   */
  private initPlaceholderTextures(): void {
    for (const colors of PLACEHOLDER_COLORS) {
      const canvas = document.createElement('canvas')
      canvas.width = FALLBACK_W
      canvas.height = FALLBACK_H
      const ctx = canvas.getContext('2d')!

      // Gradient background
      const grad = ctx.createLinearGradient(0, 0, FALLBACK_W, FALLBACK_H)
      grad.addColorStop(0, colors.top)
      grad.addColorStop(1, colors.bottom)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, FALLBACK_W, FALLBACK_H)

      // Subtle vinyl circles in center
      const cx = FALLBACK_W / 2
      const cy = FALLBACK_H / 2 - 30
      for (let r = 70; r > 14; r -= 4) {
        ctx.strokeStyle = `rgba(255, 255, 255, 0.03)`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.beginPath()
      ctx.arc(cx, cy, 10, 0, Math.PI * 2)
      ctx.fill()

      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      this.placeholderTextures.push(texture)
    }
  }

  /** 哈希字符串 → 正整数（用于占位纹理选择） */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return Math.abs(hash)
  }

  /** 检查纹理是否为预渲染占位纹理（不可 dispose） */
  private isPlaceholderTexture(tex: THREE.Texture | null | undefined): boolean {
    if (!tex) return false
    return this.placeholderTextures.includes(tex as THREE.CanvasTexture)
  }

  private createRecord(track: Track, index: number): void {
    const source = (track.source === 'netease' || track.source === 'qq') ? 'netease' : 'local'
    const gradientTexture = source === 'netease' ? this.edgeGradientNetease : this.edgeGradientLocal

    // All materials are MeshBasicMaterial — unlit, maximum performance
    const coverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    })
    // Left + bottom edges: gradient texture (visible to user at 62° rotation)
    const edgeGradientMaterial = new THREE.MeshBasicMaterial({
      map: gradientTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    })
    // Right + top edges: dark (not user-visible at 62°)
    const edgeDarkMaterial = new THREE.MeshBasicMaterial({
      color: 0x0a0a12,
      transparent: true,
      opacity: 0,
    })
    const backMaterial = new THREE.MeshBasicMaterial({
      color: 0x0a0a12,
      transparent: true,
      opacity: 0,
    })

    const allMaterials = [coverMaterial, edgeGradientMaterial, edgeDarkMaterial, backMaterial]

    // BoxGeometry material indices: [right(+X), left(-X), top(+Y), bottom(-Y), front(+Z), back(-Z)]
    // At 62° Y-rotation, LEFT face (-X) faces the camera → gradient
    // Right (0): dark, Left (1): gradient, Top (2): dark, Bottom (3): gradient, Front (4): cover, Back (5): back
    const materials = [edgeDarkMaterial, edgeGradientMaterial, edgeDarkMaterial, edgeGradientMaterial, coverMaterial, backMaterial]
    const mesh = new THREE.Mesh(this.geometry, materials)
    mesh.position.set(index * this.unit - this.scrollOffset, 0, 0)
    mesh.rotation.y = ANGLE_RAD
    mesh.frustumCulled = true

    const group = new THREE.Group()
    group.add(mesh)
    this.shelfGroup.add(group)

    const entry: RecordEntry = {
      group, mesh, coverMaterial, edgeGradientMaterial, edgeDarkMaterial, backMaterial,
      allMaterials,
      trackId: track.id,
      trackIndex: index,
      isHovered: false,
      textureLoaded: false,
      lastOpacity: -1, // force initial update
      source,
    }
    this.activeRecords.set(index, entry)

    // Fade in — quick, no stagger delay (virtual scrolling creates records on-demand)
    gsap.to(allMaterials, {
      opacity: 1,
      duration: 0.4,
      ease: 'power2.out',
      onStart: () => { this._needsRender = true },
      onUpdate: () => { this._needsRender = true },
    })

    // Load cover texture — check texture cache first, then image cache, then load
    const coverUrl = this.coverUrlFn?.(track)
    if (coverUrl) {
      // Texture cache key includes track title+artist to prevent wrong text when
      // multiple tracks share the same cover URL (e.g. same album)
      const texKey = `${coverUrl}#${track.title}#${track.artist || ''}`
      const cachedTex = this.textureCache.get(texKey)
      if (cachedTex) {
        this.applyTexture(entry, cachedTex)
        this._needsRender = true
        return
      }

      // Use pre-rendered colored placeholder (no canvas drawing during scroll)
      const phIdx = this.hashString(track.title + (track.artist || '')) % this.placeholderTextures.length
      this.applyTexture(entry, this.placeholderTextures[phIdx])

      // Check image cache — if image is already loaded (e.g. preloaded), create texture immediately
      const cachedImg = this.imageCache.get(coverUrl)
      if (cachedImg) {
        const texture = this.createCoverTextureWithText(cachedImg, entry)
        this.applyTexture(entry, texture)
        this._needsRender = true
        return
      }

      // Then load the real cover asynchronously
      this.loadCoverTexture(coverUrl, entry)
    } else {
      // No cover URL — create track-specific fallback (with text)
      const fallback = this.createFallbackTexture(track, source)
      this.applyTexture(entry, fallback)
    }
  }

  /**
   * 销毁一条记录，将其纹理移入缓存（如可缓存）。
   * 不 dispose 纹理 — 供虚拟滚动滑回时复用。
   */
  private destroyRecord(index: number, entry: RecordEntry): void {
    gsap.killTweensOf(entry.allMaterials)
    gsap.killTweensOf(entry.mesh.position)
    gsap.killTweensOf(entry.mesh.rotation)
    gsap.killTweensOf(entry.mesh.scale)

    // If this record was hovered, clean up hover state
if (this.hoveredTrackIndex === index) {
this.setHoveredTrackIndex(-1)
this.isClickAnimating = false
this.isPaused = false
      if (this.hoverTimeline) {
        this.hoverTimeline.kill()
        this.hoverTimeline = null
      }
    }

    // Cache or dispose the cover texture
    if (entry.coverMaterial.map) {
      const isPlaceholder = this.isPlaceholderTexture(entry.coverMaterial.map)
      if (!isPlaceholder) {
        // Try to find the URL for this texture
        const track = this.tracks[index]
        const url = track ? this.coverUrlFn?.(track) : undefined
        const texKey = url && track ? `${url}#${track.title}#${track.artist || ''}` : undefined
        if (texKey && !this.textureCache.has(texKey) && this.textureCache.size < this.TEXTURE_CACHE_MAX) {
          this.textureCache.set(texKey, entry.coverMaterial.map)
        } else {
          entry.coverMaterial.map.dispose()
        }
      }
    }

    entry.coverMaterial.dispose()
    entry.edgeGradientMaterial.dispose()
    entry.edgeDarkMaterial.dispose()
    entry.backMaterial.dispose()
    this.shelfGroup.remove(entry.group)
    this.activeRecords.delete(index)
  }

  private loadCoverTexture(url: string, entry: RecordEntry): void {
    // Image cache hit — reuse already-loaded image/bitmap
    const cached = this.imageCache.get(url)
    if (cached) {
      const texture = this.createCoverTextureWithText(cached, entry)
      this.applyTexture(entry, texture)
      // Cache the texture for future reuse (key includes track info for correct text)
      const track = this.tracks[entry.trackIndex]
      if (track) {
        const texKey = `${url}#${track.title}#${track.artist || ''}`
        this.cacheTexture(texKey, texture)
      }
      this._needsRender = true
      return
    }

    // Off-main-thread load + decode via fetch → blob → createImageBitmap
    const doLoad = async (): Promise<void> => {
      if (this.disposed) return
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        // createImageBitmap decodes the image OFF the main thread
        const bitmap = await createImageBitmap(blob)

        if (this.disposed) return
        if (!this.activeRecords.has(entry.trackIndex)) return

        // Cache the decoded bitmap
        if (this.imageCache.size >= this.IMAGE_CACHE_MAX) {
          const oldest = this.imageCache.keys().next().value
          if (oldest) {
            const oldVal = this.imageCache.get(oldest)
            if (oldVal instanceof ImageBitmap) oldVal.close()
            this.imageCache.delete(oldest)
          }
        }
        this.imageCache.set(url, bitmap)

        const texture = this.createCoverTextureWithText(bitmap, entry)
        this.applyTexture(entry, texture)
        // Cache with composite key (url + track info) for correct text
        const track = this.tracks[entry.trackIndex]
        if (track) {
          const texKey = `${url}#${track.title}#${track.artist || ''}`
          this.cacheTexture(texKey, texture)
        }
        this._needsRender = true
      } catch {
        if (this.disposed) return
        if (!this.activeRecords.has(entry.trackIndex)) return
        console.warn('[RecordShelf] Failed to load cover:', url)
        const track = this.tracks[entry.trackIndex] ?? null
        const fallback = this.createFallbackTexture(track, entry.source)
        this.applyTexture(entry, fallback)
        this._needsRender = true
      } finally {
        this.activeLoads--
        this.processQueue()
      }
    }

    if (this.activeLoads < this.MAX_CONCURRENT_LOADS) {
      this.activeLoads++
      doLoad()
    } else {
      // processQueue already increments activeLoads before calling the wrapper,
      // so the wrapper must NOT also increment — otherwise activeLoads grows
      // without bound and all loading eventually stops.
      this.loadQueue.push(() => {
        doLoad()
      })
    }
  }

  /** Cache a texture by URL, disposing the oldest if cache is full. */
  private cacheTexture(url: string, texture: THREE.Texture): void {
    if (this.textureCache.has(url)) return
    if (this.textureCache.size >= this.TEXTURE_CACHE_MAX) {
      const oldest = this.textureCache.keys().next().value
      if (oldest) {
        const oldTex = this.textureCache.get(oldest)!
        oldTex.dispose()
        this.textureCache.delete(oldest)
      }
    }
    this.textureCache.set(url, texture)
  }

  /** Process the next queued image load if concurrency allows. */
  private processQueue(): void {
    while (this.activeLoads < this.MAX_CONCURRENT_LOADS && this.loadQueue.length > 0) {
      const next = this.loadQueue.shift()
      if (next) {
        this.activeLoads++
        next()
      }
    }
  }

  /**
   * 创建带文字叠加的封面纹理：
   * 绘制封面图 → 底部渐变 → 歌曲名 → 歌手名 → 来源指示线
   * 如果 canvas 被污染 (CORS 失败)，回退为直接使用图片作为纹理。
   */
  private createCoverTextureWithText(img: HTMLImageElement | ImageBitmap, entry: RecordEntry): THREE.Texture {
    // If image has no dimensions, use fallback
    if (img.width <= 0 || img.height <= 0) {
      const track = this.tracks[entry.trackIndex] ?? null
      return this.createFallbackTexture(track, entry.source)
    }

    try {
      const canvas = document.createElement('canvas')
      canvas.width = FALLBACK_W
      canvas.height = FALLBACK_H
      const ctx = canvas.getContext('2d')!

      // Draw cover image with "cover" fit (crop to fill canvas)
      const imgRatio = img.width / img.height
      const canvasRatio = FALLBACK_W / FALLBACK_H
      let sx = 0, sy = 0, sw = img.width, sh = img.height
      if (imgRatio > canvasRatio) {
        sw = img.height * canvasRatio
        sx = (img.width - sw) / 2
      } else {
        sh = img.width / canvasRatio
        sy = (img.height - sh) / 2
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, FALLBACK_W, FALLBACK_H)

      // Light gradient overlay at bottom for text readability only
      const grad = ctx.createLinearGradient(0, FALLBACK_H * 0.6, 0, FALLBACK_H)
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
      grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.4)')
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.65)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, FALLBACK_W, FALLBACK_H)

      // Track title and artist
      const track = this.tracks[entry.trackIndex]
      if (track) {
        // Title — bright white
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.font = `bold ${Math.round(FALLBACK_W / 15)}px "Noto Sans CJK SC", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        this.wrapText(ctx, track.title, FALLBACK_W / 2, FALLBACK_H - 56, FALLBACK_W - 53, 35)

        // Artist — bright
        if (track.artist) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
          ctx.font = `${Math.round(FALLBACK_W / 22)}px "Noto Sans CJK SC", sans-serif`
          ctx.fillText(track.artist, FALLBACK_W / 2, FALLBACK_H - 22)
        }

        // VIP badge
        if (track.vip) {
          const badgeW = Math.round(FALLBACK_W * 0.16)
          const badgeH = Math.round(FALLBACK_W * 0.07)
          const badgeX = FALLBACK_W - badgeW - 8
          const badgeY = 8
          ctx.fillStyle = 'rgba(255, 215, 0, 0.85)'
          ctx.beginPath()
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3)
          ctx.fill()
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)'
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
          ctx.font = `bold ${Math.round(FALLBACK_W / 28)}px "Noto Sans CJK SC", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('VIP', badgeX + badgeW / 2, badgeY + badgeH / 2)
        }
      }

      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      return texture
    } catch (e) {
      // Canvas is likely tainted (CORS issue) — use the image directly as a texture
      console.warn('[RecordShelf] Canvas tainted, using raw image texture:', e)
      const texture = new THREE.Texture(img)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.needsUpdate = true
      return texture
    }
  }

  private applyTexture(entry: RecordEntry, texture: THREE.Texture): void {
    // Don't dispose placeholder textures — they are reused across records
    const oldMap = entry.coverMaterial.map
    const isPlaceholder = this.isPlaceholderTexture(oldMap)
    // Don't dispose cached textures either — they're managed by textureCache
    const isCached = oldMap && [...this.textureCache.values()].includes(oldMap)
    if (oldMap && !isPlaceholder && !isCached) {
      oldMap.dispose()
    }
    entry.coverMaterial.map = texture
    entry.coverMaterial.color.set(0xffffff)
    entry.coverMaterial.needsUpdate = true
    entry.textureLoaded = true
  }

  private createFallbackTexture(track: Track | null, source: 'local' | 'netease'): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = FALLBACK_W
    canvas.height = FALLBACK_H
    const ctx = canvas.getContext('2d')!

    // Dark gradient background
    const grad = ctx.createLinearGradient(0, 0, FALLBACK_W, FALLBACK_H)
    grad.addColorStop(0, '#1a1e28')
    grad.addColorStop(0.5, '#161620')
    grad.addColorStop(1, '#0e0e16')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, FALLBACK_W, FALLBACK_H)

    // Vinyl record design — concentric circles
    const cx = FALLBACK_W / 2
    const cy = FALLBACK_H / 2 - 30
    for (let r = 80; r > 14; r -= 4) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.015 + (80 - r) * 0.001})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(40, 40, 55, 0.8)'
    ctx.beginPath()
    ctx.arc(cx, cy, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fill()

    // Bottom gradient for text
    const bottomGrad = ctx.createLinearGradient(0, FALLBACK_H * 0.5, 0, FALLBACK_H)
    bottomGrad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    bottomGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.5)')
    bottomGrad.addColorStop(1, 'rgba(0, 0, 0, 0.75)')
    ctx.fillStyle = bottomGrad
    ctx.fillRect(0, 0, FALLBACK_W, FALLBACK_H)

    if (track) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.font = `bold ${Math.round(FALLBACK_W / 15)}px "Noto Sans CJK SC", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      this.wrapText(ctx, track.title, FALLBACK_W / 2, FALLBACK_H - 56, FALLBACK_W - 53, 35)

      if (track.artist) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
        ctx.font = `${Math.round(FALLBACK_W / 22)}px "Noto Sans CJK SC", sans-serif`
        ctx.fillText(track.artist, FALLBACK_W / 2, FALLBACK_H - 22)
      }

      // VIP badge
      if (track.vip) {
        const badgeW = Math.round(FALLBACK_W * 0.16)
        const badgeH = Math.round(FALLBACK_W * 0.07)
        const badgeX = FALLBACK_W - badgeW - 8
        const badgeY = 8
        ctx.fillStyle = 'rgba(255, 215, 0, 0.85)'
        ctx.beginPath()
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
        ctx.font = `bold ${Math.round(FALLBACK_W / 28)}px "Noto Sans CJK SC", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('VIP', badgeX + badgeW / 2, badgeY + badgeH / 2)
      }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    return texture
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    const chars = [...text]
    let line = ''
    let yy = y
    for (const ch of chars) {
      const test = line + ch
      if (ctx.measureText(test).width > maxWidth) {
        ctx.fillText(line, x, yy)
        line = ch
        yy += lineHeight
      } else {
        line = test
      }
    }
    ctx.fillText(line, x, yy)
  }

  private clearActiveRecords(): void {
    for (const [idx, entry] of this.activeRecords) {
      gsap.killTweensOf(entry.allMaterials)
      gsap.killTweensOf(entry.mesh.position)
      gsap.killTweensOf(entry.mesh.rotation)
      gsap.killTweensOf(entry.mesh.scale)

      if (entry.coverMaterial.map) {
        // Don't dispose placeholder textures — they survive record clearing
        const isPlaceholder = this.isPlaceholderTexture(entry.coverMaterial.map)
        // Don't dispose cached textures either
        const isCached = [...this.textureCache.values()].includes(entry.coverMaterial.map)
        if (!isPlaceholder && !isCached) {
          entry.coverMaterial.map.dispose()
        }
      }
      entry.coverMaterial.dispose()
      entry.edgeGradientMaterial.dispose()
      entry.edgeDarkMaterial.dispose()
      entry.backMaterial.dispose()
      this.shelfGroup.remove(entry.group)
    }
    this.activeRecords.clear()
this.setHoveredTrackIndex(-1)
this.isClickAnimating = false
gsap.killTweensOf(this.scrollProxy)
    if (this.hoverTimeline) {
      this.hoverTimeline.kill()
      this.hoverTimeline = null
    }
    this.unhoverAnimatingCount = 0
this.retractingTrackIndex = -1
this.clickAnimatingTrackIndex = -1
    // Clear pending image loads (already-loaded images stay in imageCache for reuse)
    this.loadQueue = []
    this.activeLoads = 0
  }

  // ── Animation Loop ────────────────────────────────────────

  private startLoop(): void {
    const loop = () => {
      if (this.disposed) return
      this.animationId = requestAnimationFrame(loop)
      this.update()
    }
    loop()
  }

  private update(): void {
    if (!this._pageVisible) return

    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return

    const delta = Math.min(this.clock.getDelta(), 0.05)

    // Auto-scroll (pause when hovering or dragging)
    const isScrolling = !this.isPaused && !this.isDragging && this.tracks.length > 0
    if (isScrolling) {
      this.scrollOffset += SCROLL_SPEED * delta
      // Bounded scroll: stop at boundaries
      if (this.scrollOffset >= this.maxScrollOffset) {
        this.scrollOffset = this.maxScrollOffset
        this.isPaused = true // Stop at the end
      }
      this._needsRender = true
    }

    // Track scroll direction and velocity for direction-aware prefetching
    const scrollDelta = this.scrollOffset - this.lastScrollOffset
    if (Math.abs(scrollDelta) > 0.0005 && delta > 0) {
      this.scrollDirection = Math.sign(scrollDelta)
      this.scrollVelocity = Math.abs(scrollDelta) / delta
    } else {
      // Decay velocity when not scrolling
      this.scrollVelocity *= 0.85
      if (this.scrollVelocity < 0.05) {
        this.scrollDirection = 0
        this.scrollVelocity = 0
      }
    }
    this.lastScrollOffset = this.scrollOffset

    // Check if any GSAP animations are running
    const hasHoverAnim = this.hoverTimeline?.isActive() ?? false
    const hasUnhoverAnim = this.unhoverAnimatingCount > 0

    // Skip rendering if nothing changed
    if (!this._needsRender && !isScrolling && !hasHoverAnim && !hasUnhoverAnim) {
      return
    }

    // Virtual scrolling: create/destroy records based on current scroll position
    this.updateActiveRecords()

    const N = this.activeRecords.size
    if (N === 0) {
      this.renderer.render(this.scene, this.camera)
      this._needsRender = false
      return
    }

    const unit = this.unit

    for (const [idx, entry] of this.activeRecords) {
      // Bounded scroll — no wrapping
      const x = entry.trackIndex * unit - this.scrollOffset

      // ★ Only skip position update for records being click/retract animated.
      // Simple hover should NOT lock position — the record should follow scroll.
      const isPositionLocked = idx === this.clickAnimatingTrackIndex || idx === this.retractingTrackIndex
      if (!isPositionLocked) {
        entry.mesh.position.x = x
      }

      // Distance-based opacity fade
      const dist = Math.abs(entry.mesh.position.x)
      let opacity = 1
      if (dist > FADE_START) {
        opacity = Math.max(0, 1 - (dist - FADE_START) / (FADE_END - FADE_START))
      }

      const visible = opacity > 0.01
      if (!visible) {
        if (entry.mesh.visible) entry.mesh.visible = false
        continue
      }
      if (!entry.mesh.visible) entry.mesh.visible = true

      // Only update opacity for non-hovered records and only when value changed
      if (!entry.isHovered) {
        if (Math.abs(opacity - entry.lastOpacity) > 0.005) {
          entry.lastOpacity = opacity
          for (const mat of entry.allMaterials) {
            mat.opacity = opacity
          }
        }
      }
    }

    this.renderer.render(this.scene, this.camera)
    this._needsRender = false
  }

  // ── Interaction ───────────────────────────────────────────

  /**
   * 悬停检测 — 仅在 mousemove 事件中调用。
   *
   * 一段式逻辑：
   * 1. 点击动画进行中 → 跳过（防止冲突）
   * 2. 收回动画进行中 → 跳过
   * 3. 正常模式 → raycast 检测悬停, 悬停时显示描边高亮
   */
  private checkHover(): void {
    // Skip during click animation
    if (this.isClickAnimating) return
    // Skip during drag
    if (this.isDragging) return
    // Skip if mouse outside canvas
    if (this.mouseNDC.x < -1.5) return

    this.raycaster.setFromCamera(this.mouseNDC, this.camera)

    // Build visible mesh list once
    const meshes: THREE.Mesh[] = []
    for (const entry of this.activeRecords.values()) {
      if (entry.mesh.visible) meshes.push(entry.mesh)
    }
    const intersects = this.raycaster.intersectObjects(meshes, false)
    const hitIndex = intersects.length > 0
      ? (() => {
          const hitMesh = intersects[0].object as THREE.Mesh
          for (const [idx, entry] of this.activeRecords) {
            if (entry.mesh === hitMesh) return idx
          }
          return -1
        })()
      : -1

    if (this.hoveredTrackIndex >= 0) {
      if (hitIndex === this.hoveredTrackIndex) {
        // Still hovering the same record — nothing to do
        return
      }
      // Mouse moved off the hovered record (or onto a different one)
      this.unhoverRecord(this.hoveredTrackIndex)
      this.setHoveredTrackIndex(-1)
      // If mouse is now on a different record, hover it immediately
      if (hitIndex >= 0) {
        this.setHoveredTrackIndex(hitIndex)
        this.hoverRecord(hitIndex)
      }
    } else if (hitIndex >= 0 && hitIndex !== this.retractingTrackIndex) {
      // Not hovering — now hovering a new record (skip retracting record)
      this.setHoveredTrackIndex(hitIndex)
      this.hoverRecord(hitIndex)
    }
  }

  /**
   * 悬停效果: 描边高亮 + 轻微放大 + 暂停自动滚动
   */
  private hoverRecord(trackIndex: number): void {
    const entry = this.activeRecords.get(trackIndex)
    if (!entry) return
    entry.isHovered = true
    this.isPaused = true // 暂停自动滚动

    // 描边高亮: 提升封面材质亮度 (warm glow)
    gsap.to(entry.coverMaterial.color, {
      r: 1.0, g: 0.96, b: 0.85,
      duration: 0.2, ease: 'power2.out',
      onUpdate: () => { this._needsRender = true },
    })

    // 轻微放大 (1.08x) 作为悬停反馈
    const isCurrent = entry.trackId === this.currentTrackId
    const hoverScale = isCurrent ? CURRENT_SCALE * 1.08 : 1.08
    gsap.to(entry.mesh.scale, {
      x: hoverScale, y: hoverScale, z: hoverScale,
      duration: 0.2, ease: 'power2.out',
      onUpdate: () => { this._needsRender = true },
    })

    this.container.style.cursor = 'pointer'
  }

  /**
   * 取消悬停: 移除描边高亮, 恢复正常状态, 恢复自动滚动
   */
  private unhoverRecord(trackIndex: number): void {
    const entry = this.activeRecords.get(trackIndex)
    if (!entry) return
    entry.isHovered = false

    // 恢复材质颜色
    const isCurrent = entry.trackId === this.currentTrackId
    if (isCurrent) {
      gsap.to(entry.coverMaterial.color, {
        r: 1.0, g: 0.94, b: 0.88,
        duration: 0.2, ease: 'power2.out',
        onUpdate: () => { this._needsRender = true },
        onComplete: () => { entry.coverMaterial.color.setHex(0xfff0e0) },
      })
    } else {
      gsap.to(entry.coverMaterial.color, {
        r: 1.0, g: 1.0, b: 1.0,
        duration: 0.2, ease: 'power2.out',
        onUpdate: () => { this._needsRender = true },
        onComplete: () => { entry.coverMaterial.color.setHex(0xffffff) },
      })
    }

    // 恢复缩放
    const targetScale = isCurrent ? CURRENT_SCALE : 1
    gsap.to(entry.mesh.scale, {
      x: targetScale, y: targetScale, z: targetScale,
      duration: 0.2, ease: 'power2.out',
      onUpdate: () => { this._needsRender = true },
    })

    // 始终恢复自动滚动 (hoverRecord / clickAndPlay 会在需要时重新暂停)
    this.isPaused = false

    this.container.style.cursor = 'default'
  }

  /**
   * 一段式点击动画: 翻转 360° → 旋转正面 → 放大到中心 → 播放 → 收回
   */
  private clickAndPlay(trackIndex: number): void {
    const entry = this.activeRecords.get(trackIndex)
    if (!entry) return
    entry.isHovered = true
    entry.lastOpacity = -1
    this.isPaused = true
    this.isClickAnimating = true
    this.clickAnimatingTrackIndex = trackIndex

    if (this.hoverTimeline) {
      this.hoverTimeline.kill()
    }

    const tl = gsap.timeline({
      onUpdate: () => { this._needsRender = true },
      onComplete: () => {
        this.isClickAnimating = false
        this.clickAnimatingTrackIndex = -1
        // 播放曲目
        if (this.selectCallback) {
          this.selectCallback(entry.trackId)
        }
        // 延迟后收回唱片到架子上
        setTimeout(() => {
          this.retractRecord(trackIndex)
        }, 400)
      },
    })
    this.hoverTimeline = tl

    // Phase 1: Flip 360°
    tl.to(entry.mesh.rotation, {
      y: ANGLE_RAD + Math.PI * 2,
      duration: FLIP_DURATION,
      ease: 'power2.inOut',
    })
    tl.call(() => {
      gsap.set(entry.mesh.rotation, { y: ANGLE_RAD })
    })

    // Phase 2: Rotate to front + extract to center + scale up
    tl.to(entry.mesh.rotation, {
      y: 0,
      duration: EXTRACT_DURATION,
      ease: 'power2.out',
    })
    tl.to(entry.mesh.position, {
      x: 0, z: EXTRACT_Z,
      duration: EXTRACT_DURATION,
      ease: 'back.out(1.2)',
    }, '<')
    tl.to(entry.mesh.scale, {
      x: EXTRACT_SCALE, y: EXTRACT_SCALE, z: EXTRACT_SCALE,
      duration: EXTRACT_DURATION,
      ease: 'power2.out',
    }, '<')
    tl.to(entry.allMaterials, {
      opacity: 1, duration: 0.2, ease: 'power2.out',
    }, 0)

    this.container.style.cursor = 'pointer'
  }

  /**
   * 收回动画: 从中心位置回到唱片架原位
   */
  private retractRecord(trackIndex: number): void {
    const entry = this.activeRecords.get(trackIndex)
    if (!entry) return

    // 立即清除 hoveredTrackIndex, 让 checkHover 恢复工作
    if (this.hoveredTrackIndex === trackIndex) {
      this.setHoveredTrackIndex(-1)
    }
    this.retractingTrackIndex = trackIndex

    if (this.hoverTimeline) {
      this.hoverTimeline.kill()
      this.hoverTimeline = null
    }

    // Normalize rotation to [0, 2π)
    const currentY = entry.mesh.rotation.y
    const normalized = ((currentY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    gsap.set(entry.mesh.rotation, { y: normalized })

    const isCurrent = entry.trackId === this.currentTrackId
    const targetScale = isCurrent ? CURRENT_SCALE : 1
    const targetX = entry.trackIndex * this.unit - this.scrollOffset

    this.unhoverAnimatingCount++

    // Animate rotation back to ANGLE_RAD, position back to shelf, scale down
    gsap.to(entry.mesh.rotation, {
      y: ANGLE_RAD,
      duration: 0.3,
      ease: 'power2.inOut',
      onUpdate: () => { this._needsRender = true },
    })
    gsap.to(entry.mesh.position, {
      x: targetX,
      z: 0,
      duration: 0.28,
      ease: 'power2.inOut',
      onUpdate: () => { this._needsRender = true },
      onComplete: () => {
        entry.isHovered = false
        entry.lastOpacity = -1
        this.unhoverAnimatingCount--
        this.retractingTrackIndex = -1
        if (this.hoveredTrackIndex < 0) {
          this.isPaused = false
        }
        // 恢复材质颜色
        if (isCurrent) {
          entry.coverMaterial.color.setHex(0xfff0e0)
        } else {
          entry.coverMaterial.color.setHex(0xffffff)
        }
      },
    })
    gsap.to(entry.mesh.scale, {
      x: targetScale, y: targetScale, z: targetScale,
      duration: 0.28,
      ease: 'power2.out',
      onUpdate: () => { this._needsRender = true },
    })

    this.renderer.domElement.style.cursor = 'default'
  }

  private updateCurrentTrackVisual(): void {
    for (const entry of this.activeRecords.values()) {
      const isCurrent = entry.trackId === this.currentTrackId
      if (isCurrent && !entry.isHovered) {
        gsap.to(entry.mesh.scale, {
          x: CURRENT_SCALE, y: CURRENT_SCALE, z: CURRENT_SCALE,
          duration: 0.4, ease: 'power2.out',
          onUpdate: () => { this._needsRender = true },
        })
        entry.coverMaterial.color.setHex(0xfff0e0)
      } else if (!entry.isHovered) {
        gsap.to(entry.mesh.scale, {
          x: 1, y: 1, z: 1,
          duration: 0.4, ease: 'power2.out',
          onUpdate: () => { this._needsRender = true },
        })
        entry.coverMaterial.color.setHex(0xffffff)
      }
    }
  }

  // ── Drag Support ──────────────────────────────────────────

  /**
   * Setter for hoveredTrackIndex.
   * 注意: 不再管理 data-no-rotate 属性 — stopPropagation() 在 onPointerDown/onWheel
   * 中直接隔离事件, 不依赖 data-no-rotate。保留 data-no-rotate 会导致边缘区域
   * (record zone 外) 的 3D 交互被 visualizer 的 isOnInteractiveChild 误拦截。
   */
  private setHoveredTrackIndex(trackIdx: number): void {
    this.hoveredTrackIndex = trackIdx
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    this.dragStartX = e.clientX
    this.dragStartScroll = this.scrollOffset
    this.dragMoved = false
    // 唱片交互 vs 3D 交互区分:
    // - 鼠标悬停在唱片上 (hoveredTrackIndex >= 0) → 唱片拖拽, 阻止 3D 旋转
    // - 鼠标不在唱片上 → 让 visualizer 处理 3D 旋转
    // 使用 raycaster 精确检测, 而非依赖 isInRecordZone 的粗略区域判定
    if (this.hoveredTrackIndex >= 0) {
      e.stopImmediatePropagation()
      this.isDragging = true
    } else {
      // 额外检测: 即使 hover 状态未更新 (如快速点击), 也用 raycaster 确认
      this.raycaster.setFromCamera(this.mouseNDC, this.camera)
      const meshes: THREE.Mesh[] = []
      for (const entry of this.activeRecords.values()) {
        if (entry.mesh.visible) meshes.push(entry.mesh)
      }
      const intersects = this.raycaster.intersectObjects(meshes, false)
      if (intersects.length > 0) {
        e.stopImmediatePropagation()
        this.isDragging = true
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const dx = e.clientX - this.dragStartX
    if (Math.abs(dx) > DRAG_THRESHOLD) {
      if (!this.dragMoved && this.hoveredTrackIndex >= 0) {
        // 拖拽刚开始 — 立即取消当前 hover, 避免拖拽过程中高亮残留
        this.unhoverRecord(this.hoveredTrackIndex)
        this.setHoveredTrackIndex(-1)
      }
      this.dragMoved = true
    }
    if (!this.isDragging) return
    // Drag-scroll: update scrollOffset based on pointer movement
    this.scrollOffset = this.dragStartScroll - dx * DRAG_SENSITIVITY
    this.clampScrollOffset()
    this._needsRender = true
    // Detent sound when focus index changes during drag
    const focusIdx = Math.round(this.scrollOffset / this.unit)
    if (focusIdx !== this.lastShelfFocusIdx) {
      if (this.lastShelfFocusIdx !== -1) this.sfx.detent()
      this.lastShelfFocusIdx = focusIdx
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    if (this.isDragging) {
      this.isDragging = false
      // ★ 拖拽结束后立即重新检测 hover, 更新高亮到当前鼠标位置
      this.checkHover()
    }
    this.container.style.cursor = this.hoveredTrackIndex >= 0 ? 'pointer' : 'default'
  }

  /**
   * 唱片交互区判定 (用于 wheel 滚轮):
   * 水平长方形区域, 贴合普通 (非展开) 唱片的投影高度
   * 计算唱片上下边缘在 NDC 中的精确位置 (含相机 Y 偏移)
   */
  private isInRecordZone(e: { clientX: number; clientY: number }): boolean {
    // ★ 使用 container (stage) 的 rect, 而非 canvas — canvas 有 CSS transform
    // (translateZ + rotateX/Y + scale), getBoundingClientRect() 返回变换后的 AABB,
    // 导致 NDC 计算错误。container 无 transform, rect 匹配 renderer 逻辑尺寸。
    const rect = this.container.getBoundingClientRect()
    const yNDC = ((e.clientY - rect.top) / rect.height) * 2 - 1 // -1 (top) to 1 (bottom)
    // 投影普通唱片 (非展开) 的上下边缘到 NDC
    const halfH = RECORD_H / 2
    this._tmpVec3.set(0, halfH, 0)
    this._tmpVec3.project(this.camera)
    const topNDC = this._tmpVec3.y
    this._tmpVec3.set(0, -halfH, 0)
    this._tmpVec3.project(this.camera)
    const bottomNDC = this._tmpVec3.y
    // 区域: 从下边缘到上边缘, 加余量
    const margin = 0.08
    return yNDC >= bottomNDC - margin && yNDC <= topNDC + margin
  }

  /**
   * 唱片交互区内的滚轮: 滚动唱片
   * 区域外的滚轮: 让事件冒泡到 stage 进行 3D 缩放
   */
  private onWheel(e: WheelEvent): void {
    if (!this.isInRecordZone(e)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const direction = e.deltaY > 0 ? 1 : -1
    const currentIdx = Math.round(this.scrollOffset / this.unit)
    const targetIdx = currentIdx + direction
    const targetOffset = targetIdx * this.unit
    // Play detent sound on each step
    this.sfx.detent()
    gsap.killTweensOf(this.scrollProxy)
    this.scrollProxy.v = this.scrollOffset
    gsap.to(this.scrollProxy, {
      v: targetOffset,
      duration: 0.3,
      ease: 'power2.out',
      onUpdate: () => {
        this.scrollOffset = this.scrollProxy.v
        this.clampScrollOffset()
        this._needsRender = true
        // ★ 滚动时实时重新检测 hover — 随着唱片滚动,
        // 鼠标下方可能变成了另一张唱片, 需要即时更新高亮状态
        this.checkHover()
      },
    })
  }

  // ── Event Handlers ────────────────────────────────────────

  private onMouseMove(e: MouseEvent): void {
    // ★ 使用 container rect 而非 canvas rect — canvas 的 CSS transform
    // (translateZ + rotateX/Y + scale) 会导致 getBoundingClientRect() 返回
    // 变换后的 AABB, 使 NDC 坐标计算错误。
    const rect = this.container.getBoundingClientRect()
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    // 始终进行 hover 检测 — raycaster 精确检测 3D 唱片 mesh
    // 不依赖 isInRecordZone, 因为 raycaster 本身就是最精确的区域判定
    this.checkHover()
  }

private onMouseLeave(): void {
this.mouseNDC.set(-2, -2)
// 点击动画进行中时不取消悬停 (让动画自然完成)
if (!this.isClickAnimating && this.hoveredTrackIndex >= 0) {
this.unhoverRecord(this.hoveredTrackIndex)
this.setHoveredTrackIndex(-1)
} else if (this.hoveredTrackIndex < 0) {
this.isPaused = false
}
this.container.style.cursor = 'default'
}

  private onClick(_e: MouseEvent): void {
    if (this.dragMoved) {
      this.dragMoved = false
      return
    }

    // 点击动画进行中时不响应
    if (this.isClickAnimating) return

    // Raycast to find which record was actually clicked
    this.raycaster.setFromCamera(this.mouseNDC, this.camera)
    const meshes: THREE.Mesh[] = []
    for (const entry of this.activeRecords.values()) {
      if (entry.mesh.visible) meshes.push(entry.mesh)
    }
    const intersects = this.raycaster.intersectObjects(meshes, false)
    if (intersects.length === 0) return

    const hitMesh = intersects[0].object as THREE.Mesh
    let clickedIndex = -1
    for (const [idx, entry] of this.activeRecords) {
      if (entry.mesh === hitMesh) { clickedIndex = idx; break }
    }
    if (clickedIndex < 0) return

    // 一段式: 取消之前的悬停 → 翻转 + 放大 + 播放
    if (this.hoveredTrackIndex >= 0 && this.hoveredTrackIndex !== clickedIndex) {
      this.unhoverRecord(this.hoveredTrackIndex)
    }
    this.setHoveredTrackIndex(clickedIndex)
    this.clickAndPlay(clickedIndex)
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    if (this.hoveredTrackIndex >= 0) {
      const entry = this.activeRecords.get(this.hoveredTrackIndex)
      if (entry && this.contextCallback) {
        this.contextCallback(entry.trackId, e.clientX, e.clientY)
      }
    }
  }

  private onResize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this._needsRender = true
  }

  private onVisibilityChange(): void {
    this._pageVisible = !document.hidden
    if (this._pageVisible) {
      this._needsRender = true
      this.clock.getDelta() // reset delta to avoid jump
    }
  }

  /** Pause the render loop (e.g. when the music section is scrolled off-screen). */
  pauseRendering(): void {
    this._pageVisible = false
  }

  /** Resume the render loop (e.g. when the music section comes back into view). */
  resumeRendering(): void {
    if (!this._pageVisible) {
      this._pageVisible = true
      this._needsRender = true
      this.clock.getDelta() // reset delta to avoid jump
    }
  }
}
