import { app, ipcMain, protocol } from 'electron'
import { LibraryService } from '../services/libraryService'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

const libraryService = new LibraryService()

// ── Exercise GIF 2-tier cache ────────────────────────────────
// Tier 1: Local cache  (userData/exercise-gif-cache/{id}.gif)
// Tier 2: CDN          (https://static.exercisedb.dev/media/{id}.gif)
//
// Flow: cache hit → return; cache miss → fetch CDN → save to
//       cache → return; CDN 404 → write .404 marker → return 404.
//
// Negative caching: when the CDN returns 404 for a GIF (ExerciseDB
// has known data inconsistencies where some exerciseIds have no
// corresponding GIF file), we write a `{id}.gif.404` marker file.
// Subsequent requests for that GIF immediately return 404 without
// hitting the CDN again, avoiding repeated network round-trips for
// the same broken URL.
// ─────────────────────────────────────────────────────────────

/** Path to the persistent GIF cache in the user's data directory. */
function getGifCacheDir(): string {
  return join(app.getPath('userData'), 'exercise-gif-cache')
}

/** Ensure the cache directory exists. */
async function ensureCacheDir(): Promise<void> {
  const dir = getGifCacheDir()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

/** Extract the GIF file name (e.g. "RQNVT10.gif") from an exercisedb.dev URL. */
function extractGifFileName(remoteUrl: string): string | null {
  const match = remoteUrl.match(/exercisedb\.dev\/media\/([^/?]+\.gif)/i)
  return match ? match[1] : null
}

/**
 * Try to serve an exercisedb.dev GIF using the 2-tier strategy.
 * Returns a Response or null if the URL is not an exercisedb GIF.
 */
async function serveExerciseGif(remoteUrl: string): Promise<Response | null> {
  const fileName = extractGifFileName(remoteUrl)
  if (!fileName) return null

  const cachePath = join(getGifCacheDir(), fileName)
  const negCachePath = join(getGifCacheDir(), fileName + '.404')

  const gifHeaders = {
    'Content-Type': 'image/gif',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=604800', // 7 days
  }

  // Tier 0: negative cache — CDN previously returned 404 for this GIF.
  // Skip the network entirely and return 404 immediately.
  if (existsSync(negCachePath)) {
    return new Response('GIF not found on CDN', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Tier 1: local cache
  if (existsSync(cachePath)) {
    try {
      const data = await readFile(cachePath)
      return new Response(data, { status: 200, headers: gifHeaders })
    } catch {
      // fall through to CDN
    }
  }

  // Tier 2: CDN fetch
  try {
    const upstream = await globalThis.fetch(remoteUrl, {
      signal: AbortSignal.timeout(15000),
    })
    if (upstream.ok) {
      const buf = Buffer.from(await upstream.arrayBuffer())
      // Save to cache (fire-and-forget; don't block the response)
      ensureCacheDir()
        .then(() => writeFile(cachePath, buf).catch(() => {}))
        .catch(() => {})
      return new Response(buf, { status: 200, headers: gifHeaders })
    }
    // CDN returned 404 — write negative cache marker so we don't
    // keep retrying the same broken URL on every page load.
    if (upstream.status === 404) {
      ensureCacheDir()
        .then(() => writeFile(negCachePath, '1').catch(() => {}))
        .catch(() => {})
    }
  } catch {
    // network failure — return null (will 404)
  }

  return null
}

// ── Remote image LRU cache ──────────────────────────────────
// Separate from the audio cache — images are small, numerous, and
// frequently reused (e.g. album covers in the 3D record shelf).
// We cache up to IMAGE_CACHE_MAX entries with LRU eviction.
// Two tiers: in-memory LRU + on-disk persistent cache.
const IMAGE_CACHE_MAX = 300
const IMAGE_CACHE_TTL = 60 * 60 * 1000 // 60 minutes (in-memory)
const imageCache = new Map<string, { data: Buffer; contentType: string; timestamp: number }>()

// In-flight request deduplication: if two requests for the same URL
// arrive simultaneously, only fetch once and share the result.
const inflightImageRequests = new Map<string, Promise<{ data: Buffer; contentType: string } | null>>()

/** Get the on-disk image cache directory. */
function getImageCacheDir(): string {
  return join(app.getPath('userData'), 'image-cache')
}

/** Hash a URL to a safe filename for disk cache. */
function hashUrl(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36) + '.bin'
}

/** Get metadata file path for a cached image. */
function getImageCachePath(url: string): { dataPath: string; metaPath: string } {
  const dir = getImageCacheDir()
  const name = hashUrl(url)
  return { dataPath: join(dir, name), metaPath: join(dir, name + '.meta') }
}

/** Try to read an image from the disk cache. */
async function readDiskImageCache(url: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const { dataPath, metaPath } = getImageCachePath(url)
    if (!existsSync(dataPath) || !existsSync(metaPath)) return null
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
    // Check disk TTL (7 days)
    if (Date.now() - meta.timestamp > 7 * 24 * 60 * 60 * 1000) return null
    const data = await readFile(dataPath)
    return { data, contentType: meta.contentType || 'image/jpeg' }
  } catch {
    return null
  }
}

/** Write an image to the disk cache (fire-and-forget). */
function writeDiskImageCache(url: string, data: Buffer, contentType: string): void {
  const { dataPath, metaPath } = getImageCachePath(url)
  const dir = getImageCacheDir()
  mkdir(dir, { recursive: true })
    .then(() => {
      writeFile(dataPath, data).catch(() => {})
      writeFile(metaPath, JSON.stringify({ url: url.slice(0, 200), contentType, timestamp: Date.now() })).catch(() => {})
    })
    .catch(() => {})
}

/** Serve a remote image from cache or fetch-and-cache.
 *  Returns a NEW Response object for each caller — never shares a Response
 *  between concurrent requests (Response bodies can only be consumed once). */
async function serveRemoteImage(remoteUrl: string): Promise<Response | null> {
  // Detect images by exclusion: if the URL doesn't look like audio, treat it as image.
  const audioExt = /\.(mp3|flac|wav|m4a|ogg|aac|opus|webm|mp4)(\?|$)/i.test(remoteUrl)
  if (audioExt) return null

  const hasImageExt = /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif)/i.test(remoteUrl)
  const hasNeteaseParam = /param=\d+x\d+/.test(remoteUrl)
  const isNeteaseCDN = /music\.126\.net/i.test(remoteUrl)

  if (!hasImageExt && !hasNeteaseParam && !isNeteaseCDN) {
    return null
  }

  // Normalize cache key: strip Netease ?param=WxH suffix so the same image
  // requested at different sizes shares a single cache entry. The first size
  // requested wins; subsequent requests reuse the cached bytes regardless of
  // their ?param= value. This roughly doubles LRU cache effectiveness.
  const cacheKey = remoteUrl.replace(/\?param=\d+x\d+.*$/, '')

  const now = Date.now()

  // Tier 1: in-memory cache — create a fresh Response each time
  const cached = imageCache.get(cacheKey)
  if (cached && (now - cached.timestamp) < IMAGE_CACHE_TTL) {
    imageCache.delete(remoteUrl)
    imageCache.set(remoteUrl, cached)
    return new Response(new Uint8Array(cached.data) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      }
    })
  }

  // Deduplicate: if already fetching this URL, wait for the shared RESULT
  // (not Response) — the inflight stores the raw data, not a Response.
  const inflight = inflightImageRequests.get(cacheKey)
  if (inflight) {
    const result = await inflight
    if (result) {
      return new Response(new Uint8Array(result.data) as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': result.contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        }
      })
    }
    return new Response('fetch error', {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Tier 2: disk cache
  const diskCached = await readDiskImageCache(cacheKey)
  if (diskCached) {
    if (imageCache.size >= IMAGE_CACHE_MAX) {
      const oldestKey = imageCache.keys().next().value
      if (oldestKey) imageCache.delete(oldestKey)
    }
    imageCache.set(cacheKey, { ...diskCached, timestamp: now })
    return new Response(new Uint8Array(diskCached.data) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': diskCached.contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      }
    })
  }

  // Tier 3: fetch from network — inflight stores raw data, not Response
  const fetchPromise = (async (): Promise<{ data: Buffer; contentType: string } | null> => {
    try {
      const upstream = await globalThis.fetch(remoteUrl, {
        signal: AbortSignal.timeout(10000),
      })
      if (!upstream.ok) return null
      const data = Buffer.from(await upstream.arrayBuffer())
      const contentType = upstream.headers.get('Content-Type') || getMimeType(remoteUrl)

      if (imageCache.size >= IMAGE_CACHE_MAX) {
        const oldestKey = imageCache.keys().next().value
        if (oldestKey) imageCache.delete(oldestKey)
      }
      imageCache.set(cacheKey, { data, contentType, timestamp: Date.now() })
      writeDiskImageCache(cacheKey, data, contentType)
      return { data, contentType }
    } catch (e) {
      console.error('[beat://] failed to fetch remote image:', remoteUrl, e)
      return null
    }
  })()

  inflightImageRequests.set(cacheKey, fetchPromise)
  try {
    const result = await fetchPromise
    if (result) {
      return new Response(new Uint8Array(result.data) as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': result.contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        }
      })
    }
    return new Response('fetch error', {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
  } finally {
    inflightImageRequests.delete(cacheKey)
  }
}

// ── Remote audio cache ───────────────────────────────────────
// When a remote audio URL (e.g. Netease CDN) is requested via beat://,
// we download the full file once and cache it in memory. All subsequent
// Range requests (seek, pause/resume) are served from this cache with
// proper 206 Partial Content responses.
//
// This is necessary because:
// 1. Some CDNs don't support Range requests → return 200 with full body
// 2. <audio> element resets to position 0 when it receives 200 instead of 206
// 3. Each seek would otherwise trigger a new HTTP round-trip to the CDN
//
// Only one audio file is cached at a time; requesting a new URL evicts
// the previous cache entry.
let audioCache: { url: string; data: Buffer; contentType: string; timestamp: number } | null = null
const AUDIO_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/** Serve a remote audio URL from cache (or fetch-and-cache on first request). */
async function serveRemoteAudio(remoteUrl: string, request: Request): Promise<Response> {
  const now = Date.now()
  const rangeHeader = request.headers.get('Range')

  // Check cache validity
  if (audioCache && audioCache.url === remoteUrl && (now - audioCache.timestamp) < AUDIO_CACHE_TTL) {
    return serveFromCache(audioCache.data, audioCache.contentType, rangeHeader)
  }

  // Cache miss or expired — fetch the full file
  try {
    const upstream = await globalThis.fetch(remoteUrl, {
      signal: AbortSignal.timeout(60000),
    })
    if (!upstream.ok) {
      return new Response('upstream error', {
        status: upstream.status,
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    }
    const data = Buffer.from(await upstream.arrayBuffer())
    const contentType = upstream.headers.get('Content-Type') || getMimeType(remoteUrl)

    // Update cache
    audioCache = { url: remoteUrl, data, contentType, timestamp: now }

    return serveFromCache(data, contentType, rangeHeader)
  } catch (e) {
    console.error('[beat://] failed to fetch remote audio:', remoteUrl, e)
    return new Response('fetch error', {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
  }
}

/** Serve data from buffer with Range support. */
function serveFromCache(data: Buffer, contentType: string, rangeHeader: string | null): Response {
  const total = data.length
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
  }

  if (!rangeHeader) {
    return new Response(new Uint8Array(data) as BodyInit, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) }
    })
  }

  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
  if (!match) {
    return new Response(new Uint8Array(data) as BodyInit, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) }
    })
  }

  const start = parseInt(match[1], 10)
  const end = match[2] ? parseInt(match[2], 10) : total - 1
  const chunk = data.subarray(start, end + 1)

  return new Response(new Uint8Array(chunk) as BodyInit, {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(chunk.length),
    }
  })
}

