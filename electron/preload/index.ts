import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  window: {
    minimize: () => Promise<{ success: boolean }>
    maximize: () => Promise<{ success: boolean; isMaximized: boolean }>
    close: () => Promise<{ success: boolean }>
    isMaximized: () => Promise<{ success: boolean; isMaximized: boolean }>
    toggleFullScreen: () => Promise<{ success: boolean; isFullScreen: boolean }>
    isFullScreen: () => Promise<{ success: boolean; isFullScreen: boolean }>
    getBounds: () => Promise<{ success: boolean; bounds: { x: number; y: number; width: number; height: number } }>
    setBounds: (bounds: { x?: number; y?: number; width: number; height: number }) => Promise<{ success: boolean }>
    unmaximize: () => Promise<{ success: boolean }>
  }
  music: {
    pickFiles: () => Promise<{ success: boolean; data?: { tracks: any[]; duplicates?: any[] } }>
    scanFolder: (folderPath: string) => Promise<{ success: boolean; data?: { tracks: any[]; duplicates?: any[] } }>
    getLibrary: () => Promise<{ success: boolean; data?: { tracks: any[] } }>
    deleteTrack: (trackId: string) => Promise<{ success: boolean; error?: string }>
    clearLibrary: () => Promise<{ success: boolean; data?: { count: number }; error?: string }>
    getLocalFilePath: (filePath: string) => Promise<{ success: boolean; data?: { url: string } }>
    readLyrics: (lyricsPath: string) => Promise<{ success: boolean; data?: { lyrics: string }; error?: string }>
    updateLastPlayed: (trackId: string) => Promise<{ success: boolean; error?: string }>
  }
  exercise: {
    syncFromAPI: () => Promise<{ success: boolean; data?: { total: number; failed: number; failedNames: string[] } }>
    autoSync: () => Promise<{ success: boolean; data?: { total: number; failed: number; failedNames: string[] } | { skipped: boolean } }>
    getSyncStatus: () => Promise<{ success: boolean; data?: { status: 'pending' | 'completed' | 'partial' | 'none' } }>
    list: (filter?: any) => Promise<{ success: boolean; data?: { exercises: any[] } }>
    getById: (id: string) => Promise<{ success: boolean; data?: { exercise: any } }>
    count: () => Promise<{ success: boolean; data?: { count: number } }>
    getBodyParts: () => Promise<{ success: boolean; data?: { bodyParts: string[] } }>
    getEquipments: () => Promise<{ success: boolean; data?: { equipments: string[] } }>
    onSyncProgress: (callback: (progress: { fetched: number; total: number; failed: number; newExercises: any[] }) => void) => () => void
  }
  workout: {
    createPlan: (plan: any) => Promise<{ success: boolean; data?: { plan: any } }>
    listPlans: () => Promise<{ success: boolean; data?: { plans: any[] } }>
    getPlan: (id: string) => Promise<{ success: boolean; data?: { plan: any } }>
    deletePlan: (id: string) => Promise<{ success: boolean }>
    updatePlan: (id: string, plan: any) => Promise<{ success: boolean; data?: { plan: any }; error?: string }>
    createRecord: (record: any) => Promise<{ success: boolean; data?: { record: any } }>
    listRecords: () => Promise<{ success: boolean; data?: { records: any[] } }>
    getStats: () => Promise<{ success: boolean; data?: { stats: any } }>
  }
  settings: {
    get: (key?: string) => Promise<{ success: boolean; data?: any }>
    set: (key: string, value: any) => Promise<{ success: boolean }>
    reset: () => Promise<{ success: boolean }>
    clearAllData: () => Promise<{ success: boolean }>
  }
  background: {
    pickImage: () => Promise<{ success: boolean; data?: { item: any; compressed: boolean }; error?: string }>
    getHistory: () => Promise<{ success: boolean; data?: { history: any[] }; error?: string }>
    applyHistoryImage: (id: string) => Promise<{ success: boolean; data?: { path: string }; error?: string }>
    deleteHistoryItem: (id: string) => Promise<{ success: boolean; error?: string }>
    reset: () => Promise<{ success: boolean; error?: string }>
  }
  netease: {
    openLogin: () => Promise<{ success: boolean }>
    getLoginStatus: () => Promise<{ success: boolean; data?: { isLoggedIn: boolean; userInfo: any } }>
    getUserPlaylists: (uid: number) => Promise<{ success: boolean; data?: { playlists: any[] } }>
    getPlaylistDetail: (id: number, limit?: number) => Promise<{ success: boolean; data?: { tracks: any[] } }>
    getSongUrl: (songId: number, level?: string) => Promise<{ success: boolean; data?: { url: any } }>
    getLyric: (songId: number) => Promise<{ success: boolean; data?: { lyric: any } }>
    search: (keywords: string, limit?: number) => Promise<{ success: boolean; data?: { songs: any[] } }>
    like: (songId: number, like?: boolean) => Promise<{ success: boolean }>
    addToPlaylist: (trackId: number, playlistId: number) => Promise<{ success: boolean; message?: string }>
    searchPlaylists: (keywords: string, limit?: number) => Promise<{ success: boolean; data?: { playlists: any[] } }>
    getLikelist: (uid: number) => Promise<{ success: boolean; data?: { ids: number[] } }>
    subscribePlaylist: (id: number, subscribe?: boolean) => Promise<{ success: boolean }>
    logout: () => Promise<{ success: boolean }>
  }
  qq: {
    openLogin: () => Promise<{ success: boolean }>
    getLoginStatus: () => Promise<{ success: boolean; data?: { isLoggedIn: boolean; userInfo: any } }>
    getUserPlaylists: () => Promise<{ success: boolean; data?: { playlists: any[] } }>
    getPlaylistDetail: (id: string) => Promise<{ success: boolean; data?: { tracks: any[] } }>
    getSongUrl: (songmid: string, quality?: string, strMediaMid?: string, isVip?: boolean) => Promise<{ success: boolean; data?: { url: any } }>
    getLyric: (songmid: string) => Promise<{ success: boolean; data?: { lyric: any } }>
    search: (keywords: string, limit?: number) => Promise<{ success: boolean; data?: { songs: any[] } }>
    logout: () => Promise<{ success: boolean }>
  }
  shortcuts: {
    get: () => Promise<{ success: boolean; data?: { shortcuts: any[]; defaults: any[] } }>
    update: (action: string, accelerator: string) => Promise<{ success: boolean; data?: { shortcuts: any[] }; error?: string }>
    reset: () => Promise<{ success: boolean; data?: { shortcuts: any[] } }>
  }
  playlist: {
    create: (data: { name: string; description?: string }) => Promise<{ success: boolean; data?: { playlist: any }; error?: string }>
    list: () => Promise<{ success: boolean; data?: { playlists: any[] }; error?: string }>
    get: (id: string) => Promise<{ success: boolean; data?: { playlist: any; tracks: any[] }; error?: string }>
    update: (id: string, data: { name?: string; description?: string }) => Promise<{ success: boolean; data?: { playlist: any }; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; error?: string }>
    addTracks: (data: { playlistId: string; trackIds: string[] }) => Promise<{ success: boolean; data?: { playlist: any; addedCount: number }; error?: string }>
    removeTrack: (data: { playlistId: string; trackId: string }) => Promise<{ success: boolean; data?: { playlist: any }; error?: string }>
    setCover: (data: { playlistId: string; coverPath: string }) => Promise<{ success: boolean; data?: { playlist: any }; error?: string }>
    pickCover: () => Promise<{ success: boolean; data?: { path: string }; error?: string }>
    reorderTrack: (data: { playlistId: string; fromTrackId: string; toTrackId: string }) => Promise<{ success: boolean; error?: string }>
  }
  lyrics: {
    save: (data: { trackId: string; lrcText: string; translation?: string }) => Promise<{ success: boolean; data?: { lyricsPath: string }; error?: string }>
    searchOnline: (data: { title: string; artist?: string }) => Promise<{ success: boolean; data?: { songs: any[] }; error?: string }>
    fetchBySongId: (songId: number) => Promise<{ success: boolean; data?: { lrc: string; translation: string | null; hasTranslation: boolean; nolyric: boolean }; error?: string }>
    clear: (trackId: string) => Promise<{ success: boolean; error?: string }>
    pickLrcForTracks: (data: { trackIds: string[] }) => Promise<{ success: boolean; data?: { matched: number; unmatched: number; total: number; matchedTrackIds?: string[] }; error?: string }>
  }
  desktopLyric: {
    toggle: () => Promise<{ success: boolean; data?: { visible: boolean } }>
    show: () => Promise<{ success: boolean; data?: { visible: boolean } }>
    hide: () => Promise<{ success: boolean; data?: { visible: boolean } }>
    isVisible: () => Promise<{ success: boolean; data?: { visible: boolean } }>
    setPosition: (data: { x: number; y: number }) => Promise<{ success: boolean; error?: string }>
    getPosition: () => Promise<{ success: boolean; data?: { x: number; y: number }; error?: string }>
    setBounds: (data: { width: number; height: number; x?: number; y?: number }) => Promise<{ success: boolean; error?: string }>
    getBounds: () => Promise<{ success: boolean; data?: { x: number; y: number; width: number; height: number }; error?: string }>
    showSettings: () => Promise<{ success: boolean; error?: string }>
    hideSettings: () => Promise<{ success: boolean; error?: string }>
  }
  on: (channel: string, callback: (...args: any[]) => void) => void
  removeListener: (channel: string, callback: (...args: any[]) => void) => void
  send: (channel: string, ...args: any[]) => void
}

