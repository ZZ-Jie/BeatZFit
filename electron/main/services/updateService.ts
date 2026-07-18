import { app, BrowserWindow } from 'electron'
import { autoUpdater, UpdateInfo } from 'electron-updater'

const log = {
  info: (...args: any[]) => console.log('[UpdateService]', ...args),
  error: (...args: any[]) => console.error('[UpdateService]', ...args),
  warn: (...args: any[]) => console.warn('[UpdateService]', ...args),
}

let mainWindow: BrowserWindow | null = null
let initialized = false

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

let currentStatus: UpdateStatus = 'idle'
let updateInfo: UpdateInfo | null = null
let downloadProgress = 0

function setStatus(status: UpdateStatus) {
  currentStatus = status
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:statusChanged', {
      status,
      info: updateInfo ? { version: updateInfo.version, releaseDate: updateInfo.releaseDate, releaseNotes: updateInfo.releaseNotes } : null,
      progress: downloadProgress,
    })
  }
}

/**
 * Initialize the auto-updater. Only runs in production (packaged app).
 * In development, electron-updater cannot find app-update.yml.
 */
export function initUpdater(window: BrowserWindow): void {
  if (initialized) return
  if (!app.isPackaged) {
    log?.info('Skipping updater init in development mode')
    return
  }

  initialized = true
  mainWindow = window

  // Configure autoUpdater
  autoUpdater.autoDownload = true // Auto-download when update is available
  autoUpdater.autoInstallOnAppQuit = true // Install on quit if downloaded
  // Allow downgrade (in case user installed a newer version manually)
  autoUpdater.allowDowngrade = true

  // ── Event handlers ──

  autoUpdater.on('checking-for-update', () => {
    log?.info('Checking for update...')
    setStatus('checking')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log?.info(`Update available: v${info.version}`)
    updateInfo = info
    setStatus('available')
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    log?.info('Update not available — already up to date')
    updateInfo = info
    setStatus('not-available')
  })

  autoUpdater.on('download-progress', (progress: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => {
    downloadProgress = Math.round(progress.percent)
    if (currentStatus !== 'downloading') {
      currentStatus = 'downloading'
    }
    // Send progress updates (throttled by electron's IPC batching)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:downloadProgress', downloadProgress)
    }
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log?.info(`Update downloaded: v${info.version}`)
    updateInfo = info
    downloadProgress = 100
    setStatus('downloaded')
  })

  autoUpdater.on('error', (err: Error) => {
    log?.error('Updater error:', err.message)
    setStatus('error')
  })

  // Start checking after a short delay (let the app settle)
  setTimeout(() => {
    checkForUpdates()
  }, 3000)

  // Check periodically (every 30 minutes)
  setInterval(() => {
    checkForUpdates()
  }, 30 * 60 * 1000)
}

/**
 * Manually trigger an update check.
 */
export async function checkForUpdates(): Promise<{ success: boolean; status: UpdateStatus }> {
  if (!app.isPackaged) {
    return { success: false, status: 'idle' }
  }
  try {
    await autoUpdater.checkForUpdates()
    return { success: true, status: currentStatus }
  } catch (err) {
    log?.error('checkForUpdates failed:', (err as Error).message)
    return { success: false, status: 'error' }
  }
}

/**
 * Start downloading the update manually (if auto-download was disabled).
 */
export async function downloadUpdate(): Promise<{ success: boolean }> {
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (err) {
    log?.error('downloadUpdate failed:', (err as Error).message)
    return { success: false }
  }
}

/**
 * Quit the app and install the downloaded update.
 */
export function installUpdate(): void {
  try {
    autoUpdater.quitAndInstall(false, true)
  } catch (err) {
    log?.error('installUpdate failed:', (err as Error).message)
  }
}

/**
 * Get the current update status.
 */
export function getUpdateStatus(): {
  status: UpdateStatus
  version: string | null
  progress: number
} {
  return {
    status: currentStatus,
    version: updateInfo?.version ?? null,
    progress: downloadProgress,
  }
}
