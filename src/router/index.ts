import { createRouter, createWebHashHistory } from 'vue-router'
import { defineComponent, h } from 'vue'
import { logRouteTiming } from '@/composables/usePerformanceMonitor'

/**
 * 空路由组件 — 主页面（首页/音乐库/动作库/数据/设置）
 * 由 App.vue 中的沉浸式滚动布局统一渲染，路由仅用于 URL 同步。
 * 播放页 (/player) 是独立页面，通过 router-view 正常渲染。
 */
const EmptyRoute = defineComponent({
  name: 'EmptyRoute',
  render() { return h('div', { style: 'display:none' }) }
})

const routes = [
  {
    path: '/',
    name: 'Home',
    component: EmptyRoute
  },
  {
    path: '/music',
    name: 'Music',
    component: EmptyRoute
  },
  {
    path: '/player',
    name: 'Player',
    component: () => import('../pages/PlayerPage.vue')
  },
  {
    path: '/desktop-lyric',
    name: 'DesktopLyric',
    component: () => import('../pages/DesktopLyricPage.vue')
  },
  {
    path: '/desktop-lyric-settings',
    name: 'DesktopLyricSettings',
    component: () => import('../pages/DesktopLyricSettingsPage.vue')
  },
  {
    path: '/fitness',
    name: 'Fitness',
    component: EmptyRoute
  },
  {
    path: '/plan/build',
    name: 'PlanBuilder',
    component: () => import('../pages/PlanBuilder.vue')
  },
  {
    path: '/workout/:planId',
    name: 'WorkoutExecutor',
    component: () => import('../pages/WorkoutExecutorPage.vue')
  },
  {
    path: '/data',
    name: 'Data',
    component: EmptyRoute
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

let routeStartTime = 0
let routeFromPath = ''

router.beforeEach((to, from) => {
  routeStartTime = performance.now()
  routeFromPath = from.path
  performance.mark(`route-start:${to.path}`)
})

router.afterEach((to) => {
  const duration = performance.now() - routeStartTime
  logRouteTiming(routeFromPath, to.path, duration)
})

export default router
