import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'

// Reference to the main window (set via setMainWindow) so we can
// notify it when the desktop lyric visibility changes (e.g. when
// the user clicks the close button inside the lyric window).
let mainWindowRef: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindowRef = win
}

/** Notify the main renderer that visibility changed (e.g. close button). */
function notifyVisibilityChange(visible: boolean): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('desktopLyric:visibilityChanged', { visible })
  }
}

// ── Desktop Lyrics Floating Window ────────────────────────────
// A frameless, transparent, always-on-top window that floats above
// all other applications. It displays the current lyric line in
// large, stylized text.
//
// Hover detection: Main process polls cursor position every 50ms.
// When cursor is within window bounds → setIgnoreMouseEvents(false)
// (interactive). When cursor leaves → setIgnoreMouseEvents(true)
// (click-through). This bypasses Windows pixel-level hit testing
// on transparent windows, which is unreliable for low-alpha pixels.
// ──────────────────────────────────────────────────────────────

let lyricWindow: BrowserWindow | null = null
let isVisible = false

// Hover polling state
let hoverPollTimer: ReturnType<typeof setInterval> | null = null
let isCurrentlyInteractive = false

// Cache the last lyric data so we can re-send it when the window
// finishes loading (the first update might arrive before the renderer
// page has mounted and registered its IPC listener).
let lastLyricData: {
  currentLine: string
  nextLine: string
  translation?: string
  trackTitle?: string
  trackArtist?: string
} | null = null

// Minimum and maximum window dimensions for resize
const MIN_WIDTH = 400
const MAX_WIDTH = 2400
const MIN_HEIGHT = 80
const MAX_HEIGHT = 300

