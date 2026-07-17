<template>
  <div class="music-page" data-music-page :class="{ 'persist-sidebars': sidebarPersist }">
    <!-- ── Center: 唱片架 3D 舞台 (全宽) ── -->
    <main class="shelf-area">
      <!-- Top bar: title + controls -->
      <Transition name="slide-down">
        <div v-if="!loading && !immersivePrefs.hideMusicShelfHeader" class="shelf-header">
          <div class="shelf-header-info">
            <div class="shelf-title">{{ shelfHeaderTitle }}</div>
            <div class="shelf-sub">{{ shelfHeaderSub }}</div>
          </div>
          <div class="shelf-actions">
            <button class="shelf-action-btn shelf-action-btn--accent" @click="onPlayAll" v-if="allTracks.length > 0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 2L10 6L3 10V2Z"/></svg>
              播放全部
            </button>
            <!-- Manage local playlist (rename/delete) -->
            <button class="shelf-action-btn" @click="openPlaylistManage" v-if="activeGroupIds.length === 1 && activeGroupIds[0].startsWith('playlist-')" title="管理歌单">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3H10M2 6H10M2 9H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="2" cy="3" r="1" fill="currentColor"/><circle cx="2" cy="6" r="1" fill="currentColor"/><circle cx="2" cy="9" r="1" fill="currentColor"/></svg>
              管理歌单
            </button>
            <!-- Import to current playlist -->
            <button class="shelf-action-btn shelf-action-btn--accent" @click="importToCurrentPlaylist" v-if="activeGroupIds.length === 1 && activeGroupIds[0].startsWith('playlist-')" title="导入音乐到此歌单">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1V11M1 6H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              导入到此歌单
            </button>
            <!-- Search (integrated) -->
            <div class="header-search" v-if="allTracks.length > 0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 8L11 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              <input type="text" v-model="searchQuery" placeholder="搜索..." class="header-search-input" />
              <button v-if="searchQuery" class="header-search-clear" @click="searchQuery = ''">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
              </button>
            </div>
            <!-- Spacing slider -->
            <div class="spacing-control" v-if="allTracks.length > 0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" opacity="0.5">
                <rect x="1" y="4" width="2" height="4" fill="currentColor"/>
                <rect x="5" y="3" width="2" height="6" fill="currentColor"/>
                <rect x="9" y="4" width="2" height="4" fill="currentColor"/>
              </svg>
              <input type="range" min="-0.4" max="0.3" step="0.01" v-model.number="spacing" class="spacing-slider" />
            </div>
            <!-- Persist toggle -->
            <button class="shelf-action-btn" :class="{ 'shelf-action-btn--active': sidebarPersist }" @click="sidebarPersist = !sidebarPersist" title="侧边栏常驻">
              <svg v-if="sidebarPersist" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/>
                <rect x="1.8" y="2.8" width="3" height="8.4" rx="0.5" fill="currentColor" opacity="0.45"/>
                <rect x="9.2" y="2.8" width="3" height="8.4" rx="0.5" fill="currentColor" opacity="0.45"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/>
                <line x1="4.5" y1="2" x2="4.5" y2="12" stroke="currentColor" stroke-width="1" opacity="0.35"/>
                <line x1="9.5" y1="2" x2="9.5" y2="12" stroke="currentColor" stroke-width="1" opacity="0.35"/>
              </svg>
            </button>
          </div>
        </div>
      </Transition>

<!-- Record Shelf 3D Stage -->
<div class="record-shelf-stage stage-engaged" data-record-shelf-stage
>
        <!-- Empty state overlay -->
        <div v-if="allTracks.length === 0 && !loading" class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
              <circle cx="24" cy="24" r="6" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
            </svg>
          </div>
          <p class="empty-text" v-if="tracks.length === 0">还没有音乐文件</p>
          <p class="empty-text" v-else>加载中...</p>
          <button v-if="tracks.length === 0" class="empty-btn" @click="importMusic">导入音乐</button>
        </div>
      </div>
    </main>

    <!-- ── Left hover trigger zone ── -->
    <div
      class="sidebar-hover-zone sidebar-hover-zone-left"
      @mouseenter="onLeftSidebarEnter"
      @mouseleave="onLeftSidebarLeave"
    />

    <!-- ── Left Sidebar: 本地音乐 + 歌单 ── -->
    <aside
      class="sidebar sidebar-left"
      :class="{ visible: leftVisible }"
      @mouseenter="onLeftSidebarEnter"
      @mouseleave="onLeftSidebarLeave"
    >
      <div class="sidebar-header">本地 · Library</div>
      <div class="sidebar-list">
        <div
          v-for="(item, idx) in leftItems"
          :key="item.id"
          class="sidebar-card-wrapper"
          :class="{
            active: activeGroupIds.includes(item.id),
            'drag-over': dragOverId === item.id && dragSourceId !== item.id,
            'dragging': dragSourceId === item.id
          }"
          draggable="true"
          @dragstart="onDragStart($event, item.id)"
          @dragover="onDragOver($event, item.id)"
          @dragleave="onDragLeave(item.id)"
          @drop="onDrop($event, item.id)"
          @dragend="onDragEnd"
        >
          <button class="sidebar-card" @click="onSidebarCardClick(item)">
            <div class="card-thumb" v-if="item.coverUrl">
              <img :src="item.coverUrl" :alt="item.title || '封面'" loading="lazy" @error="onCoverError" />
            </div>
            <div class="card-thumb card-thumb--placeholder" v-else>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
                <circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
              </svg>
            </div>
            <div class="card-info">
              <div class="card-title">{{ item.title }}</div>
              <div class="card-sub">{{ item.sub }}</div>
            </div>
          </button>
          <!-- Delete button for user-created local playlists -->
          <button
            v-if="item.type === 'local-playlist'"
            class="sidebar-delete-btn"
            @click.stop="onDeletePlaylistFromSidebar(item)"
            title="删除歌单"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 4H12M11 4L10.5 12H3.5L3 4M5 2.5H9M5.5 6V10M8.5 6V10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="reorder-btns">
            <button class="reorder-btn" @click="moveUp(item.id)" :disabled="idx === 0" title="上移">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 8.5L7 5L10.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="reorder-btn" @click="moveDown(item.id)" :disabled="idx === leftItems.length - 1" title="下移">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 5.5L7 9L10.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <!-- Empty state: show hint text only (import buttons are in sidebar-actions below) -->
        <div v-if="leftItems.length === 0 && !loading" class="sidebar-empty">
          <span class="sidebar-empty-hint">暂无歌单，点击下方导入音乐</span>
        </div>
      </div>
      <div class="sidebar-actions">
        <button class="sidebar-action-btn" @click="importMusic">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1V13M1 7H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          导入音乐
        </button>
        <button class="sidebar-action-btn" @click="importFolder">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 4C1.5 3.4 1.9 3 2.5 3H5.2C5.5 3 5.7 3.1 5.9 3.3L6.8 4.3H11.5C12.1 4.3 12.5 4.7 12.5 5.3V10.5C12.5 11.1 12.1 11.5 11.5 11.5H2.5C1.9 11.5 1.5 11.1 1.5 10.5V4Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>
          导入文件夹
        </button>
        <button class="sidebar-action-btn sidebar-action-btn--danger" @click="clearAll" v-if="tracks.length > 0 || playlistStore.playlists.length > 0">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H12M11 4L10.5 12H3.5L3 4M5 2.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          清空本地库
        </button>
        <button class="sidebar-action-btn" @click="showCreateDialog = true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          新建歌单
        </button>
      </div>
    </aside>

    <!-- ── Right hover trigger zone ── -->
    <div
      class="sidebar-hover-zone sidebar-hover-zone-right"
      @mouseenter="onRightSidebarEnter"
      @mouseleave="onRightSidebarLeave"
    />

    <!-- ── Right Sidebar: 网易云 / QQ 音乐 (tabbed) ── -->
    <aside
      class="sidebar sidebar-right"
      :class="{ visible: rightVisible }"
      @mouseenter="onRightSidebarEnter"
      @mouseleave="onRightSidebarLeave"
    >
      <!-- Tab switcher -->
      <div class="sidebar-tabs">
        <button class="sidebar-tab" :class="{ active: rightTab === 'netease' }" @click="rightTab = 'netease'">网易云</button>
        <button class="sidebar-tab" :class="{ active: rightTab === 'qq' }" @click="rightTab = 'qq'">QQ音乐</button>
      </div>

      <!-- ── Netease tab ── -->
      <template v-if="rightTab === 'netease'">
        <div class="sidebar-list">
          <div
            v-for="(item, idx) in neteaseItems"
            :key="item.id"
            class="sidebar-card-wrapper"
            :class="{
              active: activeGroupIds.includes(item.id),
              'drag-over': dragOverId === item.id && dragSourceId !== item.id,
              'dragging': dragSourceId === item.id
            }"
            draggable="true"
            @dragstart="onDragStart($event, item.id)"
            @dragover="onDragOver($event, item.id)"
            @dragleave="onDragLeave(item.id)"
            @drop="onDrop($event, item.id)"
            @dragend="onDragEnd"
          >
            <button class="sidebar-card" @click="onSidebarCardClick(item)">
              <div class="card-thumb" v-if="item.coverUrl">
                <img :src="item.coverUrl" :alt="item.title || '封面'" loading="lazy" referrerpolicy="no-referrer" @error="onCoverError" />
              </div>
              <div class="card-thumb card-thumb--placeholder" v-else>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
                  <circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
                </svg>
              </div>
              <div class="card-info">
                <div class="card-title">{{ item.title }}</div>
                <div class="card-sub">{{ item.sub }}</div>
              </div>
            </button>
            <div class="reorder-btns">
              <button class="reorder-btn" @click="moveUp(item.id)" :disabled="idx === 0" title="上移">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 8.5L7 5L10.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="reorder-btn" @click="moveDown(item.id)" :disabled="idx === neteaseItems.length - 1" title="下移">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 5.5L7 9L10.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
          <!-- Login prompt -->
          <div v-if="!neteaseLoggedIn && !loading" class="sidebar-empty">
            <button class="sidebar-action-btn" @click="handleNeteaseLogin" :disabled="neteaseLoginLoading">
              {{ neteaseLoginLoading ? '登录中...' : '登录网易云' }}
            </button>
          </div>
        </div>
        <div class="sidebar-actions" v-if="neteaseLoggedIn">
          <button class="sidebar-action-btn sidebar-action-btn--danger" @click="handleNeteaseLogout">
            退出网易云
          </button>
        </div>
      </template>

      <!-- ── QQ Music tab ── -->
      <template v-else-if="rightTab === 'qq'">
        <div class="sidebar-list">
          <div
            v-for="(item, idx) in qqItems"
            :key="item.id"
            class="sidebar-card-wrapper"
            :class="{
              active: activeGroupIds.includes(item.id),
              'drag-over': dragOverId === item.id && dragSourceId !== item.id,
              'dragging': dragSourceId === item.id
            }"
            draggable="true"
            @dragstart="onDragStart($event, item.id)"
            @dragover="onDragOver($event, item.id)"
            @dragleave="onDragLeave(item.id)"
            @drop="onDrop($event, item.id)"
            @dragend="onDragEnd"
          >
            <button class="sidebar-card" @click="onSidebarCardClick(item)">
              <div class="card-thumb" v-if="item.coverUrl">
                <img :src="item.coverUrl" :alt="item.title || '封面'" loading="lazy" referrerpolicy="no-referrer" @error="onCoverError" />
              </div>
              <div class="card-thumb card-thumb--placeholder" v-else>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
                  <circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
                </svg>
              </div>
              <div class="card-info">
                <div class="card-title">{{ item.title }}</div>
                <div class="card-sub">{{ item.sub }}</div>
              </div>
            </button>
            <div class="reorder-btns">
              <button class="reorder-btn" @click="moveUp(item.id)" :disabled="idx === 0" title="上移">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 8.5L7 5L10.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="reorder-btn" @click="moveDown(item.id)" :disabled="idx === qqItems.length - 1" title="下移">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 5.5L7 9L10.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
          <!-- Login prompt -->
          <div v-if="!qqLoggedIn && !loading" class="sidebar-empty">
            <button class="sidebar-action-btn" @click="handleQqLogin" :disabled="qqLoginLoading">
              {{ qqLoginLoading ? '登录中...' : '登录QQ音乐' }}
            </button>
          </div>
        </div>
        <div class="sidebar-actions" v-if="qqLoggedIn">
          <button class="sidebar-action-btn sidebar-action-btn--danger" @click="handleQqLogout">
            退出QQ音乐
          </button>
        </div>
      </template>
    </aside>

    <!-- ── Context Menu ── -->
    <Transition name="ctx-fade">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="onContextPlay">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7L3 12V2Z"/></svg>
          播放
        </button>
        <template v-if="contextMenu.track?.source === 'local'">
          <button class="ctx-item" @click="onContextEditLyrics">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L12 5L5 12H2V9L9 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
            编辑歌词
          </button>
          <button class="ctx-item" @click="onContextAddToPlaylist">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            加入歌单
          </button>
          <div class="ctx-divider"></div>
          <button class="ctx-item ctx-item--danger" @click="onContextDelete">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H12M11 4L10.5 12H3.5L3 4M5 2.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            删除
          </button>
        </template>
      </div>
    </Transition>

    <!-- ── Loading: skeleton record shelf ── -->
    <div v-if="loading" class="shelf-skeleton">
      <div class="skeleton-record" v-for="n in 8" :key="n">
        <div class="skeleton skeleton-record-cover"></div>
        <div class="skeleton skeleton-line skeleton-line--sm" style="width: 70%; margin: 8px auto 0"></div>
        <div class="skeleton skeleton-line" style="width: 50%; margin: 4px auto 0"></div>
      </div>
    </div>

    <!-- ── Playlist Picker ── -->
    <Transition name="fade">
      <div v-if="playlistPickerTrack" class="pp-overlay" @click.self="playlistPickerTrack = null">
        <div class="pp-box">
          <div class="pp-header">加入歌单</div>
          <div class="pp-list">
            <div v-if="playlistStore.playlists.length === 0" class="pp-empty">暂无歌单，请先创建</div>
            <button
              v-for="pl in playlistStore.playlists"
              :key="pl.id"
              class="pp-item"
              @click="addToPlaylist(pl.id)"
            >
              <span class="pp-item-name">{{ pl.name }}</span>
              <span class="pp-item-count">{{ pl.trackCount }} 首</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Import Target Dialog ── -->
    <Transition name="modal">
      <div v-if="showImportTargetDialog" class="modal-overlay" @click.self="showImportTargetDialog = false">
        <div class="modal-box modal-box--sm">
          <FrostedGlass :corner-radius="16" variant="primary" />
          <div class="modal-box-content">
            <h3 class="text-h3">导入到歌单</h3>
            <p class="text-small" style="color: rgba(255,255,255,0.5); margin: 8px 0 16px;">
              选择导入目标，音乐将同时添加到本地库
            </p>
            <div class="pp-list" style="max-height: 280px; overflow-y: auto;">
              <button
                class="pp-item"
                :class="{ 'pp-item--active': importTargetPlaylistId === null }"
                @click="importTargetPlaylistId = null"
              >
