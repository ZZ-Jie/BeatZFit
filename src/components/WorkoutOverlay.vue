<template>
  <div
    v-if="session"
    class="workout-overlay"
    :class="{
      'workout-overlay--expanded': expanded,
      'workout-overlay--hidden': hidden,
      'workout-overlay--resting': session.isResting
    }"
  >
    <!-- 训练主舞台（隐藏时：1/4 在左下角；展开时：居中） -->
    <div
      class="wo-stage"
      :class="{ 'wo-stage--expanded': expanded }"
      @click.stop="onStageClick"
    >
      <!-- 收回的 1/4 大小图片（也是 hover 命中区） -->
      <div
        class="wo-thumb-zone"
        @click.stop="toggleExpand"
        @mouseenter="onThumbHoverEnter"
        @mouseleave="onThumbHoverLeave"
        v-show="!expanded"
      >
        <div class="wo-thumb-image" v-if="currentExercise">
          <img
              v-if="currentExercise?.gifUrl"
              :src="toExerciseMediaUrl(currentExercise.gifUrl)"
              :alt="currentExercise.name"
              loading="lazy"
              decoding="async"
            />
          <div class="wo-thumb-fallback" v-else><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11"/><path d="M3 9v6"/><path d="M21 9v6"/><path d="M6 7v10"/><path d="M18 7v10"/><path d="M6 12h12"/></svg></div>
          <!-- 集数 / 状态徽章 -->
          <div class="wo-thumb-badge">
            <span class="wo-thumb-set">{{ session.currentSet }}/{{ currentPlanItem?.sets || '?' }}</span>
            <span class="wo-thumb-divider">·</span>
            <span class="wo-thumb-progress">{{ progressSummary }}</span>
          </div>
          <div v-if="session.isResting" class="wo-thumb-rest">
            休息 · {{ restTimeDisplay }}s
          </div>
        </div>
        <div v-else class="wo-thumb-loading">加载动作中...</div>
      </div>

      <!-- 展开后的训练摘要卡片 -->
      <WorkoutCard
        :visible="expanded"
        :exercise="currentExercise"
        :plan-item="currentPlanItem"
        :session="session"
        @complete="completeSet"
        @pause="pauseWorkout"
        @skip="skipExercise"
        @end="endWorkout"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useFitnessStore } from '@/stores/fitness'
import WorkoutCard from '@/components/WorkoutCard.vue'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'
import { useSfx } from '@/composables/useSfx'
import type { Exercise, WorkoutPlanItem } from '@/types'

const fitnessStore = useFitnessStore()
const sfx = useSfx()

const session = computed(() => fitnessStore.currentSession)
const currentExercise = ref<Exercise | null>(null)
const expanded = ref(false)
const hidden = ref(false)
const hovered = ref(false)

let hideTimer: ReturnType<typeof setTimeout> | null = null
let endTimer: ReturnType<typeof setInterval> | null = null
let restTimer: ReturnType<typeof setInterval> | null = null
const elapsedSeconds = ref(0)

// 本地动作缓存：同一训练中动作可能重复出现，避免重复 IPC 请求。
const exerciseCache = new Map<string, Exercise>()

const currentPlanItem = computed<WorkoutPlanItem | null>(() => {
  if (!session.value) return null
  return session.value.plan.exercises[session.value.currentExerciseIndex] ?? null
})

const restTimeDisplay = computed(() => {
  if (!session.value) return '0'
  return Math.ceil(session.value.restTimeLeft)
})

const restPercent = computed(() => {
  if (!session.value || !currentPlanItem.value) return 0
  return Math.max(0, Math.min(100, (session.value.restTimeLeft / currentPlanItem.value.restSeconds) * 100))
})

const progressSummary = computed(() => {
  if (!session.value) return ''
  const total = session.value.plan.exercises.length
  const done = session.value.currentExerciseIndex + 1
  return `${done}/${total}`
})

onMounted(async () => {
  if (!session.value) return
  await loadCurrentExercise()
  startEndTimer()
  // When the overlay first appears it should be visible (not hidden) so
  // the user has a clear "training started" cue.
  hidden.value = false
  scheduleHide()
})

onBeforeUnmount(() => {
  cleanup()
})

watch(() => session.value?.currentExerciseIndex, async () => {
  await loadCurrentExercise()
  // After auto-advancing to the next exercise, briefly re-show the
  // thumb in case it had been hidden, so the user sees the new motion.
  if (hidden.value) {
    hidden.value = false
  }
  scheduleHide()
})

watch(() => session.value?.isResting, (resting) => {
  if (resting) {
    startRestCountdown()
  } else {
    if (restTimer) {
      clearInterval(restTimer)
      restTimer = null
    }
  }
})

