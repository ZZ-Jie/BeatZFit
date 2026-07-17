<template>
  <!--
    3D 悬浮歌曲列表 — 基于 CoverflowListCard 通用组件
    使用 #item slot 渲染歌曲特有内容 (封面、标题、艺术家)
    使用 #itemActions slot 渲染播放 + 喜欢 + 添加到歌单按钮
    使用 #headerExtra slot 渲染排序按钮
  -->
  <CoverflowListCard
    :items="sortedTracks"
    side="right"
    :header-title="playlistName"
    :header-sub="playlistSub"
    :header-cover="playlistCover"
    :count-text="`${sortedTracks.length} 首`"
    :colors="[...COLORS]"
    item-key="id"
    :shift-x="180"
    edge-distance="18%"
    :card-width="'clamp(260px, 24vw, 340px)'"
    :item-width="'clamp(240px, 22vw, 320px)'"
    @select="onSelect"
    @close="$emit('close')"
  >
    <template #item="{ item: track, isFocus }">
      <div class="song-cover" v-if="getCoverUrl(track)">
        <img :src="getCoverUrl(track)" :alt="track.title" loading="lazy" @error="onCoverError" />
      </div>
      <div class="song-glow"></div>
      <div class="song-info">
        <div class="song-title">
          <span class="song-title-text">{{ track.title }}</span>
          <span v-if="track.vip" class="song-vip-badge">VIP</span>
        </div>
        <div class="song-artist">{{ track.artist }}</div>
      </div>
    </template>

    <template #itemActions="{ item: track }">
      <button class="song-btn song-btn-play" @click.stop="$emit('select', track)" title="播放">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
          <path d="M3 2L11 7L3 12V2Z" />
        </svg>
      </button>
    </template>

    <template #headerExtra>
      <div class="sort-control" @pointerdown.stop @wheel.stop>
        <button
          class="sort-btn"
          :class="{ active: showSortMenu }"
          @click.stop="toggleSortMenu"
          title="排序"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 4H12M4 7H10M6 10H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="sort-menu" v-if="showSortMenu" @pointerdown.stop>
          <button
            v-for="opt in sortOptions"
            :key="opt.key"
            class="sort-menu-item"
            :class="{ active: currentSort === opt.key }"
            @click.stop="setSort(opt.key)"
          >
            <span class="sort-menu-label">{{ opt.label }}</span>
            <svg v-if="currentSort === opt.key" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </template>
  </CoverflowListCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import CoverflowListCard from '@/components/CoverflowListCard.vue'
import { COVERFLOW_COLORS_8 as COLORS } from '@/components/coverflowColors'
import { useMusicStore } from '@/stores/music'
import type { Track } from '@/types'

const props = defineProps<{
  tracks: Track[]
  playlistName: string
  playlistCover?: string
  playlistSub?: string
}>()

const emit = defineEmits<{
  select: [track: Track]
  close: []
}>()

const musicStore = useMusicStore()


// ── Sorting ──
type SortKey = 'default' | 'title-asc' | 'title-desc' | 'added-desc' | 'added-asc'

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'default', label: '默认排序' },
  { key: 'title-asc', label: '标题 A→Z' },
  { key: 'title-desc', label: '标题 Z→A' },
  { key: 'added-desc', label: '添加时间 ↓' },
  { key: 'added-asc', label: '添加时间 ↑' },
]

const currentSort = ref<SortKey>('default')
const showSortMenu = ref(false)

function toggleSortMenu() {
  showSortMenu.value = !showSortMenu.value
}

function setSort(key: SortKey) {
  currentSort.value = key
  showSortMenu.value = false
}

// Close sort menu on outside click
function onOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.sort-control')) {
    showSortMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onOutsideClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onOutsideClick)
})

const sortedTracks = computed<Track[]>(() => {
  const tracks = [...props.tracks]
  switch (currentSort.value) {
    case 'title-asc':
      return tracks.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    case 'title-desc':
      return tracks.sort((a, b) => b.title.localeCompare(a.title, 'zh-CN'))
    case 'added-desc':
      return tracks.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
    case 'added-asc':
      return tracks.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
    default:
      return tracks
  }
})

function getCoverUrl(track: Track): string | undefined {
  return musicStore.toCoverUrl(track.coverPath)
}

function onCoverError(e: Event) {
  const img = e.target as HTMLImageElement
  const cover = img.parentElement
  if (cover) cover.style.display = 'none'
}


function onSelect(item: any) {
  emit('select', item as Track)
}
</script>

<style lang="scss" scoped>
/* 歌曲列表特有样式 — 通用部分由 CoverflowListCard 提供 */
.song-cover {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.song-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(80% 60% at 25% 50%,
    color-mix(in srgb, var(--c) 16%, transparent),
    transparent 60%);
  pointer-events: none;
  z-index: 1;
}

.song-info {
  flex: 1;
  min-width: 0;
  z-index: 2;
}

.song-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(234, 242, 248, 0.95);
  line-height: 1.2;
}

.song-title-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-vip-badge {
  flex-shrink: 0;
  display: inline-block;
  padding: 0 4px;
  font-size: 7px;
  font-weight: 700;
  line-height: 14px;
  color: #ffd700;
  background: rgba(255, 215, 0, 0.15);
  border: 1px solid rgba(255, 215, 0, 0.4);
  border-radius: 3px;
  text-shadow: 0 0 4px rgba(255, 215, 0, 0.3);
}

.song-artist {
  margin-top: 2px;
  font-size: 9px;
  color: rgba(234, 242, 248, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: transform 0.15s;

  &:hover {
    transform: scale(1.1);
  }
}

.song-btn-play {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* ── Sort control ── */
.sort-control {
  position: relative;
}

.sort-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s, color 0.2s, border-color 0.2s;

  &:hover, &.active {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.25);
  }
}

.sort-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 160px;
  background: rgba(20, 20, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  padding: 4px;
  z-index: 100;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.sort-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  text-align: left;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
  }

  &.active {
    color: rgba(255, 255, 255, 0.95);
    background: rgba(255, 255, 255, 0.08);
  }
}

.sort-menu-label {
  white-space: nowrap;
}
</style>
