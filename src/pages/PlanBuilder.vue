<template>
  <div class="plan-builder-page" ref="pageRootRef">
    <header class="builder-header">
      <button class="builder-back" @click="router.back()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        返回
      </button>
      <h1 class="text-h2">{{ isEditMode ? '编辑训练计划' : '创建训练计划' }}</h1>
      <span class="builder-subtitle">选择动作，自定义组数与次数</span>
    </header>

    <!-- 训练计划模板选择器（仅在新建模式下显示） -->
    <div class="builder-templates" v-if="!isEditMode">
      <TrainingTemplateSelector @select="onTemplateSelect" />
    </div>

    <div class="builder-layout">
      <!-- Left: Exercise browser -->
      <section class="browser-panel">
        <FrostedGlass :corner-radius="24" variant="primary" />
        <div class="browser-panel-content">
          <div class="browser-filters">
          <div class="filter-section">
            <span class="filter-title text-caption">训练部位</span>
            <div class="filter-chips">
              <button class="filter-chip" :class="{ active: activeBodyPart === '' }" @click="activeBodyPart = ''">全部</button>
              <button class="filter-chip" v-for="bp in bodyPartOptions" :key="bp"
                :class="{ active: activeBodyPart === bp }" @click="activeBodyPart = bp">
                {{ bp }}
              </button>
            </div>
          </div>

          <div class="filter-section">
            <span class="filter-title text-caption">器械</span>
            <div class="filter-chips">
              <button class="filter-chip" :class="{ active: activeEquipment === '' }" @click="activeEquipment = ''">全部</button>
              <button class="filter-chip" v-for="eq in equipmentOptions" :key="eq"
                :class="{ active: activeEquipment === eq }" @click="activeEquipment = eq">
                {{ eq }}
              </button>
            </div>
          </div>

          <div class="search-box">
            <svg width="15" height="15" viewBox="0 0 15 15"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            <input type="text" placeholder="搜索动作..." v-model="searchQuery" class="search-input" />
          </div>
        </div>

        <div class="browser-results">
          <div class="browser-count text-small" v-if="loading">
            <div class="skeleton-line skeleton-line--sm" style="width: 180px;" />
          </div>
          <div class="browser-count text-small" v-else-if="filteredExercises.length > 0">
            找到 {{ filteredExercises.length }} 个动作，显示 {{ paginatedExercises.length }} 个（共 {{ allExercises.length }} 个）
          </div>
          <div class="exercise-grid" v-if="loading">
            <div class="exercise-card glass-card" v-for="i in 12" :key="i">
              <div class="exercise-gif skeleton-block" style="border-radius: 0;" />
              <div class="exercise-info" style="display: flex; flex-direction: column; gap: 6px;">
                <div class="skeleton-line skeleton-line--md" style="width: 70%;" />
                <div style="display: flex; gap: 6px;">
                  <div class="skeleton-line skeleton-line--sm" style="width: 40px;" />
                  <div class="skeleton-line skeleton-line--sm" style="width: 40px;" />
                </div>
              </div>
            </div>
          </div>
          <div class="exercise-grid" v-else>
            <div class="exercise-card glass-card" v-for="(ex, i) in paginatedExercises" :key="ex.id"
              :class="{ selected: selectedMap.has(ex.id) }" :style="{ '--stagger-i': Math.min(i, 8) }" @click="addExercise(ex)">
              <div class="exercise-gif">
                <img v-if="ex.gifUrl" :src="toExerciseMediaUrl(ex.gifUrl)" :alt="ex.name" loading="lazy"
                  @error="(e: any) => e.target.style.display = 'none'" />
                <div class="exercise-gif-fallback" v-if="!ex.gifUrl">&#9889;</div>
              </div>
              <div class="exercise-info">
                <h4 class="exercise-name">{{ ex.chineseName || ex.name }}</h4>
                <div class="exercise-tags">
                  <span class="exercise-tag">{{ ex.bodyPartZh || ex.bodyPart }}</span>
                  <span class="exercise-tag">{{ ex.equipmentZh || ex.equipment }}</span>
                </div>
              </div>
              <div class="exercise-add-badge">
                <svg v-if="selectedMap.has(ex.id)" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 3V11M3 7H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </div>
            </div>
          </div>

          <div class="empty-state" v-if="!loading && filteredExercises.length === 0 && !fitnessStore.isSyncing">
            <p>没有找到匹配的动作</p>
          </div>

          <div class="pagination-bar" v-if="totalPages > 1">
            <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage--">
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M8 3L4 7L8 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="page-info text-small">{{ currentPage }} / {{ totalPages }}</span>
            <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M6 3L10 7L6 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        </div>
      </section>

      <!-- Right: Selected plan preview -->
      <section class="plan-panel">
        <FrostedGlass :corner-radius="24" variant="primary" />
        <div class="plan-panel-content">
          <div class="plan-panel-header">
          <h3 class="text-h3">已选动作</h3>
          <span class="plan-count">{{ selectedItems.length }} 个</span>
        </div>

        <div class="plan-name-row">
          <label class="text-small">计划名称</label>
          <input class="form-input" v-model="planName" placeholder="例如：周一胸部训练" @input="planNameError = ''" />
          <span v-if="planNameError" class="plan-name-error text-caption">{{ planNameError }}</span>
        </div>

        <div class="selected-list" v-if="selectedItems.length > 0">
          <div class="selected-item" v-for="(item, index) in selectedItems" :key="item.exerciseId">
            <div class="selected-index">{{ index + 1 }}</div>
            <div class="selected-thumb">
              <img v-if="item.exercise?.gifUrl" :src="toExerciseMediaUrl(item.exercise.gifUrl)" loading="lazy"
                @error="(e: any) => e.target.style.display = 'none'" />
              <span v-else>&#9889;</span>
            </div>
            <div class="selected-info">
              <span class="selected-name">{{ item.exercise?.chineseName || item.exercise?.name }}</span>
              <span class="selected-meta">{{ item.exercise?.bodyPartZh || item.exercise?.bodyPart }}</span>
            </div>
            <div class="selected-params">
              <div class="param-field">
                <input type="number" min="1" v-model.number="item.sets" />
                <label>组</label>
              </div>
              <div class="param-field">
                <input type="number" min="1" v-model.number="item.reps" />
                <label>次</label>
              </div>
              <div class="param-field rest">
                <input type="number" min="0" step="5" v-model.number="item.restSeconds" />
                <label>秒</label>
              </div>
            </div>
            <button class="selected-remove" @click="removeExercise(item.exerciseId)" title="移除">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="selected-empty" v-else>
          <div class="empty-icon">&#9733;</div>
          <p>从左侧点击动作添加到计划</p>
        </div>

        <div class="plan-actions">
          <button class="btn-glass" @click="router.back()">取消</button>
          <button class="btn-glass btn-glass--accent" :disabled="!canCreate" @click="createPlan">
            {{ isEditMode ? '保存' : '创建计划' }}
          </button>
        </div>
        </div>
      </section>
    </div>

    <!-- Success modal -->
    <Transition :css="false" @enter="modalTransition.onEnter" @leave="modalTransition.onLeave">
      <div class="modal-overlay" v-if="createdPlan" @click.self="createdPlan = null">
        <div class="modal-content plan-success">
          <FrostedGlass :corner-radius="24" variant="floating" />
          <div class="modal-content-content">
            <div class="success-icon">&#10003;</div>
            <h2 class="text-h2">{{ isEditMode ? '计划保存成功' : '计划创建成功' }}</h2>
            <p class="text-small" style="color: var(--text-tertiary); margin: var(--space-sm) 0 var(--space-lg);">
              {{ createdPlan.name }} · {{ createdPlan.exercises.length }} 个动作
            </p>
            <div class="success-actions">
              <button class="btn-glass" @click="router.push('/')">返回首页</button>
              <button class="btn-glass btn-glass--accent" @click="startCreatedPlan">开始训练</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useFitnessStore } from '@/stores/fitness'
