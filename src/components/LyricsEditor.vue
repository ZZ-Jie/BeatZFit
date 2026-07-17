<template>
  <div class="lyrics-editor">
    <!-- Tab bar -->
    <div class="le-tabs">
      <button class="le-tab" :class="{ active: tab === 'edit' }" @click="switchTab('edit')">编辑歌词</button>
      <button class="le-tab" :class="{ active: tab === 'search' }" @click="switchTab('search')">在线匹配</button>
    </div>

    <!-- Edit Tab -->
    <div class="le-edit" v-show="tab === 'edit'">
      <div class="le-edit-info">
        <span class="text-small" v-if="trackTitle">{{ trackTitle }} — {{ trackArtist }}</span>
        <span class="text-small le-hint" v-else>请先选择一首歌曲</span>
      </div>
      <textarea
        v-model="lrcText"
        class="le-textarea"
        placeholder="[00:00.00]在此输入歌词...
[00:12.50]每行一句，时间戳格式 [mm:ss.xx]"
        spellcheck="false"
      ></textarea>
      <div class="le-edit-actions">
        <button class="btn-glass btn-glass--sm" @click="onClear" :disabled="!lrcText">清空</button>
        <button class="btn-glass btn-glass--sm" @click="onFormat" :disabled="!lrcText">格式化</button>
        <button class="btn-glass btn-glass--sm btn-glass--accent" @click="onSave" :disabled="!lrcText || !trackId">
          保存
        </button>
      </div>
    </div>

    <!-- Search Tab -->
    <div class="le-search" v-show="tab === 'search'">
      <div class="le-search-bar">
        <input
          v-model="searchTitle"
          class="le-search-input"
          placeholder="歌曲标题"
        />
        <input
          v-model="searchArtist"
          class="le-search-input"
          placeholder="歌手（可选）"
        />
        <button class="btn-glass btn-glass--accent btn-glass--sm" @click="onSearch" :disabled="isSearching">
          {{ isSearching ? '搜索中...' : '搜索' }}
        </button>
      </div>

      <div class="le-search-results" v-if="searchResults.length > 0">
        <div
          v-for="song in searchResults"
          :key="song.songId"
          class="search-result-row"
          @click="onSelectSong(song)"
        >
          <div class="result-info">
            <span class="result-title text-body">{{ song.title }}</span>
            <span class="result-artist text-small">{{ song.artist }} · {{ song.album }}</span>
          </div>
          <span class="result-duration text-small">{{ formatDuration(song.duration) }}</span>
          <button class="btn-glass btn-glass--sm" @click.stop="onSelectSong(song)" :disabled="fetchingSongId === song.songId">
            {{ fetchingSongId === song.songId ? '获取中...' : '选择' }}
          </button>
        </div>
      </div>
      <div class="le-search-empty" v-else-if="hasSearched && !isSearching">
        <span class="text-caption">未找到匹配的歌曲</span>
      </div>

      <!-- Preview fetched lyrics -->
      <div class="le-preview" v-if="previewLrc">
        <div class="le-preview-header">
          <span class="text-small">预览歌词</span>
          <div class="le-preview-actions">
            <button class="btn-glass btn-glass--sm" @click="onUsePreview">使用此歌词</button>
            <button class="btn-glass btn-glass--sm" @click="closePreview">关闭预览</button>
          </div>
        </div>
        <pre class="le-preview-text">{{ previewLrc }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { isValidLRC, serializeLRC, parseLRC, type LyricsLine } from '@/modules/music/lyricParser'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useSfx } from '@/composables/useSfx'

const props = defineProps<{
  trackId?: string
  trackTitle?: string
  trackArtist?: string
  initialLyrics?: string
}>()

const emit = defineEmits<{
  saved: [lyricsPath: string]
}>()

const tab = ref<'edit' | 'search'>('edit')
const lrcText = ref('')
const searchTitle = ref('')
const searchArtist = ref('')
const isSearching = ref(false)
const hasSearched = ref(false)
const searchResults = ref<Array<{
  songId: number
  title: string
  artist: string
  album: string
  duration: number
}>>([])
const fetchingSongId = ref<number | null>(null)
const previewLrc = ref('')
const globalToast = useGlobalToast()
const sfx = useSfx()

function switchTab(t: 'edit' | 'search') {
  sfx.detent()
  tab.value = t
}

function closePreview() {
  sfx.retract()
  previewLrc.value = ''
}

// Load initial lyrics
watch(() => props.initialLyrics, (val) => {
  if (val) lrcText.value = val
}, { immediate: true })

