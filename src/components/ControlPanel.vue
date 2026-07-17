<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition name="cp-backdrop">
      <div v-if="isOpen" class="cp-backdrop-el" @click="close"></div>
    </Transition>

    <!-- Sidebar -->
    <Transition name="cp-slide">
      <aside v-if="isOpen" class="cp-sidebar">
        <!-- Header -->
        <div class="cp-header">
          <div class="cp-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="cp-tab"
              :class="{ 'cp-tab--active': activeTab === tab.id }"
              @click="activeTab = tab.id; sfx.detent()"
            >{{ tab.label }}</button>
          </div>
          <button class="cp-close" @click="close" title="关闭">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>

        <!-- Content -->
        <div class="cp-body">
          <!-- ═══════ 主题 DIY ═══════ -->
          <div v-show="activeTab === 'theme'" class="cp-panel">
            <div class="cp-section-title">可视化预设</div>
            <div class="cp-seg">
              <button
                v-for="opt in presetOptions"
                :key="opt.value"
                class="cp-seg-btn"
                :class="{ on: activePreset === opt.value }"
                @click="setPreset(opt.value); sfx.confirm()"
              >
                <span class="cp-seg-label">{{ opt.label }}</span>
                <span class="cp-seg-sub">{{ opt.desc }}</span>
              </button>
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">性能等级</div>
            <div class="cp-seg">
              <button class="cp-seg-btn" :class="{ on: quality === 'high' }" @click="setQuality('high'); sfx.detent()">高</button>
              <button class="cp-seg-btn" :class="{ on: quality === 'medium' }" @click="setQuality('medium'); sfx.detent()">中</button>
              <button class="cp-seg-btn" :class="{ on: quality === 'low' }" @click="setQuality('low'); sfx.detent()">低</button>
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">数据页 3D 深度弧</div>
            <div class="cp-uniform-row">
              <label>指针视差 <b>{{ kpiParallax }}</b></label>
              <input type="range" min="0" max="16" v-model.number="kpiParallax" @input="saveKpiPrefs" />
            </div>
            <div class="cp-uniform-row">
              <label>景深幅度 <b>{{ kpiDepthMul.toFixed(1) }}</b></label>
              <input type="range" min="40" max="160" :value="kpiDepthMul * 100" @input="kpiDepthMul = +($event.target as HTMLInputElement).value / 100; saveKpiPrefs()" />
            </div>
            <div class="cp-uniform-row">
              <label>卡片间距 <b>{{ kpiGap }}</b></label>
              <input type="range" min="80" max="200" v-model.number="kpiGap" @input="saveKpiPrefs" />
            </div>
            <button class="cp-btn" style="width: 100%; margin-top: 6px;" @click="resetKpiPrefs">恢复默认</button>

            <div class="cp-divider"></div>

            <div class="cp-section-title">背景</div>
            <div class="cp-seg">
              <button class="cp-seg-btn" :class="{ on: backgroundStore.mode === 'visualizer' }" @click="setBackgroundMode('visualizer'); sfx.detent()">默认</button>
              <button class="cp-seg-btn" :class="{ on: backgroundStore.mode === 'image' }" @click="setBackgroundMode('image'); sfx.detent()">自定义</button>
            </div>
            <p class="cp-tip" v-if="backgroundStore.mode === 'visualizer'">使用可视化器动态背景</p>

            <div v-if="backgroundStore.isCustom" class="cp-sub-panel">
              <div class="cp-bg-preview" :class="{ 'cp-bg-preview--empty': !bgPreviewUrl }">
                <img v-if="bgPreviewUrl" :src="bgPreviewUrl" alt="背景预览" />
                <span v-else>尚未选择图片</span>
              </div>
              <div class="cp-bg-actions">
                <template v-if="backgroundStore.hasPending">
                  <button class="cp-btn cp-btn--primary" @click="applyBackground">应用</button>
                  <button class="cp-btn" @click="cancelBackground">取消</button>
                </template>
                <template v-else>
                  <button class="cp-btn" :disabled="backgroundStore.loading" @click="selectBackgroundImage">
                    {{ backgroundStore.loading ? '处理中…' : '选择图片' }}
                  </button>
                  <button class="cp-btn cp-btn--danger" @click="resetBackground">恢复默认</button>
                </template>
              </div>
              <p v-if="backgroundStore.status && !backgroundStore.loading" class="cp-tip">{{ backgroundStore.status }}</p>
              <p v-if="backgroundStore.error" class="cp-error">{{ backgroundStore.error }}</p>

              <div v-if="backgroundStore.history.length > 0" class="cp-bg-history">
                <div class="cp-section-title" style="margin-bottom: 8px;">历史记录</div>
                <div class="cp-bg-history-list">
                  <div
                    v-for="item in backgroundStore.history"
                    :key="item.id"
                    class="cp-bg-history-item"
                    :class="{ active: item.id === backgroundStore.currentId }"
                    @click="applyHistoryItem(item.id)"
                  >
                    <img :src="toBeatUrl(item.thumbnailPath)" :alt="item.originalName" loading="lazy" />
                    <button class="cp-bg-history-del" @click.stop="deleteHistoryItem(item.id)">×</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">3D 视觉调整</div>
            <div class="cp-uniform-row">
              <label>可视化缩放 <b>{{ visualDiy.scale.toFixed(2) }}</b></label>
              <input type="range" min="0.3" max="2" step="0.05" v-model.number="visualDiy.scale" @input="saveVisualDiy" />
            </div>
            <div class="cp-uniform-row">
              <label>粒子密度 <b>{{ visualDiy.particleDensity }}%</b></label>
              <input type="range" min="20" max="200" step="10" v-model.number="visualDiy.particleDensity" @input="saveVisualDiy" />
            </div>
            <div class="cp-uniform-row">
              <label>3D 深度 <b>{{ visualDiy.depth.toFixed(2) }}</b></label>
              <input type="range" min="0.3" max="2" step="0.05" v-model.number="visualDiy.depth" @input="saveVisualDiy" />
            </div>
            <div class="cp-uniform-row">
              <label>发光强度 <b>{{ visualDiy.glow.toFixed(2) }}</b></label>
              <input type="range" min="0" max="2" step="0.05" v-model.number="visualDiy.glow" @input="saveVisualDiy" />
            </div>
            <button class="cp-btn" style="width: 100%; margin-top: 6px;" @click="resetVisualDiy">恢复默认</button>

            <div class="cp-divider"></div>

            <div class="cp-section-title">相机</div>
            <button class="cp-btn" style="width: 100%;" @click="resetCameraView">重置视角</button>
            <p class="cp-tip" style="margin-top: 6px;">恢复 3D 视角到默认位置</p>
          </div>

          <!-- ═══════ 歌词 DIY ═══════ -->
          <div v-show="activeTab === 'lyric'" class="cp-panel">
            <div class="cp-section-title">全局歌词</div>
            <div class="cp-uniform-row">
              <label>显示歌词</label>
              <button class="cp-toggle" :class="{ on: lyricSettings.show }" @click="lyricSettings.show = !lyricSettings.show; saveLyricPrefs(); applyLyricPrefs(); sfx.detent()">
                <span class="cp-toggle-knob"></span>
              </button>
            </div>
            <div class="cp-uniform-row">
              <label>不透明度 <b>{{ Math.round(lyricSettings.opacity * 100) }}%</b></label>
              <input type="range" min="10" max="100" :value="lyricSettings.opacity * 100"
                @input="lyricSettings.opacity = +($event.target as HTMLInputElement).value / 100; saveLyricPrefs(); applyLyricPrefs()" />
            </div>
            <div class="cp-uniform-row">
              <label>字号 <b>{{ lyricSettings.fontSize }}</b></label>
              <input type="range" min="16" max="48" v-model.number="lyricSettings.fontSize" @input="saveLyricPrefs(); applyLyricPrefs()" />
            </div>
            <div class="cp-uniform-row">
              <label>字重</label>
              <div class="cp-segment-group">
                <button v-for="w in lyricFontWeights" :key="w.value"
                  class="cp-segment" :class="{ on: lyricSettings.fontWeight === w.value }"
                  @click="lyricSettings.fontWeight = w.value; saveLyricPrefs(); applyLyricPrefs(); sfx.detent()">{{ w.label }}</button>
              </div>
            </div>
            <div class="cp-uniform-row">
              <label>字体</label>
              <LiquidSelect
                :model-value="lyricSettings.fontFamily"
                :options="lyricFontOptions"
                max-height="240px"
                min-width="140px"
                @update:model-value="lyricSettings.fontFamily = $event; saveLyricPrefs(); applyLyricPrefs()"
              />
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">歌词进阶</div>
            <div class="cp-uniform-row">
              <label>发光强度 <b>{{ lyricSettings.glowIntensity.toFixed(2) }}</b></label>
              <input type="range" min="0" max="2" step="0.05" v-model.number="lyricSettings.glowIntensity" @input="saveLyricPrefs(); applyLyricPrefs()" />
            </div>
            <div class="cp-uniform-row">
              <label>行间距 <b>{{ lyricSettings.lineSpacing }}px</b></label>
              <input type="range" min="40" max="160" step="4" v-model.number="lyricSettings.lineSpacing" @input="saveLyricPrefs(); applyLyricPrefs()" />
            </div>
            <div class="cp-uniform-row">
              <label>动画速度 <b>{{ lyricSettings.animSpeed.toFixed(2) }}s</b></label>
              <input type="range" min="0.2" max="1.5" step="0.05" v-model.number="lyricSettings.animSpeed" @input="saveLyricPrefs(); applyLyricPrefs()" />
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">歌词颜色</div>
            <p class="cp-tip" style="margin-bottom: 8px;">选择「自动」从专辑封面取色</p>
            <div class="cp-color-grid">
              <button
                v-for="c in lyricColorPresets"
                :key="c.value"
                class="cp-color-swatch"
                :class="{ on: lyricSettings.color === c.value }"
                :style="{ background: c.value === 'auto' ? 'linear-gradient(135deg, #fa586a, #7EC8E3, #C9A96E)' : c.value }"
                :title="c.label"
                @click="lyricSettings.color = c.value; saveLyricPrefs(); applyLyricPrefs(); sfx.detent(); syncRgbFromSetting('lyric', c.value)"
              ></button>
              <button class="cp-rgb-btn" :class="{ on: expandedColorPanel === 'lyric' }" @click="toggleColorPanel('lyric'); initRgbInputs('lyric', lyricSettings.color)" title="自定义 RGB">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div v-if="expandedColorPanel === 'lyric'" class="cp-rgb-panel">
              <div class="cp-picker-row">
                <div class="cp-sv-square" :style="{ background: cpSvBg('lyric') }" :ref="(el) => setPickerRef(el, 'lyric')" @pointerdown="cpOnPointerDown($event, 'lyric', 'sv')">
                  <div class="cp-sv-overlay"></div>
                  <div class="cp-sv-cursor" :style="{ left: cpSvPos('lyric').x + '%', top: cpSvPos('lyric').y + '%' }"></div>
                </div>
                <div class="cp-rgb-compact">
                  <div class="cp-rgb-row"><span>R</span><input type="number" min="0" max="255" v-model.number="rgbInputs.lyric.r" @input="applyRgbToLyric()" /></div>
                  <div class="cp-rgb-row"><span>G</span><input type="number" min="0" max="255" v-model.number="rgbInputs.lyric.g" @input="applyRgbToLyric()" /></div>
                  <div class="cp-rgb-row"><span>B</span><input type="number" min="0" max="255" v-model.number="rgbInputs.lyric.b" @input="applyRgbToLyric()" /></div>
                </div>
              </div>
              <div class="cp-hue-slider" :ref="(el) => setHueRef(el, 'lyric')" @pointerdown="cpOnPointerDown($event, 'lyric', 'hue')">
                <div class="cp-hue-cursor" :style="{ left: (cpHue('lyric') / 360 * 100) + '%' }"></div>
              </div>
              <div class="cp-rgb-row"><span>A</span><input type="range" min="0.3" max="1" step="0.05" v-model.number="rgbInputs.lyric.a" @input="applyRgbToLyric()" /><b>{{ Math.round(rgbInputs.lyric.a * 100) }}%</b></div>
            </div>
            <p class="cp-tip" style="margin-top: 6px;">当前: <b>{{ lyricSettings.color === 'auto' ? '自动取色' : lyricColorPresets.find(c => c.value === lyricSettings.color)?.label || '自定义' }}</b></p>

            <div class="cp-divider"></div>

            <button class="cp-btn" @click="resetLyricPrefs" style="width: 100%;">恢复默认</button>
          </div>

          <!-- ═══════ 颜色 DIY ═══════ -->
          <div v-show="activeTab === 'color'" class="cp-panel">
            <div class="cp-section-title">主题强调色</div>
            <div class="cp-color-grid">
              <button
                v-for="c in accentColorPresets"
                :key="c.value"
                class="cp-color-swatch"
                :class="{ on: colorSettings.accent === c.value }"
                :style="{ background: c.value }"
                :title="c.label"
                @click="colorSettings.accent = c.value; saveColorPrefs(); applyColorPrefs(); sfx.detent(); syncRgbFromSetting('accent', c.value)"
              ></button>
              <button class="cp-rgb-btn" :class="{ on: expandedColorPanel === 'accent' }" @click="toggleColorPanel('accent'); initRgbInputs('accent', colorSettings.accent)" title="自定义 RGB">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div v-if="expandedColorPanel === 'accent'" class="cp-rgb-panel">
              <div class="cp-picker-row">
                <div class="cp-sv-square" :style="{ background: cpSvBg('accent') }" :ref="(el) => setPickerRef(el, 'accent')" @pointerdown="cpOnPointerDown($event, 'accent', 'sv')">
                  <div class="cp-sv-overlay"></div>
                  <div class="cp-sv-cursor" :style="{ left: cpSvPos('accent').x + '%', top: cpSvPos('accent').y + '%' }"></div>
                </div>
                <div class="cp-rgb-compact">
                  <div class="cp-rgb-row"><span>R</span><input type="number" min="0" max="255" v-model.number="rgbInputs.accent.r" @input="applyRgbToAccent()" /></div>
                  <div class="cp-rgb-row"><span>G</span><input type="number" min="0" max="255" v-model.number="rgbInputs.accent.g" @input="applyRgbToAccent()" /></div>
                  <div class="cp-rgb-row"><span>B</span><input type="number" min="0" max="255" v-model.number="rgbInputs.accent.b" @input="applyRgbToAccent()" /></div>
                </div>
              </div>
              <div class="cp-hue-slider" :ref="(el) => setHueRef(el, 'accent')" @pointerdown="cpOnPointerDown($event, 'accent', 'hue')">
                <div class="cp-hue-cursor" :style="{ left: (cpHue('accent') / 360 * 100) + '%' }"></div>
              </div>
            </div>
            <p class="cp-tip" style="margin-top: 6px;">当前: <b>{{ accentColorPresets.find(c => c.value === colorSettings.accent)?.label || '自定义' }}</b></p>

            <div class="cp-divider"></div>

            <div class="cp-section-title">背景烟雾 — 未播放</div>
            <div class="cp-color-grid">
              <button
                v-for="c in auroraColorPresets"
                :key="'idle-' + c.value"
                class="cp-color-swatch"
                :class="{ on: auroraSettings.idleColor === c.value }"
                :style="{ background: c.value === 'auto' ? '#e8e8f0' : c.value }"
                :title="c.label"
                @click="auroraSettings.idleColor = c.value; saveAuroraPrefs(); applyAuroraPrefs(); sfx.detent(); syncRgbFromSetting('auroraIdle', c.value)"
              ></button>
              <button class="cp-rgb-btn" :class="{ on: expandedColorPanel === 'auroraIdle' }" @click="toggleColorPanel('auroraIdle'); initRgbInputs('auroraIdle', auroraSettings.idleColor)" title="自定义 RGB">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div v-if="expandedColorPanel === 'auroraIdle'" class="cp-rgb-panel">
              <div class="cp-picker-row">
                <div class="cp-sv-square" :style="{ background: cpSvBg('auroraIdle') }" :ref="(el) => setPickerRef(el, 'auroraIdle')" @pointerdown="cpOnPointerDown($event, 'auroraIdle', 'sv')">
                  <div class="cp-sv-overlay"></div>
                  <div class="cp-sv-cursor" :style="{ left: cpSvPos('auroraIdle').x + '%', top: cpSvPos('auroraIdle').y + '%' }"></div>
                </div>
                <div class="cp-rgb-compact">
                  <div class="cp-rgb-row"><span>R</span><input type="number" min="0" max="255" v-model.number="rgbInputs.auroraIdle.r" @input="applyRgbToAuroraIdle()" /></div>
                  <div class="cp-rgb-row"><span>G</span><input type="number" min="0" max="255" v-model.number="rgbInputs.auroraIdle.g" @input="applyRgbToAuroraIdle()" /></div>
                  <div class="cp-rgb-row"><span>B</span><input type="number" min="0" max="255" v-model.number="rgbInputs.auroraIdle.b" @input="applyRgbToAuroraIdle()" /></div>
                </div>
              </div>
              <div class="cp-hue-slider" :ref="(el) => setHueRef(el, 'auroraIdle')" @pointerdown="cpOnPointerDown($event, 'auroraIdle', 'hue')">
                <div class="cp-hue-cursor" :style="{ left: (cpHue('auroraIdle') / 360 * 100) + '%' }"></div>
              </div>
            </div>
            <p class="cp-tip" style="margin-top: 6px;">「自动」= 月白色</p>

            <div class="cp-divider"></div>

            <div class="cp-section-title">背景烟雾 — 播放中</div>
            <div class="cp-color-grid">
              <button
                v-for="c in auroraColorPresets"
                :key="'play-' + c.value"
                class="cp-color-swatch"
                :class="{ on: auroraSettings.playingColor === c.value }"
                :style="{ background: c.value === 'auto' ? 'linear-gradient(135deg, #7EC8E3, #fa586a, #C9A96E)' : c.value }"
                :title="c.label"
                @click="auroraSettings.playingColor = c.value; saveAuroraPrefs(); applyAuroraPrefs(); sfx.detent(); syncRgbFromSetting('auroraPlay', c.value)"
              ></button>
              <button class="cp-rgb-btn" :class="{ on: expandedColorPanel === 'auroraPlay' }" @click="toggleColorPanel('auroraPlay'); initRgbInputs('auroraPlay', auroraSettings.playingColor)" title="自定义 RGB">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div v-if="expandedColorPanel === 'auroraPlay'" class="cp-rgb-panel">
              <div class="cp-picker-row">
                <div class="cp-sv-square" :style="{ background: cpSvBg('auroraPlay') }" :ref="(el) => setPickerRef(el, 'auroraPlay')" @pointerdown="cpOnPointerDown($event, 'auroraPlay', 'sv')">
                  <div class="cp-sv-overlay"></div>
                  <div class="cp-sv-cursor" :style="{ left: cpSvPos('auroraPlay').x + '%', top: cpSvPos('auroraPlay').y + '%' }"></div>
                </div>
                <div class="cp-rgb-compact">
                  <div class="cp-rgb-row"><span>R</span><input type="number" min="0" max="255" v-model.number="rgbInputs.auroraPlay.r" @input="applyRgbToAuroraPlay()" /></div>
                  <div class="cp-rgb-row"><span>G</span><input type="number" min="0" max="255" v-model.number="rgbInputs.auroraPlay.g" @input="applyRgbToAuroraPlay()" /></div>
                  <div class="cp-rgb-row"><span>B</span><input type="number" min="0" max="255" v-model.number="rgbInputs.auroraPlay.b" @input="applyRgbToAuroraPlay()" /></div>
                </div>
              </div>
              <div class="cp-hue-slider" :ref="(el) => setHueRef(el, 'auroraPlay')" @pointerdown="cpOnPointerDown($event, 'auroraPlay', 'hue')">
                <div class="cp-hue-cursor" :style="{ left: (cpHue('auroraPlay') / 360 * 100) + '%' }"></div>
              </div>
            </div>
            <p class="cp-tip" style="margin-top: 6px;">「自动」= 从专辑封面取色</p>

            <div class="cp-divider"></div>

            <div class="cp-section-title">极光亮度</div>
            <div class="cp-uniform-row">
              <label>亮度倍率 <b>{{ auroraSettings.brightness.toFixed(2) }}</b></label>
              <input type="range" min="0.3" max="2" step="0.05" v-model.number="auroraSettings.brightness" @input="saveAuroraPrefs(); applyAuroraPrefs()" />
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">玻璃色调</div>
            <div class="cp-color-grid">
              <button
                v-for="c in glassTintPresets"
                :key="c.value"
                class="cp-color-swatch"
                :class="{ on: colorSettings.glassTint === c.value }"
                :style="{ background: c.value === 'transparent' ? 'repeating-linear-gradient(45deg, #333, #333 3px, #555 3px, #555 6px)' : c.value }"
                :title="c.label"
                @click="colorSettings.glassTint = c.value; saveColorPrefs(); applyColorPrefs(); sfx.detent(); syncRgbFromSetting('glassTint', c.value)"
              ></button>
              <button class="cp-rgb-btn" :class="{ on: expandedColorPanel === 'glassTint' }" @click="toggleColorPanel('glassTint'); initRgbInputs('glassTint', colorSettings.glassTint)" title="自定义 RGB">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div v-if="expandedColorPanel === 'glassTint'" class="cp-rgb-panel">
              <div class="cp-picker-row">
                <div class="cp-sv-square" :style="{ background: cpSvBg('glassTint') }" :ref="(el) => setPickerRef(el, 'glassTint')" @pointerdown="cpOnPointerDown($event, 'glassTint', 'sv')">
                  <div class="cp-sv-overlay"></div>
                  <div class="cp-sv-cursor" :style="{ left: cpSvPos('glassTint').x + '%', top: cpSvPos('glassTint').y + '%' }"></div>
                </div>
                <div class="cp-rgb-compact">
                  <div class="cp-rgb-row"><span>R</span><input type="number" min="0" max="255" v-model.number="rgbInputs.glassTint.r" @input="applyRgbToGlassTint()" /></div>
                  <div class="cp-rgb-row"><span>G</span><input type="number" min="0" max="255" v-model.number="rgbInputs.glassTint.g" @input="applyRgbToGlassTint()" /></div>
                  <div class="cp-rgb-row"><span>B</span><input type="number" min="0" max="255" v-model.number="rgbInputs.glassTint.b" @input="applyRgbToGlassTint()" /></div>
                </div>
              </div>
              <div class="cp-hue-slider" :ref="(el) => setHueRef(el, 'glassTint')" @pointerdown="cpOnPointerDown($event, 'glassTint', 'hue')">
                <div class="cp-hue-cursor" :style="{ left: (cpHue('glassTint') / 360 * 100) + '%' }"></div>
              </div>
              <div class="cp-rgb-row"><span>A</span><input type="range" min="0" max="0.3" step="0.01" v-model.number="rgbInputs.glassTint.a" @input="applyRgbToGlassTint()" /><b>{{ Math.round(rgbInputs.glassTint.a * 100) }}%</b></div>
            </div>
            <p class="cp-tip" style="margin-top: 6px;">当前: <b>{{ glassTintPresets.find(c => c.value === colorSettings.glassTint)?.label || '自定义' }}</b></p>

            <div class="cp-divider"></div>

            <div class="cp-section-title">卡片底色浓度</div>
            <div class="cp-uniform-row">
              <label>不透明度 <b>{{ Math.round(colorSettings.cardOpacity * 100) }}%</b></label>
              <input type="range" min="50" max="100" :value="colorSettings.cardOpacity * 100"
                @input="colorSettings.cardOpacity = +($event.target as HTMLInputElement).value / 100; saveColorPrefs(); applyColorPrefs()" />
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">玻璃模糊</div>
            <div class="cp-uniform-row">
              <label>模糊强度 <b>{{ colorSettings.glassBlur }}px</b></label>
              <input type="range" min="0" max="48" step="2" v-model.number="colorSettings.glassBlur" @input="saveColorPrefs(); applyColorPrefs()" />
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">界面圆角</div>
            <div class="cp-uniform-row">
              <label>圆角大小 <b>{{ colorSettings.cornerRadius }}px</b></label>
              <input type="range" min="0" max="32" step="1" v-model.number="colorSettings.cornerRadius" @input="saveColorPrefs(); applyColorPrefs()" />
            </div>

            <div class="cp-divider"></div>

            <div class="cp-section-title">数据图表配色</div>
            <p class="cp-tip" style="margin-bottom: 8px;">自定义训练数据页的图表颜色</p>
            <div class="cp-color-grid">
              <button
                v-for="c in chartColorPresets"
                :key="c.value"
                class="cp-color-swatch"
                :class="{ on: chartSettings.primary === c.value }"
                :style="{ background: c.value }"
                :title="c.label"
                @click="chartSettings.primary = c.value; saveChartPrefs(); applyChartPrefs(); sfx.detent(); syncRgbFromSetting('chartPrimary', c.value)"
              ></button>
              <button class="cp-rgb-btn" :class="{ on: expandedColorPanel === 'chartPrimary' }" @click="toggleColorPanel('chartPrimary'); initRgbInputs('chartPrimary', chartSettings.primary)" title="自定义 RGB">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <div v-if="expandedColorPanel === 'chartPrimary'" class="cp-rgb-panel">
              <div class="cp-picker-row">
                <div class="cp-sv-square" :style="{ background: cpSvBg('chartPrimary') }" :ref="(el) => setPickerRef(el, 'chartPrimary')" @pointerdown="cpOnPointerDown($event, 'chartPrimary', 'sv')">
                  <div class="cp-sv-overlay"></div>
                  <div class="cp-sv-cursor" :style="{ left: cpSvPos('chartPrimary').x + '%', top: cpSvPos('chartPrimary').y + '%' }"></div>
                </div>
                <div class="cp-rgb-compact">
                  <div class="cp-rgb-row"><span>R</span><input type="number" min="0" max="255" v-model.number="rgbInputs.chartPrimary.r" @input="applyRgbToChartPrimary()" /></div>
                  <div class="cp-rgb-row"><span>G</span><input type="number" min="0" max="255" v-model.number="rgbInputs.chartPrimary.g" @input="applyRgbToChartPrimary()" /></div>
                  <div class="cp-rgb-row"><span>B</span><input type="number" min="0" max="255" v-model.number="rgbInputs.chartPrimary.b" @input="applyRgbToChartPrimary()" /></div>
                </div>
              </div>
              <div class="cp-hue-slider" :ref="(el) => setHueRef(el, 'chartPrimary')" @pointerdown="cpOnPointerDown($event, 'chartPrimary', 'hue')">
                <div class="cp-hue-cursor" :style="{ left: (cpHue('chartPrimary') / 360 * 100) + '%' }"></div>
              </div>
            </div>
            <p class="cp-tip" style="margin-top: 6px;">当前: <b>{{ chartColorPresets.find(c => c.value === chartSettings.primary)?.label || '自定义' }}</b></p>

            <div class="cp-divider"></div>

            <button class="cp-btn" @click="resetColorPrefs(); resetAuroraPrefs(); resetChartPrefs()" style="width: 100%;">恢复默认</button>
          </div>

          <!-- ═══════ 设置 ═══════ -->
          <div v-show="activeTab === 'settings'" class="cp-panel">
            <!-- 交互音效 -->
            <div class="cp-section-title">交互音效</div>
            <div class="cp-uniform-row">
              <label>启用交互音效</label>
              <button class="cp-toggle" :class="{ on: sfxEnabled }" @click="toggleSfx">
                <span class="cp-toggle-knob"></span>
              </button>
            </div>
            <p class="cp-tip" style="margin-bottom: 4px;">为 UI 交互添加程序化合成的音效反馈</p>

            <div class="cp-divider"></div>

            <!-- 沉浸式 -->
            <div class="cp-section-title">沉浸式</div>
            <p class="cp-tip" style="margin-bottom: 8px;">开启后隐藏对应元素，获得更纯粹的视觉体验</p>
            <div class="cp-uniform-row">
              <label>首页 · 训练卡片</label>
              <button class="cp-toggle" :class="{ on: immersivePrefs.hideHomeFitness }" @click="toggleImmersive('hideHomeFitness')">
                <span class="cp-toggle-knob"></span>
              </button>
            </div>
