import { defineStore } from 'pinia'
import { ref, shallowRef, markRaw, computed, watch } from 'vue'
import { Howl, Howler } from 'howler'
import { cachedFetch, cacheInvalidateAll, CacheNS, CacheTTL } from '@/modules/music/cache'
import { sampleCoverPalette, type CoverPalette } from '@/utils/colorSampler'
import { useGlobalToast } from '@/composables/useGlobalToast'
import type { Track, PlayMode } from '@/types'

export const useMusicStore = defineStore('music', () => {
  // ===== Reactive State =====
  const queue = shallowRef<Track[]>([])
  const currentIndex = ref(-1)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(0.7)
  const playMode = ref<PlayMode>('sequential')
  const isLoading = ref(false)

  // ===== Netease quality level =====
  type NeteaseQuality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires'
  const neteaseQuality = ref<NeteaseQuality>('exhigh')

  // ===== QQ Music quality level =====
  // '128' = standard MP3, '320' = high MP3, 'flac' = lossless
  type QqQuality = '128' | '320' | 'flac'
  const qqQuality = ref<QqQuality>('320')

  // ===== VIP reminder =====
  // When a VIP-only song is encountered, this is set so the UI can show a dialog.
  const vipReminder = ref<{ trackTitle: string; trackId: string } | null>(null)

  // ===== Quality switch feedback =====
  // Set when a quality switch fails (e.g. user is not VIP). UI shows a toast.
  const qualitySwitchError = ref<string | null>(null)

  // ===== Cover palette for glass UI tinting =====
  const currentCoverPalette = ref<CoverPalette | null>(null)

  // ===== Internal audio engine =====
  let currentHowl: Howl | null = null
  // Bumped every time a new track is requested. Lets the in-flight URL
  // resolver detect that it's working for a track the user no longer
  // wants, so it can bail out instead of playing the wrong song when
  // the user spam-clicks "next".
  let playGeneration = 0
  // Consecutive auto-skip failure counter — prevents infinite loops when
  // all tracks in the queue are unplayable (e.g. all VIP, all expired URLs).
  // Reset to 0 whenever a track successfully loads.
  let consecutiveFailCount = 0
  const MAX_CONSECUTIVE_FAILS = 5
  // When switching quality, we save the current playback position and seek
  // to it after the new audio loads. Set to null when no seek is pending.
  let pendingSeekTime: number | null = null

  const currentTrack = computed(() => {
    if (currentIndex.value >= 0 && currentIndex.value < queue.value.length) {
      return queue.value[currentIndex.value]
    }
    return null
  })

  const hasNext = computed(() => {
    if (playMode.value === 'shuffle') return queue.value.length > 1
    return currentIndex.value < queue.value.length - 1
  })

  const hasPrev = computed(() => currentIndex.value > 0)

  // ===== Helpers =====
  function stopAudio() {
    // Bump playGeneration so any in-flight Howl callbacks (onload, onplay,
    // etc.) from the previous Howl instance are detected as stale and
    // bail out early. This is critical for clearQueue() which calls
    // stopAudio() without going through createAndPlayHowl().
    playGeneration++
    if (currentHowl && typeof currentHowl.stop === 'function') {
      currentHowl.stop()
    }
    if (currentHowl && typeof currentHowl.destroy === 'function') {
      currentHowl.destroy()
    }
    currentHowl = null
    isPlaying.value = false
    isLoading.value = false
  }

  // NOTE: The 200ms global timer that wrote to currentTime.value has been
  // removed. Consumers that need playback position should poll
  // getPlaybackPosition() at their own frequency (PlayerBar already does
  // this via its own 200ms setInterval; the visualizer uses rAF).

  /**
 * Determine whether this track needs HTML5 Audio mode.
 * 
 * Local files: use Web Audio API (html5: false) so the audio signal flows
 * through the Web Audio graph and can be tapped by the analyser.
 * 
 * Netease streams: use HTML5 Audio (html5: true) because:
 * 1. Streaming URLs require HTML5 Audio for proper buffering
 * 2. CORS restrictions prevent Web Audio API from decoding the stream
 * 3. The analyser will use createMediaElementSource() as a fallback
 */
function shouldUseHtml5(track: Track): boolean {
  return track.source === 'netease' || track.source === 'qq'
}

// Store the current track's audio mode so PlayerPage can choose the right analyzer connection
let currentTrackUsesHtml5 = false

function getCurrentTrackUsesHtml5(): boolean {
  return currentTrackUsesHtml5
}

/**
 * Detect the audio format from a file path.
 */
function getFormat(path: string): string {
  if (!path) return 'mp3'
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'flac': return 'flac'
    case 'wav': return 'wav'
    case 'm4a': return 'm4a'
    default: return 'mp3'
  }
}

/**
 * Convert a file-system path to a renderer-safe URL.
   * For local files we use the custom `beat://` protocol registered in the
   * main process, which avoids the "Not allowed to load local resource" error.
   */
  function toMediaUrl(track: Track): string {
    if (track.source === 'local') {
      const rawPath = track.localPath
      return `beat://${encodeURIComponent(rawPath)}`
    }
    // Online sources (e.g. Netease) keep the original URL
    return track.localPath
  }

  /**
   * Resolve the actual playable URL for a track. For Netease tracks the
   * URL is fetched on demand (because the original `localPath` in the
   * queue is empty — we just have the song id). For local tracks the
   * localPath already points at the file. Result is memoized in the
   * shared Netease song-URL cache so the second time the same song is
   * played (e.g. via "next/prev") we skip the IPC roundtrip.
   */
  async function resolvePlayableUrl(track: Track): Promise<{ url: string; format: string } | null> {
    if (track.source === 'netease' && track.sourceId) {
      const songUrl: import('@/types/netease.d').NeteaseSongUrl | null = await cachedFetch(
        CacheNS.NeteaseSongUrl,
        `${track.sourceId}:${neteaseQuality.value}`,
        async () => {
          const result = await window.electronAPI!.netease.getSongUrl(Number(track.sourceId), neteaseQuality.value)
          if (!result.success || !result.data) return null
          return result.data.url
        },
        { ttlMs: CacheTTL.SONG_URL }
      )
      // VIP detection: check for VIP-only songs and free trial songs
      // Case 1: URL is null/empty → VIP-only song (fee=1 or fee=4)
      // Case 2: URL is valid but freeTrialInfo is set → 30-second trial
      if (!songUrl?.url) {
        const fee = songUrl?.fee
        if (fee === 1 || fee === 4 || fee === 8 ||
            (songUrl?.canPlay === false && songUrl?.reason === 'no_url')) {
          vipReminder.value = { trackTitle: track.title, trackId: track.id }
        }
        return null
      }
      // Check for free trial (VIP song with 30-second preview)
      if (songUrl.freeTrialInfo) {
        vipReminder.value = { trackTitle: track.title, trackId: track.id }
      }
      // Proxy through beat:// to bypass CORS restrictions.
      // Netease CDN (m701.music.126.net) doesn't send Access-Control-Allow-Origin,
      // so createMediaElementSource() outputs all-zeros. The beat:// protocol
      // handler fetches server-side and returns Access-Control-Allow-Origin: *.
      return { url: `beat://${encodeURIComponent(songUrl.url)}`, format: 'mp3' }
    }
    // QQ Music tracks — resolve via qq:getSongUrl
    if (track.source === 'qq' && track.sourceId) {
      const songUrl: import('@/types/qq.d').QqSongUrl | null = await cachedFetch(
        CacheNS.QqSongUrl,
        `${track.sourceId}:${qqQuality.value}:${track.vip ? 'vip' : 'std'}`,
        async () => {
          const result = await window.electronAPI!.qq.getSongUrl(track.sourceId!, qqQuality.value, track.sourceMediaMid, track.vip === true)
          if (!result.success || !result.data) return null
          return result.data.url
        },
        { ttlMs: CacheTTL.SONG_URL }
      )
      // VIP detection for QQ Music
      if (!songUrl?.url) {
        // QQ Music VIP songs are skipped immediately — Web API doesn't provide trial clips.
        // Don't set vipReminder (no dialog), just return null to trigger auto-skip.
        return null
      }
      // Trial URL (C400 m4a) — VIP song with 30-second preview
      if (songUrl.reason === 'trial') {
        vipReminder.value = { trackTitle: track.title, trackId: track.id }
      }
      // Proxy through beat:// to bypass CORS restrictions (same as Netease)
      // C400 trial format is m4a (AAC in MP4 container)
      const format = songUrl.type === 'flac' ? 'flac' : (songUrl.type === 'm4a' ? 'm4a' : 'mp3')
      return { url: `beat://${encodeURIComponent(songUrl.url)}`, format }
    }
    return { url: toMediaUrl(track), format: getFormat(track.localPath) }
  }

  /**
   * Convert a cover path to a renderer-safe URL.
   */
function toCoverUrl(coverPath: string | null | undefined): string | undefined {
if (!coverPath) return undefined
// Proxy ALL cover images through beat:// to avoid CORS issues with
// remote CDNs (e.g. Netease p1.music.126.net doesn't send CORS headers).
// The Electron main process fetches remote URLs and serves them with
// Access-Control-Allow-Origin: *, so the renderer never hits a CORS
// error regardless of the source.
return `beat://${encodeURIComponent(coverPath)}`
}

  /**
   * Legacy: Expose the underlying HTMLAudioElement from Howler.js.
   * NOTE: This is no longer used for audio visualization. Instead, we connect
   * to Howler's master gain node via `Howler.masterGain` to avoid CORS issues
   * and createMediaElementSource conflicts.
   * 
   * Kept for backward compatibility if needed elsewhere.
   */
  function getCurrentAudioElement(): HTMLAudioElement | null {
    if (!currentHowl) return null
    const sounds = (currentHowl as any)._sounds
    if (sounds && sounds.length > 0 && sounds[0]._node) {
      return sounds[0]._node as HTMLAudioElement
    }
    return null
  }

  async function createAndPlayHowl(track: Track) {
    // Stop and destroy the old Howl immediately so it stops producing sound.
    // stopAudio() increments playGeneration, invalidating old callbacks.
    stopAudio()
    const myGeneration = ++playGeneration
    isLoading.value = true

    // Determine audio mode based on track source
    const useHtml5 = shouldUseHtml5(track)
    currentTrackUsesHtml5 = useHtml5

    // Netease tracks need a network roundtrip to get the actual play URL;
    // the Track object in the queue only carries the song id. Local tracks
    // already have a localPath and can resolve synchronously.
    const resolved = await resolvePlayableUrl(track)
    // If the user clicked "next" while we were resolving, abandon this
    // track — the newer createAndPlayHowl call has already taken over.
    if (myGeneration !== playGeneration) {
      isLoading.value = false
      return
    }
    if (!resolved) {
      console.warn('[music] No playable URL for track:', track.title, 'source:', track.source)
      isLoading.value = false
      // For QQ Music VIP tracks, skip immediately (no trial available via Web API).
      // For Netease VIP tracks with trial clips, delay to show the dialog.
      const isQqVip = track.vip === true
      const skipDelay = (!isQqVip && vipReminder.value) ? 2500 : 0
      if (isQqVip) {
        // Show a brief toast so the user knows why the song was skipped
        useGlobalToast().vip(`「${track.title}」需要 VIP，已自动跳过`)
        vipReminder.value = null
      }
      if (currentIndex.value < queue.value.length - 1) {
        setTimeout(() => {
          if (myGeneration === playGeneration) nextTrack()
        }, skipDelay)
      }
      return
    }
    const src = resolved.url
    const audioFormat = resolved.format

    // For HTML5 mode (Netease streams), we must set crossOrigin='anonymous'
    // on the underlying <audio> element so that createMediaElementSource()
    // can access the audio data without tainting the Web Audio graph.
    // Howler 2.x doesn't expose a crossOrigin option, so we temporarily
    // patch window.Audio to inject the attribute at construction time.
    if (useHtml5) {
      const OrigAudio = window.Audio
      window.Audio = class extends OrigAudio {
        constructor(src?: string) {
          super(src)
          this.crossOrigin = 'anonymous'
        }
      } as typeof Audio
      try {
        // Use a local variable so callbacks always reference the correct
        // Howl instance, even if currentHowl is set to null by a later
        // stopAudio()/clearQueue() call before the callback fires.
        const howl = new Howl({
          src: [src],
          html5: useHtml5,
          volume: volume.value,
          format: [audioFormat],
          onload: () => {
            if (myGeneration !== playGeneration) return
            duration.value = howl.duration()
            isLoading.value = false
            consecutiveFailCount = 0
            howl.play()
          },
          onloaderror: (_id: number, error: unknown) => {
            if (myGeneration !== playGeneration) return
            console.error('Audio load error:', error, 'src:', src)
            isLoading.value = false
            isPlaying.value = false
            consecutiveFailCount++
            // Show user-facing toast so they know why the song was skipped
            if (consecutiveFailCount >= MAX_CONSECUTIVE_FAILS) {
              useGlobalToast().error('多首歌曲无法播放，已停止自动跳过')
              return
            }
            useGlobalToast().warning(`「${track.title}」加载失败，已跳过`)
            // Auto-skip to next track after a short delay so the user
            // isn't stuck on a broken URL (expired vkey, 403, etc.)
            if (currentIndex.value < queue.value.length - 1) {
              setTimeout(() => {
                if (myGeneration === playGeneration) nextTrack()
              }, 1500)
            }
          },
          onplay: () => {
            isPlaying.value = true
            // If this is a quality switch, restore playback position.
            // Must be done in onplay (not onload) because HTML5 audio
            // needs to be actively playing before seeking works.
            if (pendingSeekTime !== null && pendingSeekTime > 0) {
              const seekTime = pendingSeekTime
              pendingSeekTime = null
              // Small delay to let the audio element settle into playing state
              setTimeout(() => {
                if (myGeneration === playGeneration) {
                  howl.seek(seekTime)
                  currentTime.value = seekTime
                }
              }, 150)
            }
          },
          onpause: () => {
            isPlaying.value = false
          },
          onend: () => {
            if (playMode.value === 'repeat') {
              howl.seek(0)
              howl.play()
            } else {
              nextTrack()
            }
          },
          onstop: () => {
            isPlaying.value = false
          }
        })
        currentHowl = howl
      } finally {
        window.Audio = OrigAudio
      }
      return
    }

    // Use a local variable so callbacks always reference the correct
    // Howl instance, even if currentHowl is set to null by a later
    // stopAudio()/clearQueue() call before the callback fires.
    const howl = new Howl({
      src: [src],
      html5: useHtml5,
      volume: volume.value,
      format: [audioFormat],
      onload: () => {
        if (myGeneration !== playGeneration) return
        duration.value = howl.duration()
        isLoading.value = false
        howl.play()
      },
      onloaderror: (_id: number, error: unknown) => {
        if (myGeneration !== playGeneration) return
        console.error('Audio load error:', error, 'src:', src)
        isLoading.value = false
        isPlaying.value = false
        // Auto-skip to next track after a short delay so the user
        // isn't stuck on a broken URL (expired vkey, 403, etc.)
        if (currentIndex.value < queue.value.length - 1) {
          setTimeout(() => {
            if (myGeneration === playGeneration) nextTrack()
          }, 1500)
        }
      },
      onplay: () => {
        isPlaying.value = true
        // If this is a quality switch, restore playback position.
        // Must be done in onplay (not onload) because HTML5 audio
        // needs to be actively playing before seeking works.
        if (pendingSeekTime !== null && pendingSeekTime > 0) {
          const seekTime = pendingSeekTime
          pendingSeekTime = null
          setTimeout(() => {
            if (myGeneration === playGeneration) {
              howl.seek(seekTime)
              currentTime.value = seekTime
            }
          }, 150)
        }
      },
      onpause: () => {
        isPlaying.value = false
      },
      onend: () => {
        if (playMode.value === 'repeat') {
          howl.seek(0)
          howl.play()
        } else {
          nextTrack()
        }
      },
      onstop: () => {
        isPlaying.value = false
      }
    })
    currentHowl = howl
  }

  // ===== Public actions =====
  function setQueue(tracks: Track[], startIndex = 0) {
    queue.value = markRaw(tracks)
    currentIndex.value = Math.min(startIndex, tracks.length - 1)
  }

  function addToQueue(track: Track) {
    queue.value = markRaw([...queue.value, track])
  }

  function playTrack(track: Track) {
    const existingIndex = queue.value.findIndex(t => t.id === track.id)
    if (existingIndex >= 0) {
      currentIndex.value = existingIndex
    } else {
      queue.value = markRaw([...queue.value, track])
      currentIndex.value = queue.value.length - 1
    }
    // Persist lastPlayedAt to the database so the HomePage "最近播放" card
    // reflects real playback history. Fire-and-forget — UI doesn't need to wait.
    window.electronAPI?.music.updateLastPlayed(track.id).catch((e) => console.warn('[music] Failed to update lastPlayed:', e))
    createAndPlayHowl(track)
  }

  function playIndex(index: number) {
    if (index >= 0 && index < queue.value.length) {
      currentIndex.value = index
      createAndPlayHowl(queue.value[index])
    }
  }

  function togglePlay() {
    if (!currentHowl) {
      const track = currentTrack.value
      if (track) createAndPlayHowl(track)
      return
    }
    if (currentHowl.playing()) {
      currentHowl.pause()
    } else {
      // ── Proactively resume the AudioContext before playing ──
      // When the app returns from background, the AudioContext may be
      // suspended by Chromium. Howler's play() will internally try to
      // resume it, but this can cause a 100-500ms delay. By resuming
      // it here (fire-and-forget), we overlap the resume with Howler's
      // internal setup, reducing perceived latency.
      const ctx = (Howler as any).ctx as AudioContext | undefined
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
      currentHowl.play()
    }
  }

  function nextTrack() {
    if (queue.value.length === 0) return

    if (playMode.value === 'shuffle') {
      currentIndex.value = Math.floor(Math.random() * queue.value.length)
    } else if (playMode.value === 'repeat') {
      // handled in onend
    } else {
      if (currentIndex.value < queue.value.length - 1) {
        currentIndex.value++
      } else {
        isPlaying.value = false
        return
      }
    }

    const track = currentTrack.value
    if (track) createAndPlayHowl(track)
  }

  function prevTrack() {
    if (currentIndex.value > 0) {
      currentIndex.value--
      const track = currentTrack.value
      if (track) createAndPlayHowl(track)
    }
  }

  function seekTo(time: number) {
    if (currentHowl) {
      currentHowl.seek(time)
      currentTime.value = time
    }
  }

  /**
   * Read the current playback position directly from the Howl instance.
   * Non-reactive — does NOT write to the `currentTime` ref.
   *
   * Use this for high-frequency polling (e.g. PlayerBar's 200ms progress
   * bar updates) to avoid triggering global Pinia reactivity and causing
   * every component that reads `currentTime` to re-render.
   *
   * Reads from the Howl even when paused so the paused position is accurate.
   * The `currentTime` ref is only used as a fallback when no Howl exists
   * (e.g. track loaded but audio not yet created, or after stopAudio()).
   */
  function getPlaybackPosition(): number {
    if (currentHowl) {
      return (currentHowl.seek() as number) || currentTime.value
    }
    return currentTime.value
  }

  /**
   * Read the current track duration directly from the Howl instance.
   * Non-reactive — companion to getPlaybackPosition().
   */
  function getPlaybackDuration(): number {
    if (currentHowl) {
      return currentHowl.duration() || duration.value
    }
    return duration.value
  }

  function setVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol))
    volume.value = clamped
    if (currentHowl) currentHowl.volume(clamped)
  }

  function cyclePlayMode() {
    const modes: PlayMode[] = ['sequential', 'repeat', 'shuffle']
    const idx = modes.indexOf(playMode.value)
    playMode.value = modes[(idx + 1) % modes.length]
  }

  function clearQueue() {
    stopAudio()
    queue.value = []
    currentIndex.value = -1
  }

  // Keep the glass UI palette in sync with the current track cover.
  watch(
    () => currentTrack.value?.coverPath,
    async (coverPath) => {
      if (!coverPath) {
        currentCoverPalette.value = null
        return
      }
      currentCoverPalette.value = await sampleCoverPalette(toCoverUrl(coverPath))
    },
    { immediate: true }
  )

  function setNeteaseQuality(quality: typeof neteaseQuality.value) {
    neteaseQuality.value = quality
    // Clear the song URL cache so the next play uses the new quality
    cacheInvalidateAll(CacheNS.NeteaseSongUrl)
  }

  function setQqQuality(quality: typeof qqQuality.value) {
    qqQuality.value = quality
    cacheInvalidateAll(CacheNS.QqSongUrl)
  }

  /**
   * Try switching quality with server-side validation.
   *
   * If a Netease track is currently playing, we attempt to fetch the song URL
   * at the new quality before committing the change. If the server returns no
   * URL (VIP-only or unavailable), we reject with an error message and keep
   * the old quality. If no track is playing, we accept the change directly.
   */
  async function trySwitchQuality(quality: typeof neteaseQuality.value): Promise<{ ok: true } | { ok: false; error: string }> {
    qualitySwitchError.value = null

    // No track playing — allow freely
    if (!currentTrack.value) {
      setNeteaseQuality(quality)
      return { ok: true }
    }

    // Non-Netease track — quality doesn't apply
    if (currentTrack.value.source !== 'netease' || !currentTrack.value.sourceId) {
      setNeteaseQuality(quality)
      return { ok: true }
    }

    // Same quality — no-op
    if (quality === neteaseQuality.value) {
      return { ok: true }
    }

    // Probe the server: fetch song URL at the new quality (uncached)
    try {
      const result = await window.electronAPI!.netease.getSongUrl(
        Number(currentTrack.value.sourceId), quality
      )

      if (!result.success || !result.data) {
        const friendly = quality === 'lossless' || quality === 'hires'
          ? '当前音质需要VIP，无法切换'
          : '切换失败：网络错误'
        qualitySwitchError.value = friendly
        return { ok: false, error: friendly }
      }

      // result.data.url is the NeteaseSongUrl object (not a string)
      const songUrl = result.data.url
      if (!songUrl || !songUrl.url) {
        const friendly = quality === 'lossless' || quality === 'hires'
          ? '当前音质需要VIP，无法切换'
          : '切换失败：无法获取播放链接'
        qualitySwitchError.value = friendly
        return { ok: false, error: friendly }
      }

      // Detect trial URL for VIP-only qualities (lossless, hires).
      // If the API returns a 30-second trial at these qualities, the user
      // doesn't have VIP access — block the switch.
      //
      // IMPORTANT: For free qualities (standard, higher, exhigh), we do NOT
      // block on freeTrialInfo. VIP-only songs (fee=1) return trial URLs at
      // ALL quality levels — the user is already hearing a trial at the
      // current quality, so switching to another free quality is perfectly
      // valid and should not be blocked.
      if (songUrl.freeTrialInfo && (quality === 'lossless' || quality === 'hires')) {
        const friendly = '当前音质需要VIP，无法切换'
        qualitySwitchError.value = friendly
        return { ok: false, error: friendly }
      }

      // Detect silent quality downgrade.
      // The Netease API may return a valid URL at a lower quality than
      // requested when the user doesn't have VIP access. For example,
      // requesting 'lossless' might return a 320kbps MP3 URL without
      // any error or freeTrialInfo. We detect this by checking the
      // returned bitrate against the expected minimum for each level.
      //
      // Expected bitrates:
      //   standard  → 128kbps  (128000)
      //   higher    → 192kbps  (192000)
      //   exhigh    → 320kbps  (320000)
      //   lossless  → FLAC     (700kbps+, typically 900-1500kbps)
      //   hires     → Hi-Res   (1500kbps+, typically 2000-5000kbps)
      const QUALITY_MIN_BR: Record<string, number> = {
        standard: 0,
        higher: 0,
        exhigh: 0,
        lossless: 500000,  // FLAC should be at least 500kbps
        hires: 1000000,    // Hi-Res should be at least 1Mbps
      }
      const minBr = QUALITY_MIN_BR[quality] || 0
      if (minBr > 0 && (songUrl.br || 0) < minBr) {
        console.warn(
          `[music] Quality downgrade detected: requested "${quality}" (min br=${minBr})` +
          ` but got br=${songUrl.br}, type=${songUrl.type || 'unknown'}`
        )
        const friendly = '当前音质需要VIP，无法切换'
        qualitySwitchError.value = friendly
        return { ok: false, error: friendly }
      }

      // Also check the file type: if we requested lossless (FLAC) but got
      // MP3, it's a downgrade even if the bitrate somehow passes.
      if ((quality === 'lossless' || quality === 'hires') &&
          songUrl.type && songUrl.type.toLowerCase() === 'mp3') {
        console.warn(
          `[music] Format downgrade detected: requested "${quality}"` +
          ` but got type="${songUrl.type}", br=${songUrl.br}`
        )
        const friendly = '当前音质需要VIP，无法切换'
        qualitySwitchError.value = friendly
        return { ok: false, error: friendly }
      }

      // Success — save current playback position so we can resume
      pendingSeekTime = currentTime.value

      // Commit quality change and reload
      setNeteaseQuality(quality)
      await playTrack(currentTrack.value)
      return { ok: true }
    } catch (e: any) {
      const friendly = `切换失败：${e.message || '网络错误'}`
      qualitySwitchError.value = friendly
      return { ok: false, error: friendly }
    }
  }

  function clearQualitySwitchError() {
    qualitySwitchError.value = null
  }

  function clearVipReminder() {
    vipReminder.value = null
  }

  return {
    queue, currentIndex, currentTrack, isPlaying, currentTime, duration,
    volume, playMode, isLoading, hasNext, hasPrev,
    currentCoverPalette,
    neteaseQuality, vipReminder, qualitySwitchError,
    qqQuality,
    setQueue, addToQueue, playTrack, playIndex, togglePlay, nextTrack, prevTrack,
    seekTo, getPlaybackPosition, getPlaybackDuration, setVolume, cyclePlayMode, clearQueue,
    stopAudio, toCoverUrl, getCurrentAudioElement, getCurrentTrackUsesHtml5,
    setNeteaseQuality, trySwitchQuality, clearQualitySwitchError, clearVipReminder,
    setQqQuality
  }
})
