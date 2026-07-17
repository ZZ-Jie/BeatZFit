<template>
  <div class="netease-panel netease-panel--liquid">
    <FrostedGlass :corner-radius="24" variant="primary" />
    <!-- 未登录 -->
    <div v-if="!isLoggedIn" class="netease-login">
      <div class="netease-icon">&#9835;</div>
      <h4 class="text-h3">网易云音乐</h4>
      <p class="text-small">登录以同步你的歌单和收藏</p>
      <button class="btn-glass btn-glass--accent" @click="handleLogin" :disabled="loginLoading">
        <span v-if="loginLoading" class="loading-dot" v-gsap-pulse></span>
        {{ loginLoading ? '登录中...' : '登录网易云' }}
      </button>
      <p class="text-caption netease-disclaimer">实验性功能 · 基于非官方接口</p>
    </div>

    <!-- 已登录 -->
    <div v-else class="netease-logged-in">
      <div class="netease-user">
        <div class="netease-avatar" v-if="userInfo?.avatarUrl">
          <img :src="userInfo.avatarUrl.replace(/^http:\/\//, 'https://')" alt="avatar" referrerpolicy="no-referrer" @error="onAvatarError" />
        </div>
        <div class="netease-avatar-fallback" v-else>
          &#9835;
        </div>
        <div class="netease-user-info">
          <span class="user-nickname">{{ userInfo?.nickname || '网易云用户' }}</span>
          <span class="user-status text-caption">已连接</span>
        </div>
        <button class="btn-glass btn-logout" @click="handleLogout">退出</button>
      </div>

      <div class="netease-playlists" v-if="playlists.length > 0">
        <div class="playlists-header">
          <h4 class="text-h4">我的歌单 ({{ playlists.length }})</h4>
          <button class="btn-icon-refresh" @click="refreshPlaylists" title="刷新歌单" aria-label="刷新歌单">
            <svg width="13" height="13" viewBox="0 0 13 13"><path d="M11 4.5A4.5 4.5 0 1 0 11 8.5M11 1.5V4.5H8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="playlist-grid">
          <div class="playlist-card" v-for="pl in playlists" :key="pl.id"
            @click="loadPlaylistTracks(pl)">
            <div class="playlist-cover">
              <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl + '?param=200x200'" :alt="pl.name"
                referrerpolicy="no-referrer" loading="lazy" @error="onCoverError" />
              <div class="playlist-cover-fallback show-fallback" v-if="!pl.coverImgUrl">&#9835;</div>
            </div>
            <div class="playlist-info">
              <span class="playlist-name">{{ pl.name }}</span>
              <span class="playlist-count text-caption">{{ pl.trackCount }} 首</span>
            </div>
          </div>
        </div>
      </div>

      <div class="netease-playlists" v-if="playlistLoading">
        <div class="loading-state">
          <span class="loading-dot"></span> 加载歌单中...
        </div>
      </div>

      <div class="netease-playlists" v-if="!playlistLoading && playlists.length === 0 && playlistError">
        <div class="loading-state" style="color: #E53935;">
          {{ playlistError }}
        </div>
        <button class="btn-glass" style="margin-top: 12px;" @click="retryLoadPlaylists">重试</button>
      </div>
    </div>

    <!-- 歌单详情 -->
    <Transition :css="false" @enter="slideTransition.onEnter" @leave="slideTransition.onLeave">
      <div class="playlist-detail" v-if="detailPlaylist">
        <div class="detail-header">
          <button class="btn-back" @click="closeDetail">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M9 3L5 7L9 11" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
            返回
          </button>
          <h4 class="text-h4">{{ detailPlaylist.name }}</h4>
          <button class="btn-icon-refresh" @click="refreshDetail" title="刷新曲目" aria-label="刷新曲目">
            <svg width="13" height="13" viewBox="0 0 13 13"><path d="M11 4.5A4.5 4.5 0 1 0 11 8.5M11 1.5V4.5H8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>

        <div class="detail-track-list" v-if="detailTracks.length > 0" ref="detailScroller" @scroll="onDetailScroll">
          <div class="detail-track-row" v-for="(track, idx) in detailTracks" :key="track.id"
            @dblclick="playNeteaseTrack(track, idx)"
            @click="selectTrack(track)"
            :class="{ 'track-loading': playingTrackId === `ne_${track.id}`,
                      'track-failed': failedTrackIds.has(`ne_${track.id}`) }">
            <span class="dt-index">
              <span v-if="playingTrackId === `ne_${track.id}`" class="loading-dot" v-gsap-pulse></span>
              <span v-else-if="failedTrackIds.has(`ne_${track.id}`)" class="dt-failed-mark" title="暂不可播放">&#9888;</span>
              <span v-else>{{ idx + 1 }}</span>
            </span>
            <div class="dt-info">
              <span class="dt-name">{{ track.name }}</span>
              <span class="dt-artist">{{ track.ar?.map(a => a.name).join(', ') || 'Unknown Artist' }}</span>
            </div>
            <span class="dt-duration text-caption">{{ formatDuration(track.dt) }}</span>
          </div>
        </div>

        <div class="detail-empty" v-else-if="!detailLoading">
          <p class="text-small">歌单中没有曲目</p>
        </div>

        <div class="detail-loading" v-if="detailLoading">
          <span class="loading-dot" v-gsap-pulse></span> 加载中...
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useMusicStore } from '@/stores/music'
import { useNeteaseUIStore } from '@/stores/neteaseUI'
import { cachedFetch, cacheInvalidatePrefix, CacheNS, CacheTTL } from '@/modules/music/cache'
import FrostedGlass from '@/components/FrostedGlass.vue'
import type { Track } from '@/types'
import { useSlideTransition, vGsapPulse } from '@/composables/useGsapTransition'
import { useNeteaseStatus } from '@/composables/useNeteaseStatus'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useSfx } from '@/composables/useSfx'

