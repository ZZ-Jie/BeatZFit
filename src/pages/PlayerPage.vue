<template>
  <div class="player-page" ref="pageRef">
    <!-- 3D stage: visualizer canvas + global lyric layer get reparented here
         by useGlobalVisualizer. Sharing the same preserve-3d space creates
         real depth separation between the 3D preset (translateZ 0) and the
         lyric text (translateZ 80px) — like a cf-item focus card floating
         in front of its siblings. -->
    <div class="player-3d-stage" data-player-stage ref="stageRef"></div>

    <!-- Interaction layer: transparent div that captures drag/wheel for the
         global visualizer. Sits above the 3D stage so events reach it, but
         below the UI cards. Cards re-grab pointer-events on themselves so
         their clicks/wheels don't reach here. -->
    <div
      class="player-interaction-layer"
      ref="interactionLayerRef"
      v-if="musicStore.currentTrack"
    ></div>

    <!-- 训练覆盖层（仅在有活动训练会话时显示） -->
    <WorkoutOverlay v-if="fitnessStore.currentSession" />

    <!-- 空状态卡片 -->
    <div class="player-empty-card" v-if="!musicStore.currentTrack">
      <FrostedGlass :corner-radius="24" variant="primary" />
      <div class="player-empty-content">
        <EmptyState
          variant="player"
          title="选择一首歌曲开始沉浸"
          description="在音乐库导入本地音乐或登录网易云"
        >
          <template #actions>
            <button class="btn-glass btn-glass--accent" @click="$router.push('/music')">
              前往音乐库
            </button>
          </template>
        </EmptyState>
      </div>
    </div>

    <!-- 卡片化舞台 -->
    <div class="player-stage" v-if="musicStore.currentTrack">
      <!-- 顶部返回按钮 -->
      <button class="stage-back" @click="$router.back()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <!-- 右下角：可视化预设切换 -->
      <aside class="preset-floater" :class="{ expanded: showPresets }">
        <div
          class="preset-toggle"
          role="button"
          tabindex="0"
          @click="showPresets = !showPresets"
          @keydown.enter="showPresets = !showPresets"
          @keydown.space.prevent="showPresets = !showPresets"
        >
          <FrostedGlass
            :corner-radius="999"
            variant="interactive"
            :ambient-color="glassAmbientColor"
          />
          <div class="preset-toggle-content">
            <span class="preset-toggle-dot"></span>
            <span class="preset-toggle-label">{{ activePresetLabel }}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>

        <Transition :css="false" @enter="presetMenuTransition.onEnter" @leave="presetMenuTransition.onLeave">
          <div class="preset-menu" v-if="showPresets">
            <FrostedGlass
              :corner-radius="16"
              variant="floating"
              :ambient-color="glassAmbientColor"
            />
            <div class="preset-menu-content">
              <button v-for="preset in availablePresets" :key="preset.id"
                class="preset-item"
                :class="{ active: activePreset === preset.id }"
                @click="onSwitchPreset(preset.id)">
                <span class="preset-color"></span>
                <div class="preset-item-info">
                  <span class="preset-item-name">{{ preset.label }}</span>
                  <span class="preset-item-desc">{{ preset.description }}</span>
                </div>
              </button>
            </div>
          </div>
        </Transition>
      </aside>

<!-- 拖拽/缩放提示已改用全局 Toast 系统 -->

      <!-- 相机重置按钮 (仅当 WASD 移动过相机后显示) -->
      <Transition :css="false" @enter="hintFadeTransition.onEnter" @leave="hintFadeTransition.onLeave">
        <button v-if="showCameraReset" class="camera-reset-btn" data-noRotate @click="onResetCamera">
          <FrostedGlass :corner-radius="999" variant="interactive" :ambient-color="glassAmbientColor" />
          <span class="camera-reset-content">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7C2 4.24 4.24 2 7 2C8.83 2 10.45 2.92 11.35 4.3M12 7C12 9.76 9.76 12 7 12C5.17 12 3.55 11.08 2.65 9.7M11.5 2V4.5H9M2.5 12V9.5H5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>重置视角</span>
          </span>
        </button>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onUnmounted, computed, nextTick } from 'vue'
import { useMusicStore } from '@/stores/music'
import { useFitnessStore } from '@/stores/fitness'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'
import { useGlobalToast } from '@/composables/useGlobalToast'
import FrostedGlass from '@/components/FrostedGlass.vue'
import EmptyState from '@/components/EmptyState.vue'
import type { PresetName } from '@/modules/visualizer/threeScene'
import WorkoutOverlay from '@/components/WorkoutOverlay.vue'
import { useDropdownTransition, useFadeTransition } from '@/composables/useGsapTransition'

const musicStore = useMusicStore()
const fitnessStore = useFitnessStore()
const pageRef = ref<HTMLElement | null>(null)

