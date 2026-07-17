import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { queryAll, queryOne, exec, persistDatabase } from '../db'
import type { SqlValue } from 'sql.js'
import type { ExerciseRow } from '../db/schema'

// ── Data source ──────────────────────────────────────────────
// Exercise data is provided by ExerciseDB V1 API (Free Version)
//   API:  https://oss.exercisedb.dev/api/v1/exercises
//   GIFs: https://static.exercisedb.dev/media/{exerciseId}.gif
//   Docs: https://oss.exercisedb.dev/docs
//
// Attribution: Data provided by AscendAPI (https://ascendapi.com)
// License:     AGPL-3.0 — non-commercial use only
//
// The API uses cursor-based pagination (max 25 items per page).
// We loop through all pages using the `after` cursor to fetch the
// full 1,500 exercises.  A 600ms base delay between requests
// respects the strict rate limits; on 429 we use exponential
// backoff (3s → 6s → 12s → …) and increase the base delay to 1.5s.
//
// During sync, each batch of GIF URLs is verified via parallel HEAD
// requests.  Exercises whose GIF returns 404 are deleted from the DB
// (ExerciseDB has known data inconsistencies).  A summary of failed
// exercises is returned so the frontend can show a toast.
// ─────────────────────────────────────────────────────────────

/** Free V1 API endpoint (strict rate limits apply). */
const EXERCISEDB_API = 'https://oss.exercisedb.dev/api/v1/exercises'

/** Page size (API max is 25). */
const PAGE_SIZE = 25

/** Base delay between paginated requests (ms) — respects rate limits. */
const REQUEST_DELAY_MS = 600

/** Delay used after a rate-limit event (ms). */
const RATE_LIMITED_DELAY_MS = 1500

/** Progress callback type for streaming sync updates. */
export interface SyncProgress {
  fetched: number
  total: number
  failed: number
  /** Exercises inserted in the latest page (already in DB, GIF-verified). */
  newExercises: ExerciseRow[]
}

/** Final sync result returned to the caller. */
export interface SyncResult {
  total: number
  failed: number
  failedNames: string[]
}

/** Fallback CDN URL if the API omits gifUrl. */
function buildGifUrl(exerciseId: string): string {
  return `https://static.exercisedb.dev/media/${exerciseId}.gif`
}

/** GIF cache dir for negative caching (shared with music.ts). */
function getGifCacheDir(): string {
  return join(app.getPath('userData'), 'exercise-gif-cache')
}

/**
 * Verify a batch of GIF URLs via parallel HEAD requests.
 * Returns the set of exercise IDs whose GIF returned 404.
 * Also writes negative-cache marker files for 404s so the
 * beat:// protocol handler can skip future requests.
 */
async function verifyGifUrls(
  items: { id: string; gifUrl: string; name: string }[]
): Promise<Set<string>> {
  const failed = new Set<string>()
  const results = await Promise.allSettled(
    items.map(async (item) => {
      try {
        const res = await globalThis.fetch(item.gifUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10000),
          redirect: 'follow',
        })
        return { id: item.id, name: item.name, status: res.status }
      } catch {
        // Network error — treat as available (don't discard)
        return { id: item.id, name: item.name, status: 200 }
      }
    })
  )
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.status === 404) {
      failed.add(r.value.id)
      // Write negative cache marker
      const fileName = r.value.id + '.gif'
      const negPath = join(getGifCacheDir(), fileName + '.404')
      const dir = getGifCacheDir()
      if (!existsSync(dir)) {
        mkdir(dir, { recursive: true }).then(() =>
          writeFile(negPath, '1').catch(() => {})
        ).catch(() => {})
      } else {
        writeFile(negPath, '1').catch(() => {})
      }
    }
  }
  return failed
}

// ── exercisedb-api V1 data structure ─────────────────────────
interface ExerciseDBItem {
  exerciseId: string
  name: string
  gifUrl: string
  targetMuscles: string[]
  bodyParts: string[]
  equipments: string[]
  secondaryMuscles: string[]
  instructions: string[]
}