import FrostedGlass from '@/components/FrostedGlass.vue'
import TrainingTemplateSelector from '@/components/TrainingTemplateSelector.vue'
import { loadExercisesCached } from '@/modules/music/dataLoaders'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'
import type { Exercise, WorkoutPlan, WorkoutPlanItem, TrainingTemplate } from '@/types'
import { useModalTransition, animateStagger, animateContentEntrance, animateShimmerAll } from '@/composables/useGsapTransition'
import { useSfx } from '@/composables/useSfx'

const router = useRouter()
const fitnessStore = useFitnessStore()
const sfx = useSfx()

const modalTransition = useModalTransition()

const pageRootRef = ref<HTMLElement | null>(null)
let cleanupShimmer: (() => void) | null = null

const allExercises = ref<Exercise[]>([])
const loading = ref(true)
const activeBodyPart = ref('')
const activeEquipment = ref('')
const searchQuery = ref('')
const planName = ref('')
const planNameError = ref('')
const selectedItems = ref<Array<WorkoutPlanItem & { exercise?: Exercise }>>([])
const createdPlan = ref<WorkoutPlan | null>(null)
const existingPlanNames = ref<Set<string>>(new Set())

// Editing mode: when editing an existing plan, the submit button says
// "保存" and calls updatePlan instead of createPlan.
const editingPlanId = ref<string | null>(null)
const isEditMode = computed(() => !!editingPlanId.value)

