/**
 * Shared Netease login status composable.
 *
 * Multiple components (DualDeckHome, NeteaseLoginCard, UserCapsule) all need
 * to check Netease login status on mount. Without this shared cache, each
 * component independently calls the IPC → Netease API, resulting in 6-8
 * redundant `login_status` API calls within seconds of app startup.
 *
 * This composable caches the result for 60 seconds and deduplicates
 * in-flight requests so only one IPC call is made regardless of how many
 * components mount.
 */
import { ref } from 'vue'
import type { NeteaseUserInfo } from '@/types/netease.d'

const CACHE_TTL_MS = 60_000

const isLoggedIn = ref(false)
const userInfo = ref<NeteaseUserInfo | null>(null)
const lastCheckedAt = ref(0)
let inFlight: Promise<void> | null = null

export function useNeteaseStatus() {
  async function checkLoginStatus(force = false): Promise<void> {
    if (!window.electronAPI?.netease) return

    // Return cached result if fresh enough
    if (!force && Date.now() - lastCheckedAt.value < CACHE_TTL_MS) return

    // Deduplicate in-flight requests
    if (inFlight) return inFlight

    inFlight = (async () => {
      try {
        const result = await window.electronAPI!.netease.getLoginStatus()
        if (result.success && result.data) {
          isLoggedIn.value = result.data.isLoggedIn
          userInfo.value = result.data.userInfo
        }
      } catch (e) {
        console.error('[useNeteaseStatus] Check login status failed:', e)
      } finally {
        lastCheckedAt.value = Date.now()
        inFlight = null
      }
    })()

    return inFlight
  }

  function clearStatus() {
    isLoggedIn.value = false
    userInfo.value = null
    lastCheckedAt.value = 0
  }

  return {
    isLoggedIn,
    userInfo,
    checkLoginStatus,
    clearStatus,
  }
}
