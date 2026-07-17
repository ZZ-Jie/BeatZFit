<template>
  <div class="dual-deck-home engaged" data-dual-deck>
    <!-- 全功能搜索框 (本地优先 + 网易云兑底) -->
    <GlobalSearchBar
      v-show="!immersivePrefs.hideHomeSearch"
      :local-tracks="localTracks"
      :netease-playlists="neteasePlaylists"
      @song-play="onSearchSongPlay"
      @playlist-open="onSearchPlaylistOpen"
      @exercise-open="onSearchExerciseOpen"
    />
    <!-- 3D 透视舞台 (完全 3D 模式: 始终激活) -->
    <div
      class="stage stage-engaged"
      ref="stageRef"
      data-deck-stage
      @click="onStageClick"
    >
      <div class="world" data-deck-world>
        <!-- 左侧牌堆：健身计划 (任何 coverflow 展开时隐藏) -->
        <div class="deck deck-left" data-deck="fitness" v-show="!showCoverflow && !showExerciseCoverflow && !immersivePrefs.hideHomeFitness">
          <div
            v-for="(card, i) in fitnessCards"
            :key="'fit-' + i"
            class="card"
            :data-card-index="i"
            @click="onCardClick('fitness', i)"
          >
            <div class="card-inner" :style="{ '--c': card.color }">
              <div class="ci-cover" v-if="card.coverUrl">
                <img :src="card.coverUrl" :alt="card.title || '封面'" loading="lazy" @error="onCoverError" />
                <div class="ci-cover-shade"></div>
              </div>
              <div class="ci-glow"></div>
              <div class="ci-content">
                <div class="ci-title">{{ card.title }}</div>
                <div class="ci-sub">{{ card.sub }}</div>
                <div class="ci-meta" :class="`ci-meta--${card.source}`"><span class="ci-dot"></span>{{ card.meta }}</div>
              </div>
              <div class="ci-bar"></div>
            </div>
          </div>
          <!-- 空状态 -->
          <div v-if="fitnessCards.length === 0 && !loading" class="card front" data-card-index="0" @click="onCardClick('fitness', 0)">
            <div class="card-inner" style="--c: #B8B8B8">
              <div class="ci-glow"></div>
              <div class="ci-content">
                <div class="ci-tag">训练</div>
                <div class="ci-title">创建计划</div>
                <div class="ci-sub">从动作库挑选动作</div>
                <div class="ci-meta"><span class="ci-dot"></span>开始训练旅程</div>
              </div>
              <div class="ci-bar"></div>
            </div>
          </div>
        </div>

        <!-- 右侧牌堆：歌单 (任何 coverflow 展开时隐藏) -->
        <div class="deck deck-right" data-deck="music" v-show="!showCoverflow && !showExerciseCoverflow && !immersivePrefs.hideHomeMusic">
          <div
            v-for="(card, i) in musicCards"
            :key="'mus-' + i"
            class="card"
            :data-card-index="i"
            @click="onCardClick('music', i)"
          >
            <div class="card-inner" :style="{ '--c': card.color }">
              <div class="ci-cover" v-if="card.coverUrl">
                <img :src="card.coverUrl" :alt="card.title || '封面'" loading="lazy" @error="onCoverError" />
                <div class="ci-cover-shade"></div>
              </div>
              <div class="ci-glow"></div>
              <div class="ci-content">
                <div class="ci-title">{{ card.title }}</div>
                <div class="ci-sub">{{ card.sub }}</div>
                <div class="ci-meta" :class="`ci-meta--${card.source}`"><span class="ci-dot"></span>{{ card.meta }}</div>
              </div>
              <div class="ci-bar"></div>
            </div>
          </div>
          <!-- 空状态 -->
          <div v-if="musicCards.length === 0 && !loading" class="card front" data-card-index="0" @click="onCardClick('music', 0)">
            <div class="card-inner" style="--c: #C0C0C0">
              <div class="ci-glow"></div>
              <div class="ci-content">
                <div class="ci-tag">歌单</div>
                <div class="ci-title">导入音乐</div>
                <div class="ci-sub">本地文件或网易云</div>
                <div class="ci-meta"><span class="ci-dot"></span>开启音乐之旅</div>
              </div>
              <div class="ci-bar"></div>
            </div>
          </div>
        </div>

        <!-- 歌单展开：3D 悬浮歌曲列表卡片（在 world 内，跟随 visualizer 变换） -->
        <div v-if="coverflowLoading && !showCoverflow" class="coverflow-loading">
          <div class="coverflow-loading-spinner"></div>
          <div class="coverflow-loading-text">加载歌单中…</div>
        </div>
        <!-- 首次加载指示器 (仅首次启动时显示) -->
        <div v-if="loading" class="home-loading">
          <div class="home-loading-spinner"></div>
          <div class="home-loading-text">加载中…</div>
        </div>
        <SongCoverflow
          v-if="showCoverflow"
          :tracks="coverflowTracks"
          :playlist-name="coverflowName"
          :playlist-cover="coverflowCover"
          :playlist-sub="coverflowSub"
          @select="onCoverflowSelect"
          @close="onCoverflowClose"
        />

        <!-- 训练计划展开：3D 悬浮动作列表卡片（在 world 内，跟随 visualizer 变换） -->
        <ExerciseCoverflow
          v-if="showExerciseCoverflow"
          :exercise-items="exerciseCoverflowItems"
          :plan-name="exerciseCoverflowPlanName"
          :plan-sub="exerciseCoverflowPlanSub"
          :header-cover="exerciseCoverflowCover"
          @select="onExerciseCoverflowSelect"
          @header-click="onExerciseCoverflowHeaderClick"
          @start-workout="onExerciseCoverflowHeaderClick"
          @close="onExerciseCoverflowClose"
        />
      </div>
    </div>

    <!-- 侧标签 (任何 coverflow 展开时隐藏) -->
    <div class="side-label side-label-l" v-show="!showCoverflow && !showExerciseCoverflow && !immersivePrefs.hideHomeFitness">训练 · Fitness</div>
    <div class="side-label side-label-r" v-show="!showCoverflow && !showExerciseCoverflow && !immersivePrefs.hideHomeMusic">歌单 · Music</div>

    <!-- 交互提示 (coverflow 展开时) -->
    <Transition :css="false" @enter="onHintEnter" @leave="onHintLeave">
      <div v-if="showCoverflow || showExerciseCoverflow" class="engage-hint">
        <span v-if="showCoverflow">拖拽旋转 · 滚轮缩放 · 点击关闭按钮返回</span>
        <span v-else-if="showExerciseCoverflow">拖拽旋转 · 滚轮缩放 · 点击头部进入训练 · 点击动作查看详情</span>
      </div>
    </Transition>

    <!-- 动作详情弹窗 -->
    <ExerciseDetailModal
      :exercise="detailExercise"
      @close="detailExercise = null"
      @add-to-plan="onAddToPlanFromDetail"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useFitnessStore } from '@/stores/fitness'
