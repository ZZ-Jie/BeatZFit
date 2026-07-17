<template>
  <div class="fitness-page stage-engaged" data-fitness-page>
    <!-- ═══ 3D 圆柱卡片舞台 (Teleport 到 .app-shell, canvas reparent 到此) ═══ -->
    <Teleport to=".app-shell">
    <div class="spiral-stage" data-spiral-stage>
      <!-- Loading indicator -->
      <div v-if="loading" class="spiral-loading">
        <div class="spiral-loading-spinner"></div>
        <div class="spiral-loading-text">加载动作库…</div>
      </div>
      <div class="spiral-world" ref="worldRef">
      <div class="spiral-rotor" data-spiral-rotor>
        <div
          v-for="(ex, i) in spiral.pageItems.value"
          :key="ex.id"
          class="spiral-card"
          data-spiral-card
          data-no-rotate
          :data-index="i"
          @pointerdown="onCardPointerDown($event)"
          @click="onCardClick(ex, i, $event)"
        >
          <div class="spiral-card-inner">
            <!-- GIF (all cards loaded immediately, no lazy loading) -->
            <div class="spiral-card-gif">
              <img
                v-if="ex.gifUrl && !gifErrors[ex.id]"
                :src="toExerciseMediaUrl(ex.gifUrl)"
                :alt="ex.name"
                crossorigin="anonymous"
                loading="lazy"
                @error="gifErrors[ex.id] = true"
              />
              <div class="spiral-card-gif-fallback" v-else>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M13 2L4.09 12.97a1 1 0 0 0 .77 1.64h6.14L10 22l8.91-10.97a1 1 0 0 0-.77-1.64H12L13 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                </svg>
              </div>
            </div>
            <!-- Info -->
            <div class="spiral-card-info">
              <span class="spiral-card-name">{{ ex.chineseName || ex.name }}</span>
              <div class="spiral-card-tags">
                <span class="spiral-card-tag">{{ ex.bodyPartZh || ex.bodyPart }}</span>
                <span class="spiral-card-tag">{{ ex.equipmentZh || ex.equipment }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
    </Teleport>

    <!-- ═══ 交互层 (visualizer 拖拽/缩放绑定层, pointer-events: none 不拦截卡片) ═══ -->
    <div
      class="interaction-layer"
      ref="interactionLayerRef"
    ></div>

    <!-- 交互提示已改用全局 Toast 系统 -->

    <!-- ═══ UI 浮层 (pointer-events: none, 子元素 auto) ═══ -->
    <div class="ui-layer">
      <!-- Shelf Header (pill-shaped, matches MusicPage style) -->
      <div class="shelf-header" data-filter-root v-show="!immersivePrefs.hideFitnessShelfHeader">
        <div class="shelf-header-info">
          <div class="shelf-title">动作库</div>
          <div class="shelf-sub">{{ filteredExercises.length }} 个动作</div>
        </div>
        <div class="shelf-actions">
          <!-- Filter button (click to expand panel) -->
          <button
            class="shelf-action-btn"
            :class="{ 'shelf-action-btn--active': filterExpanded }"
            @click="toggleFilter"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3H11M3 6H9M5 9H7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            筛选
            <span class="filter-badge" v-if="activeFilterCount > 0">{{ activeFilterCount }}</span>
          </button>
          <button
            class="shelf-action-btn shelf-action-btn--accent"
            data-tour-target="sync-btn"
            @click="handleSyncClick"
            :disabled="fitnessStore.isSyncing || isRefreshing"
          >
            <span class="sync-icon" data-sync-icon>&#8635;</span>
            {{ fitnessStore.isSyncing
                ? `${fitnessStore.syncProgress.fetched}/${fitnessStore.syncProgress.total || 1500}`
                : isRefreshing ? '...' : '刷新' }}
          </button>
          <button class="shelf-action-btn" @click="goToPlanBuilder">创建计划</button>

          <!-- 紧凑分页控件 (并入 header 行) -->
          <div class="shelf-pagination" v-if="!showEmptyState && filteredExercises.length > 0">
            <span class="shelf-page-count">{{ spiral.pageItems.value.length }}/{{ filteredExercises.length }}</span>
            <div class="shelf-page-nav" v-if="spiral.totalPages.value > 1">
              <button class="shelf-page-btn" :disabled="spiral.currentPage.value <= 1" @click="onPrevPage">
                <svg width="12" height="12" viewBox="0 0 14 14"><path d="M8 3L4 7L8 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <span class="shelf-page-info">{{ spiral.currentPage.value }}/{{ spiral.totalPages.value }}</span>
              <button class="shelf-page-btn" :disabled="spiral.currentPage.value >= spiral.totalPages.value" @click="onNextPage">
                <svg width="12" height="12" viewBox="0 0 14 14"><path d="M6 3L10 7L6 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 筛选展开面板 (below shelf-header) -->
        <Transition name="filter-expand">
          <div class="filter-panel" v-if="filterExpanded" @click.stop>
            <FrostedGlass :corner-radius="20" variant="primary" />
            <div class="filter-panel-content">
              <div class="filter-group">
                <span class="filter-label text-caption">部位</span>
                <div class="filter-chips">
                  <button class="filter-chip" :class="{ active: !activeFilter.bodyPart }" @click="setBodyPart('')">全部</button>
                  <button class="filter-chip" v-for="bp in bodyPartOptions" :key="bp"
                    :class="{ active: activeFilter.bodyPart === bp }"
                    @click="setBodyPart(bp)">
                    {{ bp }}
                  </button>
                </div>
              </div>
              <div class="filter-group">
                <span class="filter-label text-caption">器械</span>
                <div class="filter-chips">
                  <button class="filter-chip" :class="{ active: !activeFilter.equipment }" @click="setEquipment('')">全部</button>
                  <button class="filter-chip" v-for="eq in equipmentOptions" :key="eq"
                    :class="{ active: activeFilter.equipment === eq }"
                    @click="setEquipment(eq)">
                    {{ eq }}
                  </button>
                </div>
              </div>
              <div class="search-box">
                <svg width="15" height="15" viewBox="0 0 15 15"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                <input type="text" placeholder="搜索动作..." v-model="activeFilter.search" class="search-input" />
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- 同步进度条 -->
      <div class="sync-progress-bar" v-if="fitnessStore.isSyncing">
        <div class="sync-progress-track">
          <div class="sync-progress-fill" :style="{ width: syncPercent + '%' }" />
        </div>
        <span class="sync-progress-text text-caption">
          {{ fitnessStore.syncProgress.fetched }} / {{ fitnessStore.syncProgress.total || 1500 }}
        </span>
      </div>

      <!-- 空状态: 无数据 -->
      <div class="empty-state-wrapper" v-if="showEmptyState && !fitnessStore.isSyncing && allExercises.length === 0">
        <EmptyState
          variant="fitness"
          title="动作库为空"
          description="点击「同步数据」从开源数据库加载 1500+ 健身动作"
        >
          <template #actions>
            <button class="btn-glass btn-glass--accent" @click="handleSyncClick" :disabled="fitnessStore.isSyncing || isRefreshing">
              同步数据
            </button>
          </template>
        </EmptyState>
      </div>

      <!-- 空状态: 筛选无结果 -->
      <div class="empty-state-wrapper" v-else-if="showEmptyState && !fitnessStore.isSyncing && allExercises.length > 0">
        <EmptyState
          variant="generic"
          title="没有匹配的动作"
          description="试试其他筛选条件"
        />
      </div>
    </div>

    <!-- 数据来源标注 -->
    <div class="data-attribution text-caption">
      动作数据由
      <a href="https://oss.exercisedb.dev" target="_blank" rel="noopener">ExerciseDB</a>
      / AscendAPI 提供
    </div>

<!-- 动作详情弹窗 — 统一使用 ExerciseDetailModal 组件 (Teleport to body: 脱离 .fitness-page 的 pointer-events: none 继承链) -->
    <Teleport to="body">
      <ExerciseDetailModal
        :exercise="detailExercise"
        @close="detailExercise = null"
        @add-to-plan="onAddToPlanFromDetail"
      />
    </Teleport>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFitnessStore } from '@/stores/fitness'
