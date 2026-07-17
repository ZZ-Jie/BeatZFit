<template>
  <div class="data-page" ref="pageRootRef"
    :class="{ 'stage-engaged': interactionEngaged }"
    @pointerdown="onDataPointerDown"
    @click="onDataClick"
  >
    <header class="page-header">
      <h1 class="text-h1">训练数据</h1>
    </header>

    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="stats-row-skeleton">
<div class="stat-card-skeleton" v-for="i in 4" :key="i">
<div class="stat-card-content" style="align-items: center; gap: 8px;">
            <div class="skeleton-line skeleton-line--lg" style="width: 48px;" />
            <div class="skeleton-line skeleton-line--sm" style="width: 60px;" />
          </div>
        </div>
      </div>
      <div class="charts-row-top">
<section class="chart-section chart-section--bar">
<div class="chart-content">
<div class="skeleton-line skeleton-line--lg" style="width: 140px; margin-bottom: var(--space-md);" />
<div class="skeleton-block" style="height: 280px;" />
</div>
</section>
<section class="chart-section chart-section--donut">
<div class="chart-content">
<div class="skeleton-line skeleton-line--lg" style="width: 100px; margin-bottom: var(--space-md);" />
<div class="skeleton-circle" style="width: 160px; height: 160px; margin: 0 auto;" />
</div>
</section>
<section class="chart-section chart-section--duration">
<div class="chart-content">
<div class="skeleton-line skeleton-line--lg" style="width: 120px; margin-bottom: var(--space-md);" />
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div class="skeleton-line" style="height: 20px;" v-for="i in 5" :key="i" :style="{ width: 100 - i * 12 + '%' }" />
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Real content -->
    <template v-else>
    <!-- 3D KPI 深度弧牌堆 -->
    <section class="kpi-stage" ref="kpiStageRef">
      <div class="kpi-world" ref="kpiWorldRef">
        <div class="stat-card" data-kpi-card v-for="(stat, i) in kpiStats" :key="i"
             :ref="el => setKpiCardRef(el as HTMLElement, i)"
             @mouseenter="setKpiFocus(i)"
             :class="{ 'is-hero': i === kpiFocus }">
          <div class="stat-card-content">
            <span class="stat-number">{{ stat.value }}</span>
            <span class="stat-desc">{{ stat.label }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 3D 图表舞台 -->
    <section class="chart-stage">
      <div class="chart-world" ref="chartWorldRef">
        <!-- 图表第一行: 2:1:1 布局 -->
        <div class="charts-row-top">
          <!-- 柱状图: 本周训练时长 (占 2 份) -->
<section class="chart-section chart-section--bar chart-card-3d is-entering" style="--rz: 0px;">
<div class="chart-content">
<h3 class="text-h3 chart-title">本周训练时长</h3>
              <svg class="chart-svg" viewBox="0 0 900 320" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" :style="{ stopColor: 'var(--chart-primary)', stopOpacity: 0.9 }" />
                    <stop offset="100%" :style="{ stopColor: 'var(--chart-dark)', stopOpacity: 0.15 }" />
                  </linearGradient>
                </defs>
                <!-- Grid lines -->
                <line v-for="(label, i) in barYLabels" :key="'bgrid-' + i"
                  :x1="48" :x2="900" :y1="label.y" :y2="label.y"
                  stroke="rgba(255,255,255,0.05)" stroke-width="1" />
                <!-- Y-axis labels -->
                <text v-for="(label, i) in barYLabels" :key="'bylabel-' + i"
                  :x="42" :y="label.y + 4" text-anchor="end"
                  fill="rgba(255,255,255,0.35)" font-size="10">{{ label.text }}</text>
                <!-- Bars -->
                <rect v-for="(bar, i) in barChartBars" :key="'bar-' + i"
                  :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height"
                  rx="4" fill="url(#barGrad)" />
                <!-- Bar values (only non-zero) -->
                <template v-for="(bar, i) in barChartBars" :key="'barval-' + i">
                  <text v-if="bar.value > 0"
                    :x="bar.x + bar.width / 2" :y="bar.y - 6" text-anchor="middle"
                    :style="{ fill: 'var(--chart-primary)', opacity: 0.8 }" font-size="10">{{ bar.value }}m</text>
                </template>
                <!-- X-axis labels -->
                <text v-for="(bar, i) in barChartBars" :key="'bxlabel-' + i"
                  :x="bar.x + bar.width / 2" :y="308" text-anchor="middle"
                  fill="rgba(255,255,255,0.35)" font-size="11">{{ bar.label }}</text>
              </svg>
            </div>
          </section>

          <!-- 饼图: 训练完成率 (占 1 份) -->
<section class="chart-section chart-section--donut chart-card-3d is-entering" style="--rz: -14px;">
<div class="chart-content">
<h3 class="text-h3 chart-title">训练完成率</h3>
              <div class="donut-container">
                <svg class="donut-svg" viewBox="0 0 200 200">
                  <defs>
                    <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" :style="{ stopColor: 'var(--chart-light)' }" />
                      <stop offset="100%" :style="{ stopColor: 'var(--chart-dark)' }" />
                    </linearGradient>
                  </defs>
                  <!-- Background circle -->
                  <circle cx="100" cy="100" r="70" fill="none"
                    stroke="rgba(255,255,255,0.06)" stroke-width="20" />
                  <!-- Completed arc -->
                  <circle cx="100" cy="100" r="70" fill="none"
                    stroke="url(#donutGrad)" stroke-width="20"
                    :stroke-dasharray="donutArc"
                    transform="rotate(-90 100 100)"
                    stroke-linecap="round" />
                  <!-- Center text -->
                  <text x="100" y="98" text-anchor="middle"
                    fill="#F5F7FA" font-size="32" font-weight="600">{{ completionData.percentage }}%</text>
                  <text x="100" y="118" text-anchor="middle"
                    fill="rgba(255,255,255,0.4)" font-size="11">完成率</text>
                </svg>
                <div class="donut-legend">
                  <div class="legend-item">
                    <span class="legend-dot legend-dot--completed"></span>
                    <span class="legend-text">已完成 {{ completionData.completed }}</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-dot legend-dot--incomplete"></span>
                    <span class="legend-text">未完成 {{ completionData.notCompleted }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 水平条形图: 训练时长分布 (占 1 份) -->
<section class="chart-section chart-section--dist chart-card-3d is-entering" style="--rz: -8px;">
<div class="chart-content">
<h3 class="text-h3 chart-title">时长分布</h3>
              <div class="dist-list">
                <div class="dist-item" v-for="bucket in durationBuckets" :key="bucket.label">
                  <span class="dist-label">{{ bucket.label }}</span>
                  <div class="dist-bar-track">
                    <div class="dist-bar-fill" :style="{ width: bucket.percent + '%' }"></div>
                  </div>
                  <span class="dist-count">{{ bucket.count }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- 图表第二行: 3:2 布局 (趋势 + 热力图) -->
        <div class="charts-row-bottom">
          <!-- 线状图: 训练趋势 -->
<section class="chart-section chart-card-3d is-entering" style="--rz: -4px;">
<div class="chart-content">
<h3 class="text-h3 chart-title">训练趋势 <span class="chart-subtitle">近14天</span></h3>
              <svg class="chart-svg" viewBox="0 0 900 320" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" :style="{ stopColor: 'var(--chart-primary)', stopOpacity: 0.25 }" />
                    <stop offset="100%" :style="{ stopColor: 'var(--chart-primary)', stopOpacity: 0 }" />
                  </linearGradient>
                  <linearGradient id="lineStrokeGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" :style="{ stopColor: 'var(--chart-dark)' }" />
                    <stop offset="50%" :style="{ stopColor: 'var(--chart-primary)' }" />
                    <stop offset="100%" :style="{ stopColor: 'var(--chart-light)' }" />
                  </linearGradient>
                </defs>
                <!-- Grid lines -->
                <line v-for="(label, i) in lineYLabels" :key="'lgrid-' + i"
                  :x1="48" :x2="900" :y1="label.y" :y2="label.y"
                  stroke="rgba(255,255,255,0.05)" stroke-width="1" />
                <!-- Y-axis labels -->
                <text v-for="(label, i) in lineYLabels" :key="'lylabel-' + i"
                  :x="42" :y="label.y + 4" text-anchor="end"
                  fill="rgba(255,255,255,0.35)" font-size="10">{{ label.text }}</text>
                <!-- Area fill -->
                <path :d="lineAreaPath" fill="url(#lineAreaGrad)" />
                <!-- Line -->
                <path :d="linePathStr" fill="none"
                  stroke="url(#lineStrokeGrad)" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" />
                <!-- Data points -->
                <circle v-for="(p, i) in lineChartPoints" :key="'lpt-' + i"
                  :cx="p.x" :cy="p.y" r="3" :style="{ fill: 'var(--chart-primary)' }" />
                <!-- X-axis labels (every 2 days) -->
                <text v-for="(p, i) in lineXLabels" :key="'lxlabel-' + i"
                  :x="p.x" :y="308" text-anchor="middle"
                  fill="rgba(255,255,255,0.35)" font-size="10">{{ p.date }}</text>
              </svg>
            </div>
          </section>

          <!-- 训练历史热力图 -->
<section class="data-section chart-card-3d is-entering" style="--rz: -18px;">
<div class="data-section-content">
              <div class="heatmap-header">
                <h3 class="text-h3">训练历史</h3>
                <div class="heatmap-nav">
                  <button class="heatmap-nav-btn" @click="goPrevMonth" title="上个月">
                    <svg width="14" height="14" viewBox="0 0 14 14"><path d="M8 3L4 7L8 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <span class="heatmap-month-label">{{ heatmapMonthLabel }}</span>
                  <button class="heatmap-nav-btn" :disabled="!canGoNextMonth" @click="goNextMonth" title="下个月">
                    <svg width="14" height="14" viewBox="0 0 14 14"><path d="M6 3L10 7L6 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </div>

              <!-- 星期表头 -->
              <div class="heatmap-weekdays">
                <span v-for="wd in ['日', '一', '二', '三', '四', '五', '六']" :key="wd">{{ wd }}</span>
              </div>

              <!-- 日历网格 -->
              <div class="heatmap-grid">
                <div
                  v-for="(cell, i) in heatmapCells"
                  :key="i"
                  class="heatmap-cell"
                  :class="{ 'heatmap-cell--empty': !cell.day, 'heatmap-cell--future': cell.isFuture }"
                  :style="cell.day && !cell.isFuture ? { background: heatmapColor(cell.durationMin) } : {}"
                  :title="cell.day ? cell.tooltip : ''"
                >
                  <span v-if="cell.day" class="heatmap-day-num">{{ cell.day }}</span>
                  <span v-if="cell.day && cell.durationMin > 0" class="heatmap-day-duration">{{ cell.durationMin }}m</span>
                </div>
              </div>

              <!-- 图例 -->
              <div class="heatmap-legend">
                <span class="text-caption" style="color: var(--text-tertiary);">少</span>
                <span class="heatmap-legend-cell" style="background: rgba(255, 255, 255, 0.04);"></span>
                <span class="heatmap-legend-cell" style="background: rgba(var(--chart-primary-rgb, 250, 88, 106), 0.15);"></span>
                <span class="heatmap-legend-cell" style="background: rgba(var(--chart-primary-rgb, 250, 88, 106), 0.35);"></span>
                <span class="heatmap-legend-cell" style="background: rgba(var(--chart-primary-rgb, 250, 88, 106), 0.6);"></span>
                <span class="heatmap-legend-cell" style="background: rgba(var(--chart-primary-rgb, 250, 88, 106), 0.85);"></span>
                <span class="text-caption" style="color: var(--text-tertiary);">多</span>
              </div>
            </div>
          </section>
        </div>

      </div>
    </section>
    </template>
  </div>
</template>

<script lang="ts">
// Module-level flag — persists across mount/unmount cycles in the
// horizontal single-page v-if architecture. Skeleton only shows on the
// first app launch; subsequent page switches skip the loading animation.
let _dataPageLoaded = false
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useFitnessStore } from '@/stores/fitness'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'
import { useSfx } from '@/composables/useSfx'
import { animateShimmerAll } from '@/composables/useGsapTransition'

const fitnessStore = useFitnessStore()
const { visualizer, registerStage, unregisterStage, attachInteraction, detachInteraction } = useGlobalVisualizer()
const sfx = useSfx()
const totalWorkouts = ref(0)
// Module-level flag: skeleton only shows on first app launch
// (declared in the <script> block above so it survives unmount/remount)
const loading = ref(!_dataPageLoaded)

const pageRootRef = ref<HTMLElement | null>(null)

// ── 3D 交互态 ──
const interactionEngaged = ref(false)
let dataPointerDownX = 0, dataPointerDownY = 0, dataPointerDownTime = 0

function onDataPointerDown(e: PointerEvent) {
  dataPointerDownX = e.clientX
  dataPointerDownY = e.clientY
  dataPointerDownTime = performance.now()
}

function onDataClick(e: MouseEvent) {
  // Card clicks should not toggle engagement
  const target = e.target as HTMLElement
  if (target.closest('.stat-card') || target.closest('.chart-card-3d') || target.closest('.chart-section') || target.closest('.page-header') || target.closest('.heatmap-cell')) return
  // Only toggle on real clicks, not drags
  const dx = Math.abs(dataPointerDownX - e.clientX)
  const dy = Math.abs(dataPointerDownY - e.clientY)
  const dt = performance.now() - dataPointerDownTime
  if (dx > 5 || dy > 5 || dt > 300) return
  interactionEngaged.value = !interactionEngaged.value
}

watch(interactionEngaged, (engaged) => {
  if (engaged && pageRootRef.value) {
    attachInteraction(pageRootRef.value)
  } else {
    detachInteraction()
  }
})

onMounted(async () => {
  // Fast path: data already loaded — skip loading animation
  if (_dataPageLoaded) {
    loading.value = false
    totalWorkouts.value = fitnessStore.records.length
    // Register DataPage as a 3D stage + init depth arc engine
    // (loading was already false, so the watch(loading,...) callback
    //  never fires — we must call initDepthArc() explicitly here)
    nextTick(() => {
      if (pageRootRef.value) {
        registerStage('data', pageRootRef.value)
      }
      initDepthArc()
    })
    return
  }

  // Slow path: first mount — load data
  const shimmerCleanup = animateShimmerAll(pageRootRef.value)
  try {
    await fitnessStore.loadStats()
    await fitnessStore.loadRecords()
    totalWorkouts.value = fitnessStore.records.length
    _dataPageLoaded = true
  } finally {
    // Ensure skeleton is visible for at least 400ms
    await new Promise(r => setTimeout(r, 400))
    shimmerCleanup()
    loading.value = false
    // Register DataPage as a 3D stage
    nextTick(() => {
      if (pageRootRef.value) {
        registerStage('data', pageRootRef.value)
      }
    })
  }
})

// === 3D 深度弧引擎 ===
const kpiStageRef = ref<HTMLElement | null>(null)
const kpiWorldRef = ref<HTMLElement | null>(null)
const chartWorldRef = ref<HTMLElement | null>(null)
const kpiCardRefs: (HTMLElement | null)[] = []
const kpiFocus = ref(0)

interface CardState {
  el: HTMLElement
  i: number
  cur: { x: number; z: number; ry: number; s: number; br: number; o: number }
  tgt: { x: number; z: number; ry: number; s: number; br: number; o: number }
  start: number
  moving: boolean
}

let depthCards: CardState[] = []
let rafId: number | null = null

// 深度弧参数（可由 ControlPanel DIY 动态调整）
let ARC_PARALLAX = 8
let ARC_DEPTH_MUL = 1.0
let ARC_GAP = 128

function loadKpiPrefs() {
  try {
    const raw = localStorage.getItem('beatzfit:kpiPrefs')
    if (raw) {
      const p = JSON.parse(raw)
      ARC_PARALLAX = p.parallax ?? 8
      ARC_DEPTH_MUL = p.depthMul ?? 1.0
      ARC_GAP = p.gap ?? 128
    }
  } catch (e) { console.warn('[DataPage] Failed to load KPI prefs:', e) }
}
loadKpiPrefs()

function onKpiPrefsChanged() {
  loadKpiPrefs()
  computeTargets()
}

// ── 3D 交互态: visualizer 变换状态 ──
let visTargetRX = 0, visTargetRY = 0, visTargetScale = 1
let visDisplayRX = 0, visDisplayRY = 0, visDisplayScale = 1

// 指针视差状态
let tgtWX = 0, tgtWY = 0, curWX = 0, curWY = 0

const kpiStats = computed(() => [
  { value: fitnessStore.stats.todayWorkouts, label: '今日训练' },
  { value: formatDuration(fitnessStore.stats.weekDurationSeconds), label: '本周时长' },
  { value: totalWorkouts.value, label: '总训练次数' },
  { value: `${completionData.value.percentage}%`, label: '完成率' },
])

function setKpiCardRef(el: HTMLElement | null, i: number) {
  if (el) kpiCardRefs[i] = el
}

function setKpiFocus(i: number) {
  kpiFocus.value = i
  computeTargets()
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

function computeTargets() {
  depthCards.forEach((c) => {
    const off = c.i - kpiFocus.value
    const abs = Math.abs(off)
    const dir = off > 0 ? 1 : -1
    const t = c.tgt
    if (off === 0) {
      t.x = 0; t.z = 0; t.ry = 0; t.s = 1.12; t.br = 1.1; t.o = 1
    } else {
      t.x = off * ARC_GAP
      t.z = -abs * 120 * ARC_DEPTH_MUL
      t.ry = -dir * 34 * ARC_DEPTH_MUL
      t.s = Math.max(0.80, 1 - abs * 0.13)
      t.br = Math.max(0.62, 1 - abs * 0.16)
      t.o = 1
    }
  })
}

function tick(now: number) {
  // ── Visualizer transform (engaged 时读取, 非 engaged 时回归 0) ──
  if (interactionEngaged.value && visualizer.value) {
    const t = visualizer.value.getCoverTransform()
    if (t) {
      visTargetRX = t.rotationX
      visTargetRY = t.rotationY
      visTargetScale = t.scale
    }
  } else {
    visTargetRX = 0
    visTargetRY = 0
    visTargetScale = 1
  }
  visDisplayRX += (visTargetRX - visDisplayRX) * 0.12
  visDisplayRY += (visTargetRY - visDisplayRY) * 0.12
  visDisplayScale += (visTargetScale - visDisplayScale) * 0.12

  // ── Pointer parallax (非 engaged 时跟随鼠标, engaged 时回归 0) ──
  if (!interactionEngaged.value) {
    curWX = lerp(curWX, tgtWX, 0.07)
    curWY = lerp(curWY, tgtWY, 0.07)
  } else {
    curWX = lerp(curWX, 0, 0.12)
    curWY = lerp(curWY, 0, 0.12)
  }
  const idle = Math.sin(now / 2600) * 1.0

  // ── 合并 visualizer 变换 + 残余视差 ──
  const visDegX = visDisplayRX * 180 / Math.PI
  const visDegY = visDisplayRY * 180 / Math.PI
  const visScale = visDisplayScale

  if (kpiWorldRef.value) {
    const totalX = -visDegX + curWX + idle * 0.4
    const totalY = visDegY + curWY
    kpiWorldRef.value.style.transform = `rotateX(${totalX.toFixed(2)}deg) rotateY(${totalY.toFixed(2)}deg) scale(${visScale.toFixed(3)})`
  }
  if (chartWorldRef.value) {
    const totalX = -visDegX + curWX * 0.45
    const totalY = visDegY + curWY * 0.45
    chartWorldRef.value.style.transform = `rotateX(${totalX.toFixed(2)}deg) rotateY(${totalY.toFixed(2)}deg) scale(${visScale.toFixed(3)})`
  }

  depthCards.forEach((c) => {
    if (!c.moving && now >= c.start) c.moving = true
    if (c.moving) {
      const f = 0.10
      c.cur.x = lerp(c.cur.x, c.tgt.x, f)
      c.cur.z = lerp(c.cur.z, c.tgt.z, f)
      c.cur.ry = lerp(c.cur.ry, c.tgt.ry, f)
      c.cur.s = lerp(c.cur.s, c.tgt.s, f)
      c.cur.br = lerp(c.cur.br, c.tgt.br, f)
      c.cur.o = lerp(c.cur.o, c.tgt.o, f)
    }
    const v = c.cur
    c.el.style.transform = `translateX(${v.x.toFixed(1)}px) translateZ(${v.z.toFixed(1)}px) rotateY(${v.ry.toFixed(1)}deg) scale(${v.s.toFixed(3)})`
    c.el.style.filter = `brightness(${v.br.toFixed(2)})`
    c.el.style.opacity = v.o.toFixed(2)
  })

  rafId = requestAnimationFrame(tick)
}

function onPointerMove(e: PointerEvent) {
  tgtWY = (e.clientX / window.innerWidth * 2 - 1) * ARC_PARALLAX
  tgtWX = -(e.clientY / window.innerHeight * 2 - 1) * ARC_PARALLAX
}

function initDepthArc() {
  const now = performance.now()
  depthCards = kpiCardRefs.filter(Boolean).map((el, i) => ({
    el: el!,
    i,
    cur: { x: 0, z: -520, ry: 0, s: 0.55, br: 0.35, o: 0 },
    tgt: { x: 0, z: 0, ry: 0, s: 1.12, br: 1.1, o: 1 },
    start: now + i * 110,
    moving: false,
  }))

  kpiFocus.value = 0
  computeTargets()
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('beatzfit:kpiPrefsChanged', onKpiPrefsChanged)
  rafId = requestAnimationFrame(tick)

  // 图表卡片 stagger 入场
  const chartCards = chartWorldRef.value?.querySelectorAll('.chart-card-3d')
  chartCards?.forEach((card, i) => {
    setTimeout(() => card.classList.remove('is-entering'), 160 + i * 120)
  })
}

// 加载完成后初始化 3D 引擎
watch(loading, (isLoading) => {
  if (!isLoading) {
    nextTick(() => {
      initDepthArc()
    })
  }
})

onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('beatzfit:kpiPrefsChanged', onKpiPrefsChanged)
  depthCards = []
})

onBeforeUnmount(() => {
  detachInteraction()
  unregisterStage('data')
})

// === Chart Data ===

const weeklyData = computed(() => {
  const days = ['日', '一', '二', '三', '四', '五', '六']
  const today = new Date()
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (6 - i))
    const dateStr = d.toISOString().split('T')[0]
    const dayRecords = fitnessStore.records.filter(r => r.date === dateStr)
    const duration = dayRecords.reduce((sum, r) => sum + (r.durationSeconds || 0), 0)
    return {
      label: days[d.getDay()],
      duration: Math.round(duration / 60),
      count: dayRecords.length,
    }
  })
})

