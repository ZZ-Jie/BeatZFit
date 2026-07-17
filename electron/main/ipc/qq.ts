import { ipcMain } from 'electron'
import { QqService } from '../services/qqService'

const qqService = new QqService()

export function registerQqIPC() {
  // Login
  ipcMain.handle('qq:openLogin', async () => {
    try {
      const result = await qqService.openLogin()
      return { success: result.success }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Check login status — returns isLoggedIn even if getUserInfo fails
  ipcMain.handle('qq:getLoginStatus', async () => {
    try {
      const isLoggedIn = qqService.isLoggedIn()
      if (!isLoggedIn) {
        return { success: true, data: { isLoggedIn: false, userInfo: null } }
      }
      // Try to get user info, but don't fail the whole call if it errors
      let userInfo = null
      try {
        userInfo = await qqService.getUserInfo()
      } catch (e) {
        console.error('[QQ IPC] getUserInfo error (non-fatal):', e)
      }
      return { success: true, data: { isLoggedIn: true, userInfo } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Get user playlists — returns empty array on error
  ipcMain.handle('qq:getUserPlaylists', async () => {
    try {
      const playlists = await qqService.getUserPlaylists()
      return { success: true, data: { playlists } }
    } catch (e: any) {
      console.error('[QQ IPC] getUserPlaylists error:', e)
      return { success: true, data: { playlists: [] } }
    }
  })

  // Get playlist detail with tracks
  ipcMain.handle('qq:getPlaylistDetail', async (_event, id: string) => {
    try {
      const detail = await qqService.getPlaylistDetail(id)
      return { success: true, data: { tracks: detail.tracks } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Get song playable URL (supports optional quality + isVip flag for fast-path)
  ipcMain.handle('qq:getSongUrl', async (_event, songmid: string, quality?: string, strMediaMid?: string, isVip?: boolean) => {
    try {
      const url = await qqService.getSongUrl(songmid, quality, strMediaMid, isVip)
      return { success: true, data: { url } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Get lyric
  ipcMain.handle('qq:getLyric', async (_event, songmid: string) => {
    try {
      const lyric = await qqService.getLyric(songmid)
      return { success: true, data: { lyric } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Search
  ipcMain.handle('qq:search', async (_event, keywords: string, limit?: number) => {
    try {
      const songs = await qqService.search(keywords, limit)
      return { success: true, data: { songs } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Logout — clears all cookies and session data
  ipcMain.handle('qq:logout', async () => {
    try {
      await qqService.logout()
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
