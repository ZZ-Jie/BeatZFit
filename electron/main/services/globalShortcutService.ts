import { globalShortcut, BrowserWindow, ipcMain } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

/**
 * Global Shortcut Service
 *
 * Registers OS-level shortcuts that work even when the app is not focused.
 * Two types of shortcuts are registered:
 *
 * 1. Media keys (always registered, not customizable):
 *    MediaPlayPause, MediaNextTrack, MediaPreviousTrack, MediaStop,
 *    VolumeUp, VolumeDown, VolumeMute
 *
 * 2. Keyboard shortcuts (customizable, stored in settings JSON):
 *    Play/Pause, Next, Previous, Volume Up, Volume Down, Mute
 *
 * Keyboard shortcuts use modifiers (Ctrl/Cmd + Shift + ...) + a key
 * to avoid conflicts with normal typing.
 */

export interface ShortcutBinding {
  action: string       // e.g. 'togglePlay'
  label: string        // e.g. '播放/暂停'
  accelerator: string  // e.g. 'CommandOrControl+Shift+P'
  channel: string      // IPC channel to send to renderer
}

// Default keyboard shortcuts — user can customize via Settings page
const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { action: 'togglePlay',  label: '播放/暂停',  accelerator: 'CommandOrControl+P',      channel: 'media:togglePlay' },
  { action: 'nextTrack',   label: '下一首',     accelerator: 'CommandOrControl+Right',  channel: 'media:nextTrack' },
  { action: 'prevTrack',   label: '上一首',     accelerator: 'CommandOrControl+Left',   channel: 'media:prevTrack' },
  { action: 'volumeUp',    label: '音量增大',   accelerator: 'CommandOrControl+Up',     channel: 'media:volumeUp' },
  { action: 'volumeDown',  label: '音量减小',   accelerator: 'CommandOrControl+Down',   channel: 'media:volumeDown' },
  { action: 'toggleMute',  label: '静音切换',   accelerator: 'CommandOrControl+M',      channel: 'media:toggleMute' },
]

// Media keys (always registered, not customizable)
const MEDIA_KEYS: { accelerator: string; channel: string }[] = [
  { accelerator: 'MediaPlayPause',    channel: 'media:togglePlay' },
  { accelerator: 'MediaNextTrack',    channel: 'media:nextTrack' },
  { accelerator: 'MediaPreviousTrack',channel: 'media:prevTrack' },
  { accelerator: 'MediaStop',         channel: 'media:stop' },
  { accelerator: 'VolumeUp',          channel: 'media:volumeUp' },
  { accelerator: 'VolumeDown',        channel: 'media:volumeDown' },
  { accelerator: 'VolumeMute',        channel: 'media:toggleMute' },
]

const SETTINGS_FILE = 'keyboard-shortcuts.json'

function getSettingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

// Old default shortcuts (pre-update, with Shift) — used for migration detection
const OLD_DEFAULT_ACCELERATORS = [
  'CommandOrControl+Shift+P',
  'CommandOrControl+Shift+Right',
  'CommandOrControl+Shift+Left',
  'CommandOrControl+Shift+Up',
  'CommandOrControl+Shift+Down',
  'CommandOrControl+Shift+M',
]

function loadCustomShortcuts(): ShortcutBinding[] {
  try {
    const p = getSettingsPath()
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, 'utf-8'))
      if (Array.isArray(data) && data.length > 0) {
        // Migration: if ALL saved accelerators match the old defaults,
        // replace with new defaults automatically.
        const allOldDefaults = data.length === OLD_DEFAULT_ACCELERATORS.length &&
          data.every((b: ShortcutBinding, i: number) => b.accelerator === OLD_DEFAULT_ACCELERATORS[i])
        if (allOldDefaults) {
          console.log('[GlobalShortcut] Migrating old default shortcuts to new defaults')
          const newDefaults = [...DEFAULT_SHORTCUTS]
          saveCustomShortcuts(newDefaults)
          return newDefaults
        }
        return data
      }
    }
  } catch { /* ignore */ }
  return [...DEFAULT_SHORTCUTS]
}

