import { ipcMain, dialog, app } from 'electron'
import { queryAll, queryOne, exec, persistDatabase } from '../db'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import type { PlaylistRow, TrackRow } from '../db/schema'

// ── Playlist cover storage ────────────────────────────────────
// Covers are saved to userData/playlist-covers/{playlistId}.jpg
// The path is stored in playlists.cover_path and exposed to the
// renderer via the beat:// protocol (same as track covers).
// ──────────────────────────────────────────────────────────────

function getPlaylistCoverDir(): string {
  return join(app.getPath('userData'), 'playlist-covers')
}

function ensureCoverDir(): void {
  const dir = getPlaylistCoverDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function generateId(): string {
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function registerPlaylistIPC() {
  // ── Create playlist ──────────────────────────────────────────
  ipcMain.handle('playlist:create', async (_event, data: { name: string; description?: string }) => {
    try {
      const name = (data.name || '').trim()
      if (!name) return { success: false, error: '歌单名称不能为空' }
      if (name.length > 50) return { success: false, error: '歌单名称不能超过50个字符' }

      // Check for duplicate name (case-insensitive)
      const existing = queryOne('SELECT id FROM playlists WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [name])
      if (existing) return { success: false, error: '已存在同名歌单' }

      const id = generateId()
      exec(`
        INSERT INTO playlists (id, name, description, track_count, created_at, updated_at)
        VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))
      `, [id, name, data.description || null])
      persistDatabase()

      const playlist = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [id])
      return { success: true, data: { playlist } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── List all playlists ───────────────────────────────────────
  ipcMain.handle('playlist:list', async () => {
    try {
      const playlists = queryAll<PlaylistRow>('SELECT * FROM playlists ORDER BY updated_at DESC')
      return { success: true, data: { playlists } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Get a single playlist with its tracks ───────────────────
  ipcMain.handle('playlist:get', async (_event, id: string) => {
    try {
      const playlist = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [id])
      if (!playlist) return { success: false, error: '歌单不存在' }

      // Join playlist_tracks with tracks to get full track info
      const tracks = queryAll<TrackRow>(`
        SELECT t.* FROM tracks t
        INNER JOIN playlist_tracks pt ON t.id = pt.track_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position ASC
      `, [id])

      return { success: true, data: { playlist, tracks } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Update playlist metadata ────────────────────────────────
  ipcMain.handle('playlist:update', async (_event, id: string, data: { name?: string; description?: string }) => {
    try {
      const playlist = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [id])
      if (!playlist) return { success: false, error: '歌单不存在' }

      const name = data.name !== undefined ? data.name.trim() : playlist.name
      if (!name) return { success: false, error: '歌单名称不能为空' }
      if (name.length > 50) return { success: false, error: '歌单名称不能超过50个字符' }

      // Check for duplicate name (excluding self)
      const existing = queryOne('SELECT id FROM playlists WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ? LIMIT 1', [name, id])
      if (existing) return { success: false, error: '已存在同名歌单' }

      const description = data.description !== undefined ? data.description : playlist.description
      exec(`
        UPDATE playlists SET name = ?, description = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [name, description, id])
      persistDatabase()

      const updated = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [id])
      return { success: true, data: { playlist: updated } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Delete playlist ──────────────────────────────────────────
  ipcMain.handle('playlist:delete', async (_event, id: string) => {
    try {
      const playlist = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [id])
      if (!playlist) return { success: false, error: '歌单不存在' }

      // Clean up cover image
      if (playlist.cover_path && existsSync(playlist.cover_path)) {
        try { unlinkSync(playlist.cover_path) } catch { /* ignore */ }
      }

      // Delete playlist_tracks entries (sql.js doesn't enforce FK CASCADE,
      // so we must manually delete)
      exec('DELETE FROM playlist_tracks WHERE playlist_id = ?', [id])
      exec('DELETE FROM playlists WHERE id = ?', [id])
      persistDatabase()

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Add track(s) to playlist ────────────────────────────────
  ipcMain.handle('playlist:addTracks', async (_event, data: { playlistId: string; trackIds: string[] }) => {
    try {
      const { playlistId, trackIds } = data
      if (!trackIds || trackIds.length === 0) return { success: false, error: '未选择歌曲' }

      const playlist = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [playlistId])
      if (!playlist) return { success: false, error: '歌单不存在' }

      // Get current max position
      const maxPos = queryOne<{ max_pos: number | null }>(
        'SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?', [playlistId]
      )
      let nextPos = (maxPos?.max_pos ?? -1) + 1

      let added = 0
      for (const trackId of trackIds) {
        // Skip if already in playlist (INSERT OR IGNORE via primary key)
        const existing = queryOne('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [playlistId, trackId])
        if (existing) continue

        exec(`
          INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
          VALUES (?, ?, ?, datetime('now'))
        `, [playlistId, trackId, nextPos])
        nextPos++
        added++
      }

      if (added > 0) {
        exec('UPDATE playlists SET track_count = track_count + ?, updated_at = datetime(\'now\') WHERE id = ?', [added, playlistId])

        // Auto-set cover from the first track if playlist has no custom cover
        if (!playlist.cover_path) {
          const firstTrack = queryOne<TrackRow>(
            `SELECT t.* FROM tracks t
             INNER JOIN playlist_tracks pt ON t.id = pt.track_id
             WHERE pt.playlist_id = ?
             ORDER BY pt.position ASC LIMIT 1`,
            [playlistId]
          )
          if (firstTrack?.cover_path) {
            // Copy the first track's cover to the playlist-covers directory
            ensureCoverDir()
            const { readFileSync } = require('fs')
            const ext = firstTrack.cover_path.split('.').pop()?.toLowerCase() || 'jpg'
            const destPath = join(getPlaylistCoverDir(), `${playlistId}.${ext}`)
            try {
              const imgBuffer = readFileSync(firstTrack.cover_path)
              writeFileSync(destPath, imgBuffer)
              exec('UPDATE playlists SET cover_path = ? WHERE id = ?', [destPath, playlistId])
            } catch (e) {
              console.warn('[Playlist] Failed to auto-set cover:', e)
            }
          }
        }

        persistDatabase()
      }

      const updated = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [playlistId])
      return { success: true, data: { playlist: updated, addedCount: added } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Remove track from playlist ──────────────────────────────
  ipcMain.handle('playlist:removeTrack', async (_event, data: { playlistId: string; trackId: string }) => {
    try {
      const { playlistId, trackId } = data

      exec('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [playlistId, trackId])

      // Re-index positions to avoid gaps
      const rows = queryAll<{ track_id: string }>(
        'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC', [playlistId]
      )
      rows.forEach((row, idx) => {
        exec('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?', [idx, playlistId, row.track_id])
      })

      exec('UPDATE playlists SET track_count = MAX(0, track_count - 1), updated_at = datetime(\'now\') WHERE id = ?', [playlistId])

      // Auto-update cover: if the playlist's cover was auto-set from a track
      // (i.e. stored in playlist-covers dir) and the removed track was the first one,
      // update the cover to the new first track's cover.
      const currentPlaylist = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [playlistId])
      if (currentPlaylist?.cover_path && currentPlaylist.cover_path.includes('playlist-covers')) {
        const firstTrack = queryOne<TrackRow>(
          `SELECT t.* FROM tracks t
           INNER JOIN playlist_tracks pt ON t.id = pt.track_id
           WHERE pt.playlist_id = ?
           ORDER BY pt.position ASC LIMIT 1`,
          [playlistId]
        )
        if (firstTrack?.cover_path) {
          // Only update if the cover source has changed
          ensureCoverDir()
          const ext = firstTrack.cover_path.split('.').pop()?.toLowerCase() || 'jpg'
          const destPath = join(getPlaylistCoverDir(), `${playlistId}.${ext}`)
          if (destPath !== currentPlaylist.cover_path) {
            try {
              const { readFileSync } = require('fs')
              const imgBuffer = readFileSync(firstTrack.cover_path)
              writeFileSync(destPath, imgBuffer)
              // Clean up old auto-cover if extension changed
              if (existsSync(currentPlaylist.cover_path)) {
                try { unlinkSync(currentPlaylist.cover_path) } catch { /* ignore */ }
              }
              exec('UPDATE playlists SET cover_path = ? WHERE id = ?', [destPath, playlistId])
            } catch (e) {
              console.warn('[Playlist] Failed to update auto-cover on track removal:', e)
            }
          }
        } else {
          // No tracks left — remove auto-cover
          if (existsSync(currentPlaylist.cover_path)) {
            try { unlinkSync(currentPlaylist.cover_path) } catch { /* ignore */ }
          }
          exec('UPDATE playlists SET cover_path = NULL WHERE id = ?', [playlistId])
        }
      }

      persistDatabase()

      const updated = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [playlistId])
      return { success: true, data: { playlist: updated } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Set playlist cover ───────────────────────────────────────
  ipcMain.handle('playlist:setCover', async (_event, data: { playlistId: string; coverPath: string }) => {
    try {
      const { playlistId, coverPath } = data
      const playlist = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [playlistId])
      if (!playlist) return { success: false, error: '歌单不存在' }

      ensureCoverDir()

      // Delete old cover if it's a local playlist cover
      if (playlist.cover_path && existsSync(playlist.cover_path)) {
        try { unlinkSync(playlist.cover_path) } catch { /* ignore */ }
      }

      // Copy the selected image to playlist-covers dir
      const { readFileSync } = require('fs')
      const ext = coverPath.split('.').pop()?.toLowerCase() || 'jpg'
      const destPath = join(getPlaylistCoverDir(), `${playlistId}.${ext}`)
      const imgBuffer = readFileSync(coverPath)
      writeFileSync(destPath, imgBuffer)

      exec('UPDATE playlists SET cover_path = ?, updated_at = datetime(\'now\') WHERE id = ?', [destPath, playlistId])
      persistDatabase()

      const updated = queryOne<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', [playlistId])
      return { success: true, data: { playlist: updated } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Pick cover image (open file dialog) ─────────────────────
  ipcMain.handle('playlist:pickCover', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择歌单封面',
        filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '未选择文件' }
      }
      return { success: true, data: { path: result.filePaths[0] } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Reorder track within playlist ───────────────────────────
  ipcMain.handle('playlist:reorderTrack', async (_event, data: { playlistId: string; fromTrackId: string; toTrackId: string }) => {
    try {
      const { playlistId, fromTrackId, toTrackId } = data

      const fromRow = queryOne<{ position: number }>(
        'SELECT position FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [playlistId, fromTrackId]
      )
      const toRow = queryOne<{ position: number }>(
        'SELECT position FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [playlistId, toTrackId]
      )
      if (!fromRow || !toRow) return { success: false, error: '歌曲不在歌单中' }

      // Swap positions
      exec('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?', [toRow.position, playlistId, fromTrackId])
      exec('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?', [fromRow.position, playlistId, toTrackId])
      persistDatabase()

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