import FrostedGlass from '@/components/FrostedGlass.vue'
import EmptyState from '@/components/EmptyState.vue'
import ExerciseDetailModal from '@/components/ExerciseDetailModal.vue'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'
import type { Exercise } from '@/types'
import { animateSpin } from '@/composables/useGsapTransition'
import { useSpiralCards } from '@/composables/useSpiralCards'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useImmersivePrefs } from '@/composables/useImmersivePrefs'
import { useSfx } from '@/composables/useSfx'
// Canvas reparented into spiral-stage by useGlobalVisualizer.
// Cards z-index > canvas z-index:0 → always in front, no dimming.

const fitnessStore = useFitnessStore()
const router = useRouter()

// ── Immersive prefs ──
const { prefs: immersivePrefs } = useImmersivePrefs()
const toast = useGlobalToast()
const sfx = useSfx()

// ── 同步图标旋转动画 ──
let cleanupSpin: (() => void) | null = null
const isSpinning = computed(() => fitnessStore.isSyncing || isRefreshing)

// ── 数据 ──
// 单数据源: 直接从 store 读取, 不再维护本地副本
const allExercises = computed(() => fitnessStore.exercises)
// Module-level flag: loading indicator only shows on first app launch
let _fitnessPageLoaded = false
const loading = ref(!_fitnessPageLoaded)