// Pre-fill search fields from track info
watch(() => props.trackTitle, (val) => {
  if (val) searchTitle.value = val
}, { immediate: true })
watch(() => props.trackArtist, (val) => {
  if (val) searchArtist.value = val
}, { immediate: true })

function showToast(msg: string, type: 'success' | 'error' = 'success') {
  if (type === 'error') {
    globalToast.warning(msg)
  } else {
    globalToast.success(msg)
  }
}

async function onSearch() {
  sfx.detent()
  if (!searchTitle.value.trim()) {
    showToast('请输入歌曲标题', 'error')
    return
  }
  isSearching.value = true
  hasSearched.value = false
  searchResults.value = []
  try {
    const result = await window.electronAPI!.lyrics.searchOnline({
      title: searchTitle.value.trim(),
      artist: searchArtist.value.trim() || undefined,
    })
    if (result.success && result.data?.songs) {
      searchResults.value = result.data.songs
    } else {
      showToast(result.error || '搜索失败', 'error')
    }
  } catch (e) {
    showToast('搜索出错', 'error')
  } finally {
    isSearching.value = false
    hasSearched.value = true
  }
}

async function onSelectSong(song: { songId: number }) {
  sfx.detent()
  fetchingSongId.value = song.songId
  try {
    const result = await window.electronAPI!.lyrics.fetchBySongId(song.songId)
    if (result.success && result.data?.lrc) {
      previewLrc.value = result.data.lrc
      showToast('歌词获取成功')
    } else {
      showToast(result.error || '获取歌词失败', 'error')
    }
  } catch (e) {
    showToast('获取歌词出错', 'error')
  } finally {
    fetchingSongId.value = null
  }
}

function onUsePreview() {
  sfx.confirm()
  lrcText.value = previewLrc.value
  previewLrc.value = ''
  tab.value = 'edit'
  showToast('已填入歌词，点击保存')
}

async function onSave() {
  sfx.confirm()
  if (!props.trackId) {
    showToast('请先选择一首歌曲', 'error')
    return
  }
  if (!lrcText.value.trim()) {
    showToast('歌词内容不能为空', 'error')
    return
  }
  try {
    const result = await window.electronAPI!.lyrics.save({
      trackId: props.trackId,
      lrcText: lrcText.value,
    })
    if (result.success && result.data) {
      showToast('歌词保存成功')
      emit('saved', result.data.lyricsPath)
    } else {
      showToast(result.error || '保存失败', 'error')
    }
  } catch (e) {
    showToast('保存出错', 'error')
  }
}

function onClear() {
  sfx.detent()
  lrcText.value = ''
}

function onFormat() {
  sfx.detent()
  // Parse and re-serialize to normalize timestamps
  const parsed = parseLRC(lrcText.value)
  if (parsed.lines.length > 0) {
    lrcText.value = serializeLRC(parsed.lines)
    showToast('格式化完成')
  } else {
    showToast('无法解析歌词，请检查格式', 'error')
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<style scoped>
.lyrics-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  height: 100%;
}

.le-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: rgba(255,255,255,0.04);
}

.le-tab {
  flex: 1;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, rgba(255,255,255,0.6));
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}
.le-tab.active {
  background: rgba(255,255,255,0.1);
  color: var(--text-primary, #fff);
}

.le-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.le-edit-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.le-hint { color: var(--text-tertiary, rgba(255,255,255,0.4)); }

.le-textarea {
  flex: 1;
  min-height: 200px;
  background: rgba(0,0,0,0.2);
  border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
  border-radius: 10px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary, #fff);
  resize: none;
  outline: none;
}
.le-textarea:focus { border-color: var(--accent, #6c5ce7); }

.le-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.le-search {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.le-search-bar {
  display: flex;
  gap: 8px;
}

.le-search-input {
  flex: 1;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary, #fff);
  outline: none;
}
.le-search-input:focus { border-color: var(--accent, #6c5ce7); }

.le-search-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
}

.search-result-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.search-result-row:hover { background: rgba(255,255,255,0.06); }

.result-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.result-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result-artist {
  color: var(--text-tertiary, rgba(255,255,255,0.4));
}

.le-search-empty {
  display: flex;
  justify-content: center;
  padding: 20px;
}

.le-preview {
  border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
  border-radius: 10px;
  overflow: hidden;
}

.le-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(255,255,255,0.04);
}

.le-preview-actions {
  display: flex;
  gap: 6px;
}

.le-preview-text {
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, rgba(255,255,255,0.7));
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin: 0;
}

.btn-glass--sm {
  padding: 6px 14px;
  font-size: 12px;
}
</style>