<div class="cp-uniform-row">
<label>首页 · 歌单卡片</label>
<button class="cp-toggle" :class="{ on: immersivePrefs.hideHomeMusic }" @click="toggleImmersive('hideHomeMusic')">
<span class="cp-toggle-knob"></span>
</button>
</div>
<div class="cp-uniform-row">
<label>首页 · 搜索框</label>
<button class="cp-toggle" :class="{ on: immersivePrefs.hideHomeSearch }" @click="toggleImmersive('hideHomeSearch')">
<span class="cp-toggle-knob"></span>
</button>
</div>
            <div class="cp-uniform-row">
              <label>音乐库 · 顶部栏</label>
              <button class="cp-toggle" :class="{ on: immersivePrefs.hideMusicShelfHeader }" @click="toggleImmersive('hideMusicShelfHeader')">
                <span class="cp-toggle-knob"></span>
              </button>
            </div>
            <div class="cp-uniform-row">
              <label>动作库 · 顶部栏</label>
              <button class="cp-toggle" :class="{ on: immersivePrefs.hideFitnessShelfHeader }" @click="toggleImmersive('hideFitnessShelfHeader')">
                <span class="cp-toggle-knob"></span>
              </button>
            </div>

            <div class="cp-divider"></div>

            <!-- 音频 -->
            <div class="cp-section-title">音频</div>
            <div class="cp-uniform-row">
              <label>默认音量 <b>{{ Math.round(defaultVolume * 100) }}%</b></label>
              <input type="range" min="0" max="1" step="0.05"
                :value="defaultVolume" @input="setVolume" />
            </div>
            <div class="cp-uniform-row">
              <label>播放模式</label>
              <LiquidSelect
                :model-value="playMode"
                :options="playModeOptions"
                @update:model-value="playMode = $event; saveSetting('playMode', playMode)"
              />
            </div>

            <div class="cp-divider"></div>

            <!-- 数据管理 -->
            <div class="cp-section-title">数据管理</div>
            <div class="cp-uniform-row">
              <label>同步动作库</label>
              <button class="cp-btn" @click="syncNow">立即同步</button>
            </div>
            <div class="cp-uniform-row">
              <label>重置应用数据</label>
              <button class="cp-btn cp-btn--danger" @click="resetApp">重置</button>
            </div>

            <div class="cp-divider"></div>

            <!-- 快捷键 -->
            <div class="cp-section-title">快捷键</div>
            <p class="cp-tip" style="margin-bottom: 8px;">点击快捷键即可重新设置</p>
            <div v-if="shortcutError" class="cp-error">{{ shortcutError }}</div>
            <div class="cp-shortcut-list">
              <div v-for="sc in shortcutBindings" :key="sc.action" class="cp-shortcut-row">
                <span class="cp-shortcut-label">{{ sc.label }}</span>
                <button
                  class="cp-shortcut-key"
                  :class="{ capturing: capturingAction === sc.action }"
                  @click="startCapture(sc.action)"
                >
                  <template v-if="capturingAction === sc.action">按下快捷键…</template>
                  <template v-else>{{ formatAccelerator(sc.accelerator) }}</template>
                </button>
              </div>
            </div>
            <div class="cp-uniform-row" style="margin-top: 8px;">
              <label>恢复默认快捷键</label>
              <button class="cp-btn" @click="resetShortcuts">重置</button>
            </div>

            <div class="cp-divider"></div>

            <!-- 缓存 -->
            <div class="cp-section-title">缓存</div>
            <div class="cp-uniform-row">
              <label>清空缓存</label>
              <button class="cp-btn cp-btn--danger" @click="clearAllCaches">清空</button>
            </div>

            <div class="cp-divider"></div>

            <!-- 关于 -->
            <div class="cp-section-title">关于</div>
            <div class="cp-about">
              <div class="cp-about-row"><span>BeatZ Fit</span><span>v1.0.0</span></div>
              <div class="cp-about-row"><span class="cp-tip">桌面沉浸式音乐健身应用</span></div>
            </div>
            <p class="cp-tip" style="margin-top: 8px;">网易云音乐为非官方接口，相关功能为实验性能力。</p>
            <div class="cp-uniform-row" style="margin-top: 8px;">
              <label>重新查看引导</label>
              <button class="cp-btn" @click="replayOnboarding">查看引导</button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/music'