const activeFilter = reactive({
  bodyPart: '' as string,
  equipment: '' as string,
  search: '' as string
})

const detailExercise = ref<Exercise | null>(null)
const gifErrors = ref<Record<string, boolean>>({})

const isRefreshing = ref(false)

// Sync result toast (uses global toast system)
let syncToastTimer: ReturnType<typeof setTimeout> | null = null
let hintTimer: ReturnType<typeof setTimeout> | null = null

const bodyPartOptions = ['胸', '肩', '背', '腿', '手臂', '核心', '全身', '拉伸']
const equipmentOptions = ['徒手', '哑铃', '杠铃', '曲杠', '绳索', '壶铃', '弹力带', '器械', '药球', '稳定球', '其他']

// ── 筛选 ──
const filteredExercises = computed(() => {
  let result = allExercises.value

  if (activeFilter.bodyPart) {
    result = result.filter(ex =>
      (ex.bodyPartZh || ex.bodyPart) === activeFilter.bodyPart
    )
  }

  if (activeFilter.equipment) {
    result = result.filter(ex =>
      (ex.equipmentZh || ex.equipment) === activeFilter.equipment
    )
  }

  if (activeFilter.search) {
    const q = activeFilter.search.toLowerCase()
    result = result.filter(ex =>
      ex.name.toLowerCase().includes(q) ||
      (ex.chineseName || '').toLowerCase().includes(q) ||
      (ex.targetZh || '').toLowerCase().includes(q)
    )
  }

  return result
})

const syncPercent = computed(() => {
  const total = fitnessStore.syncProgress.total || 1500
  return Math.min(100, Math.round((fitnessStore.syncProgress.fetched / total) * 100))
})

// ── 空状态判定 ──
const showEmptyState = computed(() => {
  if (fitnessStore.isSyncing) return false // 同步中不显示空状态 (卡片会逐步出现)
  if (loading.value) return false // 加载中不显示
  return filteredExercises.value.length === 0
})

// ── 全局可视化器 (stage 注册 + 3D 预设交互) ──
const { visualizer, registerStage, unregisterStage, attachInteraction, detachInteraction } = useGlobalVisualizer()
const stageElRef = ref<HTMLElement | null>(null)
const worldRef = ref<HTMLElement | null>(null)
const interactionLayerRef = ref<HTMLElement | null>(null)

