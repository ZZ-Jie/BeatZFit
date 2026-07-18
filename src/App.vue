<template>
  <div class="app-shell" :class="{ 'desktop-lyric-mode': isDesktopLyric }">
    <!-- AuroraBackground 已合并入 VisualizerScene (单一 WebGL 上下文) -->
    <GlobalBackground v-if="!isDesktopLyric" />
    <TitleBar v-if="!isDesktopLyric" />

    <!-- 右上角：用户胶囊 + DIY 按钮 (在窗口控制按钮左侧) -->
    <div class="top-right-zone" v-if="!isDesktopLyric"
      @mouseenter="onTopFloatingEnter"
      @mouseleave="onTopFloatingLeave"
    >
      <UserCapsule />
      <button
        class="diy-trigger-btn"
        :class="{ 'is-open': isControlPanelOpen }"
        @click="isControlPanelOpen = !isControlPanelOpen"
        title="DIY 调节面板"
        aria-label="DIY"
      >
        <FrostedGlass :corner-radius="10" variant="interactive" :ambient-color="glassAmbientColor" />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>

    <!-- DIY 侧栏 -->
    <ControlPanel v-model:open="isControlPanelOpen" v-if="!isDesktopLyric" />

    <!-- 弧形 FAB 导航菜单 -->
    <div class="fab-menu-zone" v-if="!isDesktopLyric"
      @mouseenter="onFloatingEnter"
      @mouseleave="onFloatingLeave"
    >
      <!-- 弧形子菜单项 (始终渲染, GSAP 控制可见性) -->
      <div class="fab-items" data-fab-items>
        <div
          v-for="(item, i) in navItems"
          :key="item.to"
          class="fab-item"
          :data-index="i"
        >
          <!-- 胶囊形文字标签 (左侧) -->
          <span class="fab-item-label" :class="{ 'is-active': isRouteActive(item.to) }">
            {{ item.label }}
          </span>
          <!-- 圆形图标按钮 -->
          <button
            class="fab-item-btn"
            :class="{ 'is-active': isRouteActive(item.to) }"
            @click="navigateTo(item.to)"
          >
            <span class="fab-item-icon" v-html="item.icon" />
          </button>
        </div>
      </div>

      <!-- 主 FAB 按钮 -->
        <button
        class="fab-main"
        :class="{ 'is-active': isMenuOpen }"
        @click="toggleMenu"
        aria-label="打开导航"
        title="导航"
      >
        <FrostedGlass
          :corner-radius="999"
          variant="interactive"
          :ambient-color="glassAmbientColor"
        />
        <span class="fab-icon">
          <span class="fab-line fab-line--top" data-fab-line="top"></span>
          <span class="fab-line fab-line--mid" data-fab-line="mid"></span>
          <span class="fab-line fab-line--bot" data-fab-line="bot"></span>
        </span>
      </button>
    </div>

    <!-- 点击外部收起的遮罩 -->
    <Transition :css="false" @enter="backdropTransition.onEnter" @leave="backdropTransition.onLeave">
      <div
        v-if="isMenuOpen"
        class="fab-backdrop"
        @click="closeMenu"
      ></div>
    </Transition>

    <!-- 极简点阵分页指示器 -->
    <div class="page-dots" v-if="!isDesktopLyric && !isSubRoute">
      <button
        v-for="(section, i) in PANEL_ORDER"
        :key="section"
        class="page-dot"
        :class="{ 'is-active': activeSection === section }"
        @click="navigateTo(SECTION_TO_ROUTE[section])"
        :aria-label="section"
      />
    </div>

    <div class="app-layout">
      <main class="main-content" ref="mainContentRef">
        <!-- 子路由: 正常 router-view (PlayerPage, PlanBuilder, WorkoutExecutor 等) -->
        <router-view v-if="isSubRoute" v-slot="{ Component }">
          <Transition :css="false" mode="out-in" @enter="pageTransition.onEnter" @leave="pageTransition.onLeave">
            <component :is="Component" />
          </Transition>
        </router-view>
        <!-- 主路由: 横向单页 — 同一时刻仅挂载活动面板 -->
        <div class="horizontal-stage" v-else>
          <Transition :css="false" mode="out-in"
            @enter="onStageEnter"
            @leave="onStageLeave">
            <component :is="currentPanel" :key="activeSection" />
          </Transition>
        </div>
      </main>
    </div>

    <!-- 全局 3D 歌词层：与可视化器 canvas 一起 reparent 到各页面 stage 中，
         在 preserve-3d 空间中位于 canvas (背景) 和卡片之间 -->
    <GlobalLyricLayer v-if="!isDesktopLyric" />

