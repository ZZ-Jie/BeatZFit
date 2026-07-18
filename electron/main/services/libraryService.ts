import { dialog, app } from 'electron'
import { queryAll, queryOne, exec, persistDatabase } from '../db'
import { join, basename, extname, dirname } from 'path'
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, statSync } from 'fs'
import { createHash } from 'crypto'
import type { TrackRow, ImportResult } from '../db/schema'

export class LibraryService {
  private coverDir: string
  private lyricsDir: string

  constructor() {
    this.coverDir = join(app.getPath('userData'), 'covers')
    this.lyricsDir = join(app.getPath('userData'), 'lyrics')
    if (!existsSync(this.coverDir)) mkdirSync(this.coverDir, { recursive: true })
    if (!existsSync(this.lyricsDir)) mkdirSync(this.lyricsDir, { recursive: true })
  }

  async pickAudioFiles(): Promise<ImportResult> {
    const result = await dialog.showOpenDialog({
      title: '导入音乐文件',
      filters: [
        { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'm4a'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return { tracks: [], duplicates: [] }
    return this.importFiles(result.filePaths)
  }

  async pickFolder(): Promise<ImportResult> {
    const result = await dialog.showOpenDialog({
      title: '导入音乐文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { tracks: [], duplicates: [] }
    const audioFiles = this.scanFolderForAudio(result.filePaths[0])
    return this.importFiles(audioFiles)
  }

  private scanFolderForAudio(folderPath: string): string[] {
    const results: string[] = []
    const extSet = new Set(['.mp3', '.flac', '.wav', '.m4a'])

    try {
      const entries = readdirSync(folderPath, { withFileTypes: true, recursive: true })
      for (const entry of entries) {
        if (entry.isFile() && extSet.has(extname(entry.name).toLowerCase())) {
          const fullPath = join(entry.parentPath || folderPath, entry.name)
          results.push(fullPath)
        }
      }
    } catch (e) {
      console.error('Error scanning folder:', e)
    }

    return results
  }

  private makeTrackId(filePath: string): string {
    return 'local_' + createHash('md5').update(filePath).digest('hex').slice(0, 12)
  }

  /**
   * Compute a fast content fingerprint for an audio file.
   * Uses file size + first 128KB + last 128KB to detect identical file content
   * without reading the entire file into memory.
   */
  private computeContentHash(filePath: string): string {
    const stat = statSync(filePath)
    const fileSize = stat.size
    const SAMPLE_SIZE = 128 * 1024 // 128KB

    const fd = require('fs').openSync(filePath, 'r')
    try {
      const headBuf = Buffer.alloc(Math.min(SAMPLE_SIZE, fileSize))
      require('fs').readSync(fd, headBuf, 0, headBuf.length, 0)

      const tailBuf = Buffer.alloc(Math.min(SAMPLE_SIZE, fileSize))
      if (fileSize > SAMPLE_SIZE) {
        require('fs').readSync(fd, tailBuf, 0, tailBuf.length, Math.max(0, fileSize - SAMPLE_SIZE))
      }

      return createHash('md5')
        .update(`${fileSize}:${headBuf.toString('hex')}:${tailBuf.toString('hex')}`)
        .digest('hex')
    } finally {
      require('fs').closeSync(fd)
    }
  }

  private async importFiles(filePaths: string[]): Promise<ImportResult> {
    const tracks: TrackRow[] = []
    const duplicates: TrackRow[] = []

    for (const filePath of filePaths) {
      if (!existsSync(filePath)) continue

      // ── Check 1: Same file path (obviously the same file) ──
      const existingByPath = queryOne<TrackRow>('SELECT * FROM tracks WHERE local_path = ?', [filePath])
      if (existingByPath) {
        console.log('[Library] Skipping duplicate (same path):', filePath)
        duplicates.push(existingByPath)
        continue
      }

      // ── Check 2: Same content hash (different file name, same content) ──
      let contentHash: string
      try {
        contentHash = this.computeContentHash(filePath)
      } catch (e) {
        console.warn('[Library] Failed to compute content hash for', filePath, e)
        contentHash = ''
      }

      if (contentHash) {
        const existingByContent = queryOne<TrackRow>(
          'SELECT * FROM tracks WHERE content_hash = ? AND content_hash IS NOT NULL',
          [contentHash]
        )
        if (existingByContent) {
          // If the existing track has no cover, try to re-extract it
          // (covers a rare edge case where a previous upload failed to
          //  extract the cover image, leaving cover_path NULL).
          if (!existingByContent.cover_path || !existsSync(existingByContent.cover_path)) {
            try {
              const hash = createHash('md5').update(filePath).digest('hex').slice(0, 12)
              const mm = await this.tryParseMetadata(filePath, hash)
              if (mm.coverPath) {
                exec('UPDATE tracks SET cover_path = ? WHERE id = ?', [mm.coverPath, existingByContent.id])
                existingByContent.cover_path = mm.coverPath
                persistDatabase()
                console.log('[Library] Re-extracted cover for existing track:', existingByContent.id)
              }
            } catch (e) {
              console.warn('[Library] Failed to re-extract cover for duplicate:', e)
            }
          }
          console.log('[Library] Skipping duplicate (same content, different name):', filePath,
            '→ linked to existing track:', existingByContent.id)
          duplicates.push(existingByContent)
          continue
        }
      }

      try {
        const fileName = basename(filePath, extname(filePath))
        const hash = createHash('md5').update(filePath).digest('hex').slice(0, 12)
        const trackId = this.makeTrackId(filePath)

        let title = fileName
        let artist = 'Unknown Artist'
        let album = 'Unknown Album'
        let duration = 0
        let coverPath: string | null = null
        let lyricsPath: string | null = null

        try {
          const mm = await this.tryParseMetadata(filePath, hash)
          title = mm.title || title
          artist = mm.artist || artist
          album = mm.album || album
          duration = mm.duration || 0
          coverPath = mm.coverPath || null
        } catch (e) {
          console.warn('[Library] Metadata parse warning for', filePath, e)
        }

        // Try to find a sidecar .lrc file next to the audio file
        if (!lyricsPath) {
          try {
            const sidecarLyrics = this.findSidecarLyrics(filePath)
            if (sidecarLyrics) {
              const savedLyrics = join(this.lyricsDir, `${hash}.lrc`)
              writeFileSync(savedLyrics, sidecarLyrics)
              lyricsPath = savedLyrics
            }
          } catch (e) {
            console.warn('[Library] Failed to read sidecar lyrics:', e)
          }
        }

        const track: TrackRow = {
          id: trackId,
          title,
          artist,
          album,
          duration,
          cover_path: coverPath,
          source: 'local',
          source_id: null,
          local_path: filePath,
          lyrics_path: lyricsPath,
          added_at: new Date().toISOString(),
          last_played_at: null,
          content_hash: contentHash || null
        }

        exec(`
          INSERT OR REPLACE INTO tracks (id, title, artist, album, duration, cover_path, source, source_id, local_path, lyrics_path, added_at, last_played_at, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          track.id, track.title, track.artist, track.album, track.duration,
          track.cover_path, track.source, track.source_id, track.local_path,
          track.lyrics_path, track.added_at, track.last_played_at, track.content_hash
        ])

        tracks.push(track)
      } catch (e) {
        console.error(`[Library] Failed to import: ${filePath}`, e)
      }
    }

    if (tracks.length > 0) persistDatabase()
    return { tracks, duplicates }
  }

  private async tryParseMetadata(filePath: string, hash: string): Promise<{
    title?: string; artist?: string; album?: string; duration?: number; coverPath?: string
  }> {
    // Handle both ESM and bundled CJS module shapes.
    const mm: any = await import('music-metadata')
    const mod = (mm.default && typeof mm.default === 'object') ? mm.default : mm
    const parseFile = (mm.parseFile || mod.parseFile) as any
    const selectCoverFn = (mm.selectCover || mod.selectCover) as any

    if (!parseFile || typeof parseFile !== 'function') {
      throw new Error('music-metadata parseFile not found')
    }

    const metadata = await parseFile(filePath)

    const cover = selectCoverFn && typeof selectCoverFn === 'function'
      ? selectCoverFn(metadata.common.picture)
      : (metadata.common.picture?.[0] || undefined)

    let coverPath: string | undefined
    if (cover && cover.data) {
      const ext = cover.format?.toLowerCase().includes('png') ? 'png' : 'jpg'
      const coverFile = join(this.coverDir, `${hash}.${ext}`)
      try {
        writeFileSync(coverFile, cover.data)
        coverPath = coverFile
      } catch (e) {
        console.error('[Library] Failed to save cover image:', e)
      }
    }

    // Extract first artist if array is returned
    const artist = Array.isArray(metadata.common.artist)
      ? metadata.common.artist.join(', ')
      : metadata.common.artist

    return {
      title: metadata.common.title,
      artist,
      album: metadata.common.album,
      duration: metadata.format.duration,
      coverPath
    }
  }

  private findSidecarLyrics(filePath: string): string | null {
    const dir = dirname(filePath)
    const baseName = basename(filePath, extname(filePath))
    const candidates = [
      join(dir, `${baseName}.lrc`),
      join(dir, `${baseName}.txt`),
      join(dir, baseName + '歌词.lrc')
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return readFileSync(candidate, 'utf-8')
      }
    }
    return null
  }

  getLibrary(): TrackRow[] {
    return queryAll<TrackRow>('SELECT * FROM tracks ORDER BY added_at DESC')
  }

  deleteTrack(trackId: string): boolean {
    const track = queryOne<TrackRow>('SELECT * FROM tracks WHERE id = ?', [trackId])
    if (!track) return false

    try {
      // Clean up saved cover/lyrics files if they exist
      if (track.cover_path && existsSync(track.cover_path)) {
        try { unlinkSync(track.cover_path) } catch { /* ignore */ }
      }
      if (track.lyrics_path && existsSync(track.lyrics_path)) {
        try { unlinkSync(track.lyrics_path) } catch { /* ignore */ }
      }
    } catch (e) {
      console.warn('[Library] Failed to clean up track files:', e)
    }

    exec('DELETE FROM tracks WHERE id = ?', [trackId])
    persistDatabase()
    return true
  }

  clearLibrary(): number {
    const tracks = queryAll<TrackRow>('SELECT * FROM tracks')

    for (const track of tracks) {
      try {
        if (track.cover_path && existsSync(track.cover_path)) {
          try { unlinkSync(track.cover_path) } catch { /* ignore */ }
        }
        if (track.lyrics_path && existsSync(track.lyrics_path)) {
          try { unlinkSync(track.lyrics_path) } catch { /* ignore */ }
        }
      } catch (e) {
        console.warn('[Library] Failed to clean up track files:', e)
      }
    }

    // Also clear all playlists and playlist_tracks entries —
    // without tracks, playlists are orphaned references.
    exec('DELETE FROM playlist_tracks')
    exec('DELETE FROM playlists')
    exec('DELETE FROM tracks')
    persistDatabase()
    return tracks.length
  }

  updateLastPlayed(trackId: string): void {
    exec("UPDATE tracks SET last_played_at = datetime('now') WHERE id = ?", [trackId])
    persistDatabase()
  }
}