interface ExerciseDBResponse {
  success: boolean
  data: ExerciseDBItem[]
  meta: {
    total: number
    hasNextPage: boolean
    hasPreviousPage: boolean
    nextCursor: string | null
    previousCursor: string | null
  }
}

// ── Category mappings ────────────────────────────────────────

// User-facing body-part categories.
const BODY_PART_ORDER = ['胸', '肩', '背', '腿', '手臂', '核心', '全身', '拉伸']

// exercisedb-api bodyParts → canonical English key
const bodyPartMap: Record<string, string> = {
  chest: 'chest',
  shoulders: 'shoulders',
  back: 'back',
  'upper legs': 'legs',
  'lower legs': 'legs',
  'upper arms': 'arms',
  'lower arms': 'arms',
  waist: 'core',
  cardio: 'full body',
  neck: 'full body',
}

// Canonical English key → Chinese label
const partZhMap: Record<string, string> = {
  chest: '胸',
  shoulders: '肩',
  back: '背',
  legs: '腿',
  arms: '手臂',
  core: '核心',
  'full body': '全身',
  stretching: '拉伸',
}

// exercisedb-api equipment names → { Chinese label, canonical key }
// Complete mapping covering all 28 equipment types from the API.
const equipmentMap: Record<string, { zh: string; key: string }> = {
  'body weight': { zh: '徒手', key: 'body weight' },
  dumbbell: { zh: '哑铃', key: 'dumbbell' },
  barbell: { zh: '杠铃', key: 'barbell' },
  'olympic barbell': { zh: '杠铃', key: 'barbell' },
  'trap bar': { zh: '杠铃', key: 'barbell' },
  'ez barbell': { zh: '曲杠', key: 'ez barbell' },
  cable: { zh: '绳索', key: 'cable' },
  kettlebell: { zh: '壶铃', key: 'kettlebell' },
  'resistance band': { zh: '弹力带', key: 'resistance band' },
  band: { zh: '弹力带', key: 'resistance band' },
  'medicine ball': { zh: '药球', key: 'medicine ball' },
  'stability ball': { zh: '稳定球', key: 'stability ball' },
  'bosu ball': { zh: '稳定球', key: 'stability ball' },
  machine: { zh: '器械', key: 'machine' },
  'smith machine': { zh: '器械', key: 'machine' },
  'leverage machine': { zh: '器械', key: 'machine' },
  'sled machine': { zh: '器械', key: 'machine' },
  'upper body ergometer': { zh: '器械', key: 'machine' },
  'stepmill machine': { zh: '器械', key: 'machine' },
  'elliptical machine': { zh: '器械', key: 'machine' },
  'stationary bike': { zh: '器械', key: 'machine' },
  'skierg machine': { zh: '器械', key: 'machine' },
  // Additional equipment types from the API
  tire: { zh: '轮胎', key: 'tire' },
  'wheel roller': { zh: '滚轮', key: 'wheel roller' },
  hammer: { zh: '锤子', key: 'hammer' },
  roller: { zh: '泡沫轴', key: 'roller' },
  weighted: { zh: '负重', key: 'weighted' },
  rope: { zh: '绳索', key: 'rope' },
  assisted: { zh: '辅助', key: 'assisted' },
  // Everything else maps to "其他"
}

