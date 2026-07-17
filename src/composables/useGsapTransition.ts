/**
 * GSAP 过渡动画 composable
 *
 * 提供基于 GSAP 的 Vue <Transition> JS hooks 和列表入场动画函数，
 * 替代原有的 CSS @keyframes / CSS transition-class 方案。
 *
 * 标准模式:
 *   页面切换 → usePageTransition()
 *   菜单/模态 → useModalTransition()
 *   下拉弹出 → useDropdownTransition()
 *   Toast    → useToastTransition()
 *   卡片列表 → animateStagger()
 *   骨架屏→内容 → animateContentEntrance()
 *   脉冲指示器 → animatePulse()
 *   旋转图标 → animateSpin()
 *   骨架屏 shimmer → animateShimmer()
 *
 * 所有连续动画 (pulse/spin/shimmer) 返回 cleanup 函数，在 onUnmounted 时调用。
 */
import gsap from 'gsap'

// ── 缓动常量 (与 CSS 自定义属性对齐) ──
const EASE_ENTER = 'power2.out'
const EASE_EXIT = 'power2.in'
const EASE_SPRING = 'back.out(1.56)'
const EASE_CONTEXTUAL = 'power2.out'
const EASE_INOUT = 'sine.inOut'

// ── 时长常量 (与 CSS 自定义属性对齐) ──
const DURATION_MICRO = 0.15
const DURATION_PANEL = 0.3
const DURATION_PAGE = 0.35

// ================================================================
// Vue <Transition> JS hooks
// 使用 :css="false" 禁用 CSS 过渡检测，完全由 GSAP 控制。
// ================================================================

/**
 * 页面切换过渡 — 交叉溶解 + 轻微 Y 轴位移
 * 配合 <Transition mode="out-in" :css="false">
 */
export function usePageTransition() {
  function onEnter(el: Element, done: () => void) {
    gsap.fromTo(el,
      { y: 12, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: DURATION_PAGE, ease: EASE_ENTER, onComplete: done }
    )
  }

  function onLeave(el: Element, done: () => void) {
    gsap.to(el,
      { y: -8, autoAlpha: 0, duration: 0.2, ease: EASE_EXIT, onComplete: done }
    )
  }

  return { onEnter, onLeave, css: false }
}

/**
 * 遮罩层过渡 — 简单淡入淡出（无位移，避免 backdrop-filter 闪烁）
 */
export function useBackdropTransition() {
  function onEnter(el: Element, done: () => void) {
    gsap.fromTo(el,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.2, ease: EASE_ENTER, onComplete: done }
    )
  }

  function onLeave(el: Element, done: () => void) {
    gsap.to(el,
      { autoAlpha: 0, duration: 0.2, ease: EASE_EXIT, onComplete: done }
    )
  }

  return { onEnter, onLeave, css: false }
}

/**
 * 模态/对话框过渡 — 缩放 + Y 轴位移
 * 模态容器需要 .modal-content 子元素作为动画目标。
 *
 * 注意: 使用 opacity 而非 autoAlpha，避免 visibility:hidden
 * 导致 FrostedGlass 的 backdrop-filter 不渲染的问题。
 */
export function useModalTransition() {
  function onEnter(el: Element, done: () => void) {
    const content = (el as HTMLElement).querySelector('.modal-content')
    // 立即设置 overlay 可见 (opacity:1, 不碰 visibility)
    gsap.set(el, { opacity: 1 })
    if (content) {
      gsap.fromTo(content,
        { scale: 0.94, y: 12, opacity: 0 },
        { scale: 1, y: 0, opacity: 1, duration: DURATION_PANEL, ease: EASE_CONTEXTUAL, clearProps: 'transform,opacity', onComplete: done }
      )
    } else {
      gsap.fromTo(el,
        { scale: 0.94, y: 12, opacity: 0 },
        { scale: 1, y: 0, opacity: 1, duration: DURATION_PANEL, ease: EASE_CONTEXTUAL, clearProps: 'transform,opacity', onComplete: done }
      )
    }
  }

  function onLeave(el: Element, done: () => void) {
    const content = (el as HTMLElement).querySelector('.modal-content')
    const target = content || el
    gsap.to(target,
      { scale: 0.96, y: -4, opacity: 0, duration: 0.2, ease: EASE_EXIT, onComplete: () => {
        gsap.set(el, { opacity: 0 })
        done()
      }}
    )
  }

  return { onEnter, onLeave, css: false }
}

