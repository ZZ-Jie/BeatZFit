/**
 * Lightweight runtime performance monitor.
 *
 * Tracks FPS, memory usage, and route transition timings. Output is sent to
 * the console so users can verify the optimization targets without adding a
 * visible HUD to the UI. The monitor is designed to be cheap: it only runs one
 * rAF loop and samples memory once per second.
 */

import { onUnmounted } from 'vue'

interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

interface MonitorState {
  fps: number
  frameCount: number
  lastFpsTime: number
  rafId: number | null
  memoryInterval: ReturnType<typeof setInterval> | null
  enabled: boolean
}

const state: MonitorState = {
  fps: 0,
  frameCount: 0,
  lastFpsTime: performance.now(),
  rafId: null,
  memoryInterval: null,
  enabled: false,
}

function isDev(): boolean {
  try {
    return Boolean(import.meta.env.DEV)
  } catch (e) {
    console.warn('[perfMonitor] Failed to read import.meta.env.DEV:', e)
    return true
  }
}

function getMemory(): PerformanceMemory | null {
  const perf = performance as Performance & { memory?: PerformanceMemory }
  return perf.memory ?? null
}

function frameLoop(): void {
  if (!state.enabled) return

  const now = performance.now()
  state.frameCount++

  if (now - state.lastFpsTime >= 1000) {
    state.fps = Math.round((state.frameCount * 1000) / (now - state.lastFpsTime))
    state.frameCount = 0
    state.lastFpsTime = now
  }

  state.rafId = requestAnimationFrame(frameLoop)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function usePerformanceMonitor() {
  if (!state.enabled) {
    state.enabled = true
    state.rafId = requestAnimationFrame(frameLoop)
    state.memoryInterval = setInterval(() => {
      const mem = getMemory()
      if (mem && isDev()) {
        console.log(
          '[Memory]',
          `used=${formatBytes(mem.usedJSHeapSize)}`,
          `total=${formatBytes(mem.totalJSHeapSize)}`,
          `limit=${formatBytes(mem.jsHeapSizeLimit)}`
        )
      }
    }, 30000)
  }

  onUnmounted(() => {
    // Intentionally keep the monitor running across component mounts; it is
    // a singleton. Only tear down if the app is being destroyed, which is rare.
  })

  return {
    getFps: () => state.fps,
  }
}

/**
 * Measure the startup time from the 'app-start' mark to now.
 */
export function measureStartup(): number {
  try {
    performance.measure('startup', 'app-start')
    const entries = performance.getEntriesByName('startup', 'measure')
    const duration = entries[entries.length - 1]?.duration ?? 0
    if (isDev()) {
      console.log(`[startup] ${duration.toFixed(0)}ms`)
    }
    return duration
  } catch {
    const fallback = performance.now()
    if (isDev()) {
      console.log(`[startup] ${fallback.toFixed(0)}ms (no mark)`)
    }
    return fallback
  }
}

/**
 * Log a route transition timing.
 */
export function logRouteTiming(from: string, to: string, durationMs: number): void {
  if (isDev()) {
    console.log(`[RouteTiming] ${from} -> ${to}: ${durationMs.toFixed(0)}ms`)
  }
}