<PlayerBar v-if="!isDesktopLyric && musicStore.currentTrack" />

    <!-- 首次使用引导 -->
    <OnboardingOverlay v-if="!isDesktopLyric && showOnboarding" @close="closeOnboarding" />

    <!-- VIP 提醒弹窗 -->
    <VipReminderDialog v-if="!isDesktopLyric" />

    <!-- 全局 Toast / Confirm -->
    <GlobalToast v-if="!isDesktopLyric" />

    <!-- 自动更新通知 -->
    <UpdateNotifier v-if="!isDesktopLyric" />

    <!-- 品牌启动动画 -->
    <SplashOverlay v-if="showSplash && !isDesktopLyric" @done="showSplash = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import gsap from 'gsap'
import TitleBar from './components/TitleBar.vue'
import PlayerBar from './components/PlayerBar.vue'
import GlobalBackground from './components/GlobalBackground.vue'
import FrostedGlass from './components/FrostedGlass.vue'
import UserCapsule from './components/UserCapsule.vue'
import OnboardingOverlay from './components/OnboardingOverlay.vue'
import VipReminderDialog from './components/VipReminderDialog.vue'
import GlobalToast from './components/GlobalToast.vue'
import HomePage from './pages/HomePage.vue'
import MusicPage from './pages/MusicPage.vue'
import FitnessPage from './pages/FitnessPage.vue'
import DataPage from './pages/DataPage.vue'
import ControlPanel from './components/ControlPanel.vue'
import { useMusicStore } from './stores/music'
import { useFitnessStore } from './stores/fitness'
import { usePerformanceMonitor, measureStartup } from './composables/usePerformanceMonitor'
import { usePageTransition, useBackdropTransition } from './composables/useGsapTransition'
import { useGlobalVisualizer } from './composables/useGlobalVisualizer'
import GlobalLyricLayer from './components/GlobalLyricLayer.vue'
import SplashOverlay from './components/SplashOverlay.vue'
import UpdateNotifier from './components/UpdateNotifier.vue'
import { useSfx } from './composables/useSfx'

const musicStore = useMusicStore()
const fitnessStore = useFitnessStore()
const route = useRoute()
const router = useRouter()
const sfx = useSfx()

// ── 品牌启动动画 ──
const showSplash = ref(true)

const glassAmbientColor = computed(() => musicStore.currentCoverPalette?.primary || '#FFFFFF')

// ── 全局 3D 歌词层 ──
const { setLyricLayerElement } = useGlobalVisualizer()

onMounted(() => {
  // Query the DOM for the lyric layer element (rendered by GlobalLyricLayer component)
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('[data-lyric-layer]')
    if (el) setLyricLayerElement(el)
  })
})

onUnmounted(() => {
  setLyricLayerElement(null)
})

// ═══════════════════════════════════════════════════════════════
// 横向单页导航系统
// ═══════════════════════════════════════════════════════════════
// 同一时刻仅挂载活动面板 (v-if / component :is), 离屏面板被卸载,
// 触发 onUnmounted → cancelAnimationFrame / Three.js dispose / GIF 清空。
// 切页 = GSAP spring 平移 (~420ms), 全局背景 10% 反向视差。

const ROUTE_TO_SECTION: Record<string, string> = {
  '/': 'home',
  '/music': 'music',
  '/fitness': 'fitness',
  '/data': 'data',
}
const SECTION_TO_ROUTE: Record<string, string> = Object.fromEntries(
  Object.entries(ROUTE_TO_SECTION).map(([k, v]) => [v, k])
)

const PANEL_ORDER = ['home', 'music', 'fitness', 'data'] as const
const PANEL_COMPONENTS: Record<string, any> = {
  home: HomePage,
  music: MusicPage,
  fitness: FitnessPage,
  data: DataPage,
}

const activeSection = ref('home')

const currentPanel = computed(() => PANEL_COMPONENTS[activeSection.value] ?? HomePage)

const isSubRoute = computed(() =>
  route.path.startsWith('/plan') || route.path.startsWith('/workout') || route.path === '/player' || route.path === '/desktop-lyric' || route.path === '/desktop-lyric-settings'
)

const isDesktopLyric = computed(() => route.path === '/desktop-lyric' || route.path === '/desktop-lyric-settings')

// ── 导航 ──
function navigateTo(to: string) {
  closeMenu()
  sfx.detent()
  if (isSubRoute.value) {
    router.push(to)
  } else {
    const section = ROUTE_TO_SECTION[to]
    if (section) {
      activeSection.value = section
      if (route.path !== to) {
        router.replace(to)
      }
    }
  }
}

