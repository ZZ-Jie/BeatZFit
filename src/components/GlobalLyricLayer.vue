<template>
  <div
    class="global-lyric-layer"
    data-lyric-layer
    ref="rootRef"
    :style="rootStyle"
  >
    <!-- 透明 3D 歌词舞台 — 模仿 cf-stage, 每行歌词就是一个 cf-item -->
    <div class="lyric-stage" ref="stageRef">
      <!-- 固定 3 个 lyric-item: 上一个 / 当前(focus) / 下一个 -->
      <div class="lyric-item" ref="prevItem" data-lyric-slot="prev">
        <div class="lyric-item-inner">
          <span class="lyric-text">{{ prevText }}</span>
        </div>
      </div>
      <div class="lyric-item" ref="curItem" data-lyric-slot="cur">
        <div class="lyric-item-inner">
          <span class="lyric-text">{{ curText }}</span>
        </div>
      </div>
      <div class="lyric-item" ref="nextItem" data-lyric-slot="next">
        <div class="lyric-item-inner">
          <span class="lyric-text">{{ nextText }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 全局 3D 歌词层 — cf-item focus 风格
 *
 * 固定 3 个 DOM 元素 (prev / cur / next), 不随歌词切换创建/销毁。
 * layout() 每帧用 GSAP 驱动的 scroll 值设置 transform。
 * 当 currentIndex 变化时, GSAP 动画 scroll → newIndex, 产生平滑轮播。
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import gsap from 'gsap'
import { useMusicStore } from '@/stores/music'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'

const musicStore = useMusicStore()
const { visualizer, lyricLines, currentLyricIndex, lyricAudioData } = useGlobalVisualizer()

const rootRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const prevItem = ref<HTMLElement | null>(null)
const curItem = ref<HTMLElement | null>(null)
const nextItem = ref<HTMLElement | null>(null)

let rafId = 0
let lastTime = 0

// ── 当前播放行索引 ──
const currentIndex = ref(-1)

// ── 滚动状态 ──
// scroll: 浮点数, 代表当前"焦点"位置 (LERP 平滑到 target)
// target: 整数, 当前播放行索引
let scroll = 0
let target = 0

// ── 文字内容 (响应式, 驱动 Vue 更新 <span> 文字) ──
const prevText = ref('')
const curText = ref('')
const nextText = ref('')

// ── 布局参数 (对齐 cf-item) ──
// lineSpacing and animSpeed are user-configurable via CSS variables
const CARD_FLOAT_Z = 80
const CARD_FALLOFF = 0.35

function getLineSpacing(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--cp-lyric-spacing').trim()
  return v ? parseFloat(v) : 80
}
function getAnimSpeed(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--cp-lyric-anim-speed').trim()
  return v ? parseFloat(v) : 0.5
}

// ── watch currentLyricIndex (from useGlobalVisualizer's 60fps spectrum loop) ──
// currentLyricIndex 在播放时由 forwardSpectrumData (60fps) 更新,
// 暂停时由 updatePausedLyric (500ms 定时器) 更新。
// 不监听 musicStore.currentTime — 该 ref 在播放时不更新。
watch(currentLyricIndex, (idx) => {
  if (idx >= 0 && idx !== currentIndex.value) {
    updateCurrentIndex(idx)
  }
}, { immediate: true })

// 歌词加载/切换 — 初始化
watch(() => lyricLines.value, () => {
  if (lyricLines.value.length > 0) {
    const idx = currentLyricIndex.value >= 0 ? currentLyricIndex.value : 0
    currentIndex.value = idx
    scroll = idx
    target = idx
    updateTexts(idx)
  } else {
    currentIndex.value = -1
    scroll = 0
    target = 0
    prevText.value = ''
    curText.value = ''
    nextText.value = ''
  }
}, { immediate: true })

watch(() => musicStore.currentTrack?.id, () => {
  currentIndex.value = -1
  scroll = 0
  target = 0
  prevText.value = ''
  curText.value = ''
  nextText.value = ''
})

// ── 更新当前索引 + GSAP 动画 + 更新文字 ──
function updateCurrentIndex(newIdx: number) {
  currentIndex.value = newIdx
  target = newIdx

  // GSAP 动画 scroll → target (平滑轮播)
  gsap.to({ v: scroll }, {
    v: newIdx,
    duration: getAnimSpeed(),
    ease: 'power3.out',
    onUpdate: function() {
      scroll = this.targets()[0].v
    },
  })

  // 更新文字内容
  updateTexts(newIdx)
}

// ── 更新 3 个 slot 的文字 ──
function updateTexts(idx: number) {
  const lines = lyricLines.value
  if (!lines.length || idx < 0) {
    prevText.value = ''
    curText.value = ''
    nextText.value = ''
    return
  }
  prevText.value = idx > 0 ? (lines[idx - 1]?.text || '') : ''
  curText.value = lines[idx]?.text || ''
  nextText.value = idx < lines.length - 1 ? (lines[idx + 1]?.text || '') : ''
}

// ── 发光颜色 ──
const glowColor = computed(() => {
  const userColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--cp-lyric-color').trim()
  if (userColor && userColor !== 'auto') return userColor
  return musicStore.currentCoverPalette?.vivid || 'rgba(255,255,255,0.8)'
})

const rootStyle = computed(() => ({ '--gc': glowColor.value }))

// ── 弹簧阻尼 (音频反应) ──
function springDamper(c: number, v: number, t: number, s: number, d: number, dt: number) {
  const f = -s * (c - t) - d * v
  return { value: c + (v + f * dt) * dt, velocity: v + f * dt }
}
class SpringState {
  value = 0; velocity = 0
  update(t: number, s = 200, d = 18, dt: number) { const r = springDamper(this.value, this.velocity, t, s, d, dt); this.value = r.value; this.velocity = r.velocity; return r.value }
}
const springBass = new SpringState()
const springBurst = new SpringState()

// ── 可见性 ──
const visible = computed(() =>
  musicStore.currentTrack != null
  && lyricLines.value.length > 0
  && currentIndex.value >= 0)

// ── 3D 旋转跟随 ──
let targetRX = 0, targetRY = 0, targetScale = 1
let displayRX = 0, displayRY = 0, displayScale = 1

// ── 布局函数 ──
// 每帧给 3 个固定 lyric-item 设置 transform, 模仿 cf-item 布局
function layout() {
  const items = [prevItem.value, curItem.value, nextItem.value]
  // 每个 item 相对于 scroll 的位置: prev=-1, cur=0, next=+1
  const offsets = [-1, 0, 1]

  for (let i = 0; i < items.length; i++) {
    const el = items[i]
    if (!el) continue

    // p = 该行相对于 scroll 的位置偏移
    const p = offsets[i] + (currentIndex.value - scroll)
    const absP = Math.abs(p)

    // cf-item 布局公式
    const itemSpacing = getLineSpacing()
    const y = itemSpacing * p
    const z = CARD_FLOAT_Z * Math.max(0, 1 - absP * CARD_FALLOFF)
    const scale = Math.max(0.5, 1 - 0.11 * absP)
    const rotX = Math.max(-10, Math.min(10, 2.5 * p))
    const opacity = absP < 0.5 ? 1 : Math.max(0.08, 1 - 0.22 * absP)
    const zIndex = Math.round(100 - absP * 10)

    el.style.transform = `translate(-50%, -50%) translate3d(0, ${y}px, ${z}px) rotateX(${rotX}deg) scale(${scale.toFixed(4)})`
    el.style.opacity = String(opacity)
    el.style.zIndex = String(zIndex)
    el.classList.toggle('focus', i === 1 && absP < 0.5)
  }
}

function transformLoop(now: number) {
  if (!lastTime) lastTime = now
  const dt = Math.min(0.05, (now - lastTime) / 1000); lastTime = now

  // 1. visualizer transform
  if (visualizer.value) {
    const t = visualizer.value.getCoverTransform()
    if (t) { targetRX = t.rotationX; targetRY = t.rotationY; targetScale = t.scale }
  }
  displayRX += (targetRX - displayRX) * 0.12
  displayRY += (targetRY - displayRY) * 0.12
  displayScale += (targetScale - displayScale) * 0.12

  // 2. 音频弹簧阻尼
  const a = lyricAudioData.value
  const sb = springBass.update(Math.max(0, Math.min(1, a.bass)), 200, 18, dt)
  const sp = springBurst.update(Math.max(0, Math.min(1, a.beat)), 250, 20, dt)

  // 3. audio scale
  const audioScale = 1.0 + sb * 0.08 + sp * 0.12
  const degX = displayRX * 180 / Math.PI
  const degY = displayRY * 180 / Math.PI
  // 视觉器缩放只轻微跟随 (25%), 避免歌词随滚轮缩放变化太明显
  const scale = 1.0 + (displayScale - 1.0) * 0.25 + (audioScale - 1.0)

  // 4. 布局 3 个 lyric-item
  layout()

  // 5. 给整个 .lyric-stage 设置旋转
  if (stageRef.value) {
    stageRef.value.style.transform =
      `rotateX(${(-degX).toFixed(2)}deg) rotateY(${degY.toFixed(2)}deg) scale(${scale.toFixed(4)})`
  }

  // 6. 可见性
  if (rootRef.value) {
    rootRef.value.style.setProperty('--lyric-visibility', visible.value ? 'visible' : 'hidden')
  }

  rafId = requestAnimationFrame(transformLoop)
}

onMounted(() => {
  if (visualizer.value) {
    const t = visualizer.value.getCoverTransform()
    if (t) { targetRX = displayRX = t.rotationX; targetRY = displayRY = t.rotationY; targetScale = t.scale }
  }
  rafId = requestAnimationFrame(transformLoop)
})

onUnmounted(() => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  gsap.killTweensOf({ v: scroll })
})
</script>