const completionData = computed(() => {
  const total = fitnessStore.records.length
  const completed = fitnessStore.records.filter(r => r.completed).length
  const notCompleted = total - completed
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
  return { completed, notCompleted, total, percentage }
})

const trendData = computed(() => {
  const today = new Date()
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (13 - i))
    const dateStr = d.toISOString().split('T')[0]
    const dayRecords = fitnessStore.records.filter(r => r.date === dateStr)
    const duration = dayRecords.reduce((sum, r) => sum + (r.durationSeconds || 0), 0)
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      duration: Math.round(duration / 60),
    }
  })
})

// === Duration Distribution (horizontal bars) ===
const durationBuckets = computed(() => {
  const buckets = [
    { label: '<15m', min: 0, max: 15, count: 0 },
    { label: '15-30m', min: 15, max: 30, count: 0 },
    { label: '30-45m', min: 30, max: 45, count: 0 },
    { label: '45-60m', min: 45, max: 60, count: 0 },
    { label: '>60m', min: 60, max: Infinity, count: 0 },
  ]
  for (const r of fitnessStore.records) {
    const minutes = (r.durationSeconds || 0) / 60
    for (const b of buckets) {
      if (minutes >= b.min && minutes < b.max) {
        b.count++
        break
      }
    }
  }
  const maxCount = Math.max(...buckets.map(b => b.count), 1)
  return buckets.map(b => ({
    label: b.label,
    count: b.count,
    percent: (b.count / maxCount) * 100,
  }))
})

