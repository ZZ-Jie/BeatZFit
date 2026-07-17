<template>
  <div
    class="desktop-lyric-page"
    :class="{ 'is-hovered': isHovered }"
    @mousemove="onRootMouseMove"
  >
    <!-- ═══ 8 方向 Resize 手柄 ═══ -->
    <div class="resize-handle resize-n"  @mousedown.stop.prevent="startResize('n', $event)"></div>
    <div class="resize-handle resize-s"  @mousedown.stop.prevent="startResize('s', $event)"></div>
    <div class="resize-handle resize-w"  @mousedown.stop.prevent="startResize('w', $event)"></div>
    <div class="resize-handle resize-e"  @mousedown.stop.prevent="startResize('e', $event)"></div>
    <div class="resize-handle resize-nw" @mousedown.stop.prevent="startResize('nw', $event)"></div>
    <div class="resize-handle resize-ne" @mousedown.stop.prevent="startResize('ne', $event)"></div>
    <div class="resize-handle resize-sw" @mousedown.stop.prevent="startResize('sw', $event)"></div>
    <div class="resize-handle resize-se" @mousedown.stop.prevent="startResize('se', $event)"></div>

    <!-- ═══ 歌词显示区 ═══ -->
    <div class="lyric-text-wrap" ref="lyricWrapRef">
      <span
        class="lyric-line"
        ref="lyricLineRef"
        :style="lyricStyleObj"
        :key="currentLine"
      >{{ currentLine || '♪' }}</span>
    </div>

    <!-- ═══ 控制按钮区 (右上角, hover 显示) ═══ -->
    <div class="lyric-controls" @mouseenter="onControlsMouseEnter" @mouseleave="onControlsMouseLeave">
      <button class="lyric-ctrl-btn" @click="toggleSettings" title="样式设置">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <button class="lyric-ctrl-btn lyric-ctrl-close" @click="closeWindow" title="关闭桌面歌词">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import gsap from 'gsap'

// ── 状态 ──
const currentLine = ref('')

const STYLE_KEY = 'beatzfit:desktop-lyric-style'

interface LyricStyle {
  fontFamily: string
  fontSize: number
  color: string
}

const DEFAULTS: LyricStyle = {
  fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontSize: 40,
  color: '#FFFFFF',
}

function loadStyle(): LyricStyle {
  try {
    const raw = localStorage.getItem(STYLE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

function saveStyle(patch: Partial<LyricStyle>): void {
  const merged = { ...style.value, ...patch }
  style.value = merged
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(merged)) } catch (e) { console.warn('[DesktopLyric] Failed to save style:', e) }
}

const style = ref<LyricStyle>(loadStyle())
const isHovered = ref(false)
const isHoveringControls = ref(false) // Track if mouse is over buttons/controls

const lyricWrapRef = ref<HTMLElement | null>(null)
const lyricLineRef = ref<HTMLElement | null>(null)
const renderFontSize = ref(style.value.fontSize)

const lyricStyleObj = computed(() => ({
  fontFamily: style.value.fontFamily,
  fontSize: `${renderFontSize.value}px`,
  color: style.value.color,
}))

// ── 歌词自适应缩放 ──
function autoFitLyric() {
  const el = lyricLineRef.value
  if (!el) return
  const availWidth = window.innerWidth - 48
  el.style.fontSize = `${style.value.fontSize}px`
  const naturalWidth = el.scrollWidth
  if (naturalWidth <= availWidth) {
    renderFontSize.value = style.value.fontSize
  } else {
    const scale = availWidth / naturalWidth
    renderFontSize.value = Math.max(14, Math.floor(style.value.fontSize * scale))
  }
}

// ── 设置按钮 → 打开独立设置窗口 ──
function toggleSettings() {
  window.electronAPI?.desktopLyric?.showSettings?.()
}

// ── Hover 检测 (主进程轮询驱动) ──
let idleTimer: ReturnType<typeof setTimeout> | null = null

function onHoverEnter() { isHovered.value = true; resetIdleTimer() }
function onHoverLeave() {
  if (idleTimer) clearTimeout(idleTimer)
  isHovered.value = false
}
function onRootMouseMove() { if (isHovered.value) resetIdleTimer() }
function resetIdleTimer() {
  // Don't hide if mouse is over the controls area
  if (isHoveringControls.value) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { isHovered.value = false }, 1500)
}

