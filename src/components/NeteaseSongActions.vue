<template>
  <!--
    Reusable like + add-to-playlist buttons for Netease songs.
    Used in SongCoverflow (and optionally other surfaces).
    Shares the same useNeteaseLikes composable as GlobalSearchBar
    for consistent liked-state across the entire app.
  -->
  <button
    class="nsa-btn"
    :class="{ 'is-liked': liked }"
    @click.stop="onLike"
    :title="liked ? '取消喜欢' : '喜欢'"
  >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 14s-5-3.5-5-7.5C3 4 5 3 6.5 3S8 4 8 4s.5-1 1.5-1S13 4 13 6.5C13 10.5 8 14 8 14z"
        :fill="liked ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="1.2"
      />
    </svg>
  </button>

  <button
    class="nsa-btn"
    @click.stop="onAddToPlaylist"
    title="添加到歌单"
  >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 4H13M3 8H13M3 12H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M12 10.5V14.5M10 12.5H14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  </button>

  <!-- Playlist picker popover -->
  <Teleport to="body">
    <div v-if="showPicker" class="nsa-picker-overlay" @click.self="closePicker">
      <div class="nsa-picker">
        <div class="nsa-picker-header">
          <span class="nsa-picker-title">添加到歌单</span>
          <button class="nsa-picker-close" @click="closePicker">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="nsa-picker-list">
          <button
            v-for="pl in neteasePlaylists"
            :key="pl.id"
            class="nsa-picker-item"
            @click="addToPlaylist(pl.id)"
          >
            <div class="nsa-picker-item-cover" v-if="pl.coverImgUrl">
              <img :src="pl.coverImgUrl + '?param=80x80'" :alt="pl.name" loading="lazy" @error="onCoverErr" />
            </div>
            <div class="nsa-picker-item-cover nsa-picker-item-cover--ph" v-else>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 4H13M3 8H13M3 12H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="nsa-picker-item-info">
              <div class="nsa-picker-item-name">{{ pl.name }}</div>
              <div class="nsa-picker-item-count">{{ pl.trackCount ?? 0 }} 首</div>
            </div>
          </button>
          <div v-if="neteasePlaylists.length === 0" class="nsa-picker-empty">
            暂无歌单
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useNeteaseLikes } from '@/composables/useNeteaseLikes'
import { useNeteaseStatus } from '@/composables/useNeteaseStatus'
import { useSfx } from '@/composables/useSfx'
import { cacheInvalidatePrefix, CacheNS } from '@/modules/music/cache'
import { useGlobalToast } from '@/composables/useGlobalToast'

const props = defineProps<{
  songId: number
}>()

const sfx = useSfx()
const toast = useGlobalToast()
const { likedSongIds, toggleLike } = useNeteaseLikes()
const { userInfo } = useNeteaseStatus()

// Derive liked state reactively from the shared Set
// Using computed ensures instant reactivity when the Set is replaced
const liked = computed(() => likedSongIds.value.has(props.songId))

// ── Like ──
async function onLike() {
  sfx.confirm()
  const newState = !liked.value
  // No need for optimistic update — computed reactivity is instant
  const ok = await toggleLike(props.songId, newState)
  if (ok) {
    toast.success(newState ? '已添加到喜欢的音乐' : '已取消喜欢')
  } else {
    toast.warning('操作失败')
  }
}

// ── Add to playlist ──
const showPicker = ref(false)
const neteasePlaylists = ref<any[]>([])

async function onAddToPlaylist() {
  sfx.detent()
  showPicker.value = true
  // Load user's netease playlists
  if (neteasePlaylists.value.length === 0 && userInfo.value?.userId) {
    try {
      const result = await window.electronAPI!.netease.getUserPlaylists(userInfo.value.userId)
      if (result.success && result.data) {
        neteasePlaylists.value = (result.data.playlists || []).filter((pl: any) =>
          pl.creator?.userId === userInfo.value?.userId
        )
      }
    } catch (e) {
      console.error('[NeteaseSongActions] Failed to load playlists:', e)
    }
  }
}

function closePicker() {
  showPicker.value = false
}

async function addToPlaylist(playlistId: number) {
  showPicker.value = false
  try {
    const result = await window.electronAPI!.netease.addToPlaylist(props.songId, playlistId)
    if (result.success) {
      toast.success('已添加到歌单')
      sfx.confirm()
      cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, String(playlistId))
      cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
      window.dispatchEvent(new CustomEvent('beatzfit:neteaseDataChanged'))
    } else {
      toast.warning(result.message || '添加失败')
    }
  } catch (e) {
    console.error('[NeteaseSongActions] Add to playlist failed:', e)
    toast.error('网络错误')
  }
}

function onCoverErr(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}
</script>

<style lang="scss" scoped>
.nsa-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  background: transparent;
  transition: color 0.15s, transform 0.15s, background 0.15s;

  &:hover {
    transform: scale(1.12);
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.08);
  }

  &.is-liked {
    color: #ff4d6d;
  }
}

/* Picker popover */
.nsa-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nsa-picker {
  width: 340px;
  max-height: 60vh;
  background: rgba(20, 20, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}

.nsa-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.nsa-picker-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.nsa-picker-close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }
}

.nsa-picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;
  }
}

.nsa-picker-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
}

.nsa-picker-item-cover {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.nsa-picker-item-cover--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.3);
}

.nsa-picker-item-info {
  flex: 1;
  min-width: 0;
}

.nsa-picker-item-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nsa-picker-item-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 2px;
}

.nsa-picker-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}
</style>
