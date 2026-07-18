<template>
  <Teleport to="body">
    <!-- ── 普通 Toast 堆栈 (中部偏下) ── -->
  <div class="gt-container gt-container--bottom">
    <Transition
      v-for="t in bottomToasts"
      :key="t.id"
      :css="false"
      @enter="toastTransition.onEnter"
      @leave="toastTransition.onLeave"
    >
      <div class="gt-toast" :class="`gt-toast--${t.type}`" @click="removeToast(t.id)">
        <FrostedGlass :corner-radius="14" variant="hint" />
        <span class="gt-toast-icon" v-if="t.type === 'success'">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="gt-toast-icon" v-else-if="t.type === 'error' || t.type === 'warning'">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 13H2L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 7v3M8 11.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
        <span class="gt-toast-icon" v-else>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4.5M8 4.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
        <span class="gt-toast-msg">{{ t.message }}</span>
      </div>
    </Transition>
  </div>

  <!-- ── VIP Toast 堆栈 (中部偏上) ── -->
  <div class="gt-container gt-container--top">
    <Transition
      v-for="t in topToasts"
      :key="t.id"
      :css="false"
      @enter="toastTransition.onEnter"
      @leave="toastTransition.onLeave"
    >
      <div class="gt-toast gt-toast--vip" @click="removeToast(t.id)">
        <FrostedGlass :corner-radius="14" variant="hint" :ambient-color="'#D4AF37'" />
        <span class="gt-toast-icon gt-toast-icon--vip">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L10 5.5L15 6L11.5 9.5L12.5 15L8 12L3.5 15L4.5 9.5L1 6L6 5.5L8 1Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </span>
        <span class="gt-toast-msg">{{ t.message }}</span>
      </div>
    </Transition>
  </div>

  <!-- Confirm 对话框 -->
  <Transition :css="false" @enter="modalTransition.onEnter" @leave="modalTransition.onLeave">
    <div v-if="confirmVisible" class="gt-confirm-overlay" @click.self="onConfirmResolve(false)">
      <div class="gt-confirm-dialog modal-content">
        <FrostedGlass :corner-radius="20" variant="primary" />
        <div class="gt-confirm-inner">
          <h3 v-if="confirmConfig.title" class="gt-confirm-title">{{ confirmConfig.title }}</h3>
          <p class="gt-confirm-msg">{{ confirmConfig.message }}</p>
          <div class="gt-confirm-actions">
            <button class="btn-glass" @click="onConfirmResolve(false)">
              {{ confirmConfig.cancelText || '取消' }}
            </button>
            <button
              class="btn-glass"
              :class="{ 'btn-glass--danger': confirmConfig.danger, 'btn-glass--accent': !confirmConfig.danger }"
              @click="onConfirmResolve(true)"
            >
              {{ confirmConfig.confirmText || '确定' }}
            </button>
          </div>
        </div>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import FrostedGlass from './FrostedGlass.vue'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useToastTransition, useModalTransition } from '@/composables/useGsapTransition'
import { useSfx } from '@/composables/useSfx'

const {
  bottomToasts,
  topToasts,
  removeToast,
  confirmVisible,
  confirmConfig,
  _resolveConfirm,
} = useGlobalToast()

const toastTransition = useToastTransition()
const modalTransition = useModalTransition()
const sfx = useSfx()

// Confirm dialog open/close SFX
watch(confirmVisible, (visible) => {
  if (visible) sfx.airBloom()
  else sfx.retract()
})

// Confirm dialog action SFX
function onConfirmResolve(value: boolean) {
  if (value) sfx.confirm()
  else sfx.retract()
  _resolveConfirm(value)
}
</script>

<style lang="scss" scoped>
// == Toast 容器 ==

.gt-container {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast, 500);
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

// 普通 Toast: 中部偏下
.gt-container--bottom {
  bottom: calc(var(--player-bar-height, 0px) + 12vh);
}

// VIP Toast: 中部偏上
.gt-container--top {
  top: 22vh;
  flex-direction: column; // VIP 从上往下堆叠
}

// == Toast 单元 ==

.gt-toast {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 14px;
  overflow: hidden;
  font-size: var(--text-small);
  white-space: nowrap;
  max-width: 480px;
  cursor: pointer;
  pointer-events: auto;

  // 文字颜色按紧迫性区分
  // info / success → 白色
  // warning / error → 红色
  // vip → 金色
  &--info,
  &--success {
    .gt-toast-msg { color: rgba(255, 255, 255, 0.92); }
    .gt-toast-icon { color: rgba(255, 255, 255, 0.7); }
  }

  &--warning,
  &--error {
    .gt-toast-msg { color: rgba(248, 113, 113, 0.95); }
    .gt-toast-icon { color: rgba(248, 113, 113, 0.8); }
  }

  &--vip {
    .gt-toast-msg {
      color: rgba(212, 175, 55, 0.95);
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    .gt-toast-icon { color: rgba(212, 175, 55, 0.85); }
  }
}

.gt-toast-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.gt-toast-msg {
  position: relative;
  z-index: 1;
  line-height: 1.4;
  white-space: normal;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

// == Confirm 对话框 ==

.gt-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal, 400) + 100);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.gt-confirm-dialog {
  position: relative;
  width: min(400px, 90vw);
  border-radius: 20px;
  overflow: hidden;
}

.gt-confirm-inner {
  position: relative;
  z-index: 1;
  padding: 28px 24px 20px;
}

.gt-confirm-title {
  font-family: var(--font-display);
  font-size: var(--text-h3);
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.gt-confirm-msg {
  font-size: var(--text-body);
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 24px;
  white-space: pre-line;
}

.gt-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;

  .btn-glass {
    padding: 8px 20px;
    font-size: var(--text-small);
  }
}

// == Danger 确认按钮变体 ==

.btn-glass--danger {
  background:
    linear-gradient(135deg, rgba(239, 68, 68, 0.25), transparent 60%),
    var(--glass-bg);
  border: 1px solid rgba(239, 68, 68, 0.30);

  &:hover {
    background:
      linear-gradient(135deg, rgba(239, 68, 68, 0.35), transparent 60%),
      var(--glass-bg-hover);
    border-color: rgba(239, 68, 68, 0.45);
  }
}
</style>