import { useBackgroundStore } from '@/stores/background'
import { useGlobalVisualizer } from '@/composables/useGlobalVisualizer'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { cacheClear } from '@/modules/music/cache'
import { invalidateExercises, invalidateLibrary, invalidatePlans, invalidateRecords, invalidateLyricFile } from '@/modules/music/dataLoaders'
import type { PresetName } from '@/modules/visualizer/threeScene'
import { useImmersivePrefs, savePrefs as saveImmersivePrefs, type ImmersivePrefs } from '@/composables/useImmersivePrefs'
import { useSfx, setSfxEnabled } from '@/composables/useSfx'
import LiquidSelect from '@/components/LiquidSelect.vue'

const router = useRouter()
const musicStore = useMusicStore()
const backgroundStore = useBackgroundStore()
const { activePreset, switchPreset, setAuroraIdleColor, setAuroraPlayingColor, setVisualizerQuality, setVisualDiy, resetCameraPosition } = useGlobalVisualizer()
const toast = useGlobalToast()

const isOpen = defineModel<boolean>('open', { default: false })
function close() { isOpen.value = false }

// ── SFX ──
const sfx = useSfx()
const sfxEnabled = sfx.enabled
function toggleSfx() {
  const newVal = !sfxEnabled.value
  setSfxEnabled(newVal)
  // 开启时播放确认音效
  if (newVal) sfx.confirm()
}

