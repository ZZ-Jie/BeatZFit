/**
 * useRecordShelf Composable
 *
 * 封装 RecordShelfVisualizer 的生命周期管理。
 *
 * 模块级单例策略：
 * 在横向单页架构中，MusicPage 每次切换都会卸载/重挂。
 * 如果每次都 dispose + new RecordShelfVisualizer，会导致：
 * - 重新创建 WebGL 上下文（昂贵）
 * - 重建所有唱片 mesh + 材质 + fallback 纹理（同步 canvas 绘制，数百首曲目时卡顿明显）
 * - 封面图片缓存丢失，所有封面重新加载
 *
 * 解决方案：RecordShelfVisualizer 实例在模块级存活，卸载时仅暂停渲染，
 * 重挂时通过 reattach() 将 canvas 移到新容器并恢复渲染。
 * 仅在曲目列表实际变化时才重建唱片。
 *
 * ★ 虚拟滚动优化 (2026-07-12):
 * - 唱片架仅创建可见范围内的 ~20 条记录（vs 500+），消除首屏卡顿
 * - 模块级图片缓存 + 纹理缓存，预加载封面在应用启动时即可开始
 * - preloadCovers() 在数据加载后立即预加载前 N 张封面
 */
import { shallowRef, watch } from 'vue'
import { useMusicStore } from '@/stores/music'
import { RecordShelfVisualizer, preloadCoverImages } from '@/modules/visualizer/recordShelfVisualizer'
import type { Track } from '@/types'

// Module-level singleton — survives component unmount/remount
let visualizerInstance: RecordShelfVisualizer | null = null

/** 模块级标记：是否已对当前曲目列表执行过预加载 */
let preloadedTrackIds: string | null = null

export function useRecordShelf() {
  const musicStore = useMusicStore()
  const visualizer = shallowRef<RecordShelfVisualizer | null>(null)

  let contextHandler: ((trackId: string, x: number, y: number) => void) | null = null
  let currentTrackWatchStop: (() => void) | null = null

  function init(container: HTMLElement): void {
    if (visualizerInstance && !visualizerInstance.isDisposed()) {
      // Instance already exists from a previous mount — reattach to new container
      visualizerInstance.reattach(container)
    } else {
      // First mount — create new instance
      visualizerInstance = new RecordShelfVisualizer(container)
    }

    visualizer.value = visualizerInstance

    // Re-bind callbacks (they may have changed if MusicPage was remounted)
    visualizerInstance.onSelect((trackId) => {
      const tracks = visualizerInstance?.getTracks() ?? []
      const index = tracks.findIndex(t => t.id === trackId)
      if (index >= 0) {
        musicStore.setQueue(tracks, index)
        musicStore.playIndex(index)
      }
    })

    visualizerInstance.onContext((trackId, x, y) => {
      contextHandler?.(trackId, x, y)
    })

    // Watch current track for highlighting
    if (currentTrackWatchStop) currentTrackWatchStop()
    currentTrackWatchStop = watch(
      () => musicStore.currentTrack?.id,
      (trackId) => {
        visualizerInstance?.setCurrentTrack(trackId ?? null)
      },
      { immediate: true }
    )
  }

  function setTracks(tracks: Track[]): void {
    // Skip expensive record rebuilding if tracks haven't changed
    if (visualizerInstance && visualizerInstance.hasSameTracks(tracks)) {
      return
    }
    visualizerInstance?.setTracks(tracks, (t) => musicStore.toCoverUrl(t.coverPath))
  }

  function setSpacing(spacing: number): void {
    visualizerInstance?.setSpacing(spacing)
  }

  function onContext(handler: (trackId: string, x: number, y: number) => void): void {
    contextHandler = handler
  }

  /**
   * 预加载封面图片到模块级缓存。
   * 在库数据加载完毕后立即调用，让前 N 张封面在用户进入音乐页前就加载完毕。
   * 当 RecordShelfVisualizer 实例创建时，直接从缓存读取，实现 0 延迟封面显示。
   *
   * @param tracks 曲目列表
   * @param maxCount 最多预加载前 N 张（默认 40）
   */
  function preloadCovers(tracks: Track[], maxCount = 40): void {
    // Skip if already preloaded for the same track list
    const trackIds = tracks.length > 0 ? `${tracks[0].id}_${tracks.length}` : 'empty'
    if (preloadedTrackIds === trackIds) return
    preloadedTrackIds = trackIds

    const urls: string[] = []
    for (const track of tracks.slice(0, maxCount)) {
      const url = musicStore.toCoverUrl(track.coverPath)
      if (url) urls.push(url)
    }
    if (urls.length > 0) {
      preloadCoverImages(urls, maxCount)
    }
  }

  function dispose(): void {
    // Don't actually dispose — just pause rendering.
    // The instance survives at module level for the next mount.
    if (currentTrackWatchStop) {
      currentTrackWatchStop()
      currentTrackWatchStop = null
    }
    visualizerInstance?.pauseRendering()
    visualizer.value = null
    contextHandler = null
  }

  /** Permanently destroy the instance (e.g. when clearing the library). */
  function destroy(): void {
    if (currentTrackWatchStop) {
      currentTrackWatchStop()
      currentTrackWatchStop = null
    }
    visualizerInstance?.dispose()
    visualizerInstance = null
    visualizer.value = null
    contextHandler = null
    preloadedTrackIds = null
  }

  function pauseRendering(): void {
    visualizerInstance?.pauseRendering()
  }

  function resumeRendering(): void {
    visualizerInstance?.resumeRendering()
  }

  return { visualizer, init, setTracks, setSpacing, onContext, dispose, destroy, pauseRendering, resumeRendering, preloadCovers }
}
