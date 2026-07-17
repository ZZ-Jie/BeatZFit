<template>
  <transition name="eq-slide">
    <div v-if="visible" class="eq-panel" data-eq_panel @click.stop>
      <div class="eq-header">
        <span class="eq-title">均衡器</span>
        <div class="eq-toggle-wrap">
          <span class="eq-toggle-label">{{ eqEnabled ? '已开启' : '已关闭' }}</span>
          <button class="eq-toggle-btn" :class="{ active: eqEnabled }" @click="toggleEQ(); sfx.detent()">
            <span class="eq-toggle-knob"></span>
          </button>
        </div>
      </div>

      <div
        class="eq-presets"
        ref="presetsScrollRef"
        @mousedown="onPresetsMouseDown"
      >
        <button
          v-for="preset in EQ_PRESETS"
          :key="preset.name"
          class="eq-preset-btn"
          :class="{ active: eqPresetName === preset.name }"
          @click="applyPreset(preset); sfx.detent()"
        >{{ preset.label }}</button>
      </div>

      <div class="eq-bands" :class="{ disabled: !eqEnabled }">
        <div v-for="(band, i) in EQ_BANDS" :key="band" class="eq-band">
          <span class="eq-value">{{ eqGains[i] > 0 ? '+' : '' }}{{ eqGains[i] }}dB</span>
          <div class="eq-slider-wrap">
            <div class="eq-slider-track">
              <div class="eq-slider-fill" :style="sliderFillStyle(i)"></div>
              <div class="eq-slider-center-line"></div>
            </div>
            <input
              type="range"
              class="eq-slider"
              min="-12"
              max="12"
              step="1"
              :value="eqGains[i]"
              :disabled="!eqEnabled"
              @input="onSliderInput(i, ($event.target as HTMLInputElement).value)"
              @mousedown.stop
              @touchstart.stop
            />
          </div>
          <span class="eq-freq">{{ formatFreq(band) }}</span>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEqualizer, type EQPreset } from '@/composables/useEqualizer'
import { useSfx } from '@/composables/useSfx'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const sfx = useSfx()

const {
  eqEnabled,
  eqGains,
  eqPresetName,
  EQ_BANDS,
  EQ_PRESETS,
  toggleEQ,
  setGain,
  applyPreset,
} = useEqualizer()

function onSliderInput(bandIndex: number, value: string) {
  setGain(bandIndex, parseFloat(value))
}

function formatFreq(hz: number): string {
  if (hz >= 1000) return `${hz / 1000}k`
  return `${hz}`
}

function sliderFillStyle(i: number) {
  const gain = eqGains.value[i] || 0
  // Map -12..+12 to 0..100% (0dB = 50%)
  const pct = ((gain + 12) / 24) * 100
  return {
    height: `${Math.abs(gain) > 0 ? Math.abs(gain) / 12 * 50 : 0}%`,
    bottom: gain >= 0 ? '50%' : `${50 - Math.abs(gain) / 12 * 50}%`,
  }
}

// ===== Drag-to-scroll for presets row =====
const presetsScrollRef = ref<HTMLElement | null>(null)
let isDragging = false
let dragStartX = 0
let dragStartScrollLeft = 0
let hasDragged = false

function onPresetsMouseDown(e: MouseEvent) {
  // Only start drag on the scroll container itself or its children
  // (not when clicking buttons — buttons handle their own click)
  isDragging = true
  hasDragged = false
  dragStartX = e.pageX
  dragStartScrollLeft = presetsScrollRef.value?.scrollLeft ?? 0

  // Prevent text selection while dragging
  e.preventDefault()

  const onMove = (ev: MouseEvent) => {
    if (!isDragging || !presetsScrollRef.value) return
    const dx = ev.pageX - dragStartX
    if (Math.abs(dx) > 4) hasDragged = true
    presetsScrollRef.value.scrollLeft = dragStartScrollLeft - dx
  }

  const onUp = () => {
    isDragging = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped lang="scss">
.eq-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 520px;
  max-width: calc(100vw - 40px);
  background: rgba(20, 20, 28, 0.92);
  backdrop-filter: blur(24px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
padding: 20px;
z-index: var(--z-overlay, 300);
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.eq-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.eq-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.eq-toggle-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.eq-toggle-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.eq-toggle-btn {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  padding: 0;

  &.active {
    background: #6366f1;
  }

  .eq-toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }

  &.active .eq-toggle-knob {
    transform: translateX(18px);
  }
}

.eq-presets {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  margin-bottom: 20px;
  overflow-x: auto;
  overflow-y: hidden;
  // Hide scrollbar for cleaner look, but keep scrollable
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  cursor: grab;
  user-select: none;
  padding-bottom: 4px;

  // WebKit scrollbar styling
  &::-webkit-scrollbar {
    height: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;

    &:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  }
}

.eq-preset-btn {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }

  &.active {
    background: rgba(99, 102, 241, 0.3);
    border-color: rgba(99, 102, 241, 0.6);
    color: #a5b4fc;
  }
}

.eq-bands {
  display: flex;
  justify-content: space-between;
  gap: 4px;

  &.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
}

.eq-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.eq-value {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  height: 14px;
  white-space: nowrap;
}

.eq-slider-wrap {
  position: relative;
  width: 100%;
  height: 120px;
  display: flex;
  justify-content: center;
}

.eq-slider-track {
  position: absolute;
  width: 4px;
  height: 100%;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: visible;
}

.eq-slider-fill {
  position: absolute;
  left: 0;
  width: 100%;
  background: linear-gradient(180deg, #6366f1, #818cf8);
  border-radius: 2px;
  transition: height 0.1s, bottom 0.1s;
}

.eq-slider-center-line {
  position: absolute;
  top: 50%;
  left: -2px;
  width: 8px;
  height: 1px;
  background: rgba(255, 255, 255, 0.2);
}

.eq-slider {
  position: absolute;
  width: 120px;
  height: 24px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;

  &::-webkit-slider-runnable-track {
    height: 4px;
    background: transparent;
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    margin-top: -6px;
  }

  &::-moz-range-track {
    height: 4px;
    background: transparent;
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    border: none;
    cursor: pointer;
  }
}

.eq-freq {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.eq-slide-enter-active,
.eq-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.eq-slide-enter-from,
.eq-slide-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
</style>
