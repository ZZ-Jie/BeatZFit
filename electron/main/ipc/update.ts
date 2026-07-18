import { ipcMain } from 'electron'
import { checkForUpdates, downloadUpdate, installUpdate, getUpdateStatus } from '../services/updateService'

export function registerUpdateIPC(): void {
  // Check for updates manually
  ipcMain.handle('updater:checkForUpdates', async () => {
    return await checkForUpdates()
  })

  // Start download manually
  ipcMain.handle('updater:downloadUpdate', async () => {
    return await downloadUpdate()
  })

  // Quit and install
  ipcMain.handle('updater:installUpdate', () => {
    installUpdate()
    return { success: true }
  })

  // Get current status
  ipcMain.handle('updater:getStatus', () => {
    return { success: true, data: getUpdateStatus() }
  })
}