import { useMusicStore } from '@/stores/music'
import { usePlaylistStore } from '@/stores/playlist'
import { COVERFLOW_COLORS_6 } from '@/components/coverflowColors'
import { loadLibraryCached, getLibraryVersion } from '@/modules/music/dataLoaders'
import { cachedFetch, cacheInvalidatePrefix, CacheNS, CacheTTL } from '@/modules/music/cache'
import { toExerciseMediaUrl } from '@/utils/exerciseMedia'
import gsap from 'gsap'
import type { Track, WorkoutPlan } from '@/types'
import type { NeteasePlaylist, NeteaseSong } from '@/types/netease.d'
import type { QqPlaylist, QqSong } from '@/types/qq.d'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'
import { useNeteaseStatus } from '@/composables/useNeteaseStatus'
import { useNeteaseLikes } from '@/composables/useNeteaseLikes'
import { useImmersivePrefs, savePrefs } from '@/composables/useImmersivePrefs'
import { useSfx } from '@/composables/useSfx'
import SongCoverflow from '@/components/SongCoverflow.vue'
import ExerciseCoverflow from '@/components/ExerciseCoverflow.vue'
import ExerciseDetailModal from '@/components/ExerciseDetailModal.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import type { ExerciseCoverflowItem } from '@/components/ExerciseCoverflow.vue'
import type { Exercise } from '@/types'

const router = useRouter()
const fitnessStore = useFitnessStore()
const musicStore = useMusicStore()
const playlistStore = usePlaylistStore()
const {
  visualizer,
  attachInteraction,
  detachInteraction,
  onTransformChange,
  registerStage,
  unregisterStage,
} = useGlobalVisualizer()

// ── Immersive prefs (hide cards + labels) ──
const { prefs: immersivePrefs } = useImmersivePrefs()
const sfx = useSfx()

// ── Stage ref ──
// 完全 3D 模式: 始终激活, 无 idle/engaged 切换
const stageRef = ref<HTMLElement | null>(null)

// ── Visualizer camera transform ──
let targetRX = 0, targetRY = 0, targetScale = 1
let displayRX = 0, displayRY = 0, displayScale = 1

const { checkLoginStatus: checkNeteaseShared } = useNeteaseStatus()

// ── Song Coverflow state ──
const showCoverflow = ref(false)
const coverflowTracks = ref<Track[]>([])
const coverflowName = ref('')
const coverflowCover = ref<string | undefined>(undefined)
const coverflowSub = ref('')
const coverflowLoading = ref(false)
// Track the source of the current coverflow for data-refresh purposes
const coverflowSource = ref<'netease' | 'qq' | 'local-playlist' | 'local-library' | null>(null)
const coverflowPlaylistId = ref<number | string | null>(null)

// ── Exercise Coverflow state ──
const showExerciseCoverflow = ref(false)
const exerciseCoverflowItems = ref<ExerciseCoverflowItem[]>([])
const exerciseCoverflowPlanName = ref('')
const exerciseCoverflowPlanSub = ref('')
const exerciseCoverflowCover = ref<string | undefined>(undefined)
const exerciseCoverflowPlanId = ref<string | undefined>(undefined)

// ── Exercise Detail Modal state ──
const detailExercise = ref<Exercise | null>(null)

// ── Data loading ──
// Module-level cache: data persists across unmount/remount cycles so the
// home page doesn't re-fetch everything on every navigation back.
let _homeDataLoaded = false
let _cachedLocalTracks: Track[] = []
let _cachedNeteasePlaylists: NeteasePlaylist[] = []
let _cachedQqPlaylists: QqPlaylist[] = []
let _homeLibraryVersion = 0 // tracks which libraryVersion the cache was built from

const localTracks = ref<Track[]>(_cachedLocalTracks)
const neteasePlaylists = ref<NeteasePlaylist[]>(_cachedNeteasePlaylists)
const qqPlaylists = ref<QqPlaylist[]>(_cachedQqPlaylists)
const loading = ref(!_homeDataLoaded)

// 黑白灰系列 — 在深色背景上保持可见度 (共享常量)
const FIT_COLORS = [...COVERFLOW_COLORS_6]
const MUS_COLORS = [...COVERFLOW_COLORS_6]

interface DeckCard {
  tag: string
  title: string
  sub: string
  meta: string
  color: string
  coverUrl?: string
  planId?: string
  playlistId?: number | string
  trackId?: string
  source: 'netease-playlist' | 'qq-playlist' | 'local-playlist' | 'local-library' | 'recent-track' | 'fitness-plan'
}

// ── Fitness deck cards ──
const fitnessCards = computed<DeckCard[]>(() => {
  if (loading.value) return []
  return fitnessStore.plans.slice(0, 5).map((plan, i) => {
    const firstEx = plan.exercises[0]
    const exercise = fitnessStore.exercises.find(e => e.id === firstEx?.exerciseId)
    const coverUrl = exercise ? toExerciseMediaUrl(exercise.gifUrl) : undefined

    return {
      tag: '训练',
      title: plan.name,
      sub: `${plan.bodyPart || '全身'} · ${plan.exercises.length} 动作`,
      meta: plan.equipment || '综合训练',
      color: FIT_COLORS[i % FIT_COLORS.length],
      coverUrl,
      planId: plan.id,
      source: 'fitness-plan' as const,
    }
  })
})

