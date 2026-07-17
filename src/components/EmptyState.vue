<script setup lang="ts">
/**
 * EmptyState — 品牌主题空状态组件
 *
 * 可复用的空状态展示组件，包含：
 * - 品牌 logo 动画插画
 * - 标题 + 描述文字
 * - 可选操作按钮（1-2个）
 * - GSAP 入场动画
 *
 * 用法:
 *   <EmptyState icon="music" title="音乐库是空的" description="...">
 *     <template #actions>
 *       <button class="btn-glass btn-glass--accent">导入音乐</button>
 *     </template>
 *   </EmptyState>
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import gsap from 'gsap'

interface Props {
  /** 插画类型：music | fitness | player | data | generic */
  variant?: 'music' | 'fitness' | 'player' | 'data' | 'generic'
  title: string
  description?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'generic',
  description: '',
})

const rootRef = ref<HTMLElement | null>(null)
const logoRef = ref<HTMLElement | null>(null)
let tl: gsap.core.Timeline | null = null

onMounted(() => {
  if (!rootRef.value || !logoRef.value) return
  const logo = logoRef.value
  const sparkles = logo.querySelectorAll('.logo-sparkle')
  const text = rootRef.value.querySelector('.empty-state-text')

  tl = gsap.timeline()

  // Logo entrance: scale + fade
  tl.fromTo(logo,
    { scale: 0.3, autoAlpha: 0 },
    { scale: 1, autoAlpha: 1, duration: 0.8, ease: 'back.out(1.4)' }
  )

  // Sparkles
  tl.fromTo(sparkles,
    { autoAlpha: 0, scale: 0 },
    { autoAlpha: 1, scale: 1, duration: 0.3, stagger: 0.06, ease: 'back.out(2)' },
    '-=0.2'
  )

  // Text
  if (text) {
    tl.fromTo(text,
      { y: 12, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.4, ease: 'power2.out' },
      '-=0.2'
    )
  }

  // Continuous idle animation — gentle float
  gsap.to(logo, {
    y: -6,
    duration: 2.5,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
    delay: 1,
  })

  // Sparkle twinkle
  sparkles.forEach((s, i) => {
    gsap.to(s, {
      autoAlpha: 0.2,
      scale: 0.7,
      duration: 1.2 + i * 0.3,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 1.5 + i * 0.2,
    })
  })
})

onBeforeUnmount(() => {
  if (tl) tl.kill()
  if (logoRef.value) gsap.killTweensOf(logoRef.value)
  if (rootRef.value) {
    const sparkles = rootRef.value.querySelectorAll('.logo-sparkle')
    gsap.killTweensOf(sparkles)
  }
})
</script>

<template>
  <div class="empty-state" ref="rootRef">
    <!-- Brand logo illustration -->
    <div class="empty-state-logo" ref="logoRef">
      <div class="logo-image-wrap">
        <img src="/assets/beatzfit-logo.jpg" alt="BeatZFit" class="brand-logo-img" />
        <!-- Variant icon overlay -->
        <div class="logo-icon-overlay">
          <!-- music -->
          <svg v-if="variant === 'music'" class="variant-icon" viewBox="0 0 24 24" fill="none">
            <path d="M9 18V5l12-2v13" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="6" cy="18" r="3" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
            <circle cx="18" cy="16" r="3" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
          </svg>
          <!-- fitness -->
          <svg v-else-if="variant === 'fitness'" class="variant-icon" viewBox="0 0 24 24" fill="none">
            <path d="M6.5 6.5h11M6.5 17.5h11M4 9v6M20 9v6M6.5 9v6M17.5 9v6M9 12h6"
              stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <!-- player -->
          <svg v-else-if="variant === 'player'" class="variant-icon" viewBox="0 0 24 24" fill="none">
            <path d="M8 5v14l11-7z" fill="rgba(255,255,255,0.7)"/>
          </svg>
          <!-- data -->
          <svg v-else-if="variant === 'data'" class="variant-icon" viewBox="0 0 24 24" fill="none">
            <path d="M4 20V10M10 20V4M16 20v-6M22 20H2"
              stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <!-- generic — no icon -->
        </div>
      </div>

      <!-- Sparkles around the logo -->
      <svg class="logo-sparkles" viewBox="0 0 120 140" fill="none">
        <circle class="logo-sparkle" cx="15" cy="30" r="2" fill="rgba(255,255,255,0.8)" />
        <circle class="logo-sparkle" cx="105" cy="25" r="1.5" fill="rgba(126,200,227,0.9)" />
        <circle class="logo-sparkle" cx="10" cy="80" r="1.2" fill="rgba(255,255,255,0.6)" />
        <circle class="logo-sparkle" cx="110" cy="90" r="1.8" fill="rgba(77,208,225,0.7)" />
        <circle class="logo-sparkle" cx="25" cy="120" r="1" fill="rgba(255,255,255,0.5)" />
      </svg>
    </div>

    <!-- Text content -->
    <div class="empty-state-text">
      <h3 class="text-h3">{{ title }}</h3>
      <p class="text-small" v-if="description">{{ description }}</p>
      <div class="empty-state-actions" v-if="$slots.actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);
  padding: var(--space-3xl) var(--space-xl);
  text-align: center;
}

.empty-state-logo {
  position: relative;
  width: 120px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 4px 20px rgba(126, 200, 227, 0.15));
}

.logo-image-wrap {
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.brand-logo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.variant-icon {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  pointer-events: none;
}

.logo-sparkles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.empty-state-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);

  h3 {
    margin: 0;
  }

  p {
    margin: 0;
    max-width: 320px;
    color: var(--text-tertiary);
  }
}

.empty-state-actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}
</style>
