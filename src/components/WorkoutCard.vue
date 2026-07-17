<script setup lang="ts">
/**
 * WorkoutCard
 *
 * 训练动作的展开式摘要卡片。采用 FrostedGlass 主容器，
 * 左侧展示动作媒体，右侧展示名称、目标肌群、组数/次数、休息进度、
 * 注意事项及操作按钮。组件本身不持有训练状态，仅通过 props 接收并
 * 通过事件向上汇报用户操作。
 */
import { computed } from 'vue'
import FrostedGlass from '@/components/FrostedGlass.vue'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'
import type { Exercise, WorkoutPlanItem, WorkoutSession } from '@/types'
import { useModalTransition } from '@/composables/useGsapTransition'
import { useSfx } from '@/composables/useSfx'

interface Props {
  /** 卡片是否可见（展开） */
  visible: boolean
  /** 当前动作详情 */
  exercise: Exercise | null
  /** 当前动作在计划中的配置（组数/次数/休息） */
  planItem: WorkoutPlanItem | null
  /** 当前训练会话状态 */
  session: WorkoutSession | null
}

const props = defineProps<Props>()

const modalTransition = useModalTransition()
const sfx = useSfx()

const emit = defineEmits<{
  (e: 'complete'): void
  (e: 'pause'): void
  (e: 'skip'): void
  (e: 'end'): void
}>()

/** 动作显示名称：优先中文名 */
const displayName = computed(() =>
  props.exercise?.chineseName || props.exercise?.name || '加载中...'
)

/** 目标肌群标签 */
const targetLabel = computed(() =>
  props.exercise?.targetZh ? `目标肌群：${props.exercise.targetZh}` : ''
)

/** 剩余休息时间（秒） */
const restTimeDisplay = computed(() =>
  Math.ceil(props.session?.restTimeLeft || 0).toString()
)

/** 休息进度百分比 */
const restPercent = computed(() => {
  if (!props.session || !props.planItem) return 0
  return Math.max(
    0,
    Math.min(
      100,
      (props.session.restTimeLeft / props.planItem.restSeconds) * 100
    )
  )
})

/**
 * 注意事项列表。
 * 优先使用 `precautionsZh`；若不存在，则从 `instructions` 解析。
 * 解析策略：先按换行拆分，若仅一行则按标点拆分，保证列表可读性。
 * 结果用 computed 缓存，避免每次渲染重复计算。
 */
