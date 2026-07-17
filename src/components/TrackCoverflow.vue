<template>
  <!--
    通用曲目 3D 悬浮列表 — 基于 CoverflowListCard
    支持本地/网易云曲目，提供播放、歌词编辑、加入歌单、删除等操作
  -->
  <CoverflowListCard
    :items="tracks"
    :side="side"
    :header-title="headerTitle"
    :header-sub="headerSub"
    :header-cover="headerCover"
    :count-text="countText || `${tracks.length} 首`"
    :colors="[...COLORS]"
    item-key="id"
    :shift-x="shiftX"
    edge-distance="18%"
    @select="onSelect"
    @close="emit('close')"
    @header-click="emit('headerClick')"
  >
    <template #headerExtra>
      <slot name="headerExtra"></slot>
    </template>

    <template #item="{ item: track }">
      <div class="track-cover" v-if="getCoverUrl(track)">
        <img :src="getCoverUrl(track)" :alt="track.title" loading="lazy" @error="onCoverError" />
      </div>
      <div class="track-glow"></div>
      <div class="track-info">
        <div class="track-title">
          <span class="track-title-text">{{ track.title }}</span>
          <span v-if="track.vip" class="track-vip-badge">VIP</span>
        </div>
        <div class="track-artist">{{ track.artist }}</div>
      </div>
    </template>

    <template #itemActions="{ item: track }">
      <button class="track-btn track-btn-play" @click.stop="emit('select', track)" title="播放">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
          <path d="M3 2L11 7L3 12V2Z" />
        </svg>
      </button>
      <button
        v-if="canEditLyrics && track.source !== 'netease'"
        class="track-btn track-btn-lyrics"
        @click.stop="emit('lyricsEdit', track)"
        title="歌词"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M9 2L12 5L5 12H2V9L9 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        v-if="canAddToPlaylist"
        class="track-btn track-btn-playlist"
        @click.stop="emit('addToPlaylist', track)"
        title="加入歌单"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M2 3.5H12M2 7H8M2 10.5H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </button>
      <button
        v-if="canDelete"
        class="track-btn track-btn-delete"
        @click.stop="emit('deleteTrack', track)"
        :title="deleteLabel"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M2 4H12M11 4L10.5 12H3.5L3 4M5 2.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </template>
  </CoverflowListCard>
</template>

<script setup lang="ts">
/**
 * TrackCoverflow — 通用曲目 3D 悬浮列表
 *
 * Props:
 *   tracks           — Track[] 曲目数组
 *   side             — 'left' | 'right' | 'center'
 *   headerTitle      — 头部标题
 *   headerSub        — 头部副标题
 *   headerCover      — 头部封面图 URL
 *   countText        — 头部计数文字 (默认 "{n} 首")
 *   shiftX           — X 轴偏移
 *   canDelete        — 是否显示删除按钮
 *   canEditLyrics    — 是否显示歌词按钮
 *   canAddToPlaylist — 是否显示加入歌单按钮
 *   deleteLabel      — 删除按钮 tooltip 文字
 *
 * Events:
 *   select        — 播放曲目 (track)
 *   close         — 关闭列表
 *   headerClick   — 点击头部信息区
 *   lyricsEdit    — 编辑歌词 (track)
 *   addToPlaylist — 加入歌单 (track)
 *   deleteTrack   — 删除/移除曲目 (track)
 *
 * Slots:
 *   #headerExtra  — 头部额外按钮区 (透传给 CoverflowListCard)
 */

import CoverflowListCard from '@/components/CoverflowListCard.vue'
import { COVERFLOW_COLORS_8 as COLORS } from '@/components/coverflowColors'
import { useMusicStore } from '@/stores/music'
import type { Track } from '@/types'

const props = withDefaults(defineProps<{
  tracks: Track[]
  side?: 'left' | 'right' | 'center'
  headerTitle: string
  headerSub?: string
  headerCover?: string
  countText?: string
  shiftX?: number
  canDelete?: boolean
  canEditLyrics?: boolean
  canAddToPlaylist?: boolean
  deleteLabel?: string
}>(), {
  side: 'center',
  shiftX: 0,
  canDelete: false,
  canEditLyrics: false,
  canAddToPlaylist: false,
  deleteLabel: '删除',
})

const emit = defineEmits<{
  select: [track: Track]
  close: []
  headerClick: []
  lyricsEdit: [track: Track]
  addToPlaylist: [track: Track]
  deleteTrack: [track: Track]
}>()

const musicStore = useMusicStore()


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
.track-cover {
  width: 52px;
  height: 52px;
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

.track-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(80% 60% at 25% 50%,
    color-mix(in srgb, var(--c) 16%, transparent),
    transparent 60%);
  pointer-events: none;
  z-index: 1;
}

.track-info {
  flex: 1;
  min-width: 0;
  z-index: 2;
}

.track-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(234, 242, 248, 0.95);
  line-height: 1.2;
}

.track-title-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-vip-badge {
  flex-shrink: 0;
  display: inline-block;
  padding: 0 4px;
  font-size: 8px;
  font-weight: 700;
  line-height: 14px;
  color: #ffd700;
  background: rgba(255, 215, 0, 0.15);
  border: 1px solid rgba(255, 215, 0, 0.4);
  border-radius: 3px;
  text-shadow: 0 0 4px rgba(255, 215, 0, 0.3);
}

.track-artist {
  margin-top: 2px;
  font-size: 10px;
  color: rgba(234, 242, 248, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: transform 0.15s, opacity 0.15s;

  &:hover {
    transform: scale(1.1);
  }
}

.track-btn-play {
  background: var(--c, #C0C0C0);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--c, #C0C0C0) 40%, transparent);
}

.track-btn-lyrics {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);

  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
}

.track-btn-playlist {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);

  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
}

.track-btn-delete {
  background: rgba(239, 68, 68, 0.35);
  color: rgba(255, 255, 255, 0.8);

  &:hover {
    background: rgba(239, 68, 68, 0.6);
  }
}
</style>
