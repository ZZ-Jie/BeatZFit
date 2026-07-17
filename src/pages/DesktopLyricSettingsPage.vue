<template>
  <div class="dl-settings-popover" @mousedown.stop>
    <!-- 锚点箭头 (指向齿轮按钮) -->
    <div class="dl-anchor-arrow"></div>

    <div class="dl-settings-list">
      <div class="dl-settings-row">
        <span class="dl-row-label">字体</span>
        <select :value="style.fontFamily" @change="onFontChange" class="dl-picker">
          <option value='"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'>默认</option>
          <option value='"Inter", sans-serif'>Inter</option>
          <option value='"Space Grotesk", sans-serif'>Space Grotesk</option>
          <option value='"JetBrains Mono", monospace'>等宽</option>
          <option value='Georgia, serif'>衬线</option>
        </select>
      </div>

      <div class="dl-settings-row">
        <span class="dl-row-label">大小</span>
        <div class="dl-slider-group">
          <input type="range" min="16" max="80" step="1" :value="style.fontSize" @input="onSizeInput" class="dl-slider" />
          <span class="dl-slider-val">{{ style.fontSize }}</span>
        </div>
      </div>

      <div class="dl-settings-row">
        <span class="dl-row-label">颜色</span>
        <div class="dl-colors">
          <button v-for="c in colorPresets" :key="c" class="dl-color-dot"
            :style="{ background: c }"
            :class="{ active: style.color.toLowerCase() === c.toLowerCase() }"
            @click="saveStyle({ color: c })"
          ></button>
          <input type="color" :value="style.color" @input="onColorInput" class="dl-color-custom" />
        </div>
      </div>
    </div>

    <button class="dl-reset-btn" @click="resetStyle">恢复默认</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

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

const colorPresets = ['#FFFFFF', '#FF6B6B', '#7EC8E3', '#FFD93D', '#A8E6CF', '#C7A8FF']

function loadStyle(): LyricStyle {
  try {
    const raw = localStorage.getItem(STYLE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

const style = ref<LyricStyle>(loadStyle())

function saveStyle(patch: Partial<LyricStyle>) {
  const merged = { ...style.value, ...patch }
  style.value = merged
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(merged)) } catch (e) { console.warn('[DesktopLyricSettings] Failed to save style:', e) }
  window.electronAPI?.send('desktopLyric:styleChanged', merged)
}

function onFontChange(e: Event) { saveStyle({ fontFamily: (e.target as HTMLSelectElement).value }) }
function onSizeInput(e: Event) { saveStyle({ fontSize: Number((e.target as HTMLInputElement).value) }) }
function onColorInput(e: Event) { saveStyle({ color: (e.target as HTMLInputElement).value }) }
function resetStyle() { saveStyle({ ...DEFAULTS }) }

function forceTransparent() {
  const els = [document.documentElement, document.body, document.getElementById('app'), document.querySelector('.app-shell')]
    .filter((el): el is HTMLElement => !!el)
  els.forEach((el) => el.style.setProperty('background', 'transparent', 'important'))
}

onMounted(() => {
  forceTransparent()
  // 失焦即关由主进程 blur 事件处理
})

function closeSelf() {
  window.electronAPI?.desktopLyric?.hideSettings?.()
}

onUnmounted(() => {
  // 清理
})
</script>

<style scoped>
.dl-settings-popover {
  width: 220px;
  max-height: calc(100vh - 20px);
  background: #1c1c1e;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 4px;
  font-family: -apple-system, "SF Pro Text", "Noto Sans SC", sans-serif;
  color: #fff;
  position: relative;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none; /* Firefox: hide scrollbar */
  -ms-overflow-style: none; /* IE/Edge: hide scrollbar */
}
/* WebKit: hide scrollbar but allow scrolling */
.dl-settings-popover::-webkit-scrollbar { display: none; }

/* 锚点箭头 — 指向齿轮按钮 */
.dl-anchor-arrow {
  position: absolute;
  bottom: -7px;
  right: 20px;
  width: 14px;
  height: 14px;
  background: #1c1c1e;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  transform: rotate(45deg);
}

.dl-settings-list {
  display: flex;
  flex-direction: column;
}

.dl-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
}

.dl-settings-row + .dl-settings-row {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.dl-row-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.dl-picker {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}
.dl-picker option { background: #1c1c1e; }

.dl-slider-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dl-slider {
  width: 90px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  outline: none;
}
.dl-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
}

.dl-slider-val {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
  min-width: 20px;
  text-align: right;
}

.dl-colors {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dl-color-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: transform 0.12s ease, border-color 0.12s ease;
}
.dl-color-dot:hover { transform: scale(1.15); }
.dl-color-dot.active { border-color: rgba(255, 255, 255, 0.9); }

.dl-color-custom {
  width: 22px;
  height: 22px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  background: none;
  cursor: pointer;
  padding: 0;
}
.dl-color-custom::-webkit-color-swatch-wrapper { padding: 0; }
.dl-color-custom::-webkit-color-swatch { border: none; border-radius: 50%; }

.dl-reset-btn {
  display: block;
  width: calc(100% - 8px);
  margin: 4px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.dl-reset-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.dl-reset-btn:active {
  background: rgba(255, 255, 255, 0.08);
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
