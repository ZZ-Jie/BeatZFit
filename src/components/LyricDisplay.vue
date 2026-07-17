<template>
  <div
    class="lyric-display"
    ref="containerRef"
    @scroll="onUserScroll"
    :style="displayStyle"
  >
    <!-- No lyrics state -->
    <div v-if="!parsedLines.length" class="lyric-empty">
      <p class="lyric-empty-text">暂无歌词</p>
    </div>

    <!-- Lyrics lines -->
    <div v-else class="lyric-lines" ref="linesRef" :style="linesPaddingStyle">
      <div
        v-for="(line, index) in parsedLines"
        :key="index"
        class="lyric-line"
        :class="{
          'lyric-line--active': index === currentIndex,
          'lyric-line--near': Math.abs(index - currentIndex) === 1,
          'lyric-line--far': Math.abs(index - currentIndex) >= 2
        }"
        :data-index="index"
        @click="onLineClick(index, line.timestamp)"
      >
        <span class="lyric-text">{{ line.text }}</span>
        <span class="lyric-translation" v-if="line.translation">{{ line.translation }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 歌词显示组件
 *
 * 居中方案: getBoundingClientRect() 直接计算
 * - 取当前行的屏幕中心坐标与窗口中心坐标的差值
 * - 差值加到 scrollTop 上即为目标滚动位置
 * - 无需 offsetTop / screenOffset / containerHeight 等间接计算
 * - 无论容器在屏幕什么位置, 都能精确居中
 *
 * 交互:
 * - 用户可自由滚动歌词 (隐藏滚动条)
 * - 用户滚动后 3s 暂停自动居中, 3s 后恢复
 * - 点击任意歌词行 → seek 播放 + 立即居中该行
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import gsap from 'gsap'
import type { LyricsLine } from '@/modules/music/lyricParser'
import { findCurrentLine } from '@/modules/music/lyricParser'

interface LyricTransform {
  rotationX: number
  rotationY: number
  scale: number
}

interface AudioData {
  bass: number    // 0-1
  mid: number     // 0-1
  treble: number  // 0-1
  volume: number  // 0-1
  beat: number    // 0-1
}

const props = defineProps<{
  lines: LyricsLine[]
  currentTime: number
  transform?: LyricTransform
  audioData?: AudioData
}>()

const emit = defineEmits<{
  seek: [time: number]
}>()

const containerRef = ref<HTMLElement | null>(null)
const linesRef = ref<HTMLElement | null>(null)
const currentIndex = ref(-1)

// User scroll state
const isUserScrolling = ref(false)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

// Programmatic scroll flag — distinguishes GSAP scroll from user scroll
let isAnimating = false

// Container height for padding calculation
const containerHeight = ref(0)

let resizeObserver: ResizeObserver | null = null
let currentTween: gsap.core.Tween | null = null

const parsedLines = computed(() => props.lines)

// ===== Mineradio-style audio-reactive lyric effects =====
const LYRIC_TILT_RATIO = 0.15
const LYRIC_SCALE_RATIO = 0.04
const LYRIC_MAX_TILT_DEG = 6

const BASS_LIFT_MAX = 18
const BEAT_BRIGHTNESS_MAX = 0.15
const BASS_GLOW_MAX = 0.4

const displayStyle = computed(() => {
  const t = props.transform
  const audio = props.audioData

  let rotYDeg = 0
  let rotXDeg = 0
  let scale = 1
  let translateY = 0
  let brightness = 1
  let glowIntensity = 0

  if (t) {
    rotYDeg = clamp(t.rotationY * (180 / Math.PI) * LYRIC_TILT_RATIO, -LYRIC_MAX_TILT_DEG, LYRIC_MAX_TILT_DEG)
    rotXDeg = clamp(-t.rotationX * (180 / Math.PI) * LYRIC_TILT_RATIO, -LYRIC_MAX_TILT_DEG, LYRIC_MAX_TILT_DEG)
    scale = 1 + (t.scale - 1) * LYRIC_SCALE_RATIO
  }

  if (audio) {
    translateY = -audio.bass * BASS_LIFT_MAX
    brightness = 1 + audio.beat * BEAT_BRIGHTNESS_MAX
    glowIntensity = audio.bass * BASS_GLOW_MAX
  }

  return {
    transform: `perspective(1200px) rotateX(${rotXDeg.toFixed(2)}deg) rotateY(${rotYDeg.toFixed(2)}deg) translateY(${translateY.toFixed(1)}px) scale(${scale.toFixed(4)})`,
    transformOrigin: 'center center',
    willChange: 'transform',
    filter: `brightness(${brightness.toFixed(3)})`,
    '--lyric-glow-intensity': glowIntensity.toFixed(3)
  }
})

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ===== Dynamic padding for .lyric-lines =====
// 上下各留 containerHeight/2 + 60px, 确保首末行都能滚动到容器中心
const linesPaddingStyle = computed(() => {
  const pad = containerHeight.value / 2 + 60
  return {
    paddingTop: `${pad}px`,
    paddingBottom: `${pad}px`
  }
})

// ===== Center the active line via getBoundingClientRect =====
// 直接用屏幕坐标计算, 不依赖 offsetTop / offsetParent 链
// 公式: target = scrollTop + (lineCenter - windowCenter)
// lineCenter 是当前行的屏幕中心 Y 坐标
// windowCenter 是窗口中心 Y 坐标
// 差值为正 → 行在窗口中心下方 → 需要增大 scrollTop (向下滚动)
// 差值为负 → 行在窗口中心上方 → 需要减小 scrollTop (向上滚动)
function centerActiveLine(animate = true) {
  const container = containerRef.value
  if (!container) return

  // 无激活行 — 回到顶部
  if (currentIndex.value < 0 || currentIndex.value >= parsedLines.value.length) {
    if (animate) {
      isAnimating = true
      currentTween?.kill()
      currentTween = gsap.to(container, {
        scrollTop: 0,
        duration: 0.4,
        ease: 'power2.out',
        onComplete: () => { setTimeout(() => { isAnimating = false }, 50) }
      })
    } else {
      currentTween?.kill()
      isAnimating = false
      container.scrollTop = 0
    }
    return
  }

  const lineEls = container.querySelectorAll('.lyric-line')
  const activeEl = lineEls[currentIndex.value] as HTMLElement
  if (!activeEl) return

  // getBoundingClientRect 直接给出屏幕坐标, 无需 offsetTop 链
  const lineRect = activeEl.getBoundingClientRect()
  const lineCenter = lineRect.top + lineRect.height / 2
  const windowCenter = window.innerHeight / 2
  const target = container.scrollTop + (lineCenter - windowCenter)

  if (animate) {
    isAnimating = true
    currentTween?.kill()
    currentTween = gsap.to(container, {
      scrollTop: target,
      duration: 0.6,
      ease: 'power3.out',
      onComplete: () => { setTimeout(() => { isAnimating = false }, 50) }
    })
  } else {
    currentTween?.kill()
    isAnimating = false
    container.scrollTop = target
  }
}

// ===== User scroll handling =====
function onUserScroll() {
  // 忽略 GSAP 程序滚动触发的事件
  if (isAnimating) return

  isUserScrolling.value = true
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    isUserScrolling.value = false
    // 用户停止滚动后, 恢复自动居中到当前播放行
    centerActiveLine(true)
  }, 3000)
}

