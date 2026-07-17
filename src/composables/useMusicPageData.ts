/**
 * Module-level data store for MusicPage.
 *
 * In the horizontal single-page architecture, MusicPage is unmounted when the
 * user navigates away and re-mounted when they return. Vue SFC `<script setup>`
 * variables are component-scoped — they are recreated on every mount. This
 * composable holds the data at module level so it survives unmount/remount.
 *
 * Usage:
 *   const { tracks, loading, ... } = useMusicPageData()
 *   if (!tracks.value.length) await loadLibrary()
 */
import { shallowRef, ref, markRaw } from 'vue'
import type { Track } from '@/types'
import type { NeteasePlaylist } from '@/types/netease.d'
import type { QqPlaylist } from '@/types/qq.d'

// ── Module-level state (survives component unmount/remount) ──
const _tracks = shallowRef<Track[]>([])
const _loading = ref(true)
const _neteasePlaylists = ref<NeteasePlaylist[]>([])
const _neteaseLoginLoading = ref(false)
const _playlistTracksCache = shallowRef<Record<string, Track[]>>({})
const _neteaseTracksCache = shallowRef<Record<number, Track[]>>({})

// ── QQ Music state ──
const _qqPlaylists = ref<QqPlaylist[]>([])
const _qqLoginLoading = ref(false)
const _qqTracksCache = shallowRef<Record<string, Track[]>>({})

// Data loading flags — prevent redundant IPC calls on every mount
let _musicDataLoaded = false
let _musicDataLoading = false

export function useMusicPageData() {
  return {
    tracks: _tracks,
    loading: _loading,
    neteasePlaylists: _neteasePlaylists,
    neteaseLoginLoading: _neteaseLoginLoading,
    playlistTracksCache: _playlistTracksCache,
    neteaseTracksCache: _neteaseTracksCache,
    qqPlaylists: _qqPlaylists,
    qqLoginLoading: _qqLoginLoading,
    qqTracksCache: _qqTracksCache,
    musicDataLoaded: _musicDataLoaded,
    musicDataLoading: _musicDataLoading,
    setMusicDataLoaded(v: boolean) { _musicDataLoaded = v },
    setMusicDataLoading(v: boolean) { _musicDataLoading = v },
    /**
     * Reset all cached data. Called when the library is invalidated
     * (e.g. after importing/deleting tracks).
     */
    resetAll() {
      _tracks.value = []
      _playlistTracksCache.value = {}
      _neteaseTracksCache.value = {}
      _neteasePlaylists.value = []
      _qqTracksCache.value = {}
      _qqPlaylists.value = []
      _musicDataLoaded = false
      _musicDataLoading = false
      _loading.value = true
    },
    /**
     * Reset only local library data (tracks + local playlist caches).
     * NetEase / QQ Music data is untouched — those are remote-sourced and
     * must survive a local-library clear.
     */
    resetLocalOnly() {
      _tracks.value = []
      _playlistTracksCache.value = {}
      _loading.value = false // library is empty, no need for skeleton
      // Keep _musicDataLoaded = true so onMounted fast-path still runs
      // and re-uses cached netease/qq data without re-fetching.
    },
    markRaw,
  }
}
