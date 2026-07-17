<template>
  <footer class="player-bar" :class="{ 'is-immersive': isImmersive, 'immersive-visible': immersiveVisible, 'is-visible': isBarVisible }"
    :style="dispersionStyle"
    @mouseenter="onBarEnter" @mouseleave="onBarLeave"
    v-if="musicStore.currentTrack">
    <FrostedGlass
      :corner-radius="24"
      variant="floating"
      :ambient-color="musicStore.currentCoverPalette?.primary"
    />
    <!-- Glass edge chromatic dispersion (red/blue fringe) -->
    <div class="player-bar-dispersion" aria-hidden="true"></div>
    <!-- Content layer -->
    <div class="player-content">
      <div class="player-track-info glass-pressable" ref="trackInfoRef"
        @click="toggleQueuePanel"
        @pointerdown="onTrackInfoPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointerleave="onPointerUp"
        @pointerenter="onPointerEnter">
        <div class="player-cover" @click.stop="onCoverClick" title="点击进入播放页">
          <img v-if="musicStore.currentTrack.coverPath && !coverImgError" :src="musicStore.toCoverUrl(musicStore.currentTrack.coverPath)" class="player-cover-img" @error="onPlayerCoverError" />
          <div class="player-cover-placeholder" v-if="!musicStore.currentTrack.coverPath || coverImgError">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>
          </div>
          <div class="player-cover-overlay">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="player-meta">
          <span class="player-title">{{ musicStore.currentTrack.title }}</span>
          <span class="player-artist">{{ musicStore.currentTrack.artist }}</span>
        </div>
      </div>

      <!-- 播放列表面板 -->
      <Transition name="queue-panel">
        <div v-if="showQueuePanel" class="queue-panel" ref="queuePanelRef" @click.stop>
          <!-- 歌单封面横排分栏 -->
          <div class="playlist-strip">
            <div class="playlist-strip-inner" ref="playlistStripRef"
              @pointerdown="onStripPointerDown" @pointermove="onStripPointerMove" @pointerup="onStripPointerUp" @pointercancel="onStripPointerUp"
              @click.capture="onStripClickGuard">
              <!-- 本地音乐 -->
              <div class="playlist-strip-item" :class="{ active: activePlaylistId === 'local-library' }" @click="switchToLocalLibrary" title="本地音乐">
                <div class="playlist-strip-cover playlist-strip-cover--icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </div>
                <span class="playlist-strip-name">本地</span>
              </div>
              <!-- 本地歌单 -->
              <div
                v-for="pl in playlistStore.playlists"
                :key="pl.id"
                class="playlist-strip-item"
                :class="{ active: activePlaylistId === 'local-' + pl.id }"
                @click="switchToLocalPlaylist(pl.id)"
                :title="pl.name"
              >
                <div class="playlist-strip-cover">
                  <img v-if="pl.coverPath" :src="musicStore.toCoverUrl(pl.coverPath)" @error="($event.target as HTMLImageElement).style.display='none'" />
                  <div v-else class="playlist-strip-cover-placeholder">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h18M3 18h12"/></svg>
                  </div>
                </div>
                <span class="playlist-strip-name">{{ pl.name }}</span>
              </div>
              <!-- 网易云歌单 -->
              <div
                v-for="pl in neteasePlaylists"
                :key="'netease-' + pl.id"
                class="playlist-strip-item"
                :class="{ active: activePlaylistId === 'netease-' + pl.id }"
                @click="switchToNeteasePlaylist(pl.id)"
                :title="pl.name"
              >
                <div class="playlist-strip-cover">
                  <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl + '?param=60x60'" @error="($event.target as HTMLImageElement).style.display='none'" />
                  <div v-else class="playlist-strip-cover-placeholder playlist-strip-cover-placeholder--netease">
                    <span>网</span>
                  </div>
                </div>
                <span class="playlist-strip-name">{{ pl.name }}</span>
              </div>
              <!-- QQ音乐歌单 -->
              <div
                v-for="pl in qqPlaylists"
                :key="'qq-' + pl.id"
                class="playlist-strip-item"
                :class="{ active: activePlaylistId === 'qq-' + pl.id }"
                @click="switchToQqPlaylist(pl.id)"
                :title="pl.name"
              >
                <div class="playlist-strip-cover">
                  <img v-if="pl.coverImgUrl" :src="pl.coverImgUrl" @error="($event.target as HTMLImageElement).style.display='none'" />
                  <div v-else class="playlist-strip-cover-placeholder playlist-strip-cover-placeholder--qq">
                    <span>Q</span>
                  </div>
                </div>
                <span class="playlist-strip-name">{{ pl.name }}</span>
              </div>
            </div>
          </div>

          <!-- 播放列表曲目 -->
          <div class="queue-panel-list">
            <div class="queue-panel-list-header">
              <span class="queue-panel-list-title">{{ activePlaylistName }}</span>
              <span class="queue-panel-list-count" v-if="displayQueue.length">{{ displayQueue.length }} 首</span>
            </div>
            <div
              v-for="(track, idx) in displayQueue"
              :key="track.id"
              class="queue-item"
              :class="{ active: idx === musicStore.currentIndex && activePlaylistId === 'current' }"
              @click="playFromDisplay(idx)"
            >
              <div class="queue-item-cover">
                <img v-if="track.coverPath" :src="musicStore.toCoverUrl(track.coverPath)" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'" />
                <div v-else class="queue-item-cover-placeholder">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/><path d="M9 18V5l10-2v13"/></svg>
                </div>
              </div>
              <div class="queue-item-info">
                <span class="queue-item-title">{{ track.title }}</span>
                <span class="queue-item-artist">{{ track.artist }}</span>
              </div>
              <div class="queue-item-playing" v-if="idx === musicStore.currentIndex && activePlaylistId === 'current'">
                <svg v-if="musicStore.isPlaying" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <span v-if="track.vip" class="queue-item-vip">VIP</span>
            </div>
            <div v-if="displayQueue.length === 0" class="queue-empty">{{ activePlaylistId === 'current' ? '播放列表为空' : '歌单为空' }}</div>
          </div>
        </div>
      </Transition>

      <div class="player-controls">
        <div class="player-buttons">
          <button class="player-btn" @click="musicStore.prevTrack(); sfx.detent()" :disabled="!musicStore.hasPrev">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5L9 12l10 7z"/><path d="M5 5v14"/></svg>
          </button>
          <button class="player-btn player-btn--play glass-pressable" @click="onPlayToggle"
            @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointerleave="onPointerUp"
            @pointerenter="onPointerEnter">
            <svg v-if="!musicStore.isPlaying" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>
            <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          </button>
          <button class="player-btn" @click="musicStore.nextTrack(); sfx.detent()" :disabled="!musicStore.hasNext">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/></svg>
          </button>
        </div>

        <div class="player-progress"
          @click="seekTrack"
          @pointerdown="startDrag"
        >
          <span class="player-time">{{ formatTime(localCurrentTime) }}</span>
          <div class="player-progress-bar" ref="progressBarRef" :class="{ dragging: isDragging }">
            <div class="player-progress-fill" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <span class="player-time player-time--total">{{ formatTime(localDuration) }}</span>
        </div>
      </div>

      <div class="player-extras">
        <!-- Like + Add-to-playlist for netease tracks -->
        <div class="player-track-actions" v-if="neteaseSongId">
          <NeteaseSongActions :song-id="neteaseSongId" />
        </div>
        <button class="player-btn player-mode-btn" @click="musicStore.cyclePlayMode(); sfx.detent()" :title="modeLabel">
          <!-- 顺序播放: 双向箭头 -->
          <svg v-if="musicStore.playMode === 'sequential'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l4 4-4 4"/><path d="M20 7H8a4 4 0 0 0-4 4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h12a4 4 0 0 0 4-4"/></svg>
          <!-- 单曲循环: 复用顺序播放图标 + 数字1 -->
          <svg v-else-if="musicStore.playMode === 'repeat'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l4 4-4 4"/><path d="M20 7H8a4 4 0 0 0-4 4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h12a4 4 0 0 0 4-4"/><text x="12" y="15.5" text-anchor="middle" font-size="7" fill="currentColor" stroke="none" font-weight="700" font-family="Inter, sans-serif">1</text></svg>
          <!-- 随机播放: 交叉箭头 (原创设计) -->
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4l3 3-3 3"/><path d="M21 7h-4c-1.2 0-2 .4-2.8 1.5L7.8 15.5C7 16.6 6.2 17 5 17H3"/><path d="M18 14l3 3-3 3"/><path d="M21 17h-4c-1.2 0-2-.4-2.8-1.5L7.8 8.5C7 7.4 6.2 7 5 7H3"/></svg>
        </button>

        <!-- 网易云音质选择 -->
        <div v-if="isNeteaseTrack" class="quality-selector" ref="qualitySelectorRef">
          <button class="player-btn quality-btn" @click="toggleQualityMenu" :title="`音质: ${currentQualityLabel}`">
            <span class="quality-label">{{ currentQualityShort }}</span>
          </button>
          <transition name="quality-menu">