<span class="pp-item-name">仅导入到本地库</span>
<span class="pp-item-count">自动创建歌单</span>
              </button>
              <button
                v-for="pl in playlistStore.playlists"
                :key="pl.id"
                class="pp-item"
                :class="{ 'pp-item--active': importTargetPlaylistId === pl.id }"
                @click="importTargetPlaylistId = pl.id"
              >
                <span class="pp-item-name">{{ pl.name }}</span>
                <span class="pp-item-count">{{ pl.trackCount }} 首</span>
              </button>
            </div>
            <div class="modal-actions" style="margin-top: 16px;">
              <button class="float-btn" @click="showImportTargetDialog = false">取消</button>
              <button class="float-btn float-btn--accent" @click="confirmImportTarget">
                {{ importTargetPlaylistId ? '导入到歌单' : '导入' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Create Playlist Dialog ── -->
    <Transition name="modal">
      <div v-if="showCreateDialog" class="modal-overlay" @click.self="showCreateDialog = false">
        <div class="modal-box modal-box--sm">
          <FrostedGlass :corner-radius="16" variant="primary" />
          <div class="modal-box-content">
            <h3 class="text-h3">新建歌单</h3>
            <input
              v-model="newPlaylistName"
              class="modal-input"
              placeholder="输入歌单名称..."
              maxlength="50"
              @keydown.enter="onCreatePlaylist"
            />
            <textarea
              v-model="newPlaylistDesc"
              class="modal-textarea"
              placeholder="描述（可选）..."
              rows="2"
            ></textarea>
            <div class="modal-actions">
              <button class="float-btn" @click="showCreateDialog = false">取消</button>
              <button class="float-btn float-btn--accent" @click="onCreatePlaylist" :disabled="!newPlaylistName.trim()">创建</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Playlist Manage Dialog ── -->
    <Transition name="modal">
      <div v-if="showPlaylistManage" class="modal-overlay" @click.self="showPlaylistManage = false">
        <div class="modal-box modal-box--sm">
          <FrostedGlass :corner-radius="16" variant="primary" />
          <div class="modal-box-content">
            <h3 class="text-h3">管理歌单</h3>
            <input
              v-model="manageName"
              class="modal-input"
              placeholder="歌单名称..."
              maxlength="50"
            />
            <textarea
              v-model="manageDesc"
              class="modal-textarea"
              placeholder="描述（可选）..."
              rows="2"
            ></textarea>
            <div class="modal-actions">
              <button class="float-btn float-btn--danger" @click="onDeletePlaylist">删除歌单</button>
              <div style="flex: 1"></div>
              <button class="float-btn" @click="showPlaylistManage = false">取消</button>
              <button class="float-btn float-btn--accent" @click="onSavePlaylist">保存</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Lyrics Import Prompt ── -->
    <Transition name="modal">
      <div v-if="showLyricsPrompt" class="modal-overlay" @click.self="showLyricsPrompt = false">
        <div class="modal-box modal-box--sm">
          <FrostedGlass :corner-radius="20" variant="primary" />
          <div class="modal-box-content">
            <h3 class="text-h3">导入歌词</h3>
            <p class="text-small" style="color: rgba(255,255,255,0.5); margin: 8px 0 20px;">
              已导入 {{ lastImportedTracks.length }} 首歌曲，是否为它们添加歌词？
            </p>
            <div class="text-caption" style="color: rgba(255,255,255,0.35); margin-bottom: 20px;">
              <p>• 如果歌词文件名与歌曲文件名一致，将自动智能匹配</p>
              <p>• 如果文件名不同，歌词将关联到刚导入的歌曲</p>
            </div>
            <div class="modal-actions">
              <button class="float-btn" @click="showLyricsPrompt = false">暂不需要</button>
              <button class="float-btn" @click="manualEditLyrics">手动编辑歌词</button>
              <button class="float-btn float-btn--accent" @click="uploadLrcFiles">上传歌词文件</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Lyrics Editor ── -->
    <Transition name="modal">
      <div v-if="showLyricsEditor" class="modal-overlay" @click.self="showLyricsEditor = false">
        <div class="lyric-editor-modal">
          <FrostedGlass :corner-radius="20" variant="primary" />
          <div class="lyric-editor-modal-content">
            <div class="lyric-editor-header">
              <h3 class="text-h3">歌词编辑</h3>
              <button class="lyric-editor-close" @click="showLyricsEditor = false">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <LyricsEditor
              :trackId="editingTrack?.id"
              :trackTitle="editingTrack?.title"
              :trackArtist="editingTrack?.artist"
              :initialLyrics="editorInitialLyrics"
              @saved="onLyricsSaved"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, markRaw, computed, onMounted, onUnmounted, onBeforeUnmount, watch, nextTick, reactive } from 'vue'
import { useMusicStore } from '@/stores/music'
import { usePlaylistStore } from '@/stores/playlist'
import { loadLibraryCached, invalidateLibrary } from '@/modules/music/dataLoaders'
import { cachedFetch, cacheInvalidatePrefix, CacheNS, CacheTTL } from '@/modules/music/cache'
import { useNeteaseStatus } from '@/composables/useNeteaseStatus'
import { useNeteaseLikes } from '@/composables/useNeteaseLikes'
import { useQqStatus } from '@/composables/useQqStatus'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'
import { useRecordShelf } from '@/composables/useRecordShelf'
import { useMusicPageData } from '@/composables/useMusicPageData'
import { useImmersivePrefs } from '@/composables/useImmersivePrefs'
import { animateShimmerAll } from '@/composables/useGsapTransition'
import FrostedGlass from '@/components/FrostedGlass.vue'
import LyricsEditor from '@/components/LyricsEditor.vue'
import type { Track } from '@/types'
import type { NeteasePlaylist, NeteaseSong } from '@/types/netease.d'
import type { QqPlaylist, QqSong } from '@/types/qq.d'

const musicStore = useMusicStore()
const playlistStore = usePlaylistStore()

// ── Immersive prefs ──
const { prefs: immersivePrefs } = useImmersivePrefs()
const toast = useGlobalToast()
const { isLoggedIn: neteaseLoggedIn, userInfo: neteaseUserInfo, checkLoginStatus: checkNeteaseShared, clearStatus: clearNeteaseStatus } = useNeteaseStatus()
const { isLoggedIn: qqLoggedIn, userInfo: qqUserInfo, checkLoginStatus: checkQqShared, clearStatus: clearQqStatus } = useQqStatus()
const { visualizer, registerStage, unregisterStage, attachInteraction, detachInteraction } = useGlobalVisualizer()
const recordShelf = useRecordShelf()

// ── 3D 交互: 进入页面即激活, 无需切换 ──
// visualizer 拖拽旋转 + 滚轮缩放始终生效
let visRAFId = 0
let visTargetRX = 0, visTargetRY = 0, visTargetScale = 1
let visDisplayRX = 0, visDisplayRY = 0, visDisplayScale = 1

function visTransformLoop() {
  if (visualizer.value) {
    const t = visualizer.value.getCoverTransform()
    if (t) {
      visTargetRX = t.rotationX
      visTargetRY = t.rotationY
      visTargetScale = t.scale
    }
  }

  visDisplayRX += (visTargetRX - visDisplayRX) * 0.12
  visDisplayRY += (visTargetRY - visDisplayRY) * 0.12
  visDisplayScale += (visTargetScale - visDisplayScale) * 0.12

  // Only update canvas transform when values are actually changing.
  // When LERP settles (differences < threshold), skip the DOM write to
  // prevent sub-pixel flicker on text rendered on the 3D canvas.
  const diffRX = Math.abs(visTargetRX - visDisplayRX)
  const diffRY = Math.abs(visTargetRY - visDisplayRY)
  const diffScale = Math.abs(visTargetScale - visDisplayScale)

  if (diffRX > 0.0001 || diffRY > 0.0001 || diffScale > 0.0001) {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-music-page] canvas.record-shelf-canvas')
    if (canvas) {
      const degX = (visDisplayRX * 180 / Math.PI).toFixed(2)
      const degY = (visDisplayRY * 180 / Math.PI).toFixed(2)
      canvas.style.transform = `translateZ(200px) rotateX(${-degX}deg) rotateY(${degY}deg) scale(${visDisplayScale.toFixed(3)})`
      canvas.style.transformOrigin = 'center center'
    }
  }

  visRAFId = requestAnimationFrame(visTransformLoop)
}