// ── 键盘 ← → 翻页 ──
function onKeyNav(e: KeyboardEvent) {
  if (isSubRoute.value) return
  // 不在 input/textarea 中时才响应
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

  const idx = PANEL_ORDER.indexOf(activeSection.value as typeof PANEL_ORDER[number])
  if (e.key === 'ArrowLeft' && idx > 0) {
    e.preventDefault()
    navigateTo(SECTION_TO_ROUTE[PANEL_ORDER[idx - 1]])
  } else if (e.key === 'ArrowRight' && idx < PANEL_ORDER.length - 1) {
    e.preventDefault()
    navigateTo(SECTION_TO_ROUTE[PANEL_ORDER[idx + 1]])
  }
}

// ── 滚轮翻页 (节流: 一次一格吸附) ──
// 仅当主内容区域不可滚动或已滚动到边界时才触发翻页。
// 这确保 DataPage 等有内容的页面能正常滚动到底部，
// 而不会被滚轮翻页拦截。
let wheelLock = false
function onWheelNav(e: WheelEvent) {
  if (isSubRoute.value) return

  const target = e.target as HTMLElement

  // ── 设置面板滚动隔离 ──
  // ControlPanel is teleported to <body>, so wheel events from it bubble to
  // window. If the event originates from the sidebar or backdrop, let it
  // scroll naturally and never trigger page navigation.
  if (target?.closest('.cp-sidebar') || target?.closest('.cp-backdrop-el')) {
    return
  }

  // ── 首页: 完全 3D 模式, 禁用滚轮翻页 ──
  // 首页始终激活 3D 交互 (拖拽旋转 + 滚轮缩放),
  // 页面切换仅通过 FAB 导航按钮进行。
  if (activeSection.value === 'home') {
    return
  }

  // ── 音乐库 / 动作库: 完全 3D 模式, 禁用滚轮翻页 ──
  // 这两个页面进入即激活 3D 交互 (拖拽旋转 + 滚轮缩放),
  // 页面切换仅通过 FAB 导航按钮进行。
  // 注意: FitnessPage 的 spiral-stage 被 Teleport 到 .app-shell,
  // 不在 [data-fitness-page] 内部, 所以需要额外检查 activeSection。
  if (activeSection.value === 'music' || activeSection.value === 'fitness') {
    return
  }

  // ── DataPage: 禁用滚轮翻页 ──
  // 数据页不再通过滚轮切换到其他页面, 仅通过 FAB 导航按钮进行。
  // 页面内部的滚动和 3D 交互不受影响。
  if (activeSection.value === 'data') {
    return
  }

  // ── DataPage 3D 交互态滚动隔离 ──
  // DataPage 仍使用 idle/engaged 双态模型。
  // engaged 时 wheel 由 visualizer 处理缩放, 不触发页面导航。
  if (target?.closest('.data-page.stage-engaged')) {
    return
  }

  // 检查事件是否来自 .main-content 内部
  const mainEl = document.querySelector('.main-content')
  if (mainEl) {
    if (mainEl.contains(target)) {
      // 内容区域可滚动时，不拦截滚轮
      const canScrollDown = mainEl.scrollHeight - mainEl.scrollTop - mainEl.clientHeight > 2
      const canScrollUp = mainEl.scrollTop > 2
      if (e.deltaY > 0 && canScrollDown) return // 还能往下滚
      if (e.deltaY < 0 && canScrollUp) return   // 还能往上滚
      // 到达边界时不立即翻页 — 等待连续滚动越过阈值
      // (避免用户只是滚到底部就意外翻页)
    }
  }

  if (wheelLock) return
  const delta = e.deltaY
  if (Math.abs(delta) < 30) return

  wheelLock = true
  const idx = PANEL_ORDER.indexOf(activeSection.value as typeof PANEL_ORDER[number])
  if (delta > 0 && idx < PANEL_ORDER.length - 1) {
    navigateTo(SECTION_TO_ROUTE[PANEL_ORDER[idx + 1]])
  } else if (delta < 0 && idx > 0) {
    navigateTo(SECTION_TO_ROUTE[PANEL_ORDER[idx - 1]])
  }
  setTimeout(() => { wheelLock = false }, 600)
}

// ── 舞台进入/离开动画 ──
// 纯 opacity 淡入淡出, 不使用 transform (scale/translate 会创建 containing block,
// 破坏内部 3D perspective 和 position:fixed 子元素)
function onStageEnter(el: Element, done: () => void) {
  gsap.fromTo(el,
    { opacity: 0 },
    {
      opacity: 1,
      duration: 0.3,
      ease: 'power2.out',
      onComplete: done,
    }
  )
}

function onStageLeave(el: Element, done: () => void) {
  gsap.to(el,
    {
      opacity: 0,
      duration: 0.2,
      ease: 'power2.in',
      onComplete: done,
    }
  )
}

