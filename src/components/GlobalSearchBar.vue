<template>
  <div class="gsb-wrap" ref="wrapRef">
    <!-- Search input — entire row is clickable to focus the input -->
    <div class="gsb-input-row" @click="focusInput">
      <svg class="gsb-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <input
        ref="inputRef"
        v-model="query"
        class="gsb-input"
        :placeholder="placeholder"
        @focus="onFocus"
        @keydown.esc="close"
        @keydown.enter="onEnter"
      />
      <button
        v-if="query"
        class="gsb-clear"
        @click.stop="clear"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- Results dropdown -->
    <Transition name="gsb-dropdown">
      <div v-if="showDropdown" class="gsb-dropdown">
        <!-- Loading (netease fallback) -->
        <div v-if="neteaseLoading" class="gsb-loading">
          <div class="gsb-spinner"></div>
          <span>本地无结果，正在搜索网易云…</span>
        </div>

        <!-- No results -->
        <div v-else-if="allEmpty" class="gsb-empty">
          <span>无搜索结果</span>
        </div>

        <!-- Result groups -->
        <template v-else>
          <!-- 歌曲 -->
          <div v-if="songResults.length" class="gsb-group">
            <div class="gsb-group-header">
              <span>歌曲</span>
              <span class="gsb-group-count">{{ songResults.length }}</span>
            </div>
            <div
              v-for="item in songResults"
              :key="item.id"
              class="gsb-item"
              @click="onSongClick(item)"
            >
              <div class="gsb-item-cover" v-if="item.coverUrl">
                <img :src="item.coverUrl" :alt="item.title" loading="lazy" @error="onCoverErr" />
              </div>
              <div class="gsb-item-cover gsb-item-cover--placeholder" v-else>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1" opacity="0.4"/>
                  <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1" opacity="0.4"/>
                </svg>
              </div>
              <div class="gsb-item-info">
                <div class="gsb-item-title">{{ item.title }}</div>
                <div class="gsb-item-sub">{{ item.artist }} · {{ item.album }}</div>
              </div>
              <!-- Like + Add-to-playlist buttons for netease songs -->
              <template v-if="item.source === 'netease' && neteaseLoggedIn">
                <button
                  class="gsb-action-btn"
                  :class="{ 'is-liked': item.isLiked }"
                  @click.stop="onLikeSong(item)"
                  :title="item.isLiked ? '取消喜欢' : '喜欢'"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 14s-5-3.5-5-7.5C3 4 5 3 6.5 3S8 4 8 4s.5-1 1.5-1S13 4 13 6.5C13 10.5 8 14 8 14z"
                      :fill="item.isLiked ? 'currentColor' : 'none'"
                      stroke="currentColor"
                      stroke-width="1.2"
                    />
                  </svg>
                </button>
                <button
                  class="gsb-action-btn"
                  @click.stop="onAddToPlaylist(item)"
                  title="添加到歌单"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                </button>
              </template>
              <div class="gsb-item-tag" :class="`gsb-item-tag--${item.source}`">{{ item.sourceLabel }}</div>
            </div>
          </div>

          <!-- 歌单 -->
          <div v-if="playlistResults.length" class="gsb-group">
            <div class="gsb-group-header">
              <span>歌单</span>
              <span class="gsb-group-count">{{ playlistResults.length }}</span>
            </div>
            <div
              v-for="item in playlistResults"
              :key="item.id"
              class="gsb-item"
              @click="onPlaylistClick(item)"
            >
              <div class="gsb-item-cover" v-if="item.coverUrl">
                <img :src="item.coverUrl" :alt="item.title" loading="lazy" @error="onCoverErr" />
              </div>
              <div class="gsb-item-cover gsb-item-cover--placeholder" v-else>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1" opacity="0.4"/>
                </svg>
              </div>
              <div class="gsb-item-info">
                <div class="gsb-item-title">{{ item.title }}</div>
                <div class="gsb-item-sub">{{ item.sub }}</div>
              </div>
              <!-- Subscribe button for third-party netease playlists -->
              <button
                v-if="item.source === 'netease' && item.playlistData && !item.isSubscribed && neteaseLoggedIn"
                class="gsb-action-btn gsb-subscribe-btn"
                @click.stop="onSubscribePlaylist(item)"
                :disabled="item._subscribing"
                title="收藏歌单"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5L10.06 5.68L14.66 6.35L11.33 9.59L12.12 14.17L8 12.02L3.88 14.17L4.67 9.59L1.34 6.35L5.94 5.68L8 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
              <span v-if="item.source === 'netease' && item.isSubscribed" class="gsb-subscribed-mark" title="已收藏">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5L10.06 5.68L14.66 6.35L11.33 9.59L12.12 14.17L8 12.02L3.88 14.17L4.67 9.59L1.34 6.35L5.94 5.68L8 1.5Z"/>
                </svg>
              </span>
              <div class="gsb-item-tag" :class="`gsb-item-tag--${item.source}`">{{ item.sourceLabel }}</div>
            </div>
          </div>

          <!-- 训练动作 -->
          <div v-if="exerciseResults.length" class="gsb-group">
            <div class="gsb-group-header">
              <span>训练动作</span>
              <span class="gsb-group-count">{{ exerciseResults.length }}</span>
            </div>
            <div
              v-for="item in exerciseResults"
              :key="item.id"
              class="gsb-item"
              @click="onExerciseClick(item)"
            >
              <div class="gsb-item-cover" v-if="item.coverUrl">
                <img :src="item.coverUrl" :alt="item.name" loading="lazy" @error="onCoverErr" />
              </div>
              <div class="gsb-item-cover gsb-item-cover--placeholder" v-else>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 5H13M3 8H13M3 11H8" stroke="currentColor" stroke-width="1" opacity="0.4" stroke-linecap="round"/>
                </svg>
              </div>
              <div class="gsb-item-info">
                <div class="gsb-item-title">{{ item.name }}</div>
                <div class="gsb-item-sub">{{ item.sub }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </Transition>

    <!-- Add-to-playlist popover -->
    <Transition name="gsb-popover">
      <div v-if="showPlaylistPicker" class="gsb-playlist-picker" @click.stop>
        <div class="gsb-pp-header">
          <span>添加到歌单</span>
          <button class="gsb-pp-close" @click="showPlaylistPicker = false">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="gsb-pp-list">
          <div
            class="gsb-pp-item gsb-pp-like"
            @click="onLikeFromPicker"
          >
            <div class="gsb-pp-icon">♥</div>
            <div class="gsb-pp-name">我喜欢的音乐</div>
          </div>
          <div
            v-for="pl in userPlaylists"
            :key="pl.id"
            class="gsb-pp-item"
            @click="onAddToPlaylistFromPicker(pl.id)"
          >
            <div class="gsb-pp-cover" v-if="pl.coverImgUrl">
              <img :src="neteaseCoverUrl(pl.coverImgUrl)" :alt="pl.name" loading="lazy" @error="onCoverErr" />
            </div>
            <div class="gsb-pp-cover gsb-pp-cover--placeholder" v-else>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1" opacity="0.4"/>
              </svg>
            </div>
            <div class="gsb-pp-name">{{ pl.name }}</div>
            <div class="gsb-pp-count">{{ pl.trackCount }}首</div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast for add-to-playlist feedback -->
    <Transition name="gsb-toast">
      <div v-if="toastMessage" class="gsb-mini-toast">{{ toastMessage }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * GlobalSearchBar — 首页全功能搜索框
 *
 * 检索策略: 本地优先 → 网易云自动兜底
 * 1. 输入关键词后即时搜索本地数据 (零网络请求):
 *    - 本地音乐库 (localTracks prop + 自行加载的库)
 *    - 本地歌单 (playlistStore.playlists)
 *    - 网易云歌单 (neteasePlaylists, 已缓存 + 搜索)
 *    - 训练动作 (fitnessStore.exercises)
 * 2. 本地无匹配结果时, 自动发起网易云搜索作为补充
 * 3. 点击歌曲 → 就地播放; 歌单 → 跳转; 动作 → 展开详情
 * 4. 网易云歌曲支持"喜欢"和"添加到歌单"
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useMusicStore } from '@/stores/music'
import { usePlaylistStore } from '@/stores/playlist'
import { useFitnessStore } from '@/stores/fitness'
import { useSfx } from '@/composables/useSfx'
import { useNeteaseStatus } from '@/composables/useNeteaseStatus'
import { useNeteaseLikes } from '@/composables/useNeteaseLikes'
import { cacheInvalidatePrefix, CacheNS } from '@/modules/music/cache'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'
import type { Track } from '@/types'
import type { Exercise } from '@/types'
import type { NeteasePlaylist } from '@/types/netease.d'

const emit = defineEmits<{
  songPlay: [track: Track]
  playlistOpen: [playlistId: string, source: 'local' | 'netease', playlistData?: {
    id: number
    name: string
    coverImgUrl?: string
    trackCount: number
    creator?: { nickname: string }
  }]
  exerciseOpen: [exercise: Exercise]
}>()

const musicStore = useMusicStore()
const playlistStore = usePlaylistStore()
const fitnessStore = useFitnessStore()
const sfx = useSfx()
const { isLoggedIn: neteaseLoggedIn, userInfo: neteaseUserInfo, checkLoginStatus } = useNeteaseStatus()

// ── Props for data sources ──
const props = defineProps<{
  localTracks: Track[]
  neteasePlaylists: NeteasePlaylist[]
}>()

const placeholder = '搜索歌曲、歌单、训练动作…'

// ── State ──
const query = ref('')
const debouncedQuery = ref('')
const isFocused = ref(false)
const neteaseLoading = ref(false)
const neteaseResults = ref<any[]>([])
const neteasePlaylistResults = ref<any[]>([]) // netease playlist search results

// Self-loaded local library — ensures search works even if the parent
// hasn't finished loading localTracks yet (fixes "local music not found" bug).
const selfLoadedTracks = ref<Track[]>([])
const localLibraryLoaded = ref(false)

// Liked song IDs — shared across the entire app via useNeteaseLikes composable
const { likedSongIds, loadLikedList, toggleLike } = useNeteaseLikes()

// User playlists for "add to playlist" picker
const userPlaylists = ref<any[]>([])
const showPlaylistPicker = ref(false)
const pickerTargetSong = ref<SongResult | null>(null)
const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const inputRef = ref<HTMLInputElement | null>(null)
const wrapRef = ref<HTMLElement | null>(null)

// Track whether we've already done a netease search for the current query
let neteaseSearchedFor = ''
let neteasePlaylistSearchedFor = ''

// Debounce
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(query, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!val.trim()) {
    debouncedQuery.value = ''
    neteaseResults.value = []
    neteasePlaylistResults.value = []
    neteaseSearchedFor = ''
    neteasePlaylistSearchedFor = ''
    return
  }
  debounceTimer = setTimeout(() => {
    debouncedQuery.value = val.trim().toLowerCase()
  }, 200)
})