// Track when mouse enters/leaves the controls area
function onControlsMouseEnter() { isHoveringControls.value = true; isHovered.value = true; if (idleTimer) clearTimeout(idleTimer) }
function onControlsMouseLeave() { isHoveringControls.value = false; resetIdleTimer() }

// ── 8 方向窗口 Resize ──
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const MIN_W = 400, MAX_W = 2400, MIN_H = 80, MAX_H = 400
let resizeDir: ResizeDir | null = null
let resizeStartX = 0, resizeStartY = 0
let resizeStartBounds: { x: number; y: number; width: number; height: number } | null = null

function startResize(dir: ResizeDir, e: MouseEvent) {
  resizeDir = dir
  resizeStartX = e.screenX
  resizeStartY = e.screenY
  window.electronAPI?.desktopLyric?.getBounds?.().then((res: any) => {
    if (res?.success && res.data) resizeStartBounds = res.data
  })
  document.addEventListener('mousemove', onResizeMouseMove)
  document.addEventListener('mouseup', onResizeMouseUp)
  const cursors: Record<ResizeDir, string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
  }
  document.body.style.cursor = cursors[dir]
}

function onResizeMouseMove(e: MouseEvent) {
  if (!resizeDir || !resizeStartBounds) return
  e.preventDefault()
  const dx = e.screenX - resizeStartX
  const dy = e.screenY - resizeStartY
  const b = resizeStartBounds
  let { x, y, width, height } = b
  if (resizeDir.includes('w')) { width = Math.max(MIN_W, Math.min(MAX_W, b.width - dx)); x = b.x + (b.width - width) }
  else if (resizeDir.includes('e')) { width = Math.max(MIN_W, Math.min(MAX_W, b.width + dx)) }
  if (resizeDir.includes('n')) { height = Math.max(MIN_H, Math.min(MAX_H, b.height - dy)); y = b.y + (b.height - height) }
  else if (resizeDir.includes('s')) { height = Math.max(MIN_H, Math.min(MAX_H, b.height + dy)) }
  window.electronAPI?.desktopLyric?.setBounds({ x, y, width, height })
}

function onResizeMouseUp() {
  resizeDir = null; resizeStartBounds = null
  document.removeEventListener('mousemove', onResizeMouseMove)
  document.removeEventListener('mouseup', onResizeMouseUp)
  document.body.style.cursor = ''
  nextTick(autoFitLyric)
}

// ── 强制透明背景 ──
function forceTransparentBackground() {
  const els = [document.documentElement, document.body, document.getElementById('app'), document.querySelector('.app-shell')]
    .filter((el): el is HTMLElement => !!el)
  els.forEach((el) => el.style.setProperty('background', 'transparent', 'important'))
}

let resizeHandler: (() => void) | null = null
let lyricHandler: ((...args: any[]) => void) | null = null
let hoverEnterHandler: ((...args: any[]) => void) | null = null
let hoverLeaveHandler: ((...args: any[]) => void) | null = null
let styleChangedHandler: ((...args: any[]) => void) | null = null