// Track previous section
let prevSection = 'home'
watch(activeSection, (newVal, oldVal) => {
  ;(document as any).__prevSection = prevSection
  prevSection = newVal

  // ── 全局背景 10% 反向视差 ──
  const newIdx = PANEL_ORDER.indexOf(newVal as typeof PANEL_ORDER[number])
  const oldIdx = PANEL_ORDER.indexOf(oldVal as typeof PANEL_ORDER[number])
  if (newIdx < 0 || oldIdx < 0) return
  const direction = newIdx > oldIdx ? 1 : -1
  const bg = document.querySelector<HTMLElement>('[data-global-background]')
  if (bg) {
    gsap.to(bg, {
      x: -direction * 6,
      duration: 0.4,
      ease: 'power2.out',
    })
  }
})

// ── Fitness 页面: 启用完全 3D 模式 ──
// spiral-stage (teleported, z-index:2) 在 app-layout (z-index:10) 下方。
// 需要禁用 app-layout 链的 pointer-events, 让事件穿透到 spiral-stage。
// UI 元素 (.ui-layer > *) 显式设置 pointer-events:auto, 不受影响。
// 子路由 (PlanBuilder 等) 不应激活 full-3d-mode, 否则页面无法点击。
watch([activeSection, isSubRoute], ([section, sub]) => {
document.body.classList.toggle('full-3d-mode', section === 'fitness' && !sub)
}, { flush: 'pre' })

// ── 路由 → activeSection 同步 ──
watch(() => route.path, (newPath) => {
  if (!isSubRoute.value) {
    const section = ROUTE_TO_SECTION[newPath]
    if (section && section !== activeSection.value) {
      activeSection.value = section
    }
  }
})

// ═══════════════════════════════════════════════════════════════
// FAB 菜单 + 悬浮元素智能显隐
// ═══════════════════════════════════════════════════════════════

const isMenuOpen = ref(false)
const showOnboarding = ref(false)
const isControlPanelOpen = ref(false)

const mainContentRef = ref<HTMLElement | null>(null)

const FLOATING_HOT_ZONE_BOTTOM = 120 // px from bottom — mouse proximity zone
const FLOATING_HOT_ZONE_TOP = 80 // px from top — mouse proximity zone
let topIdleTimer: ReturnType<typeof setTimeout> | null = null
let bottomIdleTimer: ReturnType<typeof setTimeout> | null = null
const isTopHovered = ref(false)
const isBottomHovered = ref(false)

// ── Top floating elements (user capsule + DIY button) ──
function showTopFloating() {
  document.body.classList.remove('hide-top-floating')
  resetTopIdleTimer()
}

function hideTopFloating() {
  if (isTopHovered.value) return
  document.body.classList.add('hide-top-floating')
  if (topIdleTimer) { clearTimeout(topIdleTimer); topIdleTimer = null }
}

function resetTopIdleTimer() {
  if (topIdleTimer) clearTimeout(topIdleTimer)
  if (isTopHovered.value) return
  topIdleTimer = setTimeout(() => {
    hideTopFloating()
  }, 2000)
}

// ── Bottom floating elements (FAB + page dots) ──
// FAB defaults to visible. Only hidden in immersive (fullscreen) mode.
function showBottomFloating() {
  document.body.classList.remove('hide-bottom-floating')
}

function hideBottomFloating() {
  if (isBottomHovered.value || isMenuOpen.value) return
  document.body.classList.add('hide-bottom-floating')
}

// No auto-hide timer — FAB stays visible by default.
// Only immersive mode hides it (handled via body.immersive-mode CSS).
function resetBottomIdleTimer() {
  // No-op: FAB no longer auto-hides on idle.
}

function onFloatingMouseMove(e: MouseEvent) {
  const vh = window.innerHeight
  // Mouse near bottom → show bottom elements only
  if (e.clientY > vh - FLOATING_HOT_ZONE_BOTTOM) {
    showBottomFloating()
  }
  // Mouse near top → show top elements only
  if (e.clientY < FLOATING_HOT_ZONE_TOP) {
    showTopFloating()
  }
}

function onFloatingEnter() {
  isBottomHovered.value = true
  if (bottomIdleTimer) { clearTimeout(bottomIdleTimer); bottomIdleTimer = null }
  document.body.classList.remove('hide-bottom-floating')
}

function onFloatingLeave() {
  isBottomHovered.value = false
  resetBottomIdleTimer()
}

function onTopFloatingEnter() {
  isTopHovered.value = true
  if (topIdleTimer) { clearTimeout(topIdleTimer); topIdleTimer = null }
  document.body.classList.remove('hide-top-floating')
}

