import { defineStore } from 'pinia'
import { ref, shallowRef, markRaw, computed } from 'vue'
import type { Playlist, Track } from '@/types'

/**
 * Playlist Store — manages local playlist CRUD operations.
 *
 * Performance considerations:
 * - Playlists are cached in-memory after first load; subsequent reads
 *   return the cached array without IPC round-trips.
 * - Track lists within a playlist are fetched on-demand (only when the
 *   user opens the playlist detail view), not when listing all playlists.
 * - Mutations (add/remove tracks) update the cache locally and only
 *   persist to DB via IPC, avoiding a full re-fetch.
 */
export const usePlaylistStore = defineStore('playlist', () => {
  const playlists = shallowRef<Playlist[]>([])
  const isLoading = ref(false)
  const currentPlaylist = ref<Playlist | null>(null)
  const currentTracks = shallowRef<Track[]>([])
  const isDetailLoading = ref(false)

  const hasPlaylists = computed(() => playlists.value.length > 0)

  /** Load all playlists from the database (cached after first call). */
  async function loadPlaylists(force = false): Promise<void> {
    if (playlists.value.length > 0 && !force) return
    isLoading.value = true
    try {
      const result = await window.electronAPI!.playlist.list()
      if (result.success && result.data) {
        playlists.value = result.data.playlists.map(mapPlaylistRow)
      }
    } catch (e) {
      console.error('[playlist] Failed to load playlists:', e)
    } finally {
      isLoading.value = false
    }
  }

  /** Create a new playlist. */
  async function createPlaylist(name: string, description?: string): Promise<Playlist | null> {
    try {
      const result = await window.electronAPI!.playlist.create({ name, description })
      if (result.success && result.data) {
        const playlist = mapPlaylistRow(result.data.playlist)
        playlists.value = [playlist, ...playlists.value]
        return playlist
      }
      console.error('[playlist] Create failed:', result.error)
      return null
    } catch (e) {
      console.error('[playlist] Create error:', e)
      return null
    }
  }

  /** Load a single playlist with its tracks. */
  async function loadPlaylistDetail(id: string): Promise<void> {
    isDetailLoading.value = true
    try {
      const result = await window.electronAPI!.playlist.get(id)
      if (result.success && result.data) {
        currentPlaylist.value = mapPlaylistRow(result.data.playlist)
        currentTracks.value = result.data.tracks.map(mapTrackRow)
      }
    } catch (e) {
      console.error('[playlist] Failed to load detail:', e)
    } finally {
      isDetailLoading.value = false
    }
  }

  /** Update playlist metadata. */
  async function updatePlaylist(id: string, data: { name?: string; description?: string }): Promise<boolean> {
    try {
      const result = await window.electronAPI!.playlist.update(id, data)
      if (result.success && result.data) {
        const updated = mapPlaylistRow(result.data.playlist)
        const idx = playlists.value.findIndex(p => p.id === id)
        if (idx >= 0) playlists.value[idx] = updated
        if (currentPlaylist.value?.id === id) currentPlaylist.value = updated
        return true
      }
      return false
    } catch (e) {
      console.error('[playlist] Update error:', e)
      return false
    }
  }

  /** Delete a playlist. */
  async function deletePlaylist(id: string): Promise<boolean> {
    try {
      const result = await window.electronAPI!.playlist.delete(id)
      if (result.success) {
        playlists.value = playlists.value.filter(p => p.id !== id)
        if (currentPlaylist.value?.id === id) {
          currentPlaylist.value = null
          currentTracks.value = []
        }
        return true
      }
      return false
    } catch (e) {
      console.error('[playlist] Delete error:', e)
      return false
    }
  }

  /** Add tracks to a playlist. */
  async function addTracks(playlistId: string, trackIds: string[]): Promise<number> {
    try {
      const result = await window.electronAPI!.playlist.addTracks({ playlistId, trackIds })
      if (result.success && result.data) {
        const updated = mapPlaylistRow(result.data.playlist)
        const idx = playlists.value.findIndex(p => p.id === playlistId)
        if (idx >= 0) playlists.value[idx] = updated
        if (currentPlaylist.value?.id === playlistId) {
          currentPlaylist.value = updated
          // Reload tracks to reflect additions
          await loadPlaylistDetail(playlistId)
        }
        return result.data.addedCount || 0
      }
      return 0
    } catch (e) {
      console.error('[playlist] Add tracks error:', e)
      return 0
    }
  }

  /** Remove a track from a playlist. */
  async function removeTrack(playlistId: string, trackId: string): Promise<boolean> {
    try {
      const result = await window.electronAPI!.playlist.removeTrack({ playlistId, trackId })
      if (result.success && result.data) {
        const updated = mapPlaylistRow(result.data.playlist)
        const idx = playlists.value.findIndex(p => p.id === playlistId)
        if (idx >= 0) playlists.value[idx] = updated
        if (currentPlaylist.value?.id === playlistId) {
          currentPlaylist.value = updated
          currentTracks.value = currentTracks.value.filter(t => t.id !== trackId)
        }
        return true
      }
      return false
    } catch (e) {
      console.error('[playlist] Remove track error:', e)
      return false
    }
  }

  /** Set playlist cover image. */
  async function setCover(playlistId: string, coverPath: string): Promise<boolean> {
    try {
      const result = await window.electronAPI!.playlist.setCover({ playlistId, coverPath })
      if (result.success && result.data) {
        const updated = mapPlaylistRow(result.data.playlist)
        const idx = playlists.value.findIndex(p => p.id === playlistId)
        if (idx >= 0) playlists.value[idx] = updated
        if (currentPlaylist.value?.id === playlistId) currentPlaylist.value = updated
        return true
      }
      return false
    } catch (e) {
      console.error('[playlist] Set cover error:', e)
      return false
    }
  }

  /** Pick a cover image via file dialog. */
  async function pickCover(): Promise<string | null> {
    try {
      const result = await window.electronAPI!.playlist.pickCover()
      if (result.success && result.data) {
        return result.data.path
      }
      return null
    } catch (e) {
      console.error('[playlist] Pick cover error:', e)
      return null
    }
  }

  /** Clear current detail state. */
  function clearDetail(): void {
    currentPlaylist.value = null
    currentTracks.value = []
  }

  return {
    playlists, isLoading, currentPlaylist, currentTracks, isDetailLoading,
    hasPlaylists,
    loadPlaylists, createPlaylist, loadPlaylistDetail, updatePlaylist,
    deletePlaylist, addTracks, removeTrack, setCover, pickCover, clearDetail,
  }
})

// ── Row mappers ──────────────────────────────────────────────
// Convert snake_case DB rows to camelCase TS objects.

function mapPlaylistRow(row: any): Playlist {
  return markRaw({
    id: row.id,
    name: row.name,
    coverPath: row.cover_path || undefined,
    description: row.description || undefined,
    trackCount: row.track_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function mapTrackRow(row: any): Track {
  return markRaw({
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    coverPath: row.cover_path || undefined,
    source: row.source,
    sourceId: row.source_id || undefined,
    localPath: row.local_path,
    lyricsPath: row.lyrics_path || undefined,
    addedAt: row.added_at,
    lastPlayedAt: row.last_played_at || undefined,
  })
}
