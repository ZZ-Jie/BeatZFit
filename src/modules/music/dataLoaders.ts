/**
 * Cached IPC wrappers.
 *
 * Thin, typed wrappers around the most expensive electronAPI calls. The
 * goal is to give callers a one-line API that automatically benefits
 * from the in-memory LRU+TTL cache. Each wrapper is a function of the
 * arguments; the cache key is built from those arguments.
 *
 * Writers (deleteTrack, clearLibrary, createPlan, …) call the
 * corresponding invalidator after the IPC roundtrip succeeds. This
 * keeps the cache fresh without relying on TTL alone.
 */

import { cachedFetch, cacheInvalidatePrefix, CacheNS, CacheTTL } from './cache'

type LibraryTrack = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  cover_path?: string | null
  source?: string
  source_id?: string | null
  local_path?: string | null
  lyrics_path?: string | null
  added_at?: string | null
  last_played_at?: string | null
}

export async function loadLibraryCached(force = false) {
  return cachedFetch(
    CacheNS.LocalLibrary,
    'all',
    async () => {
      const result = await window.electronAPI!.music.getLibrary()
      if (!result.success || !result.data) return []
      return result.data.tracks as LibraryTrack[]
    },
    { ttlMs: CacheTTL.LIBRARY, forceRefresh: force }
  )
}

export async function loadLyricFileCached(lyricsPath: string) {
  return cachedFetch(
    CacheNS.LyricFile,
    lyricsPath,
    async () => {
      const result = await window.electronAPI!.music.readLyrics(lyricsPath)
      if (!result.success || !result.data) return null
      return result.data.lyrics as string
    },
    { ttlMs: CacheTTL.LYRIC_FILE }
  )
}

export async function loadExercisesCached(filter: any = {}, force = false) {
  return cachedFetch(
    CacheNS.Exercises,
    JSON.stringify(filter ?? {}),
    async () => {
      const result = await window.electronAPI!.exercise.list(filter)
      if (!result.success || !result.data) return []
      return result.data.exercises
    },
    { ttlMs: CacheTTL.EXERCISES, forceRefresh: force }
  )
}

export async function loadBodyPartsCached(force = false) {
  return cachedFetch(
    CacheNS.BodyParts,
    'all',
    async () => {
      const result = await window.electronAPI!.exercise.getBodyParts()
      if (!result.success || !result.data) return []
      return result.data.bodyParts
    },
    { ttlMs: CacheTTL.CATEGORIES, forceRefresh: force }
  )
}

export async function loadEquipmentsCached(force = false) {
  return cachedFetch(
    CacheNS.Equipments,
    'all',
    async () => {
      const result = await window.electronAPI!.exercise.getEquipments()
      if (!result.success || !result.data) return []
      return result.data.equipments
    },
    { ttlMs: CacheTTL.CATEGORIES, forceRefresh: force }
  )
}

export async function loadPlansCached(force = false) {
  return cachedFetch(
    CacheNS.WorkoutPlans,
    'all',
    async () => {
      const result = await window.electronAPI!.workout.listPlans()
      if (!result.success || !result.data) return []
      return result.data.plans
    },
    { ttlMs: CacheTTL.PLANS, forceRefresh: force }
  )
}

export async function loadPlanCached(id: string, force = false) {
  return cachedFetch(
    CacheNS.WorkoutPlans,
    `id:${id}`,
    async () => {
      const result = await window.electronAPI!.workout.getPlan(id)
      if (!result.success || !result.data) return null
      return result.data.plan
    },
    { ttlMs: CacheTTL.PLANS, forceRefresh: force }
  )
}

export async function loadRecordsCached(force = false) {
  return cachedFetch(
    CacheNS.WorkoutRecords,
    'all',
    async () => {
      const result = await window.electronAPI!.workout.listRecords()
      if (!result.success || !result.data) return []
      return result.data.records
    },
    { ttlMs: CacheTTL.RECORDS, forceRefresh: force }
  )
}

export async function loadStatsCached(force = false) {
  return cachedFetch(
    CacheNS.WorkoutRecords,
    'stats',
    async () => {
      const result = await window.electronAPI!.workout.getStats()
      if (!result.success || !result.data) return null
      return result.data.stats
    },
    { ttlMs: CacheTTL.RECORDS, forceRefresh: force }
  )
}

// === Invalidators (call these after any mutating IPC) ===

/** Monotonic counter — increments every time the library is invalidated.
 *  Components with module-level caches (e.g. DualDeckHome) can compare this
 *  value against their last-loaded version to detect stale data without
 *  making an IPC round-trip. */
let _libraryVersion = 0

export function getLibraryVersion(): number {
  return _libraryVersion
}

export function invalidateLibrary() {
  _libraryVersion++
  cacheInvalidatePrefix(CacheNS.LocalLibrary, '')
}

export function invalidateLyricFile(lyricsPath?: string) {
  if (lyricsPath) {
    cacheInvalidatePrefix(CacheNS.LyricFile, lyricsPath)
  } else {
    cacheInvalidatePrefix(CacheNS.LyricFile, '')
  }
}

export function invalidatePlans(id?: string) {
  cacheInvalidatePrefix(CacheNS.WorkoutPlans, 'all')
  cacheInvalidatePrefix(CacheNS.WorkoutRecords, 'stats')
  if (id) cacheInvalidatePrefix(CacheNS.WorkoutPlans, `id:${id}`)
}

export function invalidateRecords() {
  cacheInvalidatePrefix(CacheNS.WorkoutRecords, '')
}

export function invalidateExercises() {
  cacheInvalidatePrefix(CacheNS.Exercises, '')
  cacheInvalidatePrefix(CacheNS.BodyParts, '')
  cacheInvalidatePrefix(CacheNS.Equipments, '')
}