// === Bar Chart ===

const BAR_CHART = {
  marginLeft: 48,
  baseY: 290,
  chartHeight: 270,
  chartWidth: 852,  // 900 - 48
  slotWidth: 121,   // 852 / 7
  barWidth: 72,
}

const barChartMax = computed(() => {
  const max = Math.max(...weeklyData.value.map(d => d.duration), 60)
  return Math.ceil(max / 15) * 15
})

const barChartBars = computed(() => {
  return weeklyData.value.map((d, i) => {
    const x = BAR_CHART.marginLeft + 10 + i * BAR_CHART.slotWidth + (BAR_CHART.slotWidth - BAR_CHART.barWidth) / 2
    const barHeight = barChartMax.value > 0 ? (d.duration / barChartMax.value) * BAR_CHART.chartHeight : 0
    const y = BAR_CHART.baseY - barHeight
    return { x, y, width: BAR_CHART.barWidth, height: barHeight, label: d.label, value: d.duration }
  })
})

const barYLabels = computed(() => {
  const max = barChartMax.value
  return [
    { text: `${max}m`, y: BAR_CHART.baseY - BAR_CHART.chartHeight },
    { text: `${Math.round(max * 2 / 3)}m`, y: BAR_CHART.baseY - BAR_CHART.chartHeight * 2 / 3 },
    { text: `${Math.round(max / 3)}m`, y: BAR_CHART.baseY - BAR_CHART.chartHeight / 3 },
    { text: '0m', y: BAR_CHART.baseY },
  ]
})

