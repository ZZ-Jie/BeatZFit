import { app, BrowserWindow, protocol } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { initDatabase, closeDatabase } from './db'
import { registerMusicIPC } from './ipc/music'
import { registerFitnessIPC } from './ipc/fitness'
import { registerSettingsIPC } from './ipc/settings'
import { registerWindowIPC } from './ipc/window'
import { registerNeteaseIPC } from './ipc/netease'
import { registerQqIPC } from './ipc/qq'
import { registerBackgroundIPC } from './ipc/background'
import { registerPlaylistIPC } from './ipc/playlist'
import { registerLyricsIPC } from './ipc/lyrics'
import { registerUpdateIPC } from './ipc/update'
import { registerDesktopLyricIPC, createDesktopLyricWindow, setMainWindow } from './windows/desktopLyricWindow'
import { createMainWindow } from './windows/mainWindow'
import { SettingsService } from './services/settingsService'
import { initUpdater } from './services/updateService'
import { GlobalShortcutService } from './services/globalShortcutService'
import { TrayService } from './services/trayService'

// ── Redirect app data to <install_dir>/Data in production ──────────────
// Prevents C: drive pollution: all databases, caches, cookies, covers,
// lyrics, etc. are stored in the install directory's Data subfolder.
// The NSIS installer defaults to D:\BeatZFit, so data goes to D:\BeatZFit\Data.
if (app.isPackaged) {
  const installDir = dirname(process.execPath)
  const dataDir = join(installDir, 'Data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  app.setPath('userData', dataDir)
}

// Register the custom `beat://` protocol as privileged BEFORE app ready.
// Note: we deliberately do NOT set `standard: true` because that would make
// Chromium parse the part after `://` as a hostname, mangling Windows paths
// like C:\Users\... We need stream + supportFetchAPI for Howler's <audio>
// element to perform range requests (seeking / streaming).
protocol.registerSchemesAsPrivileged([
{
scheme: 'beat',
privileges: {
secure: true,
supportFetchAPI: true,
stream: true,
bypassCSP: true,
corsEnabled: true
}
}
])

let mainWindow: BrowserWindow | null = null
let settings: SettingsService | null = null
let globalShortcutService: GlobalShortcutService | null = null
let trayService: TrayService | null = null

async function bootstrap() {
  await initDatabase()

  settings = new SettingsService()
  const windowState = settings.getWindowState()

  mainWindow = createMainWindow(windowState)

// Give the desktop lyric module a reference to the main window so it
// can notify the renderer when visibility changes (e.g. close button).
setMainWindow(mainWindow!)

  // Save window state on close (guarded against DB already closed)
  if (mainWindow) {
    mainWindow.on('close', () => {
      // Tray service intercepts close to minimize-to-tray.
      // The tray's close handler calls e.preventDefault() before this
      // callback, so if we get here it means the user is actually quitting.
      try {
        if (mainWindow && settings) {
          const bounds = mainWindow.getBounds()
          settings.saveWindowState({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized: mainWindow.isMaximized()
          })
        }
      } catch {
        // Database may have already been closed by before-quit
      }
    })
  }

  registerWindowIPC(mainWindow!)
  registerMusicIPC()
  registerFitnessIPC()
  registerSettingsIPC()
  registerNeteaseIPC()
  registerQqIPC()
  registerBackgroundIPC()
  registerPlaylistIPC()
  registerLyricsIPC()
  registerUpdateIPC()
  registerDesktopLyricIPC()

  // Pre-create the desktop lyric window (hidden) so it's ready when toggled
  createDesktopLyricWindow()

  // Initialize global media shortcuts (system-wide hotkeys)
  globalShortcutService = new GlobalShortcutService(mainWindow!)
  globalShortcutService.registerAll()

  // Initialize system tray
  trayService = new TrayService(mainWindow!)
  trayService.create()

  // Listen for playback state changes from renderer to update tray menu
  mainWindow!.webContents.on('ipc-message', (_event, channel, ...args) => {
    if (channel === 'tray:updatePlayState' && trayService) {
      trayService.updateMenu(args[0] === true)
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
    // Initialize auto-updater (only runs in production/packaged)
    initUpdater(mainWindow!)
  }
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  // When using tray, window-all-closed shouldn't quit the app.
  // The user quits via the tray menu's "退出" option.
  if (process.platform !== 'darwin') {
    // Don't quit — keep running in tray
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap()
  }
})

// Save window state and clean up BEFORE closing the database.
// Order: before-quit → window close event (saves state) → will-quit (closes DB)
app.on('before-quit', () => {
  globalShortcutService?.unregisterAll()
  trayService?.destroy()
})

app.on('will-quit', () => {
  closeDatabase()
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
})