const musicStore = useMusicStore()
const neteaseUI = useNeteaseUIStore()

const slideTransition = useSlideTransition()
const globalToast = useGlobalToast()
const sfx = useSfx()

const { isLoggedIn, userInfo, checkLoginStatus: checkSharedStatus, clearStatus } = useNeteaseStatus()
const loginLoading = ref(false)
const playlists = ref<import('@/types/netease.d').NeteasePlaylist[]>([])
const playlistLoading = ref(false)
const playlistError = ref('')
const playlistRefreshedAt = ref<number>(0)

const detailPlaylist = ref<import('@/types/netease.d').NeteasePlaylist | null>(null)
const detailTracks = ref<import('@/types/netease.d').NeteaseSong[]>([])
const detailLoading = ref(false)
const detailRefreshedAt = ref<number>(0)
const detailScroller = ref<HTMLElement | null>(null)
const playingTrackId = ref<string | null>(null)
const failedTrackIds = ref<Set<string>>(new Set())

// === Cache-aware data loaders ===
//
// We use cachedFetch so the second click on a playlist (or returning to
// the music library page) hits the in-memory cache instead of re-issuing
// the IPC roundtrip. The cache TTL is short (5–10 min) so a re-login or
// track add on the NetEase side will eventually surface.

async function fetchPlaylistsCached(uid: number, force = false) {
  return cachedFetch(
    CacheNS.NeteasePlaylists,
    String(uid),
    async () => {
      const result = await window.electronAPI!.netease.getUserPlaylists(uid)
      if (!result.success || !result.data) return []
      return result.data.playlists || []
    },
    { ttlMs: CacheTTL.PLAYLISTS, forceRefresh: force }
  )
}

async function fetchPlaylistDetailCached(id: number, force = false) {
  return cachedFetch(
    CacheNS.NeteasePlaylistDetail,
    String(id),
    async () => {
      const result = await window.electronAPI!.netease.getPlaylistDetail(id)
      if (!result.success || !result.data) return []
      return result.data.tracks || []
    },
    { ttlMs: CacheTTL.PLAYLIST_DETAIL, forceRefresh: force }
  )
}

async function fetchSongUrlCached(songId: number) {
  return cachedFetch(
    CacheNS.NeteaseSongUrl,
    String(songId),
    async () => {
      const result = await window.electronAPI!.netease.getSongUrl(songId)
      if (!result.success || !result.data) return null
      return result.data.url || null
    },
    { ttlMs: CacheTTL.SONG_URL }
  )
}

async function fetchLyricCached(songId: number) {
  return cachedFetch(
    CacheNS.NeteaseLyric,
    String(songId),
    async () => {
      const result = await window.electronAPI!.netease.getLyric(songId)
      if (!result.success || !result.data) return null
      return result.data.lyric || null
    },
    { ttlMs: CacheTTL.LYRICS }
  )
}

function showPlayError(msg: string) {
  globalToast.warning(msg)
}

function onDetailScroll(e: Event) {
  // Capture the scroll position so we can restore it after navigating
  // away and back. We don't write to localStorage on every tick — the
  // unmount handler does the actual persist.
  const el = e.target as HTMLElement
  neteaseUI.setDetailScrollTop(el.scrollTop)
}