const showDropdown = computed(() => isFocused.value && debouncedQuery.value.length > 0)

// ── Merged local tracks (prop + self-loaded) ──
// Merge both sources, deduplicating by track ID. This ensures search
// works even if only one source has loaded.
const allLocalTracks = computed<Track[]>(() => {
  const merged = new Map<string, Track>()
  for (const t of props.localTracks) merged.set(t.id, t)
  for (const t of selfLoadedTracks.value) {
    if (!merged.has(t.id)) merged.set(t.id, t)
  }
  return Array.from(merged.values())
})

// ── Result types ──
interface SongResult {
  id: string
  title: string
  artist: string
  album: string
  coverUrl?: string
  source: 'local' | 'netease'
  sourceLabel: string
  track: Track
  neteaseSongId?: number
  isLiked?: boolean
}

interface PlaylistResult {
  id: string
  title: string
  sub: string
  coverUrl?: string
  source: 'local' | 'netease'
  sourceLabel: string
  playlistId: string
  // Full netease playlist data for third-party playlists (not in user's library)
  playlistData?: {
    id: number
    name: string
    coverImgUrl?: string
    trackCount: number
    creator?: { nickname: string }
  }
  // Whether this playlist is already in the user's netease library
  isSubscribed?: boolean
  // Internal flag for subscribe button loading state
  _subscribing?: boolean
}

