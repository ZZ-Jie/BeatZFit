<template>
  <Transition :css="false" @enter="onEnter" @leave="onLeave">
    <div class="modal-overlay" v-if="exercise" @click.self="handleClose">
      <div class="modal-content">
        <FrostedGlass :corner-radius="24" variant="floating" />
        <div class="modal-content-content">
          <button class="modal-close" @click="handleClose">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 2L14 14M14 2L2 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>

          <div class="detail-layout">
            <div class="detail-visual">
              <img v-if="exercise.gifUrl && !gifError" :src="toExerciseMediaUrl(exercise.gifUrl)" :alt="exercise.name"
                class="detail-gif" crossorigin="anonymous" @error="gifError = true" />
              <div class="detail-gif-fallback" v-if="!exercise.gifUrl || gifError">&#9889;</div>
            </div>
            <div class="detail-info">
              <h2 class="text-h2">{{ exercise.chineseName || exercise.name }}</h2>
              <div class="detail-meta">
                <span class="detail-tag" v-if="exercise.bodyPartZh || exercise.bodyPart">{{ exercise.bodyPartZh || exercise.bodyPart }}</span>
                <span class="detail-tag" v-if="exercise.equipmentZh || exercise.equipment">{{ exercise.equipmentZh || exercise.equipment }}</span>
                <span class="detail-tag" v-if="exercise.targetZh || exercise.target">{{ exercise.targetZh || exercise.target }}</span>
              </div>

              <div class="detail-instructions" v-if="exercise.instructions?.length">
                <h4 class="text-h3">步骤说明</h4>
                <ol class="instruction-list">
                  <li v-for="(step, i) in exercise.instructions" :key="i">{{ step }}</li>
                </ol>
              </div>

              <div class="detail-precautions" v-if="exercise.precautionsZh">
                <h4 class="text-h3">注意事项</h4>
                <p class="text-small">{{ exercise.precautionsZh }}</p>
              </div>

              <slot name="actions">
                <button class="btn-glass btn-glass--accent" style="margin-top: var(--space-lg);" @click="handleAddToPlan(exercise)">
                  加入计划
                </button>
              </slot>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * ExerciseDetailModal — 动作详情弹窗
 *
 * Props:
 *   exercise — Exercise 对象 (null 时弹窗隐藏)
 *
 * Events:
 *   close    — 关闭弹窗
 *   addToPlan — 点击"加入计划"按钮
 *
 * Slots:
 *   #actions — 自定义底部操作按钮区
 */

import { ref, watch } from 'vue'
import gsap from 'gsap'
import FrostedGlass from '@/components/FrostedGlass.vue'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'
import { useSfx } from '@/composables/useSfx'
import type { Exercise } from '@/types'

const props = defineProps<{
  exercise: Exercise | null
}>()

const emit = defineEmits<{
  close: []
  addToPlan: [exercise: Exercise]
}>()

const sfx = useSfx()

// Modal open/close SFX
watch(() => props.exercise, (val) => {
  if (val) sfx.airBloom()
  else sfx.retract()
})

function handleClose() {
  sfx.retract()
  emit('close')
}

function handleAddToPlan(exercise: Exercise) {
  sfx.confirm()
  emit('addToPlan', exercise)
}

const gifError = ref(false)

// Reset GIF error when exercise changes
watch(() => props.exercise, () => {
  gifError.value = false
})

function onEnter(el: Element, done: () => void) {
  gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'power2.out', onComplete: done })
  const content = (el as HTMLElement).querySelector('.modal-content')
  if (content) {
    gsap.fromTo(content, { scale: 0.9, y: 20 }, { scale: 1, y: 0, duration: 0.35, ease: 'back.out(1.4)' })
  }
}

function onLeave(el: Element, done: () => void) {
  gsap.to(el, { autoAlpha: 0, duration: 0.2, ease: 'power2.in', onComplete: done })
}
</script>

<style lang="scss" scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  pointer-events: auto; /* Override inherited pointer-events: none (e.g. from .fitness-page) */
}

.modal-content {
  position: relative;
  max-width: 720px;
  width: 90%;
  /* max-height (not fixed height) so the card shrinks to fit short content —
     eliminates blank space at the bottom.
     600px caps tall content so it fits above the PlayerBar. */
  max-height: min(600px, calc(100vh - 160px));
  border-radius: var(--radius-lg, 24px);
  overflow: hidden;
  background: rgba(15, 15, 20, 0.85);
}

.modal-content-content {
  position: relative;
  z-index: 1;
  padding: var(--space-xl, 32px);
  display: flex;
  flex-direction: column;
  /* No scrollbar on the outer container — only the instructions area scrolls */
  overflow: hidden;
}

.modal-close {
  position: absolute;
  top: var(--space-md, 16px);
  right: var(--space-md, 16px);
  width: 32px; height: 32px;
  border-radius: var(--radius-full, 999px);
  background: var(--glass-bg, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;

  &:hover { background: var(--glass-bg-hover, rgba(255, 255, 255, 0.1)); }
}

.detail-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-xl, 32px);
  align-items: start; /* Don't stretch columns to equal height — avoids blank space */
}

.detail-gif {
  width: 100%;
  max-height: min(480px, calc(100vh - 240px));
  object-fit: contain;
  border-radius: var(--radius-md, 12px);
}

.detail-gif-fallback {
  width: 100%;
  aspect-ratio: 4/3;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
  border-radius: var(--radius-md, 12px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  color: var(--accent-mist, rgba(77, 208, 225, 0.5));
  opacity: 0.3;
}

.detail-meta {
  display: flex;
  gap: var(--space-xs, 4px);
  margin: var(--space-md, 16px) 0;
  flex-wrap: wrap;
}

.detail-tag {
  padding: 2px 10px;
  background: var(--glass-bg, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-full, 999px);
  font-size: var(--text-caption, 11px);
  color: var(--text-secondary, rgba(255, 255, 255, 0.5));
}

.detail-instructions {
  margin-top: var(--space-lg, 24px);

  h4 { margin-bottom: var(--space-sm, 8px); }
}

/* Scrollable instruction list — fixed height, internal scroll, no visible scrollbar */
.instruction-list {
  padding-left: var(--space-lg, 24px);
  margin: 0;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  font-size: 14px;
  line-height: 1.6;
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE10+ */
  &::-webkit-scrollbar {
    display: none; /* Chrome/Safari/Electron */
  }
}

.detail-precautions {
  margin-top: var(--space-lg, 24px);

  h4 { margin-bottom: var(--space-sm, 8px); }
  p { color: var(--text-secondary, rgba(255, 255, 255, 0.6)); }
}

.detail-info {
  display: flex;
  flex-direction: column;
}

.detail-visual {
  display: flex;
  align-items: flex-start;
}

.text-h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: rgba(255, 255, 255, 0.95);
}

.text-h3 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: rgba(255, 255, 255, 0.85);
}

.text-small {
  font-size: 13px;
  line-height: 1.5;
}

.btn-glass {
  padding: 8px 20px;
  border-radius: var(--radius-full, 999px);
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
  background: var(--glass-bg, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, rgba(255, 255, 255, 0.9));
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;

  &:hover {
    background: var(--glass-bg-hover, rgba(255, 255, 255, 0.1));
  }
}

.btn-glass--accent {
  background: rgba(15, 15, 20, 0.72);
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);

  &:hover {
    background: rgba(20, 20, 28, 0.8);
  }
}
</style>