// ── 3D 螺旋卡片系统 ──
const rotorRef = ref<HTMLElement | null>(null)

const spiral = useSpiralCards({
  items: filteredExercises,
  rotorEl: rotorRef,
  itemClass: 'spiral-card',
  pageSize: 25,
})

// ── 3D 交互: 进入页面即激活, 无需切换 ──
// visualizer 拖拽旋转 + 滚轮缩放始终生效
// 卡片跟随 visualizer 变换

// ── 筛选展开状态 ──
const filterExpanded = ref(false)
const activeFilterCount = computed(() => {
  let n = 0
  if (activeFilter.bodyPart) n++
  if (activeFilter.equipment) n++
  if (activeFilter.search) n++
  return n
})

// 点击外部关闭筛选面板 (优先级高于 3D 交互切换)
function onDocClick(e: MouseEvent) {
  if (!filterExpanded.value) return
  const target = e.target as HTMLElement
  const filterRoot = document.querySelector('[data-filter-root]')
  if (filterRoot && !filterRoot.contains(target)) {
    filterExpanded.value = false
  }
}

// (Canvas reparented into spiral-stage by useGlobalVisualizer)

// ── 3D 预设交互: 卡片始终跟随 visualizer 变换 ──
let visRAFId = 0
let visTargetRX = 0, visTargetRY = 0, visTargetScale = 1
let visDisplayRX = 0, visDisplayRY = 0, visDisplayScale = 1
let visWorldEl: HTMLElement | null = null

function visTransformLoop() {
  if (visualizer.value) {
    const t = visualizer.value.getCoverTransform()
    if (t) {
      visTargetRX = t.rotationX
      visTargetRY = t.rotationY
      visTargetScale = t.scale
    }
  }

  visDisplayRX += (visTargetRX - visDisplayRX) * 0.12
  visDisplayRY += (visTargetRY - visDisplayRY) * 0.12
  visDisplayScale += (visTargetScale - visDisplayScale) * 0.12

  if (visWorldEl) {
    const degX = (visDisplayRX * 180 / Math.PI).toFixed(2)
    const degY = (visDisplayRY * 180 / Math.PI).toFixed(2)
    visWorldEl.style.transform = `rotateX(${-degX}deg) rotateY(${degY}deg) scale(${visDisplayScale.toFixed(3)})`
  }

  visRAFId = requestAnimationFrame(visTransformLoop)
}

function startVisualizerInteraction() {
  // Attach visualizer interaction to the spiral-stage (which contains the cards)
  // Cards have data-no-rotate attribute → visualizer's isOnInteractiveChild detects
  // them and skips drag. Drag on cards is handled by spiral.onPointerDown (cylinder
  // rotation). Drag on empty stage area → visualizer 3D rotation.
  // Wheel on cards → spiral.onWheel on rotor (stopPropagation prevents visualizer zoom).
  // Wheel on empty stage area → visualizer 3D zoom.
  const stageEl = document.querySelector<HTMLElement>('[data-spiral-stage]')
  if (stageEl) {
    attachInteraction(stageEl)
  }
  visWorldEl = document.querySelector<HTMLElement>('[data-fitness-page] .spiral-world') ||
               document.querySelector<HTMLElement>('.spiral-world')
  // 不重置 visDisplay 值 — 保留当前 3D 旋转/缩放状态
  // 避免弹窗关闭后世界变换重置到 0 导致视觉跳变
  if (!visRAFId) visTransformLoop()
}

// ── Card click handler (distinguishes click vs drag) ──
let cardDownX = 0, cardDownY = 0, cardDownTime = 0

function onCardPointerDown(e: PointerEvent) {
  spiral.onPointerDown(e)
  cardDownX = e.clientX
  cardDownY = e.clientY
  cardDownTime = performance.now()
}

