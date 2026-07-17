/**
 * Renderer-side cache wrapper.
 *
 * Three concerns rolled into one small primitive:
 *   1. LRU eviction — bounds memory by dropping the least-recently-used
 *      entry once `maxEntries` is reached.
 *   2. TTL — every entry carries an `expiresAt` timestamp. Reads after that
 *      are treated as a miss and trigger a re-fetch.
 *   3. Deduplication — concurrent `cachedFetch(key, …)` calls for the same
 *      key share a single in-flight Promise. This stops the "user clicks
 *      the playlist, then clicks again 50ms later, both fire IPC" race.
 *
 * The cache is also the place where writers (deletePlan, importMusic, …)
 * are expected to call `cacheInvalidatePrefix` so subsequent reads see the
 * mutation.
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
  insertedAt: number
}

const CACHE_VERSION = 2

const stores = new Map<string, Map<string, CacheEntry<any>>>()
const inflight = new Map<string, Promise<any>>()
const stats = {
  hits: 0,
  misses: 0,
  dedup: 0,
  sets: 0,
  evictions: 0,
  invalidations: 0
}

const DEFAULT_MAX_ENTRIES_PER_NAMESPACE = 64

function getStore(namespace: string): Map<string, CacheEntry<any>> {
  let s = stores.get(namespace)
  if (!s) {
    s = new Map()
    stores.set(namespace, s)
  }
  return s
}

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && entry.expiresAt > Date.now()
}

function touchAndPromote<T>(store: Map<string, CacheEntry<T>>, key: string) {
  const entry = store.get(key)
  if (entry) {
    // Map preserves insertion order. Re-inserting moves the entry to the
    // tail so it becomes the most-recently-used.
    store.delete(key)
    store.set(key, entry)
  }
}

function evictIfNeeded(store: Map<string, CacheEntry<any>>, namespace: string) {
  const max = DEFAULT_MAX_ENTRIES_PER_NAMESPACE
  while (store.size > max) {
    const oldestKey = store.keys().next().value
    if (oldestKey === undefined) break
    store.delete(oldestKey)
    stats.evictions++
    if (typeof console !== 'undefined' && (stats.evictions % 50 === 0)) {
      console.debug(`[cache:${namespace}] evicted oldest key, total evictions:`, stats.evictions)
    }
  }
}

export interface CachedFetchOptions {
  /** TTL in milliseconds. 0 means "never expire" (rarely useful). */
  ttlMs: number
  /**
   * Force a re-fetch even if a fresh entry is present. Used by explicit
   * user refresh actions, not by ordinary data loads.
   */
  forceRefresh?: boolean
  /**
   * Optional per-key override of the namespace default. Keys are looked up
   * under `<namespace>:<key>` so two callers with the same logical key in
   * different namespaces can't collide.
   */
  keyPrefix?: string
}

/**
 * Fetch `value` for `key`, using the cache when possible.
 *
 * Concurrent calls for the same key share a single Promise — the second
 * caller gets the same result as the first instead of triggering another
 * IPC roundtrip.
 */
export async function cachedFetch<T>(
  namespace: string,
  key: string,
  fetcher: () => Promise<T>,
  options: CachedFetchOptions
): Promise<T> {
  const fullKey = options.keyPrefix ? `${options.keyPrefix}:${key}` : key
  const inflightKey = `${namespace}::${fullKey}`
  const store = getStore(namespace)

  if (!options.forceRefresh) {
    // Layer 1: in-memory cache
    const existing = store.get(fullKey)
    if (isFresh(existing)) {
      touchAndPromote(store, fullKey)
      stats.hits++
      return existing.value
    }
    if (existing) {
      // Expired — drop it so a stale value never leaks through.
      store.delete(fullKey)
    }
    // Layer 2: disk cache (localStorage)
    const diskValue = diskCacheGet<T>(namespace, fullKey)
    if (diskValue !== undefined) {
      // Populate memory cache from disk for faster subsequent reads
      store.set(fullKey, {
        value: diskValue,
        expiresAt: options.ttlMs > 0 ? Date.now() + options.ttlMs : Number.POSITIVE_INFINITY,
        insertedAt: Date.now()
      })
      stats.hits++
      return diskValue
    }
  }

  const pending = inflight.get(inflightKey)
  if (pending) {
    stats.dedup++
    return pending as Promise<T>
  }

  stats.misses++
  const promise = (async () => {
    try {
      const value = await fetcher()
      const expiresAt = options.ttlMs > 0 ? Date.now() + options.ttlMs : Number.POSITIVE_INFINITY
      store.set(fullKey, {
        value,
        expiresAt,
        insertedAt: Date.now()
      })
      stats.sets++
      evictIfNeeded(store, namespace)
      // Persist to disk cache (for whitelisted namespaces only)
      if (options.ttlMs > 0) {
        diskCacheSet(namespace, fullKey, value, options.ttlMs)
      }
      return value
    } finally {
      inflight.delete(inflightKey)
    }
  })()

  inflight.set(inflightKey, promise)
  return promise
}