/**
 * 加载当前动作详情。
 * 优先读取本地 exerciseCache，未命中时再调用 fitnessStore.loadExerciseById，
 * 并将结果缓存，避免同一动作在训练循环中重复触发 IPC。
 */
async function loadCurrentExercise() {
  if (!session.value) return
  const item = session.value.plan.exercises[session.value.currentExerciseIndex]
  if (!item) return

  const cached = exerciseCache.get(item.exerciseId)
  if (cached) {
    currentExercise.value = cached
    return
  }

  const ex = await fitnessStore.loadExerciseById(item.exerciseId)
  if (ex) {
    exerciseCache.set(item.exerciseId, ex)
    currentExercise.value = ex
  }
}

function toggleExpand() {
  expanded.value = !expanded.value
  if (expanded.value) {
    sfx.airBloom()
    // Cancel any pending hide — the user is interacting.
    clearHideTimer()
  } else {
    sfx.retract()
    // After collapsing, start the 10s hide countdown.
    scheduleHide()
  }
}

function onStageClick() {
  if (expanded.value) {
    // Clicking on the dimmed stage area collapses the panel. The image
    // and notes panel stop propagation so they don't fire this.
    expanded.value = false
    scheduleHide()
  }
}

function onThumbHoverEnter() {
  hovered.value = true
  if (hidden.value) {
    // User re-engaged — re-show the thumb and start a fresh 10s timer.
    hidden.value = false
    scheduleHide()
  }
}

function onThumbHoverLeave() {
  hovered.value = false
  // The 10s timer was started on enter; let it run.
}

function scheduleHide() {
  clearHideTimer()
  hideTimer = setTimeout(() => {
    if (!expanded.value && !hovered.value) {
      hidden.value = true
    }
  }, 10_000)
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function completeSet() {
  sfx.confirm()
  if (!session.value || !currentPlanItem.value) return

  const key = currentPlanItem.value.exerciseId
  const progress = session.value.exercisesProgress.get(key) || { setsCompleted: 0, repsCompleted: 0 }
  progress.setsCompleted++
  progress.repsCompleted += currentPlanItem.value.reps
  session.value.exercisesProgress.set(key, progress)

  if (session.value.currentSet < currentPlanItem.value.sets) {
    session.value.currentSet++
    session.value.isResting = true
    session.value.restTimeLeft = currentPlanItem.value.restSeconds
    speak('休息')
  } else {
    advanceExercise()
  }
}

function skipExercise() {
  sfx.detent()
  advanceExercise()
}

function advanceExercise() {
  if (!session.value) return
  session.value.currentExerciseIndex++
  session.value.currentSet = 1
  session.value.isResting = false
  if (session.value.currentExerciseIndex >= session.value.plan.exercises.length) {
    finishWorkout()
  }
}

let lastSpokenSecond = -1

function startRestCountdown() {
  if (restTimer) clearInterval(restTimer)
  lastSpokenSecond = -1
  restTimer = setInterval(() => {
    if (!session.value) return
    session.value.restTimeLeft -= 1
    const left = Math.ceil(session.value.restTimeLeft)
    if (left <= 3 && left > 0 && left !== lastSpokenSecond) {
      lastSpokenSecond = left
      speak(String(left))
    }
    if (session.value.restTimeLeft <= 0) {
      if (restTimer) {
        clearInterval(restTimer)
        restTimer = null
      }
      session.value.isResting = false
      if (currentExercise.value) {
        speak(currentExercise.value.chineseName || currentExercise.value.name)
      }
    }
  }, 1000)
}

function startEndTimer() {
  if (endTimer) clearInterval(endTimer)
  endTimer = setInterval(() => {
    elapsedSeconds.value++
  }, 1000)
}

async function pauseWorkout() {
  if (!session.value) return
  session.value.isPaused = !session.value.isPaused
  sfx.detent()
  speak(session.value.isPaused ? '训练已暂停' : '继续')
}

/**
 * 从当前训练进度生成分享卡片数据
 */
function buildShareCardData(completed: boolean) {
  if (!session.value) return null
  let totalSets = 0
  let totalReps = 0
  session.value.exercisesProgress.forEach((prog) => {
    totalSets += prog.setsCompleted
    totalReps += prog.repsCompleted
  })
  return {
    planName: session.value.plan.name,
    durationSeconds: elapsedSeconds.value,
    completed,
    totalSets,
    totalReps,
    exerciseCount: session.value.plan.exercises.length,
  }
}

async function endWorkout() {
  sfx.retract()
  // 先生成分享卡片数据，再保存记录和清理会话
  const cardData = buildShareCardData(false)
  await saveRecord(false)
  cleanup()
  fitnessStore.endSession()
  expanded.value = false
  hidden.value = false
  // 无论训练了多少组，都弹出分享卡片（状态存入 store，独立于组件生命周期）
  if (cardData) {
    fitnessStore.setShareCard(cardData)
  }
}

async function finishWorkout() {
  sfx.confirm()
  speak('训练完成')
  // 先生成分享卡片数据，再保存记录和清理会话
  const cardData = buildShareCardData(true)
  await saveRecord(true)
  cleanup()
  fitnessStore.endSession()
  expanded.value = false
  hidden.value = false
  // 训练完成时弹出分享卡片
  if (cardData) {
    fitnessStore.setShareCard(cardData)
  }
}

async function saveRecord(completed: boolean) {
  if (!session.value) return
  await fitnessStore.createRecord({
    date: new Date().toISOString().split('T')[0],
    planId: session.value.plan.id,
    planName: session.value.plan.name,
    durationSeconds: elapsedSeconds.value,
    completed,
    exercises: Array.from(session.value.exercisesProgress.entries()).map(([id, prog]) => ({
      exerciseId: id,
      setsCompleted: prog.setsCompleted,
      repsCompleted: prog.repsCompleted
    }))
  })
}

function cleanup() {
  if (restTimer) clearInterval(restTimer)
  if (endTimer) clearInterval(endTimer)
  if (hideTimer) clearTimeout(hideTimer)
  restTimer = null
  endTimer = null
  hideTimer = null
}

function speak(text: string) {
  try {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = 0.9
      speechSynthesis.speak(utterance)
    }
  } catch (e) {
    console.warn('[WorkoutOverlay] TTS not available:', e)
  }
}

