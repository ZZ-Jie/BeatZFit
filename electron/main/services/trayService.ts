import { Tray, Menu, BrowserWindow, app, nativeImage, MenuItemConstructorOptions } from 'electron'
import { join } from 'path'

/**
 * System Tray Service
 *
 * Creates a system tray icon with a context menu for quick playback control.
 * When the user closes the main window, the app minimizes to the tray
 * instead of quitting. Clicking the tray icon restores the window.
 *
 * The tray menu items send IPC events to the renderer for playback control,
 * matching the same channels used by global shortcuts.
 */
export class TrayService {
  private tray: Tray | null = null
  private mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  create() {
    // Use a simple 16x16 icon. If no icon file exists, Electron creates
    // a default empty tray icon which still works.
    // Load the app icon for the system tray.
    // On Windows, resize to 16x16 for the system tray area.
    let icon: Electron.NativeImage | undefined
    const iconPaths = [
      join(__dirname, '../../resources/icons/icon.png'),
      join(__dirname, '../../build/icon.png'),
    ]
    for (const p of iconPaths) {
      try {
        const raw = nativeImage.createFromPath(p)
        if (!raw.isEmpty()) {
          // Resize to 16x16 for the system tray (Windows standard)
          icon = raw.resize({ width: 16, height: 16 })
          break
        }
      } catch {
        // try next path
      }
    }

    // Fallback: create a minimal 16x16 transparent icon so the tray works
    if (!icon) {
      icon = nativeImage.createEmpty()
    }

    this.tray = new Tray(icon)
    this.tray.setToolTip('BeatZFit — 音乐驱动训练')

    this.updateMenu(false)
    this.tray.on('click', () => {
      this.showWindow()
    })

    // Intercept window close to minimize to tray
    this.mainWindow.on('close', (e) => {
      // Only intercept if user hasn't explicitly quit via tray
      if (!this.isQuitting) {
        e.preventDefault()
        this.mainWindow.hide()
        this.mainWindow.setSkipTaskbar(true)
      }
    })
  }

  private isQuitting = false

  /**
   * Update the tray context menu with current play state.
   * Called when playback state changes.
   */
  updateMenu(isPlaying: boolean) {
    if (!this.tray) return

    const menuTemplate: MenuItemConstructorOptions[] = [
      {
        label: '显示窗口',
        click: () => this.showWindow()
      },
      { type: 'separator' },
      {
        label: isPlaying ? '暂停' : '播放',
        click: () => this.mainWindow.webContents.send('media:togglePlay')
      },
      {
        label: '上一首',
        click: () => this.mainWindow.webContents.send('media:prevTrack')
      },
      {
        label: '下一首',
        click: () => this.mainWindow.webContents.send('media:nextTrack')
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          this.isQuitting = true
          app.quit()
        }
      }
    ]

    this.tray.setContextMenu(Menu.buildFromTemplate(menuTemplate))
  }

  private showWindow() {
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore()
    }
    this.mainWindow.show()
    this.mainWindow.setSkipTaskbar(false)
    this.mainWindow.focus()
  }

  destroy() {
    this.isQuitting = true
    this.tray?.destroy()
    this.tray = null
  }
}
