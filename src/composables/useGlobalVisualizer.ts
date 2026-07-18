/**
 * Global Visualizer Composable
 *
 * Single-instance wrapper around VisualizerScene + spectrumEngine that
 * survives route changes. PlayerPage (and any other route) can opt into
 * interaction via attachInteraction/detachInteraction without owning the
 * underlying Three.js lifecycle.
 *
 * Lifecycle policy:
 * - The visualizer render loop (aurora + 3D preset) is ALWAYS running while
 *   the app is visible. The aurora background is the immersive "space" and
 *   must never stop. 3D presets smoothly settle to idle when no audio plays.
 * - The audio analysis loop (spectrumEngine) only runs when music is playing.
 *   When paused/stopped, it is stopped to save CPU, and zero spectrum data is
 *   fed to the visualizer to decay it towards baseline via spring damping.
 * - When the app window is hidden (visibilitychange), ALL rendering stops.
 *   Resuming is cheap — the Three.js scene is not destroyed.
 */
import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useRoute } from 'vue-router'
import { useMusicStore } from '@/stores/music'
import { VisualizerScene, type PresetName } from '@/modules/visualizer/threeScene'
import { getVisualizerEngine } from '@/modules/visualizer/audioAnalyzer'
import { parseLRC, findCurrentLine, type LyricsLine } from '@/modules/music/lyricParser'
import { cachedFetch, CacheNS, CacheTTL } from '@/modules/music/cache'
import { loadLyricFileCached } from '@/modules/music/dataLoaders'
import { Howler } from 'howler'
import { useEqualizer } from '@/composables/useEqualizer'

/**
 * Brand poster image — used as the default cover when no track is playing.
 * All cover-based presets (cover / tiles / lens / reactive)
 * will display this image on first launch or when playback stops and no
 * track is selected. The crystalBloom preset ignores cover images.
 *
 * The URL is resolved relative to the document base so it works in both
 * Vite dev server (http://localhost) and Electron production (file://).
 */
const BRAND_POSTER_URL = new URL('assets/beatzfit-logo.jpg', document.baseURI).href

// Module-level singleton state — survives across component mount/unmount
let visualizerInstance: VisualizerScene | null = null
const spectrumEngine = getVisualizerEngine()
let audioConnected = false
let interactionContainer: HTMLElement | null = null
let canvasEl: HTMLCanvasElement | null = null
let reparentOriginalParent: HTMLElement | null = null
let lyricLayerEl: HTMLElement | null = null  // GlobalLyricLayer root element
let lyricLayerOriginalParent: HTMLElement | null = null
let transformCallback: ((t: { rotationX: number; rotationY: number; scale: number }) => void) | null = null

// ── Aurora accent color shared state ──
// AuroraBackground.vue reads this in its own rAF loop (no Vue reactivity overhead).
// Updated every frame by threeScene's updateAurora via callback.
export const auroraAccentColor = { r: 0.494, g: 0.784, b: 0.890 } // default ice blue #7EC8E3

// ── Stage registry + IntersectionObserver for automatic canvas reparenting ──
// 多个 3D 页面 (DualDeckHome, MusicPage, FitnessPage) 在沉浸式滚动布局中同时挂载。
// IntersectionObserver 自动检测当前最可见的 stage, 将 canvas reparent 到其中,
// 实现真正的 CSS 3D 穿插。当没有 stage 可见时 (如 PlayerPage), canvas 回到 GlobalBackground。
const stageRegistry = new Map<string, HTMLElement>()
const stageRatios = new Map<string, number>()
let currentStageId: string | null = null
let stageObserver: IntersectionObserver | null = null

// Reactive state shared with consumers
const visualizerRef = ref<VisualizerScene | null>(null)
const activePreset = ref<PresetName>('lens')
const domeAngleMode = ref<'front' | 'back'>('front')
const lyricAudioData = ref({
  bass: 0, mid: 0, treble: 0, volume: 0, beat: 0,
  onset: 0, drumOnset: 0, musicalOnset: 0, beatStrength: 0,
  tempo: 0, tempoConfidence: 0,
  // Enhanced Beat Response: 瞬态通道
  subBassPunch: 0, kickPunch: 0, bassTransient: 0,
})

// 节流：减少 lyricAudioData 的 Vue 响应式更新频率
// 每 3 帧才触发一次响应式更新，大幅减少 GC 压力和 reactivity 开销
let spectrumFrameCount = 0

// Lyric state — loaded centrally so the global lyric layer works on
// every route, not just /player. PlayerPage reads these for its 2D lyric
// display via the getters below.
const lyricLines = ref<LyricsLine[]>([])
const currentLyricText = ref('')
const currentLyricIndex = ref(-1)
let lyricLoading = false

