<template>
  <header class="titlebar" @dblclick="toggleMaximize">
    <!-- 拖拽区：透明，覆盖整个顶部，但不阻挡右侧按钮的点击 -->
    <div class="titlebar-drag"></div>

    <div class="titlebar-controls">
      <button class="titlebar-btn" @click="minimize" title="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button class="titlebar-btn" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
        <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="0" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1" />
          <rect x="0" y="2" width="8" height="8" rx="1" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button class="titlebar-btn titlebar-btn--close" @click="closeWin" title="关闭">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSfx } from '@/composables/useSfx'

const isMaximized = ref(false)
const sfx = useSfx()

function onMaximizeChange(maximized: boolean) {
  isMaximized.value = maximized
}

onMounted(async () => {
  try {
    if (window.electronAPI) {
      const result = await window.electronAPI.window.isMaximized()
      isMaximized.value = result.isMaximized
      window.electronAPI.on?.('window:maximizeChange', onMaximizeChange)
    }
  } catch (e) {
    console.warn('[TitleBar] Failed to init window state:', e)
  }
})

onUnmounted(() => {
  window.electronAPI?.removeListener?.('window:maximizeChange', onMaximizeChange)
})

async function minimize() {
  sfx.detent()
  if (window.electronAPI) {
    await window.electronAPI.window.minimize()
  }
}

async function toggleMaximize() {
  sfx.detent()
  if (window.electronAPI) {
    const result = await window.electronAPI.window.maximize()
    isMaximized.value = result.isMaximized
  }
}

async function closeWin() {
  sfx.retract()
  if (window.electronAPI) {
    await window.electronAPI.window.close()
  }
}
</script>

<style lang="scss" scoped>
/**
 * 全局浮动式 TitleBar
 *
 * position: fixed 覆盖在内容上方，不占据 flex 空间。
 * 仅有右侧三个窗口控制按钮可见，左侧拖拽区完全透明。
 * 内容区可以从 y=0 开始渲染，最大化利用屏幕空间。
 */
.titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--titlebar-height);
  display: flex;
  align-items: center;
  z-index: var(--z-sticky);
  -webkit-app-region: drag;
  pointer-events: none; // 拖拽区本身不接收点击，只用于窗口拖拽
}

.titlebar-drag {
  flex: 1;
  align-self: stretch;
  -webkit-app-region: drag;
  min-width: 0;
}

.titlebar-controls {
  flex-shrink: 0;
  display: flex;
  margin-left: auto;
  -webkit-app-region: no-drag;
  pointer-events: auto; // 按钮可点击
  position: relative;
  z-index: 2;
}

.titlebar-btn {
  width: 40px;
  height: var(--titlebar-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 150ms var(--ease-standard),
              color 150ms var(--ease-standard);

  &:hover {
    background: var(--glass-bg);
    color: var(--text-primary);
  }

  &--close:hover {
    background: #E81123;
    color: white;
  }
}
</style>