onMounted(async () => {
  // Hydrate persisted UI state (expanded playlist, scroll position) from
  // localStorage. Done here, not at module top level, so the read only
  // happens in the browser context.
  neteaseUI.hydrate()
  await checkLoginStatus()
})

onBeforeUnmount(() => {
  // Final flush of scroll position so the persisted value is up to date
  // when the user re-opens the playlist. (setDetailScrollTop is called on
  // every scroll event, but unmount is the right moment to write the
  // final value to localStorage.)
  if (detailScroller.value) {
    neteaseUI.setDetailScrollTop(detailScroller.value.scrollTop)
  }
  neteaseUI.persistScrollTop?.()
})

async function checkLoginStatus(force = false) {
  if (!window.electronAPI?.netease) return
  try {
    await checkSharedStatus(force)
    // Always try to load playlists when logged in, even if userInfo is null
    if (isLoggedIn.value) {
      const uid = userInfo.value?.userId
      if (uid) {
        await loadPlaylists(uid)
      } else {
        // If we don't have a uid yet, retry after a short delay
        // (getUserInfo may have failed temporarily)
        playlistError.value = '获取用户信息失败，点击重试'
      }
    }
  } catch (e) {
    console.error('Check login status failed:', e)
  }
}

async function handleLogin() {
  sfx.confirm()
  if (!window.electronAPI?.netease) return
  loginLoading.value = true
  try {
    const result = await window.electronAPI.netease.openLogin()
    if (result.success) {
      // Fresh login means a new account, so any cached playlists /
      // tracks for the previous account are stale. Drop them.
      cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
      cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, '')
      neteaseUI.reset()
      await checkLoginStatus(true)
    }
  } catch (e) {
    console.error('Login failed:', e)
  } finally {
    loginLoading.value = false
  }
}

async function handleLogout() {
  sfx.retract()
  if (!window.electronAPI?.netease) return
  await window.electronAPI.netease.logout()
  clearStatus()
  playlists.value = []
  detailPlaylist.value = null
  detailTracks.value = []
  // Logout also drops all netease-derived cache entries and persisted UI.
  cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
  cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, '')
  cacheInvalidatePrefix(CacheNS.NeteaseSongUrl, '')
  cacheInvalidatePrefix(CacheNS.NeteaseLyric, '')
  neteaseUI.reset()
}

async function loadPlaylists(uid: number, opts: { force?: boolean } = {}) {
  if (!window.electronAPI?.netease) return
  playlistLoading.value = true
  playlistError.value = ''
  try {
    console.log('[NeteaseCard] Loading playlists for uid:', uid, 'force:', opts.force)
    // If a previous fetch already populated `playlists.value` and we're not
    // forcing a refresh, skip the spinner entirely and let the cachedFetch
    // re-use the existing entry.
    const hasFresh =
      !opts.force && playlists.value.length > 0 && Date.now() - playlistRefreshedAt.value < CacheTTL.PLAYLISTS
    if (hasFresh) {
      return
    }
    const list = await fetchPlaylistsCached(uid, !!opts.force)
    playlists.value = list
    playlistRefreshedAt.value = Date.now()
    if (list.length === 0) {
      playlistError.value = '没有找到歌单'
    } else {
      // After a successful load, check whether the user previously had a
      // playlist expanded. If so, and the playlist still exists in the
      // freshly-loaded list, restore it without an extra click.
      const previouslyExpanded = neteaseUI.maybeRestoreExpanded(list)
      if (previouslyExpanded && !detailPlaylist.value) {
        await loadPlaylistTracks(previouslyExpanded, { force: false })
      }
    }
  } catch (e) {
    console.error('Load playlists failed:', e)
    playlistError.value = '加载歌单失败，请重试'
  } finally {
    playlistLoading.value = false
  }
}

async function retryLoadPlaylists() {
  sfx.detent()
  // Re-check login status to get fresh userInfo
  await checkLoginStatus()
}