const bodyPartOptions = ['胸', '肩', '背', '腿', '手臂', '核心', '全身', '拉伸']
const equipmentOptions = ['徒手', '哑铃', '杠铃', '曲杠', '绳索', '壶铃', '弹力带', '器械', '药球', '稳定球', '其他']

const PAGE_SIZE = 24
const currentPage = ref(1)

const filteredExercises = computed(() => {
  let result = allExercises.value
  if (activeBodyPart.value) {
    result = result.filter(ex => (ex.bodyPartZh || ex.bodyPart) === activeBodyPart.value)
  }
  if (activeEquipment.value) {
    result = result.filter(ex => (ex.equipmentZh || ex.equipment) === activeEquipment.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(ex =>
      ex.name.toLowerCase().includes(q) ||
      (ex.chineseName || '').toLowerCase().includes(q)
    )
  }
  return result
})

const totalPages = computed(() => Math.ceil(filteredExercises.value.length / PAGE_SIZE) || 1)

const paginatedExercises = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredExercises.value.slice(start, start + PAGE_SIZE)
})

// Reset to first page when filters change
watch([activeBodyPart, activeEquipment, searchQuery], () => {
  currentPage.value = 1
})

const selectedMap = computed(() => {
  const map = new Map<string, number>()
  selectedItems.value.forEach((item, idx) => map.set(item.exerciseId, idx))
  return map
})

const canCreate = computed(() => planName.value.trim().length > 0 && selectedItems.value.length > 0)

/**
 * 验证计划名称：非空、长度限制、不与现有计划重名
 */
function validatePlanName(): boolean {
  const name = planName.value.trim()
  planNameError.value = ''
  if (!name) {
    planNameError.value = '请输入计划名称'
    return false
  }
  if (name.length > 50) {
    planNameError.value = '计划名称不能超过50个字符'
    return false
  }
  if (existingPlanNames.value.has(name.toLowerCase())) {
    planNameError.value = '已存在同名计划，请使用不同的名称'
    return false
  }
  return true
}

onMounted(async () => {
await loadExercises()
loading.value = false
  // 加载现有计划名称列表，用于前端重名检查
  await fitnessStore.loadPlans()
  existingPlanNames.value = new Set(
    fitnessStore.plans.map(p => p.name.trim().toLowerCase())
  )

  // Check if we're editing an existing plan (from DataPage)
  if (fitnessStore.editingPlanId) {
    editingPlanId.value = fitnessStore.editingPlanId
    fitnessStore.setEditingPlan(null) // consume the ID
    await loadPlanForEdit(editingPlanId.value!)
  } else {
    // Consume pending exercises from FitnessPage "加入计划" button
    const pending = fitnessStore.consumePendingExercises()
    for (const ex of pending) {
      addExercise(ex)
    }
  }
})

// 骨架屏 shimmer — 加载时启动，加载完成停止 + 内容入场
watch(loading, (isLoading) => {
  if (isLoading && pageRootRef.value) {
    cleanupShimmer = animateShimmerAll(pageRootRef.value)
  } else {
    cleanupShimmer?.()
    cleanupShimmer = null
    if (!isLoading) {
      nextTick(() => {
        const grid = pageRootRef.value?.querySelector('.exercise-grid')
        if (grid) {
          animateContentEntrance(grid as HTMLElement)
          animateStagger(grid as HTMLElement)
        }
      })
    }
  }
})

onUnmounted(() => {
  cleanupShimmer?.()
})

