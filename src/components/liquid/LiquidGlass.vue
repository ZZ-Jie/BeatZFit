<script lang="ts" setup>
import { ref, watchEffect, computed, type CSSProperties } from 'vue'
import type { LiquidGlassProps } from './types'
import { GlassMode } from './types'
import GlassContainer from './GlassContainer.vue'
import { autoPx } from './utils'


const props = withDefaults(defineProps<LiquidGlassProps>(), {
  displacementScale: 70,
  blurAmount: 0.0625,
  saturation: 140,
  aberrationIntensity: 2,
  elasticity: 0.15,
  cornerRadius: 999,
  padding: "24px 32px",
  overLight: false,
  asBackground: false,

  mode: undefined,

  ambientColor: undefined,
  reflectionIntensity: 0.2,
  rimLightColor: undefined,
  lightAngle: undefined,
})

const resolvedMode = computed(() => {
  if (props.mode !== undefined) return props.mode
  // Large background cards default to the cheaper frosted CSS blur path to
  // avoid the GPU cost of running per-instance SVG displacement filters.
  return props.asBackground ? GlassMode.frosted : GlassMode.standard
})
const glassRef = ref<InstanceType<typeof GlassContainer>>()
const isHovered = ref(false)
const isActive = ref(false)
const glassSize = ref({ width: 270, height: 69 })
const internalGlobalMousePos = ref({ x: 0, y: 0 })
const internalMouseOffset = ref({ x: 0, y: 0 })

// Use external mouse position if provided, otherwise use internal
const globalMousePos = computed(() => props.globalMousePos || internalGlobalMousePos.value)
const mouseOffset = computed(() => props.mouseOffset || internalMouseOffset.value)
const handleMouseMove = (e: MouseEvent) => {
  const container = props.mouseContainer || glassRef.value?.$el
  if (!container) {
    return
  }

  const rect = container.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  Object.assign(internalMouseOffset.value, {
    x: ((e.clientX - centerX) / rect.width) * 100,
    y: ((e.clientY - centerY) / rect.height) * 100,
  })

  Object.assign(internalGlobalMousePos.value, {
    x: e.clientX,
    y: e.clientY,
  })
}

// Set up mouse tracking if no external mouse position is provided
watchEffect(() => {
  if (props.globalMousePos && props.mouseOffset) {
    // External mouse tracking is provided, don't set up internal tracking
    return
  }

  const container = props.mouseContainer || glassRef.value?.$el
  if (!container) {
    return
  }

  container.addEventListener("mousemove", handleMouseMove)

  return () => {
    container.removeEventListener("mousemove", handleMouseMove)
  }
})

const calculateDirectionalScale = computed(() => {
  if (!globalMousePos.value.x || !globalMousePos.value.y || !glassRef.value) {
    return "scale(1)"
  }

  const rect = glassRef.value?.$el.getBoundingClientRect()
  const pillCenterX = rect.left + rect.width / 2
  const pillCenterY = rect.top + rect.height / 2
  const pillWidth = glassSize.value.width
  const pillHeight = glassSize.value.height

  const deltaX = globalMousePos.value.x - pillCenterX
  const deltaY = globalMousePos.value.y - pillCenterY

  // Calculate distance from mouse to pill edges (not center)
  const edgeDistanceX = Math.max(0, Math.abs(deltaX) - pillWidth / 2)
  const edgeDistanceY = Math.max(0, Math.abs(deltaY) - pillHeight / 2)
  const edgeDistance = Math.sqrt(edgeDistanceX * edgeDistanceX + edgeDistanceY * edgeDistanceY)

  // Activation zone: 200px from edges
  const activationZone = 200

  // If outside activation zone, no effect
  if (edgeDistance > activationZone) {
    return "scale(1)"
  }

  // Calculate fade-in factor (1 at edge, 0 at activation zone boundary)
  const fadeInFactor = 1 - edgeDistance / activationZone

  // Normalize the deltas for direction
  const centerDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  if (centerDistance === 0) {
    return "scale(1)"
  }

  const normalizedX = deltaX / centerDistance
  const normalizedY = deltaY / centerDistance

  // Calculate stretch factors with fade-in
  const stretchIntensity = Math.min(centerDistance / 300, 1) * props.elasticity * fadeInFactor

  // X-axis scaling: stretch horizontally when moving left/right, compress when moving up/down
  const scaleX = 1 + Math.abs(normalizedX) * stretchIntensity * 0.3 - Math.abs(normalizedY) * stretchIntensity * 0.15

  // Y-axis scaling: stretch vertically when moving up/down, compress when moving left/right
  const scaleY = 1 + Math.abs(normalizedY) * stretchIntensity * 0.3 - Math.abs(normalizedX) * stretchIntensity * 0.15

  return `scaleX(${Math.max(0.8, scaleX)}) scaleY(${Math.max(0.8, scaleY)})`
})