const tabs = [
  { id: 'theme', label: '主题' },
  { id: 'lyric', label: '歌词' },
  { id: 'color', label: '颜色' },
  { id: 'settings', label: '设置' },
] as const

const activeTab = ref<'theme' | 'lyric' | 'color' | 'settings'>('theme')

// ── Theme DIY state ──
const quality = ref('high')

const presetOptions = [
  { value: 'reactive' as PresetName, label: '共鸣 · Resonance', desc: '随声律动脉动' },
  { value: 'lens' as PresetName, label: '棱镜 · Prism', desc: '透镜折射封面' },
  { value: 'crystalBloom' as PresetName, label: '核璇 · Nucleus', desc: '胶囊核·四球环绕' },
  { value: 'tiles' as PresetName, label: '穹璇 · Orbis', desc: '切片拼成穹顶' },
  { value: 'cover' as PresetName, label: '星屑 · Étoile', desc: '微光凝成封面' },
  { value: 'nuage' as PresetName, label: '雾扰 · Nuage', desc: '空灵·纯烟雾背景' },
]

// KPI 3D params
const kpiParallax = ref(8)
const kpiDepthMul = ref(1.0)
const kpiGap = ref(128)

// ── Visual DIY state (3D visual adjustments) ──
const visualDiy = reactive({
  scale: 1.0,
  particleDensity: 100,
  depth: 1.0,
  glow: 1.0,
})

// ── Lyric DIY state ──
const lyricColorPresets = [
  { value: 'auto', label: '自动取色' },
  { value: 'rgba(255,255,255,0.85)', label: '白色' },
  { value: 'rgba(250,88,106,0.85)', label: '珊瑚红' },
  { value: 'rgba(126,200,227,0.85)', label: '冰蓝' },
  { value: 'rgba(201,169,110,0.85)', label: '暖金' },
  { value: 'rgba(180,220,130,0.85)', label: '翠绿' },
  { value: 'rgba(200,160,255,0.85)', label: '紫罗兰' },
]
const lyricFontFamilies = [
  { value: 'var(--font-display)', label: 'Space Grotesk' },
  { value: 'var(--font-body)', label: 'Inter' },
  { value: 'var(--font-hero)', label: 'Sora' },
  // ── 英文无衬线 ──
  { value: "'Poppins', sans-serif", label: 'Poppins' },
  { value: "'Outfit', sans-serif", label: 'Outfit' },
  { value: "'DM Sans', sans-serif", label: 'DM Sans' },
  { value: "'Manrope', sans-serif", label: 'Manrope' },
  { value: "'Quicksand', sans-serif", label: 'Quicksand' },
  { value: "'Nunito', sans-serif", label: 'Nunito' },
  // ── 英文展示/个性 ──
  { value: "'Bebas Neue', sans-serif", label: 'Bebas Neue' },
  { value: "'Righteous', sans-serif", label: 'Righteous' },
  // ── 英文衬线 ──
  { value: "'Playfair Display', serif", label: 'Playfair Display' },
  // ── 中文字体 ──
  { value: "'Noto Sans SC', sans-serif", label: '思源黑体' },
  { value: "'Noto Serif SC', serif", label: '思源宋体' },
  { value: "'ZCOOL KuaiLe', sans-serif", label: '站酷快乐体' },
  { value: "'Ma Shan Zheng', cursive", label: '马善政楷书' },
  { value: "'Long Cang', cursive", label: '龙藏体' },
  // ── 系统 ──
  { value: 'system-ui, sans-serif', label: '系统默认' },
]
// Computed options for LiquidSelect — each option renders in its own font
const lyricFontOptions = computed(() =>
  lyricFontFamilies.map(f => ({
    value: f.value,
    label: f.label,
    style: { fontFamily: f.value },
  }))
)
const lyricFontWeights = [
  { value: 300, label: '细' },
  { value: 400, label: '常规' },
  { value: 500, label: '中等' },
  { value: 600, label: '中粗' },
  { value: 700, label: '粗' },
]
const lyricSettings = ref({
  show: true,
  opacity: 0.85,
  fontSize: 28,
  color: 'auto',
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  glowIntensity: 1.0,
  lineSpacing: 80,
  animSpeed: 0.5,
})

// ── Color DIY state ──
const accentColorPresets = [
  { value: '#fa586a', label: '珊瑚红' },
  { value: '#7EC8E3', label: '冰蓝' },
  { value: '#C9A96E', label: '暖金' },
  { value: '#7EC8A0', label: '翠绿' },
  { value: '#B4A0FF', label: '紫罗兰' },
  { value: '#FF8C42', label: '橙色' },
]
const glassTintPresets = [
  { value: 'transparent', label: '无' },
  { value: 'rgba(250,88,106,0.08)', label: '珊瑚' },
  { value: 'rgba(126,200,227,0.08)', label: '冰蓝' },
  { value: 'rgba(201,169,110,0.08)', label: '暖金' },
  { value: 'rgba(180,220,130,0.08)', label: '翠绿' },
]
const colorSettings = ref({
  accent: '#fa586a',
  glassTint: 'transparent',
  cardOpacity: 0.86,
  glassBlur: 24,
  cornerRadius: 16,
})

// ── Aurora color DIY state ──
const auroraColorPresets = [
  { value: 'auto', label: '自动' },
  { value: '#7EC8E3', label: '冰蓝' },
  { value: '#fa586a', label: '珊瑚红' },
  { value: '#C9A96E', label: '暖金' },
  { value: '#7EC8A0', label: '翠绿' },
  { value: '#B4A0FF', label: '紫罗兰' },
  { value: '#e8e8f0', label: '月白' },
]
const auroraSettings = ref({
  idleColor: 'auto',
  playingColor: 'auto',
  brightness: 1.0,
})

// ── Chart color DIY state ──
const chartColorPresets = [
  { value: '#fa586a', label: '珊瑚红' },
  { value: '#7EC8E3', label: '冰蓝' },
  { value: '#C9A96E', label: '暖金' },
  { value: '#7EC8A0', label: '翠绿' },
  { value: '#B4A0FF', label: '紫罗兰' },
  { value: '#FF8C42', label: '橙色' },
  { value: '#5eead4', label: '青碧' },
  { value: '#f472b6', label: '粉樱' },
]
const chartSettings = ref({
  primary: '#fa586a',
})

