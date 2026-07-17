<template>
  <div class="playlist-manager">
    <!-- Header -->
    <div class="pm-header">
      <h2 class="text-h3">我的歌单</h2>
      <button class="btn-glass btn-glass--accent" @click="showCreateDialog = true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        新建歌单
      </button>
    </div>

    <!-- Playlist Grid -->
    <div class="pm-grid" v-if="playlistStore.playlists.length > 0">
      <div
        v-for="pl in playlistStore.playlists"
        :key="pl.id"
        class="playlist-card"
        :class="{ 'playlist-card--drag-over': dragOverId === pl.id }"
        @click="openPlaylist(pl)"
        @dragover.prevent="dragOverId = pl.id"
        @dragleave="dragOverId = dragOverId === pl.id ? null : dragOverId"
        @drop.prevent="onDropToPlaylist($event, pl.id)"
      >
        <div class="playlist-cover">
          <img
            v-if="pl.coverPath"
            :src="coverUrl(pl.coverPath)"
            :alt="pl.name"
            class="cover-img"
          />
          <div v-else class="cover-placeholder">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M12 6L24 16L12 26V6Z" fill="currentColor" opacity="0.4"/>
            </svg>
          </div>
          <div class="cover-overlay">
            <button class="play-btn" @click.stop="playPlaylist(pl)">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6 4L16 10L6 16V4Z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="playlist-info">
          <span class="playlist-name text-body">{{ pl.name }}</span>
          <span class="playlist-count text-small">{{ pl.trackCount }} 首</span>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div class="pm-empty" v-else-if="!playlistStore.isLoading">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
        <rect x="8" y="10" width="32" height="28" rx="4" stroke="currentColor" stroke-width="2"/>
        <path d="M20 20L28 24L20 28V20Z" fill="currentColor"/>
      </svg>
      <p class="text-caption">还没有歌单，点击右上角创建</p>
    </div>

    <!-- Loading -->
    <div class="pm-loading" v-if="playlistStore.isLoading">
      <div class="skeleton-line skeleton-line--md" style="width: 120px;" v-for="i in 4" :key="i" />
    </div>

    <!-- Playlist Detail Modal -->
    <Transition name="modal">
      <div v-if="showDetail" class="pm-detail-overlay" @click.self="closeDetail">
        <div class="pm-detail">
          <FrostedGlass :corner-radius="20" variant="primary" />
          <div class="pm-detail-content">
            <!-- Detail Header -->
            <div class="detail-header">
              <div class="detail-cover">
                <img
                  v-if="playlistStore.currentPlaylist?.coverPath"
                  :src="coverUrl(playlistStore.currentPlaylist.coverPath)"
                  class="cover-img"
                />
                <div v-else class="cover-placeholder">
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                    <path d="M15 8L30 20L15 32V8Z" fill="currentColor" opacity="0.4"/>
                  </svg>
                </div>
              </div>
              <div class="detail-meta">
                <input
                  v-model="editName"
                  class="detail-name-input"
                  @blur="onNameBlur"
                  @keydown.enter="($event.target as HTMLInputElement)?.blur()"
                />
                <textarea
                  v-model="editDesc"
                  class="detail-desc-input"
                  placeholder="添加描述..."
                  rows="2"
                  @blur="onDescBlur"
                ></textarea>
                <div class="detail-actions">
                  <button class="btn-glass btn-glass--sm" @click="changeCover">更换封面</button>
                  <button class="btn-glass btn-glass--sm" @click="playCurrent">播放全部</button>
                  <button class="btn-glass btn-glass--sm btn-danger" @click="onDelete">删除歌单</button>
                </div>
              </div>
              <button class="detail-close" @click="closeDetail">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>

            <!-- Track List -->
            <div class="detail-tracks">
              <div v-if="playlistStore.isDetailLoading" class="detail-loading">
                <div class="skeleton-line skeleton-line--md" v-for="i in 5" :key="i" />
              </div>
              <div v-else-if="playlistStore.currentTracks.length === 0" class="detail-empty">
                <p class="text-caption">歌单还是空的，从音乐库添加歌曲吧</p>
              </div>
              <div v-else class="track-list">
                <div
                  v-for="(track, idx) in playlistStore.currentTracks"
                  :key="track.id"
                  class="track-row"
                  :class="{ active: isCurrentTrack(track.id) }"
                  @dblclick="playTrack(track)"
                >
                  <span class="track-index text-small">{{ idx + 1 }}</span>
                  <div class="track-cover">
                    <img v-if="track.coverPath" :src="coverUrl(track.coverPath)" class="cover-img" />
                    <div v-else class="cover-mini"></div>
                  </div>
                  <div class="track-info">
                    <span class="track-title text-body">{{ track.title }}</span>
                    <span class="track-artist text-small">{{ track.artist }}</span>
                  </div>
                  <span class="track-duration text-small">{{ formatDuration(track.duration) }}</span>
                  <div class="track-actions">
                    <button class="track-btn" @click.stop="playTrack(track)" title="播放">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M4 3L12 7L4 11V3Z"/></svg>
                    </button>
                    <button class="track-btn track-btn--danger" @click.stop="removeTrack(track.id)" title="移除">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Create Playlist Dialog -->
    <Transition name="modal">
      <div v-if="showCreateDialog" class="pm-create-overlay" @click.self="showCreateDialog = false">
        <div class="pm-create">
          <FrostedGlass :corner-radius="16" variant="primary" />
          <div class="pm-create-content">
            <h3 class="text-h3">新建歌单</h3>
            <input
              v-model="newPlaylistName"
              class="create-input"
              placeholder="输入歌单名称..."
              maxlength="50"
              @keydown.enter="onCreate"
              ref="createInputRef"
            />
            <textarea
              v-model="newPlaylistDesc"
              class="create-textarea"
              placeholder="描述（可选）..."
              rows="2"
            ></textarea>
            <div class="create-actions">
              <button class="btn-glass" @click="showCreateDialog = false">取消</button>
              <button class="btn-glass btn-glass--accent" @click="onCreate" :disabled="!newPlaylistName.trim()">创建</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { usePlaylistStore } from '@/stores/playlist'