async function loadPlanForEdit(planId: string) {
  const plan = await fitnessStore.loadPlanById(planId)
  if (!plan) return
  planName.value = plan.name
  if (plan.bodyPart) activeBodyPart.value = plan.bodyPart
  if (plan.equipment) activeEquipment.value = plan.equipment
  // Load exercise details for each plan item
  selectedItems.value = []
  for (const item of (plan.exercises || [])) {
    const exercise = await fitnessStore.loadExerciseById(item.exerciseId)
    selectedItems.value.push({
      exerciseId: item.exerciseId,
      sets: item.sets,
      reps: item.reps,
      restSeconds: item.restSeconds,
      exercise: exercise || undefined
    })
  }
}

async function loadExercises() {
  // Cached load — same key as FitnessPage, so navigating between
  // builder and library is a no-op on the IPC side.
  const rows = (await loadExercisesCached({})) as any[]
  if (rows.length > 0) {
    allExercises.value = rows.map(parseExerciseRow)
  }
  if (allExercises.value.length === 0) {
    await fitnessStore.syncExercises()
    // syncExercises() invalidates the cache; force-refresh after sync.
    const res2 = (await loadExercisesCached({}, true)) as any[]
    if (res2.length > 0) {
      allExercises.value = res2.map(parseExerciseRow)
    }
  }
}

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

function parseExerciseRow(row: any): Exercise {
  const bodyPart = row.body_part || ''
  const bodyPartZh = row.body_part_zh || BODY_PART_ZH_MAP[bodyPart.toLowerCase()] || bodyPart
  const equipment = row.equipment || ''
  const equipmentZh = row.equipment_zh || EQUIPMENT_ZH_MAP[equipment.toLowerCase()] || equipment
  return {
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
    instructions: typeof row.instructions === 'string' ? JSON.parse(row.instructions) : row.instructions,
    precautionsZh: row.precautions_zh || row.precautionsZh
  }
}

function addExercise(ex: Exercise) {
  if (selectedMap.value.has(ex.id)) return
  selectedItems.value.push({
    exerciseId: ex.id,
    sets: 3,
    reps: 10,
    restSeconds: 60,
    exercise: ex
  })
}

function removeExercise(id: string) {
  const idx = selectedItems.value.findIndex(i => i.exerciseId === id)
  if (idx >= 0) selectedItems.value.splice(idx, 1)
}

/**
 * Normalize an exercise ID or name for fuzzy matching.
 * Converts snake_case to spaces, lowercases, and trims.
 */
function normalizeExerciseKey(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').trim()
}

/**
 * Handle training template selection.
 * Sets the plan name and pre-fills exercises from the template.
 * Exercises are matched by exact ID first, then by normalized name.
 */
function onTemplateSelect(tpl: TrainingTemplate) {
  // Always update plan name to match the selected template
  planName.value = tpl.name
  planNameError.value = ''
  // Clear current selection and load template exercises
  selectedItems.value = []

  // Build a normalized name → exercise map for fuzzy matching
  const byNormalizedName = new Map<string, Exercise>()
  for (const ex of allExercises.value) {
    const key = normalizeExerciseKey(ex.name)
    if (!byNormalizedName.has(key)) {
      byNormalizedName.set(key, ex)
    }
  }

  let matchedCount = 0
  let skippedCount = 0

  for (const item of tpl.exercises) {
    // 1. Try exact ID match
    let ex = allExercises.value.find(e => e.id === item.exerciseId)

    // 2. Fallback: match by normalized name (exerciseId → words)
    if (!ex) {
      const normalizedKey = normalizeExerciseKey(item.exerciseId)
      ex = byNormalizedName.get(normalizedKey)
    }

    // 3. Fallback: try partial name match (exerciseId contains part of name)
    if (!ex) {
      const normalizedKey = normalizeExerciseKey(item.exerciseId)
      ex = allExercises.value.find(e => {
        const eName = normalizeExerciseKey(e.name)
        return eName.includes(normalizedKey) || normalizedKey.includes(eName)
      })
    }

    if (ex) {
      selectedItems.value.push({
        exerciseId: ex.id,
        sets: item.sets,
        reps: item.reps,
        restSeconds: item.restSeconds,
        exercise: ex,
      })
      matchedCount++
    } else {
      console.warn(`[template] Exercise not found in DB: ${item.exerciseId}`)
      skippedCount++
    }
  }

  if (matchedCount === 0 && skippedCount > 0) {
    console.warn(`[template] No exercises matched for template "${tpl.name}". ` +
      `Make sure exercises are synced. Skipped: ${skippedCount}`)
  }

  // Scroll the selected list to top so the user sees the first added item
  nextTick(() => {
    const list = pageRootRef.value?.querySelector('.selected-list')
    if (list) list.scrollTop = 0
  })
}