function onTopFloatingLeave() {
  isTopHovered.value = false
  resetTopIdleTimer()
}

// DOM 查询辅助 (带缓存, 避免重复 querySelector)
let _container: HTMLElement | null = null
let _items: HTMLElement[] = []
let _lines: HTMLElement[] = []

function invalidateFabCache() {
  _container = null
  _items = []
  _lines = []
}

function getFabItemsContainer(): HTMLElement | null {
  if (!_container?.isConnected) {
    _container = document.querySelector('[data-fab-items]')
  }
  return _container
}
function getFabItems(): HTMLElement[] {
  if (_items.length === 0) {
    const c = getFabItemsContainer()
    _items = c ? Array.from(c.querySelectorAll('.fab-item')) as HTMLElement[] : []
  }
  return _items
}
function getFabLines(): HTMLElement[] {
  if (_lines.length === 0) {
    _lines = (['top', 'mid', 'bot'] as const)
      .map(n => document.querySelector<HTMLElement>(`[data-fab-line="${n}"]`))
      .filter((el): el is HTMLElement => !!el)
  }
  return _lines
}

// 弧形布局参数
const ARC_VERTICAL_SPACING = 52
const ARC_HORIZONTAL_OFFSET = 7
const ARC_BASE_OFFSET = 15
const ARC_ITEM_ROTATION = 0

const ARC_ITEM_ROTATION_OFFSETS = [0, 5, 10, 15, 20, 25]
const ARC_ITEM_X_OFFSETS = [0, 0, 0, 4, 8, 20]

// ===== Window state: maximised =====
;(window as any).__fullscreenTransition = false

const pageTransition = usePageTransition()
const backdropTransition = useBackdropTransition()

function onMaximizeChange(isMaximized: boolean) {
  if ((window as any).__fullscreenTransition) return
  if (isMaximized) {
    document.body.classList.add('is-maximized')
  } else {
    document.body.classList.remove('is-maximized')
  }
}

onMounted(async () => {
measureStartup()
usePerformanceMonitor()

  // Background auto-sync exercises if previous sync was incomplete
  fitnessStore.autoSyncExercises()

  // 初始化 FAB 子菜单项的 GSAP 初始状态 (全部隐藏在 FAB 位置)
  invalidateFabCache()
  const items = getFabItems()
  gsap.set(items, { x: 0, y: 10, autoAlpha: 0, scale: 0.5 })

  // 初始 section 同步
  if (!isSubRoute.value) {
    const section = ROUTE_TO_SECTION[route.path]
    if (section) {
      activeSection.value = section
    }
// Ensure full-3d-mode is set on initial load if starting on fitness page
// (and not on a sub-route)
document.body.classList.toggle('full-3d-mode', activeSection.value === 'fitness' && !isSubRoute.value)
  }

  // 悬浮元素: 启动 2s 自动隐藏计时器 + 鼠标靠近监听
  window.addEventListener('mousemove', onFloatingMouseMove)
  // 键盘 ← → 翻页
  window.addEventListener('keydown', onKeyNav)
  // 滚轮翻页
  window.addEventListener('wheel', onWheelNav, { passive: true })
  resetBottomIdleTimer()
  resetTopIdleTimer()

  // 检查是否需要展示 onboarding
  try {
    if (window.electronAPI?.settings) {
      const result = await window.electronAPI.settings.get('onboarding_completed')
      if (!result.data?.value) {
        showOnboarding.value = true
      }
    }
  } catch (e) {
    console.warn('[App] Failed to check onboarding status:', e)
  }

  try {
    if (window.electronAPI) {
      const result = await window.electronAPI.window.isMaximized()
      if (result.isMaximized) {
        document.body.classList.add('is-maximized')
      }
      window.electronAPI.on?.('window:maximizeChange', onMaximizeChange)
    }
  } catch (e) {
    console.warn('[App] Failed to init window state:', e)
  }
})

function closeOnboarding() {
  showOnboarding.value = false
}

onUnmounted(() => {
  window.electronAPI?.removeListener?.('window:maximizeChange', onMaximizeChange)
  document.body.classList.remove('is-maximized')
  document.body.classList.remove('hide-top-floating')
  document.body.classList.remove('hide-bottom-floating')
  document.body.classList.remove('full-3d-mode')
  window.removeEventListener('mousemove', onFloatingMouseMove)
  window.removeEventListener('keydown', onKeyNav)
  window.removeEventListener('wheel', onWheelNav)
  if (topIdleTimer) clearTimeout(topIdleTimer)
  if (bottomIdleTimer) clearTimeout(bottomIdleTimer)
})

interface NavItem {
  to: string
  label: string
  icon: string
}