// === Donut Chart ===

const DONUT_R = 70
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_R

const donutArc = computed(() => {
  const percentage = completionData.value.percentage
  const arcLength = (percentage / 100) * DONUT_CIRCUMFERENCE
  return `${arcLength} ${DONUT_CIRCUMFERENCE}`
})

// === Line Chart ===

const LINE_CHART = {
  marginLeft: 48,
  baseY: 290,
  chartHeight: 270,
  chartWidth: 852,
}

const lineChartMax = computed(() => {
  const max = Math.max(...trendData.value.map(d => d.duration), 30)
  return Math.ceil(max / 10) * 10
})

const lineChartPoints = computed(() => {
  return trendData.value.map((d, i) => ({
    x: LINE_CHART.marginLeft + (i / 13) * LINE_CHART.chartWidth,
    y: LINE_CHART.baseY - (d.duration / lineChartMax.value) * LINE_CHART.chartHeight,
    value: d.duration,
    date: d.date,
  }))
})

const lineXLabels = computed(() =>
  lineChartPoints.value.filter((_, i) => i % 2 === 0)
)

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  let path = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return path
}

const linePathStr = computed(() => smoothPath(lineChartPoints.value))

const lineAreaPath = computed(() => {
  const points = lineChartPoints.value
  if (points.length < 2) return ''
  const path = smoothPath(points)
  const lastX = points[points.length - 1].x.toFixed(1)
  const firstX = points[0].x.toFixed(1)
  return `${path} L ${lastX},${LINE_CHART.baseY} L ${firstX},${LINE_CHART.baseY} Z`
})