// ── Music deck cards ──
const musicCards = computed<DeckCard[]>(() => {
  if (loading.value) return []
  const cards: DeckCard[] = []
  let colorIdx = 0

  if (neteasePlaylists.value.length > 0) {
    neteasePlaylists.value.slice(0, 3).forEach((pl) => {
      cards.push({
        tag: '',
        title: pl.name,
        sub: `${pl.trackCount} 首`,
        meta: '网易云',
        color: MUS_COLORS[colorIdx % MUS_COLORS.length],
        coverUrl: pl.coverImgUrl ? pl.coverImgUrl + '?param=300x300' : '/assets/beatzfit-logo.jpg',
        playlistId: pl.id,
        source: 'netease-playlist' as const,
      })
      colorIdx++
    })
  }

  if (qqPlaylists.value.length > 0) {
    qqPlaylists.value.forEach((pl) => {
      cards.push({
        tag: '',
        title: pl.name,
        sub: `${pl.trackCount} 首`,
        meta: 'QQ音乐',
        color: MUS_COLORS[colorIdx % MUS_COLORS.length],
        coverUrl: pl.coverImgUrl || '/assets/beatzfit-logo.jpg',
        playlistId: pl.id,
        source: 'qq-playlist' as const,
      })
      colorIdx++
    })
  }

  // Local playlists — show as individual cards (like netease/qq playlists)
  if (playlistStore.playlists.length > 0) {
    playlistStore.playlists.slice(0, 5).forEach((pl) => {
      cards.push({
        tag: '',
        title: pl.name,
        sub: `${pl.trackCount} 首`,
        meta: '本地歌单',
        color: MUS_COLORS[colorIdx % MUS_COLORS.length],
        coverUrl: pl.coverPath ? musicStore.toCoverUrl(pl.coverPath) : '/assets/beatzfit-logo.jpg',
        playlistId: pl.id,
        source: 'local-playlist' as const,
      })
      colorIdx++
    })
  }

  if (localTracks.value.length > 0) {
    const recent = [...localTracks.value]
      .filter(t => t.lastPlayedAt)
      .sort((a, b) => (b.lastPlayedAt || '').localeCompare(a.lastPlayedAt || ''))
      .slice(0, 1)
    recent.forEach((track) => {
      cards.push({
        tag: '',
        title: track.title,
        sub: track.artist || '未知艺术家',
        meta: '最近播放',
        color: MUS_COLORS[colorIdx % MUS_COLORS.length],
        coverUrl: track.coverPath ? musicStore.toCoverUrl(track.coverPath) : '/assets/beatzfit-logo.jpg',
        trackId: track.id,
        source: 'recent-track' as const,
      })
      colorIdx++
    })
  }

  return cards.slice(0, 10)
})

onMounted(async () => {
// Fast path: data already loaded from a previous mount — skip loading
if (_homeDataLoaded) {
// Check if the library was invalidated since our last load (e.g. user
// cleared the library from MusicPage). If so, reload local tracks.
if (getLibraryVersion() !== _homeLibraryVersion) {
try {
const rows = await loadLibraryCached(true)
localTracks.value = (rows as any[]).map((t) => ({
id: t.id, title: t.title, artist: t.artist, album: t.album,
duration: t.duration, coverPath: t.cover_path, source: t.source,
sourceId: t.source_id, localPath: t.local_path,
lyricsPath: t.lyrics_path, addedAt: t.added_at, lastPlayedAt: t.last_played_at
}))
_cachedLocalTracks = localTracks.value
_homeLibraryVersion = getLibraryVersion()
} catch { /* ignore — keep stale data */ }
}
loading.value = false
// Ensure playlists are loaded (they may have been created since last mount)
playlistStore.loadPlaylists(false)
await nextTick()
initDecks()
return
}

  // Slow path: first mount — load everything
  try {
    if (window.electronAPI) {
      const [rows] = await Promise.all([
        loadLibraryCached(),
        fitnessStore.loadPlans(),
        fitnessStore.loadStats(),
        fitnessStore.loadBodyParts(),
        fitnessStore.loadExercises(),
        fitnessStore.loadRecords(),
        playlistStore.loadPlaylists(),
      ])
      localTracks.value = (rows as any[]).map((t) => ({
        id: t.id, title: t.title, artist: t.artist, album: t.album,
        duration: t.duration, coverPath: t.cover_path, source: t.source,
        sourceId: t.source_id, localPath: t.local_path,
        lyricsPath: t.lyrics_path, addedAt: t.added_at, lastPlayedAt: t.last_played_at
      }))
_cachedLocalTracks = localTracks.value
_homeLibraryVersion = getLibraryVersion()
await checkNeteaseStatus()
      await checkQqStatus()
      _homeDataLoaded = true
    }
  } catch (e) {
    console.error('[DualDeckHome] Failed to load data:', e)
  } finally {
    loading.value = false
    await nextTick()
    initDecks()
  }
})

async function checkNeteaseStatus() {
  if (!window.electronAPI?.netease) return
  try {
    await checkNeteaseShared()
    const { isLoggedIn: loggedIn, userInfo: info } = useNeteaseStatus()
    if (loggedIn.value && info.value?.userId) {
      const uid = info.value.userId
      const list = await cachedFetch(
        CacheNS.NeteasePlaylists,
        String(uid),
        async () => {
          const result = await window.electronAPI!.netease.getUserPlaylists(uid)
          if (!result.success || !result.data) return []
          return result.data.playlists || []
        },
        { ttlMs: CacheTTL.PLAYLISTS }
      )
      neteasePlaylists.value = list
    }
  } catch (e) {
    console.error('[DualDeckHome] Netease status check failed:', e)
  }
}

// Refresh netease playlists when data changes (e.g. user liked a song from search)
async function onNeteaseDataChanged() {
  if (!window.electronAPI?.netease) return
  try {
    const { loadLikedList } = useNeteaseLikes()
    // Reload liked list in case it changed
    await loadLikedList(true)
    const { isLoggedIn: loggedIn, userInfo: info } = useNeteaseStatus()
    if (loggedIn.value && info.value?.userId) {
      const uid = info.value.userId
      const list = await cachedFetch(
        CacheNS.NeteasePlaylists,
        String(uid),
        async () => {
          const result = await window.electronAPI!.netease.getUserPlaylists(uid)
          if (!result.success || !result.data) return []
          return result.data.playlists || []
        },
        { ttlMs: CacheTTL.PLAYLISTS, forceRefresh: true }
      )
      neteasePlaylists.value = list
      // If a netease coverflow is currently open, refresh its tracks too
      if (showCoverflow.value && coverflowSource.value === 'netease' && coverflowPlaylistId.value != null) {
        const plId = Number(coverflowPlaylistId.value)
        if (!isNaN(plId)) {
          cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, String(plId))
          // Brief delay to allow Netease server to propagate like/unlike changes
          // before re-fetching playlist detail (otherwise stale data may be returned)
          await new Promise(r => setTimeout(r, 300))
          try {
            const result = await window.electronAPI!.netease.getPlaylistDetail(plId)
            if (result.success && result.data?.tracks) {
              coverflowTracks.value = result.data.tracks.map(toNeteaseTrack)
            }
          } catch (e) {
            console.error('[DualDeckHome] Failed to refresh coverflow tracks:', e)
          }
        }
      }
    }
  } catch (e) {
    console.error('[DualDeckHome] Netease data refresh failed:', e)
  }
}

async function checkQqStatus() {
  if (!window.electronAPI?.qq) return
  try {
    const result = await window.electronAPI.qq.getLoginStatus()
    if (result.success && result.data?.isLoggedIn) {
      const list = await cachedFetch(
        CacheNS.QqPlaylists,
        'default',
        async () => {
          const res = await window.electronAPI!.qq.getUserPlaylists()
          if (!res.success || !res.data) return []
          return res.data.playlists || []
        },
        { ttlMs: CacheTTL.PLAYLISTS }
      )
      qqPlaylists.value = list
    }
  } catch (e) {
    console.error('[DualDeckHome] QQ status check failed:', e)
  }
}