// Muscle names → Chinese (complete mapping from API /muscles endpoint)
const muscleZhMap: Record<string, string> = {
  abdominals: '腹肌',
  abs: '腹肌',
  'lower abs': '下腹',
  abductors: '外展肌',
  adductors: '内收肌',
  biceps: '肱二头肌',
  brachialis: '肱肌',
  calves: '小腿',
  chest: '胸肌',
  core: '核心',
  deltoids: '三角肌',
  delts: '三角肌',
  'rear deltoids': '后三角肌',
  forearms: '前臂',
  glutes: '臀肌',
  groin: '腹股沟',
  hamstrings: '腘绳肌',
  hip: '髋部',
  'hip flexors': '髂腰肌',
  'inner thighs': '大腿内侧',
  lats: '背阔肌',
  'latissimus dorsi': '背阔肌',
  'lower back': '下背部',
  'middle back': '中背部',
  'upper back': '上背部',
  neck: '颈部',
  obliques: '腹斜肌',
  pectorals: '胸肌',
  'upper chest': '上胸',
  quadriceps: '股四头肌',
  quads: '股四头肌',
  rhomboids: '菱形肌',
  'rotator cuff': '肩袖',
  serratus: '前锯肌',
  'serratus anterior': '前锯肌',
  shins: '胫骨',
  shoulders: '肩部',
  soleus: '比目鱼肌',
  spine: '脊柱',
  'sternocleidomastoid': '胸锁乳突肌',
  'levator scapulae': '肩胛提肌',
  traps: '斜方肌',
  trapezius: '斜方肌',
  triceps: '肱三头肌',
  wrists: '手腕',
  'wrist extensors': '腕伸肌',
  'wrist flexors': '腕屈肌',
  'grip muscles': '握力肌',
  hands: '手部',
  feet: '足部',
  ankles: '踝关节',
  'ankle stabilizers': '踝稳定肌',
  back: '背部',
  'cardiovascular system': '心血管系统',
}

function inferBodyPart(ex: ExerciseDBItem): { part: string; partZh: string } {
  const bp = ex.bodyParts?.[0]?.toLowerCase() || ''
  const key = bodyPartMap[bp]
  if (key) {
    return { part: key, partZh: partZhMap[key] || key }
  }
  return { part: 'full body', partZh: '全身' }
}

function inferEquipment(ex: ExerciseDBItem): { key: string; zh: string } {
  const raw = ex.equipments?.[0]?.toLowerCase() || 'body weight'
  return equipmentMap[raw] || { zh: '其他', key: 'other' }
}

/** Map a single ExerciseDBItem to DB column values. */
function mapExerciseToRow(ex: ExerciseDBItem) {
  const { part, partZh } = inferBodyPart(ex)
  const { key: eqKey, zh: eqZh } = inferEquipment(ex)
  const targetMuscle = ex.targetMuscles?.[0] || 'other'
  const targetZh = muscleZhMap[targetMuscle.toLowerCase()] || targetMuscle
  // Use the API-provided gifUrl directly; fall back to constructed URL
  // only if the API response is missing the field.
  const gifUrl = ex.gifUrl || buildGifUrl(ex.exerciseId)
  return {
    id: ex.exerciseId,
    name: ex.name,
    chinese_name: null,
    body_part: part,
    body_part_zh: partZh,
    equipment: eqKey,
    equipment_zh: eqZh,
    target: targetMuscle,
    target_zh: targetZh,
    gif_url: gifUrl,
    instructions: ex.instructions ? JSON.stringify(ex.instructions) : null,
    precautions_zh: null,
  }
}