function startVisualizerInteraction() {
  const stageEl = document.querySelector<HTMLElement>('[data-music-page] [data-record-shelf-stage]')
  if (stageEl) {
    attachInteraction(stageEl)
  }
  // Zone-based interaction:
  // - Record area: recordShelfVisualizer manages data-no-rotate on canvas.
  //   When a record is hovered, data-no-rotate is set → visualizer skips drag,
  //   recordShelfVisualizer handles drag-scroll + wheel-scroll.
  // - Non-record area: data-no-rotate is removed → visualizer handles
  //   drag (3D rotation) + wheel (3D zoom).
  if (!visRAFId) visTransformLoop()
}

// ── Data ────────────────────────────────────────────────────
// Module-level data via composable: survives component unmount/remount.
// In the horizontal single-page architecture, MusicPage is unmounted when
// navigating away and re-mounted when returning. The composable holds refs
// at module level so data persists across mount/unmount cycles.
const {
  tracks,
  loading,
  neteasePlaylists,
  neteaseLoginLoading,
  playlistTracksCache,
  neteaseTracksCache,
  qqPlaylists,
  qqLoginLoading,
  qqTracksCache,
  musicDataLoaded: _musicDataLoaded,
  musicDataLoading: _musicDataLoading,
  setMusicDataLoaded,
  setMusicDataLoading,
  resetAll: resetMusicPageData,
resetLocalOnly,
} = useMusicPageData()

// ── Sidebar state ───────────────────────────────────────────
const sidebarPersist = ref(false)
const leftHover = ref(false)
const rightHover = ref(false)
const rightTab = ref<'netease' | 'qq'>('netease')
const leftVisible = computed(() => sidebarPersist.value || leftHover.value)
const rightVisible = computed(() => sidebarPersist.value || rightHover.value)

// Delayed hide: when mouse leaves hover zone or sidebar, start a short timer.
// If the mouse enters the other element before the timer fires, cancel it.
// This prevents the sidebar from disappearing when moving between the
// hover zone and the sidebar (which caused buttons to be unclickable).
let leftHideTimer: ReturnType<typeof setTimeout> | null = null
let rightHideTimer: ReturnType<typeof setTimeout> | null = null

function onLeftSidebarEnter() {
  if (leftHideTimer) { clearTimeout(leftHideTimer); leftHideTimer = null }
  leftHover.value = true
}
function onLeftSidebarLeave() {
  if (leftHideTimer) clearTimeout(leftHideTimer)
  leftHideTimer = setTimeout(() => { leftHover.value = false }, 200)
}
function onRightSidebarEnter() {
  if (rightHideTimer) { clearTimeout(rightHideTimer); rightHideTimer = null }
  rightHover.value = true
}
function onRightSidebarLeave() {
  if (rightHideTimer) clearTimeout(rightHideTimer)
  rightHideTimer = setTimeout(() => { rightHover.value = false }, 200)
}

// ── Display order (playlist group ordering) ─────────────────
const displayOrder = ref<string[]>([])
// Multi-select: array of selected group IDs. Empty = show all.
// Tracks from selected groups are displayed in click order.
const activeGroupIds = ref<string[]>([])

const DISPLAY_ORDER_KEY = 'beatzfit-display-order'
const SHELF_PREFS_KEY = 'beatzfit-shelf-prefs'

function loadDisplayOrder(): string[] {
  try {
    const saved = localStorage.getItem(DISPLAY_ORDER_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return []
}

function saveDisplayOrder(): void {
  try {
    localStorage.setItem(DISPLAY_ORDER_KEY, JSON.stringify(displayOrder.value))
  } catch { /* ignore */ }
}

function initDisplayOrder(): void {
  const saved = loadDisplayOrder()
  const current: string[] = []
  // Local playlists first (so the shelf starts with curated content,
  // not a dump of the entire local library)
  playlistStore.playlists.forEach(pl => current.push(`playlist-${pl.id}`))
  // Netease playlists
  neteasePlaylists.value.forEach(pl => current.push(`netease-${pl.id}`))
  // QQ playlists
  qqPlaylists.value.forEach(pl => current.push(`qq-${pl.id}`))
  // Local library last (usually the largest group)
  if (tracks.value.length > 0) current.push('local-library')
  // Merge with saved order (saved takes priority for items that still exist)
  if (saved.length > 0) {
    const existing = new Set(current)
    const ordered: string[] = []
    // Add saved items that still exist
    for (const id of saved) {
      if (existing.has(id)) {
        ordered.push(id)
        existing.delete(id)
      }
    }
    // Add new items not in saved
    for (const id of current) {
      if (existing.has(id)) ordered.push(id)
    }
    displayOrder.value = ordered
  } else {
    displayOrder.value = current
  }
}

function moveUp(groupId: string): void {
  const idx = displayOrder.value.indexOf(groupId)
  if (idx <= 0) return
  const arr = [...displayOrder.value]
  ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
  displayOrder.value = arr
  saveDisplayOrder()
  updateShelfTracks()
}

function moveDown(groupId: string): void {
  const idx = displayOrder.value.indexOf(groupId)
  if (idx < 0 || idx >= displayOrder.value.length - 1) return
  const arr = [...displayOrder.value]
  ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
  displayOrder.value = arr
  saveDisplayOrder()
  updateShelfTracks()
}

// ── Drag-to-reorder ─────────────────────────────────────────
const dragSourceId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)

function onDragStart(e: DragEvent, groupId: string) {
  dragSourceId.value = groupId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', groupId)
  }
}

function onDragOver(e: DragEvent, groupId: string) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverId.value = groupId
}

function onDragLeave(groupId: string) {
  if (dragOverId.value === groupId) {
    dragOverId.value = null
  }
}

function onDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  const sourceId = dragSourceId.value
  dragSourceId.value = null
  dragOverId.value = null
  if (!sourceId || sourceId === targetId) return
  const arr = [...displayOrder.value]
  const fromIdx = arr.indexOf(sourceId)
  const toIdx = arr.indexOf(targetId)
  if (fromIdx < 0 || toIdx < 0) return
  arr.splice(fromIdx, 1)
  arr.splice(toIdx, 0, sourceId)
  displayOrder.value = arr
  saveDisplayOrder()
  updateShelfTracks()
}

function onDragEnd() {
  dragSourceId.value = null
  dragOverId.value = null
}

// ── Spacing control (persisted) ────────────────────────────
const spacing = ref(-0.25)

// Load persisted shelf preferences (spacing, sidebarPersist)
function loadShelfPrefs(): void {
  try {
    const saved = localStorage.getItem(SHELF_PREFS_KEY)
    if (saved) {
      const prefs = JSON.parse(saved)
      if (typeof prefs.spacing === 'number') spacing.value = prefs.spacing
      if (typeof prefs.sidebarPersist === 'boolean') sidebarPersist.value = prefs.sidebarPersist
      // Restore the user's playlist filter selection across page switches
      if (Array.isArray(prefs.activeGroupIds)) activeGroupIds.value = prefs.activeGroupIds
    }
  } catch { /* ignore */ }
}

function saveShelfPrefs(): void {
  try {
    localStorage.setItem(SHELF_PREFS_KEY, JSON.stringify({
      spacing: spacing.value,
      sidebarPersist: sidebarPersist.value,
      activeGroupIds: activeGroupIds.value,
    }))
  } catch { /* ignore */ }
}

watch(spacing, (val) => {
  recordShelf.setSpacing(val)
  saveShelfPrefs()
})

watch(sidebarPersist, () => {
  saveShelfPrefs()
})

// ── Search ──────────────────────────────────────────────────
const searchQuery = ref('')
/** Debounced search query — prevents O(n) filtering on every keystroke.
 *  For 10,000+ track libraries, filtering on every keystroke causes
 *  noticeable lag. This delays the filter until the user pauses typing. */
const debouncedSearchQuery = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const allTracks = computed<Track[]>(() => {
  const result: Track[] = []
  for (const groupId of displayOrder.value) {
    if (groupId.startsWith('playlist-')) {
      const plId = groupId.slice(9)
      const plTracks = playlistTracksCache.value[plId] ?? []
      // Avoid duplicates — only add tracks not already in result
      const existing = new Set(result.map(t => t.id))
      for (const t of plTracks) {
        if (!existing.has(t.id)) result.push(t)
      }
    } else if (groupId.startsWith('netease-')) {
      const npId = Number(groupId.slice(8))
      const neTracks = neteaseTracksCache.value[npId] ?? []
      const existing = new Set(result.map(t => t.id))
      for (const t of neTracks) {
        if (!existing.has(t.id)) result.push(t)
      }
    } else if (groupId.startsWith('qq-')) {
      const qpId = groupId.slice(3)
      const qqTracks = qqTracksCache.value[qpId] ?? []
      const existing = new Set(result.map(t => t.id))
      for (const t of qqTracks) {
        if (!existing.has(t.id)) result.push(t)
      }
    }
  }
  return result
})