const glassAmbientColor = computed(() => musicStore.currentCoverPalette?.primary)
const interactionLayerRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)

const {
  activePreset,
  attachInteraction,
  detachInteraction,
  switchPreset,
  cameraKeyDown,
  cameraKeyUp,
  resetCameraPosition,
  isCameraAtDefault,
  registerStage,
  unregisterStage,
  reparentCanvas,
} = useGlobalVisualizer()

const showPresets = ref(false)
const showCameraReset = ref(false)
const globalToast = useGlobalToast()

const presetMenuTransition = useDropdownTransition('top right')
const hintFadeTransition = useFadeTransition(0.4)

// 空状态
// (removed emptyRingRef and animatePulseRing — replaced by EmptyState component)

const availablePresets = [
  { id: 'reactive' as PresetName, label: '共鸣 · Resonance', description: '几何粒子随音乐律动 · Curl Noise 有机运动 · 可拖拽缩放', color: '#7EC8E3' },
  { id: 'lens' as PresetName, label: '棱镜 · Prism', description: 'SDF 圆角矩形边界透镜畸变 · 专辑封面填充 · 可拖拽缩放', color: '#F5B041' },
  { id: 'crystalBloom' as PresetName, label: '核璇 · Nucleus', description: '3000 胶囊体中心核 · 玻璃球环绕 · 可拖拽缩放', color: '#B2B8BB' },
  { id: 'tiles' as PresetName, label: '穹璇 · Orbis', description: '封面切割 144 块组成穹顶 · 跟随节奏震动', color: '#FF6B9D' },
  { id: 'cover' as PresetName, label: '星屑 · Étoile', description: '歌曲封面粒子化重构 · 可拖拽旋转、滚轮缩放', color: '#FFFFFF' },
  { id: 'nuage' as PresetName, label: '雾扰 · Nuage', description: '空灵状态 · 仅保留底层烟雾流体背景 · 无 3D 物体', color: '#AAB7B8' }
]

const activePresetLabel = computed(() => {
  return availablePresets.find(p => p.id === activePreset.value)?.label ?? '核璇 · Nucleus'
})

onMounted(() => {
  // Register the 3D stage so the visualizer canvas and the global lyric
  // layer are reparented into the same preserve-3d space. This creates
  // real depth separation: canvas at translateZ(0), lyric at translateZ(80px).
  nextTick(() => {
    if (stageRef.value) {
      registerStage('player', stageRef.value)
      // Direct reparent call as a reliable fallback — registerStage relies
      // on a rAF visibility check + IntersectionObserver, which can race
      // with route transitions. Calling reparentCanvas directly here
      // ensures the canvas and lyric layer are moved into the stage
      // immediately on mount, regardless of observer timing.
      reparentCanvas(stageRef.value)
    }
  })
  // Bind drag/wheel interaction to the transparent overlay layer so the
  // global background visualizer can be rotated/zoomed while on /player.
  if (interactionLayerRef.value) {
    attachInteraction(interactionLayerRef.value)
  }
  scheduleHintFade()
  // WASD/QE camera controls (smooth continuous movement)
  window.addEventListener('keydown', onCameraKeyDown)
  window.addEventListener('keyup', onCameraKeyUp)
  // Check if camera was restored from previous session
  if (!isCameraAtDefault()) {
    showCameraReset.value = true
  }
})

// Must unregister the stage BEFORE Vue destroys the DOM so the canvas and
// lyric layer are moved back to GlobalBackground / .app-shell first.
onBeforeUnmount(() => {
  unregisterStage('player')
})

onUnmounted(() => {
  detachInteraction()
  window.removeEventListener('keydown', onCameraKeyDown)
  window.removeEventListener('keyup', onCameraKeyUp)
  // Don't reset camera on unmount — position is persisted
  // Clear any lingering share card state when leaving the player page
  fitnessStore.dismissShareCard()
})

// ===== WASD/QE smooth camera control =====
const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e'])

function onCameraKeyDown(e: KeyboardEvent) {
  // Don't interfere with typing
  const target = e.target as HTMLElement
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  // Don't interfere with Ctrl/Cmd combinations (those are global shortcuts)
  if (e.ctrlKey || e.metaKey) return

  const key = e.key.toLowerCase()
  if (!CAMERA_KEYS.has(key)) return

  e.preventDefault()
  cameraKeyDown(key)
  // Show reset button when camera moves
  showCameraReset.value = true
}

function onCameraKeyUp(e: KeyboardEvent) {
  const key = e.key.toLowerCase()
  if (!CAMERA_KEYS.has(key)) return
  cameraKeyUp(key)
}

function onResetCamera() {
  resetCameraPosition()
  showCameraReset.value = false
}

async function onSwitchPreset(name: PresetName) {
  showPresets.value = false
  await switchPreset(name)
  scheduleHintFade()
}