const notes = computed(() => {
  const raw =
    (props.exercise?.precautionsZh || '').trim() ||
    (props.exercise?.instructions || []).join('\n').trim()
  if (!raw) return []

  let lines = raw
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (lines.length <= 1) {
    lines = raw
      .split(/(?<=[。.!?])\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return lines
})

/**
 * 操作按钮统一委托处理。
 * 通过 data-action 属性识别意图，减少多个独立 click 监听器带来的内存开销。
 */
function onActionClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
  if (!btn) return

  const action = btn.dataset.action
  switch (action) {
    case 'complete':
      sfx.confirm()
      emit('complete')
      break
    case 'pause':
      sfx.detent()
      emit('pause')
      break
    case 'skip':
      sfx.detent()
      emit('skip')
      break
    case 'end':
      sfx.retract()
      emit('end')
      break
  }
}
</script>

<template>
  <Transition :css="false" @enter="modalTransition.onEnter" @leave="modalTransition.onLeave">
    <div
      v-if="visible"
      class="workout-card"
      role="dialog"
      aria-modal="true"
      aria-label="训练动作详情"
      @click.stop
    >
      <!-- 毛玻璃主卡片容器 -->
      <div class="wo-card card-primary">
        <FrostedGlass :corner-radius="24" variant="floating" />

        <div class="wo-card-body">
          <!-- 左侧：动作媒体 -->
          <figure class="wo-card-media">
            <img
              v-if="exercise?.gifUrl"
              :src="toExerciseMediaUrl(exercise.gifUrl)"
              :alt="displayName"
              loading="lazy"
              decoding="async"
            />
            <div v-else class="wo-card-fallback">&#9889;</div>
          </figure>

          <!-- 右侧：动作信息与操作 -->
          <div class="wo-card-content">
            <header class="wo-card-header">
              <h3 class="wo-card-name">{{ displayName }}</h3>
              <p v-if="targetLabel" class="wo-card-target">{{ targetLabel }}</p>
            </header>

            <!-- 元信息网格：组数 / 次数 / 休息 -->
            <div class="wo-card-meta-grid">
              <div class="wo-meta-tile">
                <span class="wo-meta-tile-label">组数</span>
                <span class="wo-meta-tile-value">
                  {{ session?.currentSet || 0 }} / {{ planItem?.sets || '?' }}
                </span>
              </div>
              <div class="wo-meta-tile">
                <span class="wo-meta-tile-label">次数</span>
                <span class="wo-meta-tile-value">{{ planItem?.reps || '-' }}</span>
              </div>
              <div v-if="session?.isResting" class="wo-meta-tile wo-meta-tile--rest">
                <span class="wo-meta-tile-label">休息</span>
                <span class="wo-meta-tile-value">{{ restTimeDisplay }}s</span>
              </div>
            </div>

            <!-- 休息倒计时进度条 -->
            <div v-if="session?.isResting" class="wo-rest-track">
              <div
                class="wo-rest-fill"
                :style="{ transform: `scaleX(${restPercent / 100})` }"
              ></div>
            </div>

            <!-- 注意事项 -->
            <section v-if="notes.length" class="wo-card-notes">
              <h4>注意事项</h4>
              <ul>
                <li v-for="(note, idx) in notes" :key="idx">{{ note }}</li>
              </ul>
            </section>

            <!-- 所需器械 -->
            <div v-if="exercise?.equipment" class="wo-card-equipment">
              <span class="wo-card-equipment-label">所需器械</span>
              <span class="wo-card-equipment-value">{{ exercise.equipment }}</span>
            </div>

            <!-- 操作按钮（事件委托） -->
            <div class="wo-card-actions" @click="onActionClick">
              <div class="wo-actions-glass card-primary">
                <FrostedGlass :corner-radius="16" variant="secondary" />
                <div class="wo-actions-content">
                  <button
                    v-if="!session?.isResting"
                    class="wo-btn wo-btn--primary"
                    data-action="complete"
                  >
                    完成一组
                  </button>
                  <button class="wo-btn" data-action="pause">
                    {{ session?.isPaused ? '继续' : '暂停' }}
                  </button>
                  <button class="wo-btn wo-btn--ghost" data-action="skip">跳过</button>
                  <button class="wo-btn wo-btn--danger" data-action="end">结束训练</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.workout-card {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}

/* 主卡片：使用 .card-primary 提供圆角/阴影/裁剪，毛玻璃由 FrostedGlass 提供 */
.wo-card {
  position: relative;
  width: min(92vw, 960px);
  max-height: min(90vh, 680px);
  pointer-events: auto;
  border-radius: var(--card-radius-primary);
  overflow: hidden;
  /* 让卡片本身成为 flex 容器，子元素在 max-height 内收缩，避免内容撑出视口 */
  display: flex;
  flex-direction: column;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.35),
    0 8px 24px rgba(0, 0, 0, 0.25);
  /* 限制布局与绘制边界，减少频繁交互时的重排重绘 */
  contain: layout paint;
}

/* 青紫光晕：位于 FrostedGlass 之上、毛玻璃蒙版与内容之下 */
.wo-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(ellipse 70% 60% at 15% 20%, rgba(126, 200, 227, 0.28) 0%, transparent 55%),
    radial-gradient(ellipse 60% 50% at 85% 80%, rgba(250, 88, 106, 0.30) 0%, transparent 55%),
    radial-gradient(ellipse 50% 40% at 50% 50%, rgba(77, 208, 225, 0.08) 0%, transparent 60%);
  opacity: 0.85;
  pointer-events: none;
  z-index: 0;
}