import { useMusicStore } from '@/stores/music'
import FrostedGlass from '@/components/FrostedGlass.vue'
import type { Playlist, Track } from '@/types'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useSfx } from '@/composables/useSfx'

const playlistStore = usePlaylistStore()
const toast = useGlobalToast()
const sfx = useSfx()
const musicStore = useMusicStore()

// ── Create dialog ─────────────────────────────────────────────
const showCreateDialog = ref(false)
const newPlaylistName = ref('')
const newPlaylistDesc = ref('')
const createInputRef = ref<HTMLInputElement | null>(null)

// ── Drag-and-drop ─────────────────────────────────────────────
const dragOverId = ref<string | null>(null)

async function onDropToPlaylist(e: DragEvent, playlistId: string) {
  dragOverId.value = null
  const trackId = e.dataTransfer?.getData('text/plain')
  if (!trackId) return
  const added = await playlistStore.addTracks(playlistId, [trackId])
  if (added > 0) {
    // Refresh the detail view if it's open for this playlist
    if (showDetail.value && playlistStore.currentPlaylist?.id === playlistId) {
      await playlistStore.loadPlaylistDetail(playlistId)
    }
  }
}

// ── Detail modal ──────────────────────────────────────────────
const showDetail = ref(false)
const editName = ref('')
const editDesc = ref('')

onMounted(() => {
  playlistStore.loadPlaylists()
})

function coverUrl(coverPath: string | undefined): string | undefined {
  if (!coverPath) return undefined
  return `beat://${encodeURIComponent(coverPath)}`
}

function openPlaylist(pl: Playlist) {
  sfx.airBloom()
  playlistStore.loadPlaylistDetail(pl.id).then(() => {
    editName.value = pl.name
    editDesc.value = pl.description || ''
    showDetail.value = true
  })
}

function closeDetail() {
  sfx.retract()
  showDetail.value = false
  playlistStore.clearDetail()
}

async function onCreate() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  const pl = await playlistStore.createPlaylist(name, newPlaylistDesc.value.trim() || undefined)
  if (pl) {
    showCreateDialog.value = false
    newPlaylistName.value = ''
    newPlaylistDesc.value = ''
  }
}

function onNameBlur() {
  if (!playlistStore.currentPlaylist) return
  const name = editName.value.trim()
  if (name && name !== playlistStore.currentPlaylist.name) {
    playlistStore.updatePlaylist(playlistStore.currentPlaylist.id, { name })
  } else {
    editName.value = playlistStore.currentPlaylist.name
  }
}

function onDescBlur() {
  if (!playlistStore.currentPlaylist) return
  const desc = editDesc.value.trim()
  if (desc !== (playlistStore.currentPlaylist.description || '')) {
    playlistStore.updatePlaylist(playlistStore.currentPlaylist.id, { description: desc })
  }
}

async function changeCover() {
  if (!playlistStore.currentPlaylist) return
  const path = await playlistStore.pickCover()
  if (path) {
    await playlistStore.setCover(playlistStore.currentPlaylist.id, path)
  }
}

