/**
 * 全局 Toast/Confirm 系统
 *
 * 提供 module-level singleton 状态，任何组件都能调用。
 *
 * 统一 Toast 设计规范：
 *   - 所有 Toast 使用液态玻璃材质（FrostedGlass hint variant），高级黑白灰底色
 *   - 位置：普通 Toast 在屏幕中部偏下；VIP Toast 在中部偏上
 *   - 文字颜色区分紧迫性：
 *     info / success → 白色文字
 *     warning / error → 红色文字
 *     vip             → 金色文字
 *
 * 用法:
 *   const toast = useGlobalToast()
 *   toast.success('已添加到歌单「我的收藏」')
 *   toast.info('正在同步...')
 *   toast.warning('删除不可恢复')
 *   toast.error('导入失败：文件格式不支持')
 *   toast.vip('VIP 专属功能已解锁')
 *
 *   const ok = await toast.confirm({
 *     title: '确认清空',
 *     message: '确定要清空音乐库吗？此操作不可恢复。',
 *     confirmText: '清空',
 *     danger: true,
 *   })
 *   if (!ok) return
 */

import { ref, readonly, computed } from 'vue'

// ── Toast 类型 ──────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'vip'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
}

// ── Confirm 配置 ────────────────────────────────────────────

export interface ConfirmConfig {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

// ── Module-level singleton state ────────────────────────────

const _toasts = ref<ToastItem[]>([])
let _toastIdCounter = 0

// Track which page hints have already been shown (app-lifetime, not persisted)
const _shownOnceKeys = new Set<string>()

const _confirmVisible = ref(false)
const _confirmConfig = ref<ConfirmConfig>({ message: '' })
let _confirmResolve: ((value: boolean) => void) | null = null

// ── Toast API ───────────────────────────────────────────────

function _pushToast(type: ToastType, message: string, duration = 3000) {
  const id = ++_toastIdCounter
  _toasts.value.push({ id, type, message, duration })
  // 自动移除
  setTimeout(() => removeToast(id), duration)
}

function removeToast(id: number) {
  const idx = _toasts.value.findIndex(t => t.id === id)
  if (idx >= 0) _toasts.value.splice(idx, 1)
}

function success(message: string, duration?: number) {
  _pushToast('success', message, duration)
}

function error(message: string, duration?: number) {
  _pushToast('error', message, duration ?? 4000)
}

function info(message: string, duration?: number) {
  _pushToast('info', message, duration)
}

function warning(message: string, duration?: number) {
  _pushToast('warning', message, duration ?? 4000)
}

function vip(message: string, duration?: number) {
  _pushToast('vip', message, duration ?? 4000)
}

/**
 * Show a toast only once per app session for the given key.
 * If the key has already been used, the toast is silently skipped.
 * Useful for page-enter hints that should not repeat on re-visits.
 */
function showOnce(key: string, type: ToastType, message: string, duration?: number) {
  if (_shownOnceKeys.has(key)) return
  _shownOnceKeys.add(key)
  _pushToast(type, message, duration)
}

// ── Confirm API ─────────────────────────────────────────────

function confirm(config: ConfirmConfig): Promise<boolean> {
  // 如果已有 confirm 对话框打开，先关闭它（返回 false）
  if (_confirmResolve) {
    _confirmResolve(false)
    _confirmResolve = null
  }
  _confirmConfig.value = config
  _confirmVisible.value = true
  return new Promise<boolean>((resolve) => {
    _confirmResolve = resolve
  })
}

function _resolveConfirm(value: boolean) {
  _confirmVisible.value = false
  if (_confirmResolve) {
    _confirmResolve(value)
    _confirmResolve = null
  }
}

// ── Composable ──────────────────────────────────────────────

export function useGlobalToast() {
  return {
    // Toast 状态 (只读)
    toasts: readonly(_toasts),
    // 按位置分组 (computed)
    bottomToasts: computed(() => _toasts.value.filter(t => t.type !== 'vip')),
    topToasts: computed(() => _toasts.value.filter(t => t.type === 'vip')),
    removeToast,
    // Toast 方法
    success,
    error,
    info,
    warning,
    vip,
    showOnce,
    // Confirm 状态 (只读)
    confirmVisible: readonly(_confirmVisible),
    confirmConfig: readonly(_confirmConfig),
    // Confirm 方法
    confirm,
    _resolveConfirm, // 仅供 GlobalToast 组件内部使用
  }
}
