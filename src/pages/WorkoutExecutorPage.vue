<template>
  <div class="workout-launch">
    <div v-if="loadError" class="launch-error">
      <p>{{ loadError }}</p>
      <button class="btn-glass" @click="router.back()">返回</button>
    </div>
    <div v-else class="launch-loading">
      <span class="loading-dot" ref="loadingDotRef"></span>
      <p>正在准备训练…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The actual workout UI lives inside the music player page as a
 * floating overlay (see WorkoutOverlay.vue). This page is a thin
 * launcher: it loads the requested plan, hands it to the fitness
 * store as the active session, and immediately routes to /player.
 *
 * We keep this route around so the "Start Workout" button in
 * FitnessPage / PlanBuilder can navigate to a known URL with the
 * planId parameter, then redirect.
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFitnessStore } from '@/stores/fitness'
import { animatePulse } from '@/composables/useGsapTransition'

const route = useRoute()
const router = useRouter()
const fitnessStore = useFitnessStore()

const loadError = ref('')
const loadingDotRef = ref<HTMLElement | null>(null)
let cleanupPulse: (() => void) | null = null

onMounted(async () => {
  // 启动脉冲动画
  if (loadingDotRef.value) {
    cleanupPulse = animatePulse(loadingDotRef.value, { scale: 1.4, opacity: 1, duration: 0.6 })
  }

  const planId = route.params.planId as string
  if (!planId) {
    loadError.value = '无效的训练计划'
    return
  }

  try {
    // Re-use the existing session if it's already on the requested plan
    // (e.g. the user clicked "开始训练" twice in a row, or a previous
    // attempt is mid-flight). Otherwise load + start fresh.
    const existing = fitnessStore.currentSession
    if (existing && existing.plan.id === planId) {
      router.replace('/player')
      return
    }
    if (existing) {
      // Different plan — drop the stale session before starting the new one.
      fitnessStore.endSession()
    }
    const plan = await fitnessStore.loadPlanById(planId)
    if (!plan) {
      loadError.value = '未找到该训练计划'
      return
    }
    fitnessStore.startSession(plan)
    // The actual workout UI runs as a floating overlay on the music
    // player page. Route there now so the visualizer + lyrics keep
    // playing in the background while the overlay takes over the
    // bottom-left corner.
    router.replace('/player')
  } catch (e) {
    console.error('Failed to start workout:', e)
    loadError.value = '启动训练失败，请重试'
  }
})

onUnmounted(() => {
  cleanupPulse?.()
})
</script>

<style lang="scss" scoped>
.workout-launch {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-deep);
}

.launch-loading,
.launch-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  color: var(--text-secondary);
}

.loading-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--accent-mist);
}

// pulse 动画已迁移至 GSAP (animatePulse)
</style>