/** 获取指定分组的曲目 */
function getTracksForGroup(groupId: string): Track[] {
  if (groupId.startsWith('playlist-')) {
    const plId = groupId.slice(9)
    return [...(playlistTracksCache.value[plId] ?? [])]
  } else if (groupId.startsWith('netease-')) {
    const npId = Number(groupId.slice(8))
    return [...(neteaseTracksCache.value[npId] ?? [])]
  } else if (groupId.startsWith('qq-')) {
    const qpId = groupId.slice(3)
    return [...(qqTracksCache.value[qpId] ?? [])]
  }
  return []
}

const shelfTracks = computed(() => {
  let result: Track[]
  if (activeGroupIds.value.length > 0) {
    // Show tracks from selected groups in click order
    result = []
    const seen = new Set<string>()
    for (const groupId of activeGroupIds.value) {
      const groupTracks = getTracksForGroup(groupId)
      for (const t of groupTracks) {
        if (!seen.has(t.id)) {
          seen.add(t.id)
          result.push(t)
        }
      }
    }
  } else {
    result = allTracks.value
  }
  if (!debouncedSearchQuery.value) return result
  const q = debouncedSearchQuery.value.toLowerCase()
  return result.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.artist.toLowerCase().includes(q) ||
    t.album.toLowerCase().includes(q)
  )
})

const localTrackCount = computed(() => allTracks.value.filter(t => t.source !== 'netease' && t.source !== 'qq').length)
const neteaseTrackCount = computed(() => allTracks.value.filter(t => t.source === 'netease').length)
const qqTrackCount = computed(() => allTracks.value.filter(t => t.source === 'qq').length)

// ── Shelf header dynamic title/subtitle ──
const shelfHeaderTitle = computed(() => {
  if (activeGroupIds.value.length === 0) return '全部音乐'
  if (activeGroupIds.value.length === 1) {
    const item = [...leftItems.value, ...rightItems.value].find(i => i.id === activeGroupIds.value[0])
    return item?.title || '全部音乐'
  }
  // Multiple selected: show count
  return `${activeGroupIds.value.length} 个歌单`
})

const shelfHeaderSub = computed(() => {
  if (activeGroupIds.value.length === 0) {
    const parts = [`${allTracks.value.length} 首`, `本地 ${localTrackCount.value}`]
    if (neteaseTrackCount.value > 0) parts.push(`网易云 ${neteaseTrackCount.value}`)
    if (qqTrackCount.value > 0) parts.push(`QQ音乐 ${qqTrackCount.value}`)
    return parts.join(' · ')
  }
  return `${shelfTracks.value.length} 首`
})

watch(searchQuery, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    debouncedSearchQuery.value = val
  }, 250)
})

// When the debounced query changes, update the visualizer
watch(debouncedSearchQuery, () => {
  recordShelf.setTracks(shelfTracks.value)
})

// ── Sidebar items ───────────────────────────────────────────
interface SidebarItem {
  id: string
  title: string
  sub: string
  coverUrl?: string
  type: 'local-library' | 'local-playlist' | 'netease-playlist' | 'qq-playlist'
  playlistId?: string
  neteasePlaylistId?: number
  qqPlaylistId?: string
}

const leftItems = computed<SidebarItem[]>(() => {
  if (loading.value) return []
  const items: SidebarItem[] = []
  for (const groupId of displayOrder.value) {
    if (groupId.startsWith('playlist-')) {
      const plId = groupId.slice(9)
      const pl = playlistStore.playlists.find(p => p.id === plId)
      if (pl) {
        // If playlist has a custom cover, use it.
        // Otherwise, fall back to the first track's cover for display.
        let coverUrl = pl.coverPath ? musicStore.toCoverUrl(pl.coverPath) : undefined
        if (!coverUrl) {
          const plTracks = playlistTracksCache.value[plId] ?? []
          const firstWithCover = plTracks.find(t => t.coverPath)
          if (firstWithCover) {
            coverUrl = musicStore.toCoverUrl(firstWithCover.coverPath)
          }
        }
        // Use cached track count for real-time display (falls back to playlist's trackCount)
        const cachedTracks = playlistTracksCache.value[plId]
        const trackCount = cachedTracks ? cachedTracks.length : pl.trackCount
        items.push({
          id: groupId,
          title: pl.name,
          sub: `${trackCount} 首`,
          coverUrl,
          type: 'local-playlist',
          playlistId: pl.id,
        })
      }
    }
  }
  return items
})

const neteaseItems = computed<SidebarItem[]>(() => {
  if (loading.value) return []
  const items: SidebarItem[] = []
  for (const groupId of displayOrder.value) {
    if (groupId.startsWith('netease-')) {
      const npId = Number(groupId.slice(8))
      const pl = neteasePlaylists.value.find(p => p.id === npId)
      if (pl) {
        items.push({
          id: groupId,
          title: pl.name,
          sub: `${pl.trackCount} 首`,
          coverUrl: pl.coverImgUrl ? pl.coverImgUrl + '?param=120x120' : undefined,
          type: 'netease-playlist',
          neteasePlaylistId: pl.id,
        })
      }
    }
  }
  return items
})

const qqItems = computed<SidebarItem[]>(() => {
  if (loading.value) return []
  const items: SidebarItem[] = []
  for (const groupId of displayOrder.value) {
    if (groupId.startsWith('qq-')) {
      const qpId = groupId.slice(3)
      const pl = qqPlaylists.value.find(p => p.id === qpId)
      if (pl) {
        items.push({
          id: groupId,
          title: pl.name,
          sub: `${pl.trackCount} 首`,
          coverUrl: pl.coverImgUrl || undefined,
          type: 'qq-playlist',
          qqPlaylistId: pl.id,
        })
      }
    }
  }
  return items
})

// Combined right items for backward compatibility (used in shelfHeaderTitle)
const rightItems = computed<SidebarItem[]>(() => [...neteaseItems.value, ...qqItems.value])

function onSidebarCardClick(item: SidebarItem) {
  // Toggle: click to add to selection, click again to remove
  const idx = activeGroupIds.value.indexOf(item.id)
  if (idx >= 0) {
    // Already selected — remove from selection
    activeGroupIds.value = activeGroupIds.value.filter(id => id !== item.id)
  } else {
    // Add to selection (append to maintain click order)
    activeGroupIds.value = [...activeGroupIds.value, item.id]
  }
  saveShelfPrefs()
  updateShelfTracks()
}

// ── Update shelf tracks (debounced to prevent rapid rebuilds) ──
let shelfUpdateTimer: ReturnType<typeof setTimeout> | null = null
function updateShelfTracks(): void {
  if (shelfUpdateTimer) clearTimeout(shelfUpdateTimer)
  shelfUpdateTimer = setTimeout(() => {
    recordShelf.setTracks(shelfTracks.value)
  }, 80)
}

// ── Context menu ────────────────────────────────────────────
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  trackId: '',
  track: null as Track | null,
})

// ── Lyrics editor ───────────────────────────────────────────
const showLyricsEditor = ref(false)
const editingTrack = ref<Track | null>(null)
const editorInitialLyrics = ref('')

// ── Lyrics import prompt ────────────────────────────────────
const showLyricsPrompt = ref(false)
const lastImportedTracks = ref<Track[]>([])

// ── Playlist picker ─────────────────────────────────────────
const playlistPickerTrack = ref<Track | null>(null)

// ── Create playlist dialog ──────────────────────────────────
const showCreateDialog = ref(false)
const newPlaylistName = ref('')
const newPlaylistDesc = ref('')

// ── Playlist manage dialog ──────────────────────────────────
const showPlaylistManage = ref(false)
const manageName = ref('')
const manageDesc = ref('')

// ── Import target dialog ────────────────────────────────────
const showImportTargetDialog = ref(false)
const pendingImportType = ref<'files' | 'folder'>('files')
const importTargetPlaylistId = ref<string | null>(null) // null = local library only

// ── Play error (uses global toast system) ────────────────
function showPlayError(msg: string) {
  toast.warning(msg)
}

// ── Data loading ────────────────────────────────────────────
async function loadLibrary(force = false) {
  try {
    const rows = await loadLibraryCached(force)
    tracks.value = (rows as any[]).map((t) => markRaw({
      id: t.id, title: t.title, artist: t.artist, album: t.album,
      duration: t.duration, coverPath: t.cover_path, source: t.source,
      sourceId: t.source_id, localPath: t.local_path,
      lyricsPath: t.lyrics_path, addedAt: t.added_at, lastPlayedAt: t.last_played_at
    }))
  } catch (e) {
    console.error('[MusicPage] Failed to load library:', e)
  }
}

async function loadAllPlaylistTracks(): Promise<void> {
  for (const pl of playlistStore.playlists) {
    // Skip if already cached — avoid redundant IPC calls on re-mount
    if (playlistTracksCache.value[pl.id]) continue
    try {
      await playlistStore.loadPlaylistDetail(pl.id)
      playlistTracksCache.value = { ...playlistTracksCache.value, [pl.id]: [...playlistStore.currentTracks] }
    } catch (e) {
      console.warn('[MusicPage] Failed to load playlist tracks:', pl.id, e)
    }
  }
}

async function loadNeteasePlaylists(force = false) {
if (!neteaseLoggedIn.value || !neteaseUserInfo.value?.userId) return
const uid = neteaseUserInfo.value.userId
try {
const list = await cachedFetch(
CacheNS.NeteasePlaylists,
String(uid),
async () => {
const result = await window.electronAPI!.netease.getUserPlaylists(uid)
if (!result.success || !result.data) return []
return result.data.playlists || []
},
{ ttlMs: CacheTTL.PLAYLISTS, forceRefresh: force }
)
neteasePlaylists.value = list
} catch (e) {
console.error('[MusicPage] Failed to load netease playlists:', e)
}
}

// Refresh netease data when user likes/adds songs from search
async function onNeteaseDataChanged() {
if (!neteaseLoggedIn.value || !neteaseUserInfo.value?.userId) return
// Reload liked list from shared composable
const { loadLikedList } = useNeteaseLikes()
await loadLikedList(true)
await loadNeteasePlaylists(true)
// Reload tracks for all netease playlists (cache was invalidated)
neteaseTracksCache.value = {}
loadAllNeteasePlaylistTracks()
}

async function loadNeteasePlaylistTracks(playlistId: number): Promise<void> {
  try {
    const songs = await cachedFetch(
      CacheNS.NeteasePlaylistDetail,
      String(playlistId),
      async () => {
        const result = await window.electronAPI!.netease.getPlaylistDetail(playlistId)
        if (!result.success || !result.data) return []
        return result.data.tracks || []
      },
      { ttlMs: CacheTTL.PLAYLIST_DETAIL }
    )
    neteaseTracksCache.value = { ...neteaseTracksCache.value, [playlistId]: songs.map(toNeteaseTrack) }
    // Ensure this playlist is in the display order
    const groupId = `netease-${playlistId}`
    if (!displayOrder.value.includes(groupId)) {
      displayOrder.value.push(groupId)
      saveDisplayOrder()
    }
    updateShelfTracks()
  } catch (e) {
    console.error('[MusicPage] Failed to load netease playlist tracks:', playlistId, e)
  }
}