async function createPlan() {
  if (!canCreate.value) return
  // 前端验证
  if (!isEditMode.value && !validatePlanName()) return
  // In edit mode, skip the duplicate-name check (the name is allowed
  // to stay the same as the original plan)
  if (isEditMode.value) {
    const name = planName.value.trim()
    planNameError.value = ''
    if (!name) {
      planNameError.value = '请输入计划名称'
      return
    }
    if (name.length > 50) {
      planNameError.value = '计划名称不能超过50个字符'
      return
    }
  }
  if (selectedItems.value.length === 0) {
    planNameError.value = '至少需要选择一个动作'
    return
  }
  // 验证动作参数
  for (const item of selectedItems.value) {
    if (item.sets < 1 || item.reps < 1) {
      planNameError.value = '组数和次数必须大于0'
      return
    }
    if (item.restSeconds < 0) {
      planNameError.value = '休息时间不能为负数'
      return
    }
  }

  const exercises = selectedItems.value.map(item => ({
    exerciseId: item.exerciseId,
    sets: item.sets,
    reps: item.reps,
    restSeconds: item.restSeconds
  }))

  if (isEditMode.value && editingPlanId.value) {
    // Update existing plan
    const result = await fitnessStore.updatePlan(editingPlanId.value, {
      name: planName.value.trim(),
      bodyPart: activeBodyPart.value || undefined,
      equipment: activeEquipment.value || undefined,
      exercises
    })
    if (result.success) {
      createdPlan.value = result.plan || null
    } else {
      planNameError.value = result.error || '更新计划失败'
    }
  } else {
    // Create new plan
    const result = await fitnessStore.createPlan({
      name: planName.value.trim(),
      bodyPart: activeBodyPart.value || undefined,
      equipment: activeEquipment.value || undefined,
      exercises
    })
    if (result.success && result.plan) {
      createdPlan.value = result.plan
    } else {
      planNameError.value = result.error || '创建计划失败'
    }
  }
}

function startCreatedPlan() {
  if (!createdPlan.value) return
  sfx.confirm()
  const plan = createdPlan.value
  createdPlan.value = null
  fitnessStore.startSession(plan)
  router.push(`/workout/${plan.id}`)
}
</script>

<style lang="scss" scoped>
.plan-builder-page {
  padding: var(--space-xl);
  max-width: 1600px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.builder-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  flex-shrink: 0;

  h1 { margin: 0; }
}

.builder-templates {
  margin-bottom: var(--space-lg);
  flex-shrink: 0;
}

.builder-back {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-small);
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &:hover {
    background: var(--glass-bg-hover);
    color: var(--text-primary);
  }
}

.builder-subtitle {
  font-size: var(--text-small);
  color: var(--text-tertiary);
  margin-left: auto;
}

.builder-layout {
  flex: 1;
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: var(--space-lg);
  min-height: 500px;
}

.browser-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius-lg);
}

.browser-panel-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.browser-filters {
  padding: var(--space-md);
  border-bottom: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.filter-title {
  color: var(--text-tertiary);
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.filter-chip {
  padding: 3px 12px;
  background: none;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-size: var(--text-caption);
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &:hover { border-color: var(--glass-border-hover); }

  &.active {
    background: rgba(250, 88, 106, 0.15);
    border-color: rgba(250, 88, 106, 0.3);
    color: var(--accent-mist);
  }
}

.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-elevated);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);

  &:focus-within { border-color: var(--glass-border-hover); }
}

.search-input {
  background: none; border: none; color: var(--text-primary);
  font-size: var(--text-small); outline: none; flex: 1;
  &::placeholder { color: var(--text-tertiary); }
}

.browser-results {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
  min-height: 0;
  /* Limit to ~2 rows of exercise cards, scroll for more */
  max-height: 400px;
}

.browser-count {
  color: var(--text-tertiary);
  margin-bottom: var(--space-md);
}

.exercise-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-md);
}

.exercise-card {
  position: relative;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &:hover { transform: translateY(-2px); }

  &.selected {
    border-color: rgba(250, 88, 106, 0.5);
    box-shadow: 0 0 20px rgba(250, 88, 106, 0.12);
  }
}

