<template>
  <Transition name="update-slide">
    <div v-if="visible" class="update-notifier" :class="{ 'is-downloaded': status === 'downloaded' }">
      <!-- 下载中 -->
      <template v-if="status === 'downloading'">
        <div class="update-header">
          <span class="update-icon">↓</span>
          <span class="update-title">正在下载更新</span>
          <span class="update-progress-text">{{ progress }}%</span>
        </div>
        <div class="update-progress-bar">
          <div class="update-progress-fill" :style="{ width: `${progress}%` }"></div>
        </div>
      </template>

      <!-- 下载完成 -->
      <template v-else-if="status === 'downloaded'">
        <div class="update-header">
          <span class="update-icon">✓</span>
          <span class="update-title">新版本已就绪</span>
        </div>
        <div class="update-body">
          <span class="update-version" v-if="version">v{{ version }}</span>
          <span class="update-desc">重启即可安装更新</span>
        </div>
        <div class="update-actions">
          <button class="update-btn update-btn-primary" @click="installNow">重启安装</button>
          <button class="update-btn update-btn-ghost" @click="dismiss">稍后</button>
        </div>
      </template>

      <!-- 发现新版本 (自动下载中) -->
      <template v-else-if="status === 'available'">
        <div class="update-header">
          <span class="update-icon">✦</span>
          <span class="update-title">发现新版本</span>
          <span class="update-version" v-if="version">v{{ version }}</span>
        </div>
        <div class="update-body">
          <span class="update-desc">正在准备下载...</span>
        </div>
      </template>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)
const status = ref<string>('idle')
const version = ref<string | null>(null)
const progress = ref(0)

let dismissed = false

// IPC event listeners
let statusHandler: ((...args: any[]) => void) | null = null
let progressHandler: ((...args: any[]) => void) | null = null

onMounted(() => {
  const api = (window as any).electronAPI
  if (!api?.on || !api?.updater) return

  // Listen for status changes from main process
  statusHandler = (...args: any[]) => {
    const data = args[0]
    if (!data) return
    status.value = data.status
    if (data.info?.version) {
      version.value = data.info.version
    }
    if (data.progress !== undefined) {
      progress.value = data.progress
    }

    // Show/hide the notifier
    if (data.status === 'downloading' || data.status === 'downloaded' || data.status === 'available') {
      if (!dismissed) visible.value = true
    } else if (data.status === 'not-available' || data.status === 'error') {
      visible.value = false
    }
  }
  api.on('updater:statusChanged', statusHandler)

  // Listen for download progress
  progressHandler = (...args: any[]) => {
    progress.value = args[0] ?? 0
    if (status.value !== 'downloading') {
      status.value = 'downloading'
    }
    if (!dismissed) visible.value = true
  }
  api.on('updater:downloadProgress', progressHandler)

  // Check initial status
  api.updater.getStatus().then((res: any) => {
    if (res?.success && res?.data) {
      status.value = res.data.status
      version.value = res.data.version
      progress.value = res.data.progress
      if (res.data.status === 'downloaded') {
        visible.value = true
      }
    }
  }).catch(() => {})
})

onUnmounted(() => {
  const api = (window as any).electronAPI
  if (api?.removeListener) {
    if (statusHandler) api.removeListener('updater:statusChanged', statusHandler)
    if (progressHandler) api.removeListener('updater:downloadProgress', progressHandler)
  }
})

function installNow() {
  const api = (window as any).electronAPI
  api?.updater?.installUpdate()
}

function dismiss() {
  visible.value = false
  dismissed = true
  // Reset dismissed after a while so future updates can show
  setTimeout(() => { dismissed = false }, 60 * 1000)
}
</script>

<style scoped lang="scss">
.update-notifier {
  position: fixed;
  bottom: 80px;
  right: 24px;
  z-index: 90000;
  min-width: 280px;
  max-width: 340px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(20, 20, 26, 0.88);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  font-family: 'Inter', 'Quicksand', sans-serif;
  color: rgba(245, 240, 232, 0.92);
  user-select: none;
  cursor: default;
}

.update-notifier.is-downloaded {
  border-color: rgba(100, 200, 120, 0.25);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(100, 200, 120, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.update-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.update-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(245, 240, 232, 0.7);
  flex-shrink: 0;
}

.is-downloaded .update-icon {
  background: rgba(100, 200, 120, 0.15);
  color: rgb(120, 210, 140);
}

.update-title {
  flex: 1;
}

.update-version {
  font-size: 12px;
  font-weight: 500;
  color: rgba(245, 240, 232, 0.5);
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
}

.update-progress-text {
  font-size: 12px;
  font-weight: 600;
  color: rgba(245, 240, 232, 0.6);
  font-variant-numeric: tabular-nums;
}

.update-progress-bar {
  margin-top: 10px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(140, 180, 255, 0.8), rgba(180, 140, 255, 0.8));
  transition: width 0.2s ease;
}

.update-body {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(245, 240, 232, 0.55);
}

.update-desc {
  flex: 1;
}

.update-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.update-btn {
  flex: 1;
  padding: 7px 14px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  outline: none;
}

.update-btn-primary {
  background: rgba(120, 200, 140, 0.18);
  color: rgb(140, 220, 160);
  border: 1px solid rgba(120, 200, 140, 0.25);
  &:hover {
    background: rgba(120, 200, 140, 0.28);
    transform: translateY(-1px);
  }
  &:active {
    transform: translateY(0);
  }
}

.update-btn-ghost {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(245, 240, 232, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.06);
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
}

// ── Transition ──
.update-slide-enter-active,
.update-slide-leave-active {
  transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.update-slide-enter-from {
  opacity: 0;
  transform: translateX(20px) translateY(10px);
}
.update-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