const lineYLabels = computed(() => {
  const max = lineChartMax.value
  return [
    { text: `${max}m`, y: LINE_CHART.baseY - LINE_CHART.chartHeight },
    { text: `${Math.round(max * 2 / 3)}m`, y: LINE_CHART.baseY - LINE_CHART.chartHeight * 2 / 3 },
    { text: `${Math.round(max / 3)}m`, y: LINE_CHART.baseY - LINE_CHART.chartHeight / 3 },
    { text: '0m', y: LINE_CHART.baseY },
  ]
})

// === Training Heatmap ===

const heatmapYear = ref(new Date().getFullYear())
const heatmapMonth = ref(new Date().getMonth()) // 0-indexed

const heatmapMonthLabel = computed(() => {
  return `${heatmapYear.value}年${heatmapMonth.value + 1}月`
})

// Can't navigate to future months
const canGoNextMonth = computed(() => {
  const now = new Date()
  const current = new Date(heatmapYear.value, heatmapMonth.value, 1)
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  return current < thisMonth
})

function goPrevMonth() {
  sfx.detent()
  if (heatmapMonth.value === 0) {
    heatmapMonth.value = 11
    heatmapYear.value--
  } else {
    heatmapMonth.value--
  }
}

function goNextMonth() {
  if (!canGoNextMonth.value) return
  sfx.detent()
  if (heatmapMonth.value === 11) {
    heatmapMonth.value = 0
    heatmapYear.value++
  } else {
    heatmapMonth.value++
  }
}

