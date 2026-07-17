<template>
  <!--
    通用 3D 悬浮列表卡片
    结构: cf-card (视觉背景面板, header + body) + cf-stage (透明, 仅3D透视)
    事件穿透: 容器/舞台 pointer-events: none → 非卡片区域事件穿透到 visualizer
    卡片交互: cf-item pointer-events: auto + data-no-rotate → 滚轮/拖拽滚动列表

    Slots:
      #item { item, index, isFocus }  — 列表项内容
      #headerIcon                       — 自定义头部占位图标
      #headerExtra                      — 头部额外按钮区 (在关闭按钮左侧)
      #itemActions { item, index, isFocus } — 焦点项的操作按钮区
  -->
  <div class="cf-list" :data-cf-list="side" :style="rootStyleVars">
    <!-- 视觉背景面板 -->
    <div class="cf-card" data-no-rotate @wheel="cf.onWheel" @pointerdown="cf.onStagePointerDown">
      <header class="cf-header" @click="$emit('headerClick')">
        <div class="cf-cover" v-if="headerCover">
          <img :src="headerCover" :alt="headerTitle || '封面'" loading="lazy" @error="onHeaderCoverError" />
        </div>
        <div class="cf-cover cf-cover-placeholder" v-else>
          <slot name="headerIcon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M9 18V5L20 3V16M9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.3431 4.34315 15 6 15C7.65685 15 9 16.3431 9 18ZM20 16C20 17.6569 18.6569 19 17 19C15.3431 19 14 17.6569 14 16C14 14.3431 15.3431 13 17 13C18.6569 13 20 14.3431 20 16Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </slot>
        </div>
        <div class="cf-info">
          <span class="cf-title">{{ headerTitle }}</span>
          <span class="cf-sub" v-if="headerSub">{{ headerSub }}</span>
          <span class="cf-count">{{ countText }}</span>
        </div>
        <div class="cf-header-extra" @pointerdown.stop @wheel.stop>
          <slot name="headerExtra"></slot>
        </div>
        <button class="cf-close" data-no-rotate @click.stop="$emit('close')" @pointerdown.stop @wheel.stop title="关闭">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </header>
      <div class="cf-body"></div>
    </div>

    <!-- 透明3D舞台 -->
    <div class="cf-stage" ref="stageRef" @wheel="cf.onWheel" @pointerdown="cf.onStagePointerDown">
      <div
        v-for="(item, i) in items"
        :key="getKey(item, i)"
        class="cf-item"
        data-no-rotate
        :data-cf-index="i"
        @click="onItemClick(i)"
        @mouseenter="cf.onItemHover(i)"
        @mouseleave="cf.onItemLeave"
      >
        <div class="cf-item-inner" :style="{ '--c': getColor(i) }">
          <slot name="item" :item="item" :index="i" :isFocus="cf.isFocus(i)"></slot>
          <div class="cf-item-actions">
            <slot name="itemActions" :item="item" :index="i" :isFocus="cf.isFocus(i)"></slot>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * CoverflowListCard — 通用 3D 悬浮列表卡片
 *
 * Props:
 *   items         — 列表数据 (任意类型数组)
 *   side          — 'left' | 'right' | 'center' (定位在左侧/右侧/居中)
 *   headerTitle   — 头部标题
 *   headerSub     — 头部副标题
 *   headerCover   — 头部封面图 URL
 *   countText     — 头部计数文字 (如 "12 首")
 *   colors        — 项颜色数组 (循环使用)
 *   itemKey       — 项 key 的字段名或函数
 *   shiftX        — X 轴偏移 (正值右移, 负值左移)
 *   edgeDistance  — 距屏幕边缘的距离 (如 '18%')
 *   cardWidth     — 卡片宽度
 *   cardHeight    — 卡片高度
 *   itemWidth     — 列表项宽度
 *   itemHeight    — 列表项高度
 *   stageTop      — 舞台顶部偏移
 *   stageBottom   — 舞台底部留白
 *
 * Events:
 *   select        — 点击焦点项 (item)
 *   close         — 关闭按钮
 *   headerClick   — 点击头部信息区
 *
 * Slots:
 *   #item         — 列表项内容 { item, index, isFocus }
 *   #headerIcon   — 头部占位图标
 *   #itemActions  — 焦点项操作按钮 { item, index, isFocus }
 */

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useCoverflowList } from '@/composables/useCoverflowList'
import { COVERFLOW_COLORS_8 } from '@/components/coverflowColors'
import { useSfx } from '@/composables/useSfx'

const props = withDefaults(defineProps<{
  items: any[]
  side?: 'left' | 'right' | 'center'
  headerTitle: string
  headerSub?: string
  headerCover?: string
  countText?: string
  colors?: string[]
  itemKey?: string | ((item: any, index: number) => string | number)
  shiftX?: number
  edgeDistance?: string
  cardWidth?: string
  cardHeight?: string
  itemWidth?: string
  itemHeight?: string
  stageTop?: string
  stageBottom?: string
}>(), {
  side: 'right',
  countText: '',
  colors: () => [...COVERFLOW_COLORS_8],
  shiftX: 80,
  edgeDistance: '18%',
  cardWidth: 'clamp(320px, 30vw, 420px)',
  cardHeight: 'clamp(420px, 42vw, 560px)',
  itemWidth: 'clamp(300px, 28vw, 400px)',
  itemHeight: '64px',
  stageTop: '92px',
  stageBottom: '20px',
})

