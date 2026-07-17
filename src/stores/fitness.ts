import { defineStore } from 'pinia'
import { ref, shallowRef, markRaw, computed, triggerRef } from 'vue'
import type { Exercise, WorkoutPlan, WorkoutRecord, WorkoutSession } from '@/types'
import {
  loadExercisesCached,
  loadBodyPartsCached,
  loadEquipmentsCached,
  loadPlansCached,
  loadPlanCached,
  loadRecordsCached,
  loadStatsCached,
  invalidateExercises,
  invalidatePlans,
  invalidateRecords
} from '@/modules/music/dataLoaders'

export const useFitnessStore = defineStore('fitness', () => {
  const exercises = shallowRef<Exercise[]>([])
  const bodyParts = ref<string[]>([])
  const equipments = ref<string[]>([])
  const plans = shallowRef<WorkoutPlan[]>([])
  const records = shallowRef<WorkoutRecord[]>([])
  const isSyncing = ref(false)
  const syncProgress = ref({ fetched: 0, total: 0, failed: 0 })
  const syncResult = ref<{ total: number; failed: number; failedNames: string[] } | null>(null)
  const stats = ref({
    todayWorkouts: 0,
    weekDurationSeconds: 0,
    weekHeatmap: [] as { date: string; count: number }[]
  })

  const currentSession = ref<WorkoutSession | null>(null)

  // ── 分享卡片状态（独立于 session 生命周期） ──
  // 训练结束后 session 会被清空，但分享卡片需要继续显示。
  // 将状态提升到 store 层，让 PlayerPage 直接渲染卡片，
  // 避免父组件 v-if=session 卸载 WorkoutOverlay 时卡片一起被销毁。
  const shareCardData = ref<{
    planName: string
    durationSeconds: number
    completed: boolean
    totalSets: number
    totalReps: number
    exerciseCount: number
  } | null>(null)
  const showShareCard = ref(false)

  function setShareCard(data: {
    planName: string
    durationSeconds: number
    completed: boolean
    totalSets: number
    totalReps: number
    exerciseCount: number
  }) {
    shareCardData.value = data
    showShareCard.value = true
  }

  function closeShareCard() {
    showShareCard.value = false
    // 不清空 shareCardData，让用户可以通过浮动按钮重新打开
  }

  function reopenShareCard() {
    if (shareCardData.value) {
      showShareCard.value = true
    }
  }

  function dismissShareCard() {
    showShareCard.value = false
    shareCardData.value = null
  }


  // Pending exercises from FitnessPage "加入计划" button — consumed
  // and cleared by PlanBuilder on mount. This bridges the gap so
  // clicking "加入计划" in the exercise detail modal adds the exercise
  // directly to the plan builder's selected list.
  const pendingExercises = ref<Exercise[]>([])

  function addPendingExercise(ex: Exercise) {
    // Avoid duplicates
    if (!pendingExercises.value.some(e => e.id === ex.id)) {
      pendingExercises.value.push(ex)
    }
  }

  function consumePendingExercises(): Exercise[] {
    const items = [...pendingExercises.value]
    pendingExercises.value = []
    return items
  }

  // Editing plan — when navigating from DataPage to edit an existing
  // plan, this holds the plan ID so PlanBuilder can load and pre-fill.
  const editingPlanId = ref<string | null>(null)

  function setEditingPlan(id: string | null) {
    editingPlanId.value = id
  }

  /**
   * Sync exercises from the API with real-time progress streaming.
   *
   * This should ONLY be called when the local DB is empty (first
   * sync).  Subsequent data refreshes should use loadExercises()
   * to read from the local DB directly.
   *
   * The main process sends `exercise:syncProgress` events after each
   * page is fetched and inserted into the DB.  We listen for these
   * events and incrementally append the new exercises to the local
   * `exercises` ref so the UI updates in real-time.
   */
  async function syncExercises() {
    isSyncing.value = true
    syncProgress.value = { fetched: 0, total: 0, failed: 0 }
    syncResult.value = null

    // Listener for incremental progress events from the main process
    let unsubscribe: (() => void) | null = null
    if (window.electronAPI?.exercise?.onSyncProgress) {
      unsubscribe = window.electronAPI.exercise.onSyncProgress((progress) => {
        syncProgress.value = {
          fetched: progress.fetched,
          total: progress.total,
          failed: progress.failed,
        }
        // Append new exercises incrementally — avoids O(n²) array rebuild
        // from multiple progress events during sync.
        if (progress.newExercises?.length) {
          const newItems = progress.newExercises.map(parseExerciseRow)
          // shallowRef: push + triggerRef is O(1) append, not O(n) rebuild
          ;(exercises.value as Exercise[]).push(...newItems)
          triggerRef(exercises)
        }
      })
    }

    try {
      if (window.electronAPI) {
        // Clear local exercises for the first-time sync.
        exercises.value = []
        invalidateExercises()

        const result = await window.electronAPI.exercise.syncFromAPI()
        if (result.success && result.data) {
          syncResult.value = result.data
          // Final reload to ensure consistent ordering and any
          // exercises that arrived after the last progress event
          invalidateExercises()
          await loadExercises(undefined, true)
        }
      }
    } catch (e) {
      console.error('Failed to sync exercises:', e)
    } finally {
      if (unsubscribe) unsubscribe()
      isSyncing.value = false
    }
  }

  async function loadExercises(filter?: {
    bodyPart?: string; equipment?: string; search?: string
  }, force = false) {
    if (window.electronAPI) {
      // Load ALL exercises (no limit) so client-side filtering works.
      const result = await loadExercisesCached(filter ?? {}, force)
      exercises.value = (result as any[]).map(parseExerciseRow)
    }
  }

  async function loadBodyParts(force = false) {
    if (window.electronAPI) {
      const result = await loadBodyPartsCached(force)
      bodyParts.value = result as string[]
    }
  }

  async function loadEquipments(force = false) {
    if (window.electronAPI) {
      const result = await loadEquipmentsCached(force)
      equipments.value = result as string[]
    }
  }

  async function loadExerciseById(id: string): Promise<Exercise | null> {
    if (window.electronAPI) {
      // Single-row fetch is not yet wrapped; keep direct call.
      const result = await window.electronAPI.exercise.getById(id)
      if (result.success && result.data?.exercise) {
        return parseExerciseRow(result.data.exercise)
      }
    }
    return null
  }

  async function loadPlans(force = false) {
    if (window.electronAPI) {
      const result = await loadPlansCached(force)
      plans.value = (result as any[]).map(parsePlanRow)
    }
  }

  async function loadPlanById(id: string, force = false) {
    if (window.electronAPI) {
      const result = await loadPlanCached(id, force)
      if (result) return parsePlanRow(result)
    }
    return null
  }

  async function createPlan(plan: Omit<WorkoutPlan, 'id' | 'createdAt' | 'updatedAt'>) {
    if (window.electronAPI) {
      const result = await window.electronAPI.workout.createPlan(plan)
      if (result.success) {
        // Invalidate list AND per-item caches, then re-read.
        invalidatePlans()
        await loadPlans(true)
        return { success: true, plan: result.data?.plan ? parsePlanRow(result.data.plan) : undefined }
      }
      return { success: false, error: (result as any).error || '创建计划失败' }
    }
    return { success: false }
  }

  async function deletePlan(id: string) {
    if (window.electronAPI) {
      const result = await window.electronAPI.workout.deletePlan(id)
      if (result.success) {
        // Drop the affected plan's cache entry before local-state update
        // so a fast user navigating to it doesn't see a stale row.
        invalidatePlans(id)
        plans.value = plans.value.filter(p => p.id !== id)
      }
      return result
    }
    return { success: false }
  }

  async function updatePlan(id: string, plan: Omit<WorkoutPlan, 'id' | 'createdAt' | 'updatedAt'>) {
    if (window.electronAPI?.workout?.updatePlan) {
      const result = await window.electronAPI.workout.updatePlan(id, plan)
      if (result.success) {
        invalidatePlans(id)
        await loadPlans(true)
        return { success: true, plan: result.data?.plan ? parsePlanRow(result.data.plan) : undefined }
      }
      return { success: false, error: (result as any).error || '更新计划失败' }
    }
    return { success: false, error: 'updatePlan not available' }
  }

  async function loadRecords(force = false) {
    if (window.electronAPI) {
      const result = await loadRecordsCached(force)
      records.value = (result as any[]).map(parseRecordRow)
    }
  }

  async function loadStats(force = false) {
    if (window.electronAPI) {
      const result = await loadStatsCached(force)
      if (result) stats.value = result as any
    }
  }

  async function createRecord(record: any) {
    if (window.electronAPI) {
      const result = await window.electronAPI.workout.createRecord(record)
      if (result.success) {
        invalidateRecords()
        await loadRecords(true)
        await loadStats(true)
      }
      return result
    }
    return { success: false }
  }

/** Check if the local DB already has exercise data (for startup cache-check). */
async function hasLocalData(): Promise<boolean> {
if (window.electronAPI?.exercise?.count) {
const result = await window.electronAPI.exercise.count()
return result.success && (result.data?.count ?? 0) > 0
}
return false
}

/**
 * Auto-sync exercises in the background on app startup.
 * Checks the sync_state table — only syncs if the previous sync
 * was not completed (or never started). This is non-blocking and
 * silent: no UI prompts, just background data fetching.
 */
async function autoSyncExercises(): Promise<void> {
if (!window.electronAPI?.exercise?.autoSync) return
try {
const result = await window.electronAPI.exercise.autoSync()
if (result?.success && result.data && 'skipped' in result.data && result.data.skipped) {
  // Sync was skipped (already completed)
  return
}
if (result?.success && result.data && !('skipped' in result.data)) {
console.log('[Fitness] Auto-sync completed:', result.data)
}
} catch (e) {
console.error('[Fitness] Auto-sync failed:', e)
}
}

  function startSession(plan: WorkoutPlan) {
    currentSession.value = {
      plan,
      currentExerciseIndex: 0,
      currentSet: 1,
      isResting: false,
      restTimeLeft: 0,
      isPaused: false,
      startTime: Date.now(),
      exercisesProgress: new Map()
    }
  }

  function endSession() {
    currentSession.value = null
  }

  return {
    exercises, bodyParts, equipments, plans, records, isSyncing, syncProgress, syncResult, stats,
    currentSession, pendingExercises, editingPlanId,
    shareCardData, showShareCard,
    syncExercises, autoSyncExercises, loadExercises, loadBodyParts, loadEquipments, hasLocalData,
    loadExerciseById, loadPlans, loadPlanById, createPlan, deletePlan,
    loadRecords, loadStats, createRecord,
    startSession, endSession,
    setShareCard, closeShareCard, reopenShareCard, dismissShareCard,
    addPendingExercise, consumePendingExercises, setEditingPlan,
    updatePlan
  }
})