<div v-if="showQualityMenu" class="quality-menu" @click.stop>
<div class="quality-menu-header">音质选择</div>
              <button
                v-for="opt in qualityOptions"
                :key="opt.value"
                class="quality-menu-item"
                :class="{ active: musicStore.neteaseQuality === opt.value, disabled: qualitySwitching && opt.value === pendingQuality }"
                :disabled="qualitySwitching && opt.value === pendingQuality"
                @click="selectQuality(opt.value)"
              >
                <span class="quality-menu-name">{{ opt.label }}</span>
                <span class="quality-menu-desc">{{ opt.desc }}</span>
                <svg v-if="musicStore.neteaseQuality === opt.value" class="quality-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          </transition>
        </div>
        <!-- QQ音乐音质选择 -->
        <div v-if="isQqTrack" class="quality-selector" ref="qqQualitySelectorRef">
          <button class="player-btn quality-btn" @click="showQqQualityMenu = !showQqQualityMenu" :title="`音质: ${currentQqQualityLabel}`">
            <span class="quality-label">{{ currentQqQualityShort }}</span>
          </button>
          <transition name="quality-menu">
            <div v-if="showQqQualityMenu" class="quality-menu" @click.stop>
              <div class="quality-menu-header">QQ音质</div>
              <button
                v-for="opt in qqQualityOptions"
                :key="opt.value"
                class="quality-menu-item"
                :class="{ active: musicStore.qqQuality === opt.value }"
                @click="selectQqQuality(opt.value)"
              >
                <span class="quality-menu-name">{{ opt.label }}</span>
                <span class="quality-menu-desc">{{ opt.desc }}</span>
                <svg v-if="musicStore.qqQuality === opt.value" class="quality-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          </transition>
        </div>
        <div class="eq-selector" ref="eqSelectorRef">
          <button class="player-btn eq-btn" :class="{ active: eqEnabled }" @click="toggleEqPanel" title="均衡器">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="21" x2="4" y2="14"/>
              <line x1="4" y1="10" x2="4" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12" y2="3"/>
              <line x1="20" y1="21" x2="20" y2="16"/>
              <line x1="20" y1="12" x2="20" y2="3"/>
              <line x1="1" y1="14" x2="7" y2="14"/>
              <line x1="9" y1="8" x2="15" y2="8"/>
              <line x1="17" y1="16" x2="23" y2="16"/>
            </svg>
          </button>
          <EqualizerPanel :visible="showEqPanel" @close="showEqPanel = false" />
        </div>

        <div class="player-volume">
          <button class="player-btn volume-icon-btn" @click="toggleMute" :title="isMuted ? '取消静音' : '静音'">
            <!-- 非静音 -->
            <svg v-if="!isMuted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
            <!-- 静音 -->
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>
          </button>
          <input type="range" class="volume-slider" min="0" max="1" step="0.01"
            :value="musicStore.volume" @input="setVolume" />
        </div>
        <button class="player-btn player-fullscreen-btn" @click="toggleImmersive" :title="isImmersive ? '退出全屏' : '全屏'">
          <svg v-if="!isImmersive" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
        </button>
        <button class="player-btn" :class="{ 'player-btn--active': desktopLyricVisible }" @click="toggleDesktopLyric" title="桌面歌词">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" fill="none"/><path d="M7 10H14M7 13H10"/></svg>
        </button>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/music'
import { usePlaylistStore } from '@/stores/playlist'
import { useEqualizer } from '@/composables/useEqualizer'
import { useGlobalVisualizer, auroraAccentColor } from '@/composables/useGlobalVisualizer'
import { useDesktopLyricSync } from '@/composables/useDesktopLyricSync'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { loadLibraryCached } from '@/modules/music/dataLoaders'
import { cachedFetch, CacheNS, CacheTTL } from '@/modules/music/cache'
import { useNeteaseStatus } from '@/composables/useNeteaseStatus'
import { useNeteaseLikes } from '@/composables/useNeteaseLikes'
import NeteaseSongActions from '@/components/NeteaseSongActions.vue'
import FrostedGlass from '@/components/FrostedGlass.vue'
import EqualizerPanel from '@/components/EqualizerPanel.vue'
import { useSfx } from '@/composables/useSfx'
import type { Track } from '@/types'
import type { NeteasePlaylist } from '@/types/netease.d'
import type { QqPlaylist } from '@/types/qq.d'

const musicStore = useMusicStore()
const playlistStore = usePlaylistStore()
const router = useRouter()

// 鈹€鈹€ Netease like + add-to-playlist (reused from coverflow) 鈹€鈹€
const { loadLikedList } = useNeteaseLikes()

const neteaseSongId = computed(() => {
  const track = musicStore.currentTrack
  if (!track || track.source !== 'netease') return null
  if (track.sourceId) {
    const id = Number(track.sourceId)
    if (!isNaN(id)) return id
  }
  if (track.id?.startsWith('ne_')) {
    const id = Number(track.id.slice(3))
    if (!isNaN(id)) return id
  }
  return null
})

// Load liked list when a netease track is playing so the heart state is correct.
// loadLikedList() checks login status internally, so no need for neteaseLoggedIn here.
watch(() => musicStore.currentTrack?.source, (source) => {
  if (source === 'netease') {
    loadLikedList()
  }
}, { immediate: true })
const toast = useGlobalToast()
const sfx = useSfx()

// ===== Glass edge chromatic dispersion — real-time ambient color =====
// Reads the aurora accent color (updated every frame by threeScene) and
// uses it directly as the single edge tint — no warm/cool split, just the
// most prominent ambient color refracting through the glass edge.
const dispersionStyle = ref<Record<string, string>>({
  '--disp-color': 'rgba(126, 200, 227, 0.35)',
})

let dispRafId = 0
function updateDispersionColors() {
  // auroraAccentColor is {r,g,b} in 0-1 range, updated every frame by threeScene
  const ar = Math.round(auroraAccentColor.r * 255)
  const ag = Math.round(auroraAccentColor.g * 255)
  const ab = Math.round(auroraAccentColor.b * 255)

  dispersionStyle.value = {
    '--disp-color': `rgba(${ar},${ag},${ab},0.35)`,
  }

  dispRafId = requestAnimationFrame(updateDispersionColors)
}

// ===== PlayerBar 自动隐藏/显示 =====
// PlayerBar 默认隐藏, 仅当鼠标移动到底部区域或 PlayerBar 本身时显示
// 使用 window mousemove 监听, 不创建额外 DOM 元素, 避免阻塞其他元素的点击
const isBarVisible = ref(false)
let barHideTimer: ReturnType<typeof setTimeout> | null = null
const BAR_HIDE_DELAY = 600 // ms — 鼠标离开后延迟隐藏
const BAR_TRIGGER_HEIGHT = 100 // px — 底部触发区域高度
let isBarHovered = false // 鼠标是否在 PlayerBar 上方

function onBarMouseMove(e: MouseEvent) {
  if (isImmersive.value) return
  const vh = window.innerHeight
  // 鼠标在底部触发区域或在 PlayerBar 上方时显示
  if (e.clientY > vh - BAR_TRIGGER_HEIGHT || isBarHovered) {
    showBar()
  } else {
    scheduleHideBar()
  }
}

function onBarEnter() {
  if (isImmersive.value) return
  isBarHovered = true
  showBar()
}

function onBarLeave() {
  if (isImmersive.value) return
  isBarHovered = false
  scheduleHideBar()
}

