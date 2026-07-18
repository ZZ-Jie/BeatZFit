import { ipcMain, dialog, app, nativeImage } from 'electron'
import { existsSync, mkdirSync, copyFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join, extname, basename } from 'path'
import { SettingsService } from '../services/settingsService'

const ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const HISTORY_DIR = 'backgrounds/history'
const CURRENT_BG = 'backgrounds/current-bg.jpg'
const SETTINGS_KEY_MODE = 'background.mode'
const SETTINGS_KEY_PATH = 'background.imagePath'
const SETTINGS_KEY_CURRENT_ID = 'background.currentId'
const SETTINGS_KEY_HISTORY = 'background.history'

interface HistoryItem {
  id: string
  path: string
  thumbnailPath: string
  originalName: string
  timestamp: number
  size: number
}

function getUserDataPath(...segments: string[]) {
  return join(app.getPath('userData'), ...segments)
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readHistory(): HistoryItem[] {
  const service = new SettingsService()
  try {
    const raw = service.get(SETTINGS_KEY_HISTORY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(history: HistoryItem[]) {
  const service = new SettingsService()
  service.set(SETTINGS_KEY_HISTORY, JSON.stringify(history.slice(-20))) // 最多保留 20 条
}

/**
 * 用 Electron 内置 nativeImage 处理图片：限制最大边长并输出 JPEG buffer
 * 替代 sharp，无需打包 libvips 原生库（节省 ~18MB）
 */
function imageToJPEG(inputPath: string, quality: number, maxDimension = 2560): Buffer {
  const img = nativeImage.createFromPath(inputPath)
  if (img.isEmpty()) throw new Error('无法读取图片文件')

  const { width, height } = img.getSize()
  let resized = img
  if (width > maxDimension || height > maxDimension) {
    const scale = Math.min(maxDimension / width, maxDimension / height)
    resized = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
  }

  return resized.toJPEG(quality)
}

async function compressImage(inputPath: string, outputPath: string) {
  let quality = 85
  const maxDimension = 2560

  let buffer = imageToJPEG(inputPath, quality, maxDimension)

  // 若仍超限，逐步降低质量直到 70%（视觉可接受下限）
  while (buffer.length > MAX_SIZE && quality > 70) {
    quality -= 5
    buffer = imageToJPEG(inputPath, quality, maxDimension)
  }

  if (buffer.length > MAX_SIZE) {
    throw new Error('图片无法压缩到 5MB 以内')
  }

  writeFileSync(outputPath, buffer)
}

async function createThumbnail(imagePath: string, outputPath: string) {
  const img = nativeImage.createFromPath(imagePath)
  if (img.isEmpty()) throw new Error('无法读取缩略图源图')

  const { width, height } = img.getSize()
  // 缩放到 200px 短边，保持宽高比
  const scale = Math.min(200 / width, 200 / height)
  const resized = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
  writeFileSync(outputPath, resized.toJPEG(70))
}

function resetCurrentBackground(service: InstanceType<typeof SettingsService>) {
  service.set(SETTINGS_KEY_MODE, 'visualizer')
  service.set(SETTINGS_KEY_PATH, '')
  service.set(SETTINGS_KEY_CURRENT_ID, '')
  try {
    const currentPath = getUserDataPath(CURRENT_BG)
    if (existsSync(currentPath)) {
      unlinkSync(currentPath)
    }
  } catch {}
}

export function registerBackgroundIPC() {
  ipcMain.handle('background:pickImage', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '未选择图片' }
      }

      const sourcePath = result.filePaths[0]
      const ext = extname(sourcePath).toLowerCase()

      if (!ALLOWED_EXTS.includes(ext)) {
        return { success: false, error: '仅支持 JPG、PNG、WEBP、BMP、GIF 格式' }
      }

      const originalName = basename(sourcePath)
      const historyDir = getUserDataPath(HISTORY_DIR)
      ensureDir(historyDir)

      const id = Date.now().toString()
      const historyPath = join(historyDir, `${id}.jpg`)
      const thumbPath = join(historyDir, `${id}-thumb.jpg`)

      const stats = statSync(sourcePath)
      if (stats.size > MAX_SIZE) {
        await compressImage(sourcePath, historyPath)
      } else {
        // 小图也统一转 JPEG，避免格式混乱
        writeFileSync(historyPath, imageToJPEG(sourcePath, 90))
      }

      await createThumbnail(historyPath, thumbPath)
      const compressedSize = statSync(historyPath).size

      const item: HistoryItem = {
        id,
        path: historyPath,
        thumbnailPath: thumbPath,
        originalName,
        timestamp: Date.now(),
        size: compressedSize
      }

      const history = readHistory()
      history.push(item)
      saveHistory(history)

      return {
        success: true,
        data: {
          item,
          compressed: stats.size > MAX_SIZE || stats.size !== compressedSize
        }
      }
    } catch (e: any) {
      return { success: false, error: e.message || '选择图片失败' }
    }
  })

  ipcMain.handle('background:getHistory', async () => {
    try {
      const history = readHistory()
      // 清理已不存在的文件记录
      const valid = history.filter((h) => existsSync(h.path) && existsSync(h.thumbnailPath))
      if (valid.length !== history.length) {
        saveHistory(valid)
      }
      return { success: true, data: { history: valid } }
    } catch (e: any) {
      return { success: false, error: e.message || '读取历史记录失败' }
    }
  })

  ipcMain.handle('background:applyHistoryImage', async (_event, id: string) => {
    try {
      const history = readHistory()
      const item = history.find((h) => h.id === id)
      if (!item || !existsSync(item.path)) {
        return { success: false, error: '图片已不存在' }
      }

      const currentPath = getUserDataPath(CURRENT_BG)
      ensureDir(getUserDataPath('backgrounds'))
      copyFileSync(item.path, currentPath)

      const service = new SettingsService()
      service.set(SETTINGS_KEY_MODE, 'image')
      service.set(SETTINGS_KEY_PATH, currentPath)
      service.set(SETTINGS_KEY_CURRENT_ID, id)

      return { success: true, data: { path: currentPath } }
    } catch (e: any) {
      return { success: false, error: e.message || '应用背景失败' }
    }
  })

  ipcMain.handle('background:deleteHistoryItem', async (_event, id: string) => {
    try {
      const service = new SettingsService()
      const currentId = service.get(SETTINGS_KEY_CURRENT_ID) || ''

      let history = readHistory()
      const item = history.find((h) => h.id === id)
      if (!item) {
        return { success: false, error: '记录不存在' }
      }

      // 若该图片正被用作当前背景，彻底重置当前背景
      if (currentId === id) {
        resetCurrentBackground(service)
      }

      history = history.filter((h) => h.id !== id)
      saveHistory(history)

      try { if (existsSync(item.path)) unlinkSync(item.path) } catch {}
      try { if (existsSync(item.thumbnailPath)) unlinkSync(item.thumbnailPath) } catch {}

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message || '删除记录失败' }
    }
  })

  ipcMain.handle('background:reset', async () => {
    try {
      const service = new SettingsService()
      resetCurrentBackground(service)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message || '重置背景失败' }
    }
  })
}