const calculateFadeInFactor = computed(() => {
  if (!globalMousePos.value.x || !globalMousePos.value.y || !glassRef.value) {
    return 0
  }

  const rect = glassRef.value?.$el.getBoundingClientRect()
  const pillCenterX = rect.left + rect.width / 2
  const pillCenterY = rect.top + rect.height / 2
  const pillWidth = glassSize.value.width
  const pillHeight = glassSize.value.height

  const edgeDistanceX = Math.max(0, Math.abs(globalMousePos.value.x - pillCenterX) - pillWidth / 2)
  const edgeDistanceY = Math.max(0, Math.abs(globalMousePos.value.y - pillCenterY) - pillHeight / 2)
  const edgeDistance = Math.sqrt(edgeDistanceX * edgeDistanceX + edgeDistanceY * edgeDistanceY)

  const activationZone = 200
  return edgeDistance > activationZone ? 0 : 1 - edgeDistance / activationZone
})

// Helper function to calculate elastic translation
const calculateElasticTranslation = computed(() => {
  if (!glassRef.value) {
    return { x: 0, y: 0 }
  }

  const fadeInFactor = calculateFadeInFactor.value
  const rect = glassRef.value?.$el.getBoundingClientRect()
  const pillCenterX = rect.left + rect.width / 2
  const pillCenterY = rect.top + rect.height / 2

  return {
    x: (globalMousePos.value.x - pillCenterX) * props.elasticity * 0.1 * fadeInFactor,
    y: (globalMousePos.value.y - pillCenterY) * props.elasticity * 0.1 * fadeInFactor,
  }
}
)
// Update glass size whenever component mounts or window resizes
watchEffect(() => {
  const updateGlassSize = () => {
    if (glassRef.value) {
      const rect = glassRef.value?.$el.getBoundingClientRect()
      Object.assign(glassSize.value, { width: rect.width, height: rect.height })
    }
  }

  updateGlassSize()
  window.addEventListener("resize", updateGlassSize)
  return () => window.removeEventListener("resize", updateGlassSize)
})
const transformStyle = computed(() => {
  return `translate(calc(-50% + ${calculateElasticTranslation.value.x}px), calc(-50% + ${calculateElasticTranslation.value.y}px)) ${isActive.value && Boolean(props.onClick) ? "scale(0.96)" : calculateDirectionalScale.value}`
})

const baseStyle = computed<Partial<CSSProperties>>(() => {
  if (props.asBackground) {
    return {
      ...props.style,
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      transform: 'none',
      transition: "all ease-out 0.2s",
    }
  }
  return {
    ...props.style,
    transform: transformStyle.value,
    transition: "all ease-out 0.2s",
  }
})

const positionStyles = computed<Partial<CSSProperties>>(() => {
  if (props.asBackground) {
    return {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
    }
  }
  return {
    position: baseStyle.value.position || "relative",
    top: baseStyle.value.top || "50%",
    left: baseStyle.value.left || "50%",
  }
})

// ===== Dynamic lighting helpers =====
const intensityMultiplier = computed(() => props.asBackground ? 0.7 : 1)

function hexToRgba(hex: string | null | undefined, alpha: number): string {
  if (!hex) return `rgba(255, 255, 255, ${alpha})`
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean, 16)
  if (isNaN(bigint)) return `rgba(255, 255, 255, ${alpha})`
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const ambientRgba = computed(() => hexToRgba(props.ambientColor, 1))
const rimRgba = computed(() => hexToRgba(props.rimLightColor || props.ambientColor, 1))

const lightAngleDeg = computed(() => {
  if (typeof props.lightAngle === 'number') return props.lightAngle
  // Derive a subtle light angle from mouse offset when no explicit angle is given.
  return 125 + mouseOffset.value.x * 1.6 + mouseOffset.value.y * 0.4
})

const dynamicOpacity = computed(() => {
  const base = 0.15 + Math.min(0.25, Math.abs(mouseOffset.value.x) * 0.002 + Math.abs(mouseOffset.value.y) * 0.002)
  return base * props.reflectionIntensity * 2.5 * intensityMultiplier.value
})