const electronAPI: ElectronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    getBounds: () => ipcRenderer.invoke('window:getBounds'),
    setBounds: (bounds: { x?: number; y?: number; width: number; height: number }) => ipcRenderer.invoke('window:setBounds', bounds),
    unmaximize: () => ipcRenderer.invoke('window:unmaximize')
  },
  music: {
    pickFiles: () => ipcRenderer.invoke('music:pickFiles'),
    scanFolder: (folderPath: string) => ipcRenderer.invoke('music:scanFolder', folderPath),
    getLibrary: () => ipcRenderer.invoke('music:getLibrary'),
    deleteTrack: (trackId: string) => ipcRenderer.invoke('music:deleteTrack', trackId),
    clearLibrary: () => ipcRenderer.invoke('music:clearLibrary'),
    getLocalFilePath: (filePath: string) => ipcRenderer.invoke('music:getLocalFilePath', filePath),
    readLyrics: (lyricsPath: string) => ipcRenderer.invoke('music:readLyrics', lyricsPath),
    updateLastPlayed: (trackId: string) => ipcRenderer.invoke('music:updateLastPlayed', trackId)
  },
  exercise: {
    syncFromAPI: () => ipcRenderer.invoke('exercise:sync'),
    autoSync: () => ipcRenderer.invoke('exercise:autoSync'),
    getSyncStatus: () => ipcRenderer.invoke('exercise:syncStatus'),
    list: (filter?: any) => ipcRenderer.invoke('exercise:list', filter),
    getById: (id: string) => ipcRenderer.invoke('exercise:getById', id),
    count: () => ipcRenderer.invoke('exercise:count'),
    getBodyParts: () => ipcRenderer.invoke('exercise:getBodyParts'),
    getEquipments: () => ipcRenderer.invoke('exercise:getEquipments'),
    onSyncProgress: (callback: (progress: { fetched: number; total: number; failed: number; newExercises: any[] }) => void) => {
      const handler = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on('exercise:syncProgress', handler)
      return () => { ipcRenderer.removeListener('exercise:syncProgress', handler) }
    }
  },
  workout: {
    createPlan: (plan: any) => ipcRenderer.invoke('workout:createPlan', plan),
    listPlans: () => ipcRenderer.invoke('workout:listPlans'),
    getPlan: (id: string) => ipcRenderer.invoke('workout:getPlan', id),
    deletePlan: (id: string) => ipcRenderer.invoke('workout:deletePlan', id),
    updatePlan: (id: string, plan: any) => ipcRenderer.invoke('workout:updatePlan', id, plan),
    createRecord: (record: any) => ipcRenderer.invoke('workout:createRecord', record),
    listRecords: () => ipcRenderer.invoke('workout:listRecords'),
    getStats: () => ipcRenderer.invoke('workout:getStats')
  },
  settings: {
    get: (key?: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    reset: () => ipcRenderer.invoke('settings:reset'),
    clearAllData: () => ipcRenderer.invoke('settings:clearAllData')
  },
  background: {
    pickImage: () => ipcRenderer.invoke('background:pickImage'),
    getHistory: () => ipcRenderer.invoke('background:getHistory'),
    applyHistoryImage: (id: string) => ipcRenderer.invoke('background:applyHistoryImage', id),
    deleteHistoryItem: (id: string) => ipcRenderer.invoke('background:deleteHistoryItem', id),
    reset: () => ipcRenderer.invoke('background:reset')
  },
  netease: {
    openLogin: () => ipcRenderer.invoke('netease:openLogin'),
    getLoginStatus: () => ipcRenderer.invoke('netease:getLoginStatus'),
    getUserPlaylists: (uid: number) => ipcRenderer.invoke('netease:getUserPlaylists', uid),
    getPlaylistDetail: (id: number, limit?: number) => ipcRenderer.invoke('netease:getPlaylistDetail', id, limit),
    getSongUrl: (songId: number, level?: string) => ipcRenderer.invoke('netease:getSongUrl', songId, level),
    getLyric: (songId: number) => ipcRenderer.invoke('netease:getLyric', songId),
    search: (keywords: string, limit?: number) => ipcRenderer.invoke('netease:search', keywords, limit),
    like: (songId: number, like?: boolean) => ipcRenderer.invoke('netease:like', songId, like),
    addToPlaylist: (trackId: number, playlistId: number) => ipcRenderer.invoke('netease:addToPlaylist', trackId, playlistId),
    searchPlaylists: (keywords: string, limit?: number) => ipcRenderer.invoke('netease:searchPlaylists', keywords, limit),
    getLikelist: (uid: number) => ipcRenderer.invoke('netease:getLikelist', uid),
    subscribePlaylist: (id: number, subscribe?: boolean) => ipcRenderer.invoke('netease:subscribePlaylist', id, subscribe),
    logout: () => ipcRenderer.invoke('netease:logout')
  },
  qq: {
    openLogin: () => ipcRenderer.invoke('qq:openLogin'),
    getLoginStatus: () => ipcRenderer.invoke('qq:getLoginStatus'),
    getUserPlaylists: () => ipcRenderer.invoke('qq:getUserPlaylists'),
    getPlaylistDetail: (id: string) => ipcRenderer.invoke('qq:getPlaylistDetail', id),
    getSongUrl: (songmid: string, quality?: string, strMediaMid?: string, isVip?: boolean) => ipcRenderer.invoke('qq:getSongUrl', songmid, quality, strMediaMid, isVip),
    getLyric: (songmid: string) => ipcRenderer.invoke('qq:getLyric', songmid),
    search: (keywords: string, limit?: number) => ipcRenderer.invoke('qq:search', keywords, limit),
    logout: () => ipcRenderer.invoke('qq:logout')
  },
  shortcuts: {
    get: () => ipcRenderer.invoke('shortcuts:get'),
    update: (action: string, accelerator: string) => ipcRenderer.invoke('shortcuts:update', action, accelerator),
    reset: () => ipcRenderer.invoke('shortcuts:reset')
  },
  playlist: {
    create: (data: { name: string; description?: string }) => ipcRenderer.invoke('playlist:create', data),
    list: () => ipcRenderer.invoke('playlist:list'),
    get: (id: string) => ipcRenderer.invoke('playlist:get', id),
    update: (id: string, data: { name?: string; description?: string }) => ipcRenderer.invoke('playlist:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('playlist:delete', id),
    addTracks: (data: { playlistId: string; trackIds: string[] }) => ipcRenderer.invoke('playlist:addTracks', data),
    removeTrack: (data: { playlistId: string; trackId: string }) => ipcRenderer.invoke('playlist:removeTrack', data),
    setCover: (data: { playlistId: string; coverPath: string }) => ipcRenderer.invoke('playlist:setCover', data),
    pickCover: () => ipcRenderer.invoke('playlist:pickCover'),
    reorderTrack: (data: { playlistId: string; fromTrackId: string; toTrackId: string }) => ipcRenderer.invoke('playlist:reorderTrack', data),
  },
  lyrics: {
    save: (data: { trackId: string; lrcText: string; translation?: string }) => ipcRenderer.invoke('lyrics:save', data),
    searchOnline: (data: { title: string; artist?: string }) => ipcRenderer.invoke('lyrics:searchOnline', data),
    fetchBySongId: (songId: number) => ipcRenderer.invoke('lyrics:fetchBySongId', songId),
    clear: (trackId: string) => ipcRenderer.invoke('lyrics:clear', trackId),
    pickLrcForTracks: (data: { trackIds: string[] }) => ipcRenderer.invoke('lyrics:pickLrcForTracks', data),
  },
  desktopLyric: {
    toggle: () => ipcRenderer.invoke('desktopLyric:toggle'),
    show: () => ipcRenderer.invoke('desktopLyric:show'),
    hide: () => ipcRenderer.invoke('desktopLyric:hide'),
    isVisible: () => ipcRenderer.invoke('desktopLyric:isVisible'),
    setPosition: (data: { x: number; y: number }) => ipcRenderer.invoke('desktopLyric:setPosition', data),
    getPosition: () => ipcRenderer.invoke('desktopLyric:getPosition'),
    setBounds: (data: { width: number; height: number; x?: number; y?: number }) => ipcRenderer.invoke('desktopLyric:setBounds', data),
    getBounds: () => ipcRenderer.invoke('desktopLyric:getBounds'),
    showSettings: () => ipcRenderer.invoke('desktopLyric:showSettings'),
    hideSettings: () => ipcRenderer.invoke('desktopLyric:hideSettings'),
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },
  send: (channel: string, ...args: any[]) => {
    ipcRenderer.send(channel, ...args)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