function onCoverError(e: Event) {
  const img = e.target as HTMLImageElement
  const cover = img.parentElement
  if (cover) cover.style.display = 'none'
}

// ── Card click navigation ──
let pointerDownX = 0
let pointerDownY = 0
let pointerDownTime = 0
let lastPointerUpX = 0
let lastPointerUpY = 0

function onCardClick(type: 'fitness' | 'music', index: number) {
  const dx = Math.abs(pointerDownX - lastPointerUpX)
  const dy = Math.abs(pointerDownY - lastPointerUpY)
  const dt = performance.now() - pointerDownTime
  if (dx > 8 || dy > 8 || dt > 500) return

  const deckEl = document.querySelector(`[data-deck="${type}"]`) as HTMLElement | null
  if (!deckEl) return
  const cards = Array.from(deckEl.querySelectorAll('.card')) as HTMLElement[]
  const frontCard = cards.find(c => c.classList.contains('front'))
  if (frontCard && frontCard.dataset.cardIndex !== String(index)) return

  sfx.airBloom()
  if (type === 'fitness') {
    const card = fitnessCards.value[index]
    if (!card || !card.planId) {
      router.push('/fitness')
      return
    }
    // Expand exercise coverflow instead of directly navigating
    expandExerciseCoverflow(card.planId, card.title, card.sub, card.coverUrl)
  } else {
    const card = musicCards.value[index]
    if (!card) {
      router.push('/music')
      return
    }
    switch (card.source) {
      case 'netease-playlist':
        expandCoverflow(card)
        break
      case 'qq-playlist':
        expandQqCoverflow(card)
        break
      case 'local-playlist':
        expandLocalPlaylistCoverflow(card)
        break
case 'local-library':
coverflowTracks.value = localTracks.value
coverflowName.value = card.title
coverflowCover.value = card.coverUrl
coverflowSub.value = card.sub
coverflowSource.value = 'local-library'
coverflowPlaylistId.value = null
showCoverflow.value = true
        break
      case 'recent-track': {
        const track = localTracks.value.find(t => t.id === card.trackId)
        if (track) {
          musicStore.playTrack(track)
          router.push('/player')
        } else {
          router.push('/music')
        }
        break
      }
      default:
        router.push('/music')
    }
  }
}

// ── Netease track conversion ──
function toNeteaseTrack(t: NeteaseSong): Track {
  return {
    id: `ne_${t.id}`,
    title: t.name,
    artist: t.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
    album: t.al?.name || 'Unknown Album',
    duration: (t.dt || 0) / 1000,
    coverPath: t.al?.picUrl,
    source: 'netease',
    sourceId: String(t.id),
    localPath: '',
    addedAt: new Date().toISOString()
  }
}