function saveCustomShortcuts(shortcuts: ShortcutBinding[]) {
  try {
    const p = getSettingsPath()
    const dir = join(p, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, JSON.stringify(shortcuts, null, 2))
  } catch { /* ignore */ }
}

export class GlobalShortcutService {
  private mainWindow: BrowserWindow | null = null
  private currentBindings: ShortcutBinding[] = []
  private ipcRegistered = false

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  registerAll() {
    // Register media keys (always on)
    for (const mk of MEDIA_KEYS) {
      this.register(mk.accelerator, mk.channel)
    }

    // Register customizable keyboard shortcuts
    this.currentBindings = loadCustomShortcuts()
    for (const binding of this.currentBindings) {
      this.register(binding.accelerator, binding.channel)
    }

    // Guard against double IPC handler registration (HMR / app reload)
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    // IPC: renderer requests current bindings (for Settings page display)
    ipcMain.handle('shortcuts:get', () => {
      return { success: true, data: { shortcuts: this.currentBindings, defaults: DEFAULT_SHORTCUTS } }
    })

    // IPC: renderer updates a binding
    ipcMain.handle('shortcuts:update', (_event, action: string, newAccelerator: string) => {
      // Validate accelerator string — reject anything with 'Unidentified' or empty
      if (!newAccelerator || typeof newAccelerator !== 'string') {
        return { success: false, error: '无效的快捷键' }
      }
      // Reject if it contains 'Unidentified' or other invalid key names
      const invalidPatterns = /Unidentified|Process|^$/
      if (invalidPatterns.test(newAccelerator)) {
        return { success: false, error: '无法识别的按键，请重新设置' }
      }
      // Must contain at least one modifier + one key
      const parts = newAccelerator.split('+')
      if (parts.length < 2) {
        return { success: false, error: '快捷键需要包含修饰键' }
      }

      const binding = this.currentBindings.find(b => b.action === action)
      if (!binding) return { success: false, error: 'Action not found' }

      // Unregister old accelerator
      try { globalShortcut.unregister(binding.accelerator) } catch { /* ignore */ }

      // Check for conflicts with other bindings
      const conflict = this.currentBindings.find(b => b.action !== action && b.accelerator === newAccelerator)
      if (conflict) {
        // Re-register old one since we failed
        this.register(binding.accelerator, binding.channel)
        return { success: false, error: `与「${conflict.label}」冲突` }
      }

      // Try to register the new accelerator
      binding.accelerator = newAccelerator
      const ret = globalShortcut.register(newAccelerator, () => {
        this.mainWindow?.webContents.send(binding.channel)
      })
      if (!ret) {
        // Registration failed — revert to default, don't re-register the old one
        // (it might have been a system-occupied shortcut that we shouldn't steal)
        const defaultAccel = DEFAULT_SHORTCUTS.find(d => d.action === action)?.accelerator
        binding.accelerator = defaultAccel || binding.accelerator
        if (defaultAccel) {
          this.register(binding.accelerator, binding.channel)
        }
        return { success: false, error: '快捷键注册失败，可能被系统或其他程序占用' }
      }

      saveCustomShortcuts(this.currentBindings)
      return { success: true, data: { shortcuts: this.currentBindings } }
    })

    // IPC: renderer resets all bindings to defaults
    ipcMain.handle('shortcuts:reset', () => {
      // Unregister all current keyboard shortcuts
      for (const binding of this.currentBindings) {
        try { globalShortcut.unregister(binding.accelerator) } catch { /* ignore */ }
      }
      // Reset to defaults
      this.currentBindings = [...DEFAULT_SHORTCUTS]
      for (const binding of this.currentBindings) {
        this.register(binding.accelerator, binding.channel)
      }
      saveCustomShortcuts(this.currentBindings)
      return { success: true, data: { shortcuts: this.currentBindings } }
    })
  }

  private register(accelerator: string, channel: string) {
    try {
      const ret = globalShortcut.register(accelerator, () => {
        this.mainWindow?.webContents.send(channel)
      })
      if (!ret) {
        console.warn(`[GlobalShortcut] Failed to register: ${accelerator}`)
      }
    } catch (e) {
      console.warn(`[GlobalShortcut] Error registering ${accelerator}:`, e)
    }
  }

  unregisterAll() {
    globalShortcut.unregisterAll()
  }
}