// ── General file serving ─────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

// Helper to parse the beat:// URL back to an absolute file path.
function resolveBeatPath(requestUrl: string): string {
  const encoded = requestUrl.replace(/^beat:\/\//, '').split('?')[0]
  let filePath = decodeURIComponent(encoded)
  // Some clients include a leading slash; strip it for Windows paths.
  if (filePath.startsWith('/')) {
    filePath = filePath.slice(1)
  }
  return filePath
}

/**
 * Serve a local file through a custom protocol with Range request support.
 * Howler's html5 <audio> element needs range requests for seeking.
 * CORS headers are required for audio visualization (Web Audio API AnalyserNode).
 */
async function serveLocalFile(request: Request): Promise<Response> {
  const filePath = resolveBeatPath(request.url)

  // If the decoded path is a remote URL (http/https), proxy it through the
  // main process. This bypasses renderer CORS restrictions — remote CDNs
  // like Netease's p1.music.126.net don't send Access-Control-Allow-Origin,
  // so loading them directly in the renderer with crossOrigin='anonymous'
  // fails. By fetching server-side and serving with CORS headers, the
  // renderer gets a clean, CORS-compliant response.
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    // Exercise GIFs use the 2-tier cache strategy
    const exerciseGif = await serveExerciseGif(filePath)
    if (exerciseGif) return exerciseGif

    // Remote images (Netease album covers, etc.) — use the LRU image cache
    const imageResp = await serveRemoteImage(filePath)
    if (imageResp) return imageResp

    // Remote audio (Netease streams) — use the in-memory audio cache
    // so that Range requests (seek, pause/resume) work correctly.
    return serveRemoteAudio(filePath, request)
  }

  const rangeHeader = request.headers.get('Range')

  try {
    const data = await readFile(filePath)
    const contentType = getMimeType(filePath)

    if (!rangeHeader) {
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(data.length),
          'Access-Control-Allow-Origin': '*',
        }
      })
    }

    const total = data.length
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (!match) {
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
          'Access-Control-Allow-Origin': '*',
        }
      })
    }

    const start = parseInt(match[1], 10)
    const end = match[2] ? parseInt(match[2], 10) : total - 1
    const chunk = data.subarray(start, end + 1)

    return new Response(chunk, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunk.length),
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) {
    console.error('[beat://] failed to serve', filePath, e)
    return new Response('not found', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
  }
}

