<template>
  <div class="global-background" data-global-background>
    <!-- Aurora background: separate canvas, always fixed behind everything.
         Main visualizer canvas (3D objects only, transparent) is reparented
         into stage elements by useGlobalVisualizer. -->
    <AuroraBackground />

    <!-- 自定义图片背景：叠加在可视化器画布之上 -->
    <div
      v-if="backgroundStore.isCustom && backgroundStore.imageUrl"
      class="custom-bg"
      :class="{ 'custom-bg--loaded': imageLoaded }"
    >
      <img
        :src="backgroundStore.imageUrl"
        alt="自定义背景"
        @load="imageLoaded = true"
        @error="onImageError"
      />
      <!-- 暗色遮罩：确保卡片文字可读 -->
      <div class="custom-bg-overlay"></div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'
import { useBackgroundStore } from '@/stores/background'
import AuroraBackground from '@/components/AuroraBackground.vue'

const { initBackground } = useGlobalVisualizer()
const backgroundStore = useBackgroundStore()
const imageLoaded = ref(false)

onMounted(() => {
  // 同步初始化: 不使用 requestAnimationFrame, 因为 Electron 窗口创建时
  // show:false, 在窗口隐藏期间 rAF 被 Chromium 暂停, 会导致可视化器
  // 初始化被无限推迟。容器 position:fixed;inset:0 在 DOM 挂载后即有尺寸。
  const container = document.querySelector<HTMLElement>('[data-global-background]')
  if (container) {
    initBackground(container, 'medium')
  }
  backgroundStore.loadSettings()
})

// 模式或图片 URL（含版本戳）切换时重置加载状态
watch(
  () => [backgroundStore.mode, backgroundStore.imageUrl],
  () => {
    imageLoaded.value = false
  }
)

function onImageError() {
  imageLoaded.value = false
  backgroundStore.error = '背景图片加载失败，已恢复默认可视化背景'
  backgroundStore.setMode('visualizer')
}
</script>

<style lang="scss" scoped>
.global-background {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  // AuroraBackground canvas: z-index 0 (behind main visualizer canvas)
  // Main visualizer canvas (3D objects, transparent): reparented into stages
  // .app-shell (#050507) provides the dark base behind the transparent canvas.

  :deep(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  // AuroraBackground canvas: always behind the main visualizer canvas
  :deep(canvas[data-aurora-canvas]) {
    z-index: 0;
  }
}

.custom-bg {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 600ms var(--ease-standard);

  &--loaded {
    opacity: 1;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.custom-bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(5, 5, 7, 0.55);
  pointer-events: none;
}

</style>