// ── 暂停状态歌词更新定时器 ──
// 当音频暂停或未播放时, 用低频定时器 (500ms) 轮询播放位置并更新当前歌词句。
// 播放时由 forwardSpectrumData (60fps) 处理, 此定时器停止以节省 CPU。
let pausedLyricTimer: ReturnType<typeof setInterval> | null = null

function updatePausedLyric() {
  if (lyricLines.value.length === 0) return
  const musicStore = musicStoreRef ?? useMusicStore()
  const time = musicStore.getPlaybackPosition()
  const idx = findCurrentLine(lyricLines.value, time)
  const line = idx >= 0 ? lyricLines.value[idx] : null
  const text = line?.text ?? ''
  if (text !== currentLyricText.value) {
    currentLyricText.value = text
    currentLyricIndex.value = idx
  }
}

function startPausedLyricTimer() {
  if (pausedLyricTimer) return
  updatePausedLyric()
  pausedLyricTimer = setInterval(updatePausedLyric, 500)
}

function stopPausedLyricTimer() {
  if (pausedLyricTimer) {
    clearInterval(pausedLyricTimer)
    pausedLyricTimer = null
  }
}

let initialized = false
let watchersInitialized = false
let isVisibilityPaused = false

// Conditional init state
let pendingContainer: HTMLElement | null = null
let pendingQuality: 'high' | 'medium' | 'low' = 'low'
let pendingVisualDiy: { scale: number; particleDensity: number; depth: number; glow: number } | null = null
let alwaysShowBackground = false
let musicStoreRef: ReturnType<typeof useMusicStore> | null = null
let routeRef: Ref<{ path: string }> | null = null

// Guard to prevent concurrent connectAudioAnalyzer calls (race condition fix)
let connectingAudio = false

// Zero spectrum data packet — used to decay the visualizer to baseline
// when music is paused/stopped. The spring damping system in each preset
// will smoothly interpolate towards these zero values.
const ZERO_SPECTRUM_DATA: import('@/modules/visualizer/audioAnalyzer').AudioSpectrumData = {
  bass: 0, mid: 0, treble: 0, volume: 0, beat: 0,
  rawFrequencies: new Uint8Array(0),
  lowFreq: 0, midLowFreq: 0, midHighFreq: 0, highFreq: 0,
  rmsTimeDomain: 0, burstIntensity: 0, subBassTremor: 0,
  subBass: 0, lowMid: 0, highMid: 0, presence: 0,
  spectralFlux: 0, spectralCentroid: 0,
  onset: 0, drumOnset: 0, musicalOnset: 0, beatStrength: 0,
  tempo: 0, tempoConfidence: 0,
  subBassPunch: 0, kickPunch: 0, bassTransient: 0,
}

/**
 * Connect the spectrum analyzer to the audio output.
 *
 * CRITICAL: This function must connect the audio analyser SYNCHRONOUSLY.
 * The previous async version introduced a race condition where multiple
 * watchers could enter the function before `audioConnected` was set. For
 * Netease streams (HTML5 mode), this caused `connectToElementWithContext`
 * to be called twice, creating TWO AnalyserNode instances in the audio path:
 * `source → analyserA → destination` AND `source → analyserB → destination`.
 * The duplicated audio paths caused phase cancellation, which specifically
 * destroyed bass frequencies.
 *
 * New strategy:
 *   1. Connect the analyser synchronously (same timing as pre-cache code)
 *   2. `connectingAudio` guard prevents concurrent calls
 */
function connectAudioAnalyzer() {
  // Always resume the AudioContext
  spectrumEngine.resume()

  if (audioConnected || connectingAudio) return
  connectingAudio = true

  const musicStore = musicStoreRef ?? useMusicStore()

  // ── Step 1: Connect analyser SYNCHRONOUSLY ──
  const usesHtml5 = musicStore.getCurrentTrackUsesHtml5()

  if (usesHtml5) {
    const audioElement = musicStore.getCurrentAudioElement()
    const ctx = (Howler as any).ctx as AudioContext | undefined
    if (audioElement && ctx) {
      const ok = spectrumEngine.connectToElementWithContext(audioElement, ctx)
      if (ok) {
        audioConnected = true
        connectingAudio = false
        spectrumEngine.resume()
        spectrumEngine.startLoop(forwardSpectrumData)
        // Connect EQ after analyser is set up (HTML5 mode: EQ sits between
        // analyser and ctx.destination)
        const analyser = spectrumEngine.getAnalyser()
        if (analyser) {
          const { connectToNode } = useEqualizer()
          connectToNode(analyser, ctx)
        }
        return
      }
    }
    spectrumEngine.startLoop(forwardSpectrumData)
    audioConnected = true
    connectingAudio = false
  } else {
    connectingAudio = false
    connectToMasterGain()
  }
}