// Build a map of date string -> total duration in minutes for the current month
const heatmapDurationMap = computed(() => {
  const map = new Map<string, number>()
  const prefix = `${heatmapYear.value}-${String(heatmapMonth.value + 1).padStart(2, '0')}`
  for (const r of fitnessStore.records) {
    if (r.date && r.date.startsWith(prefix)) {
      const existing = map.get(r.date) || 0
      map.set(r.date, existing + (r.durationSeconds || 0))
    }
  }
  return map
})

// Calendar grid cells: includes leading empty cells for alignment
const heatmapCells = computed(() => {
  const year = heatmapYear.value
  const month = heatmapMonth.value
  const firstDay = new Date(year, month, 1).getDay() // 0=Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const cells: Array<{
    day: number | null
    durationMin: number
    isFuture: boolean
    tooltip: string
  }> = []

  // Leading empty cells
  for (let i = 0; i < firstDay; i++) {
    cells.push({ day: null, durationMin: 0, isFuture: false, tooltip: '' })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const cellDate = new Date(year, month, d)
    cellDate.setHours(0, 0, 0, 0)
    const isFuture = cellDate > today
    const durationSec = heatmapDurationMap.value.get(dateStr) || 0
    const durationMin = Math.round(durationSec / 60)
    const tooltip = durationMin > 0
      ? `${dateStr} · 训练 ${durationMin} 分钟`
      : `${dateStr} · 无训练`
    cells.push({ day: d, durationMin, isFuture, tooltip })
  }

  return cells
})