.exercise-gif {
  width: 100%;
  aspect-ratio: 4/3;
  background: var(--bg-elevated);
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.exercise-gif-fallback {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 2rem;
  color: var(--accent-mist);
  opacity: 0.3;
}

.exercise-info {
  padding: var(--space-sm) var(--space-md);
}

.exercise-name {
  font-size: var(--text-small);
  font-weight: 500;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.exercise-tags {
  display: flex;
  gap: var(--space-xs);
}

.exercise-tag {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
  padding: 1px 6px;
  background: var(--glass-bg);
  border-radius: 4px;
}

.exercise-add-badge {
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm);
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;

  .exercise-card.selected & {
    background: rgba(250, 88, 106, 0.25);
    border-color: rgba(250, 88, 106, 0.4);
    color: var(--accent-mist);
  }
}

// Plan panel
.plan-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.plan-panel-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plan-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--glass-border);

  h3 { margin: 0; }
}

.plan-count {
  font-size: var(--text-small);
  color: var(--text-tertiary);
}

.plan-name-row {
  padding: var(--space-md) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  border-bottom: 1px solid var(--glass-border);

  label { color: var(--text-tertiary); }
}

.form-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-elevated);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-body);
  outline: none;

  &:focus { border-color: var(--accent-mist); }
  &::placeholder { color: var(--text-tertiary); }
}

.plan-name-error {
  color: #E57373;
  margin-top: 2px;
}

.selected-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-height: 0;
}

.selected-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  gap: var(--space-sm);

  .empty-icon { font-size: 2rem; opacity: 0.4; }
}

.selected-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.selected-index {
  width: 22px; height: 22px;
  border-radius: 50%;
  background: rgba(250, 88, 106, 0.15);
  color: var(--accent-mist);
  font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.selected-thumb {
  width: 48px; height: 48px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  overflow: hidden;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent-mist);
  font-size: 1.2rem;

  img { width: 100%; height: 100%; object-fit: cover; }
}

.selected-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.selected-name {
  font-size: var(--text-small);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selected-meta {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
}

.selected-params {
  display: flex;
  gap: var(--space-xs);
}

.param-field {
  display: flex;
  align-items: center;
  gap: 4px;

  label {
    font-size: 10px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  input {
    width: 42px;
    padding: 4px 2px;
    background: var(--bg-elevated);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    color: var(--text-primary);
    text-align: center;
    font-size: var(--text-small);
    outline: none;

    &:focus { border-color: var(--accent-mist); }
  }

  &.rest input { width: 50px; }
}

.selected-remove {
  width: 28px; height: 28px;
  border-radius: var(--radius-full);
  background: none;
  border: 1px solid var(--glass-border);
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;

  &:hover {
    background: rgba(229, 57, 53, 0.12);
    border-color: rgba(229, 57, 53, 0.3);
    color: #E57373;
  }
}

.plan-actions {
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--glass-border);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}

.btn-glass {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-lg);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-small);
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--glass-bg-hover);
    color: var(--text-primary);
  }

  &:disabled { opacity: 0.4; cursor: default; }

  &--accent {
    background: rgba(250, 88, 106, 0.12);
    border-color: rgba(250, 88, 106, 0.2);
    color: var(--accent-mist);

    &:hover:not(:disabled) {
      background: rgba(250, 88, 106, 0.2);
    }
  }
}

.empty-state {
  text-align: center;
  padding: var(--space-2xl) 0;
  color: var(--text-tertiary);
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  margin-top: var(--space-lg);
  padding-bottom: var(--space-md);
}

.page-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--glass-bg-hover);
    color: var(--text-primary);
    border-color: var(--glass-border-hover);
  }

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
}

.page-info {
  color: var(--text-secondary);
  min-width: 60px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

// Success modal
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 5, 10, 0.5);
  backdrop-filter: blur(8px) saturate(120%);
  -webkit-backdrop-filter: blur(8px) saturate(120%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}

.modal-content {
  position: relative;
  max-width: 420px;
  width: 90%;
  text-align: center;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.modal-content-content {
  position: relative;
  z-index: 1;
  padding: var(--space-2xl);
}

.success-icon {
  width: 64px; height: 64px;
  border-radius: 50%;
  background: rgba(77, 208, 225, 0.12);
  border: 1px solid rgba(77, 208, 225, 0.25);
  color: #4DD0E1;
  font-size: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto var(--space-lg);
}

.success-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-lg);
}

// modal 过渡已迁移至 GSAP JS hooks (useModalTransition)
</style>
