/**
 * Netease Sync Manager — lightweight background polling.
 *
 * Ensures that liked-song and playlist changes made in OTHER clients
 * (phone, web, desktop) are reflected in BeatZ Fit with minimal latency,
 * while keeping network/perf overhead negligible.
 *
 * Design:
 *   - Polls likedSongIds + userPlaylists every 60s.
 *   - On the FIRST poll, stores baselines silently (no event/action).
 *   - On subsequent polls, compares IDs:
 *     • Liked songs changed → calls refreshLikedListFromExternal() directly
 *       (NOT via 'beatzfit:neteaseDataChanged', to avoid a redundant server
 *       fetch after local toggleLike which already updated the Set optimistically).
 *     • Playlists changed → invalidates caches + dispatches
 *       'beatzfit:neteaseDataChanged' so DualDeckHome refreshes.
 *   - Pauses entirely when the document is hidden (window minimized / tab
 *     switched), resumes 2s after focus.
 *   - Only active when the user is logged in to Netease.
 *   - Module-level singleton: safe to call from multiple components, the
 *     interval is started once.
 */
import { onScopeDispose } from 'vue'
import { cacheInvalidatePrefix, CacheNS } from '@/modules/music/cache'
import { refreshLikedListFromExternal } from './useNeteaseLikes'

// ── Module-level singleton state ───────────────────────────
let _timer: ReturnType<typeof setTimeout> | null = null
let _started = false
let _initialized = false // false = baselines not yet captured
let _lastLikeIds: Set<number> = new Set()
let _lastPlaylistIds: Set<number> = new Set()

const POLL_INTERVAL_MS = 60_000 // 60s — short enough for near-real-time, long enough to avoid rate limits

function _clearTimer() {
  if (_timer) {
    clearTimeout(_timer)
    _timer = null
  }
}

function _scheduleNext() {
  // Guard: don't schedule if stopped (prevents re-entrancy after onScopeDispose)
  if (!_started) return
  _clearTimer()
  _timer = setTimeout(_poll, POLL_INTERVAL_MS)
}

async function _poll() {
  // Abort if document is hidden (window minimized / tab inactive)
  if (document.hidden) {
    if (_started) _timer = setTimeout(_poll, 15_000)
    return
  }

  try {
    if (!window.electronAPI?.netease) {
      _scheduleNext()
      return
    }

    // Check login status (cheap, cached 60s by useNeteaseStatus)
    const loginRes = await window.electronAPI.netease.getLoginStatus()
    if (!loginRes.success || !loginRes.data?.isLoggedIn || !loginRes.data.userInfo) {
      _scheduleNext()
      return
    }
    const uid = loginRes.data.userInfo.userId

    // 1) Liked-song IDs
    {
      const res = await window.electronAPI.netease.getLikelist(uid)
      if (res.success && res.data?.ids) {
        const newSet = new Set(res.data.ids)
        if (!_initialized) {
          _lastLikeIds = newSet
        } else if (!_setsEqual(_lastLikeIds, newSet)) {
          _lastLikeIds = newSet
          // Directly refresh the liked-song Set — no event dispatch needed
          refreshLikedListFromExternal()
        }
      }
    }

    // 2) User playlists
    {
      const res = await window.electronAPI.netease.getUserPlaylists(uid)
      if (res.success && res.data?.playlists) {
        const newSet = new Set(res.data.playlists.map((p) => p.id))
        if (!_initialized) {
          _lastPlaylistIds = newSet
        } else if (!_setsEqual(_lastPlaylistIds, newSet)) {
          _lastPlaylistIds = newSet
          _dispatchPlaylistChange()
        }
      }
    }

    // After both calls complete successfully, mark as initialized
    _initialized = true
  } catch (e) {
    console.error('[NeteaseSyncManager] Poll failed:', e)
  } finally {
    _scheduleNext()
  }
}

function _setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

function _dispatchPlaylistChange() {
  cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
  cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, '')
  window.dispatchEvent(new CustomEvent('beatzfit:neteaseDataChanged'))
}

function _onVisibilityChange() {
  if (document.hidden) {
    _clearTimer()
  } else if (_started) {
    // Resume shortly after focus
    _clearTimer()
    _timer = setTimeout(_poll, 2_000)
  }
}

/**
 * Start the background sync.  Call once from a long-lived component (App.vue).
 * Safe to call multiple times — the singleton guard prevents duplicate timers.
 */
export function useNeteaseSyncManager() {
  if (!_started) {
    _started = true
    document.addEventListener('visibilitychange', _onVisibilityChange)
    // Delay first poll 5s to avoid competing with app startup API calls
    _timer = setTimeout(_poll, 5_000)
  }

  onScopeDispose(() => {
    _clearTimer()
    document.removeEventListener('visibilitychange', _onVisibilityChange)
    _started = false
    _initialized = false
    _lastLikeIds = new Set()
    _lastPlaylistIds = new Set()
  })
}
