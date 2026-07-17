/**
 * useSpiralCards — 3D 圆柱卡片布局 Composable
 *
 * 核心设计 (圆柱形):
 *   - 圆柱布局: 所有卡片在同一 Y 高度, 围绕 Y 轴均匀分布
 *   - Billboard 模式: 卡片始终正面朝向用户
 *   - 3D 穿插: canvas 被 reparent 到同一 preserve-3d 舞台,
 *       canvas 在 translateZ(-1px), 前半圆柱卡片 (Z>0) 在 canvas 前方,
 *       后半圆柱卡片 (Z<0) 在 canvas 后方 (透过 canvas 透明区域可见),
 *       形成完整的圆柱形包裹 3D 预设元素的效果
 *   - 拖拽旋转: 水平拖拽旋转圆柱, 释放后 snap 到最近卡片
 *   - 滚轮: 逐张切换卡片
 *   - GSAP 缓动 snap (平滑归位)
 */

import { ref, computed, watch, nextTick, type Ref } from 'vue'
import gsap from 'gsap'

export interface SpiralCardsConfig {
  items: Ref<any[]>
  rotorEl: Ref<HTMLElement | null>
  itemClass: string
  pageSize?: number
  /** 圆柱半径 (px) */
  orbitRadius?: number
  /** LERP 插值速度 (0~1, 越大越快) */
  lerpSpeed?: number
  /** 水平拖拽灵敏度 (rad/px) */
  dragSensitivityY?: number
}

