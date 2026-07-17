import { BrowserWindow, ipcMain } from 'electron'

export function registerWindowIPC(mainWindow: BrowserWindow) {
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize()
    return { success: true }
  })

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    return { success: true, isMaximized: mainWindow.isMaximized() }
  })

  ipcMain.handle('window:close', () => {
    mainWindow.close()
    return { success: true }
  })

  ipcMain.handle('window:isMaximized', () => {
    return { success: true, isMaximized: mainWindow.isMaximized() }
  })

  // ===== Fullscreen =====
  // Toggles OS-level fullscreen. Combined with CSS body.is-fullscreen
  // to remove border-radius so the window fills all four corners.
  ipcMain.handle('window:toggleFullScreen', () => {
    const isFullScreen = !mainWindow.isFullScreen()
    mainWindow.setFullScreen(isFullScreen)
    return { success: true, isFullScreen }
  })

  ipcMain.handle('window:isFullScreen', () => {
    return { success: true, isFullScreen: mainWindow.isFullScreen() }
  })

  // ===== Window Bounds =====
  // Used by the PlayerBar immersive-fullscreen to save the user's
  // custom window size before entering fullscreen and restore it
  // exactly when exiting — Electron's setFullScreen(false) returns
  // to the pre-fullscreen state, but if the window was maximised
  // before fullscreen it would unmaximise to the last windowed
  // bounds, not necessarily the user's intended size.
  ipcMain.handle('window:getBounds', () => {
    const bounds = mainWindow.getBounds()
    return { success: true, bounds }
  })

  ipcMain.handle('window:setBounds', (_event, bounds: { x?: number; y?: number; width: number; height: number }) => {
    mainWindow.setBounds(bounds)
    return { success: true }
  })

  ipcMain.handle('window:unmaximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    }
    return { success: true }
  })

  // Forward native fullscreen events to the renderer so it can
  // toggle the body.is-fullscreen class for corner-radius adjustment.
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreenChange', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreenChange', false)
  })

  // Forward maximize/unmaximize events so the renderer can adjust
  // corner radius (maximised windows on Windows fill the work-area
  // and look better with square corners).
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizeChange', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizeChange', false)
  })
}