interface ExerciseResult {
  id: string
  name: string
  sub: string
  coverUrl?: string
  exercise: Exercise
}

// ── Local search (zero network) ──
const localSongResults = computed<SongResult[]>(() => {
  const q = debouncedQuery.value
  if (!q) return []
  const results: SongResult[] = []
  for (const t of allLocalTracks.value) {
    const titleMatch = t.title?.toLowerCase().includes(q)
    const artistMatch = t.artist?.toLowerCase().includes(q)
    const albumMatch = t.album?.toLowerCase().includes(q)
    if (titleMatch || artistMatch || albumMatch) {
      results.push({
        id: t.id,
        title: t.title,
        artist: t.artist || '未知艺术家',
        album: t.album || '未知专辑',
        coverUrl: musicStore.toCoverUrl(t.coverPath),
        source: 'local',
        sourceLabel: '本地',
        track: t,
      })
    }
    if (results.length >= 15) break
  }
  return results
})

const songResults = computed<SongResult[]>(() => {
  const results = [...localSongResults.value]
  // Append netease results if available
  if (neteaseResults.value.length > 0) {
    for (const s of neteaseResults.value) {
      const coverUrl = extractNeteaseCoverUrl(s)
      const songId = s.id
      results.push({
        id: `ne_search_${songId}`,
        title: s.name || '未知',
        artist: extractNeteaseArtists(s),
        album: extractNeteaseAlbum(s),
        coverUrl,
        source: 'netease',
        sourceLabel: '网易云',
        track: neteaseSearchSongToTrack(s),
        neteaseSongId: songId,
        isLiked: likedSongIds.value.has(songId),
      })
      if (results.length >= 30) break
    }
  }
  return results
})

