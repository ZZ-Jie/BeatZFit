<script setup lang="ts">
/**
 * OnboardingOverlay — 交互式引导教程
 *
 * 逐步引导用户了解 BeatZFit 核心功能。
 * 每个步骤有聚光灯效果 (spotlight) + 动态弹跳箭头 + 信息卡片。
 * 用户可以跳过、前进、后退。
 */
import { ref, onMounted, onBeforeUnmount, computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import gsap from 'gsap'
import { useSfx } from '@/composables/useSfx'

const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const sfx = useSfx()

// ── 步骤定义 ──
interface TourStep {
  type: 'card' | 'spotlight'
  title: string
  subtitle: string
  description: string
  accent: string
  targetSelector?: string
  route?: string
  arrowSide?: 'top' | 'bottom' | 'left' | 'right'
}

const steps: TourStep[] = [
  {
    type: 'card',
    title: '欢迎来到 BeatZFit',
    subtitle: '用音乐驱动每一次训练',
    description: '音乐播放器、3D 音频可视化与健身训练融为一体。跟随引导，快速了解核心功能。',
    accent: '#7EC8E3',
  },
  {
    type: 'spotlight',
    title: '导航菜单',
    subtitle: '从这里出发',
    description: '点击此按钮展开弧形导航菜单，在首页、音乐库、动作库和数据页之间自由切换。',
    accent: '#7EC8E3',
    targetSelector: '.fab-main',
    arrowSide: 'bottom',
  },
  {
    type: 'card',
    title: '3D 交互',
    subtitle: '拖拽 · 缩放 · 点击',
    description: '在任意页面拖拽即可旋转 3D 场景，滚轮缩放。首页左右牌堆分别展示训练计划和歌单，点击卡片可展开悬浮详情列表。',
    accent: '#F5B041',
  },
  {
    type: 'spotlight',
    title: '导入音乐',
    subtitle: '本地 · 网易云 · QQ音乐',
    description: '点击此处导入本地音乐文件，或将鼠标移到左右边缘连接网易云 / QQ音乐。每首歌的封面将驱动独特的 3D 可视化效果。',
    accent: '#fa586a',
    targetSelector: '.empty-btn',
    route: '/music',
    arrowSide: 'top',
  },
  {
    type: 'spotlight',
    title: '同步动作库',
    subtitle: '1500+ 健身动作',
    description: '应用会自动同步 1500+ 健身动作。同步完成后，可按部位和器械筛选，创建专属训练计划。',
    accent: '#58D68D',
    targetSelector: '[data-tour-target="sync-btn"]',
    route: '/fitness',
    arrowSide: 'top',
  },
  {
    type: 'spotlight',
    title: 'DIY 个性化',
    subtitle: '3D 视觉 · 歌词 · 极光',
    description: '点击齿轮按钮打开 DIY 面板，调节 3D 视觉参数、歌词样式、极光色彩等个性化设置。',
    accent: '#BB86FC',
    targetSelector: '.diy-trigger-btn',
    arrowSide: 'bottom',
  },
  {
    type: 'card',
    title: '一切就绪',
    subtitle: '开始你的沉浸式训练之旅',
    description: '导入音乐、选择可视化预设、创建训练计划——享受音乐驱动的训练体验。',
    accent: '#7EC8E3',
    route: '/',
  },
]

// ── State ──
const currentStep = ref(0)
const rootRef = ref<HTMLElement | null>(null)
const cardRef = ref<HTMLElement | null>(null)
const arrowRef = ref<HTMLElement | null>(null)
const targetRect = ref<DOMRect | null>(null)

// Measured card dimensions (updated after render for accurate positioning)
const cardW = 340
const cardH = ref(200) // dynamic, measured after render

// Whether the card placement was flipped from the preferred side
const flipped = ref(false)

let tl: gsap.core.Timeline | null = null
let resizeObserver: ResizeObserver | null = null

const currentStepData = computed(() => steps[currentStep.value])
const isLastStep = computed(() => currentStep.value === steps.length - 1)
const isFirstStep = computed(() => currentStep.value === 0)
const progressPercent = computed(() => ((currentStep.value + 1) / steps.length) * 100)

// Effective arrow side — accounts for flipping when card doesn't fit
const effectiveArrowSide = computed(() => {
  const orig = currentStepData.value.arrowSide
  if (!flipped.value || !orig) return orig
  switch (orig) {
    case 'top': return 'bottom' as const
    case 'bottom': return 'top' as const
    case 'left': return 'right' as const
    case 'right': return 'left' as const
    default: return orig
  }
})

// ── Positioning ──
const spotlightStyle = computed(() => {
  if (!targetRect.value) return { display: 'none' }
  const r = targetRect.value
  const pad = 6
  return {
    left: `${r.left - pad}px`,
    top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`,
    height: `${r.height + pad * 2}px`,
    '--spotlight-accent': currentStepData.value.accent,
  } as any
})

const arrowStyle = computed(() => {
  if (!targetRect.value || !effectiveArrowSide.value) return { display: 'none' }
  const r = targetRect.value
  const side = effectiveArrowSide.value
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2

  switch (side) {
    case 'top':    return { left: `${cx}px`, top: `${r.top - 44}px`, transform: 'translateX(-50%)' }
    case 'bottom': return { left: `${cx}px`, top: `${r.bottom + 10}px`, transform: 'translateX(-50%)' }
    case 'left':   return { left: `${r.left - 44}px`, top: `${cy}px`, transform: 'translateY(-50%)' }
    case 'right':  return { left: `${r.right + 10}px`, top: `${cy}px`, transform: 'translateY(-50%)' }
  }
})

/**
 * Card position — smart placement that:
 * 1. Tries the preferred side (opposite of arrow)
 * 2. Flips to the other side if there isn't enough room
 * 3. Clamps to viewport bounds
 * 4. Never overlaps the arrow zone
 */
const cardPositionStyle = computed(() => {
  if (!targetRect.value || currentStepData.value.type !== 'spotlight') return {}
  const r = targetRect.value
  const side = effectiveArrowSide.value
  const ch = cardH.value
  const m = 16          // viewport margin
  const arrowGap = 52   // space for arrow between target and card

  let left: number
  let top: number

  if (side === 'top') {
    // Arrow above target → card below target
    left = r.left + r.width / 2 - cardW / 2
    top = r.bottom + arrowGap
    // Clamp vertically — if doesn't fit below, the flip logic already handled it
    top = Math.min(top, window.innerHeight - ch - m)
    top = Math.max(m, top)
  } else if (side === 'bottom') {
    // Arrow below target → card above target
    left = r.left + r.width / 2 - cardW / 2
    top = r.top - ch - arrowGap
    top = Math.max(m, top)
    top = Math.min(top, window.innerHeight - ch - m)
  } else if (side === 'left') {
    // Arrow left of target → card to the right
    left = r.right + arrowGap
    top = r.top + r.height / 2 - ch / 2
    top = Math.max(m, Math.min(top, window.innerHeight - ch - m))
  } else if (side === 'right') {
    // Arrow right of target → card to the left
    left = r.left - cardW - arrowGap
    top = r.top + r.height / 2 - ch / 2
    top = Math.max(m, Math.min(top, window.innerHeight - ch - m))
  } else {
    left = r.left + r.width / 2 - cardW / 2
    top = r.bottom + arrowGap
  }

  // Horizontal clamp
  left = Math.max(m, Math.min(left, window.innerWidth - cardW - m))

  return { left: `${left}px`, top: `${top}px`, width: `${cardW}px` }
})

const cardStyle = computed(() => {
  const accent = currentStepData.value.accent
  return {
    '--accent': accent,
    '--accent-glow': accent + '22',
  } as any
})

// ── Lifecycle ──
onMounted(() => {
  document.body.classList.add('onboarding-active')

  if (rootRef.value) {
    gsap.set(rootRef.value, { autoAlpha: 0 })
    gsap.to(rootRef.value, { autoAlpha: 1, duration: 0.3, ease: 'power2.out' })
  }
  performStepTransition()
  window.addEventListener('resize', updateTargetRect)
})

onBeforeUnmount(() => {
  document.body.classList.remove('onboarding-active')
  if (tl) tl.kill()
  if (rootRef.value) gsap.killTweensOf(rootRef.value)
  if (cardRef.value) gsap.killTweensOf(cardRef.value)
  if (arrowRef.value) gsap.killTweensOf(arrowRef.value)
  window.removeEventListener('resize', updateTargetRect)
  resizeObserver?.disconnect()
})

// ── Card measurement ──
function measureCard() {
  if (cardRef.value) {
    cardH.value = cardRef.value.offsetHeight
  }
}

// Re-measure when step changes (content height varies)
watch(currentStep, () => {
  nextTick(measureCard)
})

// ── Step transitions ──

async function performStepTransition() {
  const step = currentStepData.value

  // Navigate if needed
  if (step.route) {
    await router.push(step.route)
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // For spotlight steps, find the target element
  if (step.type === 'spotlight' && step.targetSelector) {
    await findTargetElement(step.targetSelector)
  } else {
    targetRect.value = null
  }

  await nextTick()
  // Pre-render the card to measure its height before positioning
  await nextTick()
  measureCard()

  // For spotlight steps, check if the card fits on the preferred side
  if (targetRect.value && step.arrowSide) {
    flipped.value = checkFlip()
  } else {
    flipped.value = false
  }

  await nextTick()
  animateCardIn()
}

/**
 * Check if the card fits on the preferred side.
 * If not, set flipped = true so effectiveArrowSide flips.
 */
function checkFlip(): boolean {
  const r = targetRect.value!
  const side = currentStepData.value.arrowSide!
  const ch = cardH.value
  const m = 16
  const arrowGap = 52

  if (side === 'top') {
    // Preferred: card below target
    const spaceBelow = window.innerHeight - r.bottom - arrowGap
    if (spaceBelow < ch + m) {
      // Not enough space below — check if there's space above
      const spaceAbove = r.top - arrowGap
      if (spaceAbove >= ch + m) return true // flip: card above, arrow below
    }
  } else if (side === 'bottom') {
    // Preferred: card above target
    const spaceAbove = r.top - arrowGap
    if (spaceAbove < ch + m) {
      const spaceBelow = window.innerHeight - r.bottom - arrowGap
      if (spaceBelow >= ch + m) return true // flip: card below, arrow above
    }
  } else if (side === 'left') {
    const spaceRight = window.innerWidth - r.right - arrowGap
    if (spaceRight < cardW + m) {
      const spaceLeft = r.left - arrowGap
      if (spaceLeft >= cardW + m) return true
    }
  } else if (side === 'right') {
    const spaceLeft = r.left - arrowGap
    if (spaceLeft < cardW + m) {
      const spaceRight = window.innerWidth - r.right - arrowGap
      if (spaceRight >= cardW + m) return true
    }
  }
  return false
}

async function findTargetElement(selector: string) {
  for (let i = 0; i < 20; i++) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        targetRect.value = rect
        resizeObserver?.disconnect()
        resizeObserver = new ResizeObserver(() => updateTargetRect())
        resizeObserver.observe(el)
        return
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  console.warn(`[Onboarding] Target element not found: ${selector}`)
  targetRect.value = null
}

function updateTargetRect() {
  const step = currentStepData.value
  if (step.type !== 'spotlight' || !step.targetSelector) return
  const el = document.querySelector<HTMLElement>(step.targetSelector)
  if (el) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      targetRect.value = rect
    }
  }
}

function animateCardIn() {
  if (!cardRef.value) return
  if (tl) tl.kill()

  const children = cardRef.value.children
  tl = gsap.timeline()
  tl.fromTo(cardRef.value,
    { autoAlpha: 0, scale: 0.96, y: 12 },
    { autoAlpha: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.1)' }
  )
  if (children.length > 0) {
    tl.fromTo(children,
      { y: 6, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.3, stagger: 0.04, ease: 'power2.out' },
      '-=0.18'
    )
  }

  // Animate arrow bounce
  if (arrowRef.value && targetRect.value) {
    gsap.killTweensOf(arrowRef.value)
    const side = effectiveArrowSide.value
    const off = (side === 'top' || side === 'left') ? -8 : 8
    if (side === 'top' || side === 'bottom') {
      gsap.fromTo(arrowRef.value,
        { y: off },
        { y: 0, duration: 0.6, repeat: -1, yoyo: true, ease: 'sine.inOut' }
      )
    } else {
      gsap.fromTo(arrowRef.value,
        { x: off },
        { x: 0, duration: 0.6, repeat: -1, yoyo: true, ease: 'sine.inOut' }
      )
    }
  }
}

async function nextStep() {
  sfx.detent()
  if (isLastStep.value) {
    finish()
    return
  }

  if (cardRef.value) {
    gsap.to(cardRef.value, {
      autoAlpha: 0, scale: 0.95, x: -14, duration: 0.2, ease: 'power2.in',
      onComplete: async () => {
        currentStep.value++
        await performStepTransition()
      }
    })
  } else {
    currentStep.value++
    await performStepTransition()
  }
}

async function prevStep() {
  sfx.detent()
  if (isFirstStep.value) return

  if (cardRef.value) {
    gsap.to(cardRef.value, {
      autoAlpha: 0, scale: 0.95, x: 14, duration: 0.2, ease: 'power2.in',
      onComplete: async () => {
        currentStep.value--
        await performStepTransition()
      }
    })
  } else {
    currentStep.value--
    await performStepTransition()
  }
}

async function finish() {
  sfx.confirm()
  try {
    await window.electronAPI?.settings?.set('onboarding_completed', 'true')
  } catch (e) {
    console.warn('[Onboarding] Failed to save completion:', e)
  }

  if (rootRef.value) {
    gsap.to(rootRef.value, {
      autoAlpha: 0, duration: 0.3, ease: 'power2.in',
      onComplete: () => emit('close')
    })
  } else {
    emit('close')
  }
}

function skip() {
  sfx.retract()
  finish()
}
</script>

<template>
  <div class="onboarding-overlay" ref="rootRef">
    <!-- Backdrop with spotlight cutout -->
    <div class="ob-backdrop" :class="{ 'has-spotlight': !!targetRect }">
      <div
        v-if="targetRect"
        class="spotlight-hole"
        :style="spotlightStyle"
      ></div>
    </div>

    <!-- Animated arrow -->
    <div
      v-if="targetRect && effectiveArrowSide"
      class="ob-arrow"
      :style="[arrowStyle, { color: currentStepData.accent }]"
      ref="arrowRef"
    >
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
        <g v-if="effectiveArrowSide === 'top'">
          <path d="M13 4 L13 20 M6 14 L13 20 L20 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g v-else-if="effectiveArrowSide === 'bottom'">
          <path d="M13 22 L13 6 M6 12 L13 6 L20 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g v-else-if="effectiveArrowSide === 'left'">
          <path d="M4 13 L20 13 M14 6 L20 13 L14 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g v-else-if="effectiveArrowSide === 'right'">
          <path d="M22 13 L6 13 M12 6 L6 13 L12 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </svg>
    </div>

    <!-- Tour card -->
    <div
      class="ob-card"
      :class="{ 'ob-card--centered': !targetRect }"
      :style="[cardStyle, targetRect ? cardPositionStyle : {}]"
      ref="cardRef"
    >
      <div class="ob-card-inner">
        <!-- Header: title + step counter -->
        <div class="ob-header">
          <div class="ob-header-text">
            <h2 class="ob-title">{{ currentStepData.title }}</h2>
            <p class="ob-subtitle" :style="{ color: currentStepData.accent }">{{ currentStepData.subtitle }}</p>
          </div>
          <span class="ob-counter">{{ String(currentStep + 1).padStart(2, '0') }} / {{ String(steps.length).padStart(2, '0') }}</span>
        </div>
        <!-- Accent underline -->
        <div class="ob-underline" :style="{ background: currentStepData.accent }"></div>

        <!-- Description -->
        <div class="ob-content" :key="currentStep">
          <p class="ob-desc">{{ currentStepData.description }}</p>
        </div>

        <!-- Navigation -->
        <div class="ob-nav">
          <button class="ob-btn ob-btn--ghost" v-if="!isFirstStep" @click="prevStep">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9 3L4 7L9 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            上一步
          </button>
          <button class="ob-btn ob-btn--ghost" v-else @click="skip">跳过</button>

          <div class="ob-dots">
            <span
              v-for="(step, i) in steps"
              :key="i"
              class="ob-dot"
              :class="{ active: i === currentStep, done: i < currentStep }"
              :style="i === currentStep ? { background: currentStepData.accent } : (i < currentStep ? { background: currentStepData.accent + '50' } : {})"
              @click="i < currentStep && (currentStep = i, performStepTransition())"
            />
          </div>

          <button class="ob-btn ob-btn--primary" :style="{ '--btn-accent': currentStepData.accent }" @click="nextStep">
            {{ isLastStep ? '开始使用' : '下一步' }}
            <svg v-if="!isLastStep" width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5 3L10 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal) + 10);
}

// ── Backdrop ──
.ob-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(5, 5, 7, 0.55);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  transition: background 300ms ease, backdrop-filter 300ms ease;

  &.has-spotlight {
    background: rgba(5, 5, 7, 0.35);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    pointer-events: none;
  }
}

.spotlight-hole {
  position: absolute;
  border-radius: 12px;
  box-shadow:
    0 0 0 2px var(--spotlight-accent, #7EC8E3),
    0 0 20px 4px color-mix(in srgb, var(--spotlight-accent, #7EC8E3) 25%, transparent),
    0 0 0 9999px rgba(5, 5, 7, 0.35);
  pointer-events: none;
  transition: all 300ms cubic-bezier(0.2, 0.7, 0.2, 1);
  animation: spotlight-pulse 2.4s ease-in-out infinite;
}

@keyframes spotlight-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 2px var(--spotlight-accent, #7EC8E3),
      0 0 16px 3px color-mix(in srgb, var(--spotlight-accent, #7EC8E3) 18%, transparent),
      0 0 0 9999px rgba(5, 5, 7, 0.35);
  }
  50% {
    box-shadow:
      0 0 0 2px var(--spotlight-accent, #7EC8E3),
      0 0 28px 8px color-mix(in srgb, var(--spotlight-accent, #7EC8E3) 35%, transparent),
      0 0 0 9999px rgba(5, 5, 7, 0.35);
  }
}

// ── Arrow ──
.ob-arrow {
  position: absolute;
  z-index: 2;
  filter: drop-shadow(0 0 5px currentColor);
  pointer-events: none;
}

// ── Card ──
.ob-card {
  position: absolute;
  z-index: 3;
  width: 340px;
  border-radius: 16px;
  pointer-events: auto;
  background: rgba(10, 10, 16, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 0 24px var(--accent-glow, transparent);

  &--centered {
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
}

.ob-card-inner {
  padding: 22px 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

// ── Header ──
.ob-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ob-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ob-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  font-family: var(--font-display);
  color: #F5F7FA;
  line-height: 1.3;
}

.ob-subtitle {
  margin: 0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0.7;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ob-counter {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.28);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.ob-underline {
  width: 24px;
  height: 2px;
  border-radius: 1px;
  opacity: 0.8;
  margin-top: -8px;
}

// ── Content ──
.ob-content {
  min-height: 60px;
}

.ob-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.5);
}

// ── Navigation ──
.ob-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 2px;
}

.ob-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  white-space: nowrap;
  font-size: 12px;
  font-family: inherit;

  &--ghost {
    &:hover {
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.65);
    }
  }

  &--primary {
    background: color-mix(in srgb, var(--btn-accent, #7EC8E3) 12%, transparent);
    border-color: color-mix(in srgb, var(--btn-accent, #7EC8E3) 20%, transparent);
    color: var(--btn-accent, #7EC8E3);

    &:hover {
      background: color-mix(in srgb, var(--btn-accent, #7EC8E3) 20%, transparent);
      color: #fff;
      border-color: color-mix(in srgb, var(--btn-accent, #7EC8E3) 36%, transparent);
    }
  }
}

.ob-dots {
  display: flex;
  gap: 5px;
}

.ob-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  cursor: default;
  transition: all 300ms cubic-bezier(0.2, 0.8, 0.2, 1);

  &.active {
    width: 16px;
    border-radius: 2.5px;
  }

  &.done {
    cursor: pointer;
  }
}
</style>

<!-- Global: prevent FAB / page-dots auto-hide during onboarding -->
<style>
body.onboarding-active .fab-menu-zone,
body.onboarding-active .page-dots {
  opacity: 1 !important;
  transform: none !important;
  pointer-events: auto !important;
}
</style>