async function loadPlaylistTracks(playlist: import('@/types/netease.d').NeteasePlaylist, opts: { force?: boolean } = {}) {
  sfx.detent()
  if (!window.electronAPI?.netease) return
  const isSamePlaylist = detailPlaylist.value?.id === playlist.id
  // If the user clicked the same playlist that's already open and we
  // already have tracks loaded, don't refetch — just keep the panel open.
  if (isSamePlaylist && detailTracks.value.length > 0 && !opts.force) {
    return
  }
  const isRestoring = neteaseUI.lastExpandedPlaylistId === playlist.id
  const savedScrollTop = isRestoring ? neteaseUI.detailScrollTop : 0
  detailPlaylist.value = playlist
  neteaseUI.setExpandedPlaylist(playlist.id)
  detailTracks.value = []
  detailLoading.value = true
  // Reset per-playlist transient state so previous failures don't bleed over
  failedTrackIds.value = new Set()

  try {
    console.log('[NeteaseCard] Loading tracks for playlist:', playlist.id, 'force:', opts.force)
    const tracks = await fetchPlaylistDetailCached(playlist.id, !!opts.force)
    detailTracks.value = tracks
    detailRefreshedAt.value = Date.now()
    console.log('[NeteaseCard] Loaded', tracks.length, 'tracks')
    // Re-apply the persisted scroll position after Vue has rendered the
    // track list. We use nextTick so the ref is non-null and the
    // scrollHeight is meaningful. Skip when the user clicked into a
    // different playlist (we want to start at the top in that case).
    if (isRestoring && savedScrollTop > 0) {
      nextTick(() => {
        if (detailScroller.value) {
          detailScroller.value.scrollTop = savedScrollTop
        }
      })
    }
  } catch (e) {
    console.error('Load playlist detail failed:', e)
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  sfx.retract()
  detailPlaylist.value = null
  detailTracks.value = []
  neteaseUI.setExpandedPlaylist(null)
}

function refreshPlaylists() {
  sfx.detent()
  const uid = userInfo.value?.userId
  if (!uid) return
  loadPlaylists(uid, { force: true })
}

function refreshDetail() {
  sfx.detent()
  if (!detailPlaylist.value) return
  loadPlaylistTracks(detailPlaylist.value, { force: true })
}

function selectTrack(_track: import('@/types/netease.d').NeteaseSong) {
  // single click selects (visual feedback), double click plays
}

async function playNeteaseTrack(track: import('@/types/netease.d').NeteaseSong, index: number) {
  sfx.confirm()
  if (!window.electronAPI?.netease) return
  // Set the entire visible playlist as the play queue so the user's
  // "next/prev" buttons naturally advance through the playlist instead
  // of being stuck on a single appended track. We map every row to a
  // Track first (so it lines up with how musicStore expects ids), then
  // call setQueue + playIndex. setQueue is O(1) — it replaces the array
  // reference — and playIndex handles the audio swap + currentIndex bump.
  if (detailTracks.value.length > 0) {
    const queue: Track[] = detailTracks.value.map(toNeteaseTrack)
    musicStore.setQueue(queue, index)
    musicStore.playIndex(index)
    return
  }

  // Fallback (shouldn't normally hit this — the detail panel only shows
  // when there are tracks): play the single track.
  const single = toNeteaseTrack(track)
  musicStore.playTrack(single)
}

function toNeteaseTrack(t: import('@/types/netease.d').NeteaseSong): Track {
  return {
    id: `ne_${t.id}`,
    title: t.name,
    artist: t.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
    album: t.al?.name || 'Unknown Album',
    duration: (t.dt || 0) / 1000,
    coverPath: t.al?.picUrl,
    source: 'netease',
    sourceId: String(t.id),
    localPath: '', // filled in by the playback path on play, not at queue time
    addedAt: new Date().toISOString()
  }
}

function reasonToMessage(reason: string, trackName: string): string {
  // NetEase's song_url_v1 returns no url when the track is restricted.
  // The service logs the upstream code/fee/st for diagnosis, but on the
  // UI side we can only offer a best-effort hint to the user.
  if (/vip|fee/i.test(reason)) {
    return `「${trackName}」需要网易云 VIP 会员才能播放`
  }
  if (/copyright|st/i.test(reason)) {
    return `「${trackName}」因版权限制无法播放`
  }
  return `「${trackName}」暂无可播放音源`
}

function formatDuration(ms: number): string {
  if (!ms) return '--:--'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function onCoverError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
  const fallback = img.nextElementSibling as HTMLElement | null
  if (fallback) fallback.classList.add('show-fallback')
}

function onAvatarError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}
</script>

<style lang="scss" scoped>
.netease-panel {
  padding: var(--space-lg);
  margin-top: var(--space-lg);
}

.netease-panel--liquid {
  position: relative;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;

  & > *:not(.frosted-glass) {
    position: relative;
    z-index: 1;
  }
}

.netease-login {
  text-align: center;
  padding: var(--space-xl) 0;
}

.netease-icon {
  font-size: 3rem;
  color: #E53935;
  margin-bottom: var(--space-md);
  filter: drop-shadow(0 0 20px rgba(229, 57, 53, 0.3));
}

.netease-login h4 { margin-bottom: var(--space-sm); }
.netease-login p { margin-bottom: var(--space-lg); }