/**
 * 下拉菜单/弹出面板过渡 — 缩放 + Y 轴位移 + 弹性
 * @param transformOrigin CSS transform-origin 值，默认 'top right'
 */
export function useDropdownTransition(transformOrigin = 'top right') {
  function onEnter(el: Element, done: () => void) {
    gsap.set(el, { visibility: 'visible', transformOrigin })
    gsap.fromTo(el,
      { scale: 0.96, y: -8, autoAlpha: 0 },
      { scale: 1, y: 0, autoAlpha: 1, duration: 0.2, ease: EASE_SPRING, onComplete: done }
    )
  }

  function onLeave(el: Element, done: () => void) {
    gsap.to(el,
      { scale: 0.98, y: -4, autoAlpha: 0, duration: 0.15, ease: EASE_EXIT, onComplete: () => {
        gsap.set(el, { visibility: 'hidden' })
        done()
      }}
    )
  }

  return { onEnter, onLeave, css: false }
}

/**
 * Toast 通知过渡 — 从上方滑入 + 淡入
 */
export function useToastTransition() {
  function onEnter(el: Element, done: () => void) {
    gsap.fromTo(el,
      { y: -20, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.25, ease: EASE_SPRING, onComplete: done }
    )
  }

  function onLeave(el: Element, done: () => void) {
    gsap.to(el,
      { y: -20, autoAlpha: 0, duration: 0.2, ease: EASE_EXIT, onComplete: done }
    )
  }

  return { onEnter, onLeave, css: false }
}

/**
 * 水平滑动过渡 — 从右侧滑入
 */
export function useSlideTransition() {
  function onEnter(el: Element, done: () => void) {
    gsap.fromTo(el,
      { x: 8, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.25, ease: EASE_ENTER, onComplete: done }
    )
  }

  function onLeave(el: Element, done: () => void) {
    gsap.to(el,
      { x: 8, autoAlpha: 0, duration: 0.2, ease: EASE_EXIT, onComplete: done }
    )
  }

  return { onEnter, onLeave, css: false }
}

/**
 * 淡入淡出过渡 — 用于 hint/提示类元素
 */
export function useFadeTransition(duration = 0.4) {
  function onEnter(el: Element, done: () => void) {
    gsap.fromTo(el,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration, ease: EASE_ENTER, onComplete: done }
    )
  }

  function onLeave(el: Element, done: () => void) {
    gsap.to(el,
      { autoAlpha: 0, duration: Math.min(duration, 0.3), ease: EASE_EXIT, onComplete: done }
    )
  }

  return { onEnter, onLeave, css: false }
}

// ================================================================
// 列表/内容入场动画
// ================================================================

/**
 * 卡片列表交错入场动画
 * 在内容容器渲染后调用，对 .stagger-item 子元素执行 GSAP stagger。
 *
 * @param container 内容容器元素
 * @param selector  子元素选择器，默认 '.stagger-item'
 * @param stagger   每项延迟 (秒)，默认 0.035
 */
export function animateStagger(
  container: HTMLElement | null,
  selector = '.stagger-item',
  stagger = 0.035
) {
  if (!container) return
  const items = container.querySelectorAll(selector)
  if (items.length === 0) return
  gsap.fromTo(items,
    { y: 10, scale: 0.98, autoAlpha: 0 },
    { y: 0, scale: 1, autoAlpha: 1, duration: 0.35, ease: EASE_ENTER, stagger, clearProps: 'transform,opacity,visibility' }
  )
}

/**
 * 骨架屏 → 真实内容入场动画
 * 在 v-if/v-else 切换后调用（loading → loaded），对内容容器执行淡入。
 *
 * @param el 内容容器元素
 */
export function animateContentEntrance(el: HTMLElement | null) {
  if (!el) return
  gsap.fromTo(el,
    { y: 4, autoAlpha: 0 },
    { y: 0, autoAlpha: 1, duration: 0.4, ease: EASE_ENTER, clearProps: 'transform,opacity,visibility' }
  )
}