// ── QQ Music track conversion ──
function toQqTrack(t: QqSong): Track {
  const coverUrl = t.album?.mid
    ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${t.album.mid}.jpg`
    : undefined
  return {
    id: `qq_${t.songmid}`,
    title: t.name,
    artist: t.singer?.map(s => s.name).join(', ') || 'Unknown Artist',
    album: t.album?.name || 'Unknown Album',
    duration: t.interval || 0,
    coverPath: coverUrl,
    source: 'qq',
    sourceId: t.songmid,
    sourceMediaMid: t.strMediaMid || t.songmid,
    localPath: '',
    addedAt: new Date().toISOString(),
    vip: t.pay?.payplay === 1,
  }
}

// ── Expand QQ Music Coverflow ──
async function expandQqCoverflow(card: DeckCard) {
  if (!window.electronAPI?.qq || !card.playlistId) {
    router.push('/music')
    return
  }
  coverflowLoading.value = true
  sfx.airBloom()
  try {
    const result = await window.electronAPI.qq.getPlaylistDetail(String(card.playlistId))
    if (!result.success || !result.data) {
      router.push('/music')
      return
    }
    const tracks = result.data.tracks.map(toQqTrack)
    if (tracks.length > 0) {
      coverflowTracks.value = tracks
      coverflowName.value = card.title
      coverflowCover.value = card.coverUrl
      coverflowSub.value = card.sub
      showCoverflow.value = true
    } else {
      router.push('/music')
    }
  } catch (e) {
    console.error('[DualDeckHome] Failed to load QQ playlist for coverflow:', e)
    router.push('/music')
  } finally {
    coverflowLoading.value = false
  }
}

// ── Expand Exercise Coverflow for a fitness plan ──
function expandExerciseCoverflow(planId: string, planName: string, planSub: string, coverUrl?: string) {
  const plan = fitnessStore.plans.find(p => p.id === planId)
  if (!plan || plan.exercises.length === 0) {
    router.push('/fitness')
    return
  }
  // Build exercise items from plan
  const items: ExerciseCoverflowItem[] = plan.exercises.map((item) => {
    const ex = fitnessStore.exercises.find(e => e.id === item.exerciseId)
    return {
      exerciseId: item.exerciseId,
      name: ex?.name || '未知动作',
      chineseName: ex?.chineseName,
      bodyPart: ex?.bodyPartZh || ex?.bodyPart || plan.bodyPart,
      bodyPartZh: ex?.bodyPartZh,
      equipment: ex?.equipmentZh || ex?.equipment || plan.equipment,
      equipmentZh: ex?.equipmentZh,
      target: ex?.target,
      targetZh: ex?.targetZh,
      gifUrl: ex?.gifUrl,
      instructions: ex?.instructions,
      precautionsZh: ex?.precautionsZh,
      sets: item.sets,
      reps: item.reps,
      restSeconds: item.restSeconds,
    }
  })
  exerciseCoverflowItems.value = items
  exerciseCoverflowPlanName.value = planName
  exerciseCoverflowPlanSub.value = planSub
  exerciseCoverflowCover.value = coverUrl
  exerciseCoverflowPlanId.value = planId
  showExerciseCoverflow.value = true
}

// ── Exercise coverflow handlers ──
function onExerciseCoverflowSelect(item: ExerciseCoverflowItem) {
  sfx.airBloom()
  // Find full Exercise from store for the detail modal
  const ex = fitnessStore.exercises.find(e => e.id === item.exerciseId)
  if (ex) {
    detailExercise.value = ex
  } else {
    // Fallback: construct from item
    detailExercise.value = {
      id: item.exerciseId,
      name: item.name,
      chineseName: item.chineseName,
      bodyPart: item.bodyPart || '',
      bodyPartZh: item.bodyPartZh,
      equipment: item.equipment || '',
      equipmentZh: item.equipmentZh,
      target: item.target || '',
      targetZh: item.targetZh,
      gifUrl: item.gifUrl,
      instructions: item.instructions,
      precautionsZh: item.precautionsZh,
    }
  }
}

function onExerciseCoverflowHeaderClick() {
  sfx.confirm()
  // Navigate to workout page
  const planId = exerciseCoverflowPlanId.value
  if (planId) {
    const plan = fitnessStore.plans.find(p => p.id === planId)
    if (plan) {
      fitnessStore.startSession(plan)
      router.push(`/workout/${plan.id}`)
      return
    }
  }
  router.push('/fitness')
}

function onExerciseCoverflowClose() {
  sfx.retract()
  showExerciseCoverflow.value = false
}

// ── Add exercise to plan from detail modal ──
function onAddToPlanFromDetail(ex: Exercise) {
  sfx.confirm()
  fitnessStore.addPendingExercise(ex)
  detailExercise.value = null
  showExerciseCoverflow.value = false
  router.push('/plan/build')
}

// ── Global search handlers ──
function onSearchSongPlay(track: Track) {
  musicStore.playTrack(track)
  router.push('/player')
}

async function onSearchPlaylistOpen(
  playlistId: string,
  source: 'local' | 'netease',
  playlistData?: {
    id: number
    name: string
    coverImgUrl?: string
    trackCount: number
    creator?: { nickname: string }
  }
) {
  if (source === 'netease') {
    // Expand netease playlist coverflow
    const pl = neteasePlaylists.value.find(p => String(p.id) === playlistId)
    if (pl) {
      const card: DeckCard = {
        tag: '',
        title: pl.name,
        sub: `${pl.trackCount} 首`,
        meta: '网易云',
        color: MUS_COLORS[0],
        coverUrl: pl.coverImgUrl ? pl.coverImgUrl + '?param=300x300' : '/assets/beatzfit-logo.jpg',
        playlistId: pl.id,
        source: 'netease-playlist',
      }
      expandCoverflow(card)
    } else if (playlistData) {
      // Third-party playlist found via search — not in user's library yet
      const card: DeckCard = {
        tag: '',
        title: playlistData.name,
        sub: `${playlistData.trackCount} 首${playlistData.creator?.nickname ? ' · ' + playlistData.creator.nickname : ''}`,
        meta: '网易云',
        color: MUS_COLORS[0],
        coverUrl: playlistData.coverImgUrl ? playlistData.coverImgUrl + '?param=300x300' : '/assets/beatzfit-logo.jpg',
        playlistId: playlistData.id,
        source: 'netease-playlist',
      }
      expandCoverflow(card)
    } else {
      router.push('/music')
    }
  } else {
    // Local playlist — expand coverflow
    const pl = playlistStore.playlists.find(p => String(p.id) === playlistId)
    if (pl) {
      const card: DeckCard = {
        tag: '',
        title: pl.name,
        sub: `${pl.trackCount} 首`,
        meta: '本地歌单',
        color: MUS_COLORS[0],
        coverUrl: pl.coverPath ? musicStore.toCoverUrl(pl.coverPath) : '/assets/beatzfit-logo.jpg',
        playlistId: pl.id,
        source: 'local-playlist',
      }
      expandLocalPlaylistCoverflow(card)
    } else {
      router.push('/music')
    }
  }
}

async function onSearchExerciseOpen(exercise: Exercise) {
  // Load full exercise details then show modal
  const fullExercise = await fitnessStore.loadExerciseById(exercise.id)
  detailExercise.value = fullExercise || exercise
}

// ── Expand Coverflow for a music card ──
async function expandCoverflow(card: DeckCard) {
if (card.source === 'netease-playlist' && card.playlistId) {
if (!window.electronAPI?.netease) {
router.push('/music')
return
}
coverflowLoading.value = true
sfx.airBloom()
try {
// First load: fetch only first 100 tracks for fast initial display
const initialTracks = await cachedFetch(
CacheNS.NeteasePlaylistDetail,
String(card.playlistId),
async () => {
const result = await window.electronAPI!.netease.getPlaylistDetail(card.playlistId as number, 100)
if (!result.success || !result.data) return []
return result.data.tracks || []
},
{ ttlMs: CacheTTL.PLAYLIST_DETAIL }
)
if (initialTracks.length > 0) {
// Show coverflow immediately with initial tracks
coverflowTracks.value = initialTracks.map(toNeteaseTrack)
coverflowName.value = card.title
coverflowCover.value = card.coverUrl
coverflowSub.value = card.sub
coverflowSource.value = 'netease'
coverflowPlaylistId.value = card.playlistId
showCoverflow.value = true
coverflowLoading.value = false

// Background load: fetch full playlist (up to 1000) and update silently
// Only if the initial load returned exactly 100 (likely more exist)
if (initialTracks.length === 100) {
window.electronAPI!.netease.getPlaylistDetail(card.playlistId as number).then(fullResult => {
if (fullResult.success && fullResult.data?.tracks && fullResult.data.tracks.length > initialTracks.length) {
// Only update if the coverflow is still showing the same playlist
if (showCoverflow.value && coverflowSource.value === 'netease' && coverflowPlaylistId.value === card.playlistId) {
coverflowTracks.value = fullResult.data.tracks.map(toNeteaseTrack)
// Update cache with full data
cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, String(card.playlistId))
}
}
}).catch(() => {
// Silent failure — initial 100 tracks are already shown
})
}
} else {
coverflowLoading.value = false
router.push('/music')
}
} catch (e) {
console.error('[DualDeckHome] Failed to load playlist for coverflow:', e)
coverflowLoading.value = false
router.push('/music')
}
}
}

// ── Expand Coverflow for a local playlist card ──
async function expandLocalPlaylistCoverflow(card: DeckCard) {
if (!card.playlistId) {
router.push('/music')
return
}
coverflowLoading.value = true
sfx.airBloom()
try {
await playlistStore.loadPlaylistDetail(String(card.playlistId))
const tracks = playlistStore.currentTracks
if (tracks.length > 0) {
coverflowTracks.value = tracks
coverflowName.value = card.title
coverflowCover.value = card.coverUrl
coverflowSub.value = card.sub
coverflowSource.value = 'local-playlist'
coverflowPlaylistId.value = card.playlistId
showCoverflow.value = true
} else {
router.push('/music')
}
} catch (e) {
console.error('[DualDeckHome] Failed to load local playlist for coverflow:', e)
router.push('/music')
} finally {
coverflowLoading.value = false
}
}

function onCoverflowSelect(track: Track) {
  sfx.confirm()
  const index = coverflowTracks.value.findIndex(t => t.id === track.id)
  if (index >= 0) {
    musicStore.setQueue(coverflowTracks.value, index)
    musicStore.playIndex(index)
  } else {
    musicStore.playTrack(track)
  }
  showCoverflow.value = false
  router.push('/player')
}

function onCoverflowClose() {
sfx.retract()
showCoverflow.value = false
coverflowSource.value = null
coverflowPlaylistId.value = null
}

// ── Deck layout ──
interface DeckState {
  cards: HTMLElement[]
  inners: HTMLElement[]
  scroll: number
  target: number
  type: 'fitness' | 'music'
  lastBlur: number[]
  lastVis: boolean[]
  lastFront: boolean[]
  lastTransform: string[]
  lastOpacity: string[]
  lastPointerEvents: string[]
}

const decks: DeckState[] = []
let rafId = 0
let disposed = false
let worldEl: HTMLElement | null = null
let idleSettled = false

function initDecks() {
  const fitDeck = document.querySelector('[data-deck="fitness"]') as HTMLElement | null
  const musDeck = document.querySelector('[data-deck="music"]') as HTMLElement | null

  // Cache worldEl once during init instead of querying every frame
  worldEl = document.querySelector('[data-deck-world]')

  decks.length = 0

  if (fitDeck) {
    const cards = Array.from(fitDeck.querySelectorAll('.card')) as HTMLElement[]
    const inners = cards.map(c => c.querySelector('.card-inner') as HTMLElement | null).filter(Boolean) as HTMLElement[]
    decks.push({
      cards, inners, scroll: 0, target: 0,
      type: 'fitness',
      lastBlur: new Array(cards.length).fill(-1),
      lastVis: new Array(cards.length).fill(true),
      lastFront: new Array(cards.length).fill(false),
      lastTransform: new Array(cards.length).fill(''),
      lastOpacity: new Array(cards.length).fill(''),
      lastPointerEvents: new Array(cards.length).fill(''),
    })
  }
  if (musDeck) {
    const cards = Array.from(musDeck.querySelectorAll('.card')) as HTMLElement[]
    const inners = cards.map(c => c.querySelector('.card-inner') as HTMLElement | null).filter(Boolean) as HTMLElement[]
    decks.push({
      cards, inners, scroll: 0, target: 0,
      type: 'music',
      lastBlur: new Array(cards.length).fill(-1),
      lastVis: new Array(cards.length).fill(true),
      lastFront: new Array(cards.length).fill(false),
      lastTransform: new Array(cards.length).fill(''),
      lastOpacity: new Array(cards.length).fill(''),
      lastPointerEvents: new Array(cards.length).fill(''),
    })
  }

  if (!rafId) startLoop()
}

function deckOf(type: 'fitness' | 'music'): DeckState | undefined {
  return decks.find(d => d.type === type)
}

function sideOf(x: number): 'fitness' | 'music' {
  return x < window.innerWidth / 2 ? 'fitness' : 'music'
}

function isHomeVisible(): boolean {
  // 横向单页架构: 组件挂载 = 可见, 卸载 = 不可见 (v-if 控制)
  return true
}

// ── Wheel handler ──
// 两侧 deck 区域: 滚轮切换卡片 (idle + engaged 均生效)
// 中央区域: idle → 页面滚动, engaged → visualizer 缩放
// coverflow 展开时: SongCoverflow 自己的 wheel handler 处理
function onWheel(e: WheelEvent) {
  if (!isHomeVisible()) return

  // ── 设置面板滚动隔离 ──
  // ControlPanel is teleported to <body> and positioned in the right 30% of
  // the screen. Without this check, the capture-phase handler below would
  // intercept wheel events meant for the panel's scrollable .cp-body.
  const wt = e.target as HTMLElement
  if (wt?.closest('.cp-sidebar') || wt?.closest('.cp-backdrop-el')) {
    return
  }

  if (showCoverflow.value) return // song coverflow 自己处理滚轮
  if (showExerciseCoverflow.value) return // exercise coverflow 自己处理滚轮

  const x = e.clientX
  const w = window.innerWidth
  const inLeft = x < w * 0.30
  const inRight = x > w * 0.70

  if (!inLeft && !inRight) {
    // Center area: 完全 3D 模式, 让 visualizer 的 wheel handler 处理缩放
    // App.vue 的 onWheelNav 检查 activeSection === 'home' 跳过翻页
    return
  }

  // Side: deck scroll — one wheel notch = one card
  e.preventDefault()
  e.stopPropagation()
  const d = e.deltaY > 0 ? 1 : -1
  const deck = deckOf(sideOf(x))
  if (deck) {
    const newTarget = Math.round(deck.target) + d
    sfx.detent()
    gsap.killTweensOf(deck)
    gsap.to(deck, {
      target: newTarget,
      duration: 0.5,
      ease: 'power3.out',
      overwrite: 'auto',
    })
  }
}

// ── Pointer tracking for click-vs-drag ──
function onPointerDownTrack(e: PointerEvent) {
  pointerDownX = e.clientX
  pointerDownY = e.clientY
  pointerDownTime = performance.now()
}

function onPointerUpTrack(e: PointerEvent) {
  lastPointerUpX = e.clientX
  lastPointerUpY = e.clientY
}

// ── Engage / Disengage ──
// Single handler on the stage element. Toggles engagement when clicking
// on empty areas. Clicks on cards are ignored (card @click handles those).
// This replaces the old two-element approach (engage-zone + stage) which
// suffered from event bubbling: onEngageClick set engaged=true, then the
// event bubbled to onStageClick which saw engaged=true and set it back to
// false, causing intermittent toggle failures.
function onStageClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  // Card clicks are handled by the card's own @click handler
  if (target.closest('.card')) return
  // SongCoverflow clicks are handled internally
  if (target.closest('[data-song-coverflow]')) return
  // ExerciseCoverflow clicks are handled internally
  if (target.closest('[data-cf-list]')) return

  // Only treat as a click if it was a click, not a drag
  const dx = Math.abs(pointerDownX - e.clientX)
  const dy = Math.abs(pointerDownY - e.clientY)
  const dt = performance.now() - pointerDownTime
  if (dx > 5 || dy > 5 || dt > 300) return

  // When coverflow is shown, clicking outside closes it (click, not drag)
  if (showCoverflow.value) {
    sfx.retract()
    showCoverflow.value = false
    return
  }
  if (showExerciseCoverflow.value) {
    sfx.retract()
    showExerciseCoverflow.value = false
    return
  }

  // Toggle immersive: if all hidden → show all; otherwise → hide all
  const isImmersive = immersivePrefs.value.hideHomeFitness && immersivePrefs.value.hideHomeMusic && immersivePrefs.value.hideHomeSearch
  sfx.detent()
  savePrefs({
    ...immersivePrefs.value,
    hideHomeFitness: !isImmersive,
    hideHomeMusic: !isImmersive,
    hideHomeSearch: !isImmersive,
  })
}

// ── Hint animations ──
function onHintEnter(el: Element, done: () => void) {
  gsap.fromTo(el, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out', onComplete: done })
}
function onHintLeave(el: Element, done: () => void) {
  gsap.to(el, { autoAlpha: 0, y: -4, duration: 0.2, ease: 'power2.in', onComplete: done })
}

function layoutDecks() {
  if (showCoverflow.value || showExerciseCoverflow.value) return // skip deck layout when any coverflow is shown
  decks.forEach(deck => {
    deck.scroll += (deck.target - deck.scroll) * 0.2

    const N = deck.cards.length
    if (N === 0) return

    const xDir = deck.type === 'fitness' ? -1 : 1

    deck.cards.forEach((cardEl, i) => {
      let p = ((i - deck.scroll) % N + N) % N
      if (p > N / 2) p -= N

      const absP = Math.abs(p)

      let op: number
      if (absP < 0.5) {
        op = 1
      } else {
        const fade = absP - 0.5
        if (p >= 0) {
          op = Math.max(0.06, 1 - 0.3 * fade)
        } else {
          op = Math.max(0, 0.4 - 0.8 * fade)
        }
      }

      if (op < 0.01) {
        if (deck.lastVis[i]) {
          cardEl.style.visibility = 'hidden'
          deck.lastVis[i] = false
        }
        if (deck.lastFront[i]) {
          cardEl.classList.remove('front')
          deck.lastFront[i] = false
        }
        return
      }
      if (!deck.lastVis[i]) {
        cardEl.style.visibility = 'visible'
        deck.lastVis[i] = true
      }

      const z = -220 * p * (1 + Math.abs(p) * 0.15)
      const x = xDir * Math.max(0, p) * 140
      const y = 70 * Math.max(0, p)
      const scale = Math.max(0.45, 1 - 0.08 * absP)
      const rotX = Math.max(-16, Math.min(16, 5 * p))
      const rotY = xDir * Math.max(0, p) * 4
      const blur = Math.max(6, 20 - absP * 5)

      // Only write transform when it actually changed
      const transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`
      if (deck.lastTransform[i] !== transform) {
        cardEl.style.transform = transform
        deck.lastTransform[i] = transform
      }

      // Only write opacity when it actually changed
      const opacityStr = String(op)
      if (deck.lastOpacity[i] !== opacityStr) {
        cardEl.style.opacity = opacityStr
        deck.lastOpacity[i] = opacityStr
      }

      // Only write pointerEvents when it actually changed
      const pe = op > 0.15 ? 'auto' : 'none'
      if (deck.lastPointerEvents[i] !== pe) {
        cardEl.style.pointerEvents = pe
        deck.lastPointerEvents[i] = pe
      }

      // Only toggle 'front' class when it actually changed
      const isFront = absP < 0.5
      if (deck.lastFront[i] !== isFront) {
        cardEl.classList.toggle('front', isFront)
        deck.lastFront[i] = isFront
      }

      // Only update backdrop-filter when blur value actually changed
      const blurRounded = Math.round(blur)
      if (blurRounded !== deck.lastBlur[i]) {
        const inner = deck.inners[i]
        if (inner) {
          inner.style.backdropFilter = `blur(${blurRounded}px) saturate(150%)`
          ;(inner.style as any).webkitBackdropFilter = `blur(${blurRounded}px) saturate(150%)`
        }
        deck.lastBlur[i] = blurRounded
      }
    })
  })
}

