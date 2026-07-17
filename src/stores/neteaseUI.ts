import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * UI state persistence for the Netease music library card.
 *
 * The user's last expanded playlist needs to survive page navigations and
 * even an app restart — otherwise the "I just opened this playlist, I
 * click back to the home page, I click back to the music library, and
 * the list collapses" experience. We persist a tiny JSON blob to
 * localStorage and re-hydrate in `onMounted` (NOT at module top level —
 * localStorage is a browser API, so reading at import time would crash
 * if the module were ever SSR'd).
 */

const STORAGE_KEY = 'beatzfit:netease-ui:v1'

interface PersistedUI {
  /** Last playlist the user opened. Used to auto-expand on revisit. */
  lastExpandedPlaylistId: number | null
  /** Scroll offset inside the expanded playlist track list. */
  detailScrollTop: number
  /** Timestamp the state was last saved; lets us expire stale entries. */
  savedAt: number
}

const EMPTY_STATE: PersistedUI = {
  lastExpandedPlaylistId: null,
  detailScrollTop: 0,
  savedAt: 0
}

function loadFromStorage(): PersistedUI {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_STATE }
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_STATE }
    return {
      lastExpandedPlaylistId:
        typeof parsed.lastExpandedPlaylistId === 'number'
          ? parsed.lastExpandedPlaylistId
          : null,
      detailScrollTop:
        typeof parsed.detailScrollTop === 'number' ? parsed.detailScrollTop : 0,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
    }
  } catch (e) {
    console.warn('[neteaseUI] Failed to parse persisted UI state:', e)
    return { ...EMPTY_STATE }
  }
}

function saveToStorage(state: PersistedUI): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    // localStorage can throw in private-browsing or quota-exceeded
    // scenarios. The persisted state is a UX nicety, not a correctness
    // requirement, so log and move on.
    console.warn('[neteaseUI] Failed to save UI state to localStorage:', e)
  }
}

export const useNeteaseUIStore = defineStore('netease-ui', () => {
  const lastExpandedPlaylistId = ref<number | null>(null)
  const detailScrollTop = ref(0)
  const hydrated = ref(false)

  function hydrate() {
    if (hydrated.value) return
    const saved = loadFromStorage()
    lastExpandedPlaylistId.value = saved.lastExpandedPlaylistId
    detailScrollTop.value = saved.detailScrollTop
    hydrated.value = true
  }

  function persist() {
    saveToStorage({
      lastExpandedPlaylistId: lastExpandedPlaylistId.value,
      detailScrollTop: detailScrollTop.value,
      savedAt: Date.now()
    })
  }

  function setExpandedPlaylist(id: number | null) {
    lastExpandedPlaylistId.value = id
    if (id === null) detailScrollTop.value = 0
    persist()
  }

  function setDetailScrollTop(top: number) {
    detailScrollTop.value = top
    // Don't write to localStorage on every scroll tick — too much
    // thrash. Persist on unmount via persistScrollTop() below.
  }

  /**
   * Force-write the current state to localStorage. Call this from a
   * component's onBeforeUnmount hook so the final scroll position
   * survives navigation.
   */
  function persistScrollTop() {
    persist()
  }

  /**
   * Compare the freshly-loaded list against the persisted last-expanded
   * ID and return the playlist if it's still in the list, or null.
   * Callers use this to re-open the previously-selected playlist without
   * triggering a network request.
   */
  function maybeRestoreExpanded<T extends { id: number }>(playlists: T[]): T | null {
    if (lastExpandedPlaylistId.value == null) return null
    return playlists.find(p => p.id === lastExpandedPlaylistId.value) || null
  }

  function reset() {
    lastExpandedPlaylistId.value = null
    detailScrollTop.value = 0
    persist()
  }

  return {
    lastExpandedPlaylistId,
    detailScrollTop,
    hydrated,
    hydrate,
    setExpandedPlaylist,
    setDetailScrollTop,
    persistScrollTop,
    maybeRestoreExpanded,
    reset
  }
})