function heatmapColor(durationMin: number): string {
  if (durationMin <= 0) return 'rgba(255, 255, 255, 0.04)'
  if (durationMin <= 15) return `rgba(var(--chart-primary-rgb, 250, 88, 106), 0.15)`
  if (durationMin <= 30) return `rgba(var(--chart-primary-rgb, 250, 88, 106), 0.35)`
  if (durationMin <= 60) return `rgba(var(--chart-primary-rgb, 250, 88, 106), 0.6)`
  return `rgba(var(--chart-primary-rgb, 250, 88, 106), 0.85)`
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }
  return `${m}m`
}
</script>

<style lang="scss" scoped>
.data-page {
padding: var(--space-xl);
padding-left: calc(var(--space-xl) * 1.5);
padding-right: calc(var(--space-xl) * 1.5);
padding-bottom: calc(var(--player-bar-height, 0px) + 48px);
max-width: 100%;
position: relative;
transform-style: preserve-3d;
cursor: pointer;

  &.stage-engaged {
    cursor: grab;
    &:active { cursor: grabbing; }
  }

  // 3D visualizer canvas (reparented here) — behind all cards
  // Use viewport dimensions (not 100% of .data-page which may be taller
  // than viewport due to scrollable content) to prevent aspect-ratio
  // stretching of 3D preset elements.
// translateZ(-60px) pushes canvas further back for depth separation.
:deep(canvas) {
position: absolute;
top: 0;
left: 0;
width: 100vw !important;
height: 100vh !important;
transform: translateZ(-60px);
z-index: 0;
pointer-events: none;
}

/* Global lyric layer: uses its own perspective:800px, no stage override needed. */

  // All content above canvas AND above the global lyric layer (translateZ 80px),
  // pushed forward in Z for depth layering. Cards must be in front of the lyric
  // layer so the hierarchy is: cards > lyrics > 3D canvas.
  .page-header, .kpi-stage, .charts-row-top, .charts-row-bottom, .heatmap-section {
    position: relative;
    z-index: 10;
    transform: translateZ(100px);
  }
}

.page-header {
  margin-bottom: var(--space-xl);

  h1 { margin-bottom: 0; }
}

// == Loading skeleton stat cards (2D, no 3D) ==
.stats-row-skeleton {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.stat-card-skeleton {
  position: relative;
  text-align: center;
  padding: var(--space-xl) var(--space-lg);
  border-radius: 16px;
  overflow: hidden;
}

// == 3D KPI 深度弧舞台 ==
.kpi-stage {
  height: 280px;
  perspective: 1400px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-xl);
}

.kpi-world {
  position: relative;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  will-change: transform;
}