const ICONS = {
  home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/></svg>',
  music: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  player: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/></svg>',
  fitness: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11"/><path d="M3 9v6"/><path d="M21 9v6"/><path d="M6 7v10"/><path d="M18 7v10"/><path d="M6 12h12"/></svg>',
  data: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg>',
  settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
}

const navItems: NavItem[] = [
{ to: '/', label: '首页', icon: ICONS.home },
{ to: '/music', label: '音乐库', icon: ICONS.music },
{ to: '/fitness', label: '动作库', icon: ICONS.fitness },
{ to: '/data', label: '数据', icon: ICONS.data },
]

const isRouteActive = (to: string): boolean => {
  if (isSubRoute.value) return false
  const section = ROUTE_TO_SECTION[to]
  return section === activeSection.value
}

// ── 菜单展开 / 收起 ──

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
  if (isMenuOpen.value) sfx.airBloom()
  else sfx.retract()
}

function closeMenu() {
  isMenuOpen.value = false
}

// 路由变化时自动收起
watch(() => route.path, () => {
  if (isMenuOpen.value) closeMenu()
})

// ── GSAP 弧形展开 / 收起动画 (Timeline 统一管理) ──

let menuTl: gsap.core.Timeline | null = null

watch(isMenuOpen, (open) => {
  if (menuTl) { menuTl.kill(); menuTl = null }
  const items = getFabItems()
  const container = getFabItemsContainer()
  const lines = getFabLines()
  gsap.killTweensOf([...items, ...lines])
  if (container) gsap.killTweensOf(container)

  if (items.length === 0) return

  menuTl = gsap.timeline()

  if (open) {
    if (container) menuTl.set(container, { visibility: 'visible' })

    items.forEach((el, i) => {
      const targetX = i * ARC_HORIZONTAL_OFFSET + (ARC_ITEM_X_OFFSETS[i] ?? 0)
      const targetY = -(ARC_BASE_OFFSET + i * ARC_VERTICAL_SPACING)
      const itemRotation = ARC_ITEM_ROTATION + (ARC_ITEM_ROTATION_OFFSETS[i] ?? 0)

    menuTl!.fromTo(el,
      { x: 0, y: 8, autoAlpha: 0, scale: 0.5, rotation: 0 },
      { x: targetX, y: targetY, autoAlpha: 1, scale: 1,
        rotation: itemRotation,
        duration: 0.35, ease: 'back.out(1.2)' },
      i * 0.03
    )
    })

    animateFabIcon(true)
  } else {
    const total = items.length
    items.forEach((el, i) => {
      const pos = (total - 1 - i) * 0.035
      menuTl!.to(el,
        { x: 0, y: 8, autoAlpha: 0, scale: 0.5, rotation: 0,
          duration: 0.22, ease: 'power2.in' },
        pos
      )
    })

    if (container) {
      menuTl!.to(container, { visibility: 'hidden' }, 0.35)
    }

    animateFabIcon(false)
  }

  if (!open && !isBottomHovered.value) {
    resetBottomIdleTimer()
  }
})

// ── 主按钮图标变形 (汉堡 ↔ X) ──

function animateFabIcon(toX: boolean) {
  const lines = getFabLines()
  if (lines.length < 3) return
  const [top, mid, bot] = lines

  if (toX) {
    gsap.to(top, { rotation: 45, y: 7, duration: 0.3, ease: 'power2.out' })
    gsap.to(mid, { autoAlpha: 0, scaleX: 0, duration: 0.2, ease: 'power2.out' })
    gsap.to(bot, { rotation: -45, y: -7, duration: 0.3, ease: 'power2.out' })
  } else {
    gsap.to(top, { rotation: 0, y: 0, duration: 0.3, ease: 'power2.out' })
    gsap.to(mid, { autoAlpha: 1, scaleX: 1, duration: 0.2, ease: 'power2.out' })
    gsap.to(bot, { rotation: 0, y: 0, duration: 0.3, ease: 'power2.out' })
  }
}

// 组件卸载时清理 GSAP
onUnmounted(() => {
  if (menuTl) menuTl.kill()
  const items = getFabItems()
  const lines = getFabLines()
  gsap.killTweensOf([...items, ...lines])
  const container = getFabItemsContainer()
  if (container) gsap.killTweensOf(container)
})
</script>

<style lang="scss" scoped>
.app-shell {
height: 100vh;
display: flex;
flex-direction: column;
// 为 GlobalLyricLayer 提供 perspective (PlayerPage 等无 stage 的页面)
// stage 内的页面有自己的 perspective, 会覆盖此值
perspective: 1200px;
// Transparent — AuroraBackground canvas (opaque, fixed) covers this entirely.
// #app provides the CSS gradient fallback during startup.
  background: transparent;
  border-radius: 16px;
  overflow: hidden;
  clip-path: inset(0 round 16px);
}