function connectToMasterGain() {
  if (audioConnected) return

  const masterGain = (Howler as any).masterGain as GainNode | undefined
  if (!masterGain) {
    setTimeout(() => {
      if (!audioConnected) {
        const retryGain = (Howler as any).masterGain as GainNode | undefined
        if (retryGain) {
          const ok = spectrumEngine.connectToGain(retryGain)
          if (ok) {
            audioConnected = true
            spectrumEngine.resume()
            spectrumEngine.startLoop(forwardSpectrumData)
            const { tryConnect } = useEqualizer()
            tryConnect()
          }
        }
      }
    }, 500)
    return
  }

  const ok = spectrumEngine.connectToGain(masterGain)
  if (ok) {
    audioConnected = true
    spectrumEngine.resume()
    spectrumEngine.startLoop(forwardSpectrumData)
    // Connect EQ after analyser is set up (Web Audio mode: EQ sits between
    // masterGain and ctx.destination, analyser taps masterGain separately)
    const { tryConnect } = useEqualizer()
    tryConnect()
  }
}

/**
 * Helper: forward spectrum data to visualizer + lyricAudioData ref.
 * 节流 lyricAudioData 更新频率，每 3 帧更新一次以减少 Vue reactivity 开销。
 */
function forwardSpectrumData(data: import('@/modules/visualizer/audioAnalyzer').AudioSpectrumData) {
  visualizerInstance?.updateSpectrum(data)
  // 极光背景每帧更新 (不节流, 确保平滑脉冲)
  visualizerInstance?.updateAuroraBass(data.bass)

  // Lyric tracking: piggyback on the spectrum loop to update the current
  // lyric line at ~60fps without a separate timer or reactive watcher.
  // This replaces the old 200ms global currentTime timer.
  if (lyricLines.value.length > 0) {
    const musicStore = musicStoreRef ?? useMusicStore()
    const time = musicStore.getPlaybackPosition()
    const idx = findCurrentLine(lyricLines.value, time)
    const line = idx >= 0 ? lyricLines.value[idx] : null
    const text = line?.text ?? ''
    if (text !== currentLyricText.value) {
      currentLyricText.value = text
      currentLyricIndex.value = idx
    }
  }

  spectrumFrameCount++
  if (spectrumFrameCount % 3 === 0) {
    // 直接修改属性而非创建新对象，减少 GC
    const d = lyricAudioData.value
    d.bass = data.bass
    d.mid = data.mid
    d.treble = data.treble
    d.volume = data.volume
    d.beat = data.beat
    d.onset = data.onset
    d.drumOnset = data.drumOnset
    d.musicalOnset = data.musicalOnset
    d.beatStrength = data.beatStrength
    d.tempo = data.tempo
    d.tempoConfidence = data.tempoConfidence
    // Enhanced Beat Response: 瞬态通道
    d.subBassPunch = data.subBassPunch ?? 0
    d.kickPunch = data.kickPunch ?? 0
    d.bassTransient = data.bassTransient ?? 0
  }
}

/**
 * Load lyrics for a track (netease or local). Centralised so the global
 * lyric layer has content even when the user is on a non-player route.
 */
async function loadLyricsForTrack(track: { source: string; sourceId?: string; lyricsPath?: string }) {
  if (track.source === 'netease' && track.sourceId) {
    await loadNeteaseLyrics(Number(track.sourceId))
  } else if (track.source === 'qq' && track.sourceId) {
    await loadQqLyrics(track.sourceId)
  } else if (track.lyricsPath && window.electronAPI) {
    await loadLocalLyrics(track.lyricsPath)
  } else {
    lyricLines.value = []
  }
}

async function loadNeteaseLyrics(songId: number) {
  if (!window.electronAPI?.netease) {
    lyricLines.value = []
    return
  }
  lyricLoading = true
  try {
    // Wrap with cachedFetch so repeated plays of the same song (or rapid
    // skipping back and forth) don't each trigger a Netease IPC roundtrip.
    // The parsed LyricsLine[] array is cached directly, so on a cache hit
    // we skip both the IPC call AND the LRC parsing.
    const lines = await cachedFetch<LyricsLine[]>(
      CacheNS.NeteaseLyric,
      String(songId),
      async () => {
        const result = await window.electronAPI!.netease.getLyric(songId)
        const lyric = result?.data?.lyric
        const lrcText = lyric?.lrc?.lyric || ''
        const tlyricText = lyric?.tlyric?.lyric || ''
        if (!lrcText) return []
        return parseLRC(lrcText, tlyricText).lines
      },
      { ttlMs: CacheTTL.LYRICS, keyPrefix: 'parsed' }
    )
    lyricLines.value = lines
  } catch (e) {
    console.error('[useGlobalVisualizer] Failed to load netease lyrics:', e)
    lyricLines.value = []
  } finally {
    lyricLoading = false
  }
}

