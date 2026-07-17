<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import LiquidGlass from './LiquidGlass.vue'
import { GlassMode } from './types'
import type { FragmentShaderType } from './shader-util'

interface Props {
  visible?: boolean
  interactive?: boolean
  asBackground?: boolean
  cornerRadius?: number
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  overLight?: boolean
  padding?: string
  mode?: GlassMode
  effect?: FragmentShaderType
  zIndex?: number
  ambientColor?: string | null
  reflectionIntensity?: number
  rimLightColor?: string | null
  lightAngle?: number
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
  interactive: false,
  asBackground: true,
  cornerRadius: 16,
  displacementScale: 32,
  blurAmount: 0.15,
  saturation: 160,
  aberrationIntensity: 2,
  elasticity: 0,
  overLight: false,
  padding: '0',
  mode: GlassMode.standard,
  effect: 'liquidGlass',
  zIndex: 0,
  ambientColor: undefined,
  reflectionIntensity: 0.2,
  rimLightColor: undefined,
  lightAngle: undefined,
})

const noopClick = () => {}

const glassStyle = computed<Partial<CSSProperties>>(() => ({
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
}))
</script>

<template>
  <div
    v-if="visible"
    class="liquid-chip-wrapper"
    :class="{ 'is-background': asBackground }"
  >
    <LiquidGlass
      :class="$attrs.class"
      :style="glassStyle"
      :cornerRadius="cornerRadius"
      :displacementScale="displacementScale"
      :blurAmount="blurAmount"
      :saturation="saturation"
      :aberrationIntensity="aberrationIntensity"
      :elasticity="elasticity"
      :overLight="overLight"
      :padding="padding"
      :mode="mode"
      :effect="effect"
      :asBackground="asBackground"
      :ambientColor="ambientColor"
      :reflectionIntensity="reflectionIntensity"
      :rimLightColor="rimLightColor"
      :lightAngle="lightAngle"
      :onClick="interactive ? noopClick : undefined"
    >
      <slot />
    </LiquidGlass>
  </div>
</template>

<style scoped>
.liquid-chip-wrapper {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: v-bind(zIndex);
  border-radius: inherit;
}

.liquid-chip-wrapper :deep(.glass) {
  border-radius: inherit;
}
</style>
