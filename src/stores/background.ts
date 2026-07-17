import { defineStore } from 'pinia'
import { ref, shallowRef, markRaw, computed } from 'vue'

export type BackgroundMode = 'visualizer' | 'image'

export interface HistoryItem {
  id: string
  path: string
  thumbnailPath: string
  originalName: string
  timestamp: number
  size: number
}

const SETTINGS_KEY_MODE = 'background.mode'
const SETTINGS_KEY_PATH = 'background.imagePath'
const SETTINGS_KEY_CURRENT_ID = 'background.currentId'

function getApi() {
  if (!window.electronAPI) {
    throw new Error('electronAPI 不可用')
  }
  return window.electronAPI
}

function toBeatUrl(path: string) {
  if (!path) return ''
  return `beat://${encodeURIComponent(path)}`
}

export const useBackgroundStore = defineStore('background', () => {
  // ===== State =====
  const mode = ref<BackgroundMode>('visualizer')
  const imagePath = ref('')
  const currentId = ref('')
  const error = ref('')
  const loaded = ref(false)
  const loading = ref(false)
  const status = ref('')

  // 待应用状态
  const pendingItem = ref<HistoryItem | null>(null)

  // 历史记录
  const history = shallowRef<HistoryItem[]>([])

  // 图片版本戳，每次应用/加载后递增，用于强制浏览器重新加载同一文件的背景图
  const imageVersion = ref(0)

  // ===== Getters =====
  const imageUrl = computed(() => {
    if (!imagePath.value) return ''
    return `beat://${encodeURIComponent(imagePath.value)}?v=${imageVersion.value}`
  })
  const pendingUrl = computed(() =>
    pendingItem.value ? toBeatUrl(pendingItem.value.path) : ''
  )
  const isCustom = computed(() => mode.value === 'image')
  const hasPending = computed(() => !!pendingItem.value)

  // ===== Actions =====
  async function loadSettings() {
    try {
      const res = await getApi().settings.get()
      if (res.success && res.data) {
        const s = res.data.settings || res.data
        mode.value = (s[SETTINGS_KEY_MODE] as BackgroundMode) || 'visualizer'
        imagePath.value = s[SETTINGS_KEY_PATH] || ''
        currentId.value = s[SETTINGS_KEY_CURRENT_ID] || ''
        if (imagePath.value) {
          imageVersion.value = Date.now()
        }
      }
      loaded.value = true
      error.value = ''
    } catch (e: any) {
      error.value = e.message || '加载背景设置失败'
      loaded.value = true
    }
  }

  async function setMode(value: BackgroundMode) {
    mode.value = value
    await getApi().settings.set(SETTINGS_KEY_MODE, value)
  }

  async function loadHistory() {
    try {
      const res = await getApi().background.getHistory()
      if (res.success && res.data) {
        history.value = markRaw(res.data.history || [])
      } else {
        error.value = res.error || '读取历史记录失败'
      }
    } catch (e: any) {
      error.value = e.message || '读取历史记录失败'
    }
  }

  async function pickImage() {
    error.value = ''
    status.value = '正在处理图片…'
    loading.value = true
    try {
      const res = await getApi().background.pickImage()
      if (!res.success) {
        error.value = res.error || '选择图片失败'
        pendingItem.value = null
        return false
      }
      if (res.data?.item) {
        pendingItem.value = res.data.item
        status.value = res.data.compressed ? '图片已压缩，点击应用生效' : '图片已就绪，点击应用生效'
        await loadHistory()
        return true
      }
      return false
    } catch (e: any) {
      error.value = e.message || '选择图片失败'
      return false
    } finally {
      loading.value = false
    }
  }

  async function applyPending() {
    if (!pendingItem.value) return false
    return applyHistoryItem(pendingItem.value.id)
  }

  async function applyHistoryItem(id: string) {
    error.value = ''
    status.value = '正在应用背景…'
    loading.value = true
    try {
      const res = await getApi().background.applyHistoryImage(id)
      if (!res.success) {
        error.value = res.error || '应用背景失败'
        return false
      }
      if (res.data?.path) {
        imagePath.value = res.data.path
        currentId.value = id
        mode.value = 'image'
        pendingItem.value = null
        imageVersion.value = Date.now()
        await getApi().settings.set(SETTINGS_KEY_CURRENT_ID, id)
        status.value = '背景已应用'
        return true
      }
      return false
    } catch (e: any) {
      error.value = e.message || '应用背景失败'
      return false
    } finally {
      loading.value = false
    }
  }

  async function cancelPending() {
    pendingItem.value = null
    status.value = ''
    error.value = ''
  }

  async function deleteHistoryItem(id: string) {
    error.value = ''
    try {
      const res = await getApi().background.deleteHistoryItem(id)
      if (!res.success) {
        error.value = res.error || '删除记录失败'
        return false
      }
      history.value = history.value.filter((h) => h.id !== id)
      if (currentId.value === id) {
        currentId.value = ''
        imagePath.value = ''
        mode.value = 'visualizer'
      }
      if (pendingItem.value?.id === id) {
        pendingItem.value = null
      }
      return true
    } catch (e: any) {
      error.value = e.message || '删除记录失败'
      return false
    }
  }

  async function reset() {
    error.value = ''
    status.value = '正在恢复默认背景…'
    try {
      const res = await getApi().background.reset()
      if (!res.success) {
        error.value = res.error || '恢复默认背景失败'
        return false
      }
      mode.value = 'visualizer'
      imagePath.value = ''
      currentId.value = ''
      pendingItem.value = null
      imageVersion.value = 0
      status.value = '已恢复默认背景'
      return true
    } catch (e: any) {
      error.value = e.message || '恢复默认背景失败'
      return false
    }
  }

  return {
    mode,
    imagePath,
    currentId,
    error,
    loaded,
    loading,
    status,
    pendingItem,
    history,
    imageUrl,
    pendingUrl,
    isCustom,
    hasPending,
    loadSettings,
    setMode,
    loadHistory,
    pickImage,
    applyPending,
    applyHistoryItem,
    cancelPending,
    deleteHistoryItem,
    reset
  }
})