async function onDelete() {
  if (!playlistStore.currentPlaylist) return
  const ok = await toast.confirm({
    title: '删除歌单',
    message: `确定删除歌单「${playlistStore.currentPlaylist.name}」吗？`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await playlistStore.deletePlaylist(playlistStore.currentPlaylist.id)
  closeDetail()
}

function playPlaylist(pl: Playlist) {
  sfx.confirm()
  playlistStore.loadPlaylistDetail(pl.id).then(() => {
    if (playlistStore.currentTracks.length > 0) {
      musicStore.setQueue(playlistStore.currentTracks, 0)
      musicStore.playIndex(0)
    }
  })
}

function playCurrent() {
  sfx.confirm()
  if (playlistStore.currentTracks.length > 0) {
    musicStore.setQueue(playlistStore.currentTracks, 0)
    musicStore.playIndex(0)
  }
}

function playTrack(track: Track) {
  sfx.confirm()
  const idx = playlistStore.currentTracks.findIndex(t => t.id === track.id)
  if (idx >= 0) {
    musicStore.setQueue(playlistStore.currentTracks, idx)
    musicStore.playIndex(idx)
  }
}

function removeTrack(trackId: string) {
  sfx.detent()
  if (playlistStore.currentPlaylist) {
    playlistStore.removeTrack(playlistStore.currentPlaylist.id, trackId)
  }
}

function isCurrentTrack(trackId: string): boolean {
  return musicStore.currentTrack?.id === trackId
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Focus input when dialog opens
import { watch } from 'vue'
watch(showCreateDialog, (val) => {
  if (val) {
    nextTick(() => createInputRef.value?.focus())
  }
})
</script>

<style scoped>
.playlist-manager {
  width: 100%;
}

.pm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.pm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

.playlist-card {
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.playlist-card:hover {
  transform: translateY(-2px);
}
.playlist-card:hover .cover-overlay {
  opacity: 1;
}
.playlist-card--drag-over {
  transform: scale(1.05);
  box-shadow: 0 0 0 2px rgba(108, 92, 231, 0.5), 0 8px 24px rgba(108, 92, 231, 0.2);
}
.playlist-card--drag-over .cover-overlay {
  opacity: 1;
  background: rgba(108, 92, 231, 0.25);
}

.playlist-cover {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  background: var(--glass-bg, rgba(255,255,255,0.06));
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary, rgba(255,255,255,0.3));
  background: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08));
}

.cover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.3);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.play-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: var(--accent, #6c5ce7);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
}
.play-btn:hover { transform: scale(1.1); }

.playlist-info {
  padding: 8px 4px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.playlist-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-empty, .pm-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
}

/* ── Detail Modal ──────────────────────────────────────────── */
.pm-detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(8px);
  z-index: var(--z-modal, 400);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.pm-detail {
  position: relative;
  width: 100%;
  max-width: 720px;
  max-height: 80vh;
  border-radius: 20px;
  overflow: hidden;
}

.pm-detail-content {
  position: relative;
  z-index: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}

.detail-header {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.detail-cover {
  width: 120px;
  height: 120px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
}

.detail-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-name-input {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #fff);
  transition: border-color 0.2s;
}
.detail-name-input:hover, .detail-name-input:focus {
  border-color: var(--glass-border, rgba(255,255,255,0.15));
  outline: none;
}

.detail-desc-input {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--text-secondary, rgba(255,255,255,0.6));
  resize: none;
  transition: border-color 0.2s;
}
.detail-desc-input:hover, .detail-desc-input:focus {
  border-color: var(--glass-border, rgba(255,255,255,0.15));
  outline: none;
}

.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.detail-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.1);
  color: var(--text-primary, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.detail-close:hover { background: rgba(255,255,255,0.2); }

.detail-tracks {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.track-row:hover { background: rgba(255,255,255,0.06); }
.track-row.active { background: rgba(108,92,231,0.15); }

.track-index {
  width: 28px;
  text-align: center;
  color: var(--text-tertiary, rgba(255,255,255,0.4));
}

.track-cover {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}
.cover-mini {
  width: 100%;
  height: 100%;
  background: rgba(255,255,255,0.06);
}

.track-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.track-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.track-artist {
  color: var(--text-tertiary, rgba(255,255,255,0.4));
}

.track-duration {
  color: var(--text-tertiary, rgba(255,255,255,0.4));
  flex-shrink: 0;
}

.track-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}
.track-row:hover .track-actions { opacity: 1; }

.track-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: rgba(255,255,255,0.08);
  color: var(--text-secondary, rgba(255,255,255,0.6));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.track-btn:hover { background: rgba(255,255,255,0.15); }
.track-btn--danger:hover { background: rgba(239,68,68,0.2); color: #ef4444; }

.detail-empty, .detail-loading {
  display: flex;
  justify-content: center;
  padding: 40px;
}

/* ── Create Dialog ─────────────────────────────────────────── */
.pm-create-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(8px);
  z-index: calc(var(--z-modal, 400) + 10);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pm-create {
  position: relative;
  width: 400px;
  border-radius: 16px;
  overflow: hidden;
}

.pm-create-content {
  position: relative;
  z-index: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.create-input {
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 15px;
  color: var(--text-primary, #fff);
  outline: none;
}
.create-input:focus { border-color: var(--accent, #6c5ce7); }

.create-textarea {
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-primary, #fff);
  resize: none;
  outline: none;
}
.create-textarea:focus { border-color: var(--accent, #6c5ce7); }

.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-glass--sm {
  padding: 6px 14px;
  font-size: 12px;
}

.btn-danger {
  color: #ef4444;
}
.btn-danger:hover {
  background: rgba(239,68,68,0.15);
}

/* ── Transitions ──────────────────────────────────────────── */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
</style>
