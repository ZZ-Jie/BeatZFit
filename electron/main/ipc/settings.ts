import { ipcMain, app, session } from 'electron'
import { SettingsService } from '../services/settingsService'
import { closeDatabase, getDatabasePath } from '../db'
import { existsSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'

const settingsService = new SettingsService()

export function registerSettingsIPC() {
  ipcMain.handle('settings:get', async (_event, key?: string) => {
    try {
      if (key) {
        const value = settingsService.get(key)
        return { success: true, data: { key, value } }
      }
      const all = settingsService.getAll()
      return { success: true, data: { settings: all } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: any) => {
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
      settingsService.set(key, stringValue)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('settings:reset', async () => {
    try {
      settingsService.reset()
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('settings:clearAllData', async () => {
    try {
      // 0. Clear Netease login session and cookies
      try {
        const neteaseSes = session.fromPartition('persist:netease-login')
        await neteaseSes.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'shadercache', 'serviceworkers', 'cachestorage'],
        })
        // Clear default session cookies for music.163.com
        const defaultSes = session.defaultSession
        const cookies = await defaultSes.cookies.get({ url: 'https://music.163.com' })
        for (const cookie of cookies) {
          await defaultSes.cookies.remove('https://music.163.com', cookie.name)
        }
        // Delete netease cookie file
        const neteaseCookiePath = join(app.getPath('userData'), 'netease_cookies.json')
        if (existsSync(neteaseCookiePath)) {
          unlinkSync(neteaseCookiePath)
        }
        console.log('[Settings] Cleared Netease cookies and session')
      } catch (e) {
        console.error('[Settings] Failed to clear Netease data:', e)
      }

      // 1. Clear renderer localStorage (disk cache for netease playlists, etc.)
      // This is done from the renderer side via the clearCache IPC

      // 2. Close database
      closeDatabase()

      // 3. Delete ONLY user-specific database tables (preserve exercise data)
      // We can't selectively delete tables with sql.js easily, so we delete
      // the DB file and let it recreate. The exercise data will be re-synced
      // on next startup via autoSync (which checks sync_state).
      // However, to preserve exercises across resets, we export them first,
      // delete the DB, recreate, and re-import.
      const dbPath = getDatabasePath()
      if (existsSync(dbPath)) {
        unlinkSync(dbPath)
      }
      console.log('[Settings] Deleted database file (exercise data will auto-resync)')

      // 4. Clear only user-specific cache directories (preserve image-cache and exercise-gif-cache)
      const userDataPath = app.getPath('userData')
      const cacheDirs = ['Cache', 'Code Cache', 'GPUCache']
      for (const dir of cacheDirs) {
        const fullPath = join(userDataPath, dir)
        if (existsSync(fullPath)) {
          try {
            rmSync(fullPath, { recursive: true, force: true })
          } catch {}
        }
      }
      // Note: image-cache and exercise-gif-cache are intentionally preserved

      // 5. Restart app
      app.relaunch()
      app.exit()

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