const borderHighlight = computed(() => {
  // Mix a touch of ambient color into the white highlight so the glass
  // feels like it is absorbing the environment.
  const tint = props.ambientColor ? hexToRgba(props.ambientColor, 0.35 * intensityMultiplier.value) : 'rgba(255,255,255,0)'
  const white = (a: number) => `rgba(255, 255, 255, ${a})`
  return {
    stop1: white(0.06 + Math.abs(mouseOffset.value.x) * 0.004),
    stop2: white(0.18 + Math.abs(mouseOffset.value.x) * 0.006),
    tint,
  }
})

const reflectionSweep = computed(() => {
  const angle = lightAngleDeg.value
  const tint = hexToRgba(props.ambientColor, props.reflectionIntensity * 0.55 * intensityMultiplier.value)
  return `conic-gradient(from ${angle}deg at 50% 50%, transparent 0deg, ${tint} 30deg, transparent 60deg, transparent 300deg, ${tint} 330deg, transparent 360deg)`
})
</script>

<template>
  <!-- {/* Over light effect */} -->
  <div
    :class="`bg-black transition-all duration-150 ease-in-out pointer-events-none ${overLight ? 'opacity-20' : 'opacity-0'}`"
    :style="{
      ...positionStyles,
      height: glassSize.height,
      width: glassSize.width,
      borderRadius: `${cornerRadius}px`,
      transform: baseStyle.transform,
      transition: baseStyle.transition,
    }"></div>
  <div
    :class="`bg-black transition-all duration-150 ease-in-out pointer-events-none mix-blend-overlay ${overLight ? 'opacity-100' : 'opacity-0'}`"
    :style="{
      ...positionStyles,
      height: glassSize.height,
      width: glassSize.width,
      borderRadius: `${cornerRadius}px`,
      transform: baseStyle.transform,
      transition: baseStyle.transition,
    }"></div>

  <GlassContainer ref="glassRef" v-bind="$attrs" :effect="effect" :style="baseStyle" :cornerRadius="cornerRadius"
    :displacementScale="overLight ? displacementScale * 0.5 : displacementScale" :blurAmount="blurAmount"
    :saturation="saturation" :aberrationIntensity="aberrationIntensity" :glassSize="glassSize" :padding="padding"
    :mouseOffset="mouseOffset" :onMouseEnter="() => isHovered = true" :onMouseLeave="() => isHovered = false"
    :onMouseDown="() => isActive = true" :onMouseUp="() => isActive = false" :active="isActive" :overLight="overLight"
    :onClick="onClick" :mode="resolvedMode" :asBackground="asBackground">
    <slot />
  </GlassContainer>

  <!-- {/* Ambient glow - color absorption inside the glass */} -->
  <span :style="{
    ...positionStyles,
    height: autoPx(glassSize.height),
    width: autoPx(glassSize.width),
    borderRadius: `${cornerRadius}px`,
    transform: baseStyle.transform,
    transition: baseStyle.transition,
    pointerEvents: 'none',
    mixBlendMode: 'overlay',
    opacity: props.ambientColor ? dynamicOpacity * 0.45 : 0,
    background: `radial-gradient(ellipse 120% 80% at ${50 + mouseOffset.x * 0.25}% ${30 + mouseOffset.y * 0.2}%, ${ambientRgba} 0%, transparent 55%)`
  }"></span>

  <!-- {/* Border layer 1 - subtle outer rim light */} -->
  <span :style="{
    ...positionStyles,
    height: autoPx(glassSize.height),
    width: autoPx(glassSize.width),
    borderRadius: `${cornerRadius}px`,
    transform: baseStyle.transform,
    transition: baseStyle.transition,
    pointerEvents: 'none',
    mixBlendMode: 'screen',
    opacity: 0.10 * intensityMultiplier,
    padding: '1px',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    boxShadow: '0 0 0 0.5px rgba(255, 255, 255, 0.22) inset, 0 1px 2px rgba(255, 255, 255, 0.10) inset, 0 1px 3px rgba(0, 0, 0, 0.30)',
    background: `linear-gradient( ${lightAngleDeg}deg, rgba(255, 255, 255, 0.0) 0%, ${borderHighlight.stop1} ${Math.max(10, 30 + mouseOffset.y * 0.25)}%, ${borderHighlight.tint} ${Math.max(15, 35 + mouseOffset.y * 0.25)}%, ${borderHighlight.stop2} ${Math.min(90, 62 + mouseOffset.y * 0.3)}%, rgba(255, 255, 255, 0.0) 100% )`
  }"></span>

  <!-- {/* Border layer 2 - softer inner highlight */} -->
  <span :style="{
    ...positionStyles,
    height: autoPx(glassSize.height),
    width: autoPx(glassSize.width),
    borderRadius: `${cornerRadius}px`,
    transform: baseStyle.transform,
    transition: baseStyle.transition,
    pointerEvents: 'none',
    mixBlendMode: 'overlay',
    padding: '1px',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    boxShadow: '0 0 0 0.5px rgba(255, 255, 255, 0.18) inset, 0 1px 2px rgba(255, 255, 255, 0.08) inset, 0 1px 3px rgba(0, 0, 0, 0.25)',
    background: `linear-gradient( ${lightAngleDeg}deg, rgba(255, 255, 255, 0.0) 0%, ${borderHighlight.stop1} ${Math.max(10, 30 + mouseOffset.y * 0.25)}%, ${borderHighlight.tint} ${Math.max(15, 35 + mouseOffset.y * 0.25)}%, ${borderHighlight.stop2} ${Math.min(90, 62 + mouseOffset.y * 0.3)}%, rgba(255, 255, 255, 0.0) 100% )`
  }"></span>

  <!-- {/* Rim light - thin colored edge that brightens on interaction */} -->
  <span :style="{
    ...positionStyles,
    height: autoPx(glassSize.height),
    width: autoPx(glassSize.width),
    borderRadius: `${cornerRadius}px`,
    transform: baseStyle.transform,
    transition: baseStyle.transition,
    pointerEvents: 'none',
    mixBlendMode: 'screen',
    opacity: props.ambientColor ? (0.08 + Math.min(0.07, Math.abs(mouseOffset.x) * 0.0015)) * intensityMultiplier : 0,
    padding: '1px',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    boxShadow: `0 0 0 0.5px ${rimRgba} inset, 0 0 6px ${hexToRgba(props.rimLightColor || props.ambientColor, 0.22 * intensityMultiplier)}`
  }"></span>

  <!-- {/* Dynamic light gloss - reacts to mouse/view angle */} -->
  <span :style="{
    ...positionStyles,
    height: autoPx(glassSize.height),
    width: autoPx(glassSize.width),
    borderRadius: `${cornerRadius}px`,
    transform: baseStyle.transform,
    transition: baseStyle.transition,
    pointerEvents: 'none',
    mixBlendMode: 'soft-light',
    opacity: dynamicOpacity,
    background: `radial-gradient(ellipse 80% 60% at ${50 + mouseOffset.x * 0.35}% ${20 + mouseOffset.y * 0.25}%, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 60%)`
  }"></span>

  <!-- {/* Reflection sweep - rotating sheen tied to light source */} -->
  <span :style="{
    ...positionStyles,
    height: autoPx(glassSize.height),
    width: autoPx(glassSize.width),
    borderRadius: `${cornerRadius}px`,
    transform: baseStyle.transform,
    transition: baseStyle.transition,
    pointerEvents: 'none',
    mixBlendMode: 'screen',
    opacity: props.ambientColor ? dynamicOpacity * 0.7 : 0,
    background: reflectionSweep
  }"></span>
  <template v-if="Boolean(onClick)">
    <!-- {/* Hover effects */} -->

    <div :style="{
      ...positionStyles,
      height: autoPx(glassSize.height),
      width: autoPx(glassSize.width) + 1,
      borderRadius: `${cornerRadius}px`,
      transform: baseStyle.transform,
      pointerEvents: 'none',
      transition: 'all 0.2s ease-out',
      opacity: isHovered || isActive ? 0.5 : 0,
      backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%)',
      mixBlendMode: 'overlay'
    }"></div>
    <div :style="{
      ...positionStyles,
      height: autoPx(glassSize.height),
      width: autoPx(glassSize.width + 1),
      borderRadius: `${cornerRadius}px`,
      transform: baseStyle.transform,
      pointerEvents: 'none',
      transition: 'all 0.2s ease-out',
      opacity: isActive ? 0.5 : 0,
      backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 80%)',
      mixBlendMode: 'overlay'
    }"></div>
    <div :style="{
      ...baseStyle,
      height: autoPx(glassSize.height),
      width: autoPx(glassSize.width + 1),
      borderRadius: `${cornerRadius}px`,
      position: baseStyle.position,
      top: baseStyle.top,
      left: baseStyle.left,
      pointerEvents: 'none',
      transition: 'all 0.2s ease-out',
      opacity: isHovered ? 0.4 : isActive ? 0.8 : 0,
      backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 100%)',
      mixBlendMode: 'overlay'
    }"></div>
  </template>

</template>