// ── Settings state ──
const defaultVolume = ref(0.7)
const playMode = ref('sequential')
const playModeOptions = [
  { value: 'sequential', label: '顺序播放' },
  { value: 'repeat', label: '单曲循环' },
  { value: 'shuffle', label: '随机播放' },
]

// ── SFX: panel open/close ──
watch(isOpen, (open) => {
  if (open) sfx.airBloom()
  else sfx.retract()
})

// ── Auto lyric color: re-apply when album palette changes ──
// When lyric color is 'auto', the text/focus colors are derived from the
// album cover palette. This watch ensures they update in real-time when
// the track changes (and thus the palette changes).
watch(() => musicStore.currentCoverPalette, () => {
  if (lyricSettings.value.color === 'auto') {
    applyLyricPrefs()
  }
})

// ── Immersive prefs state ──
const { prefs: immersivePrefs } = useImmersivePrefs()

function toggleImmersive(key: keyof ImmersivePrefs) {
  immersivePrefs.value[key] = !immersivePrefs.value[key]
  saveImmersivePrefs(immersivePrefs.value)
  sfx.detent()
  const labels: Record<string, string> = {
hideHomeFitness: '首页训练卡片',
hideHomeMusic: '首页歌单卡片',
hideHomeSearch: '首页搜索框',
    hideMusicShelfHeader: '音乐库顶部栏',
    hideFitnessShelfHeader: '动作库顶部栏',
  }
  const label = labels[key] || key
  toast.success(`${label}已${immersivePrefs.value[key] ? '隐藏' : '显示'}`)
}

// ── Keyboard shortcuts ──
interface ShortcutBinding {
  action: string
  label: string
  accelerator: string
  channel: string
}
const shortcutBindings = ref<ShortcutBinding[]>([])
const capturingAction = ref<string | null>(null)
const shortcutError = ref('')

// ── Computed ──
const bgPreviewUrl = computed(() =>
  backgroundStore.pendingUrl || backgroundStore.imageUrl
)

// ── Lifecycle ──
onMounted(async () => {
  await loadAllSettings()
  window.addEventListener('keydown', onGlobalCaptureKey, true)
  // Color picker global pointer tracking
  window.addEventListener('pointermove', cpOnPointerMove)
  window.addEventListener('pointerup', cpOnPointerUp)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalCaptureKey, true)
  window.removeEventListener('pointermove', cpOnPointerMove)
  window.removeEventListener('pointerup', cpOnPointerUp)
})

async function loadAllSettings() {
  try {
    if (!window.electronAPI) return
    const settings = await window.electronAPI.settings.get()
    if (settings.success && settings.data) {
      const s = settings.data
      quality.value = s['visualizer.quality'] || 'high'
      setVisualizerQuality(quality.value as 'high' | 'medium' | 'low')
      defaultVolume.value = parseFloat(s['volume']) || 0.7
      playMode.value = s['playMode'] || 'sequential'
    }
  } catch (e) {
    console.error('[ControlPanel] Failed to load settings:', e)
  }

  try {
    const kpiPrefs = localStorage.getItem('beatzfit:kpiPrefs')
    if (kpiPrefs) {
      const p = JSON.parse(kpiPrefs)
      kpiParallax.value = p.parallax ?? 8
      kpiDepthMul.value = p.depthMul ?? 1.0
      kpiGap.value = p.gap ?? 128
    }
    const lyricPrefs = localStorage.getItem('beatzfit:lyricPrefs')
    if (lyricPrefs) {
      Object.assign(lyricSettings.value, JSON.parse(lyricPrefs))
    }
    const colorPrefs = localStorage.getItem('beatzfit:colorPrefs')
    if (colorPrefs) {
      Object.assign(colorSettings.value, JSON.parse(colorPrefs))
    }
    const auroraPrefs = localStorage.getItem('beatzfit:auroraPrefs')
    if (auroraPrefs) {
      Object.assign(auroraSettings.value, JSON.parse(auroraPrefs))
    }
    const chartPrefs = localStorage.getItem('beatzfit:chartPrefs')
    if (chartPrefs) {
      Object.assign(chartSettings.value, JSON.parse(chartPrefs))
    }
    const visDiyPrefs = localStorage.getItem('beatzfit:visualDiy')
    if (visDiyPrefs) {
      Object.assign(visualDiy, JSON.parse(visDiyPrefs))
    }
    // Apply visual DIY to the visualizer engine
    setVisualDiy({
      scale: visualDiy.scale,
      particleDensity: visualDiy.particleDensity / 100,
      depth: visualDiy.depth,
      glow: visualDiy.glow,
    })
  } catch (e) {
    console.warn('[ControlPanel] Failed to load DIY prefs:', e)
  }

  applyLyricPrefs()
  applyColorPrefs()
  applyAuroraPrefs()
  applyChartPrefs()

  await backgroundStore.loadSettings()
  await backgroundStore.loadHistory()

  await loadShortcuts()
}

// ── Theme DIY actions ──
async function setPreset(name: PresetName) {
  await switchPreset(name)
  toast.success(`已切换到「${presetOptions.find(o => o.value === name)?.label || name}」`)
}

async function setQuality(level: string) {
  quality.value = level
  await saveSetting('visualizer.quality', level)
  setVisualizerQuality(level as 'high' | 'medium' | 'low')
}

function saveKpiPrefs() {
  localStorage.setItem('beatzfit:kpiPrefs', JSON.stringify({
    parallax: kpiParallax.value,
    depthMul: kpiDepthMul.value,
    gap: kpiGap.value,
  }))
  window.dispatchEvent(new CustomEvent('beatzfit:kpiPrefsChanged'))
}

function resetKpiPrefs() {
  kpiParallax.value = 8
  kpiDepthMul.value = 1.0
  kpiGap.value = 128
  saveKpiPrefs()
  toast.success('数据页 3D 设置已恢复默认')
}

function saveVisualDiy() {
  localStorage.setItem('beatzfit:visualDiy', JSON.stringify({ ...visualDiy }))
  // Apply to visualizer engine in real-time
  setVisualDiy({
    scale: visualDiy.scale,
    particleDensity: visualDiy.particleDensity / 100,
    depth: visualDiy.depth,
    glow: visualDiy.glow,
  })
}

function resetVisualDiy() {
  visualDiy.scale = 1.0
  visualDiy.particleDensity = 100
  visualDiy.depth = 1.0
  visualDiy.glow = 1.0
  saveVisualDiy()
  toast.success('3D 视觉调整已恢复默认')
}

function resetCameraView() {
  try {
    localStorage.removeItem('beatzfit-camera-offset')
  } catch (e) {
    console.warn('[ControlPanel] Failed to remove camera offset:', e)
  }
  resetCameraPosition()
  toast.success('相机视角已重置')
}

async function setBackgroundMode(mode: 'visualizer' | 'image') {
  await backgroundStore.setMode(mode)
}
async function selectBackgroundImage() { await backgroundStore.pickImage() }
async function applyBackground() { await backgroundStore.applyPending() }
async function cancelBackground() { await backgroundStore.cancelPending() }
async function applyHistoryItem(id: string) { await backgroundStore.applyHistoryItem(id) }
async function deleteHistoryItem(id: string) { await backgroundStore.deleteHistoryItem(id) }
async function resetBackground() {
  const ok = await toast.confirm({
    title: '恢复默认背景',
    message: '确定恢复默认背景吗？',
    confirmText: '恢复',
  })
  if (ok) await backgroundStore.reset()
}

