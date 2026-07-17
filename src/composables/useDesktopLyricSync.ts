import { ref, watch, onUnmounted, type Ref } from 'vue'
import { useMusicStore } from '@/stores/music'
import { findCurrentLine, type LyricsLine } from '@/modules/music/lyricParser'

 /**
 * Desktop Lyric Sync Composable
 *
 * Polls the music store's playback position via getPlaybackPosition() and
 * sends the current + next lyric line to the desktop lyric window via IPC.
 *
 * Performance:
 * - Uses a 200ms interval polling getPlaybackPosition() instead of watching
 *   the reactive currentTime ref (which no longer updates continuously).
 * - Only sends IPC updates when the current line index changes.
 */
export function useDesktopLyricSync(lyricLinesRef: Ref<LyricsLine[]>) {
  const musicStore = useMusicStore()
  const isVisible = ref(false)
  const lastLineIndex = ref(-1)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // Listen for visibility changes from the main process (e.g. when
  // the user clicks the close button inside the desktop lyric window).
  let visibilityHandler: ((...args: any[]) => void) | null = null

  // Reset line index when lyrics change, and send an immediate update
  // if the window is visible so the user sees lyrics right away.
  watch(lyricLinesRef, () => {
    lastLineIndex.value = -1
    if (isVisible.value) {
      sendCurrentLyric()
    }
  })

  // Poll playback position every 200ms — only sends IPC when line changes.
  // Uses getPlaybackPosition() (non-reactive) instead of watching the
  // currentTime ref, since the 200ms global timer has been removed.
  pollTimer = setInterval(() => {
    if (!isVisible.value || lyricLinesRef.value.length === 0) return
    if (!musicStore.isPlaying) return

    const time = musicStore.getPlaybackPosition()
    const lineIdx = findCurrentLine(lyricLinesRef.value, time)
    if (lineIdx === lastLineIndex.value) return // no change — skip IPC

    lastLineIndex.value = lineIdx

    const currentLine = lineIdx >= 0 ? lyricLinesRef.value[lineIdx].text : ''
    const nextLine = lineIdx >= 0 && lineIdx < lyricLinesRef.value.length - 1
      ? lyricLinesRef.value[lineIdx + 1].text
      : ''
    const translation = lineIdx >= 0 ? lyricLinesRef.value[lineIdx].translation : undefined

    window.electronAPI?.send('desktopLyric:update', {
      currentLine,
      nextLine,
      translation,
      trackTitle: musicStore.currentTrack?.title || '',
      trackArtist: musicStore.currentTrack?.artist || '',
    })
  }, 200)

  // Toggle desktop lyric visibility
  async function toggle(): Promise<boolean> {
    const result = await window.electronAPI?.desktopLyric.toggle()
    if (result?.success && result.data) {
      isVisible.value = result.data.visible
      if (isVisible.value) {
        // Reset line index so the first update is sent immediately
        lastLineIndex.value = -1
        // Send an immediate lyric update for the current playback position
        sendCurrentLyric()
        // Re-send after a short delay — the desktop lyric window may
        // still be loading its page and hasn't registered its IPC
        // listener yet. The main process also re-sends on did-finish-load,
        // but this covers the case where lyrics load after the window.
        setTimeout(() => {
          if (isVisible.value) {
            lastLineIndex.value = -1
            sendCurrentLyric()
          }
        }, 1500)
      } else {
        lastLineIndex.value = -1 // reset so next show sends fresh data
      }
    }
    return isVisible.value
  }

  // Send the current lyric line to the desktop lyric window immediately.
  // Called on toggle-on and can be called manually if needed.
  function sendCurrentLyric() {
    if (!isVisible.value || lyricLinesRef.value.length === 0) return
    const time = musicStore.getPlaybackPosition()
    const lineIdx = findCurrentLine(lyricLinesRef.value, time)
    lastLineIndex.value = lineIdx
    const currentLine = lineIdx >= 0 ? lyricLinesRef.value[lineIdx].text : ''
    const nextLine = lineIdx >= 0 && lineIdx < lyricLinesRef.value.length - 1
      ? lyricLinesRef.value[lineIdx + 1].text
      : ''
    const translation = lineIdx >= 0 ? lyricLinesRef.value[lineIdx].translation : undefined
    window.electronAPI?.send('desktopLyric:update', {
      currentLine,
      nextLine,
      translation,
      trackTitle: musicStore.currentTrack?.title || '',
      trackArtist: musicStore.currentTrack?.artist || '',
    })
  }

  // Check initial visibility state
  async function checkVisibility(): Promise<void> {
    const result = await window.electronAPI?.desktopLyric.isVisible()
    if (result?.success && result.data) {
      isVisible.value = result.data.visible
    }
  }

  // Check on mount
  checkVisibility()

  // Listen for external visibility changes (close button in lyric window)
  visibilityHandler = (...args: any[]) => {
    const data = args[0]
    if (data && typeof data.visible === 'boolean') {
      isVisible.value = data.visible
      if (!data.visible) {
        lastLineIndex.value = -1
      }
    }
  }
  window.electronAPI?.on('desktopLyric:visibilityChanged', visibilityHandler)

  // Cleanup listener and timer on unmount
  onUnmounted(() => {
    if (visibilityHandler) {
      window.electronAPI?.removeListener('desktopLyric:visibilityChanged', visibilityHandler)
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return {
    isVisible,
    toggle,
  }
}
