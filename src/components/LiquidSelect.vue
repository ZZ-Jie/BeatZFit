<template>
  <div class="liquid-select" :class="{ 'liquid-select--open': isOpen }" ref="rootEl">
    <button
      class="liquid-select-trigger"
      :class="{ 'liquid-select-trigger--active': isOpen }"
      @click="toggleOpen"
      type="button"
    >
      <span class="liquid-select-label">{{ selectedLabel }}</span>
      <svg class="liquid-select-arrow" width="12" height="12" viewBox="0 0 12 12">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.3"
          fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Transition :css="false" @enter="dropdownTransition.onEnter" @leave="dropdownTransition.onLeave">
      <div v-if="isOpen" class="liquid-select-dropdown" :style="{ '--ls-max-height': maxHeight || 'none', minWidth: minWidth || 'auto' }">
        <FrostedGlass :corner-radius="14" variant="floating" />
        <div class="liquid-select-dropdown-inner">
          <button
            v-for="opt in options"
            :key="opt.value"
            class="liquid-select-option"
            :class="{ 'liquid-select-option--selected': opt.value === modelValue }"
            :style="opt.style"
            @click="selectOption(opt.value)"
            type="button"
          >
            <span>{{ opt.label }}</span>
            <svg v-if="opt.value === modelValue" width="12" height="12" viewBox="0 0 12 12">
              <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" stroke-width="1.5"
                fill="none" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import FrostedGlass from '@/components/FrostedGlass.vue'
import { useDropdownTransition } from '@/composables/useGsapTransition'
import { useSfx } from '@/composables/useSfx'

export interface SelectOption {
  value: string
  label: string
  style?: Record<string, string>
}

const props = defineProps<{
  modelValue: string
  options: SelectOption[]
  maxHeight?: string
  minWidth?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const isOpen = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const sfx = useSfx()

const dropdownTransition = useDropdownTransition('top left')

const selectedLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.modelValue)
  return opt?.label || props.modelValue
})

function toggleOpen() {
  isOpen.value = !isOpen.value
  if (isOpen.value) sfx.airBloom()
  else sfx.retract()
}

function selectOption(value: string) {
  sfx.detent()
  emit('update:modelValue', value)
  emit('change', value)
  isOpen.value = false
}

function handleClickOutside(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) {
    if (isOpen.value) sfx.retract()
    isOpen.value = false
  }
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    sfx.retract()
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
})

// Close dropdown when modelValue changes externally
watch(() => props.modelValue, () => {
  // No action needed, just keeping reactivity
})
</script>

<style lang="scss" scoped>
.liquid-select {
  position: relative;
  display: inline-block;
}

.liquid-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 6px 12px;
  min-width: 120px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--text-small);
  cursor: pointer;
  // Spec §3.2.2 — smooth hover + spring press
  transition: background var(--duration-micro) var(--ease-standard),
              border-color var(--duration-micro) var(--ease-standard),
              transform 200ms var(--ease-spring);
  backdrop-filter: blur(var(--lg-interactive-blur)) saturate(var(--lg-interactive-saturate));
  -webkit-backdrop-filter: blur(var(--lg-interactive-blur)) saturate(var(--lg-interactive-saturate));
  will-change: transform;

  &:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
  }

  &:active {
    transform: scale(0.97) translateZ(0);
    transition: transform 100ms ease-out;
  }

  &--active {
    background: var(--glass-bg-active);
    border-color: var(--glass-border-hover);
  }
}

.liquid-select-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.liquid-select-arrow {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 200ms var(--ease-standard);

  .liquid-select--open & {
    transform: rotate(180deg);
  }
}

.liquid-select-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  min-width: 100%;
  z-index: var(--z-dropdown);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  overflow: hidden;

  & > *:not(.frosted-glass) {
    position: relative;
    z-index: 1;
  }
}

/* Scrollable dropdown body — hidden scrollbar */
.liquid-select-dropdown-inner {
  position: relative;
  z-index: 1;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: var(--ls-max-height, none);
  overflow-y: auto;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE10+ */
  &::-webkit-scrollbar {
    display: none; /* Chrome/Safari/Electron */
  }
}

.liquid-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 7px 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-small);
  cursor: pointer;
  text-align: left;
  // Spec §3.2.2 — smooth hover + press
  transition: background var(--duration-micro) var(--ease-standard),
              color var(--duration-micro) var(--ease-standard),
              transform 100ms ease-out;
  will-change: transform;

  &:hover {
    background: var(--glass-bg-hover);
    color: var(--text-primary);
    transform: translateX(2px) translateZ(0);
  }

  &:active {
    transform: scale(0.97) translateZ(0);
  }

  &--selected {
    color: var(--accent-mist);
    background: rgba(250, 88, 106, 0.08);
  }
}

// dropdown 过渡已迁移至 GSAP JS hooks (useDropdownTransition)
</style>