// ── Color parsing helper ──
interface RgbaParsed { r: number; g: number; b: number; a: number }
function parseRgba(str: string): RgbaParsed | null {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/)
  if (!m) {
    // Try hex
    const hm = str.match(/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
    if (hm) return { r: parseInt(hm[1], 16), g: parseInt(hm[2], 16), b: parseInt(hm[3], 16), a: 1 }
    return null
  }
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 }
}
function rgbaToString(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 100) / 100})`
}

// ── RGB panel expansion state ──
// Each color section can expand to show R/G/B/A inputs
const expandedColorPanel = ref<string | null>(null)
function toggleColorPanel(id: string) {
  expandedColorPanel.value = expandedColorPanel.value === id ? null : id
  sfx.detent()
}

// RGB input values for each color section — pre-initialized to avoid v-model optional chaining
const rgbInputs = reactive<Record<string, { r: number; g: number; b: number; a: number }>>({
  lyric: { r: 255, g: 255, b: 255, a: 0.85 },
  accent: { r: 250, g: 88, b: 106, a: 1 },
  auroraIdle: { r: 232, g: 232, b: 240, a: 1 },
  auroraPlay: { r: 126, g: 200, b: 227, a: 1 },
  glassTint: { r: 250, g: 88, b: 106, a: 0.08 },
  chartPrimary: { r: 250, g: 88, b: 106, a: 1 },
})
function initRgbInputs(id: string, colorStr: string) {
  const parsed = parseRgba(colorStr)
  if (parsed) {
    rgbInputs[id] = { ...parsed }
  } else {
    rgbInputs[id] = { r: 255, g: 255, b: 255, a: 1 }
  }
}
function syncRgbFromSetting(id: string, colorStr: string) {
  const parsed = parseRgba(colorStr)
  if (parsed && rgbInputs[id]) {
    rgbInputs[id].r = parsed.r
    rgbInputs[id].g = parsed.g
    rgbInputs[id].b = parsed.b
    rgbInputs[id].a = parsed.a
  }
}

// ── RGB input handlers for each color section ──
function applyRgbToLyric() {
  const v = rgbInputs.lyric
  if (!v) return
  lyricSettings.value.color = rgbaToString(v.r, v.g, v.b, v.a)
  saveLyricPrefs()
  applyLyricPrefs()
}
function applyRgbToAccent() {
  const v = rgbInputs.accent
  if (!v) return
  colorSettings.value.accent = rgbaToString(v.r, v.g, v.b, 1)
  saveColorPrefs()
  applyColorPrefs()
}
function applyRgbToAuroraIdle() {
  const v = rgbInputs.auroraIdle
  if (!v) return
  auroraSettings.value.idleColor = rgbaToString(v.r, v.g, v.b, 1)
  saveAuroraPrefs()
  applyAuroraPrefs()
}
function applyRgbToAuroraPlay() {
  const v = rgbInputs.auroraPlay
  if (!v) return
  auroraSettings.value.playingColor = rgbaToString(v.r, v.g, v.b, 1)
  saveAuroraPrefs()
  applyAuroraPrefs()
}
function applyRgbToGlassTint() {
  const v = rgbInputs.glassTint
  if (!v) return
  colorSettings.value.glassTint = rgbaToString(v.r, v.g, v.b, v.a)
  saveColorPrefs()
  applyColorPrefs()
}

// ── Color picker (SV square + hue slider) ──
// Compact inline picker embedded in each cp-rgb-panel.
// Dragging updates rgbInputs[panelId] and triggers the corresponding apply function.
const cpPickerRefs = ref<Record<string, HTMLElement>>({})
const cpHueRefs = ref<Record<string, HTMLElement>>({})
let cpDragging: 'sv' | 'hue' | null = null
let cpDraggingPanel = ''

function setPickerRef(el: any, id: string) {
  if (el) cpPickerRefs.value[id] = el as HTMLElement
  else delete cpPickerRefs.value[id]
}
function setHueRef(el: any, id: string) {
  if (el) cpHueRefs.value[id] = el as HTMLElement
  else delete cpHueRefs.value[id]
}

// RGB → HSV
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

// HSV → RGB
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

// Get current hue for a panel's rgbInputs
function cpHue(id: string): number {
  const v = rgbInputs[id]
  if (!v) return 0
  return rgbToHsv(v.r, v.g, v.b).h
}

// SV position (0-100%) for the picker cursor
function cpSvPos(id: string): { x: number; y: number } {
  const v = rgbInputs[id]
  if (!v) return { x: 100, y: 0 }
  const hsv = rgbToHsv(v.r, v.g, v.b)
  return { x: hsv.s * 100, y: (1 - hsv.v) * 100 }
}

// Background for the SV square — uses current hue
function cpSvBg(id: string): string {
  const h = cpHue(id)
  return `hsl(${h}, 100%, 50%)`
}

// Apply picker result to the target setting
function cpApply(id: string) {
  switch (id) {
    case 'lyric': applyRgbToLyric(); break
    case 'accent': applyRgbToAccent(); break
    case 'auroraIdle': applyRgbToAuroraIdle(); break
    case 'auroraPlay': applyRgbToAuroraPlay(); break
    case 'glassTint': applyRgbToGlassTint(); break
    case 'chartPrimary': applyRgbToChartPrimary(); break
  }
}

function cpOnPointerDown(e: PointerEvent, id: string, type: 'sv' | 'hue') {
  e.preventDefault()
  e.stopPropagation()
  cpDragging = type
  cpDraggingPanel = id
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  cpUpdateFromPointer(e, id, type)
}

function cpUpdateFromPointer(e: PointerEvent, id: string, type: 'sv' | 'hue') {
  if (type === 'sv') {
    const el = cpPickerRefs.value[id]
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const h = cpHue(id)
    const rgb = hsvToRgb(h, x, 1 - y)
    const v = rgbInputs[id]
    if (v) {
      v.r = rgb.r; v.g = rgb.g; v.b = rgb.b
      cpApply(id)
    }
  } else {
    const el = cpHueRefs.value[id]
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const h = x * 360
    const v = rgbInputs[id]
    if (v) {
      const hsv = rgbToHsv(v.r, v.g, v.b)
      const rgb = hsvToRgb(h, hsv.s, hsv.v)
      v.r = rgb.r; v.g = rgb.g; v.b = rgb.b
      cpApply(id)
    }
  }
}

function cpOnPointerMove(e: PointerEvent) {
  if (!cpDragging || !cpDraggingPanel) return
  cpUpdateFromPointer(e, cpDraggingPanel, cpDragging)
}

function cpOnPointerUp(e: PointerEvent) {
  if (cpDragging) {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  cpDragging = null
  cpDraggingPanel = ''
}

// ── Lyric DIY actions ──
function saveLyricPrefs() {
  localStorage.setItem('beatzfit:lyricPrefs', JSON.stringify(lyricSettings.value))
}

function applyLyricPrefs() {
  const root = document.documentElement
  root.style.setProperty('--cp-lyric-opacity', String(lyricSettings.value.opacity))
  root.style.setProperty('--cp-lyric-font-size', `${lyricSettings.value.fontSize}px`)
  root.style.setProperty('--cp-lyric-color', lyricSettings.value.color)
  root.style.setProperty('--cp-lyric-show', lyricSettings.value.show ? '1' : '0')
  root.style.setProperty('--cp-lyric-display', lyricSettings.value.show ? 'flex' : 'none')
  root.style.setProperty('--cp-lyric-font-family', lyricSettings.value.fontFamily)
  root.style.setProperty('--cp-lyric-font-weight', String(lyricSettings.value.fontWeight))
  root.style.setProperty('--cp-lyric-glow-mult', String(lyricSettings.value.glowIntensity))
  root.style.setProperty('--cp-lyric-spacing', `${lyricSettings.value.lineSpacing}px`)
  root.style.setProperty('--cp-lyric-anim-speed', String(lyricSettings.value.animSpeed))
  // 文字颜色: 非focus行用半透明版本, focus行用完整颜色
  if (lyricSettings.value.color === 'auto') {
    // 自动模式: 从专辑封面提取最鲜艳的颜色 (vivid)
    // vivid 颜色经过 HSL 增强: 饱和度≥0.5, 亮度 0.55-0.75
    // 纯黑/灰色专辑自动回退为白色
    const palette = musicStore.currentCoverPalette
    if (palette?.vivid) {
      const m = palette.vivid.match(/^#([0-9a-fA-F]{6})$/)
      if (m) {
        const r = parseInt(m[1].slice(0, 2), 16)
        const g = parseInt(m[1].slice(2, 4), 16)
        const b = parseInt(m[1].slice(4, 6), 16)
        // 非焦点行: 半透明版本
        root.style.setProperty('--cp-lyric-text-color', `rgba(${r},${g},${b},0.5)`)
        // 焦点行: 完整颜色
        root.style.setProperty('--cp-lyric-focus-color', `rgba(${r},${g},${b},0.95)`)
      } else {
        root.style.setProperty('--cp-lyric-text-color', 'rgba(255,255,255,0.5)')
        root.style.setProperty('--cp-lyric-focus-color', 'rgba(255,255,255,0.95)')
      }
    } else {
      // 无封面时回退到白色
      root.style.setProperty('--cp-lyric-text-color', 'rgba(255,255,255,0.5)')
      root.style.setProperty('--cp-lyric-focus-color', 'rgba(255,255,255,0.95)')
    }
  } else {
    // 自定义颜色: 解析 rgba 并生成半透明版本
    const parsed = parseRgba(lyricSettings.value.color)
    if (parsed) {
      root.style.setProperty('--cp-lyric-text-color', `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a * 0.6})`)
      root.style.setProperty('--cp-lyric-focus-color', `rgba(${parsed.r},${parsed.g},${parsed.b},${Math.min(1, parsed.a * 1.1)})`)
    } else {
      root.style.setProperty('--cp-lyric-text-color', lyricSettings.value.color)
      root.style.setProperty('--cp-lyric-focus-color', lyricSettings.value.color)
    }
  }
  // 应用不透明度到歌词层根元素
  const lyricLayer = document.querySelector('[data-lyric-layer]') as HTMLElement
  if (lyricLayer) {
    lyricLayer.style.opacity = String(lyricSettings.value.opacity)
    lyricLayer.style.display = lyricSettings.value.show ? '' : 'none'
  }
}

function resetLyricPrefs() {
  lyricSettings.value = {
    show: true,
    opacity: 0.85,
    fontSize: 28,
    color: 'auto',
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    glowIntensity: 1.0,
    lineSpacing: 80,
    animSpeed: 0.5,
  }
  // 清除覆写的 CSS 变量
  const root = document.documentElement
  root.style.removeProperty('--cp-lyric-glow-mult')
  root.style.removeProperty('--cp-lyric-spacing')
  root.style.removeProperty('--cp-lyric-anim-speed')
  root.style.removeProperty('--cp-lyric-text-color')
  root.style.removeProperty('--cp-lyric-focus-color')
  saveLyricPrefs()
  applyLyricPrefs()
  // 重置 RGB 输入面板
  initRgbInputs('lyric', 'auto')
  toast.success('歌词设置已恢复默认')
}

// ── Color DIY actions ──
function saveColorPrefs() {
  localStorage.setItem('beatzfit:colorPrefs', JSON.stringify(colorSettings.value))
}

function applyColorPrefs() {
  const root = document.documentElement
  // 强调色: 覆写 --accent-ice 使全局生效
  root.style.setProperty('--accent-ice', colorSettings.value.accent)
  root.style.setProperty('--cp-accent', colorSettings.value.accent)
  // 玻璃色调: 覆写 --glass-bg 叠加色调
  root.style.setProperty('--cp-glass-tint', colorSettings.value.glassTint)
  if (colorSettings.value.glassTint !== 'transparent') {
    root.style.setProperty('--glass-bg', colorSettings.value.glassTint)
  } else {
    root.style.removeProperty('--glass-bg')
  }
  // 卡片不透明度: 调整 --glass-bg 的 alpha
  root.style.setProperty('--cp-card-opacity', String(colorSettings.value.cardOpacity))
  // 通过设定 --t4-bg 的不透明度来控制卡片浓度
  const opacity = colorSettings.value.cardOpacity
  root.style.setProperty('--t4-bg', `linear-gradient(135deg, rgba(255,255,255,${opacity * 0.12}) 0%, rgba(255,255,255,${opacity * 0.06}) 100%)`)
  root.style.setProperty('--t4-bg-hover', `linear-gradient(135deg, rgba(255,255,255,${opacity * 0.18}) 0%, rgba(255,255,255,${opacity * 0.10}) 100%)`)
  // 玻璃模糊强度
  root.style.setProperty('--glass-blur', `${colorSettings.value.glassBlur}px`)
  root.style.setProperty('--lg-primary-blur', `${colorSettings.value.glassBlur}px`)
  root.style.setProperty('--lg-secondary-blur', `${Math.round(colorSettings.value.glassBlur * 0.75)}px`)
  root.style.setProperty('--lg-interactive-blur', `${Math.round(colorSettings.value.glassBlur * 0.5)}px`)
  // 圆角大小
  const r = colorSettings.value.cornerRadius
  root.style.setProperty('--radius-sm', `${Math.round(r * 0.5)}px`)
  root.style.setProperty('--radius-md', `${r}px`)
  root.style.setProperty('--radius-lg', `${Math.round(r * 1.5)}px`)
  root.style.setProperty('--radius-xl', `${Math.round(r * 2)}px`)
}

function resetColorPrefs() {
  colorSettings.value = { accent: '#fa586a', glassTint: 'transparent', cardOpacity: 0.86, glassBlur: 24, cornerRadius: 16 }
  saveColorPrefs()
  // 清除覆写的 CSS 变量
  document.documentElement.style.removeProperty('--accent-ice')
  document.documentElement.style.removeProperty('--glass-bg')
  document.documentElement.style.removeProperty('--t4-bg')
  document.documentElement.style.removeProperty('--t4-bg-hover')
  document.documentElement.style.removeProperty('--glass-blur')
  document.documentElement.style.removeProperty('--lg-primary-blur')
  document.documentElement.style.removeProperty('--lg-secondary-blur')
  document.documentElement.style.removeProperty('--lg-interactive-blur')
  document.documentElement.style.removeProperty('--radius-sm')
  document.documentElement.style.removeProperty('--radius-md')
  document.documentElement.style.removeProperty('--radius-lg')
  document.documentElement.style.removeProperty('--radius-xl')
  applyColorPrefs()
  toast.success('颜色设置已恢复默认')
}

// ── Aurora color DIY actions ──
function saveAuroraPrefs() {
  localStorage.setItem('beatzfit:auroraPrefs', JSON.stringify(auroraSettings.value))
}

function applyAuroraPrefs() {
  const idle = auroraSettings.value.idleColor
  const playing = auroraSettings.value.playingColor
  setAuroraIdleColor(idle === 'auto' ? null : idle)
  setAuroraPlayingColor(playing === 'auto' ? null : playing)
  // Aurora brightness — applied via CSS variable consumed by AuroraBackground.vue
  document.documentElement.style.setProperty('--cp-aurora-brightness', String(auroraSettings.value.brightness))
}

function resetAuroraPrefs() {
  auroraSettings.value = { idleColor: 'auto', playingColor: 'auto', brightness: 1.0 }
  saveAuroraPrefs()
  applyAuroraPrefs()
  toast.success('背景烟雾颜色已恢复默认')
}

// ── Chart color DIY actions ──
function saveChartPrefs() {
  localStorage.setItem('beatzfit:chartPrefs', JSON.stringify(chartSettings.value))
}

function applyChartPrefs() {
  const root = document.documentElement
  const primary = chartSettings.value.primary
  // 解析 hex → rgb 分量
  const m = primary.match(/^#([0-9a-f]{6})$/i)
  const r = m ? parseInt(m[1].slice(0, 2), 16) : 250
  const g = m ? parseInt(m[1].slice(2, 4), 16) : 88
  const b = m ? parseInt(m[1].slice(4, 6), 16) : 106
  // 暗色变体 (用于渐变底部)
  const darkR = Math.round(r * 0.5)
  const darkG = Math.round(g * 0.05)
  const darkB = Math.round(b * 0.1)
  // 亮色变体 (用于渐变顶部/圆环)
  const lightR = Math.min(255, r + 30)
  const lightG = Math.min(255, g + 40)
  const lightB = Math.min(255, b + 40)
  root.style.setProperty('--chart-primary', primary)
  root.style.setProperty('--chart-primary-rgb', `${r}, ${g}, ${b}`)
  root.style.setProperty('--chart-dark', `rgb(${darkR}, ${darkG}, ${darkB})`)
  root.style.setProperty('--chart-light', `rgb(${lightR}, ${lightG}, ${lightB})`)
  root.style.setProperty('--chart-dark-rgb', `${darkR}, ${darkG}, ${darkB}`)
  root.style.setProperty('--chart-light-rgb', `${lightR}, ${lightG}, ${lightB}`)
}

function resetChartPrefs() {
  chartSettings.value = { primary: '#fa586a' }
  saveChartPrefs()
  applyChartPrefs()
  toast.success('图表配色已恢复默认')
}

// RGB picker → chart primary
function applyRgbToChartPrimary() {
  const v = rgbInputs.chartPrimary
  if (!v) return
  const hex = '#' + [v.r, v.g, v.b].map(c => {
    const clamped = Math.max(0, Math.min(255, Math.round(c)))
    return clamped.toString(16).padStart(2, '0')
  }).join('')
  chartSettings.value.primary = hex
  saveChartPrefs()
  applyChartPrefs()
}

// ── Settings actions ──
async function saveSetting(key: string, value: string) {
  if (!window.electronAPI) return
  await window.electronAPI.settings.set(key, value)
}

function setVolume(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  defaultVolume.value = val
  musicStore.setVolume(val)
  saveSetting('volume', val.toString())
}

async function resetApp() {
  const confirmed = await toast.confirm({
    title: '重置应用数据',
    message: '此操作将清除以下数据：\n• 训练计划与训练历史\n• 本地音乐库与播放记录\n• 网易云登录状态与缓存\n• 自定义背景与所有设置\n\n以下数据将被保留：\n• 动作库数据（已缓存的动作GIF）\n• 已缓存的专辑封面图片\n\n应用将在清除完成后自动重启。',
    confirmText: '重置',
    danger: true,
  })
  if (confirmed && window.electronAPI) {
    musicStore.stopAudio()
    musicStore.clearQueue()
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('beatzfit:diskcache:')) keysToRemove.push(k)
      }
      for (const k of keysToRemove) localStorage.removeItem(k)
    } catch (e) { console.warn('[ControlPanel] Failed to clear disk cache keys:', e) }
    await window.electronAPI.settings.clearAllData()
  }
}

async function syncNow() {
  if (!window.electronAPI) return
  const result = await window.electronAPI.exercise.syncFromAPI()
  if (result.success) {
    invalidateExercises()
    toast.success(`同步完成, ${result.data?.total || 0} 个动作已更新`)
  } else {
    toast.error(result.error || '同步失败')
  }
}

function clearAllCaches() {
  cacheClear()
  invalidateLibrary()
  invalidatePlans()
  invalidateRecords()
  invalidateExercises()
  invalidateLyricFile()
  toast.success('所有缓存已清空')
}

function replayOnboarding() {
  window.electronAPI?.settings?.set('onboarding_completed', '').then(() => {
    router.push('/')
    setTimeout(() => window.location.reload(), 300)
  })
}

function toBeatUrl(path: string) {
  if (!path) return ''
  return `beat://${encodeURIComponent(path)}`
}