export function createDesktopLyricWindow(): BrowserWindow {
  if (lyricWindow && !lyricWindow.isDestroyed()) {
    return lyricWindow
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  const winWidth = Math.min(screenWidth - 80, 1200)
  const winHeight = 140
  const x = Math.round((screenWidth - winWidth) / 2)
  const y = Math.round(screenHeight - winHeight - 80)

  lyricWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../../dist-electron/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  })

  // Load the desktop lyric page
  if (process.env.VITE_DEV_SERVER_URL) {
    lyricWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/desktop-lyric`)
  } else {
    lyricWindow.loadFile(join(__dirname, '../../dist/index.html'), { hash: 'desktop-lyric' })
  }

  // Start in click-through mode. The hover polling will toggle
  // to interactive when the cursor enters the window bounds.
  lyricWindow.setIgnoreMouseEvents(true)
  isCurrentlyInteractive = false

  // Re-send cached lyric data once the page has finished loading.
  lyricWindow.webContents.on('did-finish-load', () => {
    if (lastLyricData && isVisible) {
      lyricWindow?.webContents.send('desktopLyric:lyricData', lastLyricData)
    }
  })

  lyricWindow.on('closed', () => {
    stopHoverPolling()
    lyricWindow = null
    isVisible = false
  })

  return lyricWindow
}

// ── Hover polling ──
// Every 50ms, check if the cursor is within the lyric window bounds.
// If yes → setIgnoreMouseEvents(false) + notify renderer.
// If no  → setIgnoreMouseEvents(true)  + notify renderer.
function startHoverPolling() {
  if (hoverPollTimer) return

  hoverPollTimer = setInterval(() => {
    if (!lyricWindow || lyricWindow.isDestroyed() || !isVisible) return

    const cursor = screen.getCursorScreenPoint()
    const bounds = lyricWindow.getBounds()

    const inside =
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height

    if (inside && !isCurrentlyInteractive) {
      // Cursor entered → make interactive
      isCurrentlyInteractive = true
      lyricWindow.setIgnoreMouseEvents(false)
      lyricWindow.webContents.send('desktopLyric:hoverEnter')
    } else if (!inside && isCurrentlyInteractive) {
      // Cursor left → make click-through
      isCurrentlyInteractive = false
      lyricWindow.setIgnoreMouseEvents(true)
      lyricWindow.webContents.send('desktopLyric:hoverLeave')
    }
  }, 50)
}

function stopHoverPolling() {
  if (hoverPollTimer) {
    clearInterval(hoverPollTimer)
    hoverPollTimer = null
  }
  isCurrentlyInteractive = false
}

export function showDesktopLyric(): void {
  if (!lyricWindow || lyricWindow.isDestroyed()) {
    createDesktopLyricWindow()
  }
  lyricWindow?.show()
  isVisible = true
  startHoverPolling()
  notifyVisibilityChange(true)
}

export function hideDesktopLyric(): void {
  stopHoverPolling()
  lyricWindow?.hide()
  isVisible = false
  notifyVisibilityChange(false)
}

export function toggleDesktopLyric(): boolean {
  if (isVisible) {
    hideDesktopLyric()
  } else {
    showDesktopLyric()
  }
  return isVisible
}

export function isDesktopLyricVisible(): boolean {
  return isVisible
}

/** Send a lyric update to the desktop lyric window. */
export function sendLyricUpdate(data: {
  currentLine: string
  nextLine: string
  translation?: string
  trackTitle?: string
  trackArtist?: string
}): void {
  lastLyricData = data
  if (lyricWindow && !lyricWindow.isDestroyed() && isVisible) {
    lyricWindow.webContents.send('desktopLyric:lyricData', data)
  }
}

/** Register IPC handlers for desktop lyric control. */
export function registerDesktopLyricIPC(): void {
  ipcMain.handle('desktopLyric:toggle', async () => {
    const visible = toggleDesktopLyric()
    return { success: true, data: { visible } }
  })

  ipcMain.handle('desktopLyric:show', async () => {
    showDesktopLyric()
    return { success: true, data: { visible: true } }
  })

  ipcMain.handle('desktopLyric:hide', async () => {
    hideDesktopLyric()
    return { success: true, data: { visible: false } }
  })

  ipcMain.handle('desktopLyric:isVisible', async () => {
    return { success: true, data: { visible: isDesktopLyricVisible() } }
  })

  // Renderer sends lyric updates here
  ipcMain.on('desktopLyric:update', (_event, data) => {
    sendLyricUpdate(data)
  })

  // Renderer can move the window
  ipcMain.handle('desktopLyric:setPosition', async (_event, data: { x: number; y: number }) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.setPosition(Math.round(data.x), Math.round(data.y))
      return { success: true }
    }
    return { success: false, error: '窗口未创建' }
  })

  // Get current window position
  ipcMain.handle('desktopLyric:getPosition', async () => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      const [x, y] = lyricWindow.getPosition()
      return { success: true, data: { x, y } }
    }
    return { success: false, error: '窗口未创建' }
  })

  // Dynamic window resize (called from renderer resize handles)
  ipcMain.handle('desktopLyric:setBounds', async (_event, data: { width: number; height: number; x?: number; y?: number }) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      const [curX, curY] = lyricWindow.getPosition()
      const newX = data.x !== undefined ? Math.round(data.x) : curX
      const newY = data.y !== undefined ? Math.round(data.y) : curY
      const newW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(data.width)))
      const newH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(data.height)))
      lyricWindow.setBounds({
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      })
      return { success: true }
    }
    return { success: false, error: '窗口未创建' }
  })

  // Get current window bounds
  ipcMain.handle('desktopLyric:getBounds', async () => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      const bounds = lyricWindow.getBounds()
      return { success: true, data: bounds }
    }
    return { success: false, error: '窗口未创建' }
  })

  // ── Settings window (independent BrowserWindow) ──
  ipcMain.handle('desktopLyric:showSettings', async () => {
    showSettingsWindow()
    return { success: true }
  })

  ipcMain.handle('desktopLyric:hideSettings', async () => {
    hideSettingsWindow()
    return { success: true }
  })

  // Settings window → main → lyric window: style changed
  ipcMain.on('desktopLyric:styleChanged', (_event, data) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.webContents.send('desktopLyric:styleChanged', data)
    }
  })
}

// ── Settings window ──
let settingsWindow: BrowserWindow | null = null

const SETTINGS_W = 240
const SETTINGS_H = 200

function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  // Position: tight above the gear button (top-right of lyric window)
  // Gear button: top=6px, right=16px, size=28px → center at right ~30px from right edge
  let settingsX = 100
  let settingsY = 100
  if (lyricWindow && !lyricWindow.isDestroyed()) {
    const [lx, ly] = lyricWindow.getPosition()
    const [lw] = lyricWindow.getSize()
    // Arrow is at right: 20px in the popover → align arrow with gear button center
    settingsX = lx + lw - 20 - 14 + 7 // right-aligned: gear right margin(16) + half gear(14) - half arrow(7)
    settingsX = settingsX - SETTINGS_W + 20 + 14 // shift so arrow points at gear
    settingsY = ly - SETTINGS_H - 4 // 4px gap above the lyric window
    // Clamp to screen
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    if (settingsX < 10) settingsX = 10
    if (settingsY < 10) settingsY = 10
    if (settingsX + SETTINGS_W > sw) settingsX = sw - SETTINGS_W - 10
    if (settingsY + SETTINGS_H > sh) settingsY = Math.max(10, sh - SETTINGS_H - 10)
  }

  settingsWindow = new BrowserWindow({
    width: SETTINGS_W,
    height: SETTINGS_H,
    x: settingsX,
    y: settingsY,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../../dist-electron/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/desktop-lyric-settings`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../../dist/index.html'), { hash: 'desktop-lyric-settings' })
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  // 失焦即关 — 点击空白区域自动关闭
  settingsWindow.on('blur', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close()
    }
  })

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
    settingsWindow?.focus()
  })
}

function hideSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close()
  }
  settingsWindow = null
}