// == 3D KPI 卡片（绝对定位，深度弧驱动） ==
.stat-card {
  position: absolute;
  top: -100px;
  left: -102px;
  width: 204px;
  height: 190px;
  border-radius: 16px;
  overflow: hidden;
  text-align: center;
  transform-style: preserve-3d;
  cursor: pointer;
  will-change: transform, filter, opacity;
  // Solid dark background — no backdrop-filter (causes ghost panel + jank with preserve-3d)
  background: rgba(10, 10, 16, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  // No CSS transition — transform is 100% JS-driven via rAF
  transition: none;
}

.stat-card-content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.stat-number {
  display: block;
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 600;
  color: var(--accent-mist);
}

.stat-desc {
  font-size: var(--text-small);
  color: var(--text-tertiary);
  margin-top: var(--space-xs);
}

// == 3D 图表舞台 ==
.chart-stage {
  perspective: 1600px;
}

.chart-world {
  transform-style: preserve-3d;
  will-change: transform;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

// == Charts Top Row (2:1:1) ==
.charts-row-top {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: var(--space-lg);
}

// == Charts Bottom Row (3:2 — 趋势 + 热力图) ==
.charts-row-bottom {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: var(--space-lg);
}

// == 3D 图表卡片（translateZ 基准 + 悬停浮起） ==
.chart-section,
.data-section {
  &.chart-card-3d {
    transform-style: preserve-3d;
    transform: translateZ(var(--rz, 0px)) scale(1);
    transition: transform 0.5s cubic-bezier(0.2, 0.75, 0.25, 1),
                box-shadow 0.4s ease,
                filter 0.4s ease;
    will-change: transform;

    &.is-entering {
      opacity: 0;
      transform: translateZ(-440px) rotateX(10deg) scale(0.9);
    }

    &:hover {
      transform: translateZ(calc(var(--rz, 0px) + 62px)) scale(1.028);
      filter: brightness(1.06);
      z-index: 3;
    }
  }
}

.chart-section {
position: relative;
border-radius: var(--radius-lg);
overflow: hidden;
// Solid dark background — no backdrop-filter (matches stat-card)
background: rgba(10, 10, 16, 0.85);
border: 1px solid rgba(255, 255, 255, 0.08);
}

.chart-content {
  position: relative;
  z-index: 1;
  padding: var(--space-lg);
}

.chart-title {
  margin-bottom: var(--space-md);
}

.chart-subtitle {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
  font-weight: 400;
  margin-left: var(--space-sm);
}

.chart-svg {
  width: 100%;
  height: auto;
  display: block;

  text {
    font-family: var(--font-body);
  }
}

// == Donut Chart ==
.donut-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding-top: var(--space-sm);
}

.donut-svg {
  width: 140px;
  height: 140px;

  text {
    font-family: var(--font-display);
  }
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;

  &--completed {
    background: var(--chart-primary, #fa586a);
  }

  &--incomplete {
    background: rgba(255, 255, 255, 0.15);
  }
}

.legend-text {
  font-size: var(--text-small);
  color: var(--text-secondary);
}

// == Duration Distribution (horizontal bars) ==
.dist-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding-top: var(--space-xs);
}

.dist-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.dist-label {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
  width: 48px;
  flex-shrink: 0;
  text-align: right;
}

.dist-bar-track {
  flex: 1;
  height: 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 5px;
  overflow: hidden;
}

.dist-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--chart-primary, #fa586a), var(--chart-dark, rgba(165, 0, 18, 0.3)));
  border-radius: 5px;
  transition: width 400ms var(--ease-standard);
}

.dist-count {
  font-size: var(--text-caption);
  color: var(--text-secondary);
  width: 20px;
  flex-shrink: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.data-section {
position: relative;
border-radius: var(--radius-lg);
overflow: hidden;
// Solid dark background — no backdrop-filter (matches stat-card)
background: rgba(10, 10, 16, 0.85);
border: 1px solid rgba(255, 255, 255, 0.08);

  .data-section-content {
    position: relative;
    z-index: 1;
    padding: var(--space-lg);
  }
}


// == Heatmap ==
.heatmap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.heatmap-nav {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.heatmap-nav-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
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

.heatmap-month-label {
  font-size: var(--text-small);
  font-weight: 500;
  color: var(--text-primary);
  min-width: 80px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.heatmap-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-bottom: 4px;

  span {
    text-align: center;
    font-size: var(--text-caption);
    color: var(--text-tertiary);
    padding: 2px 0;
  }
}

.heatmap-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.heatmap-cell {
  aspect-ratio: 1;
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 100ms var(--ease-standard);

  &:not(&--empty):hover {
    transform: scale(1.08);
    z-index: 2;
  }

  &--empty {
    background: transparent;
  }

  &--future {
    opacity: 0.3;
  }
}

.heatmap-day-num {
  font-size: var(--text-caption);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.heatmap-day-duration {
  font-size: 9px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
  line-height: 1;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: var(--space-md);
}

.heatmap-legend-cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
}

// == Responsive: stack charts on narrow screens ==
@media (max-width: 900px) {
  .charts-row-top {
    grid-template-columns: 1fr;
  }
  .charts-row-bottom {
    grid-template-columns: 1fr;
  }
}
</style>