/**
 * Load all netease playlist tracks sequentially to avoid overwhelming the
 * Netease API (which returns 502 ECONNRESET when too many concurrent
 * requests are made).
 * Guarded with a flag to prevent duplicate concurrent calls from
 * onMounted and the neteaseLoggedIn watcher firing simultaneously.
 */
let _loadingNeteaseTracks = false
async function loadAllNeteasePlaylistTracks(): Promise<void> {
  if (_loadingNeteaseTracks) return
  _loadingNeteaseTracks = true
  try {
    for (const pl of neteasePlaylists.value) {
      // Check cache first — skip if already loaded
      if (neteaseTracksCache.value[pl.id]?.length > 0) continue
      await loadNeteasePlaylistTracks(pl.id)
      // Small delay between requests to be gentle on the API
      await new Promise(r => setTimeout(r, 200))
    }
  } finally {
    _loadingNeteaseTracks = false
  }
}

// ── Netease login/logout ────────────────────────────────────
async function handleNeteaseLogin() {
  if (!window.electronAPI?.netease || neteaseLoginLoading.value) return
  neteaseLoginLoading.value = true
  try {
    const result = await window.electronAPI.netease.openLogin()
    if (result.success) {
  cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
  cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, '')
  await checkNeteaseShared(true)
  await loadNeteasePlaylists(true)
  // Load tracks for each netease playlist sequentially (avoid 502 ECONNRESET)
  loadAllNeteasePlaylistTracks()
}
} catch (e) {
  console.error('[MusicPage] Netease login failed:', e)
  } finally {
    neteaseLoginLoading.value = false
  }
}

async function handleNeteaseLogout() {
  if (!window.electronAPI?.netease) return
  await window.electronAPI.netease.logout()
  clearNeteaseStatus()
  neteasePlaylists.value = []
  neteaseTracksCache.value = {}
  // Remove netease entries from display order
  displayOrder.value = displayOrder.value.filter(id => !id.startsWith('netease-'))
  saveDisplayOrder()
  cacheInvalidatePrefix(CacheNS.NeteasePlaylists, '')
  cacheInvalidatePrefix(CacheNS.NeteasePlaylistDetail, '')
  cacheInvalidatePrefix(CacheNS.NeteaseSongUrl, '')
  cacheInvalidatePrefix(CacheNS.NeteaseLyric, '')
  toast.success('已退出网易云，正在重新打开登录窗口...')
  updateShelfTracks()
  // Re-open the Netease login window so the user can log in with a fresh session
  setTimeout(async () => {
    try {
      const result = await window.electronAPI?.netease?.openLogin()
      if (result?.success) {
      await checkNeteaseShared(true)
      await loadNeteasePlaylists(true)
      loadAllNeteasePlaylistTracks()
    }
  } catch (e) {
    console.error('[MusicPage] Re-login failed:', e)
    }
  }, 500)
}

// ── Netease track conversion ────────────────────────────────
function toNeteaseTrack(t: NeteaseSong): Track {
// Use thumbnail URL for album cover — full-size images are 500KB+ each
// and would overwhelm the renderer when loading 100+ tracks at once.
// 300x450 is sufficient for the 384x576 canvas used in the 3D shelf.
const rawPicUrl = t.al?.picUrl
const picUrl = rawPicUrl ? rawPicUrl + '?param=300x450' : undefined
return markRaw({
id: `ne_${t.id}`,
    title: t.name,
    artist: t.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
    album: t.al?.name || 'Unknown Album',
    duration: (t.dt || 0) / 1000,
    coverPath: picUrl,
    source: 'netease',
    sourceId: String(t.id),
    localPath: '',
    addedAt: new Date().toISOString()
  })
}

// ── QQ Music playlist/track loading ────────────────────────
async function loadQqPlaylists(force = false) {
  if (!qqLoggedIn.value) return
  try {
    const list = await cachedFetch(
      CacheNS.QqPlaylists,
      'user',
      async () => {
        const result = await window.electronAPI!.qq.getUserPlaylists()
        if (!result.success || !result.data) return []
        return result.data.playlists || []
      },
      { ttlMs: CacheTTL.PLAYLISTS, forceRefresh: force }
    )
    qqPlaylists.value = list
  } catch (e) {
    console.error('[MusicPage] Failed to load QQ playlists:', e)
  }
}

async function loadQqPlaylistTracks(playlistId: string): Promise<void> {
  try {
    const songs = await cachedFetch(
      CacheNS.QqPlaylistDetail,
      String(playlistId),
      async () => {
        const result = await window.electronAPI!.qq.getPlaylistDetail(playlistId)
        if (!result.success || !result.data) return []
        return result.data.tracks || []
      },
      { ttlMs: CacheTTL.PLAYLIST_DETAIL }
    )
    qqTracksCache.value = { ...qqTracksCache.value, [playlistId]: songs.map(toQqTrack) }
    // Ensure this playlist is in the display order
    const groupId = `qq-${playlistId}`
    if (!displayOrder.value.includes(groupId)) {
      displayOrder.value.push(groupId)
      saveDisplayOrder()
    }
    updateShelfTracks()
  } catch (e) {
    console.error('[MusicPage] Failed to load QQ playlist tracks:', playlistId, e)
  }
}

let _loadingQqTracks = false
async function loadAllQqPlaylistTracks(): Promise<void> {
  if (_loadingQqTracks) return
  _loadingQqTracks = true
  try {
    for (const pl of qqPlaylists.value) {
      if (qqTracksCache.value[pl.id]?.length > 0) continue
      await loadQqPlaylistTracks(pl.id)
      await new Promise(r => setTimeout(r, 200))
    }
  } finally {
    _loadingQqTracks = false
  }
}

// ── QQ login/logout ────────────────────────────────────
async function handleQqLogin() {
  if (!window.electronAPI?.qq || qqLoginLoading.value) return
  qqLoginLoading.value = true
  try {
    const result = await window.electronAPI.qq.openLogin()
    if (result.success) {
      cacheInvalidatePrefix(CacheNS.QqPlaylists, '')
      cacheInvalidatePrefix(CacheNS.QqPlaylistDetail, '')
      await checkQqShared(true)
      await loadQqPlaylists(true)
      loadAllQqPlaylistTracks()
    }
  } catch (e) {
    console.error('[MusicPage] QQ login failed:', e)
  } finally {
    qqLoginLoading.value = false
  }
}

async function handleQqLogout() {
  if (!window.electronAPI?.qq) return
  await window.electronAPI.qq.logout()
  clearQqStatus()
  qqPlaylists.value = []
  qqTracksCache.value = {}
  displayOrder.value = displayOrder.value.filter(id => !id.startsWith('qq-'))
  saveDisplayOrder()
  cacheInvalidatePrefix(CacheNS.QqPlaylists, '')
  cacheInvalidatePrefix(CacheNS.QqPlaylistDetail, '')
  cacheInvalidatePrefix(CacheNS.QqSongUrl, '')
  cacheInvalidatePrefix(CacheNS.QqLyric, '')
  toast.success('已退出QQ音乐')
  updateShelfTracks()
}

// ── QQ track conversion ────────────────────────────────
function toQqTrack(t: QqSong): Track {
  // Build cover URL from album mid
  const albumMid = t.album?.pmid || t.album?.mid
  const coverUrl = albumMid
    ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
    : undefined
  return markRaw({
    id: `qq_${t.songmid}`,
    title: t.name,
    artist: t.singer?.map(s => s.name).join(', ') || 'Unknown Artist',
    album: t.album?.name || 'Unknown Album',
    duration: t.interval || 0,
    coverPath: coverUrl,
    source: 'qq',
    sourceId: t.songmid,
    sourceMediaMid: t.strMediaMid || t.songmid || '',
    localPath: '',
    addedAt: new Date().toISOString(),
    vip: t.pay?.payplay === 1,
  })
}

// ── Play all ────────────────────────────────────────────────
function onPlayAll() {
  const list = shelfTracks.value
  if (list.length === 0) return
  musicStore.setQueue(list, 0)
  musicStore.playIndex(0)
  toast.success(`正在播放全部 ${list.length} 首`)
}

// ── Delete track ────────────────────────────────────────────
async function onDeleteTrack(track: Track) {
  if (track.source !== 'local') return
  try {
    const result = await window.electronAPI?.music.deleteTrack(track.id)
    if (result?.success) {
      if (musicStore.currentTrack?.id === track.id) {
        musicStore.stopAudio()
        musicStore.clearQueue()
      }
      tracks.value = tracks.value.filter(t => t.id !== track.id)
      // Remove from all playlist caches
      const updatedCache: Record<string, Track[]> = {}
      for (const key of Object.keys(playlistTracksCache.value)) {
        updatedCache[key] = playlistTracksCache.value[key].filter(t => t.id !== track.id)
      }
      playlistTracksCache.value = updatedCache
      invalidateLibrary()
      toast.success('已删除')
      updateShelfTracks()
    }
  } catch (e) {
    console.error('[MusicPage] Delete track failed:', e)
    toast.error('删除失败')
  }
}

// ── Import music ────────────────────────────────────────────
async function importMusic() {
if (!window.electronAPI) return
// If playlists exist, ask user to choose a target
if (playlistStore.playlists.length > 0) {
pendingImportType.value = 'files'
importTargetPlaylistId.value = null
showImportTargetDialog.value = true
return
}
// No playlists — auto-create "本地音乐" and import into it
await performImportWithAutoPlaylist('files')
}

async function importFolder() {
if (!window.electronAPI) return
// If playlists exist, ask user to choose a target
if (playlistStore.playlists.length > 0) {
pendingImportType.value = 'folder'
importTargetPlaylistId.value = null
showImportTargetDialog.value = true
return
}
// No playlists — auto-create "本地音乐" and import into it
await performImportWithAutoPlaylist('folder')
}