const playlistResults = computed<PlaylistResult[]>(() => {
  const q = debouncedQuery.value
  if (!q) return []
  const results: PlaylistResult[] = []

  // Local playlists
  for (const pl of playlistStore.playlists) {
    if (pl.name?.toLowerCase().includes(q) || pl.description?.toLowerCase().includes(q)) {
      results.push({
        id: `pl_${pl.id}`,
        title: pl.name,
        sub: `${pl.trackCount} 首`,
        coverUrl: pl.coverPath ? musicStore.toCoverUrl(pl.coverPath) : undefined,
        source: 'local',
        sourceLabel: '本地歌单',
        playlistId: String(pl.id),
      })
    }
  }

  // Netease playlists (already cached from user's library)
  for (const pl of props.neteasePlaylists) {
    if (pl.name?.toLowerCase().includes(q)) {
      results.push({
        id: `ne_pl_${pl.id}`,
        title: pl.name,
        sub: `${pl.trackCount} 首`,
        coverUrl: pl.coverImgUrl ? `beat://${encodeURIComponent(pl.coverImgUrl + '?param=120x120')}` : undefined,
        source: 'netease',
        sourceLabel: '网易云',
        playlistId: String(pl.id),
        isSubscribed: true,
      })
    }
  }

  // Netease search results for playlists
  for (const pl of neteasePlaylistResults.value) {
    // Skip if this playlist is already in the user's cached playlists
    const alreadyExists = props.neteasePlaylists.some(p => p.id === pl.id)
    if (alreadyExists) continue
    results.push({
      id: `ne_search_pl_${pl.id}`,
      title: pl.name || '未知歌单',
      sub: `${pl.trackCount || 0} 首 · ${pl.creator?.nickname || ''}`,
      coverUrl: pl.coverImgUrl ? `beat://${encodeURIComponent(pl.coverImgUrl + '?param=120x120')}` : undefined,
      source: 'netease',
      sourceLabel: '网易云',
      playlistId: String(pl.id),
      playlistData: {
        id: pl.id,
        name: pl.name || '未知歌单',
        coverImgUrl: pl.coverImgUrl,
        trackCount: pl.trackCount || 0,
        creator: pl.creator ? { nickname: pl.creator.nickname || '' } : undefined,
      },
      isSubscribed: false,
    })
  }

  return results.slice(0, 15)
})