function startLoop() {
  function loop() {
    if (disposed) return
    rafId = requestAnimationFrame(loop)

    // ── Idle skip: when not engaged and all decks have converged,
    // skip layout work entirely. The RAF keeps running so interaction
    // responds immediately, but GPU work drops to near-zero.
    let allConverged = true
    for (const d of decks) {
      if (Math.abs(d.target - d.scroll) > 0.001) {
        allConverged = false
        break
      }
    }

    if (allConverged) {
      if (!idleSettled) {
        layoutDecks()
        idleSettled = true
      }
      // 即使卡片已收敛, 仍继续读取 visualizer 变换并更新 world
    } else {
      idleSettled = false
      layoutDecks()
    }

    // 始终读取 visualizer 变换 (完全 3D 模式)
    if (visualizer.value) {
      const t = visualizer.value.getCoverTransform()
      if (t) {
        targetRX = t.rotationX
        targetRY = t.rotationY
        targetScale = t.scale
      }
    }

    // Lerp world transform towards visualizer camera target.
    // CSS and Three.js use different Y-axis directions (CSS Y-down,
    // Three.js Y-up). For rotateY, the visual direction happens to be
    // the same (clockwise from below = counterclockwise from above).
    // For rotateX, the directions are opposite: Three.js positive
    // rotation.x tilts the top toward the viewer, while CSS positive
    // rotateX tilts the top away. Negate X to match the 3D theme.
    displayRX += (targetRX - displayRX) * 0.12
    displayRY += (targetRY - displayRY) * 0.12
    displayScale += (targetScale - displayScale) * 0.12

    if (worldEl) {
      const degX = (displayRX * 180 / Math.PI).toFixed(2)
      const degY = (displayRY * 180 / Math.PI).toFixed(2)
      worldEl.style.transform = `rotateX(${-degX}deg) rotateY(${degY}deg) scale(${displayScale.toFixed(3)})`
    }
  }
  loop()
}