// ===== Click lyric line → seek + center =====
function onLineClick(index: number, time: number) {
  // 重置用户滚动状态 — 点击是主动行为, 应立即恢复自动跟踪
  isUserScrolling.value = false
  if (scrollTimer) clearTimeout(scrollTimer)

  // 发出 seek 事件 (父组件调用 musicStore.seekTo 真正跳转音频)
  emit('seek', time)

  // 立即更新当前行并居中 (不等 currentTime watch 触发)
  currentIndex.value = index
  nextTick(() => centerActiveLine(true))
}

// ===== Watchers =====
watch(() => props.currentTime, (time) => {
  const idx = findCurrentLine(props.lines, time)
  if (idx !== currentIndex.value) {
    currentIndex.value = idx
    // 用户滚动期间不自动居中 (3s 后恢复)
    if (!isUserScrolling.value) {
      nextTick(() => centerActiveLine(true))
    }
  }
})

// 歌曲切换 — 重置状态
watch(() => props.lines, () => {
  currentIndex.value = -1
  isUserScrolling.value = false
  if (scrollTimer) clearTimeout(scrollTimer)
  nextTick(() => centerActiveLine(false))
})

// ===== Lifecycle =====
onMounted(() => {
  const container = containerRef.value
  if (!container) return
  containerHeight.value = container.clientHeight

  resizeObserver = new ResizeObserver(() => {
    if (containerRef.value) {
      containerHeight.value = containerRef.value.clientHeight
    }
    // 尺寸变化时即时重新居中 (无动画)
    centerActiveLine(false)
  })
  resizeObserver.observe(container)

  // 初始居中
  nextTick(() => centerActiveLine(false))
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  currentTween?.kill()
  if (scrollTimer) clearTimeout(scrollTimer)
})
</script>