.netease-disclaimer {
  margin-top: var(--space-md);
  color: var(--text-tertiary);
}

.netease-logged-in { }

.netease-user {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding-bottom: var(--space-lg);
  border-bottom: 1px solid var(--glass-border);
}

.netease-avatar {
  width: 44px; height: 44px;
  border-radius: var(--radius-full);
  overflow: hidden;
  background: var(--glass-bg);

  img { width: 100%; height: 100%; object-fit: cover; }
}

.netease-avatar-fallback {
  width: 44px; height: 44px;
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  display: flex; align-items: center; justify-content: center;
  font-size: 1.2rem;
  color: #E53935;
}

.netease-user-info {
  flex: 1;
  display: flex; flex-direction: column;
}

.user-nickname {
  font-weight: 500;
  color: var(--text-primary);
}

.user-status {
  color: var(--accent-cyan);
}

.btn-logout {
  font-size: var(--text-caption);
  padding: 4px 12px;
}

.btn-glass {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-lg);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-small);
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--glass-bg-hover);
    color: var(--text-primary);
  }

  &:disabled { opacity: 0.4; cursor: default; }

  &--accent {
    background: rgba(250, 88, 106, 0.12);
    border-color: rgba(250, 88, 106, 0.2);
    color: var(--accent-mist);
    &:hover:not(:disabled) { background: rgba(250, 88, 106, 0.2); }
  }
}

.loading-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
}

// pulse-dot 动画已迁移至 GSAP (v-gsap-pulse 指令)

.loading-state {
  text-align: center;
  padding: var(--space-lg);
  color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
  gap: var(--space-sm);
}

// Playlists
.netease-playlists {
  margin-top: var(--space-lg);
}

.playlists-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.btn-icon-refresh {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms var(--ease-standard);

  &:hover:not(:disabled) {
    color: var(--accent-cyan);
    border-color: var(--glass-border-hover);
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-md);
  margin-top: var(--space-md);
}

.playlist-card {
  cursor: pointer;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  transition: all 150ms var(--ease-standard);

  &:hover {
    background: var(--glass-bg-hover);
    transform: translateY(-2px);
  }
}

.playlist-cover {
  aspect-ratio: 1;
  background: var(--bg-elevated);
  overflow: hidden;
  position: relative;

  img { width: 100%; height: 100%; object-fit: cover; }
}

.playlist-cover-fallback {
  width: 100%; height: 100%;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  color: #E53935;
  opacity: 0.4;

  &.show-fallback { display: flex; }
}

.playlist-info {
  padding: var(--space-sm) var(--space-md);
  display: flex; flex-direction: column;
}

.playlist-name {
  font-size: var(--text-small);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

// Detail
.playlist-detail {
  margin-top: var(--space-lg);
  border-top: 1px solid var(--glass-border);
  padding-top: var(--space-lg);
}

.detail-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-md);

  h4 {
    margin: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-icon-refresh { flex-shrink: 0; }
}

.btn-back {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--text-small);
  padding: 4px 8px;
  border-radius: var(--radius-sm);

  &:hover { color: var(--text-primary); }
}

.detail-track-list {
  display: flex;
  flex-direction: column;
  // Cap the height so a 1000-track playlist can be scrolled inside the
  // card instead of pushing the page footer off-screen. The scroll
  // position is captured by `onDetailScroll` and persisted across
  // navigation.
  max-height: 480px;
  overflow-y: auto;
  overscroll-behavior: contain;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb {
    background: var(--glass-border);
    border-radius: 3px;
  }
}

.detail-track-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 100ms var(--ease-standard);

  &:hover { background: var(--glass-bg); }
}

.dt-index {
  width: 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.dt-info {
  flex: 1;
  overflow: hidden;
}

.dt-name {
  display: block;
  font-size: var(--text-small);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dt-artist {
  display: block;
  font-size: var(--text-caption);
  color: var(--text-tertiary);
}

.dt-duration {
  font-variant-numeric: tabular-nums;
}

.detail-empty, .detail-loading {
  text-align: center;
  padding: var(--space-xl);
  color: var(--text-secondary);
}

// slide / toast 过渡已迁移至 GSAP JS hooks

// Failed track visual indicator
.detail-track-row.track-failed {
  opacity: 0.55;
  .dt-name { text-decoration: line-through; text-decoration-color: rgba(229, 57, 53, 0.5); }
  .dt-failed-mark { color: #E53935; font-size: 0.9rem; }
}

// toast 过渡已迁移至 GSAP JS hooks
</style>