/**
 * Drop every entry under `namespace` whose key starts with `prefix`.
 * Writers should call this after any mutation that could affect cached
 * reads.
 */
export function cacheInvalidatePrefix(namespace: string, prefix: string): number {
  const store = stores.get(namespace)
  let removed = 0
  if (store) {
    for (const key of Array.from(store.keys())) {
      if (key.startsWith(prefix)) {
        store.delete(key)
        removed++
      }
    }
  }
  // Also invalidate disk cache
  diskCacheInvalidatePrefix(namespace, prefix)
  if (removed > 0) stats.invalidations += removed
  return removed
}

/** Drop everything under a namespace. */
export function cacheInvalidateAll(namespace: string): number {
  const store = stores.get(namespace)
  if (!store) return 0
  const size = store.size
  store.clear()
  stats.invalidations += size
  return size
}

/** Drop everything. Mainly used by tests / settings "clear cache" actions. */
export function cacheClear(): void {
  for (const store of stores.values()) store.clear()
  inflight.clear()
}

export interface CacheStats {
  version: number
  hits: number
  misses: number
  dedup: number
  sets: number
  evictions: number
  invalidations: number
  namespaces: Record<string, { size: number; maxSize: number }>
  hitRate: number
}

export function getCacheStats(): CacheStats {
  const namespaces: Record<string, { size: number; maxSize: number }> = {}
  for (const [name, store] of stores.entries()) {
    namespaces[name] = { size: store.size, maxSize: DEFAULT_MAX_ENTRIES_PER_NAMESPACE }
  }
  const totalReads = stats.hits + stats.misses
  return {
    version: CACHE_VERSION,
    ...stats,
    namespaces,
    hitRate: totalReads === 0 ? 0 : stats.hits / totalReads
  }
}

export function resetCacheStats(): void {
  stats.hits = 0
  stats.misses = 0
  stats.dedup = 0
  stats.sets = 0
  stats.evictions = 0
  stats.invalidations = 0
}

// === TTL presets used across the app ===
//
// Numbers are tuned per surface: playlists change slowly, lyrics essentially
// never, song URLs expire in minutes, and DB-backed data should be near-zero
// TTL with explicit invalidation by the writer.
export const CacheTTL = {
  /** User playlists — change rarely, persisted to disk for fast startup. */
  PLAYLISTS: 30 * 60 * 1000,
  /** Track list inside a playlist — stable, persisted to disk. */
  PLAYLIST_DETAIL: 60 * 60 * 1000,
  /** Song playable URL — NetEase links expire within minutes. */
  SONG_URL: 5 * 60 * 1000,
  /** Lyrics — almost never change. */
  LYRICS: 24 * 60 * 60 * 1000,
  /** Local music library — only invalidated on import/delete. */
  LIBRARY: 60 * 60 * 1000,
  /** Workout plans / records — short TTL, writer invalidates. */
  PLANS: 30 * 1000,
  RECORDS: 30 * 1000,
  /** Exercise list — large dataset, only changes on explicit re-sync. */
  EXERCISES: 30 * 60 * 1000,
  /** Body parts / equipment — near-static. */
  CATEGORIES: 30 * 60 * 1000,
  /** On-disk lyrics files. */
  LYRIC_FILE: 60 * 60 * 1000
} as const