watch([fitnessCards, musicCards], async () => {
  await nextTick()
  if (!loading.value) {
    initDecks()
  }
}, { flush: 'post' })

onMounted(() => {
  onTransformChange((t) => {
    targetRX = t.rotationX
    targetRY = t.rotationY
    targetScale = t.scale
  })

  // 从 visualizer 当前状态初始化 display 值, 避免重挂载时从 0 lerp 导致旋转动画
  if (visualizer.value) {
    const t = visualizer.value.getCoverTransform()
    if (t) {
      targetRX = displayRX = t.rotationX
      targetRY = displayRY = t.rotationY
      targetScale = displayScale = t.scale
    }
  }

  // 注册 3D stage, IntersectionObserver 会自动在滚动时将 canvas reparent 到此
  const stageEl = document.querySelector<HTMLElement>('[data-dual-deck] [data-deck-stage]')
  if (stageEl) {
    registerStage('home', stageEl)
    // 完全 3D 模式: 始终绑定 visualizer 交互
    attachInteraction(stageEl)
  }

  // wheel for deck scroll on sides
  window.addEventListener('wheel', onWheel, { passive: false, capture: true })
  // Track pointer for click-vs-drag detection
  window.addEventListener('pointerdown', onPointerDownTrack)
  window.addEventListener('pointerup', onPointerUpTrack)
})

onMounted(() => {
// Listen for netease data changes (e.g. user liked a song from search)
window.addEventListener('beatzfit:neteaseDataChanged', onNeteaseDataChanged)
})

// Must use onBeforeUnmount for unregisterStage so the canvas is moved back
// BEFORE Vue destroys the stage DOM.
onBeforeUnmount(() => {
unregisterStage('home')
})