// ================================================================
// 连续动画 (返回 cleanup 函数)
// ================================================================

/**
 * 脉冲指示器动画 — 适用于 loading dot
 * @param el 目标元素
 * @param config 可选配置 { scale, opacity, duration }
 * @returns cleanup 函数，在 onUnmounted 时调用
 */
export function animatePulse(
  el: HTMLElement | null,
  config?: { scale?: number; opacity?: number; duration?: number }
): () => void {
  if (!el) return () => {}
  const { scale = 1.4, opacity = 1, duration = 0.6 } = config || {}
  const tween = gsap.fromTo(el,
    { scale: 1, opacity: 0.5 },
    { scale, opacity, duration, repeat: -1, yoyo: true, ease: EASE_INOUT }
  )
  return () => { tween.kill(); gsap.set(el, { clearProps: 'scale,opacity' }) }
}

/**
 * 脉冲环动画 — 适用于空状态环形指示器
 * @param el 目标元素
 * @returns cleanup 函数
 */
export function animatePulseRing(el: HTMLElement | null): () => void {
  if (!el) return () => {}
  const tween = gsap.fromTo(el,
    { scale: 1, autoAlpha: 0.3 },
    { scale: 1.05, autoAlpha: 0.5, duration: 1.5, repeat: -1, yoyo: true, ease: EASE_INOUT }
  )
  return () => { tween.kill(); gsap.set(el, { clearProps: 'scale,opacity,visibility' }) }
}

/**
 * 旋转动画 — 适用于刷新/同步图标
 * @param el 目标元素
 * @returns cleanup 函数
 */
export function animateSpin(el: HTMLElement | null): () => void {
  if (!el) return () => {}
  const tween = gsap.to(el, { rotation: 360, duration: 1, repeat: -1, ease: 'none' })
  return () => { tween.kill(); gsap.set(el, { clearProps: 'rotation' }) }
}

/**
 * 骨架屏 shimmer 动画 — 替代 CSS @keyframes skeleton-shimmer
 * 通过 GSAP 动画 CSS 自定义属性 --shimmer-pos，
 * .skeleton::after 使用 background-position: var(--shimmer-pos, -200%) 0 读取。
 *
 * @param el 骨架屏元素
 * @returns cleanup 函数
 */
export function animateShimmer(el: HTMLElement | null): () => void {
  if (!el) return () => {}
  const tween = gsap.fromTo(el,
    { '--shimmer-pos': '-200%' },
    { '--shimmer-pos': '200%', duration: 2.2, repeat: -1, ease: EASE_INOUT }
  )
  return () => { tween.kill(); gsap.set(el, { clearProps: '--shimmer-pos' }) }
}

/**
 * 批量 shimmer — 对容器内所有 .skeleton 元素应用 shimmer
 * 通过 CSS 自定义属性 --shimmer-pos 驱动 .skeleton::after 的背景位移动画。
 * @param container 容器元素
 * @returns cleanup 函数
 */
export function animateShimmerAll(container: HTMLElement | null): () => void {
  if (!container) return () => {}
  const items = container.querySelectorAll('.skeleton')
  if (items.length === 0) return () => {}
  const tweens: gsap.core.Tween[] = []
  items.forEach(el => {
    tweens.push(
      gsap.fromTo(el,
        { '--shimmer-pos': '-200%' },
        { '--shimmer-pos': '200%', duration: 2.2, repeat: -1, ease: EASE_INOUT }
      )
    )
  })
  return () => { tweens.forEach(t => t.kill()); items.forEach(el => gsap.set(el, { clearProps: '--shimmer-pos' })) }
}

// ================================================================
// Vue 自定义指令 — 用于条件渲染的连续动画元素
// ================================================================

/**
 * v-gsap-pulse 指令 — 替代 CSS @keyframes pulse-dot
 * 用于条件出现的 loading dot 等元素。
 * 用法: <span class="loading-dot" v-gsap-pulse></span>
 */
export const vGsapPulse = {
  mounted(el: HTMLElement) {
    (el as any).__cleanupPulse = animatePulse(el, { scale: 1, opacity: 1, duration: 0.5 })
  },
  unmounted(el: HTMLElement) {
    const cleanup = (el as any).__cleanupPulse
    if (cleanup) cleanup()
  }
}