function showBar() {
  if (barHideTimer) {
    clearTimeout(barHideTimer)
    barHideTimer = null
  }
  isBarVisible.value = true
}

function scheduleHideBar() {
  if (barHideTimer) clearTimeout(barHideTimer)
  barHideTimer = setTimeout(() => {
    if (!isBarHovered) {
      isBarVisible.value = false
      // 关闭队列面板
      showQueuePanel.value = false
    }
    barHideTimer = null
  }, BAR_HIDE_DELAY)
}

// ===== Local playback progress (isolated from global Pinia) =====
// The store's currentTime/duration are updated every 200ms, which would
// cause this entire 45KB component to re-render on every tick. Instead,
// we poll the Howl directly via non-reactive getters and keep the values
// in local refs that only this component (and its template) depends on.
const localCurrentTime = ref(0)
const localDuration = ref(0)
let progressTimer: ReturnType<typeof setInterval> | null = null

function startProgressPolling() {
  if (progressTimer) return
  progressTimer = setInterval(() => {
    localCurrentTime.value = musicStore.getPlaybackPosition()
    localDuration.value = musicStore.getPlaybackDuration()
  }, 200)
}

function stopProgressPolling() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

// Sync local refs immediately on track change so the progress bar doesn't
// show stale values from the previous track.
watch(() => musicStore.currentTrack?.id, () => {
  localCurrentTime.value = musicStore.getPlaybackPosition()
  localDuration.value = musicStore.getPlaybackDuration()
})

// ===== Cover image error handling =====
const coverImgError = ref(false)
function onPlayerCoverError() {
  coverImgError.value = true
}
// Reset error state when track changes so the new cover gets a fresh attempt
watch(() => musicStore.currentTrack?.id, () => {
  coverImgError.value = false
})

// ===== Queue Panel (播放列表面板) =====
const showQueuePanel = ref(false)
const queuePanelRef = ref<HTMLElement | null>(null)
const trackInfoRef = ref<HTMLElement | null>(null)

function toggleQueuePanel() {
  showQueuePanel.value = !showQueuePanel.value
  if (showQueuePanel.value) sfx.airBloom()
  else sfx.retract()
}


function onPlayToggle() {
  musicStore.togglePlay()
  if (musicStore.isPlaying) sfx.confirm()
  else sfx.detent()
}

// ===== Playlist Strip (歌单封面横排分栏) =====
const { isLoggedIn: neteaseLoggedIn, userInfo: neteaseUserInfo, checkLoginStatus: checkNetease } = useNeteaseStatus()
const activePlaylistId = ref<string>('current')
const activePlaylistName = ref('当前播放列表')
const displayQueue = shallowRef<Track[]>([])
const neteasePlaylists = shallowRef<NeteasePlaylist[]>([])
const qqPlaylists = shallowRef<QqPlaylist[]>([])

// 歌单横排拖拽滚动
const playlistStripRef = ref<HTMLElement | null>(null)
let stripDragging = false
let stripStartX = 0
let stripStartScroll = 0
let stripMoved = false
function onStripPointerDown(e: PointerEvent) {
  const el = playlistStripRef.value
  if (!el) return
  stripDragging = true
  stripMoved = false
  stripStartX = e.clientX
  stripStartScroll = el.scrollLeft
  el.style.cursor = 'grabbing'
}
function onStripPointerMove(e: PointerEvent) {
  if (!stripDragging) return
  const el = playlistStripRef.value
  if (!el) return
  const dx = e.clientX - stripStartX
  if (Math.abs(dx) > 3) stripMoved = true
  el.scrollLeft = stripStartScroll - dx
}
function onStripPointerUp() {
  if (!stripDragging) return
  stripDragging = false
  const el = playlistStripRef.value
  if (el) el.style.cursor = ''
  if (stripMoved) {
    setTimeout(() => { stripMoved = false }, 0)
  }
}
function onStripClickGuard(e: Event) {
  if (stripMoved) {
    e.stopPropagation()
    e.preventDefault()
    stripMoved = false
  }
}

// displayQueue 跟随当前播放队列 (默认状态)
watch(() => [musicStore.queue, activePlaylistId.value], () => {
  if (activePlaylistId.value === 'current') {
    displayQueue.value = musicStore.queue
    activePlaylistName.value = '当前播放列表'
  }
}, { immediate: true })

function playFromDisplay(idx: number) {
  sfx.confirm()
  if (activePlaylistId.value === 'current') {
    musicStore.playIndex(idx)
  } else {
    // 非当前歌单: 设置为播放队列并播放, 自动切换到"当前"
    const tracks = displayQueue.value
    if (tracks.length > 0) {
      musicStore.setQueue(tracks, idx)
      musicStore.playIndex(idx)
      activePlaylistId.value = 'current'
      activePlaylistName.value = '当前播放列表'
      displayQueue.value = musicStore.queue
    }
  }
}

// ── Track conversion (与 DualDeckHome 一致, 包含封面 URL) ──
function toNeteaseTrack(t: any): Track {
  return {
    id: `ne_${t.id}`,
    title: t.name,
    artist: t.ar?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
    album: t.al?.name || 'Unknown Album',
    duration: (t.dt || 0) / 1000,
    coverPath: t.al?.picUrl,
    source: 'netease' as const,
    sourceId: String(t.id),
    localPath: '',
    addedAt: new Date().toISOString()
  }
}

