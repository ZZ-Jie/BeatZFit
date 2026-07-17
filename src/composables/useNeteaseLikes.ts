/**
 * Shared Netease liked-song IDs composable.
 *
 * Centralizes the "liked songs" Set so that every component that displays
 * netease tracks (GlobalSearchBar, SongCoverflow, MusicPage, …) shares the
 * same reactive state.  When a like/unlike action happens anywhere in the
 * app, all consumers update instantly — no manual event wiring needed.
 *
 * The composable also handles:
 *   - Cache invalidation (NeteasePlaylists + NeteasePlaylistDetail)
 *   - Global CustomEvent dispatch ('beatzfit:neteaseDataChanged')
 *   - Lazy loading of the liked-list on first access
 */
import { ref } from 'vue'
import { useNeteaseStatus } from './useNeteaseStatus'
import { cacheInvalidatePrefix, CacheNS } from '@/modules/music/cache'

// ── Module-level shared state ────────────────────────────────
const likedSongIds = ref<Set<number>>(new Set())
let _loaded = false
let _loadPromise: Promise<void> | null = null

export function useNeteaseLikes() {
  const { isLoggedIn, userInfo } = useNeteaseStatus()

  /** Load the liked-song ID set from the backend (once per login). */
  async function loadLikedList(force = false): Promise<void> {
    if (!force && _loaded) return
    if (!isLoggedIn.value || !userInfo.value?.userId) return
    if (!window.electronAPI?.netease?.getLikelist) return

    // Deduplicate concurrent calls
    if (_loadPromise && !force) return _loadPromise

    _loadPromise = (async () => {
      try {
        const result = await window.electronAPI.netease.getLikelist(userInfo.value.userId)
        if (result.success && result.data?.ids) {
          likedSongIds.value = new Set(result.data.ids)
        }
        _loaded = true
      } catch (e) {
        console.error('[useNeteaseLikes] Failed to load liked list:', e)
      } finally {
        _loadPromise = null
      }
    })()

    return _loadPromise
  }

  /** Check whether a song is liked. Reactive — re-evaluates when the Set changes. */
  function isLiked(songId: number | undefined): boolean {
    if (songId == null) return false
    return likedSongIds.value.has(songId)
  }

  /**
   * Toggle the like state of a song.
   * Returns `true` on success, `false` on failure.
   * On success: updates the shared Set, invalidates caches, and dispatches
   * the global event so all pages refresh.
   */
  async function toggleLike(songId: number, like: boolean): Promise<boolean> {
    if (!window.electronAPI?.netease?.like) return false
    try {
      const result = await window.electronAPI.netease.like(songId, like)
      if (result.success) {
        // Update the shared Set (creates a new Set to guarantee reactivity)
        const next = new Set(likedSongIds.value)
        if (like) {
          next.add(songId)
        } else {
          next.delete(songId)
        }
        likedSongIds.value = next

        // Invalidate caches so other pages see fresh data
        cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
        cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, '')

        // Notify listeners immediately — the likedSongIds Set update is instant,
        // and the cache invalidation ensures the next fetch gets fresh data.
        // For playlist detail refresh, DualDeckHome's onNeteaseDataChanged
        // will re-fetch and update the coverflow tracks.
        window.dispatchEvent(new CustomEvent('beatzfit:neteaseDataChanged'))
        return true
      }
      return false
    } catch (e) {
      console.error('[useNeteaseLikes] Toggle like failed:', e)
      return false
    }
  }

  /** Reset state (used on logout). */
  function reset() {
    likedSongIds.value = new Set()
    _loaded = false
  }

  return {
    likedSongIds,
    loadLikedList,
    isLiked,
    toggleLike,
    reset,
  }
}