export function registerMusicIPC() {
  // Register a custom protocol to securely expose local audio/image files
  // to the renderer process without using raw file:// URLs.
  protocol.handle('beat', serveLocalFile)

  ipcMain.handle('music:pickFiles', async () => {
    try {
      const result = await libraryService.pickAudioFiles()
      return { success: true, data: { tracks: result.tracks, duplicates: result.duplicates } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('music:scanFolder', async () => {
    try {
      const result = await libraryService.pickFolder()
      return { success: true, data: { tracks: result.tracks, duplicates: result.duplicates } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('music:getLibrary', async () => {
    try {
      const tracks = libraryService.getLibrary()
      return { success: true, data: { tracks } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('music:deleteTrack', async (_event, trackId: string) => {
    try {
      const ok = libraryService.deleteTrack(trackId)
      return { success: ok }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('music:clearLibrary', async () => {
    try {
      const count = libraryService.clearLibrary()
      return { success: true, data: { count } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('music:getLocalFilePath', async (_event, filePath: string) => {
    try {
      const url = pathToFileURL(filePath).href
      return { success: true, data: { url } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('music:updateLastPlayed', async (_event, trackId: string) => {
    try {
      libraryService.updateLastPlayed(trackId)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('music:readLyrics', async (_event, lyricsPath: string) => {
    try {
      const text = await readFile(lyricsPath, 'utf-8')
      return { success: true, data: { lyrics: text } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