async function loadLocalLyrics(lyricsPath: string) {
  if (!window.electronAPI) return
  lyricLoading = true
  try {
    // Use the existing loadLyricFileCached wrapper (previously dead code)
    // to benefit from LRU + TTL caching. This avoids redundant IPC
    // roundtrips when the same local track is played repeatedly.
    const lrcText = await loadLyricFileCached(lyricsPath)
    if (lrcText) {
      lyricLines.value = parseLRC(lrcText).lines
    } else {
      lyricLines.value = []
    }
  } catch (e) {
    console.error('[useGlobalVisualizer] Failed to load local lyrics:', e)
    lyricLines.value = []
  } finally {
    lyricLoading = false
  }
}

async function loadQqLyrics(songmid: string) {
  if (!window.electronAPI?.qq) {
    lyricLines.value = []
    return
  }
  lyricLoading = true
  try {
    const lines = await cachedFetch<LyricsLine[]>(
      CacheNS.QqLyric,
      String(songmid),
      async () => {
        const result = await window.electronAPI!.qq.getLyric(songmid)
        const lyric = result?.data?.lyric
        const lrcText = lyric?.lyric || ''
        const transText = lyric?.trans || ''
        if (!lrcText) return []
        return parseLRC(lrcText, transText).lines
      },
      { ttlMs: CacheTTL.LYRICS, keyPrefix: 'parsed' }
    )
    lyricLines.value = lines
  } catch (e) {
    console.error('[useGlobalVisualizer] Failed to load QQ lyrics:', e)
    lyricLines.value = []
  } finally {
    lyricLoading = false
  }
}


/**
 * Initialise the global visualizer inside the given container element.
 * This is the low-level initializer; callers should prefer maybeInitBackground
 * so the visualizer is only created when it is actually needed.
 */
function initBackground(container: HTMLElement, quality: 'high' | 'medium' | 'low' = 'low') {
  // ── HMR 容器失效检测 ──
  // 如果之前的容器已从 DOM 断开 (HMR 重新挂载组件),
  // 必须重新初始化以将 canvas 绑定到新容器。
  if (initialized && visualizerInstance) {
    const oldContainer = (visualizerInstance as any).container as HTMLElement | undefined
    if (oldContainer && !oldContainer.isConnected) {
      console.warn('[useGlobalVisualizer] Stale container detected, re-initializing...')
      visualizerInstance.dispose()
      visualizerInstance = null
      initialized = false
      audioConnected = false
      // 清理旧的 watchers
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  if (initialized) {
    return
  }
  initialized = true

  visualizerInstance = new VisualizerScene()
  ;(window as any).__visualizer = visualizerInstance
  const ok = visualizerInstance.init(container, quality)
  if (!ok) {
    console.error('[useGlobalVisualizer] Failed to init visualizer')
    return
  }

  // Store canvas reference for reparentCanvas
  canvasEl = visualizerInstance.getCanvasElement()
  reparentOriginalParent = canvasEl?.parentElement ?? null

  visualizerInstance.switchPreset(activePreset.value)
  visualizerInstance.start()

  // Forward cover transform changes to whoever registered a callback
  // (PlayerPage uses this to drive subtle lyric parallax).
  visualizerInstance.setOnTransformChange((t) => {
    transformCallback?.(t)
  })

  // Aurora color callback: threeScene computes the accent color each frame
  // (idle/playing/cover-derived) and pushes it to the shared state.
  // AuroraBackground.vue reads this in its own rAF loop.
  visualizerInstance.setAuroraColorCallback((r, g, b) => {
    auroraAccentColor.r = r
    auroraAccentColor.g = g
    auroraAccentColor.b = b
  })

  // Pause expensive rendering when the app is hidden to save GPU/CPU/battery.
  document.addEventListener('visibilitychange', handleVisibilityChange)

  visualizerRef.value = visualizerInstance

  // Apply any pending visual DIY params (set before visualizer was ready)
  if (pendingVisualDiy) {
    visualizerInstance.setVisualDiy(pendingVisualDiy)
  }

  // Re-apply the current track's cover after (re-)initialization.
  // If the visualizer was re-initialized (e.g. HMR, stale container),
  // the previous instance's extracted aurora color is lost. Re-applying
  // the cover ensures color extraction runs again for the current track.
  if (musicStoreRef) {
    const track = musicStoreRef.currentTrack
    if (track?.coverPath) {
      visualizerInstance.setCover(musicStoreRef.toCoverUrl(track.coverPath))
    } else {
      visualizerInstance.setCover(BRAND_POSTER_URL)
    }
  }

  // Wire up reactive watchers — these live for the lifetime of the app.
  setupWatchers()

  // 确保容器尺寸正确: 初始化时容器可能尚未完成布局 (0x0),
  // 延迟触发 resize 事件让 VisualizerScene 重新测量容器尺寸。
  // 双重触发: 0ms (当前帧微任务后) + 200ms (窗口完全显示后)
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'))
  }, 0)
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'))
  }, 200)
}

