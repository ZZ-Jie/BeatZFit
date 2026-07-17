/**
 * useCoverflowList — 通用 3D 悬浮列表 Composable
 *
 * 从 SongCoverflow.vue 抽象而来，封装了：
 *   - LERP 平滑滚动循环 (RAF)
 *   - 滚轮事件 (累积阈值 + GSAP 缓动)
 *   - 拖拽滚动 (pointer events + 惯性 + 吸附)
 *   - 点击 vs 拖拽判定
 *   - 3D 布局计算 (translateZ 悬浮、scale、opacity、rotateX)
 *   - hover 倾斜状态
 *
 * 用法：
 *   const stageRef = ref<HTMLElement | null>(null)
 *   const cf = useCoverflowList({
 *     count: computed(() => props.items.length),
 *     itemClass: 'cf-item',
 *     stageEl: stageRef,
 *   })
 *   onMounted(() => cf.init())
 *   onUnmounted(() => cf.destroy())
 *
 *   模板中:
 *   <div class="cf-stage" ref="stageRef" @wheel="cf.onWheel" @pointerdown="cf.onStagePointerDown">
 *     <div class="cf-item" @click="onItemClick(i)" @mouseenter="cf.onItemHover(i)" @mouseleave="cf.onItemLeave">
 *   </div>
 */

import { type Ref, type ComputedRef, nextTick } from 'vue'
import gsap from 'gsap'
import { useSfx } from '@/composables/useSfx'

export interface CoverflowListConfig {
  /** 列表项数量 (响应式) */
  count: Ref<number> | ComputedRef<number>
  /** 列表项的 CSS class (用于 querySelectorAll 缓存) */
  itemClass: string
  /** 3D 舞台根元素的 ref */
  stageEl: Ref<HTMLElement | null>

  // ── 布局常量 (均可选，有默认值) ──
  /** 项间距 (px) */
  itemSpacing?: number
  /** 向上最大可见项数 */
  maxVisibleAbove?: number
  /** 向下最大可见项数 */
  maxVisibleBelow?: number
  /** LERP 插值速度 (0~1, 越大越快) */
  lerpSpeed?: number
  /** 前景项 Z 轴悬浮高度 (px) */
  cardFloatZ?: number
  /** 两侧项 Z 轴递减速率 (0~1) */
  cardFloatFalloff?: number
  /** 滚轮 deltaY 累积阈值 (越大需要更用力滚动) */
  wheelStep?: number
  /** 滚轮重置间隔 (ms) */
  wheelResetMs?: number
  /** 拖拽灵敏度 (越大拖拽滚动越快) */
  dragSensitivity?: number
}