// ── Keyboard shortcuts ──
async function loadShortcuts() {
  try {
    if (!window.electronAPI?.shortcuts) return
    const result = await window.electronAPI.shortcuts.get()
    if (result.success && result.data) {
      shortcutBindings.value = result.data.shortcuts
    }
  } catch (e) {
    console.error('[ControlPanel] Failed to load shortcuts:', e)
  }
}

function startCapture(action: string) {
  capturingAction.value = action
  shortcutError.value = ''
}

function formatAccelerator(accel: string): string {
  return accel
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Shift/g, 'Shift')
    .replace(/Alt/g, 'Alt')
    .replace(/\+/g, ' + ')
}

function onGlobalCaptureKey(e: KeyboardEvent) {
  if (!capturingAction.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    capturingAction.value = null
    shortcutError.value = ''
    return
  }
  const action = capturingAction.value
  // Ignore bare modifier presses
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return

  e.preventDefault()
  e.stopPropagation()

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  // Resolve key: prefer e.key, fall back to e.code for IME-affected keys
  let key = e.key
  // IME composition or unidentified key — fall back to physical key code
  if (key === 'Unidentified' || key === 'Process' || key === '') {
    key = codeToKey(e.code)
  }

  // Normalize key to Electron accelerator format
  if (key === ' ' || key === 'Space') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()
  else if (key.startsWith('Arrow')) key = key.replace('Arrow', '')

  // Reject if we still couldn't identify the key
  if (!key || key === 'Unidentified' || key === 'Process') {
    shortcutError.value = '无法识别该按键，请尝试其他组合'
    return
  }

  // Require at least one non-Shift modifier
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'Shift')) {
    shortcutError.value = '快捷键需要包含 Ctrl 或 Alt 修饰键'
    return
  }

  parts.push(key)
  const accel = parts.join('+')

  window.electronAPI?.shortcuts?.update(action, accel).then((result) => {
    if (result.success && result.data) {
      shortcutBindings.value = result.data.shortcuts
      shortcutError.value = ''
    } else {
      shortcutError.value = result.error || '设置失败'
    }
  }).catch((err: any) => {
    shortcutError.value = err.message || '设置失败'
  })
  capturingAction.value = null
}

