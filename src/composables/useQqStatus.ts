/**
 * Shared QQ Music login status composable.
 *
 * Mirrors useNeteaseStatus: caches the result for 60 seconds and
 * deduplicates in-flight requests so only one IPC call is made
 * regardless of how many components mount.
 */
import { ref } from 'vue'
import type { QqUserInfo } from '@/types/qq.d'

const CACHE_TTL_MS = 60_000

const isLoggedIn = ref(false)
const userInfo = ref<QqUserInfo | null>(null)
const lastCheckedAt = ref(0)
let inFlight: Promise<void> | null = null

export function useQqStatus() {
  async function checkLoginStatus(force = false): Promise<void> {
    if (!window.electronAPI?.qq) return

    // Return cached result if fresh enough
    if (!force && Date.now() - lastCheckedAt.value < CACHE_TTL_MS) return

    // Deduplicate in-flight requests
    if (inFlight) return inFlight

    inFlight = (async () => {
      try {
        const result = await window.electronAPI!.qq.getLoginStatus()
        if (result.success && result.data) {
          isLoggedIn.value = result.data.isLoggedIn
          userInfo.value = result.data.userInfo
        }
      } catch (e) {
        console.error('[useQqStatus] Check login status failed:', e)
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