function toQqTrack(t: any): Track {
  const coverUrl = t.album?.mid
    ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${t.album.mid}.jpg`
    : undefined
  return {
    id: `qq_${t.songmid}`,
    title: t.name,
    artist: t.singer?.map((s: any) => s.name).join(', ') || 'Unknown Artist',
    album: t.album?.name || 'Unknown Album',
    duration: t.interval || 0,
    coverPath: coverUrl,
    source: 'qq' as const,
    sourceId: t.songmid,
    sourceMediaMid: t.strMediaMid || t.songmid,
    localPath: '',
    addedAt: new Date().toISOString(),
    vip: t.pay?.payplay === 1,
  }
}

async function switchToLocalLibrary() {
  sfx.detent()
  activePlaylistId.value = 'local-library'
  activePlaylistName.value = '本地音乐'
  try {
    const tracks = await loadLibraryCached()
    displayQueue.value = (tracks || []).map((t: any) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      coverPath: t.cover_path || t.coverPath,
      source: t.source || 'local',
      sourceId: t.source_id || t.sourceId,
      localPath: t.local_path || t.localPath,
      lyricsPath: t.lyrics_path || t.lyricsPath,
      addedAt: t.added_at || t.addedAt,
      lastPlayedAt: t.last_played_at || t.lastPlayedAt,
    })) as Track[]
  } catch { displayQueue.value = [] }
}

async function switchToLocalPlaylist(playlistId: string) {
  sfx.detent()
  activePlaylistId.value = 'local-' + playlistId
  const pl = playlistStore.playlists.find(p => p.id === playlistId)
  activePlaylistName.value = pl?.name || '歌单'
  await playlistStore.loadPlaylistDetail(playlistId)
  displayQueue.value = [...playlistStore.currentTracks]
}

async function switchToNeteasePlaylist(playlistId: number) {
  sfx.detent()
  activePlaylistId.value = 'netease-' + playlistId
  const pl = neteasePlaylists.value.find(p => p.id === playlistId)
  activePlaylistName.value = pl?.name || '网易云歌单'
  try {
    // ★ 使用 cachedFetch + CacheNS (与 DualDeckHome 一致, 避免重复网络请求)
    const tracks = await cachedFetch(
      CacheNS.NeteasePlaylistDetail,
      String(playlistId),
      async () => {
        const res = await window.electronAPI!.netease.getPlaylistDetail(playlistId)
        if (!res?.success || !res.data) return []
        return res.data.tracks || []
      },
      { ttlMs: CacheTTL.PLAYLIST_DETAIL }
    )
    displayQueue.value = tracks.map(toNeteaseTrack)
  } catch { displayQueue.value = [] }
}

async function switchToQqPlaylist(playlistId: string) {
  sfx.detent()
  activePlaylistId.value = 'qq-' + playlistId
  const pl = qqPlaylists.value.find(p => p.id === playlistId)
  activePlaylistName.value = pl?.name || 'QQ音乐歌单'
  try {
    // ★ 使用 cachedFetch + CacheNS (与 DualDeckHome 一致)
    const tracks = await cachedFetch(
      CacheNS.QqPlaylistDetail,
      String(playlistId),
      async () => {
        const res = await window.electronAPI!.qq.getPlaylistDetail(playlistId)
        if (!res?.success || !res.data) return []
        return res.data.tracks || []
      },
      { ttlMs: CacheTTL.PLAYLIST_DETAIL }
    )
    displayQueue.value = tracks.map(toQqTrack)
  } catch { displayQueue.value = [] }
}

// 面板打开时预加载歌单列表 (复用 useNeteaseStatus + cachedFetch)
watch(showQueuePanel, async (visible) => {
  if (!visible) return
  // 加载本地歌单列表 — don't force reload to avoid reactivity churn during transition
  try { await playlistStore.loadPlaylists(false) } catch { /* ignore */ }
  // 加载网易云歌单 — 复用 useNeteaseStatus 获取 uid
  try {
    await checkNetease()
    if (neteaseLoggedIn.value && neteaseUserInfo.value?.userId) {
      const uid = neteaseUserInfo.value.userId
      const list = await cachedFetch(
        CacheNS.NeteasePlaylists,
        String(uid),
        async () => {
          const res = await window.electronAPI!.netease.getUserPlaylists(uid)
          if (!res?.success || !res.data) return []
          return res.data.playlists || []
        },
        { ttlMs: CacheTTL.PLAYLISTS }
      )
      neteasePlaylists.value = list
    }
  } catch { /* ignore */ }
  // 加载QQ音乐歌单
  try {
    const list = await cachedFetch(
      CacheNS.QqPlaylists,
      'default',
      async () => {
        const res = await window.electronAPI!.qq.getUserPlaylists()
        if (!res?.success || !res.data) return []
        return res.data.playlists || []
      },
      { ttlMs: CacheTTL.PLAYLISTS }
    )
    qqPlaylists.value = list
  } catch { /* ignore */ }
})

// 封面点击 — 跳转到播放页
function onCoverClick() {
  router.push('/player')
}

// track-info 的 pointerdown 处理 — 跳过封面区域, 避免 setPointerCapture 干扰封面点击
function onTrackInfoPointerDown(e: PointerEvent) {
  // 如果点击的是封面区域, 不启动 glass-pressable 的 pointer capture
  if ((e.target as HTMLElement).closest('.player-cover')) {
    return
  }
  onPointerDown(e)
}

// ===== Desktop Lyric =====
const { lyricLines } = useGlobalVisualizer()
const { isVisible: desktopLyricVisible, toggle: _toggleDesktopLyric } = useDesktopLyricSync(lyricLines)
function toggleDesktopLyric() {
  _toggleDesktopLyric()
  sfx.confirm()
}

// ===== Equalizer =====
const { eqEnabled } = useEqualizer()
const showEqPanel = ref(false)
const eqSelectorRef = ref<HTMLElement | null>(null)

function toggleEqPanel() {
  showEqPanel.value = !showEqPanel.value
  if (showEqPanel.value) sfx.airBloom()
  else sfx.retract()
}

// ===== Netease Quality Selector =====
const isNeteaseTrack = computed(() => musicStore.currentTrack?.source === 'netease')
const showQualityMenu = ref(false)
const qualitySelectorRef = ref<HTMLElement | null>(null)

// ===== QQ Music Quality Selector =====
const isQqTrack = computed(() => musicStore.currentTrack?.source === 'qq')
const showQqQualityMenu = ref(false)
const qqQualitySelectorRef = ref<HTMLElement | null>(null)

const qqQualityOptions = [
  { value: '128' as const, label: '标准', desc: '128kbps MP3', short: '128' },
  { value: '320' as const, label: '高品质', desc: '320kbps MP3', short: '320' },
  { value: 'flac' as const, label: '无损', desc: 'FLAC 需VIP', short: 'SQ' },
]

const currentQqQualityLabel = computed(() => {
  const opt = qqQualityOptions.find(o => o.value === musicStore.qqQuality)
  return opt ? opt.label : '高品质'
})

const currentQqQualityShort = computed(() => {
  const opt = qqQualityOptions.find(o => o.value === musicStore.qqQuality)
  return opt ? opt.short : '320'
})

function selectQqQuality(quality: typeof qqQualityOptions[number]['value']) {
  sfx.detent()
  musicStore.setQqQuality(quality)
  showQqQualityMenu.value = false
  // If a QQ track is currently playing, reload it with the new quality
  if (musicStore.currentTrack?.source === 'qq' && musicStore.isPlaying) {
    musicStore.playTrack(musicStore.currentTrack)
  }
}

const qualityOptions = [
  { value: 'standard' as const, label: '标准', desc: '128kbps MP3', short: '标' },
  { value: 'higher' as const, label: '较高', desc: '192kbps MP3', short: '192' },
  { value: 'exhigh' as const, label: '极高', desc: '320kbps MP3', short: '320' },
  { value: 'lossless' as const, label: '无损', desc: 'FLAC 需VIP', short: 'SQ' },
  { value: 'hires' as const, label: 'Hi-Res', desc: '高清臻音 需VIP', short: 'HR' },
]

const currentQualityLabel = computed(() => {
  const opt = qualityOptions.find(o => o.value === musicStore.neteaseQuality)
  return opt ? opt.label : '极高'
})

const currentQualityShort = computed(() => {
  const opt = qualityOptions.find(o => o.value === musicStore.neteaseQuality)
  return opt ? opt.short : '320'
})

function toggleQualityMenu() {
showQualityMenu.value = !showQualityMenu.value
if (showQualityMenu.value) sfx.airBloom()
else sfx.retract()
musicStore.clearQualitySwitchError()
}

const qualitySwitching = ref(false)
const pendingQuality = ref<string | null>(null)

async function selectQuality(quality: typeof qualityOptions[number]['value']) {
sfx.detent()
if (qualitySwitching.value) return
qualitySwitching.value = true
pendingQuality.value = quality
// Keep menu open so user sees loading state and can see which quality
// remains selected after an error
showQualityMenu.value = true

const result = await musicStore.trySwitchQuality(quality)
qualitySwitching.value = false
pendingQuality.value = null

if (!result.ok) {
// Use global toast for VIP/quality errors
toast.warning(result.error)
} else {
// Success — close the menu
showQualityMenu.value = false
}
}

// Close menus on outside click
function onGlobalClick(e: MouseEvent) {
  // 播放列表面板: 点击面板外且点击不在 track-info 切换按钮上时关闭
  // (track-info 的 @click 会自行 toggle, 这里不重复处理)
  if (showQueuePanel.value && queuePanelRef.value && trackInfoRef.value) {
    if (!queuePanelRef.value.contains(e.target as Node) &&
        !trackInfoRef.value.contains(e.target as Node)) {
      showQueuePanel.value = false
    }
  }
  if (showQualityMenu.value && qualitySelectorRef.value) {
    if (!qualitySelectorRef.value.contains(e.target as Node)) {
      showQualityMenu.value = false
    }
  }
  if (showQqQualityMenu.value && qqQualitySelectorRef.value) {
    if (!qqQualitySelectorRef.value.contains(e.target as Node)) {
      showQqQualityMenu.value = false
    }
  }
  if (showEqPanel.value && eqSelectorRef.value) {
    if (!eqSelectorRef.value.contains(e.target as Node)) {
      showEqPanel.value = false
    }
  }
}

const progressPercent = computed(() => {
  if (localDuration.value <= 0) return 0
  return (localCurrentTime.value / localDuration.value) * 100
})

const modeLabel = computed(() => {
  const labels = { sequential: '顺序播放', repeat: '单曲循环', shuffle: '随机播放' }
  return labels[musicStore.playMode]
})

// ===== Volume / Mute =====
const isMuted = computed(() => musicStore.volume === 0)
const previousVolume = ref(0.7)

function toggleMute() {
  sfx.detent()
  if (musicStore.volume > 0) {
    previousVolume.value = musicStore.volume
    musicStore.setVolume(0)
  } else {
    musicStore.setVolume(previousVolume.value || 0.7)
  }
}

// ===== Apple Liquid Glass Button Interactions =====
// WWDC 2025 "Liquid Glass" design language:
//   • Resting: completely transparent — no glass visible
//   • Hover: glass materialises with high-clarity blur, subtle lift
//   • Active (press): spring-down scale + intensity boost (haptic feel)
//   • Long-press (500ms): LOCAL water-droplet effect at press point —
//     the glass frame intensifies (brighter, higher blur) and a local
//     droplet depression + ripple appears at the exact press position.
//     The element itself does NOT transform. Content (SVG/text/img)
//     stays completely untransformed. NO global oval/squash deformation.
//   • Release: spring-back with slight overshoot (bouncy, organic)
//
// Architecture: glass surface on ::before (visual property changes only,
// no shape change), local droplet + ripple on ::after, content children
// at z-index:1 (never transform). All state driven by CSS custom properties.

interface PressableState {
  isHovering: boolean
  isPressing: boolean
  isLongPress: boolean
  pressX: number  // 0-1 position within element where press started
  pressY: number
}

const pressableStates = new WeakMap<HTMLElement, PressableState>()
const longPressTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

function getPressableState(el: HTMLElement): PressableState {
  let s = pressableStates.get(el)
  if (!s) {
    s = { isHovering: false, isPressing: false, isLongPress: false, pressX: 0.5, pressY: 0.5 }
    pressableStates.set(el, s)
  }
  return s
}

function applyPressableStyle(el: HTMLElement) {
  const s = getPressableState(el)
  el.style.setProperty('--gp-hover', s.isHovering ? '1' : '0')
  el.style.setProperty('--gp-press', s.isPressing ? '1' : '0')
  el.style.setProperty('--gp-longpress', s.isLongPress ? '1' : '0')
  // Press position for local droplet effect (0-1 range)
  el.style.setProperty('--gp-press-x', `${s.pressX}`)
  el.style.setProperty('--gp-press-y', `${s.pressY}`)
}

function onPointerEnter(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const s = getPressableState(el)
  s.isHovering = true
  applyPressableStyle(el)
}

function onPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const s = getPressableState(el)
  s.isPressing = true
  s.isHovering = true
  // Record press position within the element (0-1)
  const rect = el.getBoundingClientRect()
  s.pressX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  s.pressY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  applyPressableStyle(el)
  // Start long-press timer
  const timer = setTimeout(() => {
    const st = getPressableState(el)
    st.isLongPress = true
    applyPressableStyle(el)
  }, 500)
  longPressTimers.set(el, timer)
}

function onPointerMove(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (!el.hasPointerCapture(e.pointerId)) return
  const s = getPressableState(el)
  // Update press position for local droplet effect
  const rect = el.getBoundingClientRect()
  s.pressX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  s.pressY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  applyPressableStyle(el)
}

function onPointerUp(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) {
    el.releasePointerCapture(e.pointerId)
  }
  // Clear long-press timer
  const timer = longPressTimers.get(el)
  if (timer) {
    clearTimeout(timer)
    longPressTimers.delete(el)
  }
  const s = getPressableState(el)
  s.isPressing = false
  s.isLongPress = false
  applyPressableStyle(el)
  // Delay removing hover state slightly for a graceful exit
  setTimeout(() => {
    const st = getPressableState(el)
    if (!st.isPressing) {
      st.isHovering = false
      applyPressableStyle(el)
    }
  }, 50)
}

// ===== Fullscreen + Immersive Mode =====
// Clicking the fullscreen button:
// 1st click: Save current window bounds → enter OS fullscreen → enter immersive mode
//            (immediately hides all UI components for clean immersive view)
// 2nd click: Exit OS fullscreen → restore saved window bounds exactly → exit immersive mode
// Mouse movement reveals the hidden UI; 2s of inactivity hides it again.
const isImmersive = ref(false)
const immersiveVisible = ref(false)
let immersiveHideTimer: ReturnType<typeof setTimeout> | null = null

// Saved window bounds for restoration on immersive-exit
let savedWindowBounds: { x: number; y: number; width: number; height: number } | null = null
let wasMaximizedBeforeImmersive = false

async function toggleImmersive() {
  sfx.confirm()
  if (!isImmersive.value) {
    // ===== Entering immersive mode =====
    // 1. Save the current window bounds so we can restore them exactly
    try {
      if (window.electronAPI?.window?.getBounds) {
        const result = await window.electronAPI.window.getBounds()
        savedWindowBounds = result.bounds
      }
    } catch (e) {
      console.warn('[PlayerBar] Failed to get window bounds:', e)
    }

    // 2. Check if window is maximized — we'll need to restore that state too
    try {
      if (window.electronAPI?.window?.isMaximized) {
        const result = await window.electronAPI.window.isMaximized()
        wasMaximizedBeforeImmersive = result.isMaximized
      }
    } catch (e) {
      console.warn('[PlayerBar] Failed to check if window is maximized:', e)
    }

    // 3. If the window is maximized, unmaximize first so we capture the
    //    user's actual custom window size (not the maximized dimensions)
    if (wasMaximizedBeforeImmersive) {
      try {
        await window.electronAPI?.window?.unmaximize()
        // Re-read bounds after unmaximizing to get the true windowed size
        if (window.electronAPI?.window?.getBounds) {
          const result = await window.electronAPI.window.getBounds()
          savedWindowBounds = result.bounds
        }
      } catch (e) {
        console.warn('[PlayerBar] Failed to unmaximize/get bounds:', e)
      }
    }

    // 4. Enter OS fullscreen
    if (window.electronAPI?.window?.toggleFullScreen) {
      await window.electronAPI.window.toggleFullScreen()
    }

    // 5. Enter immersive mode — immediately hide ALL UI for clean view
    isImmersive.value = true
    immersiveVisible.value = false
    // Reset the regular bar-visibility system so it doesn't conflict
    // with immersive mode's own show/hide logic.
    isBarVisible.value = false
    isBarHovered = false
    if (barHideTimer) { clearTimeout(barHideTimer); barHideTimer = null }
    document.body.classList.add('immersive-mode')
    document.body.classList.remove('immersive-visible')
    attachImmersiveListeners()
    toast.info('已进入全屏模式，按 Esc 退出')
  } else {
    // ===== Exiting immersive mode =====
    // Set fullscreen-transition guard so App.vue's onMaximizeChange
    // ignores spurious maximize events that fire during OS-fullscreen
    // exit on Windows (which would re-add is-maximized and cause sharp
    // corners even though the window isn't truly maximized).
    ;(window as any).__fullscreenTransition = true

    // 1. Exit OS fullscreen
    if (window.electronAPI?.window?.toggleFullScreen) {
      await window.electronAPI.window.toggleFullScreen()
    }

    // 2. Immediately remove is-fullscreen — don't wait for the async
    //    leave-full-screen IPC event, which may arrive late on Windows.
    document.body.classList.remove('is-fullscreen')

    // 3. Restore the exact window bounds the user had before immersive.
    //    Use a longer delay (500ms) to let the OS fullscreen exit fully
    //    settle on Windows, where leave-full-screen + spurious maximize
    //    events can fire well after 150ms.
    if (savedWindowBounds) {
      setTimeout(async () => {
        try {
          if (window.electronAPI?.window?.setBounds) {
            await window.electronAPI.window.setBounds({
              x: savedWindowBounds!.x,
              y: savedWindowBounds!.y,
              width: savedWindowBounds!.width,
              height: savedWindowBounds!.height,
            })
          }
        } catch (e) {
          console.warn('[PlayerBar] Failed to restore window bounds:', e)
        }
        // Force-remove BOTH classes — the window is definitely not
        // maximized or fullscreen at this point.
        document.body.classList.remove('is-maximized')
        document.body.classList.remove('is-fullscreen')
        // Clear the transition guard after all events have settled
        ;(window as any).__fullscreenTransition = false
        savedWindowBounds = null
      }, 500)
    } else {
      // No saved bounds — still ensure rounded corners
      document.body.classList.remove('is-maximized')
      document.body.classList.remove('is-fullscreen')
      ;(window as any).__fullscreenTransition = false
    }

    // 4. Exit immersive mode — bar should be immediately visible
    isImmersive.value = false
    immersiveVisible.value = false
    document.body.classList.remove('immersive-mode')
    document.body.classList.remove('immersive-visible')
    detachImmersiveListeners()
    showBar()
  }
}

function onImmersiveMouseMove() {
  if (!isImmersive.value) return
  immersiveVisible.value = true
  document.body.classList.add('immersive-visible')
  if (immersiveHideTimer) clearTimeout(immersiveHideTimer)
  immersiveHideTimer = setTimeout(() => {
    immersiveVisible.value = false
    document.body.classList.remove('immersive-visible')
  }, 2000)
}

function onEscKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && isImmersive.value) {
    e.preventDefault()
    toggleImmersive()
  }
}

function attachImmersiveListeners() {
  window.addEventListener('mousemove', onImmersiveMouseMove)
  window.addEventListener('keydown', onEscKey)
}

function detachImmersiveListeners() {
  window.removeEventListener('mousemove', onImmersiveMouseMove)
  window.removeEventListener('keydown', onEscKey)
  if (immersiveHideTimer) {
    clearTimeout(immersiveHideTimer)
    immersiveHideTimer = null
  }
}

// Listen for native fullscreen changes (e.g. user presses Esc to exit)
function onFullscreenChange(isFullScreen: boolean) {
  if (!isFullScreen && isImmersive.value) {
    // Set transition guard before restoring bounds
    ;(window as any).__fullscreenTransition = true

    // User exited fullscreen natively (Esc key) — also exit immersive mode
    isImmersive.value = false
    immersiveVisible.value = false
    document.body.classList.remove('immersive-mode')
    document.body.classList.remove('immersive-visible')
    document.body.classList.remove('is-fullscreen')
    detachImmersiveListeners()
    showBar()

    // Restore saved bounds if available
    if (savedWindowBounds) {
      setTimeout(async () => {
        try {
          if (window.electronAPI?.window?.setBounds) {
            await window.electronAPI.window.setBounds({
              x: savedWindowBounds!.x,
              y: savedWindowBounds!.y,
              width: savedWindowBounds!.width,
              height: savedWindowBounds!.height,
            })
          }
        } catch (e) {
          console.warn('[PlayerBar] Failed to restore window bounds:', e)
        }
        // Force-remove BOTH classes — the window is definitely not
        // maximized or fullscreen at this point.
        document.body.classList.remove('is-maximized')
        document.body.classList.remove('is-fullscreen')
        ;(window as any).__fullscreenTransition = false
        savedWindowBounds = null
      }, 500)
    } else {
      document.body.classList.remove('is-maximized')
      document.body.classList.remove('is-fullscreen')
      ;(window as any).__fullscreenTransition = false
    }
  } else if (isFullScreen) {
    document.body.classList.add('is-fullscreen')
  } else {
    // Non-immersive fullscreen exit (e.g. button click path) —
    // remove both classes to ensure rounded corners are restored.
    document.body.classList.remove('is-fullscreen')
    document.body.classList.remove('is-maximized')
  }
}

onMounted(() => {
  // Ensure clean state on mount
  document.body.classList.remove('immersive-mode')
  document.body.classList.remove('is-fullscreen')
  // Start local progress polling
  localCurrentTime.value = musicStore.getPlaybackPosition()
  localDuration.value = musicStore.getPlaybackDuration()
  startProgressPolling()
  // PlayerBar auto-hide: listen for mouse movement near bottom of screen
  window.addEventListener('mousemove', onBarMouseMove)
  // Listen for native fullscreen changes from main process
  window.electronAPI?.on?.('window:fullscreenChange', onFullscreenChange)
  // Listen for global media key events from main process
  window.electronAPI?.on?.('media:togglePlay', () => musicStore.togglePlay())
  window.electronAPI?.on?.('media:nextTrack', () => musicStore.nextTrack())
  window.electronAPI?.on?.('media:prevTrack', () => musicStore.prevTrack())
  window.electronAPI?.on?.('media:stop', () => musicStore.stopAudio())
  window.electronAPI?.on?.('media:volumeUp', () => musicStore.setVolume(musicStore.volume + 0.05))
  window.electronAPI?.on?.('media:volumeDown', () => musicStore.setVolume(musicStore.volume - 0.05))
  window.electronAPI?.on?.('media:toggleMute', () => toggleMute())
  // Close menus on global click
  document.addEventListener('click', onGlobalClick)
  // Start real-time dispersion color tracking (reads aurora accent color every frame)
  updateDispersionColors()
})

onUnmounted(() => {
  detachImmersiveListeners()
  stopProgressPolling()
  // Clean up PlayerBar auto-hide listener
  window.removeEventListener('mousemove', onBarMouseMove)
  if (barHideTimer) {
    clearTimeout(barHideTimer)
    barHideTimer = null
  }
  document.body.classList.remove('immersive-mode')
  document.body.classList.remove('is-fullscreen')
  // Remove fullscreen listener
  window.electronAPI?.removeListener?.('window:fullscreenChange', onFullscreenChange)
  // Clean up drag listeners
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  // Clean up menu click listener
  document.removeEventListener('click', onGlobalClick)
  // Stop dispersion rAF
  if (dispRafId) cancelAnimationFrame(dispRafId)
})

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ===== Progress bar drag-to-seek =====
const isDragging = ref(false)
const progressBarRef = ref<HTMLElement | null>(null)

function seekFromClientX(clientX: number) {
  const bar = progressBarRef.value
  if (!bar) return
  const rect = bar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const seekTime = pct * localDuration.value
  musicStore.seekTo(seekTime)
  // Update local ref immediately for responsive visual feedback
  localCurrentTime.value = seekTime
}

function seekTrack(e: MouseEvent) {
  // Only handle plain left-clicks; pointerdown handles drag
  if (e.button !== 0) return
  seekFromClientX(e.clientX)
}

function startDrag(e: PointerEvent) {
  // Only start drag on primary button (left mouse / touch / pen)
  if (e.button !== 0 && e.pointerType === 'mouse') return
  isDragging.value = true
  // Seek immediately to where the user clicked
  seekFromClientX(e.clientX)
  // Attach global listeners so dragging works even outside the bar
  document.addEventListener('pointermove', onDragMove)
  document.addEventListener('pointerup', onDragEnd)
  // Capture pointer so we keep receiving events even if finger leaves the element
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  // Prevent text selection while dragging
  e.preventDefault()
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  seekFromClientX(e.clientX)
}

function onDragEnd() {
  isDragging.value = false
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', onDragEnd)
}

function setVolume(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  musicStore.setVolume(val)
}

// ===== Tray state sync =====
// Send playback state to main process so the tray menu can update.
watch(() => musicStore.isPlaying, (playing) => {
  window.electronAPI?.send?.('tray:updatePlayState', playing)
})
</script>

<style lang="scss" scoped>
.player-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  width: calc(100vw - 48px);
  max-width: 1400px;
  height: var(--player-bar-height);
  display: flex;
  align-items: center;
  padding: 0 28px;
  gap: var(--space-lg);
  z-index: var(--z-sticky);
  overflow: visible;
  border-radius: 24px;
  transform: translateX(-50%);
  // 默认隐藏 — 仅当 is-visible 类添加时显示
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 400ms var(--ease-out-quint),
              visibility 0s linear 400ms,
              transform 400ms var(--ease-out-quint);

  // 显示状态
  &.is-visible {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateX(-50%) translateY(0);
    transition: opacity 300ms var(--ease-spring),
                visibility 0s linear 0s,
                transform 300ms var(--ease-spring);
  }

  // Immersive mode: slide down + hide when not hovered
  &.is-immersive {
    opacity: 0;
    visibility: hidden;
    transform: translateX(-50%) translateY(calc(100% + 40px));
    pointer-events: none;
    transition: opacity 400ms var(--ease-standard),
                visibility 0s linear 400ms,
                transform 400ms var(--ease-standard);

    &.immersive-visible {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
      transition: opacity 300ms var(--ease-spring),
                  visibility 0s linear 0s,
                  transform 400ms var(--ease-spring);
    }
  }
}

// (PlayerBar trigger zone removed — using window mousemove listener instead)

// Override FrostedGlass floating variant — no blur, pure transparency
// backdrop-filter causes a two-stage render flash (transparent → blurred).
// The player bar uses only subtle background tints + dispersion edge instead.
.player-bar :deep(.frosted-glass--floating) {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  will-change: auto;

  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 30%),
    linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.05) 100%),
    radial-gradient(ellipse 130% 90% at 30% 20%, var(--fg-ambient-soft, transparent), transparent 60%),
    rgba(255, 255, 255, 0.02);

  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 0 0 1px rgba(255, 255, 255, 0.03),
    inset 0 -1px 0 rgba(0, 0, 0, 0.05),
    0 8px 40px rgba(0, 0, 0, 0.12);
}

// ── Glass edge ambient tint (minimal) ──
// A thin edge line tinted with the real-time ambient color (aurora accent).
// No warm/cool split — just the single most prominent surrounding color,
// visible only as a subtle hairline at the glass border.
// The inner glow uses inset box-shadow which naturally follows border-radius
// around the entire perimeter (including rounded corners).
.player-bar-dispersion {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  border-radius: inherit;

  // Thin tinted edge ring + uniform inner glow following entire border
  box-shadow:
    inset 0 0 0 1px var(--disp-color, rgba(126, 200, 227, 0.35)),
    inset 0 0 14px var(--disp-color, rgba(126, 200, 227, 0.08));
}

.player-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  height: 100%;
  /* 确保文字和图标在毛玻璃背景之上保持锐利 */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

// ===== Apple Liquid Glass Pressable System (WWDC 2025) =====
// All clickable elements share this base class.
//
// Architecture:
//   ::before — glass surface layer (background, backdrop-filter, box-shadow)
//              Changes VISUAL PROPERTIES only — never changes shape.
//   ::after  — long-press local water-droplet effect (radial gradient +
//              expanding ripple at the exact press position).
//   content  — sits on top (z-index: 1), NEVER transforms.
//
// State variables (set via JS):
//   --gp-hover:      0 → 1   on pointer enter
//   --gp-press:      0 → 1   on pointer down
//   --gp-longpress:  0 → 1   after 500ms hold
//   --gp-press-x/y:  0-1     press position within element
//
// Resting: completely transparent — no glass visible.
// Hover: glass materialises with high-clarity blur + subtle lift.
// Press: spring-down with intensity boost (haptic-like feedback).
// Long-press: LOCAL water-droplet effect at press point — glass
//             intensifies (brighter, higher blur) and a local droplet
//             depression + ripple appears at the exact press position.
//             The element itself does NOT transform. Content stays put.
//             NO global oval/squash deformation.
.glass-pressable {
  position: relative;
  border-radius: var(--radius-md);
  background: transparent;
  --gp-hover: 0;
  --gp-press: 0;
  --gp-longpress: 0;
  --gp-press-x: 0.5;
  --gp-press-y: 0.5;

  transition: transform 280ms var(--ease-spring);

  // ── Glass surface layer ──
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: 0;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: none;
    transition:
      background 320ms var(--ease-spring),
      backdrop-filter 320ms var(--ease-standard),
      -webkit-backdrop-filter 320ms var(--ease-standard),
      box-shadow 320ms var(--ease-spring);
  }

  // ── Long-press local droplet effect layer ──
  // Renders a water-droplet depression at the press point and an
  // expanding ripple ring. This is the "local deformation" — it
  // creates the visual impression of a droplet pressing into the
  // surface without any actual CSS transform on the element.
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    background:
      radial-gradient(
        circle 100% at calc(var(--gp-press-x, 0.5) * 100%) calc(var(--gp-press-y, 0.5) * 100%),
        rgba(255, 255, 255, 0.20) 0%,
        rgba(255, 255, 255, 0.08) 15%,
        transparent 40%
      );
    transition: opacity 300ms var(--ease-standard);
  }

  // ── Content protection ──
  // All direct children sit above the glass layers and NEVER transform.
  & > * {
    position: relative;
    z-index: 1;
  }

  // ── Hover: glass materialises ──
  &:hover:not(:disabled) {
    transform: translateY(-1.5px) scale(1.02);

    &::before {
      backdrop-filter: blur(14px) saturate(170%);
      -webkit-backdrop-filter: blur(14px) saturate(170%);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.13) 0%, transparent 40%),
        linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, transparent 30%, transparent 70%, rgba(0, 0, 0, 0.04) 100%),
        linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.06) 100%),
        rgba(255, 255, 255, 0.07);
      box-shadow:
        inset 0 1px 0 0.5px rgba(255, 255, 255, 0.20),
        inset 0 0 0 1px rgba(255, 255, 255, 0.09),
        inset 0 -1px 0 rgba(0, 0, 0, 0.08),
        0 2px 14px rgba(0, 0, 0, 0.16);
    }
  }

  // ── Active (press): spring-down ──
  // Momentary press feedback — content and glass scale together briefly.
  &:active:not(:disabled) {
    transform: scale(0.92);
    transition: transform 120ms ease-out;

    &::before {
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, transparent 35%),
        linear-gradient(135deg, rgba(255, 255, 255, 0.09) 0%, transparent 30%, transparent 70%, rgba(0, 0, 0, 0.02) 100%),
        linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.04) 100%),
        rgba(255, 255, 255, 0.12);
      box-shadow:
        inset 0 1px 0 0.5px rgba(255, 255, 255, 0.25),
        inset 0 0 0 1px rgba(255, 255, 255, 0.14),
        inset 0 -1px 0 rgba(0, 0, 0, 0.06),
        0 4px 18px rgba(0, 0, 0, 0.22);
      transition:
        background 120ms var(--ease-standard),
        backdrop-filter 120ms var(--ease-standard),
        -webkit-backdrop-filter 120ms var(--ease-standard),
        box-shadow 120ms var(--ease-standard);
    }
  }

  // ── Long-press: LOCAL water-droplet effect ──
  // The element does NOT transform — content stays completely still.
  // The glass surface (::before) intensifies (brighter, higher blur)
  // but does NOT change shape. A local droplet depression + ripple
  // appears on ::after at the exact press position.
  &[style*="--gp-longpress:1"] {
    // NO transform on the element — content is completely untransformed
    transform: none;

    &::before {
      // Glass intensifies — brighter, higher blur, stronger shadow.
      // Shape stays exactly the same — no scale, no skew, no oval.
      backdrop-filter: blur(20px) saturate(200%);
      -webkit-backdrop-filter: blur(20px) saturate(200%);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.20) 0%, transparent 35%),
        linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, transparent 30%, transparent 70%, rgba(0, 0, 0, 0.02) 100%),
        linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.04) 100%),
        rgba(255, 255, 255, 0.13);
      box-shadow:
        inset 0 1px 0 0.5px rgba(255, 255, 255, 0.28),
        inset 0 0 0 1px rgba(255, 255, 255, 0.16),
        inset 0 -1px 0 rgba(0, 0, 0, 0.04),
        0 0 24px rgba(255, 255, 255, 0.08),
        0 6px 22px rgba(0, 0, 0, 0.28);
      transition:
        background 200ms var(--ease-standard),
        backdrop-filter 200ms var(--ease-standard),
        -webkit-backdrop-filter 200ms var(--ease-standard),
        box-shadow 200ms var(--ease-standard);
    }

    // Local water-droplet: a bright depression at the press point
    // with a darker refraction ring around it (like a finger pressing
    // into a water surface), plus an expanding ripple ring.
    &::after {
      opacity: 1;
      background:
        // Bright center — the droplet "press" point
        radial-gradient(
          circle 60% at calc(var(--gp-press-x, 0.5) * 100%) calc(var(--gp-press-y, 0.5) * 100%),
          rgba(255, 255, 255, 0.30) 0%,
          rgba(255, 255, 255, 0.14) 12%,
          rgba(255, 255, 255, 0.04) 25%,
          transparent 40%
        );
      // Expanding ripple ring from the press point
      animation: droplet-ripple 900ms var(--ease-out-expo) forwards;
    }
  }
}

// Water-droplet ripple: a ring starts at the press point and expands
// outward, fading as it grows — like a droplet landing on water.
@keyframes droplet-ripple {
  0% {
    box-shadow:
      0 0 0 0px rgba(255, 255, 255, 0.22),
      0 0 0 0px rgba(255, 255, 255, 0.10);
  }
  40% {
    box-shadow:
      0 0 0 6px rgba(255, 255, 255, 0.10),
      0 0 0 12px rgba(255, 255, 255, 0.04);
  }
  100% {
    box-shadow:
      0 0 0 14px rgba(255, 255, 255, 0),
      0 0 0 28px rgba(255, 255, 255, 0);
  }
}

.player-track-info {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 220px;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: var(--radius-md);
  padding: var(--space-xs);
  margin: calc(-1 * var(--space-xs));
}

.player-cover {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--glass-bg);
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  transition: transform 200ms var(--ease-spring);

  &:hover {
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
    transition: transform 100ms ease-out;
  }
}

.player-cover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.9);
  opacity: 0;
  transition: opacity 200ms var(--ease-standard);

  svg {
    shape-rendering: geometricPrecision;
  }
}

.player-cover:hover .player-cover-overlay {
  opacity: 1;
}

.player-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.player-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-mist);
  font-size: 1.2rem;
}

.player-meta {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.player-title {
  font-size: var(--text-small);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-artist {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-controls {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.player-buttons {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.player-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 280ms var(--ease-standard);
  /* 确保按钮内 SVG 图标锐利 */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  // SVG color follows currentColor — smooth gray → white on hover
  svg {
    shape-rendering: geometricPrecision;
    transition: color 280ms var(--ease-standard),
                filter 280ms var(--ease-standard);
  }

  &:hover:not(:disabled) {
    color: var(--text-primary);

    svg {
      filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.25));
    }
  }

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }

  // ── Play button: bigger and more prominent ──
  // Increased from 36×36 to 46×46 for better tap target and
  // visual hierarchy. Icons also increased from 20→22.
  &--play {
    color: var(--text-primary);
    width: 46px;
    height: 46px;
    border-radius: var(--radius-full);

    // Play button is already white — add subtle glow on hover
    &:hover:not(:disabled) svg {
      filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.35));
    }
  }
}

.player-progress {
display: flex;
align-items: center;
gap: var(--space-sm);
width: 100%;
max-width: 500px;
cursor: pointer;
touch-action: none;
}

.player-progress-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
  position: relative;

  &:hover, &.dragging {
    height: 5px;
  }
}

.player-progress-fill {
  height: 100%;
  background: var(--accent-mist);
  border-radius: 2px;
  transition: width 100ms linear;
}

.player-time {
  font-size: var(--text-caption);
  color: var(--text-tertiary);
  min-width: 36px;
  font-variant-numeric: tabular-nums;

  &--total {
    text-align: right;
  }
}

.player-extras {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 240px;
  justify-content: flex-end;
  flex-shrink: 0;
}

.player-volume {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.volume-icon-btn {
  padding: 4px;
  flex-shrink: 0;
}

.volume-slider {
  -webkit-appearance: none;
  width: 80px;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  outline: none;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px;
    height: 10px;
    background: var(--text-primary);
    border-radius: 50%;
    cursor: pointer;
  }
}

.player-track-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.player-fullscreen-btn {
  flex-shrink: 0;
  padding: 6px;
}

.player-btn--active {
  color: var(--accent-mist, #6c5ce7);

  svg {
    filter: drop-shadow(0 0 4px rgba(108, 92, 231, 0.4));
  }
}

// ===== Quality Selector =====
.quality-selector {
  position: relative;
  flex-shrink: 0;
}

.quality-btn {
  padding: 4px 8px;
  min-width: 28px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.5px;

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.3);
    color: var(--text-primary);
  }
}

.quality-label {
  display: block;
  line-height: 1;
}

.quality-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: rgba(20, 20, 28, 0.92);
  backdrop-filter: blur(24px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
padding: 8px;
z-index: var(--z-overlay, 300);
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.quality-menu-header {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  padding: 4px 8px 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.quality-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  &.active {
    background: rgba(99, 102, 241, 0.15);
  }
}

.quality-menu-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.quality-menu-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  flex: 1;
}

.quality-check {
  color: #818cf8;
  flex-shrink: 0;
}

.quality-menu-enter-active,
.quality-menu-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.quality-menu-enter-from,
.quality-menu-leave-to {
opacity: 0;
transform: translateY(8px) scale(0.96);
}

.quality-menu-item.disabled {
  opacity: 0.5;
  cursor: wait;
}

// ===== EQ Button =====
.eq-selector {
  position: relative;
  flex-shrink: 0;
}

// ===== Queue Panel (播放列表面板) =====
.queue-panel {
position: absolute;
bottom: calc(100% + 12px);
left: 28px;
width: 340px;
height: 420px;
display: flex;
flex-direction: column;
  background: rgba(16, 16, 22, 0.95);
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  z-index: var(--z-overlay, 300);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  /* Hint browser for compositing — reduces jank during expand transition */
  will-change: transform, opacity;
  contain: layout paint;
}

.queue-panel-list {
flex: 1;
overflow-y: auto;
padding: 6px;
min-height: 0;
/* Isolate scroll container rendering from panel transition */
contain: content;
/* Hide scrollbar but keep scrolling */
scrollbar-width: none; /* Firefox */
-ms-overflow-style: none; /* IE10+ */
&::-webkit-scrollbar {
display: none; /* Chrome/Safari/Electron */
}
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 150ms var(--ease-standard);
  min-width: 0;
  /* Skip rendering for off-screen items — major perf win for long queues */
  content-visibility: auto;
  contain-intrinsic-size: 46px;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  &.active {
    background: rgba(126, 200, 227, 0.12);
  }
}

.queue-item-cover {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.05);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.queue-item-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.3);
}

.queue-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.queue-item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  .queue-item.active & {
    color: var(--accent-ice);
  }
}

.queue-item-artist {
  font-size: 10px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-item-playing {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--accent-ice);

  svg {
    shape-rendering: geometricPrecision;
  }
}

.queue-item-vip {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  color: rgba(255, 215, 0, 0.9);
  background: rgba(255, 215, 0, 0.15);
  padding: 2px 5px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}

.queue-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}

// Playlist strip (歌单封面横排)
.playlist-strip {
  flex-shrink: 0;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.playlist-strip-inner {
display: flex;
gap: 10px;
overflow-x: auto;
overflow-y: hidden;
scrollbar-width: none;
-ms-overflow-style: none;
cursor: grab;
user-select: none;
touch-action: pan-x;
&::-webkit-scrollbar { display: none; }
}

.playlist-strip-item {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  width: 48px;

  &:hover .playlist-strip-cover {
    border-color: rgba(255, 255, 255, 0.3);
  }

  &.active .playlist-strip-cover {
    border-color: rgba(126, 200, 227, 0.8);
    box-shadow: 0 0 8px rgba(126, 200, 227, 0.3);
  }
}

.playlist-strip-cover {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid transparent;
  transition: border-color 150ms var(--ease-standard), box-shadow 150ms var(--ease-standard);
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.playlist-strip-cover--icon {
  color: rgba(255, 255, 255, 0.5);
  background: rgba(126, 200, 227, 0.08);
}

.playlist-strip-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.25);
  font-size: 12px;
  font-weight: 600;

  &--netease {
    background: rgba(197, 34, 39, 0.15);
    color: rgba(255, 80, 80, 0.7);
  }

  &--qq {
    background: rgba(52, 122, 235, 0.15);
    color: rgba(100, 160, 255, 0.7);
  }
}

.playlist-strip-name {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 48px;
  text-align: center;
}

.playlist-strip-item.active .playlist-strip-name {
  color: var(--text-primary);
}

// Queue panel list header
.queue-panel-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 4px;
  flex-shrink: 0;
}

.queue-panel-list-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.queue-panel-list-count {
  font-size: 10px;
  color: var(--text-tertiary);
}

// Queue panel transition — optimized for performance with large lists
.queue-panel-enter-active,
.queue-panel-leave-active {
  transition: opacity 180ms var(--ease-standard),
              transform 180ms var(--ease-standard);
}

.queue-panel-enter-from,
.queue-panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.eq-btn {
  padding: 6px;
  flex-shrink: 0;

  &.active {
    color: #818cf8;

    svg {
      filter: drop-shadow(0 0 4px rgba(129, 140, 248, 0.4));
    }
  }
}
</style>

<style lang="scss">
// == PlayerBar auto-hide ==
// PlayerBar visibility is now managed by its own is-visible class.
// The body.hide-bottom-floating class no longer controls the PlayerBar —
// it only controls FAB and page-dots (handled in App.vue).
// This prevents conflicts between the FAB's visibility system and the
// PlayerBar's independent hover-trigger system.
</style>
