import { ipcMain, app, dialog } from 'electron'
import { queryOne, exec, persistDatabase, queryAll } from '../db'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, extname } from 'path'
import type { TrackRow } from '../db/schema'

// ── Lyrics storage ────────────────────────────────────────────
// Lyrics are saved to userData/lyrics/{trackId}.lrc
// The path is stored in tracks.lyrics_path and read via music:readLyrics
// ──────────────────────────────────────────────────────────────

function getLyricsDir(): string {
  return join(app.getPath('userData'), 'lyrics')
}

async function ensureLyricsDir(): Promise<void> {
  const dir = getLyricsDir()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

export function registerLyricsIPC() {
  // ── Save lyrics for a track ─────────────────────────────────
  // Saves the LRC text to a file and updates the track's lyrics_path.
  // If the track already has a lyrics_path, overwrite the file;
  // otherwise create a new file named {trackId}.lrc.
  ipcMain.handle('lyrics:save', async (_event, data: { trackId: string; lrcText: string; translation?: string }) => {
    try {
      const { trackId, lrcText } = data
      if (!lrcText || !lrcText.trim()) {
        return { success: false, error: '歌词内容不能为空' }
      }

      const track = queryOne<TrackRow>('SELECT * FROM tracks WHERE id = ?', [trackId])
      if (!track) return { success: false, error: '歌曲不存在' }

      await ensureLyricsDir()

      // Use existing path or create new one
      let lyricsPath = track.lyrics_path
      if (!lyricsPath) {
        lyricsPath = join(getLyricsDir(), `${trackId}.lrc`)
      }

      await writeFile(lyricsPath, lrcText, 'utf-8')

      // Update the track record
      exec('UPDATE tracks SET lyrics_path = ? WHERE id = ?', [lyricsPath, trackId])
      persistDatabase()

      return { success: true, data: { lyricsPath } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Search for lyrics online (via Netease) ──────────────────
  // Uses the Netease search API to find songs matching the title+artist,
  // then fetches lyrics for the best match. Returns both the raw LRC and
  // the matched song info so the UI can show a confirmation.
  ipcMain.handle('lyrics:searchOnline', async (_event, data: { title: string; artist?: string }) => {
    try {
      const { title, artist } = data
      if (!title) return { success: false, error: '歌曲标题不能为空' }

      // Build search keyword: "title artist"
      const keyword = artist ? `${title} ${artist}` : title

      // Use NeteaseCloudMusicApi search
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NeteaseAPI: any = require('NeteaseCloudMusicApi')

      const searchRes = await NeteaseAPI.search({
        keywords: keyword,
        limit: 5,
        type: 1, // songs
      })

      if (!searchRes?.body?.result?.songs || searchRes.body.result.songs.length === 0) {
        return { success: false, error: '未找到匹配的歌曲' }
      }

      // Return top 5 candidates for user selection
      const songs = searchRes.body.result.songs.map((s: any) => ({
        songId: s.id,
        title: s.name,
        artist: Array.isArray(s.artists) ? s.artists.map((a: any) => a.name).join(', ') : 'Unknown',
        album: s.album?.name || '',
        duration: (s.duration || 0) / 1000,
      }))

      return { success: true, data: { songs } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Fetch lyrics for a Netease song ─────────────────────────
  // Given a Netease songId, fetch the LRC + translation and return them
  // so the user can preview before saving.
  ipcMain.handle('lyrics:fetchBySongId', async (_event, songId: number) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NeteaseAPI: any = require('NeteaseCloudMusicApi')

      const lyricRes = await NeteaseAPI.lyric({ id: songId })
      const body = lyricRes?.body
      if (!body) return { success: false, error: '获取歌词失败' }

      const lrc = body.lrc?.lyric || ''
      const tlyric = body.tlyric?.lyric || ''

      if (!lrc) return { success: false, error: '该歌曲无歌词' }

      return {
        success: true,
        data: {
          lrc,
          translation: tlyric || null,
          hasTranslation: !!tlyric,
          nolyric: body.nolyric === true,
        }
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Clear lyrics for a track ────────────────────────────────
  ipcMain.handle('lyrics:clear', async (_event, trackId: string) => {
    try {
      const track = queryOne<TrackRow>('SELECT * FROM tracks WHERE id = ?', [trackId])
      if (!track) return { success: false, error: '歌曲不存在' }

      // We don't delete the file (it might be a sidecar .lrc), but we
      // clear the lyrics_path so the player won't load it.
      exec('UPDATE tracks SET lyrics_path = NULL WHERE id = ?', [trackId])
      persistDatabase()

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Pick LRC files and associate with specific tracks ──────
  // Opens a file picker for .lrc files. For each LRC file:
  // 1. Try to match by filename to ANY local track in the DB.
  // 2. If no match, associate with tracks from the provided trackIds list
  //    (round-robin if multiple tracks, or all to the single track).
  ipcMain.handle('lyrics:pickLrcForTracks', async (_event, data: { trackIds: string[] }) => {
    try {
      const { trackIds } = data
      if (!trackIds || trackIds.length === 0) {
        return { success: false, error: '未提供歌曲ID' }
      }

      const result = await dialog.showOpenDialog({
        title: '选择歌词文件',
        filters: [{ name: '歌词文件', extensions: ['lrc', 'txt'] }],
        properties: ['openFile', 'multiSelections'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: { matched: 0, unmatched: 0, total: 0, matchedTrackIds: [] } }
      }

      // Get all local tracks for filename matching
      const allTracks = queryAll<TrackRow>(
        "SELECT * FROM tracks WHERE source = 'local' OR source IS NULL OR source = ''"
      )

      // Build a map of filename (without extension) → track for ALL tracks
      const trackByName = new Map<string, TrackRow>()
      for (const t of allTracks) {
        if (t.local_path) {
          const filename = basename(t.local_path, extname(t.local_path))
          trackByName.set(filename.toLowerCase(), t)
        }
        if (t.title) {
          trackByName.set(t.title.toLowerCase(), t)
        }
      }

      // Get the provided tracks (for unmatched LRC association)
      const providedTracks: TrackRow[] = []
      for (const tid of trackIds) {
        const t = queryOne<TrackRow>('SELECT * FROM tracks WHERE id = ?', [tid])
        if (t) providedTracks.push(t)
      }

      await ensureLyricsDir()

      let matched = 0
      let unmatched = 0
      let unmatchedIdx = 0
      const matchedTrackIds: string[] = []

      for (const lrcFilePath of result.filePaths) {
        const lrcFilename = basename(lrcFilePath, extname(lrcFilePath))

        // 1. Try filename match against ALL tracks
        let track = trackByName.get(lrcFilename.toLowerCase())

        // 2. If no match, associate with provided tracks (round-robin)
        if (!track && providedTracks.length > 0) {
          track = providedTracks[unmatchedIdx % providedTracks.length]
          unmatchedIdx++
        }

        if (!track) {
          unmatched++
          continue
        }

        // Read the .lrc file content
        const lrcContent = await readFile(lrcFilePath, 'utf-8')
        if (!lrcContent.trim()) {
          unmatched++
          continue
        }

        // Save to the lyrics directory
        const lyricsPath = join(getLyricsDir(), `${track.id}.lrc`)
        await writeFile(lyricsPath, lrcContent, 'utf-8')

        // Update the track record
        exec('UPDATE tracks SET lyrics_path = ? WHERE id = ?', [lyricsPath, track.id])
        matchedTrackIds.push(track.id)
        matched++
      }

      if (matched > 0) {
        persistDatabase()
      }

      return {
        success: true,
        data: { matched, unmatched, total: result.filePaths.length, matchedTrackIds },
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