function onCardClick(ex: Exercise, _i: number, e: MouseEvent) {
  // Check if this was a real click, not a drag
  const dx = Math.abs(cardDownX - e.clientX)
  const dy = Math.abs(cardDownY - e.clientY)
  const dt = performance.now() - cardDownTime
  if (dx > 8 || dy > 8 || dt > 500) return // It was a drag, not a click
  sfx.airBloom()
  openDetail(ex)
}

// ── 同步逻辑 ──

// During first-time sync, hide loading state
watch(() => fitnessStore.isSyncing, (syncing) => {
  if (syncing && allExercises.value.length === 0) {
    loading.value = false
  }
})

// 筛选条件变化时重置到第一页
watch(() => [activeFilter.bodyPart, activeFilter.equipment, activeFilter.search], () => {
  spiral.currentPage.value = 1
}, { deep: true })

// 同步图标旋转动画
watch(isSpinning, (spinning) => {
  const page = document.querySelector<HTMLElement>('[data-fitness-page]')
  const icon = page?.querySelector<HTMLElement>('[data-sync-icon]')
  if (spinning && icon) {
    cleanupSpin = animateSpin(icon)
  } else {
    cleanupSpin?.()
    cleanupSpin = null
  }
})

// ── 弹窗打开时禁用 3D 交互, 关闭时恢复 ──
// 弹窗打开后, 所有拖拽/滚轮手势应作用于弹窗 (关闭按钮、加入计划等),
// 而不是被 visualizer 拦截为 3D 旋转/缩放。
watch(detailExercise, (ex) => {
  if (ex) {
    detachInteraction()
  } else {
    startVisualizerInteraction()
  }
})

onMounted(async () => {
  // 手动设置 ref (避免 Vue 3.5.39 SFC ref= 编译 bug)
  const stage = document.querySelector<HTMLElement>('[data-spiral-stage]')
  const rotor = document.querySelector<HTMLElement>('[data-spiral-rotor]')
  const layer = document.querySelector<HTMLElement>('[data-fitness-page] .interaction-layer')
  stageElRef.value = stage
  rotorRef.value = rotor
  interactionLayerRef.value = layer

  // 注册 3D stage, IntersectionObserver 会自动在滚动时将 canvas reparent 到此
  if (stage) {
    registerStage('fitness', stage)
  }

  // Fast path: data already loaded — skip loading indicator
  if (_fitnessPageLoaded) {
    loading.value = false
  } else {
    await loadAllExercises()
    _fitnessPageLoaded = true
    loading.value = false
  }

  await spiral.init()

  // 点击外部关闭筛选面板
  document.addEventListener('click', onDocClick)

  // ── 进入页面即激活 3D 交互 ──
  // 从 visualizer 当前状态初始化, 避免重挂载时从 0 lerp 导致旋转动画
  if (visualizer.value) {
    const t = visualizer.value.getCoverTransform()
    if (t) {
      visTargetRX = visDisplayRX = t.rotationX
      visTargetRY = visDisplayRY = t.rotationY
      visTargetScale = visDisplayScale = t.scale
    }
  }
  startVisualizerInteraction()

  // Show interaction hint toast once per app session, auto-hide after 3.5s
  hintTimer = setTimeout(() => {
    toast.showOnce('fitness-hint', 'info', '拖拽旋转 3D 场景 · 滚轮缩放 · 点击卡片查看详情', 3500)
  }, 600)
})

// Must use onBeforeUnmount (NOT onUnmounted) so the canvas is moved back to
// GlobalBackground BEFORE Vue destroys the Teleport DOM. If we wait until
// onUnmounted, the stage DOM is already removed and the canvas is destroyed.
onBeforeUnmount(() => {
  cleanupSpin?.()
  if (visRAFId) {
    cancelAnimationFrame(visRAFId)
    visRAFId = 0
  }
  detachInteraction()
  // 重置 world transform
  if (visWorldEl) {
    visWorldEl.style.transform = ''
  }
  // 注销 3D stage, canvas 自动回到 GlobalBackground 或下一个可见 stage
  unregisterStage('fitness')
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  spiral.destroy()
  // 释放 GIF 内存: 清空所有 img src, 让浏览器回收解码后的位图
  const imgs = document.querySelectorAll<HTMLImageElement>('[data-spiral-card] img')
  imgs.forEach(img => { img.src = '' })
  if (syncToastTimer) clearTimeout(syncToastTimer)
  if (hintTimer) clearTimeout(hintTimer)
})