/**
 * Start/resume rendering.
 *
 * The visualizer render loop (aurora + 3D preset) is ALWAYS started — it is
 * the immersive "space" and must never stop while the app is visible.
 * The spectrum analysis loop is only started when music is playing.
 */
function resumeRendering() {
  if (!visualizerInstance) return

  // Always start the render loop at full 60fps (aurora background + 3D preset)
  visualizerInstance.start()

  const musicStore = musicStoreRef ?? useMusicStore()

  // ── Proactively resume the AudioContext ──
  // Chromium auto-suspends the AudioContext when the window is hidden.
  // We must resume it BEFORE the user clicks play, otherwise Howler's
  // play() will block waiting for the context to resume (100-500ms delay).
  // This is a fire-and-forget — resume() is async but we don't need to wait.
  spectrumEngine.resume().catch(() => {})

  if (musicStore.isPlaying) {
    // If analyser is already connected (app was hidden while playing),
    // we need to RESTART the spectrum loop because stopRendering() stopped it.
    // connectAudioAnalyzer() would early-return because audioConnected is true,
    // so we handle the restart here.
    if (audioConnected) {
      spectrumEngine.resume()
      spectrumEngine.startLoop(forwardSpectrumData)
    } else {
      connectAudioAnalyzer()
    }
    // Stop the paused lyric timer — forwardSpectrumData will handle lyrics at 60fps
    stopPausedLyricTimer()
  } else {
    // Feed zero data to kick the decay towards baseline
    forwardSpectrumData(ZERO_SPECTRUM_DATA)
    // 恢复暂停状态歌词定时器
    if (musicStore.currentTrack && lyricLines.value.length > 0) {
      startPausedLyricTimer()
    }
  }
}

/**
 * Stop ALL rendering (both visualizer and spectrum analysis).
 * Only called when the app window is hidden (visibilitychange).
 * The Three.js scene is NOT destroyed — resuming is cheap.
 *
 * IMPORTANT: When music is still playing in the background, we keep the
 * low-frequency paused lyric timer running (setInterval, less affected by
 * background throttling than rAF). This ensures lyrics continue to update
 * even when the window is hidden (e.g. for the desktop lyric window).
 */
function stopRendering() {
  visualizerInstance?.stop()
  spectrumEngine.stopLoop()

  // When music is playing in the background, keep the low-frequency lyric
  // timer running so lyrics stay in sync. rAF is throttled/paused when
  // hidden, but setInterval still fires (though possibly at reduced rate).
  const musicStore = musicStoreRef ?? useMusicStore()
  if (musicStore.isPlaying && musicStore.currentTrack && lyricLines.value.length > 0) {
    startPausedLyricTimer()
  } else {
    stopPausedLyricTimer()
  }
}

/**
 * Decide whether to actually create/start the visualizer based on current
 * route and playback state. Called by GlobalBackground and by the reactive
 * watchers whenever state changes.
 */
function maybeInitBackground(container?: HTMLElement, quality: 'high' | 'medium' | 'low' = 'low') {
  if (container) {
    pendingContainer = container
    pendingQuality = quality
  }

  if (!initialized && pendingContainer) {
    initBackground(pendingContainer, pendingQuality)
  } else if (initialized && !isVisibilityPaused) {
    resumeRendering()
  }
}

/**
 * Pause/resume rendering and audio analysis based on page visibility.
 */
function handleVisibilityChange() {
  if (document.hidden) {
    isVisibilityPaused = true
    stopRendering()
  } else {
    isVisibilityPaused = false
    // Visualizer is always needed (aurora + 3D presets share one WebGL context)
    resumeRendering()
  }
}