const emit = defineEmits<{
  select: [item: any]
  close: []
  headerClick: []
}>()

const stageRef = ref<HTMLElement | null>(null)

const count = computed(() => props.items.length)

const sfx = useSfx()

const cf = useCoverflowList({
  count,
  itemClass: 'cf-item',
  stageEl: stageRef,
})

const rootStyleVars = computed(() => ({
  '--cf-shift-x': `${props.shiftX}px`,
  '--cf-edge': props.edgeDistance,
  '--cf-card-w': props.cardWidth,
  '--cf-card-h': props.cardHeight,
  '--cf-item-w': props.itemWidth,
  '--cf-item-h': props.itemHeight,
  '--cf-stage-top': props.stageTop,
  '--cf-stage-bottom': props.stageBottom,
}))

function getKey(item: any, index: number): string | number {
  if (typeof props.itemKey === 'function') return props.itemKey(item, index)
  if (typeof props.itemKey === 'string') return item[props.itemKey] ?? index
  return item.id ?? index
}

function getColor(i: number): string {
  return props.colors[i % props.colors.length]
}

function onItemClick(i: number) {
  if (!cf.isItemClick()) return
  if (cf.isFocus(i)) {
    emit('select', props.items[i])
  } else {
    sfx.detent()
    cf.snapTo(i)
  }
}

function onHeaderCoverError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}

onMounted(() => cf.init())
onUnmounted(() => cf.destroy())

// Watch items changes (e.g. search filter) — refresh DOM cache and reset scroll
watch(() => props.items, async () => {
  await nextTick()
  cf.refresh()
}, { flush: 'post' })
</script>

<style lang="scss" scoped>
/*
 * 3D 悬浮列表 — 通用样式
 * 所有尺寸通过 CSS 自定义属性控制，可在使用时覆盖
 */
.cf-list {
  position: absolute;
  top: 50%;
  transform: translateY(-50%) translateX(var(--cf-shift-x, 80px));
  z-index: 10;
  pointer-events: none;
  transform-style: preserve-3d;
  perspective: 800px;

  &[data-cf-list="left"] {
    left: var(--cf-edge, 18%);
    right: auto;
  }
  &[data-cf-list="right"] {
    right: var(--cf-edge, 18%);
    left: auto;
  }
  &[data-cf-list="center"] {
    left: 50%;
    right: auto;
    transform: translateY(-50%) translateX(calc(-50% + var(--cf-shift-x, 0px)));
  }
}

/* 视觉背景面板 */
.cf-card {
  position: relative;
  width: var(--cf-card-w, clamp(280px, 26vw, 360px));
  height: var(--cf-card-h, clamp(420px, 42vw, 560px));
  max-height: 82vh;
  border-radius: 20px;
  overflow: hidden;
  background: rgba(12, 12, 16, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  /* No transform/stacking-context here — allows .cf-header z-index to
     escape and sit above .cf-stage (z-index:5) so header/close button
     are never covered by floating 3D items. */
}

.cf-body {
  flex: 1;
}

.cf-header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: auto;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
}

.cf-cover {
  width: 52px;
  height: 52px;
  border-radius: 10px;
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

.cf-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.3);
}

.cf-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cf-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cf-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cf-count {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}

.cf-header-extra {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.cf-close {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 11;
  transition: background 0.2s, color 0.2s, border-color 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }
}

/* 透明3D舞台 */
.cf-stage {
  position: absolute;
  top: var(--cf-stage-top, 92px);
  left: 0;
  right: 0;
  bottom: var(--cf-stage-bottom, 20px);
  transform-style: preserve-3d;
  overflow: visible;
  touch-action: none;
  pointer-events: none;
  z-index: 5;
}

.cf-item {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--cf-item-w, clamp(260px, 24vw, 340px));
  height: var(--cf-item-h, 64px);
  transform-style: preserve-3d;
  cursor: pointer;
  will-change: transform, opacity;
  pointer-events: auto;
}

.cf-item-inner {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(18, 18, 22, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px 6px 6px;
  transition: border-color 200ms ease,
              box-shadow 200ms ease;
}

/* Focus (center) item */
.cf-item.focus .cf-item-inner {
  background: rgba(28, 28, 34, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5),
              0 0 0 1px rgba(255, 255, 255, 0.1),
              inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

/* Hovered item */
.cf-item.hovered .cf-item-inner {
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.6),
              0 0 0 2px rgba(255, 255, 255, 0.25),
              0 0 20px rgba(255, 255, 255, 0.08),
              inset 0 1px 0 rgba(255, 255, 255, 0.2);
  background: rgba(38, 38, 44, 0.94);
}

/* Focus + hovered */
.cf-item.focus.hovered .cf-item-inner {
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.7),
              0 0 0 2px rgba(255, 255, 255, 0.3),
              0 0 28px rgba(255, 255, 255, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.28);
  background: rgba(42, 42, 48, 0.95);
}

.cf-item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 3;
  flex-shrink: 0;
  margin-left: auto;
  /* Only show actions for focused item (focus class is toggled by RAF layout) */
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}

.cf-item.focus .cf-item-actions {
  opacity: 1;
  pointer-events: auto;
}
</style>