async function performImport(type: 'files' | 'folder', targetPlaylistId: string | null) {
  if (!window.electronAPI) return
  const result = type === 'files'
    ? await window.electronAPI.music.pickFiles()
    : await window.electronAPI.music.scanFolder('')
  if (!result.success) return

  const importedRaw = (result.data?.tracks ?? []) as any[]
  const duplicateRaw = (result.data?.duplicates ?? []) as any[]

  // User cancelled file picker (nothing imported and nothing duplicate)
  if (importedRaw.length === 0 && duplicateRaw.length === 0) return

  // Refresh library if new tracks were imported
  if (importedRaw.length > 0) {
    invalidateLibrary()
    await loadLibrary(true)
  }

  const importedTracks = importedRaw.map(t => ({
    id: t.id, title: t.title, artist: t.artist, album: t.album,
    duration: t.duration, coverPath: t.cover_path, source: t.source,
    sourceId: t.source_id, localPath: t.local_path,
    lyricsPath: t.lyrics_path, addedAt: t.added_at, lastPlayedAt: t.last_played_at
  }))

  // If a target playlist was selected, add both new and duplicate tracks to it
  if (targetPlaylistId) {
    // Combine new track IDs + duplicate track IDs (duplicates are existing tracks that can be added to playlist)
    const allTrackIds = [
      ...importedRaw.map(t => t.id),
      ...duplicateRaw.map(t => t.id),
    ]
    const added = await playlistStore.addTracks(targetPlaylistId, allTrackIds)
    // Explicitly load the playlist detail to populate currentTracks —
    // addTracks only reloads tracks if currentPlaylist already matches,
    // which is NOT the case for newly-created playlists.
    await playlistStore.loadPlaylistDetail(targetPlaylistId)
    // Force-refresh playlists list so trackCount updates in the sidebar
    await playlistStore.loadPlaylists(true)
    const pl = playlistStore.playlists.find(p => p.id === targetPlaylistId)
    const plName = pl?.name ?? '未知'

    if (importedRaw.length > 0 && duplicateRaw.length > 0) {
      // Mixed: some new, some duplicate
      if (added > 0) {
        toast.success(`已导入 ${importedRaw.length} 首歌曲到歌单「${plName}」，${duplicateRaw.length} 首已存在已自动添加`)
      } else {
        toast.warning(`歌曲已存在于本地库，但添加到歌单失败（可能歌单中已存在）`)
      }
    } else if (importedRaw.length > 0) {
      // All new
      if (added > 0) {
        toast.success(`已导入 ${importedRaw.length} 首歌曲到歌单「${plName}」`)
      } else {
        toast.warning(`歌曲已导入本地库，但添加到歌单失败（可能已存在）`)
      }
    } else {
      // All duplicates
      if (added > 0) {
        toast.success(`${duplicateRaw.length} 首歌曲已存在于本地库，已添加到歌单「${plName}」`)
      } else {
        toast.info(`${duplicateRaw.length} 首歌曲已存在于本地库，且歌单中已包含这些歌曲`)
      }
    }

    // Refresh playlist tracks cache
    playlistTracksCache.value = { ...playlistTracksCache.value, [targetPlaylistId]: [...playlistStore.currentTracks] }
  } else {
    // No target playlist — import to library only
    if (importedRaw.length > 0 && duplicateRaw.length > 0) {
      toast.success(`已导入 ${importedRaw.length} 首歌曲，${duplicateRaw.length} 首已存在已跳过`)
    } else if (importedRaw.length > 0) {
      toast.success(`已导入 ${importedRaw.length} 首歌曲`)
    } else {
      toast.info(`${duplicateRaw.length} 首歌曲已存在于本地库`)
    }
  }

  lastImportedTracks.value = importedTracks
  showLyricsPrompt.value = importedTracks.length > 0
  updateShelfTracks()
}

async function confirmImportTarget() {
showImportTargetDialog.value = false
const targetId = importTargetPlaylistId.value
if (targetId) {
await performImport(pendingImportType.value, targetId)
} else {
// User chose "仅导入到本地库" — auto-create a playlist instead
await performImportWithAutoPlaylist(pendingImportType.value)
}
}

/**
 * Auto-create a playlist with name "本地音乐", "本地音乐1", "本地音乐2"…
 * and import tracks into it. Used when no target playlist is selected.
 */
async function performImportWithAutoPlaylist(type: 'files' | 'folder') {
// Generate a unique name: "本地音乐", "本地音乐1", "本地音乐2"…
let baseName = '本地音乐'
let suffix = 0
const existingNames = new Set(playlistStore.playlists.map(p => p.name))
while (existingNames.has(suffix === 0 ? baseName : `${baseName}${suffix}`)) {
suffix++
}
const playlistName = suffix === 0 ? baseName : `${baseName}${suffix}`
const pl = await playlistStore.createPlaylist(playlistName)
if (!pl) {
toast.error('创建歌单失败')
return
}
// Ensure the new playlist is in displayOrder
const groupId = `playlist-${pl.id}`
if (!displayOrder.value.includes(groupId)) {
displayOrder.value.push(groupId)
saveDisplayOrder()
}
await performImport(type, pl.id)
}

// Import music directly into a specific playlist (used by "导入到此歌单" button)
async function importToCurrentPlaylist() {
  if (activeGroupIds.value.length !== 1 || !activeGroupIds.value[0].startsWith('playlist-')) return
  const plId = activeGroupIds.value[0].slice(9)
  await performImport('files', plId)
}

async function clearAll() {
  if (!window.electronAPI) return
  if (tracks.value.length === 0 && playlistStore.playlists.length === 0) return
  const ok = await toast.confirm({
    title: '清空音乐库',
    message: '确定要清空本地音乐库吗？此操作不可恢复。',
    confirmText: '清空',
    danger: true,
  })
  if (!ok) return
  try {
    const result = await window.electronAPI.music.clearLibrary()
    if (result.success) {
      musicStore.stopAudio()
      musicStore.clearQueue()
      // Reset ONLY local data — netease/qq caches must survive
      resetLocalOnly()
      invalidateLibrary()
      // Force-reload playlist store — clearLibrary also wiped playlists in DB
      await playlistStore.loadPlaylists(true)
      // Clear only local entries from sidebar display order
      // (netease-* and qq-* entries stay)
      displayOrder.value = displayOrder.value.filter(id => !id.startsWith('playlist-'))
      saveDisplayOrder()
      // Clear only local active group selections (keep netease/qq selections)
      activeGroupIds.value = activeGroupIds.value.filter(id => id.startsWith('netease-') || id.startsWith('qq-'))
      saveShelfPrefs()
      // Re-init the record shelf visualizer so it reflects the empty state
      // immediately (destroy + re-init creates a fresh canvas)
      recordShelf.destroy()
      const stageEl = document.querySelector<HTMLElement>('[data-music-page] [data-record-shelf-stage]')
      if (stageEl) {
        recordShelf.init(stageEl)
        recordShelf.onContext(onRecordContext)
      }
      toast.success('已清空音乐库')
      updateShelfTracks()
    }
  } catch (e) {
    console.error('[MusicPage] Failed to clear library:', e)
  }
}

// ── Lyrics ──────────────────────────────────────────────────
async function openLyricsEditor(track: Track) {
  editingTrack.value = track
  editorInitialLyrics.value = ''
  if (track.lyricsPath) {
    try {
      const result = await window.electronAPI?.music.readLyrics(track.lyricsPath)
      if (result?.success && result.data) {
        editorInitialLyrics.value = result.data.lyrics
      }
    } catch (e) {
      console.warn('[MusicPage] Failed to read lyrics:', e)
    }
  }
  showLyricsEditor.value = true
}

function onLyricsSaved(lyricsPath: string) {
  showLyricsEditor.value = false
  if (editingTrack.value) {
    const track = tracks.value.find(t => t.id === editingTrack.value?.id)
    if (track) track.lyricsPath = lyricsPath
  }
  editingTrack.value = null
}

async function uploadLrcFiles() {
  showLyricsPrompt.value = false
  if (!window.electronAPI?.lyrics?.pickLrcForTracks || lastImportedTracks.value.length === 0) return
  const trackIds = lastImportedTracks.value.map(t => t.id)
  const result = await window.electronAPI.lyrics.pickLrcForTracks({ trackIds })
  if (result.success && result.data) {
    const { matched, unmatched, total } = result.data
    if (total === 0) return
    if (matched > 0) {
      invalidateLibrary()
      await loadLibrary(true)
      toast.success(unmatched > 0 ? `成功匹配 ${matched} 首歌词，${unmatched} 首未找到` : `成功导入 ${matched} 首歌词`)
    } else if (unmatched > 0) {
      toast.error(`${unmatched} 个歌词文件未能关联到歌曲`)
    }
  } else if (result.error) {
    toast.error(`导入失败: ${result.error}`)
  }
}

function manualEditLyrics() {
  showLyricsPrompt.value = false
  if (lastImportedTracks.value.length === 0) return
  openLyricsEditor(lastImportedTracks.value[0])
}

// ── Playlist picker ─────────────────────────────────────────
function openPlaylistPicker(track: Track) {
  playlistPickerTrack.value = track
}

async function addToPlaylist(playlistId: string) {
  if (!playlistPickerTrack.value) return
  const trackId = playlistPickerTrack.value.id
  const added = await playlistStore.addTracks(playlistId, [trackId])
  playlistPickerTrack.value = null
  if (added > 0) {
    const pl = playlistStore.playlists.find(p => p.id === playlistId)
    toast.success(`已添加到歌单「${pl?.name ?? '未知'}」`)
    // Refresh cache
    await playlistStore.loadPlaylistDetail(playlistId)
    playlistTracksCache.value = { ...playlistTracksCache.value, [playlistId]: [...playlistStore.currentTracks] }
    updateShelfTracks()
  } else {
    toast.error('添加失败，歌曲可能已在歌单中')
  }
}

// ── Create playlist ─────────────────────────────────────────
async function onCreatePlaylist() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  const pl = await playlistStore.createPlaylist(name, newPlaylistDesc.value.trim() || undefined)
  if (pl) {
    showCreateDialog.value = false
    newPlaylistName.value = ''
    newPlaylistDesc.value = ''
    toast.success(`已创建歌单「${name}」`)
    // Add to display order
    const groupId = `playlist-${pl.id}`
    if (!displayOrder.value.includes(groupId)) {
      // Insert before netease entries
      const firstNetease = displayOrder.value.findIndex(id => id.startsWith('netease-') || id.startsWith('qq-'))
      if (firstNetease >= 0) {
        displayOrder.value.splice(firstNetease, 0, groupId)
      } else {
        displayOrder.value.push(groupId)
      }
      saveDisplayOrder()
    }
    playlistTracksCache.value = { ...playlistTracksCache.value, [pl.id]: [] }
    // Auto-select the new playlist
    activeGroupIds.value = [groupId]
    saveShelfPrefs()
    updateShelfTracks()
    // Offer to import music into the new playlist
    const wantImport = await toast.confirm({
      title: '导入音乐',
      message: `是否立即为歌单「${name}」导入音乐？`,
      confirmText: '导入音乐',
      cancelText: '暂不',
    })
    if (wantImport) {
      await performImport('files', pl.id)
    }
  }
}

