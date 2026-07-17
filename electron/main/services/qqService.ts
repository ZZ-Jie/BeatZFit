import { BrowserWindow, session, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import axios from 'axios'
import * as crypto from 'crypto'

// ── Constants ──────────────────────────────────────────────

const QQ_MUSIC_BASE = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
const QQ_LOGIN_URL = 'https://y.qq.com'
const QQ_COOKIE_DOMAIN = 'https://y.qq.com'
const COOKIE_POLL_INTERVAL_MS = 1500
const LOGIN_TIMEOUT_MS = 180_000 // 3 minutes

// Direct API endpoints (NOT via musicu.fcg) — discovered from jsososo/QQMusicApi
const QQ_USER_SONGLIST_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss'
const QQ_SONGLIST_DETAIL_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg'
const QQ_USER_DETAIL_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg'

// Sign salt used by QQ Music API (publicly known from open-source implementations)
const SIGN_SALT = 'CJBPACrRuNy7emQ3G0VV8bU6wYJ6UJmV'

// ── Types ──────────────────────────────────────────────────

interface QqCookie {
  name: string
  value: string
  domain?: string
}

interface UserProfile {
  uin: string
  nickname: string
  avatarUrl: string
  level?: number
  vip?: boolean
}

interface Playlist {
  id: string
  name: string
  coverImgUrl: string
  trackCount: number
  creator: { uin: string; nickname: string }
}

interface SongUrl {
  songmid: string
  url: string
  br: number
  canPlay: boolean
  reason?: string
  fee?: number
  code?: number
  msg?: string
  type?: string | null
}

interface LyricResult {
  lyric?: string
  trans?: string
  code?: number
}

// ── Sign Calculation ───────────────────────────────────────

/**
 * Calculate the QQ Music API sign parameter.
 * The sign is md5(SIGN_SALT + JSON.stringify(data)).
 */
function getSign(data: object): string {
  const dataStr = JSON.stringify(data)
  return crypto.createHash('md5').update(SIGN_SALT + dataStr).digest('hex')
}

/**
 * Generate a random GUID used for song URL requests.
 */
function randomGuid(): string {
  return Math.floor(Math.random() * 1e10).toString()
}

/**
 * Build the album cover URL from album mid.
 * QQ Music cover images use the pattern:
 * https://y.gtimg.cn/music/photo_new/T002R300x300M000{pmid}.jpg
 */
function buildCoverUrl(albumMid?: string): string {
  if (!albumMid) return ''
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
}

// ── Service ────────────────────────────────────────────────

export class QqService {
  private loginWindow: BrowserWindow | null = null
  private cookies: QqCookie[] = []
  private cookiePath: string

  constructor() {
    const userDataPath = app.getPath('userData')
    this.cookiePath = join(userDataPath, 'qq_cookies.json')
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

  private getCookie(name: string): string | undefined {
    return this.cookies.find(c => c.name === name)?.value
  }

  isLoggedIn(): boolean {
    const uin = this.getCookie('uin')
    const qqmusicKey = this.getCookie('qqmusic_key')
    return !!(uin && qqmusicKey)
  }

  /**
   * Get the uin (QQ number) from cookies.
   * The `uin` cookie value starts with 'o' prefix (e.g. 'o123456789').
   */
  private getUin(): string {
    const raw = this.getCookie('uin') || ''
    return raw.replace(/^o/, '')
  }

  // ========== Login Window ==========

  async openLogin(): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
      const ses = session.fromPartition('persist:qq-login')

      this.loginWindow = new BrowserWindow({
        width: 960,
        height: 900,
        minWidth: 800,
        minHeight: 800,
        resizable: true,
        minimizable: true,
        title: '登录 QQ 音乐 — 扫码或输入账号',
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      this.loginWindow.setMenuBarVisibility(false)
      this.loginWindow.loadURL(QQ_LOGIN_URL)

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

      // Poll for auth cookies — QQ Music sets `uin` and `qqmusic_key` after login
      pollTimer = setInterval(async () => {
        if (resolved) return
        try {
          const allCookies = await ses.cookies.get({ url: QQ_COOKIE_DOMAIN })
          const uin = allCookies.find(c => c.name === 'uin' && c.value)
          const qqmusicKey = allCookies.find(c => c.name === 'qqmusic_key' && c.value)
          if (uin && qqmusicKey) {
            console.debug('[QQ] Auth cookies detected via polling')
            await this.captureCookies(ses)
            await finish(true)
          }
        } catch { /* ignore */ }
      }, COOKIE_POLL_INTERVAL_MS)

      // Also check on navigation events (faster than polling)
      this.loginWindow.webContents.on('did-navigate', async (_event, url) => {
        console.debug('[QQ] did-navigate:', url)
        try {
          const allCookies = await ses.cookies.get({ url: QQ_COOKIE_DOMAIN })
          const uin = allCookies.find(c => c.name === 'uin' && c.value)
          const qqmusicKey = allCookies.find(c => c.name === 'qqmusic_key' && c.value)
          if (uin && qqmusicKey) {
            await this.captureCookies(ses)
            await finish(true)
          }
        } catch { /* ignore */ }
      })

      this.loginWindow.webContents.on('did-navigate-in-page', async (_event, url) => {
        console.debug('[QQ] did-navigate-in-page:', url)
        try {
          const allCookies = await ses.cookies.get({ url: QQ_COOKIE_DOMAIN })
          const uin = allCookies.find(c => c.name === 'uin' && c.value)
          const qqmusicKey = allCookies.find(c => c.name === 'qqmusic_key' && c.value)
          if (uin && qqmusicKey) {
            await this.captureCookies(ses)
            await finish(true)
          }
        } catch { /* ignore */ }
      })

      timeoutTimer = setTimeout(() => {
        console.debug('[QQ] Login timed out')
        finish(false)
      }, LOGIN_TIMEOUT_MS)

      this.loginWindow.on('closed', () => {
        finish(this.isLoggedIn())
      })
    })
  }

  private async captureCookies(ses: Electron.Session): Promise<void> {
    try {
      // Get cookies from multiple QQ domains
      const domains = ['https://y.qq.com', 'https://qq.com', 'https://u.qq.com', 'https://u.y.qq.com', 'https://c.y.qq.com']
      const allCookies: Electron.Cookie[] = []
      for (const d of domains) {
        try {
          const c = await ses.cookies.get({ url: d })
          allCookies.push(...c)
        } catch { /* ignore */ }
      }

      // Deduplicate by name — save ALL cookies, not just a subset
      const seen = new Set<string>()
      const allSaved = allCookies
        .filter(c => c.value)
        .filter(c => {
          if (seen.has(c.name)) return false
          seen.add(c.name)
          return true
        })
        .map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.qq.com'
        }))

      for (const cookie of allSaved) {
        const idx = this.cookies.findIndex(c => c.name === cookie.name)
        if (idx >= 0) {
          this.cookies[idx] = cookie
        } else {
          this.cookies.push(cookie)
        }
      }

      this.saveCookies()
      console.debug('[QQ] Cookies saved:', allSaved.map(c => c.name).join(', '), 'total:', allSaved.length)
    } catch (e) {
      console.error('[QQ] Failed to capture cookies:', e)
    }
  }

  // ========== API Calls (via direct HTTP to musicu.fcg) ==========

  /**
   * Make a request to the QQ Music API (musicu.fcg).
   * This is the unified endpoint for all QQ Music data operations.
   */
  private async musicuRequest(reqData: object, requireAuth = false): Promise<any> {
    if (requireAuth && !this.isLoggedIn()) {
      throw new Error('Not logged in')
    }

    const sign = getSign(reqData)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Referer': 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }

    if (this.isLoggedIn()) {
      headers['Cookie'] = this.getCookieString()
    }

    const url = `${QQ_MUSIC_BASE}?sign=${sign}`

    const maxRetries = 3
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.debug(`[QQ] musicuRequest retry ${attempt}/${maxRetries}`)
          await new Promise(r => setTimeout(r, 1000 * attempt))
        }
        const resp = await axios.post(url, reqData, { headers, timeout: 15000 })
        return resp.data
      } catch (e: any) {
        const isNetworkError = e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET' || e?.message?.includes('connect')
        if (isNetworkError && attempt < maxRetries - 1) {
          console.warn('[QQ] Network error, will retry:', e.message || e)
          continue
        }
        console.error('[QQ] musicuRequest failed:', e.message || e)
        throw e
      }
    }
    throw new Error('Max retries exceeded')
  }

  /**
   * Get the current logged-in user's profile.
   * Uses the direct fcg_get_profile_homepage endpoint.
   */
  async getUserInfo(): Promise<UserProfile | null> {
    if (!this.isLoggedIn()) return null

    const uin = this.getUin()
    const cookieStr = this.getCookieString()
    console.debug('[QQ] getUserInfo — uin:', uin, 'cookie length:', cookieStr.length)

    // Try to get user info from the QQ Music direct API
    try {
      const headers: Record<string, string> = {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      if (this.isLoggedIn()) {
        headers['Cookie'] = cookieStr
      }

      const resp = await axios.get(QQ_USER_DETAIL_URL, {
        params: {
          cid: 205360838,
          userid: uin,
          reqfrom: 1,
        },
        headers,
        timeout: 10000,
      })

      const data = resp.data
      if (data && data.code === 1000) {
        // Not logged in according to server
        console.warn('[QQ] getUserInfo: server returned code 1000 (not logged in)')
      } else if (data && data.data) {
        const creator = data.data.creator || {}
        const nickname = creator.nick || creator.name || `QQ用户${uin}`
        const avatarUrl = creator.headpic || creator.avatar || ''
        // VIP detection: creator.isvip may not exist in all API responses.
        // The lvinfo field contains VIP level info — if it's a non-empty
        // object/array with content, the user likely has VIP status.
        // typeinfo may also contain membership flags.
        const isVip = !!(creator.isvip || data.data.isvip ||
          (creator.lvinfo && typeof creator.lvinfo === 'object' && Object.keys(creator.lvinfo).length > 0))
        console.debug('[QQ] Got user info:', nickname, 'isVip:', isVip, 'keys:', Object.keys(creator).join(','))
        return {
          uin,
          nickname,
          avatarUrl,
          vip: isVip,
        }
      }
    } catch (e) {
      console.error('[QQ] getUserInfo API failed:', e)
    }

    // Fallback: return basic info from cookie
    if (uin) {
      console.debug('[QQ] Falling back to cookie-based user info')
      return {
        uin,
        nickname: `QQ用户${uin}`,
        avatarUrl: ''
      }
    }

    console.error('[QQ] All methods to get user info failed')
    return null
  }

  /**
   * Get the user's playlists.
   * Uses the direct fcg_user_created_diss endpoint (NOT musicu.fcg).
   * Returns disstlist where each item has:
   *   - tid: the real playlist ID (long number) — used for getPlaylistDetail
   *   - dirid: type code (201 = favorites, small numbers = system playlists)
   *   - diss_name, diss_cover, song_cnt
   */
  async getUserPlaylists(): Promise<Playlist[]> {
    if (!this.isLoggedIn()) return []

    const uin = this.getUin()
    console.debug('[QQ] getUserPlaylists for uin:', uin)

    try {
      const headers: Record<string, string> = {
        'Referer': 'https://y.qq.com/portal/profile.html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      if (this.isLoggedIn()) {
        headers['Cookie'] = this.getCookieString()
      }

      const resp = await axios.get(QQ_USER_SONGLIST_URL, {
        params: {
          hostUin: 0,
          hostuin: uin,
          sin: 0,
          size: 200,
          g_tk: 5381,
          loginUin: 0,
          format: 'json',
          inCharset: 'utf8',
          outCharset: 'utf8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 0,
        },
        headers,
        timeout: 10000,
      })

      const result = resp.data
      if (result.code === 1000) {
        console.warn('[QQ] getUserPlaylists: not logged in (code 1000)')
        return []
      }

      const disslist = result?.data?.disslist || []
      console.debug('[QQ] Got', disslist.length, 'playlists')
      console.debug('[QQ] Playlist raw:', disslist.map((d: any) => `tid=${d.tid},dirid=${d.dirid},name=${d.diss_name}`).join(' | '))

      return disslist
        .filter((pl: any) => pl.tid && pl.tid !== 0) // Skip favorites (dirid=201, tid=0) — no detail endpoint
        .map((pl: any) => ({
          id: String(pl.tid),
          name: pl.diss_name || pl.name || '未命名歌单',
          coverImgUrl: pl.diss_cover || '',
          trackCount: pl.song_cnt || 0,
          creator: {
            uin: String(pl.hostuin || uin),
            nickname: `QQ用户${uin}`
          }
        }))
    } catch (e) {
      console.error('[QQ] getUserPlaylists failed:', e)
      return []
    }
  }

  /**
   * Get playlist detail (tracks) by playlist ID.
   * Uses the direct fcg_ucc_getcdinfo_byids_cp endpoint (NOT musicu.fcg).
   * The playlistId parameter should be the playlist's `tid` (NOT `dirid`).
   * Returns cdlist[0].songlist array.
   */
  async getPlaylistDetail(playlistId: string): Promise<{ tracks: any[] }> {
    if (!this.isLoggedIn()) return { tracks: [] }

    const maxRetries = 3
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.debug(`[QQ] getPlaylistDetail retry ${attempt}/${maxRetries} for id:`, playlistId)
          await new Promise(r => setTimeout(r, 1000 * attempt))
        }
        console.debug('[QQ] getPlaylistDetail for id:', playlistId)

        const headers: Record<string, string> = {
          'Referer': 'https://y.qq.com/n/yqq/playlist',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        if (this.isLoggedIn()) {
          headers['Cookie'] = this.getCookieString()
        }

        const resp = await axios.get(QQ_SONGLIST_DETAIL_URL, {
          params: {
            type: 1,
            utf8: 1,
            disstid: playlistId,
            loginUin: 0,
            format: 'json',
            inCharset: 'utf8',
            outCharset: 'utf8',
            notice: 0,
            platform: 'yqq.json',
            needNewCode: 0,
          },
          headers,
          timeout: 15000,
          // Some QQ Music fcg endpoints return text/html with JSONP or JSON
          responseType: 'text',
          transformResponse: [(data: string) => {
            // Handle JSONP: callback({...}) → {...}
            const jsonpMatch = data.match(/^[a-zA-Z0-9_$]+\((.+)\)$/s)
            if (jsonpMatch) {
              return JSON.parse(jsonpMatch[1])
            }
            try {
              return JSON.parse(data)
            } catch {
              return data
            }
          }],
        })

        const result = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data
        // Debug: log the response structure
        console.debug('[QQ] getPlaylistDetail response code:', result?.code, 'keys:', Object.keys(result || {}))
        if (result?.cdlist?.[0]) {
          console.debug('[QQ] cdlist[0] keys:', Object.keys(result.cdlist[0]))
          console.debug('[QQ] cdlist[0].songlist length:', result.cdlist[0].songlist?.length)
          if (result.cdlist[0].songlist?.[0]) {
            console.debug('[QQ] First song keys:', Object.keys(result.cdlist[0].songlist[0]))
          }
        } else {
          console.debug('[QQ] No cdlist in response. Full response:', JSON.stringify(result).slice(0, 500))
        }

        if (result.code === 1000) {
          console.warn('[QQ] getPlaylistDetail: not logged in (code 1000)')
          return { tracks: [] }
        }

        const cdlist = result?.cdlist || []
        const rawSongList = cdlist[0]?.songlist || []

        // Transform raw QQ Music song fields to the QqSong format expected by frontend
        // Raw API uses: songname, albumname, albummid, albumid, albumPmid
        // QqSong expects: name, album.name, album.mid, album.id, album.pmid
        const songList = rawSongList.map((s: any) => ({
          songmid: s.songmid || '',
          songid: s.songid || 0,
          strMediaMid: s.strMediaMid || s.songmid || '',
          name: s.songname || s.name || '',
          singer: (s.singer || []).map((sg: any) => ({
            id: sg.id || 0,
            mid: sg.mid || '',
            name: sg.name || '',
          })),
          album: {
            id: s.albumid || 0,
            mid: s.albummid || '',
            name: s.albumname || s.album?.name || '',
            pmid: s.albumPmid || s.album_pmid || s.album?.pmid || undefined,
          },
          interval: s.interval || 0,
          trackNum: s.trackNum,
          pay: s.pay,
          preview: s.preview,
        }))

        // Log pay/preview/stream/switch fields for first few songs to understand VIP/trial status
        for (const s of rawSongList.slice(0, 3)) {
          console.debug('[QQ] Song pay field:', s.songmid, 'pay:', JSON.stringify(s.pay), 'preview:', JSON.stringify(s.preview), 'stream:', JSON.stringify(s.stream), 'switch:', JSON.stringify(s.switch))
        }

        console.debug('[QQ] Got', songList.length, 'tracks from playlist')
        return { tracks: songList }
      } catch (e) {
        console.error(`[QQ] getPlaylistDetail failed (attempt ${attempt + 1}/${maxRetries}):`, e)
        if (attempt === maxRetries - 1) {
          return { tracks: [] }
        }
      }
    }
    return { tracks: [] }
  }

  /**
   * Get the playable URL for a song.
   * QQ Music uses `songmid` (string) as the song identifier.
   * Quality is a string: '128' (standard), '320' (high), 'flac' (lossless).
   *
   * Based on jsososo/QQMusicApi routes/song.js. Uses GET with filename + authst.
   * The vkey.GetVkeyServer module returns a purl (partial URL) prepended with sip.
   *
   * IMPORTANT: QQ Music vkey server sometimes returns empty purl on first request.
   * We retry up to 3 times with 500ms delay. If purl is still empty and testfile2g
   * is set, the song is VIP-only — return immediately without further retries.
   *
   * We try quality 128 first (works for non-VIP users), then fall back to the
   * requested quality. This avoids wasting requests on 320kbps which requires VIP.
   *
   * VIP optimization: when isVip is true (pay.payplay === 1), skip all multi-quality
   * retries and go straight to the m4a trial attempt. This reduces the worst-case
   * delay from ~15 seconds (7 API calls) to ~5 seconds (1 API call).
   */
  async getSongUrl(songmid: string, quality?: string, strMediaMid?: string, isVip?: boolean): Promise<SongUrl | null> {
    if (!this.isLoggedIn()) return null

    const qqmusicKey = this.getCookie('qqmusic_key') || ''
    const uin = this.getUin()

    // strMediaMid is the media mid used for filename construction.
    // It's different from songmid! The vkey server uses strMediaMid to
    // locate the actual media file. If not provided, fall back to songmid.
    const mediaMid = strMediaMid || songmid

    // Quality → filename prefix + extension
    const typeMap: Record<string, { s: string; e: string }> = {
      '128': { s: 'M500', e: '.mp3' },
      '320': { s: 'M800', e: '.mp3' },
      'flac': { s: 'F000', e: '.flac' },
      'm4a': { s: 'C400', e: '.m4a' },
    }

    // ── VIP fast-path: skip multi-quality retries, go straight to m4a trial ──
    // VIP songs (pay.payplay === 1) will never return a purl for 128/320/flac.
    // The only chance is the C400 m4a trial format (30-second preview).
    // Skipping the 7-call retry chain reduces delay from ~15s to ~5s.
    if (isVip) {
      console.debug('[QQ] VIP song detected, skipping multi-quality retries, trying m4a trial directly')
      const trialResult = await this.tryM4aTrial(songmid, mediaMid, uin, qqmusicKey)
      if (trialResult) return trialResult

      console.warn('[QQ] No playable URL for VIP songmid', songmid)
      return {
        songmid,
        url: '',
        br: 0,
        canPlay: false,
        reason: 'vip_only',
        fee: 1,
        code: 0,
        msg: 'VIP-only or unavailable'
      }
    }

    // Always try 128 first (works for non-VIP), then the requested quality
    const qualities = quality && quality !== '128' ? ['128', quality] : ['128']
    const MAX_RETRIES = 3
    const RETRY_DELAY_MS = 500

    const headers: Record<string, string> = {
      'Referer': 'https://y.qq.com/portal/player.html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': this.getCookieString(),
    }

    for (const q of qualities) {
      const typeObj = typeMap[q] || typeMap['128']
      const file = `${typeObj.s}${songmid}${mediaMid}${typeObj.e}`
      const guid = String(Math.floor(Math.random() * 10000000))

      console.debug('[QQ] getSongUrl songmid:', songmid, 'quality:', q, 'file:', file)

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        if (retry > 0) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        }

        try {
          const dataObj = {
            req_0: {
              module: 'vkey.GetVkeyServer',
              method: 'CgiGetVkey',
              param: {
                filename: [file],
                guid: guid,
                songmid: [songmid],
                songtype: [0],
                uin: uin,
                loginflag: 1,
                platform: '20',
              },
            },
            comm: {
              uin: Number(uin),
              format: 'json',
              ct: 24,
              cv: 0,
              authst: qqmusicKey,
            },
          }

          const resp = await axios.get(QQ_MUSIC_BASE, {
            params: {
              g_tk: 1124214810,
              loginUin: uin,
              hostUin: 0,
              format: 'json',
              inCharset: 'utf8',
              outCharset: 'utf-8',
              notice: 0,
              platform: 'yqq.json',
              needNewCode: 0,
              data: JSON.stringify(dataObj),
            },
            headers,
            timeout: 5000,
          })

          const req0Data = resp.data?.req_0?.data
          if (!req0Data?.midurlinfo) {
            console.warn('[QQ] No midurlinfo in response, code:', resp.data?.req_0?.code)
            continue
          }

          const midurlinfo = req0Data.midurlinfo[0]
          const sip = req0Data.sip?.find((s: string) => s.startsWith('https://')) || req0Data.sip?.[0] || ''
          const purl = midurlinfo?.purl || ''
          // Fallback: if purl is empty but vkey+filename are present, construct URL manually
          const vkey = midurlinfo?.vkey || ''
          const midFilename = midurlinfo?.filename || ''

          if (retry === 0) {
            console.debug('[QQ] vkey response purl:', purl.slice(0, 60), 'vkey:', vkey.slice(0, 20), 'result:', midurlinfo?.result)
          }

          if (purl && sip) {
            const url = sip + purl
            console.debug('[QQ] Got song URL at quality', q, `(retry ${retry})`)
            return {
              songmid,
              url,
              br: q === 'flac' ? 900000 : (q === '320' ? 320000 : 128000),
              canPlay: true,
              reason: q !== (quality || '320') ? `fallback:${q}` : undefined,
              fee: 0,
              code: 0,
              type: q === 'flac' ? 'flac' : 'mp3'
            }
          }
          // Fallback: construct URL from vkey + filename (from sansenjian project's buildPlayUrl)
          if (vkey && midFilename && sip) {
            const url = `${sip}${midFilename}?vkey=${vkey}&guid=${guid}&fromtag=66`
            console.debug('[QQ] Got song URL via vkey+filename fallback at quality', q)
            return {
              songmid,
              url,
              br: q === 'flac' ? 900000 : (q === '320' ? 320000 : 128000),
              canPlay: true,
              reason: q !== (quality || '320') ? `fallback:${q}` : undefined,
              fee: 0,
              code: 0,
              type: q === 'flac' ? 'flac' : 'mp3'
            }
          }

          // purl empty — if testfile2g is set, song exists but is VIP-only for this quality
          // Retry a couple times since vkey server can be flaky
          if (retry === MAX_RETRIES - 1) {
            console.warn('[QQ] purl empty after', MAX_RETRIES, 'retries at quality', q)
          }
        } catch (e: any) {
          console.error(`[QQ] getSongUrl error (retry ${retry}, quality ${q}):`, e.message || e)
        }
      }
    }

    // ── VIP trial: try m4a (C400) format as last resort ──
    const trialResult = await this.tryM4aTrial(songmid, mediaMid, uin, qqmusicKey, headers)
    if (trialResult) return trialResult

    console.warn('[QQ] No playable URL for songmid', songmid, '(likely VIP-only)')
    return {
      songmid,
      url: '',
      br: 0,
      canPlay: false,
      reason: 'no_url',
      fee: 1,
      code: 0,
      msg: 'VIP-only or unavailable'
    }
  }

  /**
   * Try to get a C400 m4a trial URL for a VIP song.
   * Returns a SongUrl with reason='trial' if successful, null otherwise.
   * Extracted from getSongUrl for reuse in the VIP fast-path.
   */
  private async tryM4aTrial(
    songmid: string,
    mediaMid: string,
    uin: string,
    qqmusicKey: string,
    headers?: Record<string, string>,
  ): Promise<SongUrl | null> {
    const trialFile = `C400${songmid}${mediaMid}.m4a`
    const trialGuid = String(Math.floor(Math.random() * 10000000))
    console.debug('[QQ] Trying m4a trial for songmid:', songmid, 'file:', trialFile)
    try {
      const trialHeaders = headers || {
        'Referer': 'https://y.qq.com/portal/player.html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': this.getCookieString(),
      }
      const trialDataObj = {
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: {
            filename: [trialFile],
            guid: trialGuid,
            songmid: [songmid],
            songtype: [0],
            uin: uin,
            loginflag: 1,
            platform: '20',
            ...(qqmusicKey ? { authst: qqmusicKey } : {}),
          },
        },
        comm: {
          uin: Number(uin),
          format: 'json',
          ct: 24,
          cv: 0,
        },
      }
      const resp = await axios.get(QQ_MUSIC_BASE, {
        params: {
          g_tk: 1124214810,
          loginUin: uin,
          hostUin: 0,
          format: 'json',
          inCharset: 'utf8',
          outCharset: 'utf-8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 0,
          data: JSON.stringify(trialDataObj),
        },
        headers: trialHeaders,
        timeout: 5000,
      })
      const req0Data = resp.data?.req_0?.data
      const midurlinfo = req0Data?.midurlinfo?.[0]
      const sip = req0Data?.sip?.find((s: string) => s.startsWith('https://')) || req0Data?.sip?.[0] || ''
      const purl = midurlinfo?.purl || ''
      const vkey = midurlinfo?.vkey || ''
      const midFilename = midurlinfo?.filename || ''
      console.debug('[QQ] m4a trial result:', midurlinfo?.result, 'purl:', purl.slice(0, 40), 'vkey:', vkey.slice(0, 20))
      if (purl && sip) {
        return { songmid, url: sip + purl, br: 96000, canPlay: true, reason: 'trial', fee: 1, code: 0, type: 'm4a', msg: 'VIP试听30秒' }
      }
      if (vkey && midFilename && sip) {
        return { songmid, url: `${sip}${midFilename}?vkey=${vkey}&guid=${trialGuid}&fromtag=66`, br: 96000, canPlay: true, reason: 'trial', fee: 1, code: 0, type: 'm4a', msg: 'VIP试听30秒' }
      }
    } catch (e: any) {
      console.error('[QQ] m4a trial error:', e.message || e)
    }
    return null
  }

  /**
   * Get lyrics for a song by songmid.
   */
  async getLyric(songmid: string): Promise<LyricResult | null> {
    for (let retry = 0; retry < 2; retry++) {
      try {
        if (retry > 0) {
          console.debug('[QQ] Retrying getLyric for songmid:', songmid, 'retry:', retry)
          await new Promise(r => setTimeout(r, 1000 * retry))
        }

        const headers: Record<string, string> = {
          'Referer': 'https://y.qq.com/portal/player.html',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        if (this.isLoggedIn()) {
          headers['Cookie'] = this.getCookieString()
        }

        const resp = await axios.get(QQ_LYRIC_URL, {
          params: {
            songmid,
            g_tk: 5381,
            format: 'json',
            inCharset: 'utf8',
            outCharset: 'utf8',
            nobase64: 0,
            pcachetime: Date.now()
          },
          headers,
          timeout: 10000
        })

        let data = resp.data
        // Handle JSONP response (QQ Music may wrap in callback even with format=json)
        if (typeof data === 'string') {
          data = data.replace(/^callback\(|MusicJsonCallback\(|jsonCallback\(|\)$/g, '')
          data = JSON.parse(data)
        }

        // QQ Music returns lyrics as base64-encoded strings (nobase64=0)
        const lyric = data?.lyric ? Buffer.from(data.lyric, 'base64').toString('utf-8') : undefined
        const trans = data?.trans ? Buffer.from(data.trans, 'base64').toString('utf-8') : undefined

        console.debug('[QQ] getLyric response ret:', data?.ret, 'lyric length:', lyric?.length || 0, 'trans length:', trans?.length || 0)

        return {
          lyric,
          trans,
          code: data?.ret || 0
        }
      } catch (e: any) {
        const isNetworkError = e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET' || e?.message?.includes('connect')
        if (isNetworkError && retry < 1) {
          console.warn('[QQ] Network error for getLyric, will retry:', e.message || e)
          continue
        }
        console.error('[QQ] getLyric failed:', e)
        return null
      }
    }
    return null
  }

  /**
   * Search for songs by keywords.
   */
  async search(keywords: string, limit = 20): Promise<any[]> {
    try {
      const reqData = {
        comm: { ct: '19', cv: '1859' },
        req: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicLite',
          param: {
            query: keywords,
            page_num: 1,
            page_size: limit,
            grp: 1
          }
        }
      }

      const resp = await this.musicuRequest(reqData, false)
      const songs = resp?.req?.data?.body?.song?.list || resp?.req?.data?.song?.list || []

      console.debug('[QQ] Search returned', songs.length, 'results for:', keywords)
      return songs
    } catch (e) {
      console.error('[QQ] search failed:', e)
      return []
    }
  }

  /**
   * Logout — clear cookies from memory, disk, and the login session.
   */
  async logout(): Promise<void> {
    this.cookies = []
    this.saveCookies()

    // Clear the persistent login session
    try {
      const ses = session.fromPartition('persist:qq-login')
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'shadercache', 'serviceworkers', 'cachestorage'],
      })
      console.debug('[QQ] Cleared login session storage data')
    } catch (e) {
      console.error('[QQ] Failed to clear login session:', e)
    }

    // Also clear the default session cookies for qq.com
    try {
      const defaultSes = session.defaultSession
      const domains = ['https://y.qq.com', 'https://qq.com']
      for (const d of domains) {
        const cookies = await defaultSes.cookies.get({ url: d })
        for (const cookie of cookies) {
          await defaultSes.cookies.remove(d, cookie.name)
        }
      }
      console.debug('[QQ] Cleared default session cookies')
    } catch (e) {
      console.error('[QQ] Failed to clear default session cookies:', e)
    }

    // Delete the cookie file from disk
    try {
      if (existsSync(this.cookiePath)) {
        unlinkSync(this.cookiePath)
        console.debug('[QQ] Deleted cookie file:', this.cookiePath)
      }
    } catch (e) {
      console.error('[QQ] Failed to delete cookie file:', e)
    }
  }
}
