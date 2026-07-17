/**
 * QQ Music API Type Definitions
 *
 * Type definitions for all QQ Music API responses used in the app.
 * Mirrors the structure of netease.d.ts for consistency.
 *
 * Key difference: QQ Music uses `songmid` (string) as the song identifier,
 * whereas Netease uses a numeric `id`.
 */

// ── User ──────────────────────────────────────────────────

export interface QqUserInfo {
  uin: string
  nickname: string
  avatarUrl: string
  level?: number
  vip?: boolean
}

export interface QqLoginStatus {
  isLoggedIn: boolean
  userInfo: QqUserInfo | null
}

// ── Playlist ──────────────────────────────────────────────

export interface QqPlaylist {
  id: string
  name: string
  coverImgUrl: string
  trackCount: number
  creator?: {
    uin: string
    nickname: string
  }
  description?: string
  tags?: string[]
}

// ── Track ─────────────────────────────────────────────────

export interface QqSong {
  songmid: string
  songid: number
  strMediaMid?: string // media mid used for filename construction in vkey requests
  name: string
  singer: QqArtist[]
  album: QqAlbum
  interval: number // duration in seconds
  trackNum?: number
  pay?: { payplay?: number; paydownload?: number; paytrackprice?: number; [key: string]: unknown }
  preview?: { trybegin?: number; tryend?: number; trysize?: number }
}

export interface QqArtist {
  id: number
  mid: string
  name: string
}

export interface QqAlbum {
  id: number
  mid: string
  name: string
  pmid?: string // album cover mid, used to build cover URL
}

// ── Song URL ──────────────────────────────────────────────

export interface QqSongUrl {
  songmid: string
  url: string
  br?: number // bitrate
  size?: number
  type?: string // file extension: 'mp3', 'flac', etc.
  canPlay: boolean
  reason?: string
  // VIP / fee info
  fee?: number // 0=free, 1=VIP
  code?: number
  msg?: string
}

// ── Lyrics ────────────────────────────────────────────────

export interface QqLyric {
  lyric?: string
  trans?: string // translation
  code?: number
}

// ── Search ────────────────────────────────────────────────

export interface QqSearchSong {
  songmid: string
  songid: number
  name: string
  singer: QqArtist[]
  album: { id: number; mid: string; name: string }
  interval: number
}

// ── IPC Result Wrappers ───────────────────────────────────

export interface QqLoginResult {
  success: boolean
  data?: QqLoginStatus
}

export interface QqPlaylistsResult {
  success: boolean
  data?: { playlists: QqPlaylist[] }
}

export interface QqPlaylistDetailResult {
  success: boolean
  data?: { tracks: QqSong[] }
}

export interface QqSongUrlResult {
  success: boolean
  data?: { url: QqSongUrl }
}

export interface QqLyricResult {
  success: boolean
  data?: { lyric: QqLyric }
}

export interface QqSearchResult {
  success: boolean
  data?: { songs: QqSearchSong[] }
}