function setupWatchers() {
  // 防止 HMR 重新初始化时创建重复的 watchers
  if (watchersInitialized) return
  watchersInitialized = true

  // Load saved preset on init — with validation to ensure crystalBloom
  // is always the fallback default.
  const VALID_PRESETS: PresetName[] = ['cover', 'tiles', 'reactive', 'lens', 'crystalBloom', 'nuage']
  ;(async () => {
    try {
      if (window.electronAPI) {
        const [presetResult, alwaysShowResult] = await Promise.all([
          window.electronAPI.settings.get('visualizer.preset'),
          window.electronAPI.settings.get('visualizer.alwaysShowBackground'),
        ])
        if (presetResult.success && presetResult.data?.value) {
          const saved = presetResult.data.value as PresetName
          // Only apply the saved preset if it's valid; otherwise keep
          // the default 'lens'.
          if (VALID_PRESETS.includes(saved)) {
            activePreset.value = saved
            visualizerInstance?.switchPreset(activePreset.value)
          } else {
            // Invalid saved preset — reset to lens
            activePreset.value = 'lens'
            visualizerInstance?.switchPreset('lens')
          }
        }
        if (alwaysShowResult.success && alwaysShowResult.data?.value) {
          alwaysShowBackground = alwaysShowResult.data.value === 'true'
        }
      }
      // Re-evaluate whether the visualizer should be running now that
      // the alwaysShowBackground setting has been loaded. Without this,
      // the setting only takes effect on the next route/playback change.
      maybeInitBackground()
    } catch (e) {
      console.warn('[useGlobalVisualizer] Failed to load saved settings:', e)
    }
  })()

  const musicStore = musicStoreRef ?? useMusicStore()

  // Track change → update cover, lyrics and reconnect the audio analyzer.
  // Keeping a single watcher avoids duplicate work when the track changes.
  watch(() => musicStore.currentTrack, async (track) => {
    lyricLines.value = []
    currentLyricText.value = ''
    currentLyricIndex.value = -1
    visualizerInstance?.setPlaying(musicStore.isPlaying)

    // Reset audio analyzer state for the new track.
    spectrumEngine.stopLoop()
    spectrumEngine.disconnect()
    audioConnected = false
    // Reset EQ state so it reconnects with the new audio graph
    const { disconnect: eqDisconnect } = useEqualizer()
    eqDisconnect()

    if (visualizerInstance) {
      // Spectrum engine will be started by the isPlaying watcher if music is playing
    }

    if (!track) {
      // No track selected — show brand poster so the visualizer is never empty
      visualizerInstance?.setCover(BRAND_POSTER_URL)
      stopPausedLyricTimer()
      return
    }

    if (track.coverPath) {
      visualizerInstance?.setCover(musicStore.toCoverUrl(track.coverPath))
    } else {
      // Track has no cover art — fall back to brand poster
      visualizerInstance?.setCover(BRAND_POSTER_URL)
    }

    await loadLyricsForTrack(track)
    // 加载歌词后立即设置当前歌词句 (支持暂停/未播放状态下显示)
    updatePausedLyric()

    if (musicStore.isPlaying) {
      connectAudioAnalyzer()
    } else {
      // 未播放: 启动暂停状态歌词定时器
      startPausedLyricTimer()
    }
  }, { immediate: true })

  // Playback state → propagate to visualizer + connect/disconnect analyzer
  watch(() => musicStore.isPlaying, (playing) => {
    visualizerInstance?.setPlaying(playing)
    if (playing) {
      // 播放中: 停止暂停状态定时器 (由 forwardSpectrumData 60fps 处理歌词)
      stopPausedLyricTimer()
      // If analyser is already connected (pause→resume), just restart the loop.
      // connectAudioAnalyzer() would early-return because audioConnected is still true.
      if (audioConnected) {
        spectrumEngine.resume()
        spectrumEngine.startLoop(forwardSpectrumData)
      } else {
        connectAudioAnalyzer()
      }
    } else {
      // Music stopped/paused — stop the audio analysis loop (CPU → 0).
      // The visualizer render loop (aurora + 3D preset) keeps running at full
      // 60fps for smooth visuals. Zero spectrum data is fed to decay presets
      // to baseline via the spring damping system.
      spectrumEngine.stopLoop()
      forwardSpectrumData(ZERO_SPECTRUM_DATA)
      // 暂停/停止: 启动低频歌词定时器, 持续显示当前歌词句
      startPausedLyricTimer()
    }
  }, { immediate: true })

  // NOTE: The reactive watch on musicStore.currentTime has been removed.
  // The 200ms global timer that wrote to currentTime has been removed from
  // music.ts. Instead, lyric tracking is now done inside forwardSpectrumData,
  // which runs at ~60fps when music is playing — providing even smoother
  // lyric updates without polluting the global reactive graph.
}

/**
 * 将可视化器 canvas 从 GlobalBackground 动态移入指定 stage 容器 (或移回原位)。
 * Canvas 使用 alpha:true (透明), clearColor 透明。.app-shell (#050507) 提供深色底。
 * Canvas 被 appendChild 到 stage 内部, 与卡片共享 preserve-3d 3D 空间。
 * 卡片 z-index > canvas z-index → 始终在 canvas 前方, 不会变浅。
 */