const exerciseResults = computed<ExerciseResult[]>(() => {
  const q = debouncedQuery.value
  if (!q) return []
  const results: ExerciseResult[] = []
  for (const ex of fitnessStore.exercises) {
    const nameMatch = ex.name?.toLowerCase().includes(q)
    const zhMatch = ex.chineseName?.toLowerCase().includes(q)
    const bodyMatch = ex.bodyPart?.toLowerCase().includes(q)
    const bodyZhMatch = ex.bodyPartZh?.toLowerCase().includes(q)
    if (nameMatch || zhMatch || bodyMatch || bodyZhMatch) {
      results.push({
        id: ex.id,
        name: ex.chineseName || ex.name,
        sub: [ex.bodyPartZh || ex.bodyPart, ex.equipmentZh || ex.equipment].filter(Boolean).join(' · '),
        coverUrl: toExerciseMediaUrl(ex.gifUrl),
        exercise: ex,
      })
    }
    if (results.length >= 10) break
  }
  return results
})

const allEmpty = computed(() =>
  songResults.value.length === 0 &&
  playlistResults.value.length === 0 &&
  exerciseResults.value.length === 0 &&
  !neteaseLoading.value
)

// ── Auto netease search ──
// Always search netease for BOTH songs and playlists in parallel.
// This ensures searching for an artist name returns both their songs
// and playlists that match.
watch([localSongResults, playlistResults, exerciseResults], () => {
  const q = debouncedQuery.value
  if (!q || !isFocused.value) return

  // Always search netease songs (not just when local songs are empty)
  if (neteaseSearchedFor !== q) {
    doNeteaseSearch(q)
  }

  // Always search netease playlists independently (parallel, no blocking)
  if (neteasePlaylistSearchedFor !== q) {
    doNeteasePlaylistSearch(q)
  }
})

// ── Netease search (songs) ──
async function doNeteaseSearch(q: string) {
  if (!q || !window.electronAPI?.netease) return
  neteaseSearchedFor = q
  neteaseLoading.value = true
  try {
    const result = await window.electronAPI.netease.search(q, 20)
    if (result.success && result.data) {
      neteaseResults.value = result.data.songs || []
    } else {
      neteaseResults.value = []
    }
  } catch (e) {
    console.error('[GlobalSearch] Netease search failed:', e)
    neteaseResults.value = []
  } finally {
    neteaseLoading.value = false
  }
}

// ── Netease search (playlists) ──
async function doNeteasePlaylistSearch(q: string) {
  if (!q || !window.electronAPI?.netease?.searchPlaylists) return
  neteasePlaylistSearchedFor = q
  try {
    const result = await window.electronAPI.netease.searchPlaylists(q, 10)
    if (result.success && result.data) {
      neteasePlaylistResults.value = result.data.playlists || []
    } else {
      neteasePlaylistResults.value = []
    }
  } catch (e) {
    console.error('[GlobalSearch] Netease playlist search failed:', e)
    neteasePlaylistResults.value = []
  }
}

// ── Netease field extraction helpers ──
function extractNeteaseArtists(s: any): string {
  const artists = s.artists || s.ar || []
  return artists.map((a: any) => a.name).join(', ') || '未知艺术家'
}

function extractNeteaseAlbum(s: any): string {
  const album = s.album || s.al
  return album?.name || '未知专辑'
}

