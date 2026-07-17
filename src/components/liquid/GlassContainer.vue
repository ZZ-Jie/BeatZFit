<script setup lang="ts" name="GlassContainer">
import { ref, watch, computed, type CSSProperties } from 'vue'
import { GlassMode, type GlassContainerProps } from './types'
import { ShaderDisplacementGenerator } from './shader-util'

import GlassFilter from './GlassFilter.vue'
import { uuid } from './utils'
const props = withDefaults(defineProps<GlassContainerProps>(), {
    className: "",
    displacementScale: 25,
    blurAmount: 12,
    saturation: 180,
    aberrationIntensity: 2,
    active: false,
    overLight: false,
    cornerRadius: 999,
    padding: "24px 32px",
    glassSize: () => ({ width: 270, height: 69 }),
    mode: GlassMode.standard,
    effect: "liquidGlass",
    asBackground: false,
})
const shaderMapUrl = ref<string>("")
const isFirefox = window.navigator.userAgent.toLowerCase().includes("firefox")
const filterId = uuid()
// Generate shader-based displacement map using shaderUtils
const generateShaderDisplacementMap = async (width: number, height: number) => {
    const generator = new ShaderDisplacementGenerator({
        width,
        height,
        effect: props.effect,
    })

    const dataUrl = await generator.updateShader()
    generator.destroy()

    return dataUrl
}
watch(() => [props.mode, props.glassSize.width, props.glassSize.height, props.effect], async () => {
    if (props.mode === GlassMode.shader) {
        const url = await generateShaderDisplacementMap(props.glassSize.width, props.glassSize.height)
        shaderMapUrl.value = url
    }
})

const isFrosted = computed(() => props.mode === GlassMode.frosted)

const backdropStyle = computed<Partial<CSSProperties>>(() => {
    if (isFrosted.value) {
        return {
            backdropFilter: `blur(${(props.overLight ? 24 : 12) + props.blurAmount * 48}px) saturate(${props.saturation}%)`,
            WebkitBackdropFilter: `blur(${(props.overLight ? 24 : 12) + props.blurAmount * 48}px) saturate(${props.saturation}%)`,
            background: props.overLight
                ? 'rgba(255, 255, 255, 0.08)'
                : 'rgba(255, 255, 255, 0.05)',
        }
    }
    return {
        filter: isFirefox ? undefined : `url(#${filterId})`,
        backdropFilter: `blur(${(props.overLight ? 12 : 4) + props.blurAmount * 32}px) saturate(${props.saturation}%)`,
    }
})



</script>

<template>
    <div :class="`relative ${className} ${active ? 'active' : ''} ${Boolean(onClick) ? 'cursor-pointer' : ''}`"
        :style="style" @click="onClick">
        <GlassFilter v-if="!isFrosted" :mode="mode" :id="filterId" :displacementScale="displacementScale"
            :aberrationIntensity="aberrationIntensity" :width="glassSize.width" :height="glassSize.height"
            :shaderMapUrl="shaderMapUrl" />

        <div class="glass" :style="{
            borderRadius: `${cornerRadius}px`,
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '24px',
            padding,
            overflow: 'hidden',
            transition: 'all 0.2s ease-in-out',
            width: props.asBackground ? '100%' : undefined,
            height: props.asBackground ? '100%' : undefined,
            boxShadow: props.overLight ? '0px 16px 70px rgba(0, 0, 0, 0.75)' : '0px 12px 40px rgba(0, 0, 0, 0.25)',
        }" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave" @mousedown="onMouseDown" @mouseup="onMouseUp">
            <!-- backdrop layer that gets wiggly -->
            <span class="glass__warp" :style="{
                ...backdropStyle,
                position: 'absolute',
                inset: '0',
            }"></span>

            <!-- user content stays sharp -->
            <div class="transition-all duration-150 ease-in-out text-white" :style="{
                position: 'relative',
                zIndex: 1,
                font: 'inherit',
                textShadow: props.overLight ? '0px 2px 12px rgba(0, 0, 0, 0)' : '0px 2px 12px rgba(0, 0, 0, 0.4)',
            }">
                <slot />
            </div>
        </div>
    </div>
</template>