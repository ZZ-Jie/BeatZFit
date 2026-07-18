export {}

declare global {
  interface Window {
    electronAPI?: {
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
        getLoginStatus: () => Promise<{ success: boolean; data?: { isLoggedIn: boolean; userInfo: import('./netease.d').NeteaseUserInfo | null } }>
        getUserPlaylists: (uid: number) => Promise<{ success: boolean; data?: { playlists: import('./netease.d').NeteasePlaylist[] } }>
        getPlaylistDetail: (id: number, limit?: number) => Promise<{ success: boolean; data?: { tracks: import('./netease.d').NeteaseSong[] } }>
        getSongUrl: (songId: number, level?: string) => Promise<{ success: boolean; data?: { url: import('./netease.d').NeteaseSongUrl } }>
        getLyric: (songId: number) => Promise<{ success: boolean; data?: { lyric: import('./netease.d').NeteaseLyric } }>
        search: (keywords: string, limit?: number) => Promise<{ success: boolean; data?: { songs: import('./netease.d').NeteaseSearchSong[] } }>
        like: (songId: number, like?: boolean) => Promise<{ success: boolean }>
        addToPlaylist: (trackId: number, playlistId: number) => Promise<{ success: boolean; message?: string }>
        searchPlaylists: (keywords: string, limit?: number) => Promise<{ success: boolean; data?: { playlists: any[] } }>
        getLikelist: (uid: number) => Promise<{ success: boolean; data?: { ids: number[] } }>
        subscribePlaylist: (id: number, subscribe?: boolean) => Promise<{ success: boolean }>
        logout: () => Promise<{ success: boolean }>
      }
      qq: {
        openLogin: () => Promise<{ success: boolean }>
        getLoginStatus: () => Promise<{ success: boolean; data?: { isLoggedIn: boolean; userInfo: import('./qq.d').QqUserInfo | null } }>
        getUserPlaylists: () => Promise<{ success: boolean; data?: { playlists: import('./qq.d').QqPlaylist[] } }>
        getPlaylistDetail: (id: string) => Promise<{ success: boolean; data?: { tracks: import('./qq.d').QqSong[] } }>
        getSongUrl: (songmid: string, quality?: string) => Promise<{ success: boolean; data?: { url: import('./qq.d').QqSongUrl } }>
        getLyric: (songmid: string) => Promise<{ success: boolean; data?: { lyric: import('./qq.d').QqLyric } }>
        search: (keywords: string, limit?: number) => Promise<{ success: boolean; data?: { songs: import('./qq.d').QqSearchSong[] } }>
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
      updater: {
        checkForUpdates: () => Promise<{ success: boolean; status: string }>
        downloadUpdate: () => Promise<{ success: boolean }>
        installUpdate: () => Promise<{ success: boolean }>
        getStatus: () => Promise<{ success: boolean; data?: { status: string; version: string | null; progress: number } }>
      }
      on: (channel: string, callback: (...args: any[]) => void) => void
      removeListener: (channel: string, callback: (...args: any[]) => void) => void
      send: (channel: string, ...args: any[]) => void
    }
  }
}