// === Common cache namespaces ===
// Centralized so callers don't free-text typo their own namespace.
export const CacheNS = {
  NeteasePlaylists: 'netease:playlists',
  NeteasePlaylistDetail: 'netease:playlistDetail',
  NeteaseSongUrl: 'netease:songUrl',
  NeteaseLyric: 'netease:lyric',
  QqPlaylists: 'qq:playlists',
  QqPlaylistDetail: 'qq:playlistDetail',
  QqSongUrl: 'qq:songUrl',
  QqLyric: 'qq:lyric',
  LocalLibrary: 'music:library',
  WorkoutPlans: 'workout:plans',
  WorkoutRecords: 'workout:records',
  Exercises: 'exercise:list',
  BodyParts: 'exercise:bodyParts',
  Equipments: 'exercise:equipments',
  LyricFile: 'music:lyricFile'
} as const

// ── Disk-persistent cache layer ──────────────────────────────
// Uses localStorage to persist Netease playlist/track data across
// app restarts. The image disk cache is handled in the main process
// (electron/main/ipc/music.ts serveRemoteImage), so this layer only
// covers structured data (playlists, track lists).
//
// Each entry is stored as: { value, expiresAt } in localStorage
// under key `beatzfit:diskcache:<namespace>:<key>`.
// We cap total entries and skip entries that are too large (>2MB).
const DISK_CACHE_PREFIX = 'beatzfit:diskcache:'
const DISK_CACHE_MAX_SIZE = 2 * 1024 * 1024 // 2MB per entry
const DISK_CACHE_NAMESPACES: ReadonlySet<string> = new Set<string>([
  CacheNS.NeteasePlaylists,
  CacheNS.NeteasePlaylistDetail,
  CacheNS.NeteaseLyric,
  CacheNS.QqPlaylists,
  CacheNS.QqPlaylistDetail,
  CacheNS.QqLyric,
])

interface DiskCacheEntry<T> {
  value: T
  expiresAt: number
}

/** Read from disk cache. Returns undefined on miss/expiry/error. */
export function diskCacheGet<T>(namespace: string, key: string): T | undefined {
  if (!DISK_CACHE_NAMESPACES.has(namespace)) return undefined
  try {
    const raw = localStorage.getItem(DISK_CACHE_PREFIX + namespace + ':' + key)
    if (!raw) return undefined
    const entry: DiskCacheEntry<T> = JSON.parse(raw)
    if (entry.expiresAt > Date.now()) {
      return entry.value
    }
    // Expired — clean up
    localStorage.removeItem(DISK_CACHE_PREFIX + namespace + ':' + key)
  } catch {
    // Corrupt entry — remove it
    try { localStorage.removeItem(DISK_CACHE_PREFIX + namespace + ':' + key) } catch (e) { console.warn('[diskCache] Failed to remove corrupt entry:', e) }
  }
  return undefined
}

/** Write to disk cache. Silently skips if data is too large or namespace not whitelisted. */
export function diskCacheSet<T>(namespace: string, key: string, value: T, ttlMs: number): void {
  if (!DISK_CACHE_NAMESPACES.has(namespace)) return
  try {
    const entry: DiskCacheEntry<T> = { value, expiresAt: Date.now() + ttlMs }
    const raw = JSON.stringify(entry)
    if (raw.length > DISK_CACHE_MAX_SIZE) return // Skip oversized entries
    localStorage.setItem(DISK_CACHE_PREFIX + namespace + ':' + key, raw)
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

/** Invalidate disk cache entries by namespace prefix. */
export function diskCacheInvalidatePrefix(namespace: string, prefix: string): void {
  if (!DISK_CACHE_NAMESPACES.has(namespace)) return
  const fullPrefix = DISK_CACHE_PREFIX + namespace + ':' + prefix
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(fullPrefix)) keysToRemove.push(k)
    }
    for (const k of keysToRemove) localStorage.removeItem(k)
  } catch (e) { console.warn('[diskCache] Failed to clear namespace:', e) }
}