function extractNeteaseCoverUrl(s: any): string | undefined {
  const album = s.album || s.al
  const picUrl = album?.picUrl || album?.picUrl_str || s.picUrl || s.al?.picUrl
  if (!picUrl) return undefined
  return `beat://${encodeURIComponent(picUrl + '?param=120x120')}`
}

function neteaseCoverUrl(url: string): string {
  return `beat://${encodeURIComponent(url + '?param=120x120')}`
}

// ── Convert search result to Track ──
function neteaseSearchSongToTrack(s: any): Track {
  const album = s.album || s.al
  const picUrl = album?.picUrl || album?.picUrl_str || s.picUrl
  return {
    id: `ne_${s.id}`,
    title: s.name || '未知',
    artist: extractNeteaseArtists(s),
    album: extractNeteaseAlbum(s),
    duration: (s.duration || s.dt || 0) / 1000,
    coverPath: picUrl,
    source: 'netease',
    sourceId: String(s.id),
    localPath: '',
    addedAt: new Date().toISOString(),
  }
}

// ── Click handlers ──
function onSongClick(item: SongResult) {
  sfx.confirm()
  emit('songPlay', item.track)
  close()
}

function onPlaylistClick(item: PlaylistResult) {
  sfx.confirm()
  emit('playlistOpen', item.playlistId, item.source, item.playlistData)
  close()
}

function onExerciseClick(item: ExerciseResult) {
  sfx.airBloom()
  emit('exerciseOpen', item.exercise)
  close()
}

function onEnter() {
  if (songResults.value.length > 0) {
    onSongClick(songResults.value[0])
  } else if (playlistResults.value.length > 0) {
    onPlaylistClick(playlistResults.value[0])
  } else if (exerciseResults.value.length > 0) {
    onExerciseClick(exerciseResults.value[0])
  }
}

// ── Like song ──
async function onLikeSong(item: SongResult) {
if (!item.neteaseSongId) return
sfx.confirm()
const newLikeState = !item.isLiked
// Use shared composable — handles cache invalidation + global event
// The songResults computed will auto-update isLiked from likedSongIds
const ok = await toggleLike(item.neteaseSongId, newLikeState)
if (ok) {
showToast(newLikeState ? '已添加到喜欢的音乐' : '已取消喜欢')
} else {
showToast('操作失败，请重试')
}
}

// ── Add to playlist ──
async function onAddToPlaylist(item: SongResult) {
  if (!item.neteaseSongId) return
  pickerTargetSong.value = item
  showPlaylistPicker.value = true

  // Load user playlists if not already loaded
  if (userPlaylists.value.length === 0 && neteaseUserInfo.value?.userId) {
    try {
      const result = await window.electronAPI!.netease.getUserPlaylists(neteaseUserInfo.value.userId)
      if (result.success && result.data) {
        userPlaylists.value = (result.data.playlists || []).filter((pl: any) =>
          pl.creator?.userId === neteaseUserInfo.value?.userId
        )
      }
    } catch (e) {
      console.error('[GlobalSearch] Failed to load user playlists:', e)
    }
  }
}

async function onLikeFromPicker() {
if (!pickerTargetSong.value?.neteaseSongId) return
showPlaylistPicker.value = false
const item = pickerTargetSong.value
if (item.isLiked) {
showToast('该歌曲已在喜欢列表中')
return
}
// Use shared composable — computed will auto-update isLiked
const ok = await toggleLike(item.neteaseSongId!, true)
if (ok) {
showToast('已添加到喜欢的音乐')
} else {
showToast('操作失败')
}
}

async function onAddToPlaylistFromPicker(playlistId: number) {
  if (!pickerTargetSong.value?.neteaseSongId) return
  showPlaylistPicker.value = false
  const songId = pickerTargetSong.value.neteaseSongId
  try {
    const result = await window.electronAPI!.netease.addToPlaylist(songId, playlistId)
    if (result.success) {
      showToast('已添加到歌单')
      sfx.confirm()
      // Invalidate cache so other pages refresh
      cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, String(playlistId))
      cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
      window.dispatchEvent(new CustomEvent('beatzfit:neteaseDataChanged'))
    } else {
      showToast(result.message || '添加失败')
    }
  } catch (e) {
    showToast('网络错误')
  }
}