/** Map KeyboardEvent.code to Electron accelerator key name */
function codeToKey(code: string): string {
  if (!code) return ''
  // Letters: KeyA → A
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  // Digits: Digit1 → 1
  if (code.startsWith('Digit') && code.length === 7) return code.slice(5)
  // Function keys: F1-F24
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  // Arrows
  if (code === 'ArrowUp') return 'Up'
  if (code === 'ArrowDown') return 'Down'
  if (code === 'ArrowLeft') return 'Left'
  if (code === 'ArrowRight') return 'Right'
  // Special keys
  if (code === 'Space') return 'Space'
  if (code === 'Enter') return 'Return'
  if (code === 'Backspace') return 'Backspace'
  if (code === 'Tab') return 'Tab'
  if (code === 'Insert') return 'Insert'
  if (code === 'Delete') return 'Delete'
  if (code === 'Home') return 'Home'
  if (code === 'End') return 'End'
  if (code === 'PageUp') return 'PageUp'
  if (code === 'PageDown') return 'PageDown'
  // Numpad
  if (code.startsWith('Numpad')) {
    const np = code.slice(6)
    if (/^\d$/.test(np)) return 'num' + np
    if (np === 'Add') return 'numpad_add'
    if (np === 'Subtract') return 'numpad_subtract'
    if (np === 'Multiply') return 'numpad_multiply'
    if (np === 'Divide') return 'numpad_divide'
    if (np === 'Decimal') return 'numpad_decimal'
  }
  // Punctuation / symbols — Electron accepts these literally
  if (code.startsWith('Semicolon')) return ';'
  if (code.startsWith('Equal')) return '='
  if (code.startsWith('Comma')) return ','
  if (code.startsWith('Minus')) return '-'
  if (code.startsWith('Period')) return '.'
  if (code.startsWith('Slash')) return '/'
  if (code.startsWith('Backquote')) return '`'
  if (code.startsWith('BracketLeft')) return '['
  if (code.startsWith('Backslash')) return '\\'
  if (code.startsWith('BracketRight')) return ']'
  if (code.startsWith('Quote')) return "'"
  return ''
}

async function resetShortcuts() {
  try {
    if (!window.electronAPI?.shortcuts) return
    const result = await window.electronAPI.shortcuts.reset()
    if (result.success && result.data) {
      shortcutBindings.value = result.data.shortcuts
      shortcutError.value = ''
      toast.success('快捷键已恢复默认')
    } else {
      toast.error(result.error || '重置失败')
    }
  } catch (e) {
    console.error('[ControlPanel] Failed to reset shortcuts:', e)
    toast.error('重置快捷键失败')
  }
}
</script>

<style lang="scss" scoped>
// ── Sidebar shell ──
.cp-sidebar {
  position: fixed;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: 320px;
  z-index: 300;
  display: flex;
  flex-direction: column;
  background: rgba(10, 10, 16, 0.72);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: -12px 0 48px rgba(0, 0, 0, 0.5);
  font-family: var(--font-body);
  font-size: 12.5px;
  color: var(--text-primary);
  overflow: hidden;
  overscroll-behavior: contain;
}

// ── Backdrop ──
.cp-backdrop-el {
  position: fixed;
  inset: 0;
  z-index: 299;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(1px);
  -webkit-backdrop-filter: blur(1px);
}

// ── Slide transition ──
.cp-slide-enter-active,
.cp-slide-leave-active {
  transition: transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.3s ease;
}
.cp-slide-enter-from,
.cp-slide-leave-to {
  transform: translateX(340px);
  opacity: 0;
}

.cp-backdrop-enter-active,
.cp-backdrop-leave-active {
  transition: opacity 0.3s ease;
}
.cp-backdrop-enter-from,
.cp-backdrop-leave-to {
  opacity: 0;
}

// ── Header ──
.cp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.cp-tabs {
  display: flex;
  gap: 2px;
  flex: 1;
}

.cp-tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: none;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  font-family: var(--font-display);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover { color: rgba(255, 255, 255, 0.7); }

  &--active {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }
}

.cp-close {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
}

// ── Body ──
.cp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  overscroll-behavior: contain;

  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar { display: none; }
}

// ── Panel ──
.cp-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

// ── Section title ──
.cp-section-title {
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 10px;
  margin-top: 4px;
}

// ── Divider ──
.cp-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 14px 0 10px;
}

// ── Unified row (replaces old cp-row) ──
// All settings items use this consistent layout:
// label on left, control on right
.cp-uniform-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;

  label {
    display: flex;
    align-items: center;
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
    gap: 8px;

    b {
      color: rgba(255, 255, 255, 0.85);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  }

  input[type="range"] {
    flex: 1;
    max-width: 140px;
    -webkit-appearance: none;
    height: 3px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    outline: none;
    accent-color: rgba(255, 255, 255, 0.7);

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px; height: 14px;
      background: rgba(255, 255, 255, 0.9);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
      transition: transform 0.12s ease;

      &:hover { transform: scale(1.15); }
    }
  }
}

// ── Color picker (SV square + hue slider) ──
.cp-picker-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.cp-sv-square {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  position: relative;
  cursor: crosshair;
  overflow: hidden;
  flex-shrink: 0;
  touch-action: none;
}

.cp-sv-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, #000, transparent),
              linear-gradient(to right, #fff, transparent);
}

.cp-sv-cursor {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 2;
}

.cp-rgb-compact {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;

  .cp-rgb-row {
    gap: 4px;
    span { width: 12px; font-size: 9px; }
    input[type="number"] { padding: 2px 4px; font-size: 10px; }
  }
}

.cp-hue-slider {
  width: 100%;
  height: 12px;
  border-radius: 6px;
  margin-top: 6px;
  position: relative;
  cursor: pointer;
  background: linear-gradient(to right,
    #ff0000 0%, #ffff00 17%, #00ff00 33%,
    #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);
  touch-action: none;
}

.cp-hue-cursor {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.3);
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

// ── Segmented buttons ──
.cp-seg {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.cp-seg-btn {
  flex: 1 1 30%;
  padding: 7px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 11px;
  font-family: var(--font-body);
  transition: all 0.15s ease;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  line-height: 1.2;

  .cp-seg-label {
    font-size: 11px;
    white-space: nowrap;
  }

  .cp-seg-sub {
    font-size: 9px;
    line-height: 1.15;
    color: rgba(255, 255, 255, 0.35);
    white-space: normal;
  }

  &:hover {
    color: rgba(255, 255, 255, 0.8);
    border-color: rgba(255, 255, 255, 0.15);
  }

  &.on {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.25);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);

    .cp-seg-sub {
      color: rgba(255, 255, 255, 0.6);
    }
  }
}

// ── Buttons ──
.cp-btn {
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11.5px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.2);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--primary {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
    color: #fff;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.22);
      border-color: rgba(255, 255, 255, 0.4);
    }
  }

  &--danger {
    color: rgba(255, 100, 110, 0.85);

    &:hover:not(:disabled) {
      background: rgba(232, 17, 35, 0.12);
      border-color: rgba(232, 17, 35, 0.3);
      color: #ff4757;
    }
  }
}

// ── Toggle ──
.cp-toggle {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  flex-shrink: 0;

  &.on {
    background: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.35);
  }
}

.cp-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  transition: all 0.2s ease;

  .cp-toggle.on & {
    transform: translateX(16px);
    background: rgba(255, 255, 255, 0.95);
  }
}

// ── Color swatches ──
.cp-color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.cp-color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;

  &:hover {
    transform: scale(1.1);
    border-color: rgba(255, 255, 255, 0.35);
  }

  &.on {
    border-color: rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2);
  }
}

// ── RGB expansion button ──
.cp-rgb-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  padding: 0;

  &:hover {
    color: rgba(255, 255, 255, 0.8);
    border-color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.08);
  }

  &.on {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.7);
    border-style: solid;
    background: rgba(255, 255, 255, 0.12);
  }
}

// ── RGB input panel ──
.cp-rgb-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.cp-rgb-row {
  display: flex;
  align-items: center;
  gap: 8px;

  span {
    width: 16px;
    font-size: 10px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.4);
    font-family: var(--font-mono, monospace);
    text-align: center;
  }

  input[type="number"] {
    flex: 1;
    width: 100%;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.85);
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    outline: none;
    -moz-appearance: textfield;
    &::-webkit-outer-spin-button,
    &::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    &:focus {
      border-color: rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.08);
    }
  }

  input[type="range"] {
    flex: 1;
    -webkit-appearance: none;
    height: 3px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    outline: none;
    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px; height: 12px;
      background: rgba(255, 255, 255, 0.85);
      border: none;
      border-radius: 50%;
      cursor: pointer;
    }
  }

  b {
    min-width: 32px;
    text-align: right;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums;
  }
}

// ── Segment group (font weight etc.) ──
.cp-segment-group {
  display: inline-flex;
  gap: 2px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.cp-segment {
  padding: 4px 10px;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
  font-size: 11.5px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &.on {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
    font-weight: 600;
  }

  &:hover:not(.on) {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
  }
}

// ── Select ──
.cp-select {
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  font-size: 11.5px;
  font-family: var(--font-body);
  cursor: pointer;
  outline: none;

  option {
    background: #1a1a24;
    color: #fff;
  }
}

// ── Tip text ──
.cp-tip {
  font-size: 10.5px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.35);
  margin: 0;

  b { color: rgba(255, 255, 255, 0.6); }
}

.cp-error {
  font-size: 11px;
  color: #ff6b7a;
  background: rgba(232, 17, 35, 0.1);
  border: 1px solid rgba(232, 17, 35, 0.2);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
}

// ── Sub-panel (background custom) ──
.cp-sub-panel {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cp-bg-preview {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &--empty span {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
  }
}

.cp-bg-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cp-bg-history {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.cp-bg-history-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.cp-bg-history-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover { border-color: rgba(255, 255, 255, 0.2); }
  &.active { border-color: rgba(255, 255, 255, 0.6); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3); }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.cp-bg-history-del {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;

  &:hover { background: rgba(232, 17, 35, 0.8); }
}

.cp-bg-history-item:hover .cp-bg-history-del {
  opacity: 1;
}

// ── Shortcuts ──
.cp-shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cp-shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.cp-shortcut-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

.cp-shortcut-key {
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  font-size: 10.5px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  cursor: pointer;
  min-width: 100px;
  text-align: center;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
  }

  &.capturing {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.35);
    color: rgba(255, 255, 255, 0.9);
    animation: cp-capture-pulse 1s ease-in-out infinite;
  }
}

@keyframes cp-capture-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

// ── About ──
.cp-about {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cp-about-row {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.6);
}
</style>