function scheduleHintFade() {
globalToast.showOnce('player-hint', 'info', '拖拽旋转 · 滚轮缩放', 4500)
}
</script>

<style lang="scss" scoped>
.player-page {
  height: 100%;
  position: relative;
  overflow: hidden;
  // Transparent so the global particle background shows through.
  background: transparent;
}

// ========== 3D Stage ==========
// Dedicated preserve-3d container. The visualizer canvas and the global
// lyric layer are reparented here by useGlobalVisualizer so they share
// the same 3D space. The canvas sits at translateZ(0) (background), the
// lyric text at translateZ(80px) (foreground) — creating real depth
// separation instead of both appearing on the same flat plane.
//
// perspective: 800px — matches CoverflowListCard's .cf-list perspective,
// so the lyric depth (80px / 800px ≈ 11% scale) is as visually pronounced
// as a cf-item focus card floating in front of its siblings.
.player-3d-stage {
  position: absolute;
  inset: 0;
  z-index: 0;
  perspective: 800px;
  perspective-origin: 50% 50%;
  transform-style: preserve-3d;
  pointer-events: none;
  overflow: visible;

  :deep(canvas) {
    display: block;
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
    pointer-events: none;
    z-index: 0;
    transform: translateZ(0);
  }
}

// ========== Interaction Layer ==========
// Transparent full-cover div that captures drag/wheel events and forwards
// them to the global visualizer via attachInteraction(). Sits above the 3D
// stage (z-index 1) so events reach it, but below the UI cards (z-index 3).
.player-interaction-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: auto;
  touch-action: none; // prevent browser pan/zoom on touch while we handle it
  cursor: grab;
  &:active { cursor: grabbing; }
}

// ========== Empty State Card ==========
.player-empty-card {
  position: absolute;
  inset: 0;
  margin: auto;
  width: min(480px, 80vw);
  height: fit-content;
  max-height: 80vh;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.player-empty-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  pointer-events: auto;
}

// ========== Stage ==========
.player-stage {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--space-xl);
  padding-bottom: calc(var(--player-bar-height) + var(--space-xl));
  // Pass pointer events through to the interaction layer below, except on
  // cards which opt back into pointer-events: auto.
  pointer-events: none;
}

// ========== Back Button ==========
.stage-back {
  position: absolute;
  top: calc(var(--titlebar-height) + var(--space-sm));
  left: var(--space-xl);
  z-index: 3;
  width: 36px; height: 36px;
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  transition: all 200ms var(--ease-standard);

  &:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
    color: var(--text-primary);
  }
}

// ========== Preset Floater ==========
.preset-floater {
  position: absolute;
  right: var(--space-xl);
  top: calc(var(--titlebar-height) + var(--space-sm));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-sm);
  z-index: 3;
  pointer-events: auto;
}

.preset-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-size: var(--text-small);
  cursor: pointer;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  transition: color 200ms var(--ease-standard),
              transform 200ms var(--ease-standard);
  outline: none;

  &:hover,
  &:focus-visible {
    color: var(--text-primary);
  }

  &:active {
    transform: scale(0.96);
  }
}

.preset-toggle-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
}

.preset-toggle-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--accent-mist);
  box-shadow: 0 0 8px rgba(250, 88, 106, 0.5);
}

.preset-menu {
  position: relative;
  width: 220px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  transform-origin: top right;
}

.preset-menu-content {
  position: relative;
  z-index: 1;
  padding: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preset-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: all 150ms var(--ease-standard);

  &:hover {
    background: var(--glass-bg);
    color: var(--text-primary);
  }

  &.active {
    background: rgba(246, 247, 249, 0.12);
    border-color: rgba(255, 255, 255, 0.20);
    color: var(--accent-mist);

    .preset-color {
      background: linear-gradient(135deg, #F4F5F7 0%, #C9CDD4 100%);
      border-color: transparent;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.08), 0 0 10px rgba(255, 255, 255, 0.22);
    }
  }
}

.preset-color {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: transparent;
  border: 1.5px solid rgba(255, 255, 255, 0.28);
  transition: background 150ms var(--ease-standard), border-color 150ms var(--ease-standard), box-shadow 150ms var(--ease-standard);
}

.preset-item-info {
  display: flex;
  flex-direction: column;
}

.preset-item-name {
  font-size: var(--text-small);
  font-weight: 500;
}

.preset-item-desc {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
}

// preset-menu / hint-fade 过渡已迁移至 GSAP JS hooks

.camera-reset-btn {
  position: absolute;
  top: calc(var(--titlebar-height) + var(--space-sm) + 48px);
  right: var(--space-xl);
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
  padding: 8px 16px;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: 13px;
  transition: all 200ms var(--ease-standard);

  &:hover {
    color: var(--text-primary);
  }
}

.camera-reset-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