onMounted(() => {
  forceTransparentBackground()
  nextTick(() => { forceTransparentBackground(); autoFitLyric() })

  hoverEnterHandler = () => onHoverEnter()
  hoverLeaveHandler = () => onHoverLeave()
  window.electronAPI?.on('desktopLyric:hoverEnter', hoverEnterHandler)
  window.electronAPI?.on('desktopLyric:hoverLeave', hoverLeaveHandler)

  // 监听设置窗口发来的样式变更
  styleChangedHandler = (data: any) => {
    if (data) {
      style.value = { ...style.value, ...data }
      nextTick(autoFitLyric)
    }
  }
  window.electronAPI?.on('desktopLyric:styleChanged', styleChangedHandler)

  resizeHandler = () => autoFitLyric()
  window.addEventListener('resize', resizeHandler)

  lyricHandler = (data: any) => { if (data) currentLine.value = data.currentLine || '' }
  window.electronAPI?.on('desktopLyric:lyricData', lyricHandler)
})

onUnmounted(() => {
  if (lyricHandler) window.electronAPI?.removeListener('desktopLyric:lyricData', lyricHandler)
  if (hoverEnterHandler) window.electronAPI?.removeListener('desktopLyric:hoverEnter', hoverEnterHandler)
  if (hoverLeaveHandler) window.electronAPI?.removeListener('desktopLyric:hoverLeave', hoverLeaveHandler)
  if (styleChangedHandler) window.electronAPI?.removeListener('desktopLyric:styleChanged', styleChangedHandler)
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  if (idleTimer) clearTimeout(idleTimer)
  document.removeEventListener('mousemove', onResizeMouseMove)
  document.removeEventListener('mouseup', onResizeMouseUp)
  ;[document.documentElement, document.body, document.getElementById('app'), document.querySelector('.app-shell')]
    .forEach((el) => { if (el) (el as HTMLElement).style.removeProperty('background') })
})

watch(currentLine, () => {
  nextTick(() => {
    autoFitLyric()
    const el = lyricLineRef.value
    if (el) {
      gsap.fromTo(el, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', clearProps: 'transform,opacity' })
    }
  })
})

watch(() => style.value.fontSize, () => { nextTick(autoFitLyric) })

function closeWindow() { window.electronAPI?.desktopLyric.hide() }
</script>

<style scoped>
.desktop-lyric-page {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(1, 1, 1, 0.01);
  -webkit-app-region: drag;
  user-select: none;
  overflow: visible;
}

.resize-handle { position: absolute; -webkit-app-region: no-drag; z-index: 5; }
.resize-n { top: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-s { bottom: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-w { left: 0; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.resize-e { right: 0; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.resize-nw { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.resize-ne { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.resize-sw { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.resize-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }

.lyric-text-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 24px;
  background: transparent;
  max-width: calc(100vw - 48px);
  overflow: visible;
}

.lyric-line {
  display: inline-block;
  text-align: center;
  white-space: nowrap;
  font-weight: 700;
  line-height: 1.4;
  text-shadow: 0 0 18px rgba(108, 92, 231, 0.30), 0 2px 8px rgba(0, 0, 0, 0.65);
  user-select: none;
  will-change: transform, opacity;
}

.lyric-controls {
  position: absolute;
  top: 6px;
  right: 16px;
  display: flex;
  gap: 6px;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  z-index: 10;
  -webkit-app-region: no-drag;
}

.desktop-lyric-page.is-hovered .lyric-controls {
  opacity: 1;
  transform: translateY(0);
}

.lyric-ctrl-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(45, 45, 50, 0.55);
  color: rgba(220, 220, 225, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
  backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.lyric-ctrl-btn:hover {
  background: rgba(60, 60, 68, 0.75);
  color: rgba(255, 255, 255, 1);
  transform: scale(1.12);
  border-color: rgba(255, 255, 255, 0.35);
}

.lyric-ctrl-btn:active { transform: scale(1.05); }

.lyric-ctrl-close:hover {
  background: rgba(200, 50, 50, 0.7);
  color: #fff;
  border-color: rgba(255, 100, 100, 0.4);
}
</style>

<style>
html, body, #app {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  animation: none !important;
}
#app { border-radius: 0 !important; clip-path: none !important; overflow: visible !important; transform: none !important; }
#app::before { display: none !important; }
.app-shell { background: transparent !important; }
</style>