defineExpose({})
</script>

<style lang="scss" scoped>
.workout-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none; // pass through to visualizer by default

  // ===== 收回状态：1/4 缩略图（命中区 + 视觉区） =====
  .wo-thumb-zone {
    position: absolute;
    // 1/4 of viewport in BOTH dimensions = 1/4 of total area. The image
    // lives inside and is clamped to a sensible min/max so the box
    // always has a hit target even on tiny windows.
    bottom: calc(var(--player-bar-height, 80px) + 20px);
    left: 24px;
    width: min(25vw, 25vh, 360px);
    height: min(25vw, 25vh, 360px);
    pointer-events: auto;
    cursor: pointer;
    z-index: 2;
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid var(--glass-border);
    background: var(--bg-elevated);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
    transition: transform 220ms var(--ease-standard), box-shadow 220ms var(--ease-standard);
  }

  .wo-thumb-image {
    position: relative;
    width: 100%;
    height: 100%;
    transform: translateZ(0);
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  }

  .wo-thumb-fallback {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-mist);
    opacity: 0.25;
  }

  .wo-thumb-loading {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
  }

  .wo-thumb-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 4px 10px;
    border-radius: var(--radius-full);
    /* T5 提示层玻璃升级 — 增加光泽 */
    backdrop-filter: blur(10px) saturate(150%);
    -webkit-backdrop-filter: blur(10px) saturate(150%);
    background: linear-gradient(135deg, rgba(10, 10, 26, 0.7), rgba(10, 10, 26, 0.5));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
    color: #fff;
    font-size: var(--text-caption);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .wo-thumb-set { font-weight: 600; color: var(--accent-mist); }
  .wo-thumb-divider { opacity: 0.5; }

  .wo-thumb-rest {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    padding: 4px 10px;
    border-radius: var(--radius-md);
    background: rgba(229, 138, 50, 0.85);
    color: #fff;
    font-size: var(--text-caption);
    text-align: center;
    backdrop-filter: blur(8px);
  }

  // ===== 展开状态：由 WorkoutCard 组件渲染居中卡片 =====
  .wo-stage {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .wo-stage--expanded {
    pointer-events: auto;
    z-index: 1;
  }

  // ===== 隐藏状态：完全收起，只留 1/4 命中区 =====
  &--hidden .wo-thumb-zone {
    // The thumb is no longer shown but the click/hover area stays put so
    // the user can mouse over the same spot to bring it back. We do this
    // by keeping the box mounted (v-if) but hiding the visual content
    // via a transparent overlay; the click + mouseenter handlers are
    // still active. Use opacity on a child wrapper to preserve the
    // hit target.
    background: transparent;
    border-color: transparent;
    box-shadow: none;
    .wo-thumb-image,
    .wo-thumb-loading { opacity: 0; }
  }
}

/* WorkoutCard 组件内部已包含 .wo-card-* 过渡动画，此处无需重复定义。 */
</style>