/** Insert a batch of exercises into the DB (incremental, no DELETE). */
function insertExerciseBatch(exercises: ExerciseDBItem[]): ExerciseRow[] {
  const rows: ExerciseRow[] = []
  for (const ex of exercises) {
    const r = mapExerciseToRow(ex)
    exec(`
      INSERT OR REPLACE INTO cached_exercises
      (id, name, chinese_name, body_part, body_part_zh, equipment, equipment_zh, target, target_zh, gif_url, instructions, precautions_zh, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      r.id, r.name, r.chinese_name, r.body_part, r.body_part_zh,
      r.equipment, r.equipment_zh, r.target, r.target_zh, r.gif_url,
      r.instructions, r.precautions_zh,
    ])
    rows.push({
      id: r.id, name: r.name, chinese_name: r.chinese_name,
      body_part: r.body_part, body_part_zh: r.body_part_zh,
      equipment: r.equipment, equipment_zh: r.equipment_zh,
      target: r.target, target_zh: r.target_zh,
      gif_url: r.gif_url, instructions: r.instructions,
      precautions_zh: r.precautions_zh, cached_at: new Date().toISOString(),
    })
  }
  return rows
}

/** Sleep helper for rate-limit-friendly delays. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Service ──────────────────────────────────────────────────

export class ExerciseService {
  /** Guard to prevent concurrent syncFromAPI calls. */
  private _syncInProgress = false

  /**
   * Sync exercise data into the local DB by fetching all pages
   * from the free ExerciseDB V1 API using cursor-based pagination.
   *
   * Each page is inserted into the DB immediately, then GIF URLs
   * are verified via parallel HEAD requests.  Exercises whose GIF
   * returns 404 are deleted from the DB.  `onProgress` is called
   * with only the valid (GIF-verified) rows so the frontend never
   * shows cards for exercises without images.
   */
  async syncFromAPI(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
    // Prevent concurrent syncs — return empty result if already running
    if (this._syncInProgress) {
      console.warn('[ExerciseDB] Sync already in progress, skipping duplicate call')
      return { total: 0, failed: 0, failedNames: [] }
    }
    this._syncInProgress = true

    const result: SyncResult = { total: 0, failed: 0, failedNames: [] }

    // Mark sync as in-progress
    this.setSyncStatus('pending')

    let totalFetched = 0
    let cursor: string | null = null
    let page = 0
    const maxPages = 100 // Safety limit (25 × 100 = 2,500)
    let apiTotal = 1500 // Default estimate; updated from API meta
    let currentDelay = REQUEST_DELAY_MS
    let consecutive429 = 0
    const max429Retries = 5

    try {
      while (page < maxPages) {
        const url = cursor
          ? `${EXERCISEDB_API}?limit=${PAGE_SIZE}&after=${cursor}`
          : `${EXERCISEDB_API}?limit=${PAGE_SIZE}`

        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
          headers: { 'Accept': 'application/json' },
        })

        if (!response.ok) {
          if (response.status === 429) {
            consecutive429++
            if (consecutive429 > max429Retries) {
              console.warn(`[ExerciseDB] Too many rate limits at page ${page}, aborting`)
              break
            }
            // Exponential backoff: 3s, 6s, 12s, 24s, 30s (capped)
            const waitMs = Math.min(3000 * Math.pow(2, consecutive429 - 1), 30000)
            console.warn(`[ExerciseDB] Rate limited at page ${page + 1}, waiting ${waitMs / 1000}s (retry ${consecutive429}/${max429Retries})...`)
            await sleep(waitMs)
            // Permanently increase delay after a rate-limit event
            currentDelay = RATE_LIMITED_DELAY_MS
            continue // Retry same page
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // Success — reset rate-limit counter
        consecutive429 = 0

        const body: ExerciseDBResponse = await response.json()
        const items = body.data || []
        apiTotal = body.meta?.total || apiTotal

        if (items.length === 0) break

        // Insert this page's data into the DB immediately
        const allRows = insertExerciseBatch(items)
        totalFetched += items.length
        page++

        // Verify GIF URLs in parallel — discard 404 exercises
        const failedIds = await verifyGifUrls(
          items.map(ex => ({ id: ex.exerciseId, gifUrl: ex.gifUrl || buildGifUrl(ex.exerciseId), name: ex.name }))
        )

        let validRows = allRows
        if (failedIds.size > 0) {
          // Delete failed exercises from DB
          for (const id of failedIds) {
            exec('DELETE FROM cached_exercises WHERE id = ?', [id])
            const failedItem = items.find(ex => ex.exerciseId === id)
            result.failedNames.push(failedItem?.name || id)
          }
          result.failed += failedIds.size
          validRows = allRows.filter(r => !failedIds.has(r.id))
          console.warn(`[ExerciseDB] Discarded ${failedIds.size} exercises with 404 GIFs on page ${page}`)
        }

        result.total += validRows.length

        // Persist every few pages to avoid data loss on crash
        if (page % 10 === 0) persistDatabase()

        console.log(`[ExerciseDB] Page ${page}: +${validRows.length} (total: ${result.total}/${apiTotal}${result.failed > 0 ? ', discarded: ' + result.failed : ''})`)

        // Stream progress to the frontend (only valid exercises)
        if (onProgress) {
          onProgress({ fetched: result.total, total: apiTotal, failed: result.failed, newExercises: validRows })
        }

        if (!body.meta.hasNextPage) break

        cursor = body.meta.nextCursor
        if (!cursor) break

        // Rate-limit-friendly delay
        await sleep(currentDelay)
      }
    } catch (e: any) {
      console.error(`[ExerciseDB] Fetch error at page ${page}:`, e.message)
      if (result.total === 0 && result.failed === 0) {
        this._syncInProgress = false
        this.setSyncStatus('partial')
        return result
      }
      console.warn(`[ExerciseDB] Using partial data: ${result.total} exercises`)
    }

    persistDatabase()
    console.log(`[ExerciseDB] Synced ${result.total} exercises to local DB (${result.failed} discarded due to missing GIFs)`)

    // Mark sync as completed (or partial if we exited early due to errors)
    const status = result.total === 0 && result.failed > 0 ? 'partial' : 'completed'
    this.setSyncStatus(status)

    this._syncInProgress = false
    return result
  }

  // ── Sync state management ──

  /** Get the current sync status from the DB. */
  getSyncStatus(): 'pending' | 'completed' | 'partial' | 'none' {
    try {
      const row = queryOne<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', ['exercisedb_sync_status'])
      return (row?.value as 'pending' | 'completed' | 'partial') || 'none'
    } catch {
      return 'none'
    }
  }

  /** Update the sync status in the DB. */
  private setSyncStatus(status: 'pending' | 'completed' | 'partial'): void {
    try {
      exec(
        `INSERT INTO sync_state (key, value, updated_at) VALUES ('exercisedb_sync_status', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [status]
      )
      persistDatabase()
    } catch (e) {
      console.error('[ExerciseDB] Failed to set sync status:', e)
    }
  }

  /** Check if sync is needed (not completed or not started). */
  needsSync(): boolean {
    const status = this.getSyncStatus()
    return status !== 'completed'
  }

  list(filter?: { bodyPart?: string; equipment?: string; search?: string; limit?: number; offset?: number }): ExerciseRow[] {
    const conditions: string[] = []
    const params: SqlValue[] = []

    if (filter?.bodyPart) {
      conditions.push('LOWER(body_part_zh) = LOWER(?)')
      params.push(filter.bodyPart)
    }
    if (filter?.equipment) {
      conditions.push('LOWER(equipment_zh) = LOWER(?)')
      params.push(filter.equipment)
    }
    if (filter?.search) {
      conditions.push('(LOWER(name) LIKE ? OR LOWER(body_part_zh) LIKE ? OR LOWER(target_zh) LIKE ?)')
      const term = `%${filter.search.toLowerCase()}%`
      params.push(term, term, term)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    // Default: no limit (load all exercises for client-side filtering)
    const limit = filter?.limit ?? -1  // -1 = no limit in SQLite
    const offset = filter?.offset ?? 0

    if (limit === -1) {
      return queryAll<ExerciseRow>(
        `SELECT * FROM cached_exercises ${where} ORDER BY name LIMIT -1 OFFSET ?`,
        [...params, offset]
      )
    }
    return queryAll<ExerciseRow>(
      `SELECT * FROM cached_exercises ${where} ORDER BY name LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
  }

  /** Count total exercises in the DB (for cache-check on startup). */
  count(): number {
    const row = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM cached_exercises')
    return row?.count ?? 0
  }

  getById(id: string): ExerciseRow | undefined {
    return queryOne<ExerciseRow>('SELECT * FROM cached_exercises WHERE id = ?', [id])
  }

  getBodyParts(): string[] {
    // Return the canonical categories in the user-requested order.
    const rows = queryAll<{ body_part_zh: string }>(
      'SELECT DISTINCT body_part_zh FROM cached_exercises WHERE body_part_zh IS NOT NULL'
    )
    const existing = new Set(rows.map(r => r.body_part_zh))
    return BODY_PART_ORDER.filter(bp => existing.has(bp))
  }

  getEquipments(): string[] {
    const rows = queryAll<{ equipment_zh: string }>(
      'SELECT DISTINCT equipment_zh FROM cached_exercises WHERE equipment_zh IS NOT NULL ORDER BY equipment_zh'
    )
    return rows.map(r => r.equipment_zh)
  }
}
