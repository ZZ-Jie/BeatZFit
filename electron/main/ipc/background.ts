import { ipcMain, dialog, app } from 'electron'
import { existsSync, mkdirSync, copyFileSync, statSync, unlinkSync } from 'fs'
import { join, extname, basename } from 'path'
import sharp from 'sharp'
import { SettingsService } from '../services/settingsService'

const ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const HISTORY_DIR = 'backgrounds/history'
const CURRENT_BG = 'backgrounds/current-bg.webp'
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

async function compressImage(inputPath: string, outputPath: string) {
  // 第一轮：限制最大边长并转 WebP quality 85
  let quality = 85
  let pipeline = sharp(inputPath).rotate() // 保留 EXIF 方向
  const metadata = await pipeline.clone().metadata()
  const maxDimension = 2560

  if (metadata.width && metadata.height && (metadata.width > maxDimension || metadata.height > maxDimension)) {
    pipeline = pipeline.resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
  }

  await pipeline.webp({ quality, effort: 4 }).toFile(outputPath)

  // 若仍超限，逐步降低质量直到 70%（视觉可接受下限）
  while (statSync(outputPath).size > MAX_SIZE && quality > 70) {
    quality -= 5
    await sharp(inputPath)
      .rotate()
      .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toFile(outputPath)
  }

  if (statSync(outputPath).size > MAX_SIZE) {
    throw new Error('图片无法压缩到 5MB 以内')
  }
}

async function createThumbnail(imagePath: string, outputPath: string) {
  await sharp(imagePath)
    .resize(200, 200, { fit: 'cover' })
    .webp({ quality: 70 })
    .toFile(outputPath)
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
      const historyPath = join(historyDir, `${id}.webp`)
      const thumbPath = join(historyDir, `${id}-thumb.webp`)

      const stats = statSync(sourcePath)
      if (stats.size > MAX_SIZE) {
        await compressImage(sourcePath, historyPath)
      } else {
        // 小图也统一转 WebP，避免格式混乱
        await sharp(sourcePath).rotate().webp({ quality: 90, effort: 4 }).toFile(historyPath)
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