async function loadAllExercises() {
  const hasData = await fitnessStore.hasLocalData()
  if (hasData) {
    await fitnessStore.loadExercises(undefined, true)
  } else {
    await syncExercises()
  }
}

async function handleSyncClick() {
  sfx.detent()
  if (allExercises.value.length > 0) {
    await reloadFromLocalDB()
  } else {
    await syncExercises()
  }
}

async function reloadFromLocalDB() {
  isRefreshing.value = true
  try {
    await fitnessStore.loadExercises(undefined, true)
    showSyncToast(`已从本地加载 ${allExercises.value.length} 个动作`, 0)
  } catch (e) {
    console.error('Failed to reload from DB:', e)
  } finally {
    isRefreshing.value = false
  }
}

async function syncExercises() {
  await fitnessStore.syncExercises()
  await fitnessStore.loadExercises(undefined, true)
  const result = fitnessStore.syncResult
  if (result) {
    if (result.failed > 0) {
      showSyncToast(
        `同步完成：${result.total} 个动作，${result.failed} 个因 GIF 缺失已丢弃`,
        result.failed
      )
    } else {
      showSyncToast(`同步完成：已加载 ${result.total} 个动作`, 0)
    }
  }
}

function showSyncToast(message: string, failed: number) {
if (syncToastTimer) clearTimeout(syncToastTimer)
if (failed > 0) {
toast.warning(message)
} else {
toast.success(message)
}
}

async function openDetail(ex: Exercise) {
  const fullExercise = await fitnessStore.loadExerciseById(ex.id)
  detailExercise.value = fullExercise
}

function goToPlanBuilder() {
  sfx.confirm()
  router.push('/plan/build')
}

function toggleFilter() {
  if (filterExpanded.value) sfx.retract()
  else sfx.detent()
  filterExpanded.value = !filterExpanded.value
}

function onPrevPage() {
  sfx.detent()
  spiral.prevPage()
}

function onNextPage() {
  sfx.detent()
  spiral.nextPage()
}

function setBodyPart(bp: string) {
  sfx.detent()
  activeFilter.bodyPart = activeFilter.bodyPart === bp ? '' : bp
}

function setEquipment(eq: string) {
  sfx.detent()
  activeFilter.equipment = activeFilter.equipment === eq ? '' : eq
}

function onAddToPlanFromDetail(ex: Exercise) {
  sfx.confirm()
  fitnessStore.addPendingExercise(ex)
  detailExercise.value = null
  router.push('/plan/build')
}
</script>

<style lang="scss" scoped>
.fitness-page {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none; /* Let events pass through to spiral-stage below */

  /* Engaged 3D mode: subtle vignette to indicate interaction state */
  &.stage-engaged::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 5; /* Above interaction-layer (1), below ui-layer (10) */
    pointer-events: none;
    box-shadow: inset 0 0 120px 20px rgba(0, 0, 0, 0.35);
    transition: box-shadow 300ms ease;
  }
}

/* ═══ 交互层 ═══ */
/* Full-screen transparent layer inside fitness-page.
   Always pointer-events: auto — visualizer drag/wheel handlers are attached here.
   PlayerBar/UserCapsule (z-index: 200+) are above app-layout, so they remain clickable.
   UI children (.ui-layer z-index: 10) are above this layer (z-index: 1), so they remain clickable. */
.interaction-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none; /* Does not capture events — visualizer is attached to spiral-stage */
}