function reparentCanvas(target: HTMLElement | null) {
  // 注意: 此处不再因 canvas 未就绪而提前 return —
  // 歌词层 (lyricLayerEl) 的 reparenting 必须独立于 canvas 是否已初始化,
  // 否则在 canvas 尚未创建时 (例如 PlayerPage 首次挂载早于 GlobalBackground init),
  // 歌词层会被卡在原 parent, 无法进入 stage 的 preserve-3d 空间,
  // 导致歌词与 3D 预设主题同处一个平面、失去 translateZ 景深分层。
  let moved = false
  if (canvasEl) {
    if (target) {
      if (canvasEl.parentElement !== target) {
        target.appendChild(canvasEl)
        moved = true
      }
    } else {
      const bg = reparentOriginalParent ?? document.querySelector('[data-global-background]')
      if (bg && canvasEl.parentElement !== bg) {
        bg.appendChild(canvasEl)
        moved = true
      }
    }
  }

  // ── Reparent the global lyric layer to the same target as the canvas ──
  // 歌词层必须与 canvas / 卡片共享同一个 preserve-3d 空间,
  // 通过 translateZ(80px) 在 3D 预设主题前方一层渲染。
  // 此分支独立执行, 不受 canvasEl 是否就绪影响。
  if (lyricLayerEl) {
    const bg2 = lyricLayerOriginalParent ?? document.querySelector('[data-global-background]')
    const lyricTarget = target ?? bg2
    if (lyricTarget && lyricLayerEl.parentElement !== lyricTarget) {
      lyricTarget.appendChild(lyricLayerEl)
    }
  }

  if (moved) {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }
}

/**
 * IntersectionObserver 回调: 自动将 canvas reparent 到最可见的 stage。
 * 阈值: > 0.3 切换到新 stage; < 0.15 时回退到 GlobalBackground。
 */
function handleStageIntersection(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    const stageId = findStageIdByElement(entry.target as HTMLElement)
    if (stageId) {
      stageRatios.set(stageId, entry.intersectionRatio)
    }
  }

  // 找到可见度最高的 stage
  let bestId: string | null = null
  let bestRatio = 0
  for (const [id, ratio] of stageRatios) {
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestId = id
    }
  }

  if (bestId && bestRatio > 0.3 && bestId !== currentStageId) {
    currentStageId = bestId
    const stage = stageRegistry.get(bestId)
    if (stage) {
      reparentCanvas(stage)
    }
  } else if (bestRatio < 0.15 && currentStageId) {
    // 没有 stage 足够可见 — canvas 回到 GlobalBackground
    currentStageId = null
    reparentCanvas(null)
  }
}

function findStageIdByElement(el: HTMLElement): string | null {
  for (const [id, stageEl] of stageRegistry) {
    if (stageEl === el) return id
  }
  return null
}

/**
 * 注册一个 3D stage 元素。IntersectionObserver 会自动检测该 stage 何时成为
 * 最可见的, 并将 canvas reparent 到其中。
 *
 * 在页面的 onMounted 中调用, 传入该页面的 3D 透视舞台元素
 * (具有 perspective + transform-style: preserve-3d 的容器)。
 *
 * @param id 唯一标识符 (如 'home', 'music', 'fitness')
 * @param element stage DOM 元素
 */
function registerStage(id: string, element: HTMLElement) {
  stageRegistry.set(id, element)
  stageRatios.set(id, 0)

  if (!stageObserver) {
    stageObserver = new IntersectionObserver(handleStageIntersection, {
      root: null, // viewport
      threshold: [0, 0.15, 0.3, 0.5, 0.7, 1.0],
    })
  }
  stageObserver.observe(element)

  // 如果当前没有激活的 stage, 立即检查这个 stage 是否可见
  if (!currentStageId) {
    // 手动触发一次检测
    requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect()
      const viewportH = window.innerHeight
      const visibleH = Math.min(rect.bottom, viewportH) - Math.max(rect.top, 0)
      const ratio = visibleH > 0 ? Math.min(1, visibleH / rect.height) : 0
      stageRatios.set(id, ratio)
      if (ratio > 0.3) {
        currentStageId = id
        reparentCanvas(element)
      }
    })
  }
}

/**
 * 注销一个 3D stage 元素。在页面的 onUnmounted 中调用。
 * 如果被注销的 stage 当前持有 canvas, canvas 会回到 GlobalBackground。
 */
function unregisterStage(id: string) {
  const el = stageRegistry.get(id)
  if (el) {
    stageObserver?.unobserve(el)
  }
  stageRegistry.delete(id)
  stageRatios.delete(id)

  if (currentStageId === id) {
    currentStageId = null
    // 寻找下一个可见的 stage
    let bestId: string | null = null
    let bestRatio = 0
    for (const [sid, ratio] of stageRatios) {
      if (ratio > bestRatio) {
        bestRatio = ratio
        bestId = sid
      }
    }
    if (bestId && bestRatio > 0.3) {
      currentStageId = bestId
      const stage = stageRegistry.get(bestId)
      if (stage) reparentCanvas(stage)
    } else {
      reparentCanvas(null)
    }
  }
}