// ── Playlist manage ─────────────────────────────────────────
function openPlaylistManage() {
  // Find the first local playlist in the active group
  if (activeGroupIds.value.length !== 1 || !activeGroupIds.value[0].startsWith('playlist-')) return
  const plId = activeGroupIds.value[0].slice(9)
  const pl = playlistStore.playlists.find(p => p.id === plId)
  if (!pl) return
  manageName.value = pl.name
  manageDesc.value = pl.description || ''
  showPlaylistManage.value = true
}

async function onSavePlaylist() {
  if (activeGroupIds.value.length !== 1 || !activeGroupIds.value[0].startsWith('playlist-')) return
  const plId = activeGroupIds.value[0].slice(9)
  const name = manageName.value.trim()
  if (!name) return
  await playlistStore.updatePlaylist(plId, {
    name,
    description: manageDesc.value.trim() || undefined,
  })
  showPlaylistManage.value = false
  toast.success('歌单已更新')
}

async function onDeletePlaylist() {
  if (activeGroupIds.value.length !== 1 || !activeGroupIds.value[0].startsWith('playlist-')) return
  const plId = activeGroupIds.value[0].slice(9)
  const ok = await toast.confirm({
    title: '删除歌单',
    message: '确定要删除这个歌单吗？此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  const success = await playlistStore.deletePlaylist(plId)
  if (success) {
    showPlaylistManage.value = false
    activeGroupIds.value = activeGroupIds.value.filter(id => id !== `playlist-${plId}`)
    // Remove from display order
    displayOrder.value = displayOrder.value.filter(id => id !== `playlist-${plId}`)
    saveDisplayOrder()
    const { [plId]: _removed, ...restCache } = playlistTracksCache.value
    playlistTracksCache.value = restCache
    toast.success('歌单已删除')
    updateShelfTracks()
  }
}

/** Delete a local playlist directly from the sidebar item (without opening the manage dialog). */
async function onDeletePlaylistFromSidebar(item: SidebarItem) {
  if (!item.playlistId) return
  const ok = await toast.confirm({
    title: '删除歌单',
    message: `确定要删除歌单「${item.title}」吗？此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  const success = await playlistStore.deletePlaylist(item.playlistId)
  if (success) {
    // Close manage dialog if it was open for this playlist
    if (showPlaylistManage.value && activeGroupIds.value[0] === item.id) {
      showPlaylistManage.value = false
    }
    // Remove from active selection
    activeGroupIds.value = activeGroupIds.value.filter(id => id !== item.id)
    // Remove from display order
    displayOrder.value = displayOrder.value.filter(id => id !== item.id)
    saveDisplayOrder()
    // Clear track cache for this playlist
    const { [item.playlistId]: _removed, ...restCache } = playlistTracksCache.value
    playlistTracksCache.value = restCache
    toast.success('歌单已删除')
    updateShelfTracks()
  }
}

// ── Context menu handlers ───────────────────────────────────
function onRecordContext(trackId: string, x: number, y: number) {
  const track = shelfTracks.value.find(t => t.id === trackId)
  if (!track) return
  const menuW = 180
  const menuH = 200
  const adjustedX = Math.min(x, window.innerWidth - menuW - 8)
  const adjustedY = Math.min(y, window.innerHeight - menuH - 8)
  contextMenu.visible = true
  contextMenu.x = adjustedX
  contextMenu.y = adjustedY
  contextMenu.trackId = trackId
  contextMenu.track = track
}

function closeContextMenu() {
  contextMenu.visible = false
  contextMenu.track = null
}

function onContextPlay() {
  const track = contextMenu.track
  if (!track) return
  const list = shelfTracks.value
  const index = list.findIndex(t => t.id === track.id)
  if (index >= 0) {
    musicStore.setQueue(list, index)
    musicStore.playIndex(index)
  }
  closeContextMenu()
}

function onContextEditLyrics() {
  if (contextMenu.track) openLyricsEditor(contextMenu.track)
  closeContextMenu()
}

function onContextAddToPlaylist() {
  if (contextMenu.track) openPlaylistPicker(contextMenu.track)
  closeContextMenu()
}

function onContextDelete() {
  if (contextMenu.track) onDeleteTrack(contextMenu.track)
  closeContextMenu()
}

// ── Cover error ─────────────────────────────────────────────
function onCoverError(e: Event) {
  const img = e.target as HTMLImageElement
  // Remove the src so the broken-image icon doesn't show, but keep
  // the parent container visible (display:none would permanently hide
  // the cover even after the track changes).
  img.removeAttribute('src')
  img.style.visibility = 'hidden'
}

// ── Watchers ────────────────────────────────────────────────
watch(neteaseLoggedIn, (loggedIn) => {
  if (loggedIn) {
    loadNeteasePlaylists().then(() => {
      loadAllNeteasePlaylistTracks()
    })
  } else {
    neteasePlaylists.value = []
    neteaseTracksCache.value = {}
    displayOrder.value = displayOrder.value.filter(id => !id.startsWith('netease-'))
    saveDisplayOrder()
    updateShelfTracks()
  }
})

watch(qqLoggedIn, (loggedIn) => {
  if (loggedIn) {
    loadQqPlaylists().then(() => {
      loadAllQqPlaylistTracks()
    })
  } else {
    qqPlaylists.value = []
    qqTracksCache.value = {}
    displayOrder.value = displayOrder.value.filter(id => !id.startsWith('qq-'))
    saveDisplayOrder()
    updateShelfTracks()
  }
})

// ── Lifecycle ───────────────────────────────────────────────
let sectionObserver: IntersectionObserver | null = null

onMounted(async () => {
  const stageEl = document.querySelector<HTMLElement>('[data-music-page] [data-record-shelf-stage]')
  if (stageEl) {
    registerStage('music', stageEl)
    recordShelf.init(stageEl)
    recordShelf.onContext(onRecordContext)
  }

  // Load persisted shelf preferences (spacing, sidebarPersist) after
  // recordShelf is initialized so the spacing watcher can safely call setSpacing.
  loadShelfPrefs()

  // 横向单页架构: 页面挂载 = 可见, 卸载 = 不可见
  // 不再需要 IntersectionObserver, onUnmounted 中的 recordShelf.dispose() 负责暂停

  window.addEventListener('click', closeContextMenu)

// Listen for netease data changes (e.g. user liked a song from search)
window.addEventListener('beatzfit:neteaseDataChanged', onNeteaseDataChanged)

  // ── 进入页面即激活 3D 交互 ──
  // 等待 recordShelf 初始化 + canvas reparent 完成后绑定
  nextTick(() => {
    // 从 visualizer 当前状态初始化, 避免重挂载时从 0 lerp 导致旋转动画
    if (visualizer.value) {
      const t = visualizer.value.getCoverTransform()
      if (t) {
        visTargetRX = visDisplayRX = t.rotationX
        visTargetRY = visDisplayRY = t.rotationY
        visTargetScale = visDisplayScale = t.scale
      }
    }
    startVisualizerInteraction()
  })

  // ── Fast path: if data already loaded from a previous mount, skip IPC ──
  // The horizontal single-page architecture unmounts/remounts the component
  // on every page switch. Without this guard, each visit re-fetches all
  // library tracks, playlists, and netease data — causing visible lag.
  if (_musicDataLoaded) {
    loading.value = false
    initDisplayOrder()
    await nextTick()
    updateShelfTracks()
    recordShelf.setSpacing(spacing.value)
    return
  }

  // ── Slow path: first mount — load everything from IPC ──
  if (_musicDataLoading) return // Prevent concurrent loads (HMR edge case)
  setMusicDataLoading(true)

  // Start skeleton shimmer animation
  const shimmerCleanup = animateShimmerAll(document.querySelector('.shelf-skeleton'))
  const loadStartTime = performance.now()

  try {
    if (window.electronAPI) {
      await Promise.all([
        loadLibrary(),
        playlistStore.loadPlaylists(),
        checkNeteaseShared(),
        checkQqShared(),
      ])

      // Load all local playlist tracks
      await loadAllPlaylistTracks()

      // Load netease playlists if logged in
      if (neteaseLoggedIn.value) {
        await loadNeteasePlaylists()
        // Fetch netease playlist tracks sequentially in background (don't block UI)
        loadAllNeteasePlaylistTracks()
      }

      // Load QQ playlists if logged in
      if (qqLoggedIn.value) {
        await loadQqPlaylists()
        loadAllQqPlaylistTracks()
      }
    }
    setMusicDataLoaded(true)
  } catch (e) {
    console.error('[MusicPage] Failed to initialize:', e)
  } finally {
    setMusicDataLoading(false)
    // Ensure skeleton is visible for at least 500ms to avoid jarring flash
    const elapsed = performance.now() - loadStartTime
    if (elapsed < 500) {
      await new Promise(r => setTimeout(r, 500 - elapsed))
    }
    shimmerCleanup()
    // Initialize display order
    initDisplayOrder()
    loading.value = false
    await nextTick()
    // Show all tracks on the shelf
    updateShelfTracks()
    // Apply initial spacing
    recordShelf.setSpacing(spacing.value)
    // Preload covers for the first 40 tracks in the background.
    // This runs AFTER the shelf is visible so the user sees immediate
    // response, and covers load progressively as the shelf scrolls.
    // The shared module-level image cache (with createImageBitmap
    // off-main-thread decoding) means these images will be ready when
    // the visualizer creates records for them.
    if (allTracks.value.length > 0) {
      recordShelf.preloadCovers(allTracks.value, 40)
    }
  }
})

// Must use onBeforeUnmount for unregisterStage so the canvas is moved back
// BEFORE Vue destroys the stage DOM.
onBeforeUnmount(() => {
  detachInteraction()
  if (visRAFId) {
    cancelAnimationFrame(visRAFId)
    visRAFId = 0
  }
  unregisterStage('music')
})

onUnmounted(() => {
window.removeEventListener('click', closeContextMenu)
window.removeEventListener('beatzfit:neteaseDataChanged', onNeteaseDataChanged)
  if (sectionObserver) {
    sectionObserver.disconnect()
    sectionObserver = null
  }
recordShelf.dispose()
if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
if (leftHideTimer) clearTimeout(leftHideTimer)
if (rightHideTimer) clearTimeout(rightHideTimer)
if (shelfUpdateTimer) clearTimeout(shelfUpdateTimer)
})
</script>

<style lang="scss" scoped>
.music-page {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ── Layer hierarchy ──
   z-index 30: sidebars (floating overlays)
   z-index 20: record shelf canvas (translateZ(200px) — front layer)
   z-index 0:  global visualizer canvas (translateZ(-1px) — full-screen background)
   z-index 0:  bottom (black overlay + smoke from GlobalBackground)
   Perspective: 1500px (lower = stronger depth effect)
   Record shelf at 200px: 1500/1300 = 1.154 → 15.4% larger (closer)
   Visualizer at -1px: ~100% (fills screen, no shrink)
*/

/* ── Shelf Area (full width) ── */
.shelf-area {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 1;
}

.shelf-header {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: rgba(12, 12, 16, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  max-width: 80%;
}

.shelf-header-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.shelf-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(234, 242, 248, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shelf-sub {
  font-size: 11px;
  color: rgba(234, 242, 248, 0.4);
  margin-top: 1px;
}

.shelf-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.shelf-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;

  &:hover { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.95); }
  &--active {
    background: rgba(68, 136, 255, 0.15);
    border-color: rgba(68, 136, 255, 0.3);
    color: rgba(68, 136, 255, 0.9);
  }
  &--accent {
    background: rgba(250, 88, 106, 0.12);
    border-color: rgba(250, 88, 106, 0.2);
    color: rgba(250, 88, 106, 0.9);
    &:hover { background: rgba(250, 88, 106, 0.2); }
  }
  &--danger {
    color: rgba(229, 57, 53, 0.7);
    border-color: rgba(229, 57, 53, 0.15);
    &:hover { background: rgba(229, 57, 53, 0.1); color: rgba(229, 57, 53, 0.9); }
  }
}

/* ── Spacing slider ── */
.spacing-control {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.5);
}

.spacing-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  outline: none;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    &:hover { background: rgba(255, 255, 255, 0.9); }
  }
  &::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }
}

/* ── Header Search (integrated into shelf-header) ── */
.header-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.4);
  min-width: 140px;
  transition: border-color 0.2s;
  &:focus-within { border-color: rgba(255, 255, 255, 0.2); }
}

.header-search-input {
  background: none;
  border: none;
  outline: none;
  color: rgba(255, 255, 255, 0.9);
  font-size: 11px;
  flex: 1;
  &::placeholder { color: rgba(255, 255, 255, 0.25); }
}

.header-search-clear {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  &:hover { color: rgba(255, 255, 255, 0.8); }
}

/* ── Record Shelf Stage ── */
.record-shelf-stage {
position: absolute;
inset: 0;
overflow: visible; /* Allow canvas to extend beyond stage bounds */
perspective: 1500px;
transform-style: preserve-3d;
  z-index: 1;
  cursor: pointer;
  transition: cursor 0.2s ease;

  &.stage-engaged {
    cursor: grab;
    &:active { cursor: grabbing; }
  }

  /* Global visualizer canvas reparented here.
     translateZ(-1px) keeps it behind the record shelf canvas (translateZ(200px))
     without the severe perspective shrink of translateZ(-600px) which caused
     3D objects to appear "trapped in a window" instead of filling the screen. */
  :deep(canvas:not(.record-shelf-canvas)) {
    display: block;
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
    pointer-events: none;
    z-index: 0;
    transform: translateZ(-1px);
  }

  /* Record shelf canvas — 顶层, translateZ 向前推以增强层次感 */
  :deep(canvas.record-shelf-canvas) {
    display: block;
    z-index: 20;
    transform: translateZ(200px);
  }

/* Global lyric layer: uses its own perspective:800px (like CoverflowListCard),
   no stage override needed. */
}

/* ── Empty state ── */
.empty-state {
  position: absolute;
  inset: 0;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  pointer-events: auto;
}

.empty-icon { color: rgba(255, 255, 255, 0.15); }
.empty-text { font-size: 14px; color: rgba(255, 255, 255, 0.35); margin: 0; }

.empty-btn {
  padding: 10px 24px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  cursor: pointer;
  transition: all 200ms ease;
  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 1);
    border-color: rgba(255, 255, 255, 0.25);
  }
}

/* ── Sidebar hover zones ── */
.sidebar-hover-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 16px;
  z-index: 28;
}
.sidebar-hover-zone-left { left: 0; }
.sidebar-hover-zone-right { right: 0; }

/* ── Sidebars (floating overlays) ── */
.sidebar {
position: absolute;
top: 64px;
bottom: calc(var(--player-bar-height, 0px) + 18px);
width: 240px;
z-index: 30;
  display: flex;
  flex-direction: column;
  background: rgba(10, 10, 16, 0.72);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease, transform 0.3s ease;

  &.visible {
    opacity: 1;
    pointer-events: auto;
  }
}

.sidebar-left {
  left: 12px;
  border-radius: 16px;
  transform: translateX(-30px);
  &.visible { transform: translateX(0); }
}

.sidebar-right {
  right: 12px;
  border-radius: 16px;
  transform: translateX(30px);
  &.visible { transform: translateX(0); }
}

.sidebar-header {
  padding: 20px 16px 12px;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

/* ── Sidebar tabs (right sidebar: Netease / QQ) ── */
.sidebar-tabs {
  display: flex;
  gap: 2px;
  padding: 10px 8px 6px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.sidebar-tab {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  cursor: pointer;
  transition: all 150ms ease;
  text-align: center;

  &:hover { background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.7); }
  &.active {
    background: rgba(68, 136, 255, 0.1);
    border-color: rgba(68, 136, 255, 0.2);
    color: rgba(68, 136, 255, 0.9);
  }
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

.sidebar-actions {
  padding: 10px 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.sidebar-card-wrapper {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 2px;
  border-radius: 10px;
  transition: background 160ms ease, border-color 160ms ease, opacity 160ms ease;
  border: 1px solid transparent;

  &.active {
    background: rgba(68, 136, 255, 0.1);
    border-color: rgba(68, 136, 255, 0.25);
  }

  &.drag-over {
    border-color: rgba(68, 136, 255, 0.4);
    background: rgba(68, 136, 255, 0.06);
  }

  &.dragging {
    opacity: 0.4;
  }
}

.sidebar-card {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  transition: all 160ms ease;
  text-align: left;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.08);
  }
}

.reorder-btns {
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0.3;
  transition: opacity 160ms ease;
}

.sidebar-card-wrapper:hover .reorder-btns {
  opacity: 1;
}

.reorder-btn {
  width: 22px;
  height: 18px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  transition: all 120ms ease;
  &:hover { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.95); }
  &:disabled { opacity: 0.15; cursor: default; }
}

/* Per-item delete button for local playlists — shows on hover */
.sidebar-delete-btn {
  width: 22px;
  height: 18px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  transition: all 120ms ease;
  opacity: 0;
  flex-shrink: 0;

  &:hover { background: rgba(255, 80, 80, 0.2); color: rgba(255, 120, 120, 1); }
}

.sidebar-card-wrapper:hover .sidebar-delete-btn {
  opacity: 0.6;
}

.sidebar-delete-btn:hover {
  opacity: 1 !important;
}

.card-thumb {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.04);
  position: relative;
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
}

.card-thumb--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.3);
}

.card-info { flex: 1; min-width: 0; }

.card-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(234, 242, 248, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-sub {
  font-size: 11px;
  color: rgba(234, 242, 248, 0.4);
  margin-top: 2px;
}

.sidebar-empty { padding: 16px 8px; }

.sidebar-empty-hint {
  display: block;
  padding: 12px 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
}

.sidebar-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
  width: 100%;
  justify-content: flex-start;

  &:hover { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.9); }
  &:disabled { opacity: 0.5; cursor: default; }
  &--danger {
    color: rgba(229, 57, 53, 0.7);
    border-color: rgba(229, 57, 53, 0.15);
    &:hover { background: rgba(229, 57, 53, 0.1); color: rgba(229, 57, 53, 0.9); }
  }
}

/* ── Context menu ── */
.context-menu {
  position: fixed;
  z-index: 500;
  min-width: 160px;
  padding: 6px;
  background: rgba(18, 18, 24, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 120ms ease;
  text-align: left;
  &:hover { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.95); }
  &--danger { color: rgba(229, 57, 53, 0.8); &:hover { background: rgba(229, 57, 53, 0.12); color: rgba(229, 57, 53, 1); } }
}

.ctx-divider { height: 1px; margin: 4px 8px; background: rgba(255, 255, 255, 0.06); }

.ctx-fade-enter-active, .ctx-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.ctx-fade-enter-from, .ctx-fade-leave-to { opacity: 0; transform: scale(0.95); }

/* ── Skeleton record shelf ── */
.shelf-skeleton {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 40px;
  flex-wrap: wrap;
  /* Opaque background covers the 3D record shelf canvas while loading */
  background: var(--bg-deep);
}
.skeleton-record {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 110px;
}
/* Rectangular cover card — matches the 2:3 aspect ratio of actual record shelf cards (RECORD_W:RECORD_H = 1.5:2.25) */
.skeleton-record-cover {
  width: 100px;
  height: 150px;
  border-radius: 10px;
}

/* ── Playlist picker ── */
.pp-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.pp-box {
  position: relative;
  width: 100%;
  max-width: 360px;
  background: rgba(18, 18, 24, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.pp-header {
  padding: 14px 18px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.pp-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
}

.pp-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.95); }
  &.pp-item--active { background: rgba(250, 88, 106, 0.15); color: #fa586a; .pp-item-count { color: rgba(250, 88, 106, 0.5); } }
}

.pp-item-count { font-size: 11px; color: rgba(255, 255, 255, 0.3); }
.pp-empty { padding: 20px; text-align: center; color: rgba(255, 255, 255, 0.3); font-size: 12px; }

/* ── Modals ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  padding: 40px;
}

.modal-box {
  position: relative;
  width: 100%;
  max-width: 460px;
  max-height: 80vh;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
}

.modal-box--sm { max-width: 420px; }

.modal-box-content {
  position: relative;
  z-index: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  &:focus { border-color: rgba(255, 255, 255, 0.3); }
  &::placeholder { color: rgba(255, 255, 255, 0.25); }
}

.modal-textarea {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  outline: none;
  resize: none;
  font-family: inherit;
  &:focus { border-color: rgba(255, 255, 255, 0.3); }
  &::placeholder { color: rgba(255, 255, 255, 0.25); }
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.float-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  &:hover { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.95); }
  &:disabled { opacity: 0.4; cursor: default; }
  &--accent {
    background: rgba(250, 88, 106, 0.15);
    border-color: rgba(250, 88, 106, 0.25);
    color: rgba(250, 88, 106, 0.9);
    &:hover { background: rgba(250, 88, 106, 0.25); }
  }
  &--danger {
    color: rgba(229, 57, 53, 0.8);
    border-color: rgba(229, 57, 53, 0.2);
    &:hover { background: rgba(229, 57, 53, 0.12); color: rgba(229, 57, 53, 1); }
  }
}

/* ── Lyrics editor ── */
.lyric-editor-modal {
  position: relative;
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  border-radius: 20px;
  overflow: hidden;
}

.lyric-editor-modal-content {
  position: relative;
  z-index: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 80vh;
}

.lyric-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.lyric-editor-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { background: rgba(255, 255, 255, 0.2); }
}

/* ── Transitions ── */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-8px); }

.slide-down-enter-active, .slide-down-leave-active { transition: opacity 0.25s, transform 0.25s; }
.slide-down-enter-from, .slide-down-leave-to { opacity: 0; transform: translateX(-50%) translateY(-12px); }
</style>