/* ═══ 3D 螺旋舞台 ═══ */
/* Teleported to .app-shell (position:fixed fills full window, no app-layout
   padding clipping). Canvas reparented here by useGlobalVisualizer.
   Canvas at translateZ(-1px) sits between front cards (Z>0) and back cards (Z<0).
   Canvas is transparent — back cards visible through it, creating cylinder wrap. */
.spiral-stage {
  position: fixed;
  inset: 0;
  perspective: 2200px;
  perspective-origin: 50% 50%;
  z-index: 2;
  transform-style: preserve-3d;
  pointer-events: auto; /* Capture drag/wheel for visualizer 3D interaction */
  cursor: grab;
  &:active { cursor: grabbing; }
  touch-action: none;

:deep(canvas) {
display: block;
position: absolute;
inset: 0;
width: 100% !important;
height: 100% !important;
    pointer-events: none;
    z-index: 0;
    transform: translateZ(-3px);
  }
}

/* World wrapper — receives visualizer transform when engaged */
.spiral-world {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-style: preserve-3d;
  will-change: transform;
}

.spiral-rotor {
  position: absolute;
  left: 0;
  top: 0;
  transform-style: preserve-3d;
  will-change: transform;
}

.spiral-card {
  position: absolute;
  left: 0;
  top: 0;
  transform-style: preserve-3d;
  /* Base transform: position + billboard rotation (Y + X) + depth scale */
  transform: translate3d(var(--sx, 0), var(--sy, 0), var(--sz, 0)) rotateY(var(--sry, 0)) rotateX(var(--srx, 0)) scale(var(--sds, 1));
}

.spiral-card-inner {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 130px;
  height: 170px;
  margin-left: -65px;
  margin-top: -85px;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  contain: layout paint;
  /* Promote to own compositing layer — text stays crisp when parent
     spiral-world is scaled by visualizer zoom. Without this, the browser
     rasterizes text at the scaled resolution then downsamples → blur. */
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  transition: transform 0.2s ease,
              border-color 0.2s ease,
              box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-6px) scale(1.05);
    border-color: rgba(255, 255, 255, 0.35);
  }
}

/* Focus (front) card */
.spiral-card.focus .spiral-card-inner {
  border-color: rgba(255, 255, 255, 0.3);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5),
              0 0 0 1px rgba(255, 255, 255, 0.08);
}

.spiral-card.focus .spiral-card-inner:hover {
  transform: translateY(-8px) scale(1.08);
  border-color: rgba(255, 255, 255, 0.45);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6),
              0 0 0 1px rgba(255, 255, 255, 0.12);
}

.spiral-card-gif {
  width: 100%;
  aspect-ratio: 4/3;
  background: rgba(0, 0, 0, 0.3);
  overflow: hidden;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.spiral-card-gif-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(126, 200, 227, 0.3);
}

.spiral-card-info {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  /* Sharp text rendering inside 3D-scaled parent */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: geometricPrecision;
}

.spiral-card-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Keep text on its own compositing layer to avoid blur from parent scale */
  transform: translateZ(0);
}

.spiral-card-tags {
  display: flex;
  gap: 4px;
  transform: translateZ(0);
}

.spiral-card-tag {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  white-space: nowrap;
}

/* ═══ UI 浮层 ═══ */
.ui-layer {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;

  & > * {
    pointer-events: auto;
  }
}

/* ── Shelf Header (pill-shaped, matches MusicPage) ── */
.shelf-header {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: rgba(12, 12, 16, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  max-width: 80%;
}

.shelf-header-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.shelf-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(234, 242, 248, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shelf-sub {
  font-size: 11px;
  color: rgba(234, 242, 248, 0.4);
  margin-top: 1px;
}

.shelf-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.shelf-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;

  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.95); }
  &:disabled { opacity: 0.4; cursor: default; }
  &--active {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.25);
    color: #fff;
  }
  &--accent {
    background: rgba(250, 88, 106, 0.12);
    border-color: rgba(250, 88, 106, 0.2);
    color: rgba(250, 88, 106, 0.9);
    &:hover:not(:disabled) { background: rgba(250, 88, 106, 0.2); }
  }
}