/**
 * Register the global lyric layer element so it can be reparented alongside
 * the visualizer canvas into stage elements. Called by App.vue on mount.
 */
function setLyricLayerElement(el: HTMLElement | null) {
  lyricLayerEl = el
  if (el && !lyricLayerOriginalParent) {
    lyricLayerOriginalParent = el.parentElement
  }
  // 立即 reparent 到当前活跃的 stage (修复时序问题:
  // registerStage → reparentCanvas 在 App.vue onMounted 之前执行,
  // 此时 lyricLayerEl 还是 null, 歌词层不会被 reparent)
  if (el && currentStageId) {
    const stage = stageRegistry.get(currentStageId)
    if (stage) {
      reparentCanvas(stage)
    }
  }
}

export function useGlobalVisualizer() {
  const musicStore = useMusicStore()
  const route = useRoute()

  // Keep refs accessible to module-level helpers so lifecycle decisions can be
  // made without requiring every caller to pass state around.
  musicStoreRef = musicStore
  routeRef = ref({ path: route.path })

  // React to route/playback changes and start/stop the visualizer accordingly.
  watch(
    () => [route.path, musicStore.currentTrack?.id, musicStore.isPlaying] as const,
    () => {
      maybeInitBackground()
    },
    { immediate: true }
  )

  /**
   * Bind drag/wheel interaction to a container element. Called by PlayerPage
   * on mount so the user can rotate/zoom the background visualizer while on
   * the /player route. Other routes don't call this, leaving the background
   * non-interactive (pointer-events: none on the global container).
   */
  function attachInteraction(container: HTMLElement) {
    interactionContainer = container
    visualizerInstance?.attachInteraction(container)
  }

  /**
   * Clear the interaction binding. Called by DualDeckHome when disengaging
   * or by PlayerPage on unmount. Properly removes all pointer/wheel/touch
   * listeners from the container so 3D interaction is fully disabled.
   */
  function detachInteraction() {
    interactionContainer = null
    visualizerInstance?.detachInteraction()
  }

  function onTransformChange(cb: ((t: { rotationX: number; rotationY: number; scale: number }) => void) | null) {
    transformCallback = cb
  }

  async function switchPreset(name: PresetName) {
    activePreset.value = name
    visualizerInstance?.switchPreset(name)

    if (window.electronAPI) {
      try {
        await window.electronAPI.settings.set('visualizer.preset', name)
      } catch (e) {
        console.warn('[useGlobalVisualizer] Failed to save preset setting:', e)
      }
    }

    // Reset to a clean angle on cover-related presets
    if (name === 'cover' || name === 'tiles' || name === 'reactive' || name === 'lens') {
      visualizerInstance?.resetCoverTransform()
      // Reset dome angle mode when switching to/from tiles
      domeAngleMode.value = 'front'
    }
  }

  /**
   * Flip the tile-grid dome between front (0°) and back (180°) views.
   * Only affects the 'tiles' preset.
   */
  function flipDomeAngle() {
    const result = visualizerInstance?.flipDomeAngle()
    if (result) {
      domeAngleMode.value = result
    }
  }

  /**
   * Camera WASD control — key down/up for smooth continuous movement.
   */
  function cameraKeyDown(key: string) {
    visualizerInstance?.cameraKeyDown(key)
  }

  function cameraKeyUp(key: string) {
    visualizerInstance?.cameraKeyUp(key)
  }

  function resetCameraPosition() {
    visualizerInstance?.resetCameraPosition()
  }

  function isCameraAtDefault(): boolean {
    return visualizerInstance?.isCameraAtDefault() ?? true
  }

  function setVisualizerQuality(q: 'high' | 'medium' | 'low') {
    visualizerInstance?.setQuality(q)
  }

  return {
    visualizer: visualizerRef,
    activePreset,
    domeAngleMode,
    lyricAudioData,
    lyricLines,
    currentLyricText,
    currentLyricIndex,
    lyricLoading,
    initBackground: maybeInitBackground,
    attachInteraction,
    detachInteraction,
    onTransformChange,
    reparentCanvas,
    registerStage,
    unregisterStage,
    switchPreset,
    flipDomeAngle,
    cameraKeyDown,
    cameraKeyUp,
    resetCameraPosition,
    isCameraAtDefault,
    setAuroraIdleColor: (hex: string | null) => visualizerInstance?.setAuroraIdleColor(hex),
    setAuroraPlayingColor: (hex: string | null) => visualizerInstance?.setAuroraPlayingColor(hex),
    setVisualizerQuality,
    setVisualDiy: (params: { scale: number; particleDensity: number; depth: number; glow: number }) => {
      pendingVisualDiy = params
      visualizerInstance?.setVisualDiy(params)
    },
    setLyricLayerElement,
  }
}