// ── Subscribe to a third-party netease playlist ──
async function onSubscribePlaylist(item: PlaylistResult) {
  if (!item.playlistData || !neteaseLoggedIn.value) return
  if (!window.electronAPI?.netease?.subscribePlaylist) {
    showToast('当前版本不支持收藏歌单')
    return
  }
  // Mark as subscribing (disable button)
  item._subscribing = true
  sfx.confirm()
  try {
    const result = await window.electronAPI.netease.subscribePlaylist(item.playlistData.id, true)
    if (result.success) {
      item.isSubscribed = true
      showToast('已收藏歌单')
      // Invalidate playlists cache so other pages refresh
      cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
      // Notify other components to refresh
      window.dispatchEvent(new CustomEvent('beatzfit:neteaseDataChanged'))
    } else {
      showToast('收藏失败，请重试')
    }
  } catch (e) {
    console.error('[GlobalSearch] Subscribe playlist failed:', e)
    showToast('网络错误')
  } finally {
    item._subscribing = false
  }
}

function showToast(msg: string) {
  toastMessage.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 2500)
}

// ── Focus / blur ──
function focusInput() {
  inputRef.value?.focus()
}

function onFocus() {
  isFocused.value = true
}

function close() {
  isFocused.value = false
  showPlaylistPicker.value = false
  inputRef.value?.blur()
}

function clear() {
  query.value = ''
  debouncedQuery.value = ''
  neteaseResults.value = []
  neteasePlaylistResults.value = []
  neteaseSearchedFor = ''
  neteasePlaylistSearchedFor = ''
  nextTick(() => inputRef.value?.focus())
}

function onCoverErr(e: Event) {
  const img = e.target as HTMLImageElement
  img.removeAttribute('src')
}

// Click outside to close
function onDocClick(e: MouseEvent) {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node)) {
    isFocused.value = false
    showPlaylistPicker.value = false
  }
}

// ── Self-load local library ──
// This ensures the search bar has local track data even if the parent
// (DualDeckHome) hasn't finished its async library load yet.
async function loadLocalLibrary() {
  if (localLibraryLoaded.value) return
  if (!window.electronAPI?.music?.getLibrary) return
  try {
    const result = await window.electronAPI.music.getLibrary()
    if (result.success && result.data?.tracks) {
      selfLoadedTracks.value = result.data.tracks.map((t: any) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        coverPath: t.cover_path,
        source: t.source,
        sourceId: t.source_id,
        localPath: t.local_path,
        lyricsPath: t.lyrics_path,
        addedAt: t.added_at,
        lastPlayedAt: t.last_played_at,
      })) as Track[]
      localLibraryLoaded.value = true
    }
  } catch (e) {
    console.error('[GlobalSearch] Failed to self-load library:', e)
  }
}

// ── Load liked songs list (delegates to shared composable) ──
// The composable caches the result and deduplicates concurrent calls.
// We just call it here to trigger loading on mount.
async function loadLikedListLocal() {
await loadLikedList()
}

onMounted(async () => {
  document.addEventListener('mousedown', onDocClick)
  // Self-load library immediately — don't wait for the parent
  await loadLocalLibrary()
  // Check netease status and load liked list
  await checkLoginStatus()
  await loadLikedListLocal()
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<style lang="scss" scoped>
.gsb-wrap {
  position: relative;
  width: 100%;
  max-width: 480px;
}

/* Entire input row is clickable — focuses the input */
.gsb-input-row {
display: flex;
align-items: center;
gap: 10px;
padding: 0 16px;
height: 42px;
border-radius: 21px;
background: rgba(255, 255, 255, 0.06);
border: 1px solid rgba(255, 255, 255, 0.1);
cursor: text;
transition: border-color 200ms, background 200ms;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
  }

  &:focus-within {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.25);
  }
}