.filter-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 700;
  background: var(--accent);
  color: #fff;
  border-radius: 8px;
  line-height: 1;
}

/* ── 筛选展开面板 ── */
.filter-panel {
  position: absolute;
  top: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  width: min(560px, 80vw);
  border-radius: 20px;
  overflow: hidden;
  z-index: 20;
}

.filter-panel-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
}

.filter-expand-enter-active,
.filter-expand-leave-active {
  transition: opacity 250ms var(--ease-standard),
              transform 250ms var(--ease-standard);
}
.filter-expand-enter-from,
.filter-expand-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

.sync-progress-bar {
  position: absolute;
  top: 70px;
  left: var(--space-xl);
  right: var(--space-xl);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.sync-progress-track {
  flex: 1;
  height: 4px;
  background: var(--glass-bg);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.sync-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-mist));
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
}

.sync-progress-text {
  color: var(--text-tertiary);
  white-space: nowrap;
  min-width: 60px;
  text-align: right;
}

/* ── Buttons ── */
.btn-glass {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-lg);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-small);
  cursor: pointer;
  transition: background 150ms var(--ease-standard),
              border-color 150ms var(--ease-standard),
              color 150ms var(--ease-standard),
              transform 150ms var(--ease-standard);
  transform: translateZ(0);
  contain: layout paint;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  &:hover:not(:disabled) {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
    color: var(--text-primary);
  }

  &:disabled { opacity: 0.4; cursor: default; }

  &--accent {
    background: rgba(250, 88, 106, 0.12);
    border-color: rgba(250, 88, 106, 0.2);
    color: var(--accent-mist);

    &:hover:not(:disabled) {
      background: rgba(250, 88, 106, 0.2);
      border-color: rgba(250, 88, 106, 0.35);
    }
  }
}

.sync-icon {
  display: inline-block;
}

/* ── Filter (in dropdown panel) ── */

.filter-group {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.filter-label {
  width: 40px;
  flex-shrink: 0;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.filter-chip {
  padding: 3px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-size: var(--text-caption);
  cursor: pointer;
  transition: background 150ms var(--ease-standard),
              border-color 150ms var(--ease-standard),
              color 150ms var(--ease-standard);
  transform: translateZ(0);

  &:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
  }

  &.active {
    background: rgba(250, 88, 106, 0.18);
    border-color: rgba(250, 88, 106, 0.35);
    color: var(--accent-mist);
  }
}

.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: border-color 150ms var(--ease-standard),
              background 150ms var(--ease-standard);
  transform: translateZ(0);
  contain: layout paint;

  &:focus-within {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
  }
}

.search-input {
  background: none; border: none; color: var(--text-primary);
  font-size: var(--text-small); outline: none; flex: 1;
  &::placeholder { color: var(--text-tertiary); }
}

/* ── Compact pagination (in shelf-header) ── */
.shelf-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 8px;
  margin-left: 2px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.shelf-page-count {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.shelf-page-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.shelf-page-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.95);
  }

  &:disabled {
    opacity: 0.25;
    cursor: default;
  }
}

.shelf-page-info {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 28px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ── Empty state ── */
.empty-state-wrapper {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Data attribution ── */
.data-attribution {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  color: var(--text-tertiary);
  opacity: 0.4;
  z-index: 5;
  pointer-events: none;

  a {
    color: var(--accent-mist);
    text-decoration: none;
    pointer-events: auto;
    &:hover { text-decoration: underline; }
  }
}

/* ── Modal styles removed — now using ExerciseDetailModal component ── */

// ── Loading indicator ──
.spiral-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  z-index: 10;
  pointer-events: none;
}
.spiral-loading-spinner {
  width: 40px;
  height: 40px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-top-color: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  animation: spiral-spin 0.8s linear infinite;
}
.spiral-loading-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.05em;
}
@keyframes spiral-spin { to { transform: rotate(360deg); } }
</style>