.wo-card-body {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(240px, 0.95fr) minmax(300px, 1.05fr);
  gap: var(--space-lg);
  padding: var(--space-lg);
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* 左侧媒体：保持动作图片完整显示，不截断、不变形 */
.wo-card-media {
  margin: 0;
  border-radius: var(--card-radius-secondary);
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.03) 0%, transparent 70%),
    var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 典型健身 GIF 为正方形，固定宽高比避免内容区被过度挤压 */
  aspect-ratio: 1 / 1;
  min-height: 0;
  max-height: 100%;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
}

.wo-card-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 4rem;
  color: var(--accent-mist);
  opacity: 0.25;
}

/* 右侧内容 */
.wo-card-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-height: 0;
}

.wo-card-name {
  font-family: var(--font-display);
  font-size: var(--text-h2);
  margin: 0;
  color: var(--text-primary);
}

.wo-card-target {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-small);
  color: var(--text-tertiary);
}

/* 元信息瓷片 */
.wo-card-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-sm);
}

.wo-meta-tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border-radius: var(--card-radius-tertiary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.wo-meta-tile-label {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
}

.wo-meta-tile-value {
  font-family: var(--font-display);
  font-size: var(--text-h3);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.wo-meta-tile--rest .wo-meta-tile-value {
  color: var(--accent-orange);
}

/* 休息进度条 */
.wo-rest-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.wo-rest-fill {
  height: 100%;
  width: 100%;
  background: var(--accent-orange);
  transform-origin: left center;
  transition: transform 1s linear;
  will-change: transform;
}

/* 注意事项：仅该区域可滚动 */
.wo-card-notes {
  min-width: 0;
  overflow-wrap: break-word;
  max-height: min(30vh, 220px);
  overflow-y: auto;
  padding-right: var(--space-xs);
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  h4 {
    margin: 0 0 var(--space-sm);
    font-size: var(--text-body);
    color: var(--text-primary);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  li {
    position: relative;
    padding-left: 16px;
    font-size: var(--text-small);
    line-height: 1.5;
    color: var(--text-secondary);

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-mist);
    }
  }
}

/* 器械信息 */
.wo-card-equipment {
  margin-top: auto;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wo-card-equipment-label {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
}

.wo-card-equipment-value {
  font-size: var(--text-small);
  color: var(--text-primary);
}

/* 操作按钮：整体包裹在毛玻璃胶囊内 */
.wo-card-actions {
  display: flex;
  pointer-events: auto;
}

.wo-actions-glass {
  position: relative;
  display: inline-flex;
  border-radius: var(--card-radius-secondary);
  overflow: hidden;
  box-shadow: var(--card-shadow);
}

.wo-actions-content {
  position: relative;
  z-index: 1;
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding: var(--space-sm);
}

.wo-btn {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--card-radius-tertiary);
  font-size: var(--text-small);
  cursor: pointer;
  transition: background var(--duration-micro) var(--ease-standard),
              color var(--duration-micro) var(--ease-standard),
              border-color var(--duration-micro) var(--ease-standard),
              transform 200ms var(--ease-spring);
  will-change: transform;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);

  &:hover {
    background: var(--glass-bg-hover);
    color: var(--text-primary);
  }

  &:active {
    transform: scale(0.96) translateZ(0);
    transition: transform 100ms ease-out;
  }

  &--primary {
    background: rgba(15, 15, 20, 0.72);
    border-color: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);

    &:hover {
      background: rgba(20, 20, 28, 0.8);
    }
  }

  &--ghost {
    background: transparent;
  }

  &--danger:hover {
    background: rgba(232, 17, 35, 0.15);
    color: #e81123;
  }
}

/* 响应式：窄屏下改为上下布局 */
@media (max-width: 768px) {
  .wo-card {
    width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
  }

  .wo-card-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    gap: var(--space-md);
    padding: var(--space-md);
  }

  .wo-card-media {
    /* 窄屏下限制媒体区最大高度，防止过长 GIF 挤压信息区 */
    max-height: 38vh;
    aspect-ratio: auto;
  }

  .wo-card-name {
    font-size: var(--text-h3);
  }

  .wo-meta-tile-value {
    font-size: var(--text-body);
  }
}

/* wo-card 过渡已迁移至 GSAP JS hooks (useModalTransition) */
</style>