onUnmounted(() => {
  disposed = true
  cancelAnimationFrame(rafId)
  rafId = 0
  detachInteraction()
  onTransformChange(null)
  window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  window.removeEventListener('pointerdown', onPointerDownTrack)
window.removeEventListener('pointerup', onPointerUpTrack)
window.removeEventListener('beatzfit:neteaseDataChanged', onNeteaseDataChanged)
decks.forEach(deck => {
    gsap.killTweensOf(deck)
  })
})
</script>

<style lang="scss" scoped>
.dual-deck-home {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* Global search bar — pinned to top center, above 3D stage.
   -webkit-app-region: no-drag prevents the TitleBar drag zone
   (top 40px) from intercepting clicks on the search input. */
.dual-deck-home > :deep(.gsb-wrap) {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  width: min(480px, 80vw);
  -webkit-app-region: no-drag;
}

/* 3D world — always captures pointer events so clicks on empty areas
   toggle engagement. The .world child has pointer-events: none, so
   clicks on empty areas pass through to .stage. Cards have
   pointer-events: auto so they receive clicks directly. */
.stage {
  position: absolute;
  inset: 0;
  z-index: 2;
  perspective: 1600px;
  perspective-origin: 50% 42%;
  pointer-events: auto;
  cursor: pointer;
  transform-style: preserve-3d;
  overflow: visible; /* Allow canvas to extend beyond stage bounds */

  /* canvas: position:absolute fills stage. translateZ(-1px) keeps it
     behind front cards (z=0) in preserve-3d space.
     Aurora is on a separate canvas in GlobalBackground (behind everything). */
  :deep(canvas) {
    display: block;
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
    pointer-events: none;
    z-index: 0;
    transform: translateZ(-1px);
  }

  &.stage-engaged {
    cursor: grab;
    touch-action: none;

    &:active {
      cursor: grabbing;
    }
  }
}

.world {
  position: absolute;
  inset: 0;
  z-index: 1;
  transform-style: preserve-3d;
  will-change: transform;
  pointer-events: none;
}

.deck {
  position: absolute;
  top: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}

.deck-left {
  left: 20%;
}

.deck-right {
  right: 20%;
}

/* Card */
.card {
  position: absolute;
  left: 0;
  top: 0;
  width: clamp(168px, 16vw, 224px);
  height: clamp(240px, 22.5vw, 320px);
  transform-style: preserve-3d;
  will-change: transform, opacity;
  cursor: pointer;
  pointer-events: auto;
}

.card-inner {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  overflow: hidden;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45),
              inset 0 1px 0 rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  display: flex;
  flex-direction: column;
}

/* Front card: more opaque background for clear readability */
.card.front .card-inner {
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.05)),
              rgba(8, 8, 14, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6),
              0 0 0 1px rgba(255, 255, 255, 0.18),
              inset 0 1px 0 rgba(255, 255, 255, 0.32);
  transition: transform 320ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
              box-shadow 320ms var(--ease-standard, ease),
              border-color 320ms var(--ease-standard, ease),
              background 320ms var(--ease-standard, ease);
}

/* Front card hover: outline + slight scale + more opaque liquid glass */
.card.front:hover .card-inner {
  transform: scale(1.04);
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 36px 90px rgba(0, 0, 0, 0.7),
              0 0 0 2px rgba(255, 255, 255, 0.35),
              0 0 24px rgba(255, 255, 255, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.4);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06)),
              rgba(8, 8, 14, 0.58);
}

/* Cover image area — top 52% of card */
.ci-cover {
  position: relative;
  width: 100%;
  height: 52%;
  overflow: hidden;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.ci-cover-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 40%,
    rgba(10, 10, 16, 0.5) 80%,
    rgba(10, 10, 16, 0.85) 100%
  );
  pointer-events: none;
}

.ci-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 70% at 50% 0%,
    color-mix(in srgb, var(--c) 32%, transparent),
    transparent 55%);
  pointer-events: none;
  z-index: 1;
}

.ci-content {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px 18px 16px;
  min-height: 0;
}

.ci-tag {
  align-self: flex-start;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--c);
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c) 12%, transparent);
  margin-bottom: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.ci-title {
  margin-top: auto;
  font-size: clamp(15px, 1.5vw, 20px);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: rgba(234, 242, 248, 0.95);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ci-sub {
  margin-top: 4px;
  font-size: 11.5px;
  color: rgba(234, 242, 248, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ci-meta {
  margin-top: 8px;
  font-size: 10px;
  color: rgba(234, 242, 248, 0.4);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

// Source-specific meta colors
.ci-meta--local-library,
.ci-meta--local-playlist,
.ci-meta--recent-track {
color: rgba(234, 242, 248, 0.5); // 本地: 浅灰色
.ci-dot { background: rgba(234, 242, 248, 0.5); box-shadow: none; }
}
.ci-meta--netease-playlist {
  color: #E04050; // 网易云红 (调暗, 更易辨认)
  .ci-dot { background: #E04050; box-shadow: 0 0 6px #E04050; }
}
.ci-meta--qq-playlist {
  color: #31C27C; // QQ音乐绿
  .ci-dot { background: #31C27C; box-shadow: 0 0 6px #31C27C; }
}
.ci-meta--fitness-plan {
  color: rgba(234, 242, 248, 0.4); // 训练: 默认灰
}

.ci-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 8px var(--c);
  flex-shrink: 0;
}

.ci-bar {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 12px;
  height: 3px;
  border-radius: 3px;
  background: var(--c);
  box-shadow: 0 0 12px var(--c);
  opacity: 0.8;
  z-index: 2;
}

/* Side labels */
.side-label {
  position: absolute;
  bottom: 64px;
  z-index: 4;
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(234, 242, 248, 0.4);
  pointer-events: none;
}

.side-label-l {
  left: 18%;
  transform: translateX(-50%);
}

.side-label-r {
  right: 18%;
  transform: translateX(50%);
}

/* Engage hint — positioned at top to avoid PlayerBar obstruction */
.engage-hint {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  padding: 8px 20px;
  border-radius: 999px;
  background: rgba(10, 10, 16, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.05em;
  pointer-events: none;
}

// ── Home loading indicator (first launch only) ──
.home-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  z-index: 10;
  pointer-events: none;
}
.home-loading-spinner {
  width: 40px;
  height: 40px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-top-color: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  animation: home-spin 0.8s linear infinite;
}
.home-loading-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.05em;
}
@keyframes home-spin { to { transform: rotate(360deg); } }

// ── Coverflow loading indicator ──
.coverflow-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  z-index: 10;
  pointer-events: none;
}
.coverflow-loading-spinner {
  width: 40px;
  height: 40px;
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-top-color: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  animation: coverflow-spin 0.8s linear infinite;
}
.coverflow-loading-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.05em;
}
@keyframes coverflow-spin { to { transform: rotate(360deg); } }
</style>
