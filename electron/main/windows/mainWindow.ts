import { BrowserWindow, screen, app } from 'electron'
import { join } from 'path'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export function createMainWindow(windowState?: WindowState): BrowserWindow {
  const defaults = {
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    isMaximized: false
  }

  const state = { ...defaults, ...windowState }

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    minWidth: state.minWidth,
    minHeight: state.minHeight,
    x: state.x,
    y: state.y,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,
    show: false,
    icon: join(__dirname, '../../resources/icons/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../../dist-electron/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (state.isMaximized) {
    win.maximize()
  }

  win.once('ready-to-show', () => {
    win.show()
  })

  // Remove the redundant window:saveState IPC — index.ts already handles
  // saving window state on close via SettingsService.saveWindowState().
  // The old IPC message was never handled by the renderer, causing
  // unnecessary IPC overhead and potential DB-not-initialized crashes
  // when the close event fires after the database has been closed.

  // Handle GPU process crashes gracefully — Electron auto-restarts the
  // GPU process, but we should reload the page if it crashes repeatedly.
  let gpuCrashCount = 0
  app.on('gpu-process-crashed', (_event, details) => {
    gpuCrashCount++
    console.error(`[GPU] Process crashed (count: ${gpuCrashCount}):`, details)
    if (gpuCrashCount <= 3 && !win.isDestroyed()) {
      // Give the GPU process time to restart before reloading
      setTimeout(() => {
        if (!win.isDestroyed()) win.reload()
      }, 500)
    } else {
      console.error('[GPU] Too many crashes, disabling hardware acceleration')
      app.disableHardwareAcceleration()
    }
  })

  return win
}