<style lang="scss" scoped>
/*
 * cf-item focus 风格歌词层
 * 固定 3 个 DOM 元素 (prev/cur/next), 不随歌词切换创建/销毁
 */
.global-lyric-layer {
  position: absolute;
  inset: 0;
  /* --cp-lyric-display is set by ControlPanel's applyLyricPrefs().
     When user disables lyrics, it's 'none' — hiding the entire layer
     (including on the player page). Defaults to 'flex' for first load. */
  display: var(--cp-lyric-display, flex);
  align-items: center;
  justify-content: center;
  perspective: none;
  transform-style: preserve-3d;
  pointer-events: none;
  z-index: 5;
  visibility: var(--lyric-visibility, hidden);
}

.lyric-stage {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  will-change: transform;
}

.lyric-item {
  position: absolute;
  left: 50%;
  top: 50%;
  width: auto;
  max-width: 80vw;
  transform-style: preserve-3d;
  will-change: transform, opacity;
  pointer-events: none;
}

.lyric-item-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 16px;
  // 无边框、无背景、无 blur — 纯文字
  background: transparent;
  border: none;
}

.lyric-text {
  font-family: var(--cp-lyric-font-family, var(--font-display));
  font-size: var(--cp-lyric-font-size, 28px);
  font-weight: var(--cp-lyric-font-weight, 600);
  line-height: 1.3;
  letter-spacing: 0.01em;
  color: var(--cp-lyric-text-color, rgba(255, 255, 255, 0.5));
  white-space: nowrap;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.6),
    0 0 12px rgba(0, 0, 0, 0.3);
  user-select: none;
  -webkit-user-select: none;
}

// focus 行的文字 — 字号基于设置页 --cp-lyric-font-size (放大 1.4 倍)
.lyric-item.focus .lyric-text {
  font-size: calc(var(--cp-lyric-font-size, 28px) * 1.4);
  font-weight: var(--cp-lyric-font-weight, 700);
  color: var(--cp-lyric-focus-color, #ffffff);
  letter-spacing: -0.02em;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.8),
    0 0 calc(12px * var(--cp-lyric-glow-mult, 1)) var(--gc, rgba(255, 255, 255, 0.3));
}
</style>