// Desktop lyric window — no border-radius, no clip, fully transparent
.app-shell.desktop-lyric-mode {
  border-radius: 0;
  clip-path: none;
  overflow: visible;
  background: transparent !important;

  .app-layout { padding: 0; gap: 0; }
  .main-content { overflow: hidden; }
}

.app-layout {
  flex: 1;
  display: flex;
  overflow: hidden;
  padding: 0; /* No padding — aurora + 3D canvas fill the entire window.
                Pages that need internal spacing add their own padding
                (e.g. DataPage has padding: var(--space-xl)). */
  gap: 0;
  position: relative;
  z-index: 10;
}

// ── Full 3D mode (Fitness page) ──
// Disable pointer-events on the app-layout chain so events pass through
// to the teleported spiral-stage (z-index:2) below.
// UI elements inside .fitness-page with explicit pointer-events:auto
// (e.g. .ui-layer > *) still receive events normally.
body.full-3d-mode .app-layout,
body.full-3d-mode .main-content,
body.full-3d-mode .horizontal-stage {
  pointer-events: none;
}

// == Floating elements smart visibility (top/bottom independent) ==
body.hide-top-floating {
  .top-right-zone {
    opacity: 0;
    transform: translateY(-12px);
    pointer-events: none;
  }
}
body.hide-bottom-floating,
body.immersive-mode {
  .fab-menu-zone {
    opacity: 0;
    transform: translateY(24px);
    pointer-events: none;
  }
}

// == Top-right zone (user capsule + DIY button) ==
.top-right-zone {
  position: fixed;
  top: 8px;
  right: 128px; /* 120px for window controls (3×40px) + 8px gap */
  z-index: calc(var(--z-sticky) + 2);
  pointer-events: auto;
  -webkit-app-region: no-drag; /* Prevent titlebar drag from intercepting clicks */
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 400ms var(--ease-standard),
              transform 400ms var(--ease-standard);
}

// == DIY Trigger Button ==
.diy-trigger-btn {
  position: relative;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: color 200ms var(--ease-standard);

  & > svg {
    position: relative;
    z-index: 1;
  }

  &:hover {
    color: #fff;
  }

  &.is-open {
    color: #fff;
  }
}

body.immersive-mode {
  .top-right-zone {
    opacity: 0;
    transform: translateY(-10px);
    pointer-events: none;
  }
  &.immersive-visible {
    .top-right-zone {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
  }
}

// == FAB Menu Zone ==
.fab-menu-zone {
  --fab-x-shift: 35px;
  position: fixed;
  right: 54px;
  bottom: calc(var(--player-bar-height, 0px) + 36px);
  z-index: calc(var(--z-sticky) + 1);
  pointer-events: auto;
  transition: opacity 250ms var(--ease-out-quint),
              transform 250ms var(--ease-out-quint);
}

body.immersive-mode {
  .fab-menu-zone {
    opacity: 0;
    transform: translateY(20px);
    pointer-events: none;
  }
  &.immersive-visible {
    .fab-menu-zone {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
  }
}

// == 弧形子菜单容器 ==
.fab-items {
  position: absolute;
  right: 0;
  bottom: 56px;
  width: 0;
  height: 0;
  visibility: hidden;
  pointer-events: none;
}

// == 单个子菜单项 (图标 + 标签) ==
.fab-item {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  opacity: 0;
  visibility: hidden;
  pointer-events: auto;
}

// == 胶囊形文字标签 ==
.fab-item-label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--text-primary);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(15, 15, 20, 0.72);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  transition: background 200ms var(--ease-standard);

  &.is-active {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.25);
  }
}

// == 圆形图标按钮 ==
.fab-item-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  flex-shrink: 0;
  appearance: none;
  -webkit-appearance: none;
  padding: 0;
  font: inherit;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, transparent 35%),
    linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.10) 100%),
    rgba(20, 20, 28, 0.45);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: 1px solid rgba(255, 255, 255, 0.10);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.15),
    inset 0 -1px 2px rgba(0, 0, 0, 0.10),
    0 2px 12px rgba(0, 0, 0, 0.25);
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition: color 200ms var(--ease-standard),
              background 200ms var(--ease-standard),
              border-color 200ms var(--ease-standard),
              box-shadow 200ms var(--ease-standard),
              transform 150ms var(--ease-standard);

  &:hover {
    color: var(--text-primary);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, transparent 35%),
      linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.12) 100%),
      rgba(35, 35, 45, 0.5);
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow:
      inset 0 1px 2px rgba(255, 255, 255, 0.22),
      inset 0 -1px 2px rgba(0, 0, 0, 0.12),
      0 4px 16px rgba(0, 0, 0, 0.35);
    transform: scale(1.08);
  }

  &:active {
    transform: scale(0.94);
  }

  &.is-active {
    color: var(--text-primary);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.20) 0%, transparent 35%),
      linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.08) 100%),
      rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.22);
  }
}

