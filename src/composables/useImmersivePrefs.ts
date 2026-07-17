/**
 * useImmersivePrefs — 沉浸式开关状态管理
 *
 * 使用 localStorage 持久化 + CustomEvent 跨组件通信。
 * 与 ControlPanel 的其他 prefs (lyricPrefs, colorPrefs 等) 模式一致。
 *
 * 开关含义: true = 隐藏元素, false = 显示元素 (开启隐藏, 关闭显示)
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export interface ImmersivePrefs {
  /** 首页训练卡片 (含侧标签) */
  hideHomeFitness: boolean
  /** 首页歌单卡片 (含侧标签) */
  hideHomeMusic: boolean
  /** 首页搜索框 */
  hideHomeSearch: boolean
  /** 音乐库页 shelf-header */
  hideMusicShelfHeader: boolean
  /** 动作库页 shelf-header */
  hideFitnessShelfHeader: boolean
}

const STORAGE_KEY = 'beatzfit:immersivePrefs'
const EVENT_NAME = 'beatzfit:immersivePrefsChanged'

const DEFAULT_PREFS: ImmersivePrefs = {
  hideHomeFitness: false,
  hideHomeMusic: false,
  hideHomeSearch: false,
  hideMusicShelfHeader: false,
  hideFitnessShelfHeader: false,
}

function loadPrefs(): ImmersivePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_PREFS }
}

function savePrefs(prefs: ImmersivePrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

/**
 * 在组件中读取沉浸式 prefs 并监听变化。
 * 返回一个 ref，ControlPanel 修改时自动更新。
 */
export function useImmersivePrefs(): { prefs: Ref<ImmersivePrefs> } {
  const prefs = ref<ImmersivePrefs>(loadPrefs())

  function handler() {
    prefs.value = loadPrefs()
  }

  onMounted(() => {
    window.addEventListener(EVENT_NAME, handler)
  })

  onUnmounted(() => {
    window.removeEventListener(EVENT_NAME, handler)
  })

  return { prefs }
}

export { savePrefs, loadPrefs, STORAGE_KEY, EVENT_NAME }
