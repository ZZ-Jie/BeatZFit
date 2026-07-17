/**
 * Netease Cloud Music API Type Definitions
 *
 * Type definitions for all Netease Cloud Music API responses used in the app.
 * These replace the previous `any` types that were used for API return values.
 */

// ── User ──────────────────────────────────────────────────

export interface NeteaseUserInfo {
  userId: number
  nickname: string
  avatarUrl: string
  backgroundUrl?: string
  signature?: string
  followeds?: number
  follows?: number
  playlistCount?: number
  playlistBeSubscribedCount?: number
}

export interface NeteaseLoginStatus {
  isLoggedIn: boolean
  userInfo: NeteaseUserInfo | null
}

// ── Playlist ──────────────────────────────────────────────

export interface NeteasePlaylist {
  id: number
  name: string
  coverImgUrl: string
  trackCount: number
  playCount?: number
  creator?: {
    userId: number
    nickname: string
  }
  description?: string
  tags?: string[]
}

// ── Track ─────────────────────────────────────────────────

export interface NeteaseSong {
  id: number
  name: string
  ar: NeteaseArtist[]
  al: NeteaseAlbum
  dt: number // duration in ms
  no?: number // track number
}

export interface NeteaseArtist {
  id: number
  name: string
}

export interface NeteaseAlbum {
  id: number
  name: string
  picUrl?: string
}

// ── Song URL ──────────────────────────────────────────────

export interface NeteaseSongUrl {
  id: number
  url: string | null
  br?: number // bitrate
  size?: number
  type?: string // file extension
  fee?: number // 0=free, 1=VIP, 4=album, 8=low-quality free
  code?: number // 200=success, 404=not found
  freeTrialInfo?: { start: number; end: number } | null
  msg?: string
  canPlay?: boolean
  reason?: string
}

// ── Lyrics ────────────────────────────────────────────────

export interface NeteaseLyric {
  lrc?: { lyric: string }
  tlyric?: { lyric: string } // translation
  romalrc?: { lyric: string } // romanization
  code?: number
}

// ── Search ────────────────────────────────────────────────

export interface NeteaseSearchSong {
  id: number
  name: string
  artists: NeteaseArtist[]
  album: {
    id: number
    name: string
    artist: { id: number; name: string }
    picId?: number
    picUrl?: string
  }
  duration: number
}

// ── IPC Result Wrappers ───────────────────────────────────

export interface NeteaseLoginResult {
  success: boolean
  data?: NeteaseLoginStatus
}

export interface NeteasePlaylistsResult {
  success: boolean
  data?: { playlists: NeteasePlaylist[] }
}

export interface NeteasePlaylistDetailResult {
  success: boolean
  data?: { tracks: NeteaseSong[] }
}

export interface NeteaseSongUrlResult {
  success: boolean
  data?: { url: NeteaseSongUrl }
}

export interface NeteaseLyricResult {
  success: boolean
  data?: { lyric: NeteaseLyric }
}

export interface NeteaseSearchResult {
  success: boolean
  data?: { songs: NeteaseSearchSong[] }
}