// Fallback mapping for legacy English categories / missing zh fields.
const BODY_PART_ZH_MAP: Record<string, string> = {
  chest: '胸', shoulders: '肩', back: '背', legs: '腿', arms: '手臂',
  core: '核心', 'full body': '全身', stretching: '拉伸'
}
const EQUIPMENT_ZH_MAP: Record<string, string> = {
  'body weight': '徒手', dumbbell: '哑铃', barbell: '杠铃', cable: '绳索',
  kettlebell: '壶铃', machine: '器械', 'resistance band': '弹力带',
  'medicine ball': '药球', 'ez barbell': '曲杠', 'stability ball': '稳定球',
  other: '其他'
}

function safeParseJson(value: unknown, fallback: any): any {
  if (value == null) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    console.warn('[fitness] Failed to parse JSON field, returning fallback:', value)
    return fallback
  }
}

function parseExerciseRow(row: any): Exercise {
  const bodyPart = row.body_part || ''
  const bodyPartZh = row.body_part_zh || BODY_PART_ZH_MAP[bodyPart.toLowerCase()] || bodyPart
  const equipment = row.equipment || ''
  const equipmentZh = row.equipment_zh || EQUIPMENT_ZH_MAP[equipment.toLowerCase()] || equipment

  return markRaw({
    id: row.id || row.exerciseId,
    name: row.name,
    chineseName: row.chinese_name || row.chineseName,
    bodyPart,
    bodyPartZh,
    equipment,
    equipmentZh,
    target: row.target,
    targetZh: row.target_zh || row.target,
    gifUrl: row.gif_url || row.gifUrl,
    instructions: safeParseJson(row.instructions, []),
    precautionsZh: row.precautions_zh || row.precautionsZh
  })
}

function parsePlanRow(row: any): WorkoutPlan {
  return markRaw({
    id: row.id,
    name: row.name,
    bodyPart: row.body_part,
    equipment: row.equipment,
    exercises: safeParseJson(row.exercises, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}

function parseRecordRow(row: any): WorkoutRecord {
  return markRaw({
    id: row.id,
    date: row.date,
    planId: row.plan_id,
    planName: row.plan_name,
    durationSeconds: row.duration_seconds,
    caloriesBurned: row.calories_burned,
    exercises: safeParseJson(row.exercises, []),
    completed: !!row.completed
  })
}