export function useCoverflowList(config: CoverflowListConfig) {
  const {
    count,
    itemClass,
    stageEl,
    itemSpacing = 76,
    maxVisibleAbove = 3,
    maxVisibleBelow = 8,
    lerpSpeed = 0.22,
    cardFloatZ = 80,
    cardFloatFalloff = 0.35,
    wheelStep = 80,
    wheelResetMs = 200,
    dragSensitivity = 0.014,
  } = config

  // ── Scroll state ──
  let scroll = 0
  let target = 0
  let rafId = 0
  let disposed = false
  let rafRunning = false

  // ── Cached DOM elements ──
  let cachedItems: HTMLElement[] = []
  let cachedStage: HTMLElement | null = null

  // ── Per-item cached state (skip redundant DOM writes) ──
  interface ItemCache {
    transform: string
    opacity: string
    zIndex: string
    pointerEvents: string
    visibility: string
    focus: boolean
    hovered: boolean
  }
  let itemCache: ItemCache[] = []

  // ── Hovered index (for 3D tilt) ──
  let hoveredIndex = -1
  let hoverTiltX = 0, hoverTiltY = 0
  let targetTiltX = 0, targetTiltY = 0

  // ── Click vs drag detection ──
  let pDownX = 0, pDownY = 0, pDownTime = 0
  let pUpX = 0, pUpY = 0

  // ── Drag-to-scroll state ──
  let dragScrolling = false
  let dragLastY = 0
  let dragLastTime = 0
  let dragVel = 0
  let dragMovePending = false
  const snapProxy = { v: 0 }

  // ── Wheel accumulation ──
  let wheelAccum = 0
  let lastWheelTime = 0

  // ── SFX (detent on focus change) ──
  const sfx = useSfx()
  let lastFocusIdx = -1

  // ── Public API ──

  function isFocus(i: number): boolean {
    return Math.abs(i - scroll) < 0.5
  }

  /** GSAP 缓动动画到指定索引 */
  function snapTo(i: number) {
    gsap.killTweensOf(snapProxy)
    snapProxy.v = target
    gsap.to(snapProxy, {
      v: i,
      duration: 0.35,
      ease: 'power3.out',
      onUpdate: () => { target = snapProxy.v },
    })
    ensureLoop()
  }

  /** 判断最近一次 pointer 交互是否为"点击" (非拖拽) */
  function isItemClick(): boolean {
    const dx = Math.abs(pDownX - pUpX)
    const dy = Math.abs(pDownY - pUpY)
    const dt = performance.now() - pDownTime
    return dx <= 8 && dy <= 8 && dt <= 500
  }

  /** 滚轮事件: 一格滚动一项 */
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    e.stopPropagation()
    const now = performance.now()
    if (now - lastWheelTime > wheelResetMs) wheelAccum = 0
    lastWheelTime = now
    wheelAccum += e.deltaY
    if (Math.abs(wheelAccum) < wheelStep) return
    const d = wheelAccum > 0 ? 1 : -1
    wheelAccum = 0
    const newTarget = Math.max(0, Math.min(count.value - 1, Math.round(target) + d))
    if (newTarget === target) return
    gsap.killTweensOf(snapProxy)
    snapProxy.v = target
    gsap.to(snapProxy, {
      v: newTarget,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate: () => { target = snapProxy.v },
    })
    ensureLoop()
  }

  function onItemHover(i: number) {
    hoveredIndex = i
    targetTiltX = 0
    targetTiltY = 0
    ensureLoop()
  }

  function onItemLeave() {
    hoveredIndex = -1
    targetTiltX = 0
    targetTiltY = 0
    ensureLoop()
  }

  /** 拖拽开始: pointerdown on stage */
  function onStagePointerDown(e: PointerEvent) {
    pDownX = e.clientX
    pDownY = e.clientY
    pDownTime = performance.now()
    dragScrolling = true
    dragLastY = e.clientY
    dragLastTime = performance.now()
    dragVel = 0
    gsap.killTweensOf(snapProxy)
  }

  // ── Document-level handlers (bound in init) ──
  function onDocPointerMove(e: PointerEvent) {
    if (!dragScrolling) return
    const dy = e.clientY - dragLastY
    const now = performance.now()
    const dt = Math.max(1, now - dragLastTime)
    dragVel = dy / dt
    dragLastY = e.clientY
    dragLastTime = now
    target -= dy * dragSensitivity
    target = Math.max(0, Math.min(count.value - 1, target))
    if (!dragMovePending) {
      dragMovePending = true
      requestAnimationFrame(() => {
        dragMovePending = false
        ensureLoop()
      })
    }
  }

  function onDocPointerUp(e: PointerEvent) {
    pUpX = e.clientX
    pUpY = e.clientY
    if (!dragScrolling) return
    dragScrolling = false
    if (Math.abs(dragVel) > 0.01) {
      const inertia = target - dragVel * 5
      const clamped = Math.max(0, Math.min(count.value - 1, inertia))
      snapProxy.v = target
      gsap.to(snapProxy, {
        v: Math.round(clamped),
        duration: 0.4,
        ease: 'power3.out',
        onUpdate: () => { target = snapProxy.v },
      })
    } else {
      snapProxy.v = target
      gsap.to(snapProxy, {
        v: Math.round(target),
        duration: 0.25,
        ease: 'power3.out',
        onUpdate: () => { target = snapProxy.v },
      })
    }
    dragVel = 0
    ensureLoop()
  }

  // ── Layout (called every RAF frame) ──
  function layout() {
    // Clamp target/scroll to valid range (handles count changes from search/filter)
    const maxIdx = Math.max(0, count.value - 1)
    if (target > maxIdx) target = maxIdx
    if (target < 0) target = 0
    if (scroll > maxIdx + 1) scroll = maxIdx

    scroll += (target - scroll) * lerpSpeed
    if (Math.abs(target - scroll) < 0.001) {
      scroll = target
    }

    // ── Detent sound when focus index crosses an integer boundary ──
    const focusIdx = Math.round(scroll)
    if (focusIdx !== lastFocusIdx && lastFocusIdx !== -1) {
      sfx.detent()
    }
    lastFocusIdx = focusIdx
    hoverTiltX += (targetTiltX - hoverTiltX) * 0.1
    hoverTiltY += (targetTiltY - hoverTiltY) * 0.1

    if (!cachedStage || cachedItems.length === 0) return

    // Ensure itemCache array matches cachedItems length
    if (itemCache.length !== cachedItems.length) {
      itemCache = cachedItems.map(() => ({
        transform: '', opacity: '', zIndex: '', pointerEvents: '',
        visibility: '', focus: false, hovered: false,
      }))
    }

    for (let idx = 0; idx < cachedItems.length; idx++) {
      const el = cachedItems[idx]
      const p = idx - scroll
      const absP = Math.abs(p)
      const cache = itemCache[idx]

      // ── Visibility: skip items outside visible range ──
      if (p < -maxVisibleAbove - 0.5 || p > maxVisibleBelow + 0.5) {
        if (cache.visibility !== 'hidden') {
          el.style.visibility = 'hidden'
          cache.visibility = 'hidden'
        }
        continue
      }
      if (cache.visibility !== 'visible') {
        el.style.visibility = 'visible'
        cache.visibility = 'visible'
      }

      const y = itemSpacing * p
      const z = cardFloatZ * Math.max(0, 1 - absP * cardFloatFalloff)
      const scale = Math.max(0.5, 1 - 0.11 * absP)
      const rotX = Math.max(-10, Math.min(10, 2.5 * p))
      const opacity = absP < 0.5 ? 1 : Math.max(0.08, 1 - 0.22 * absP)
      const zIndex = Math.round(100 - absP * 10)
      const pe = absP < 1.5 ? 'auto' : 'none'
      const isFocus = absP < 0.5
      const isHovered = hoveredIndex === idx

      // ── Only write to DOM when values actually changed ──
      const transform = `translate(-50%, -50%) translate3d(0, ${y}px, ${z}px) rotateX(${rotX}deg) scale(${scale})`
      if (cache.transform !== transform) {
        el.style.transform = transform
        cache.transform = transform
      }
      const opacityStr = String(opacity)
      if (cache.opacity !== opacityStr) {
        el.style.opacity = opacityStr
        cache.opacity = opacityStr
      }
      const zIndexStr = String(zIndex)
      if (cache.zIndex !== zIndexStr) {
        el.style.zIndex = zIndexStr
        cache.zIndex = zIndexStr
      }
      if (cache.pointerEvents !== pe) {
        el.style.pointerEvents = pe
        cache.pointerEvents = pe
      }
      if (cache.focus !== isFocus) {
        el.classList.toggle('focus', isFocus)
        cache.focus = isFocus
      }
      if (cache.hovered !== isHovered) {
        el.classList.toggle('hovered', isHovered)
        cache.hovered = isHovered
      }
    }
  }

  function startLoop() {
    if (rafRunning) return
    rafRunning = true
    function loop() {
      if (disposed) { rafRunning = false; return }
      rafId = requestAnimationFrame(loop)
      layout()
      const settled = Math.abs(target - scroll) < 0.001 &&
        Math.abs(targetTiltX - hoverTiltX) < 0.01 &&
        Math.abs(targetTiltY - hoverTiltY) < 0.01
      if (settled) {
        scroll = target
        layout()
        rafRunning = false
        return
      }
    }
    loop()
  }

  function ensureLoop() {
    if (!rafRunning && !disposed) startLoop()
  }

  /** 重新缓存 DOM 元素 (items 变化时调用) */
  function refresh() {
    cachedStage = stageEl.value
    if (cachedStage) {
      cachedItems = Array.from(cachedStage.querySelectorAll(`.${itemClass}`)) as HTMLElement[]
      // Reset item cache to force fresh DOM writes
      itemCache = cachedItems.map(() => ({
        transform: '', opacity: '', zIndex: '', pointerEvents: '',
        visibility: '', focus: false, hovered: false,
      }))
    }
  }

  /** 在 onMounted 中调用 */
  async function init() {
    await nextTick()
    refresh()
    document.addEventListener('pointermove', onDocPointerMove)
    document.addEventListener('pointerup', onDocPointerUp)
    document.addEventListener('pointercancel', onDocPointerUp)
    startLoop()
  }

  /** 在 onUnmounted 中调用 */
  function destroy() {
    disposed = true
    cancelAnimationFrame(rafId)
    gsap.killTweensOf(snapProxy)
    document.removeEventListener('pointermove', onDocPointerMove)
    document.removeEventListener('pointerup', onDocPointerUp)
    document.removeEventListener('pointercancel', onDocPointerUp)
    cachedItems = []
    cachedStage = null
  }

  return {
    isFocus,
    isItemClick,
    snapTo,
    onWheel,
    onStagePointerDown,
    onItemHover,
    onItemLeave,
    refresh,
    init,
    destroy,
  }
}
