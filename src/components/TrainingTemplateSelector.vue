<template>
  <div class="template-selector">
    <div class="ts-header">
      <h3 class="text-h3">训练计划模板</h3>
      <span class="text-caption ts-hint">选择模板快速创建训练计划</span>
    </div>

    <div class="ts-grid">
      <div
        v-for="tpl in templates"
        :key="tpl.id"
        class="ts-card"
        @click="onSelect(tpl)"
      >
        <div class="ts-card-info">
          <span class="ts-card-name text-body">{{ tpl.name }}</span>
          <span class="ts-card-desc text-small">{{ tpl.description }}</span>
          <div class="ts-card-tags">
            <span class="ts-tag" :class="`ts-tag--${tpl.difficulty}`">{{ difficultyLabel(tpl.difficulty) }}</span>
            <span class="ts-tag ts-tag--ghost">{{ tpl.bodyPart }}</span>
            <span class="ts-tag ts-tag--ghost">~{{ tpl.estimatedDuration }}分钟</span>
          </div>
        </div>
        <div class="ts-card-arrow">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { TrainingTemplate } from '@/types'
import { useSfx } from '@/composables/useSfx'

const emit = defineEmits<{
  select: [template: TrainingTemplate]
}>()

const sfx = useSfx()
const templates = ref<TrainingTemplate[]>([])

onMounted(async () => {
  try {
    // Load the templates JSON from the public/presets directory.
    // In production this is served from the dist folder; in dev it's
    // served by Vite from the public directory.
    const response = await fetch('/presets/trainingTemplates.json')
    if (response.ok) {
      templates.value = await response.json()
    }
  } catch (e) {
    console.error('[template] Failed to load training templates:', e)
  }
})

function onSelect(tpl: TrainingTemplate) {
  sfx.detent()
  emit('select', tpl)
}

function difficultyLabel(diff: string): string {
  switch (diff) {
    case 'beginner': return '入门'
    case 'intermediate': return '进阶'
    case 'advanced': return '高级'
    default: return diff
  }
}
</script>

<style scoped>
.template-selector {
  width: 100%;
}

.ts-header {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.ts-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
}
.ts-card:hover {
  transform: translateY(-2px);
  background: rgba(255,255,255,0.08);
  border-color: rgba(108, 92, 231, 0.3);
}

.ts-card-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ts-card-name {
  font-weight: 600;
  font-size: 14px;
}

.ts-card-desc {
  color: var(--text-tertiary, rgba(255,255,255,0.4));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ts-card-tags {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

.ts-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}

.ts-tag--beginner {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}
.ts-tag--intermediate {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}
.ts-tag--advanced {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.ts-tag--ghost {
  background: rgba(255,255,255,0.06);
  color: var(--text-tertiary, rgba(255,255,255,0.4));
}

.ts-card-arrow {
  color: var(--text-tertiary, rgba(255,255,255,0.3));
  flex-shrink: 0;
}
</style>
