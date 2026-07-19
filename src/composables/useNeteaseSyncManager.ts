/**
 * Netease Sync Manager — lightweight background polling.
 *
 * Ensures that liked-song and playlist changes made in OTHER clients
 * (phone, web, desktop) are reflected in BeatZ Fit with minimal latency,
 * while keeping network/perf overhead negligible.
 *
 * Design:
 *   - Polls likedSongIds + userPlaylists every 60s.
 *   - On the FIRST poll after login, stores baselines silently (no event).
 *   - On subsequent polls, compares:
 *     • Liked-song IDs: set equality → refreshLikedListFromExternal()
 *     • Playlist signatures: `id:trackCount` map (NOT just IDs, because
 *       adding songs to an existing playlist changes trackCount but not
 *       the playlist ID). On change → invalidate ALL playlist detail
 *       caches + dispatch 'beatzfit:neteaseDataChanged'.
 *   - Pauses entirely when the document is hidden, resumes 2s after focus.
 *   - Listens for 'beatzfit:neteaseLoginChanged' to reset baselines on
 *     re-login (otherwise the old baseline would mask real changes).
 *   - Module-level singleton: safe to call from multiple components.
 */
import { onScopeDispose } from 'vue'
import { cacheInvalidatePrefix, CacheNS } from '@/modules/music/cache'
import { refreshLikedListFromExternal } from './useNeteaseLikes'

// ── Module-level singleton state ───────────────────────────
let _timer: ReturnType<typeof setTimeout> | null = null
let _started = false
let _initialized = false // false = baselines not yet captured (after login)
let _lastLikeIds: Set<number> = new Set()
let _lastPlaylistSig: Map<number, number> = new Map() // playlistId → trackCount

const POLL_INTERVAL_MS = 60_000 // 60s

function _clearTimer() {
  if (_timer) {
    clearTimeout(_timer)
    _timer = null
  }
}

function _scheduleNext() {
  if (!_started) return
  _clearTimer()
  _timer = setTimeout(_poll, POLL_INTERVAL_MS)
}

/** Reset baselines — called on login/logout so the next poll captures a fresh baseline. */
function _resetBaselines() {
  _initialized = false
  _lastLikeIds = new Set()
  _lastPlaylistSig = new Map()
}

function _onLoginChanged(e: Event) {
  const detail = (e as CustomEvent).detail as { loggedIn: boolean } | undefined
  if (detail?.loggedIn) {
    // Re-login: reset baselines so changes are detected against the new account
    _resetBaselines()
    // Trigger an immediate poll to capture the new baseline quickly
    // Guard: only schedule if the manager is active (App.vue mounted)
    if (_started) {
      _clearTimer()
      _timer = setTimeout(_poll, 3_000)
    }
  } else {
    // Logout: clear baselines + stop polling until re-login
    // (avoids useless getLoginStatus calls every 60s while logged out)
    _clearTimer()
    _resetBaselines()
  }
}

async function _poll() {
  if (document.hidden) {
    if (_started) _timer = setTimeout(_poll, 15_000)
    return
  }

  try {
    if (!window.electronAPI?.netease) {
      _scheduleNext()
      return
    }

    // Check login status via IPC (bypasses useNeteaseStatus's 60s cache,
    // ensuring we detect re-login in another component immediately).
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
          // Refresh the shared likedSongIds Set — await to ensure it completes
          // within this poll cycle (the next poll compares against _lastLikeIds
          // which we just updated, so no risk of duplicate dispatch).
          await refreshLikedListFromExternal()
        }
      }
    }

    // 2) User playlists — compare id:trackCount signatures
    {
      const res = await window.electronAPI.netease.getUserPlaylists(uid)
      if (res.success && res.data?.playlists) {
        const newSig = new Map<number, number>()
        for (const p of res.data.playlists) {
          newSig.set(p.id, p.trackCount ?? 0)
        }
        if (!_initialized) {
          _lastPlaylistSig = newSig
        } else if (!_sigsEqual(_lastPlaylistSig, newSig)) {
          _lastPlaylistSig = newSig
          _dispatchPlaylistChange()
        }
      }
    }

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

function _sigsEqual(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false
  for (const [id, count] of a) {
    if (b.get(id) !== count) return false
  }
  return true
}

function _dispatchPlaylistChange() {
  // Invalidate BOTH playlist list and all playlist detail caches.
  // trackCount change means the tracks inside changed — detail cache is stale.
  cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
  cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, '')
  window.dispatchEvent(new CustomEvent('beatzfit:neteaseDataChanged'))
}

function _onVisibilityChange() {
  if (document.hidden) {
    _clearTimer()
  } else if (_started) {
    _clearTimer()
    _timer = setTimeout(_poll, 2_000)
  }
}

export function useNeteaseSyncManager() {
  if (!_started) {
    _started = true
    document.addEventListener('visibilitychange', _onVisibilityChange)
    window.addEventListener('beatzfit:neteaseLoginChanged', _onLoginChanged)
    _timer = setTimeout(_poll, 5_000)
  }

  onScopeDispose(() => {
    _clearTimer()
    document.removeEventListener('visibilitychange', _onVisibilityChange)
    window.removeEventListener('beatzfit:neteaseLoginChanged', _onLoginChanged)
    _started = false
    _resetBaselines()
  })
}