export function useSpiralCards(config: SpiralCardsConfig) {
  const {
    items,
    rotorEl,
    itemClass,
    pageSize = 25,
    orbitRadius = 380,
    lerpSpeed = 0.35,
    dragSensitivityY = 0.004,
  } = config

  // ── Pagination ──
  const currentPage = ref(1)
  const totalPages = computed(() => Math.ceil(items.value.length / pageSize) || 1)

  const pageItems = computed(() => {
    const start = (currentPage.value - 1) * pageSize
    return items.value.slice(start, start + pageSize)
  })

  function nextPage() {
    if (currentPage.value < totalPages.value) currentPage.value++
  }
  function prevPage() {
    if (currentPage.value > 1) currentPage.value--
  }

  // ── Rotation state ──
  let rotationY = 0
  let targetRotationY = 0
  let isDragging = false
  let rafId = 0
  let disposed = false
  let rafRunning = false

  // ── Drag state ──
  let dragStartX = 0
  let dragStartRotY = 0
  let dragVelX = 0
  let lastDragX = 0
  let lastDragTime = 0

  // ── Click vs drag detection ──
  let pDownX = 0, pDownY = 0, pDownTime = 0
  let pUpX = 0, pUpY = 0

  // ── GSAP snap proxy ──
  const snapProxy = { v: 0 }

  // ── Cached DOM ──
  let cachedRotor: HTMLElement | null = null
  let cachedItems: HTMLElement[] = []
  let cardAngles: number[] = []
  let angleStep = 0

  const cardCache: Array<{
    z?: string; sds?: string; op?: string; vis?: string; pe?: string; focus?: boolean
  }> = []

  // ── Layout: compute cylinder positions ──
  function computeLayout() {
    const count = cachedItems.length
    if (count === 0) return

    cardAngles = new Array(count)
    angleStep = (Math.PI * 2) / count
    cardCache.length = 0

    for (let i = 0; i < count; i++) {
      const el = cachedItems[i]
      const angle = i * angleStep
      cardAngles[i] = angle

      const x = Math.sin(angle) * orbitRadius
      const z = Math.cos(angle) * orbitRadius
      const y = 0

      el.style.setProperty('--sx', `${x}px`)
      el.style.setProperty('--sy', `${y}px`)
      el.style.setProperty('--sz', `${z}px`)
      el.style.visibility = 'visible'
      el.style.willChange = 'transform, opacity'
    }

    targetRotationY = 0
    rotationY = 0
  }

  // ── Per-frame tick ──
  function tick() {
    const diffY = targetRotationY - rotationY
    rotationY += diffY * lerpSpeed
    if (Math.abs(diffY) < 0.00005) rotationY = targetRotationY

    if (cachedRotor) {
      cachedRotor.style.transform = `rotateY(${rotationY}rad)`
    }

    const counterRotY = `${-rotationY}rad`
    // 将 counter-rotation 设在父元素 (CSS 自定义属性可继承), 而非每张卡片
    if (cachedRotor) {
      cachedRotor.style.setProperty('--sry', counterRotY)
    }

    const count = cachedItems.length

    // 注意: CSS rotateY(rotationY) 旋转后, 卡片的有效 Z = R * cos(angle + rotationY)
    // 前方卡片在 angle = -rotationY 处 (有效 Z 最大 = R)
    // 所以 focusedIdx 用 -rotationY 而非 rotationY
    const focusedIdx = count > 0
      ? ((Math.round(-rotationY / angleStep) % count) + count) % count
      : -1

    for (let i = 0; i < count; i++) {
      const el = cachedItems[i]
      if (!el) continue

      const cache = cardCache[i] || (cardCache[i] = {})

      // Billboard: counter-rotate inherited from parent --sry (no per-card set needed)

      // World Z: effective depth in camera space after rotor rotation
      // CSS rotateY(ry) rotates (x,z) → (x*cos+ z*sin, -x*sin+ z*cos)
      // For card at angle a: effectiveZ = R * cos(a + ry)
      const worldZ = Math.cos(cardAngles[i] + rotationY) * orbitRadius

      // All cards visible — cylinder wraps around the 3D visualizer canvas.
      // Back-half cards (worldZ < 0) are behind the canvas but visible through
      // its transparent areas, creating a full cylindrical arrangement.
      if (cache.vis !== 'visible') {
        el.style.visibility = 'visible'
        cache.vis = 'visible'
      }

      const normalizedDepth = (worldZ + orbitRadius) / (2 * orbitRadius) // 0 (back) → 1 (front)

      // z-index: higher Z = closer to viewer = higher z-index
      const zStr = String(Math.round(worldZ + orbitRadius + 100))
      if (cache.z !== zStr) {
        el.style.zIndex = zStr
        cache.z = zStr
      }

      // Depth scale: front=1.0, back=0.75 (clear cylinder shape)
      const depthScale = 0.75 + 0.25 * normalizedDepth
      const sdsStr = depthScale.toFixed(3)
      if (cache.sds !== sdsStr) {
        el.style.setProperty('--sds', sdsStr)
        cache.sds = sdsStr
      }

      // Depth opacity: front cards fully opaque, back cards dimmed to 0.55
      // High enough to be visible on dark background, low enough for depth perception
      const depthOpacity = worldZ < 0 ? 0.55 : 1.0
      const opStr = String(depthOpacity)
      if (cache.op !== opStr) {
        el.style.opacity = opStr
        cache.op = opStr
      }

      // pointer-events: only front-facing cards (within 3 angle steps) are clickable
      // Angular distance from front = angle + rotationY (modulo 2π)
      const angleFromFront = ((cardAngles[i] + rotationY) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
      const actualDiff = Math.min(angleFromFront, Math.PI * 2 - angleFromFront)
      const peStr = actualDiff < angleStep * 3 ? 'auto' : 'none'
      if (cache.pe !== peStr) {
        el.style.pointerEvents = peStr
        cache.pe = peStr
      }

      // Focus class for front card
      const isFocus = i === focusedIdx
      if (cache.focus !== isFocus) {
        el.classList.toggle('focus', isFocus)
        cache.focus = isFocus
      }
    }
  }

  function startLoop() {
    if (rafRunning) return
    rafRunning = true
    function loop() {
      if (disposed) { rafRunning = false; return }
      rafId = requestAnimationFrame(loop)
      tick()
      if (Math.abs(targetRotationY - rotationY) < 0.0005) {
        rotationY = targetRotationY
        tick()
        rafRunning = false
        return
      }
    }
    loop()
  }

  function ensureLoop() {
    if (!rafRunning && !disposed) startLoop()
  }

  function snapToNearest() {
    if (cachedItems.length === 0) return
    const nearestAngle = Math.round(targetRotationY / angleStep) * angleStep
    gsap.killTweensOf(snapProxy)
    // 从当前视觉位置开始动画, 而非 targetRotationY
    // 避免 rotationY 滞后 targetRotationY 导致松手跳动
    snapProxy.v = rotationY
    gsap.to(snapProxy, {
      v: nearestAngle,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate: () => {
        rotationY = snapProxy.v        // GSAP 直接控制视觉位置
        targetRotationY = snapProxy.v  // 保持 target 同步 → LERP diff=0 空闲
      },
    })
    ensureLoop()
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (cachedItems.length === 0) return
    const direction = e.deltaY > 0 ? 1 : -1
    const currentIdx = Math.round(targetRotationY / angleStep)
    const newTarget = (currentIdx + direction) * angleStep
    gsap.killTweensOf(snapProxy)
    snapProxy.v = rotationY
    gsap.to(snapProxy, {
      v: newTarget,
      duration: 0.4,
      ease: 'power2.out',
      onUpdate: () => {
        rotationY = snapProxy.v
        targetRotationY = snapProxy.v
      },
    })
    ensureLoop()
  }

  function onPointerDown(e: PointerEvent) {
    e.stopPropagation()
    pDownX = e.clientX
    pDownY = e.clientY
    pDownTime = performance.now()

    isDragging = true
    dragStartX = e.clientX
    dragStartRotY = targetRotationY
    lastDragX = e.clientX
    lastDragTime = performance.now()
    dragVelX = 0

    gsap.killTweensOf(snapProxy)
    ensureLoop()
  }

  function onDocPointerMove(e: PointerEvent) {
    if (!isDragging) return

    const dx = e.clientX - dragStartX
    const newTarget = dragStartRotY + dx * dragSensitivityY
    // 设 targetRotationY, LERP 以较高速度逼近, 循环持续运行不启停
    targetRotationY = newTarget

    const now = performance.now()
    const dt = Math.max(1, now - lastDragTime)
    dragVelX = (e.clientX - lastDragX) / dt
    lastDragX = e.clientX
    lastDragTime = now

    ensureLoop()
  }

  function onDocPointerUp(e: PointerEvent) {
    pUpX = e.clientX
    pUpY = e.clientY
    if (!isDragging) return
    isDragging = false

    const maxInertia = 0.8
    const inertiaFactor = 15
    const inertia = Math.max(-maxInertia, Math.min(maxInertia, dragVelX * inertiaFactor))
    // 惯性加到 targetRotationY, snapToNearest 会从当前 rotationY 平滑动画到目标
    targetRotationY += inertia
    // 立即调用 snap, 不用 rAF — 避免 rAF 延迟导致 LERP 跳一帧
    snapToNearest()

    dragVelX = 0
  }

  function isItemClick(): boolean {
    const dx = Math.abs(pDownX - pUpX)
    const dy = Math.abs(pDownY - pUpY)
    const dt = performance.now() - pDownTime
    return dx <= 8 && dy <= 8 && dt <= 500
  }

  function getFocusIndex(): number {
    if (cachedItems.length === 0) return -1
    return ((Math.round(-rotationY / angleStep) % cachedItems.length) + cachedItems.length) % cachedItems.length
  }

  function refresh() {
    // Remove wheel listener from old rotor before switching
    if (cachedRotor) {
      cachedRotor.removeEventListener('wheel', onWheel)
    }
    cachedRotor = rotorEl.value
    if (cachedRotor) {
      cachedItems = Array.from(
        cachedRotor.querySelectorAll(`.${itemClass}`)
      ) as HTMLElement[]
      cachedRotor.addEventListener('wheel', onWheel, { passive: false })
    } else {
      cachedItems = []
    }
    computeLayout()
    ensureLoop()
  }

  async function init() {
    await nextTick()
    refresh()
    document.addEventListener('pointermove', onDocPointerMove)
    document.addEventListener('pointerup', onDocPointerUp)
    document.addEventListener('pointercancel', onDocPointerUp)
    // Wheel listener on rotor: wheel events on cards bubble to rotor,
    // where spiral.onWheel handles card rotation + stopPropagation.
    // Wheel on empty stage area goes to visualizer for 3D zoom.
    if (cachedRotor) {
      cachedRotor.addEventListener('wheel', onWheel, { passive: false })
    }
    startLoop()
  }

  function destroy() {
    disposed = true
    cancelAnimationFrame(rafId)
    gsap.killTweensOf(snapProxy)
    document.removeEventListener('pointermove', onDocPointerMove)
    document.removeEventListener('pointerup', onDocPointerUp)
    document.removeEventListener('pointercancel', onDocPointerUp)
    if (cachedRotor) {
      cachedRotor.removeEventListener('wheel', onWheel)
    }
    cachedRotor = null
    cachedItems = []
  }

  watch(() => items.value.length, async () => {
    if (currentPage.value > totalPages.value) {
      currentPage.value = Math.max(1, totalPages.value)
    }
    await nextTick()
    refresh()
  })

  watch(currentPage, async () => {
    await nextTick()
    refresh()
  })

  watch(() => items.value, async () => {
    if (currentPage.value > totalPages.value) {
      currentPage.value = Math.max(1, totalPages.value)
    }
    await nextTick()
    refresh()
  }, { deep: false })

  return {
    currentPage,
    totalPages,
    pageItems,
    nextPage,
    prevPage,
    onPointerDown,
    onWheel,
    isItemClick,
    getFocusIndex,
    init,
    destroy,
    refresh,
  }
}
