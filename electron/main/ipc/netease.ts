import { ipcMain } from 'electron'
import { NeteaseService } from '../services/neteaseService'

const neteaseService = new NeteaseService()

export function registerNeteaseIPC() {
  // Login
  ipcMain.handle('netease:openLogin', async () => {
    try {
      const result = await neteaseService.openLogin()
      return { success: result.success }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Check login status — returns isLoggedIn even if getUserInfo fails
  ipcMain.handle('netease:getLoginStatus', async () => {
    try {
      const isLoggedIn = neteaseService.isLoggedIn()
      if (!isLoggedIn) {
        return { success: true, data: { isLoggedIn: false, userInfo: null } }
      }
      // Try to get user info, but don't fail the whole call if it errors
      let userInfo = null
      try {
        userInfo = await neteaseService.getUserInfo()
      } catch (e) {
        console.error('[Netease IPC] getUserInfo error (non-fatal):', e)
      }
      return { success: true, data: { isLoggedIn: true, userInfo } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Get user playlists — accepts uid, returns empty array on error
  ipcMain.handle('netease:getUserPlaylists', async (_event, uid: number) => {
    try {
      const playlists = await neteaseService.getUserPlaylists(uid)
      return { success: true, data: { playlists } }
    } catch (e: any) {
      console.error('[Netease IPC] getUserPlaylists error:', e)
      return { success: true, data: { playlists: [] } }
    }
  })

// Get playlist detail with tracks (optional limit for fast initial load)
ipcMain.handle('netease:getPlaylistDetail', async (_event, id: number, limit?: number) => {
try {
const detail = await neteaseService.getPlaylistDetail(id, limit)
return { success: true, data: { tracks: detail.tracks } }
} catch (e: any) {
return { success: false, error: e.message }
}
})

  // Get song playable URL (supports optional quality level)
  ipcMain.handle('netease:getSongUrl', async (_event, songId: number, level?: string) => {
    try {
      const url = await neteaseService.getSongUrl(songId, level)
      return { success: true, data: { url } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Get lyric
  ipcMain.handle('netease:getLyric', async (_event, songId: number) => {
    try {
      const lyric = await neteaseService.getLyric(songId)
      return { success: true, data: { lyric } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Search
  ipcMain.handle('netease:search', async (_event, keywords: string, limit?: number) => {
    try {
      const songs = await neteaseService.search(keywords, limit)
      return { success: true, data: { songs } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Like a song (add to "我喜欢的音乐")
  ipcMain.handle('netease:like', async (_event, songId: number, like?: boolean) => {
    try {
      const success = await neteaseService.likeSong(songId, like ?? true)
      return { success }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Add track to a specific playlist
  ipcMain.handle('netease:addToPlaylist', async (_event, trackId: number, playlistId: number) => {
    try {
      return await neteaseService.addToPlaylist(trackId, playlistId)
    } catch (e: any) {
      return { success: false, message: e.message }
    }
  })

  // Search playlists (type=1000)
  ipcMain.handle('netease:searchPlaylists', async (_event, keywords: string, limit?: number) => {
    try {
      const playlists = await neteaseService.searchPlaylists(keywords, limit)
      return { success: true, data: { playlists } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Subscribe / unsubscribe a playlist (收藏/取消收藏歌单)
  ipcMain.handle('netease:subscribePlaylist', async (_event, id: number, subscribe?: boolean) => {
    try {
      const success = await neteaseService.subscribePlaylist(id, subscribe ?? true)
      return { success }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Get liked song IDs
  ipcMain.handle('netease:getLikelist', async (_event, uid: number) => {
    try {
      const ids = await neteaseService.getLikelist(uid)
      return { success: true, data: { ids: Array.from(ids) } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Logout — clears all cookies and session data
  ipcMain.handle('netease:logout', async () => {
    try {
      await neteaseService.logout()
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