<style lang="scss" scoped>
.lyric-display {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  // 遮罩渐变: 淡化顶部和底部的远距离歌词, 聚焦中心区域
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.2) 6%,
    rgba(0, 0, 0, 0.6) 12%,
    black 22%,
    black 78%,
    rgba(0, 0, 0, 0.6) 88%,
    rgba(0, 0, 0, 0.2) 94%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.2) 6%,
    rgba(0, 0, 0, 0.6) 12%,
    black 22%,
    black 78%,
    rgba(0, 0, 0, 0.6) 88%,
    rgba(0, 0, 0, 0.2) 94%,
    transparent 100%
  );
  // parallax 过渡 (拖拽/缩放跟随)
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
  // 允许滚动交互 (覆盖父级 pointer-events: none)
  pointer-events: auto;
  // 防止滚动穿透到父元素
  overscroll-behavior: contain;
  // 水晶绽放环境光晕
  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 120%;
    height: 40%;
    transform: translate(-50%, -50%);
    background: radial-gradient(
      ellipse at center,
      rgba(126, 200, 227, 0.06) 0%,
      rgba(77, 208, 225, 0.03) 40%,
      transparent 70%
    );
    pointer-events: none;
    z-index: 0;
  }

  // 完全隐藏滚动条 (跨浏览器)
  scrollbar-width: none; // Firefox
  -ms-overflow-style: none; // IE/Edge
  &::-webkit-scrollbar { display: none; } // Chrome/Electron
}

.lyric-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lyric-empty-text {
  color: var(--text-tertiary);
  font-size: var(--text-body);
}

.lyric-lines {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-lg);
  min-height: 100%;
  position: relative;
  z-index: 1;
}

.lyric-line {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  max-width: 100%;
  // 仅过渡 transform + opacity (GPU 加速, 零回流)
  transition: opacity 400ms var(--ease-standard),
              transform 400ms var(--ease-standard);
  transform-origin: center center;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
}

.lyric-text {
  display: block;
  font-size: var(--text-body);
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.7;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.6),
    0 0 12px rgba(0, 0, 0, 0.4);
}

.lyric-translation {
  display: block;
  font-size: var(--text-small);
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.5;
  opacity: 0.8;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.6),
    0 0 10px rgba(0, 0, 0, 0.35);
}

// ===== 视觉层级: transform: scale() =====

// Active line — 主舞台
.lyric-line--active {
  transform: scale(1.05);
  z-index: 1;

  .lyric-text {
    font-size: clamp(1.8rem, 4vw, 2.8rem);
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.02em;
    text-shadow:
      0 1px 3px rgba(0, 0, 0, 0.7),
      0 0 calc(28px + var(--lyric-glow-intensity, 0) * 40px) rgba(126, 200, 227, 0.5),
      0 0 calc(56px + var(--lyric-glow-intensity, 0) * 80px) rgba(77, 208, 225, 0.3),
      0 0 2px rgba(0, 0, 0, 0.8);
  }

  .lyric-translation {
    font-size: clamp(1rem, 1.8vw, 1.25rem);
    color: rgba(255, 255, 255, calc(0.85 + var(--lyric-glow-intensity, 0) * 0.15));
    opacity: 1;
    text-shadow:
      0 1px 2px rgba(0, 0, 0, 0.7),
      0 0 calc(16px + var(--lyric-glow-intensity, 0) * 24px) rgba(126, 200, 227, 0.3);
  }
}

// Near lines — 次级
.lyric-line--near {
  transform: scale(1);

  .lyric-text {
    font-size: clamp(1.1rem, 2.2vw, 1.4rem);
    color: rgba(255, 255, 255, 0.72);
  }

  .lyric-translation {
    opacity: 0.55;
  }
}

// Far lines — 远距离
.lyric-line--far {
  transform: scale(0.92);
  opacity: 0.5;

  .lyric-text {
    font-size: var(--text-body);
    color: rgba(255, 255, 255, 0.4);
  }

  .lyric-translation {
    opacity: 0.3;
  }
}
</style>
