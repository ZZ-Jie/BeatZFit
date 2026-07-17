import { BrowserWindow, session, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

// NeteaseCloudMusicApi is a CJS module — use require() for reliable import
// in the Electron main process (bundled by vite-plugin-electron with external).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NeteaseAPI: any = require('NeteaseCloudMusicApi')

const NETBASE_URL = 'https://music.163.com'
const COOKIE_POLL_INTERVAL_MS = 1500
const LOGIN_TIMEOUT_MS = 180_000 // 3 minutes timeout

interface NeteaseCookie {
  name: string
  value: string
  domain?: string
}

interface UserProfile {
  userId: number
  nickname: string
  avatarUrl: string
  signature?: string
  level?: number
}

interface Playlist {
  id: number
  name: string
  coverImgUrl: string
  trackCount: number
  creator: { nickname: string }
}

interface SongUrl {
  id: number
  url: string
  br: number
  canPlay: boolean
  reason?: string
  // VIP / fee info from Netease API
  fee?: number      // 0=free, 1=VIP, 4=album, 8=low-quality free
  code?: number     // 200=success, 404=not found
  freeTrialInfo?: {
    start: number
    end: number
  } | null
  msg?: string
  type?: string | null  // file extension: 'mp3', 'flac', etc.
}

interface LyricResult {
  lrc?: { lyric: string }
  tlyric?: { lyric: string }
  nolyric?: boolean
}

export class NeteaseService {
  private loginWindow: BrowserWindow | null = null
  private cookies: NeteaseCookie[] = []
  private cookiePath: string

  constructor() {
    const userDataPath = app.getPath('userData')
    this.cookiePath = join(userDataPath, 'netease_cookies.json')
    this.loadCookies()
  }

  // ========== Cookie Management ==========

  private loadCookies(): void {
    try {
      if (existsSync(this.cookiePath)) {
        const data = readFileSync(this.cookiePath, 'utf-8')
        const parsed = JSON.parse(data)
        this.cookies = Array.isArray(parsed) ? parsed : []
      }
    } catch {
      this.cookies = []
    }
  }

  private saveCookies(): void {
    const dir = join(this.cookiePath, '..')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.cookiePath, JSON.stringify(this.cookies, null, 2))
  }

  private getCookieString(): string {
    return this.cookies.map(c => `${c.name}=${c.value}`).join('; ')
  }

  isLoggedIn(): boolean {
    return this.cookies.some(c => c.name === 'MUSIC_U' && c.value)
  }

  /**
   * Try to decode the user ID from the MUSIC_U cookie.
   * MUSIC_U is a JWT-like token; the payload (middle segment) contains
   * a JSON object with a `userId` field.
   */
  private getUserIdFromCookie(): number | null {
    const musicU = this.cookies.find(c => c.name === 'MUSIC_U')
    if (!musicU) return null
    try {
      const parts = musicU.value.split('.')
      if (parts.length >= 2) {
        // JWT payload is base64url encoded
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const decoded = Buffer.from(payload, 'base64').toString('utf-8')
        const obj = JSON.parse(decoded)
        if (obj.userId) return obj.userId
      }
    } catch {
      // not a JWT, ignore
    }
    return null
  }

  // ========== Login Window ==========

  async openLogin(): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
      const ses = session.fromPartition('persist:netease-login')

      this.loginWindow = new BrowserWindow({
        width: 960,
        height: 900,
        minWidth: 800,
        minHeight: 800,
        resizable: true,
        minimizable: true,
        title: '登录网易云音乐 — 扫码或输入账号',
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      this.loginWindow.setMenuBarVisibility(false)
      this.loginWindow.loadURL(`${NETBASE_URL}/#/login`)

      let resolved = false
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null

      const finish = async (success: boolean) => {
        if (resolved) return
        resolved = true
        if (pollTimer) clearInterval(pollTimer)
        if (timeoutTimer) clearTimeout(timeoutTimer)
        try {
          this.loginWindow?.close()
        } catch { /* ignore */ }
        this.loginWindow = null
        resolve({ success })
      }

      this.loginWindow.webContents.on('did-navigate-in-page', async (_event, url) => {
        console.log('[Netease] did-navigate-in-page:', url)
        if (url.includes('/user/home') || url.includes('/discover') || url.includes('/my')) {
          await this.captureCookies(ses)
          await finish(true)
        }
      })

      this.loginWindow.webContents.on('did-navigate', async (_event, url) => {
        console.log('[Netease] did-navigate:', url)
        if (url.includes('/user/home') || url.includes('/discover') || url.includes('/my')) {
          await this.captureCookies(ses)
          await finish(true)
        }
      })

      pollTimer = setInterval(async () => {
        if (resolved) return
        try {
          const allCookies = await ses.cookies.get({ url: NETBASE_URL })
          const musicU = allCookies.find(c => c.name === 'MUSIC_U' && c.value)
          if (musicU) {
            console.log('[Netease] MUSIC_U cookie detected via polling')
            await this.captureCookies(ses)
            await finish(true)
          }
        } catch { /* ignore */ }
      }, COOKIE_POLL_INTERVAL_MS)

      timeoutTimer = setTimeout(() => {
        console.log('[Netease] Login timed out')
        finish(false)
      }, LOGIN_TIMEOUT_MS)

      this.loginWindow.on('closed', () => {
        finish(this.isLoggedIn())
      })
    })
  }

  private async captureCookies(ses: Electron.Session): Promise<void> {
    try {
      const allCookies = await ses.cookies.get({ url: NETBASE_URL })
      const importantCookies = allCookies
        .filter(c => ['MUSIC_U', '__csrf', '__remember_me'].includes(c.name))
        .map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.music.163.com'
        }))

      for (const cookie of importantCookies) {
        const idx = this.cookies.findIndex(c => c.name === cookie.name)
        if (idx >= 0) {
          this.cookies[idx] = cookie
        } else {
          this.cookies.push(cookie)
        }
      }

      this.saveCookies()
      console.log('[Netease] Cookies saved:', importantCookies.map(c => c.name).join(', '))
    } catch (e) {
      console.error('[Netease] Failed to capture cookies:', e)
    }
  }

  // ========== API Calls (via NeteaseCloudMusicApi) ==========

  /**
   * Get the current logged-in user's profile.
   * Tries `login_status` first; falls back to decoding the MUSIC_U cookie.
   */
  async getUserInfo(): Promise<UserProfile | null> {
    if (!this.isLoggedIn()) return null

    const cookieStr = this.getCookieString()
    console.log('[Netease] getUserInfo — cookie length:', cookieStr.length)

    // Method 1: call login_status API
    try {
      const res = await NeteaseAPI.login_status({ cookie: cookieStr })
      console.log('[Netease] login_status response keys:', Object.keys(res || {}))
      const body = res?.body || res?.data
      if (body) {
        // The response may have profile at top level or nested
        const profile = body.profile || body?.data?.profile
        if (profile && profile.userId) {
          console.log('[Netease] Got profile via login_status:', profile.nickname, profile.userId)
          return {
            userId: profile.userId,
            nickname: profile.nickname || '网易云用户',
            avatarUrl: profile.avatarUrl || '',
            signature: profile.signature,
            level: profile.level
          }
        }
        // Try account object
        const account = body.account || body?.data?.account
        if (account && account.id) {
          console.log('[Netease] Got account via login_status, id:', account.id)
          return {
            userId: account.id,
            nickname: account.userName || '网易云用户',
            avatarUrl: ''
          }
        }
      }
      console.warn('[Netease] login_status did not return profile or account')
    } catch (e) {
      console.error('[Netease] login_status failed:', e)
    }

    // Method 2: decode userId from MUSIC_U cookie
    const uid = this.getUserIdFromCookie()
    if (uid) {
      console.log('[Netease] Decoded userId from MUSIC_U cookie:', uid)
      return {
        userId: uid,
        nickname: '网易云用户',
        avatarUrl: ''
      }
    }

    console.error('[Netease] All methods to get user info failed')
    return null
  }

  // User Playlists
  async getUserPlaylists(uid: number): Promise<Playlist[]> {
    if (!this.isLoggedIn()) return []
    try {
      console.log('[Netease] getUserPlaylists for uid:', uid)
      const res = await NeteaseAPI.user_playlist({
        uid,
        limit: 100,
        offset: 0,
        cookie: this.getCookieString()
      })
      const body = res?.body || res?.data
      const list = body?.playlist || []
      console.log('[Netease] Got', list.length, 'playlists')
      return list.map((pl: any) => ({
        id: pl.id,
        name: pl.name,
        // Force https for cover images to avoid CSP / mixed-content blocks.
        coverImgUrl: (pl.coverImgUrl || pl.picUrl || '').replace(/^http:\/\//, 'https://'),
        trackCount: pl.trackCount || 0,
        creator: pl.creator || { nickname: '' }
      }))
    } catch (e) {
      console.error('[Netease] getUserPlaylists failed:', e)
      return []
    }
  }

// Playlist Detail (tracks) — with retry for 502 ECONNRESET
// Supports optional limit for fast initial load (large playlists)
async getPlaylistDetail(id: number, limit?: number): Promise<{ tracks: any[] }> {
if (!this.isLoggedIn()) return { tracks: [] }
const maxRetries = 3
const retryDelayMs = 1000
for (let attempt = 0; attempt < maxRetries; attempt++) {
try {
if (attempt > 0) {
console.log(`[Netease] getPlaylistDetail retry ${attempt}/${maxRetries} for id:`, id)
await new Promise(r => setTimeout(r, retryDelayMs * attempt))
}
console.log('[Netease] getPlaylistDetail for id:', id, limit ? `(limit: ${limit})` : '(all)')
const params: any = {
id,
limit: limit || 1000,
offset: 0,
cookie: this.getCookieString()
}
const res = await NeteaseAPI.playlist_track_all(params)
const body = res?.body || res?.data
const songs = body?.songs || []
console.log('[Netease] Got', songs.length, 'tracks from playlist')
return { tracks: songs }
} catch (e) {
console.error(`[Netease] getPlaylistDetail failed (attempt ${attempt + 1}/${maxRetries}):`, e)
if (attempt === maxRetries - 1) {
return { tracks: [] }
}
}
}
return { tracks: [] }
}

  // Song URL
  // Returns null when the song is not playable; callers should surface a
  // user-visible error in that case. The `level` parameter controls quality:
  //   'standard'  → 128kbps MP3
  //   'higher'    → 192kbps MP3
  //   'exhigh'    → 320kbps MP3
  //   'lossless'  → FLAC (requires VIP)
  //   'hires'     → Hi-Res (requires VIP)
  // When `level` is not specified, tries exhigh → higher → standard as fallback.
async getSongUrl(songId: number, level?: string): Promise<SongUrl | null> {
if (!this.isLoggedIn()) return null
const levels = level ? [level] : ['exhigh', 'higher', 'standard']
for (const lv of levels) {
// Retry each level up to 2 times on network errors
for (let retry = 0; retry < 2; retry++) {
try {
if (retry > 0) {
console.log('[Netease] Retrying getSongUrl for id:', songId, 'level:', lv, 'retry:', retry)
await new Promise(r => setTimeout(r, 1000 * retry))
}
console.log('[Netease] getSongUrl for id:', songId, 'level:', lv)
const res = await NeteaseAPI.song_url_v1({
id: songId,
level: lv,
cookie: this.getCookieString()
})
const body = res?.body || res?.data
const urls = body?.data || []
if (urls.length === 0) {
console.warn('[Netease] getSongUrl returned no data array for song', songId)
break // No data → try next level
}
const item = urls[0]
// Return full info including VIP/fee fields
if (item.url) {
console.log('[Netease] Got song URL at level', lv, 'br:', item.br, 'type:', item.type)
return {
id: item.id,
url: item.url,
br: item.br || 0,
canPlay: true,
reason: lv !== (level || 'exhigh') ? `fallback:${lv}` : undefined,
fee: item.fee,
code: item.code,
freeTrialInfo: item.freeTrialInfo || null,
type: item.type || null,
}
}
// URL is null — could be VIP-only, region-locked, or unavailable.
// Return a structured result so the renderer can show a VIP dialog.
console.warn('[Netease] No URL at level', lv,
'code:', item.code, 'fee:', item.fee, 'st:', item.st, 'msg:', item.msg)
return {
id: item.id || songId,
url: '',
br: 0,
canPlay: false,
reason: 'no_url',
fee: item.fee,
code: item.code,
freeTrialInfo: item.freeTrialInfo || null,
msg: item.msg,
type: item.type || null,
}
} catch (e: any) {
// Check if it's a network error (retryable)
const isNetworkError = e?.status === 502 || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET' || e?.message?.includes('connect')
if (isNetworkError && retry < 1) {
console.warn('[Netease] Network error for getSongUrl, will retry:', e.message || e)
continue
}
console.error('[Netease] getSongUrl failed at level', lv, ':', e)
break // Non-retryable error → try next level
}
}
}
console.warn('[Netease] No playable URL for song', songId, 'after trying all levels')
return null
}

  // Lyric — publicly available, no login required for most songs
async getLyric(songId: number): Promise<LyricResult | null> {
for (let retry = 0; retry < 2; retry++) {
try {
if (retry > 0) {
console.log('[Netease] Retrying getLyric for id:', songId, 'retry:', retry)
await new Promise(r => setTimeout(r, 1000 * retry))
}
const params: any = { id: songId }
// Include cookie if logged in (some VIP lyrics need it)
if (this.isLoggedIn()) {
params.cookie = this.getCookieString()
}
const res = await NeteaseAPI.lyric(params)
return res?.body || res?.data
} catch (e: any) {
const isNetworkError = e?.status === 502 || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET' || e?.message?.includes('connect')
if (isNetworkError && retry < 1) {
console.warn('[Netease] Network error for getLyric, will retry:', e.message || e)
continue
}
console.error('[Netease] getLyric failed:', e)
return null
}
}
return null
}

  // Search — works without login (anonymous search), cookie passed if available
  async search(keywords: string, limit = 20): Promise<any[]> {
    try {
      const params: any = { keywords, type: 1, limit }
      // Pass cookie if logged in (improves results, avoids rate limits)
      if (this.isLoggedIn()) {
        params.cookie = this.getCookieString()
      }
      const res = await NeteaseAPI.search(params)
      const body = res?.body || res?.data
      const songs = body?.result?.songs || []
      if (songs.length === 0) return []

      // The /search endpoint often omits album.picUrl. Fetch full song
      // details to get cover URLs for display.
      const songIds = songs.map((s: any) => s.id)
      try {
        const detailParams: any = { ids: songIds.join(',') }
        if (this.isLoggedIn()) {
          detailParams.cookie = this.getCookieString()
        }
        const detailRes = await NeteaseAPI.song_detail(detailParams)
        const detailBody = detailRes?.body || detailRes?.data
        const detailSongs = detailBody?.songs || []
        // Merge: create a map of id → al.picUrl from details
        const coverMap: Record<number, string> = {}
        for (const ds of detailSongs) {
          const picUrl = ds?.al?.picUrl || ds?.album?.picUrl
          if (picUrl) coverMap[ds.id] = picUrl
        }
        // Enrich search results with cover URLs
        for (const s of songs) {
          if (coverMap[s.id]) {
            if (!s.album) s.album = {}
            if (!s.album.picUrl) s.album.picUrl = coverMap[s.id]
          }
        }
      } catch (e) {
        // Detail fetch is best-effort — don't fail the whole search
        console.warn('[Netease] song_detail enrichment failed:', e)
      }

      return songs
    } catch (e) {
      console.error('[Netease] search failed:', e)
      return []
    }
  }

  // Like a song (adds to / removes from "我喜欢的音乐" playlist)
  // NOTE: NeteaseCloudMusicApi's like module does: query.like = query.like == 'false' ? false : true
  // So we MUST pass 'false' as a STRING (not boolean false) to unlike a song.
  async likeSong(songId: number, like: boolean = true): Promise<boolean> {
    if (!this.isLoggedIn()) return false
    try {
      const res = await NeteaseAPI.like({
        id: songId,
        like: like ? 'true' : 'false',
        cookie: this.getCookieString()
      })
      const body = res?.body || res?.data
      if (body?.code !== 200) {
        console.warn('[Netease] likeSong unexpected code:', body?.code, { songId, like })
      }
      return body?.code === 200
    } catch (e) {
      console.error('[Netease] likeSong failed:', e)
      return false
    }
  }

  // Add track to a specific playlist
  async addToPlaylist(trackId: number, playlistId: number): Promise<{ success: boolean; message?: string }> {
    if (!this.isLoggedIn()) return { success: false, message: '未登录' }
    try {
      const res = await NeteaseAPI.playlist_tracks({
        op: 'add',
        pid: playlistId,
        tracks: trackId,
        cookie: this.getCookieString()
      })
      const body = res?.body || res?.data
      if (body?.code === 200) return { success: true }
      // Netease returns body.message for errors like "歌曲已存在"
      return { success: false, message: body?.message || body?.msg || '添加失败' }
    } catch (e) {
      console.error('[Netease] addToPlaylist failed:', e)
      return { success: false, message: '网络错误' }
    }
  }

  // Subscribe / unsubscribe a playlist (收藏/取消收藏歌单)
  // NOTE: The NeteaseCloudMusicApi `playlist_subscribe` module forces an
  // expired `checkToken` (from APP_CONF.checkToken) into the request data
  // for subscribe (t=1), AND hardcodes `createOption(query, 'eapi')`.
  // Even passing `crypto: 'weapi'` doesn't help — the checkToken data field
  // is still sent, and the server returns 405 "操作过于频繁".
  //
  // Fix: bypass the module entirely and make a direct weapi request to
  // /weapi/playlist/subscribe WITHOUT the checkToken field.
  async subscribePlaylist(id: number, subscribe: boolean = true): Promise<boolean> {
    if (!this.isLoggedIn()) return false
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const encrypt = require('NeteaseCloudMusicApi/util/crypto')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { default: axios } = require('axios')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { cookieToJson } = require('NeteaseCloudMusicApi/util/index')

      const path = subscribe ? 'subscribe' : 'unsubscribe'
      const cookieStr = this.getCookieString()
      const cookieObj = cookieToJson(cookieStr)
      const csrfToken = (cookieObj as any).__csrf || ''

      // Build the weapi-encrypted payload — NO checkToken field
      const data: Record<string, any> = {
        id,
        csrf_token: csrfToken,
      }

      const encrypted = encrypt.weapi(data)

      const res = await axios({
        method: 'POST',
        url: `https://music.163.com/weapi/playlist/${path}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
          'Cookie': cookieStr,
        },
        data: new URLSearchParams(encrypted).toString(),
        proxy: false,
      })

      const body = res.data
      const code = body?.code
      if (code !== 200 && code !== '200') {
        console.warn('[Netease] subscribePlaylist unexpected code:', code, { id, subscribe, message: body?.message })
      }
      return code === 200 || code === '200'
    } catch (e: any) {
      console.error('[Netease] subscribePlaylist failed:', e?.response?.data || e?.message || e)
      return false
    }
  }

  // Search playlists (type=1000)
  async searchPlaylists(keywords: string, limit = 20): Promise<any[]> {
    try {
      const params: any = { keywords, type: 1000, limit }
      if (this.isLoggedIn()) {
        params.cookie = this.getCookieString()
      }
      const res = await NeteaseAPI.search(params)
      const body = res?.body || res?.data
      return body?.result?.playlists || []
    } catch (e) {
      console.error('[Netease] searchPlaylists failed:', e)
      return []
    }
  }

  // Get user's liked song IDs (for checking if a song is already liked)
  async getLikelist(uid: number): Promise<Set<number>> {
    if (!this.isLoggedIn()) return new Set()
    try {
      const res = await NeteaseAPI.likelist({
        uid,
        cookie: this.getCookieString()
      })
      const body = res?.body || res?.data
      const ids: number[] = body?.ids || []
      return new Set(ids)
    } catch (e) {
      console.error('[Netease] getLikelist failed:', e)
      return new Set()
    }
  }

  // Logout — clear cookies from memory, disk, and the login session
  async logout(): Promise<void> {
    this.cookies = []
    this.saveCookies()

    // Clear the persistent login session cookies
    try {
      const ses = session.fromPartition('persist:netease-login')
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'shadercache', 'serviceworkers', 'cachestorage'],
      })
      console.log('[Netease] Cleared login session storage data')
    } catch (e) {
      console.error('[Netease] Failed to clear login session:', e)
    }

    // Also clear the default session cookies for music.163.com
    try {
      const defaultSes = session.defaultSession
      const cookies = await defaultSes.cookies.get({ url: NETBASE_URL })
      for (const cookie of cookies) {
        await defaultSes.cookies.remove(NETBASE_URL, cookie.name)
      }
      console.log('[Netease] Cleared default session cookies for', NETBASE_URL)
    } catch (e) {
      console.error('[Netease] Failed to clear default session cookies:', e)
    }

    // Delete the cookie file from disk
    try {
      if (existsSync(this.cookiePath)) {
        const { unlinkSync } = require('fs')
        unlinkSync(this.cookiePath)
        console.log('[Netease] Deleted cookie file:', this.cookiePath)
      }
    } catch (e) {
      console.error('[Netease] Failed to delete cookie file:', e)
    }
  }
}