.gsb-icon {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.4);
}

.gsb-input {
flex: 1;
min-width: 0;
border: none;
outline: none;
background: transparent;
color: rgba(255, 255, 255, 0.9);
font-size: 14px;
cursor: text;
padding-left: 2px;
&::placeholder { color: rgba(255, 255, 255, 0.3); }
}

.gsb-clear {
  flex-shrink: 0;
  width: 20px; height: 20px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 120ms;
  &:hover { background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.9); }
}

/* ── Dropdown ── */
.gsb-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  max-height: 480px;
  overflow-y: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }

  background: rgba(20, 20, 28, 0.95);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 8px;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.gsb-loading,
.gsb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

.gsb-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  animation: gsb-spin 0.6s linear infinite;
}
@keyframes gsb-spin { to { transform: rotate(360deg); } }

/* ── Group ── */
.gsb-group {
  margin-bottom: 4px;
}

.gsb-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.4);
}

.gsb-group-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

/* ── Item ── */
.gsb-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 120ms;

  &:hover { background: rgba(255, 255, 255, 0.06); }
}

.gsb-item-cover {
  width: 36px; height: 36px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.04);

  img { width: 100%; height: 100%; object-fit: cover; }
}

.gsb-item-cover--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.2);
}

.gsb-item-info {
  flex: 1;
  min-width: 0;
}

.gsb-item-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gsb-item-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

/* ── Action buttons (like, add to playlist) ── */
.gsb-action-btn {
  flex-shrink: 0;
  width: 28px; height: 28px;
  border: none;
  background: transparent;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 120ms;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
  }

  &.is-liked {
    color: rgba(238, 100, 100, 0.9);
  }
}

.gsb-subscribe-btn {
  flex-shrink: 0;
  width: 28px; height: 28px;
  border: none;
  background: transparent;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 120ms;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
  }

  &:disabled {
    opacity: 0.4;
    cursor: wait;
  }
}

.gsb-subscribed-mark {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 204, 77, 0.9);
}

.gsb-item-tag {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;

  &--local {
    background: rgba(234, 242, 248, 0.08);
    color: rgba(234, 242, 248, 0.6);
  }
  &--netease {
    background: rgba(238, 120, 76, 0.12);
    color: rgba(238, 160, 120, 0.9);
  }
}

/* ── Playlist picker popover ── */
.gsb-playlist-picker {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 280px;
  max-height: 360px;
  overflow-y: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }

  background: rgba(20, 20, 28, 0.98);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 6px;
  z-index: 110;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}

.gsb-pp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 6px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
}

.gsb-pp-close {
  width: 20px; height: 20px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  &:hover { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.8); }
}

.gsb-pp-list {
  padding: 0 4px 4px;
}

.gsb-pp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 120ms;

  &:hover { background: rgba(255, 255, 255, 0.06); }
}

.gsb-pp-like {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 2px;
  padding-bottom: 10px;
}

.gsb-pp-icon {
  width: 36px; height: 36px;
  border-radius: 8px;
  background: rgba(238, 100, 100, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: rgba(238, 100, 100, 0.9);
  flex-shrink: 0;
}

.gsb-pp-cover {
  width: 36px; height: 36px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.04);
  img { width: 100%; height: 100%; object-fit: cover; }
}

.gsb-pp-cover--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.2);
}

.gsb-pp-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gsb-pp-count {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

/* ── Mini toast ── */
.gsb-mini-toast {
  position: absolute;
  bottom: -36px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(20, 20, 28, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  z-index: 120;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

/* ── Transitions ── */
.gsb-dropdown-enter-active,
.gsb-dropdown-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}
.gsb-dropdown-enter-from,
.gsb-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.gsb-popover-enter-active,
.gsb-popover-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}
.gsb-popover-enter-from,
.gsb-popover-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}

.gsb-toast-enter-active,
.gsb-toast-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.gsb-toast-enter-from,
.gsb-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}
</style>