.fab-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

// == 主 FAB 按钮 (液态玻璃) ==
.fab-main {
  position: relative;
  left: var(--fab-x-shift, 45px);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  background: transparent;
  border: none;
  color: var(--accent-mist);
  cursor: pointer;
  transition: color 200ms var(--ease-out-quint),
              transform 200ms var(--ease-spring),
              box-shadow 200ms var(--ease-out-quint);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);

  &:hover,
  &.is-active {
    color: #ffffff;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  }

  &:active {
    transform: scale(0.96);
  }

  // Override FrostedGlass interactive variant — remove blur, use pure
  // transparency + layered gradients for a crystal-clear 3D glass look.
  // No backdrop-filter means no two-stage render flash and true see-through.
  :deep(.frosted-glass) {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    will-change: auto;

    background:
      // Top highlight — simulates light hitting the upper curvature
      linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, transparent 35%),
      // Diagonal sheen — gives a 3D spherical illusion
      linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.06) 100%),
      // Bottom shadow — grounds the sphere
      linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.10) 100%),
      // Base — very transparent
      rgba(255, 255, 255, 0.04);

    box-shadow:
      // Inset highlights — the key to 3D depth on a circle
      inset 0 2px 2px rgba(255, 255, 255, 0.25),
      inset 0 -2px 3px rgba(0, 0, 0, 0.15),
      inset 0 0 0 1px rgba(255, 255, 255, 0.12),
      // Outer shadow — lifts the button off the background
      0 6px 20px rgba(0, 0, 0, 0.25);
  }

  &:hover,
  &.is-active {
    :deep(.frosted-glass) {
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.25) 0%, transparent 35%),
        linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 100%),
        linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.12) 100%),
        rgba(255, 255, 255, 0.08);

      box-shadow:
        inset 0 2px 3px rgba(255, 255, 255, 0.35),
        inset 0 -2px 4px rgba(0, 0, 0, 0.18),
        inset 0 0 0 1px rgba(255, 255, 255, 0.18),
        0 8px 28px rgba(0, 0, 0, 0.35);
    }
  }
}
.fab-icon {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.fab-line {
  width: 22px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  flex-shrink: 0;
  transform-origin: center;
}

// == Backdrop ==
.fab-backdrop {
  position: fixed;
  inset: 0;
  z-index: 19;
  background: rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

// == Main content ==
.main-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  // Hide scrollbar to prevent 17px gap on Windows where scrollbars are
  // not overlay. Pages still scroll normally. DataPage manages its own
  // scroll; 3D stages fill the full width without a scrollbar gap.
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
  &::-webkit-scrollbar { display: none; } /* WebKit */
  // No padding-bottom: the PlayerBar is position:fixed and floats over the
  // content. Adding padding here would create a dead zone where 3D effects
  // (canvas, perspective stages) cannot reach, causing a visible split line.
  // DataPage (scrollable content) handles its own bottom padding.
  overscroll-behavior: contain;
}

// == Horizontal Stage (单页挂载) ==
// 同一时刻仅活动面板挂载, 离屏面板卸载触发 onUnmounted 资源释放
// height: 100% (非 min-height) 确保子页面 height:100% 能正确解析 —
// CSS 规范中, min-height 不构成 "definite height", 会导致子元素
// height:100% 回退为 auto → 0 (因页面内容为 position:absolute)。
// 不设 overflow:hidden 让 .main-content 管理滚动。
.horizontal-stage {
  width: 100%;
  height: 100%;
  position: relative;
}

// == 极简点阵分页指示器 ==
// 居中固定在底部 PlayerBar 上方, 5个圆点表示5个主页面
.page-dots {
  position: fixed;
  bottom: calc(var(--player-bar-height, 0px) + 32px);
  left: 50%;
  transform: translateX(-50%);
  z-index: calc(var(--z-sticky) + 1);
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
}

.page-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: none;
  padding: 0;
  background: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: all 300ms var(--ease-standard);

  &:hover {
    background: rgba(255, 255, 255, 0.4);
  }

  &.is-active {
    width: 18px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.6);
  }
}

body.hide-bottom-floating .page-dots {
opacity: 0;
transform: translateX(-50%) translateY(12px);
transition: opacity 400ms var(--ease-standard),
transform 400ms var(--ease-standard);
/* pointer-events: auto — page-dots remain clickable even when faded out */
}

</style>
