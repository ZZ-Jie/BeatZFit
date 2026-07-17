<template>
  <!--
    3D 悬浮训练动作列表 — 基于 CoverflowListCard 通用组件
    使用 #item slot 渲染动作特有内容 (GIF缩略图、名称、组数×次数、部位)
  -->
  <CoverflowListCard
    :items="exerciseItems"
    side="left"
    :header-title="planName"
    :header-sub="planSub"
    :header-cover="headerCover"
    :count-text="`${exerciseItems.length} 动作`"
    :colors="[...COLORS]"
    :item-key="getItemKey"
    :shift-x="-80"
    edge-distance="18%"
    @select="onSelect"
    @close="emit('close')"
    @header-click="emit('headerClick')"
  >
    <template #headerIcon>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M6.5 6.5h11v11h-11z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M9 9h5v5H9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M3 9h3.5M3 12h3.5M3 15h3.5M17.5 9H21M17.5 12H21M17.5 15H21M9 3v3.5M12 3v3.5M15 3v3.5M9 17.5V21M12 17.5V21M15 17.5V21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </template>

    <template #headerExtra>
      <button class="cf-start-workout-btn" @click.stop="emit('startWorkout')" @pointerdown.stop title="开始健身">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 2L11 7L3 12V2Z" fill="currentColor"/>
        </svg>
        <span>开始健身</span>
      </button>
    </template>

    <template #item="{ item: ex, isFocus }">
      <div class="ex-thumb" v-if="ex.gifUrl">
        <img :src="toExerciseMediaUrl(ex.gifUrl)" :alt="ex.name" loading="lazy" @error="onThumbError" />
      </div>
      <div class="ex-thumb ex-thumb-placeholder" v-else>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M6.5 6.5h11v11h-11z" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </div>
      <div class="ex-glow"></div>
      <div class="ex-info">
        <div class="ex-name">{{ ex.chineseName || ex.name }}</div>
        <div class="ex-meta">
          <span class="ex-sets">{{ ex.sets }} × {{ ex.reps }}</span>
          <span class="ex-sep" v-if="ex.bodyPart">·</span>
          <span class="ex-part" v-if="ex.bodyPart">{{ ex.bodyPart }}</span>
        </div>
      </div>
    </template>

    <template #itemActions="{ item: ex }">
      <button class="ex-btn ex-btn-detail" @click.stop="emit('select', ex)" title="查看详情">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M3 7H11M7 3L11 7L7 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </template>
  </CoverflowListCard>
</template>

<script lang="ts">
/**
 * ExerciseCoverflowItem — 训练动作列表项数据结构
 * 用于 ExerciseCoverflow 组件的 props 和 DualDeckHome 之间的数据传递
 */
export interface ExerciseCoverflowItem {
  exerciseId: string
  name: string
  chineseName?: string
  bodyPart?: string
  bodyPartZh?: string
  equipment?: string
  equipmentZh?: string
  target?: string
  targetZh?: string
  gifUrl?: string
  instructions?: string[]
  precautionsZh?: string
  sets: number
  reps: number
  restSeconds: number
}
</script>

<script setup lang="ts">
/**
 * ExerciseCoverflow — 训练动作 3D 悬浮列表
 *
 * Props:
 *   exerciseItems — 动作列表 (ExerciseCoverflowItem[])
 *   planName      — 训练计划名称
 *   planSub       — 副标题 (如 "胸部 · 5 动作")
 *   headerCover   — 头部封面图
 *
 * Events:
 *   select      — 点击焦点动作 (展开详情)
 *   close       — 关闭列表
 *   headerClick — 点击头部信息区 (跳转训练页)
 */

import CoverflowListCard from '@/components/CoverflowListCard.vue'
import { COVERFLOW_COLORS_8 as COLORS } from '@/components/coverflowColors'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'

const props = defineProps<{
  exerciseItems: ExerciseCoverflowItem[]
  planName: string
  planSub?: string
  headerCover?: string
}>()

const emit = defineEmits<{
  select: [item: ExerciseCoverflowItem]
  close: []
  headerClick: []
  startWorkout: []
}>()

function getItemKey(item: ExerciseCoverflowItem, index: number): string {
  return item.exerciseId || String(index)
}

function onSelect(item: ExerciseCoverflowItem) {
  emit('select', item)
}

function onThumbError(e: Event) {
  const img = e.target as HTMLImageElement
  const thumb = img.parentElement
  if (thumb) thumb.style.display = 'none'
}
</script>

<style lang="scss" scoped>
/* 动作列表特有样式 */
.ex-thumb {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.ex-thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.25);
}

.ex-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(80% 60% at 25% 50%,
    color-mix(in srgb, var(--c) 16%, transparent),
    transparent 60%);
  pointer-events: none;
  z-index: 1;
}

.ex-info {
  flex: 1;
  min-width: 0;
  z-index: 2;
}

.ex-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(234, 242, 248, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.ex-meta {
  margin-top: 2px;
  font-size: 10px;
  color: rgba(234, 242, 248, 0.5);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ex-sets {
  color: var(--c, #C0C0C0);
  font-weight: 600;
}

.ex-sep {
  opacity: 0.4;
}

.ex-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: transform 0.15s;

  &:hover {
    transform: scale(1.1);
  }
}

.ex-btn-detail {
background: transparent;
border: 1px solid rgba(255, 255, 255, 0.35);
backdrop-filter: blur(8px);
-webkit-backdrop-filter: blur(8px);
}

/* Start workout button in header — matches ex-btn-detail style */
.cf-start-workout-btn {
display: flex;
align-items: center;
gap: 5px;
padding: 6px 12px;
border-radius: 999px;
background: transparent;
border: 1px solid rgba(255, 255, 255, 0.35);
backdrop-filter: blur(8px);
-webkit-backdrop-filter: blur(8px);
color: white;
font-size: 11px;
font-weight: 600;
cursor: pointer;
white-space: nowrap;
flex-shrink: 0;
transition: transform 0.15s;

&:hover {
transform: scale(1.05);
}

&:active {
transform: scale(0.97);
}

svg {
flex-shrink: 0;
}
}
</style>
