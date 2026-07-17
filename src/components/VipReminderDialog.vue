<template>
  <transition name="vip-slide">
    <div
      v-if="musicStore.vipReminder"
      class="vip-capsule"
      @click="dismiss"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    >
      <svg class="vip-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 2L13.09 8.26L20 9L15 14L16.18 21L12 17.77L7.82 21L9 14L4 9L10.91 8.26L12 2Z" />
      </svg>
      <span class="vip-text">「{{ musicStore.vipReminder.trackTitle }}」需要VIP，非VIP只能试听30秒</span>
      <button class="vip-skip-btn" @click.stop="skipSong" title="跳过">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      </button>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { watch, onUnmounted, ref } from 'vue'
import { useMusicStore } from '@/stores/music'
import { useSfx } from '@/composables/useSfx'

const musicStore = useMusicStore()
const sfx = useSfx()

const isHovering = ref(false)
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer)
    autoDismissTimer = null
  }
}

function startTimer() {
  clearTimer()
  autoDismissTimer = setTimeout(() => {
    if (!isHovering.value) {
      musicStore.clearVipReminder()
    }
  }, 3000)
}

function onMouseEnter() {
  isHovering.value = true
  clearTimer()
}

function onMouseLeave() {
  isHovering.value = false
  startTimer()
}

function dismiss() {
  sfx.retract()
  clearTimer()
  musicStore.clearVipReminder()
}

function skipSong() {
  sfx.detent()
  clearTimer()
  musicStore.clearVipReminder()
  musicStore.nextTrack()
}

// Start the 3s timer whenever a new VIP reminder appears
watch(
  () => musicStore.vipReminder,
  (val) => {
    if (val) {
      startTimer()
    } else {
      clearTimer()
    }
  }
)

onUnmounted(() => {
  clearTimer()
})
</script>

<style scoped lang="scss">
.vip-capsule {
  position: fixed;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-radius: 24px;
  // High-contrast amber gradient — visible on both light and dark backgrounds
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(217, 119, 6, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow:
    0 4px 24px rgba(245, 158, 11, 0.4),
    0 1px 4px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(12px) saturate(1.5);
  z-index: calc(var(--z-modal, 400) + 50);
  cursor: pointer;
  max-width: calc(100vw - 80px);
  // Ensure always on top of everything
  pointer-events: auto;
}

.vip-icon {
  color: #fff;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.vip-text {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}

.vip-skip-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.35);
  }
}

.vip-slide-enter-active {
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.vip-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.vip-slide-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-40px) scale(0.9);
}

.vip-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px) scale(0.95);
}
</style>
