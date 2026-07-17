<template>
  <div class="user-capsule-wrapper" ref="rootEl">
    <!-- 双平台均未登录 -->
    <button
      v-if="!nLoggedIn && !qLoggedIn"
      class="user-capsule user-capsule--logged-out"
      @click="toggleExpand"
      type="button"
    >
      <FrostedGlass :corner-radius="999" variant="interactive" />
      <span class="capsule-content">
        <span class="capsule-icon">&#9835;</span>
        <span class="capsule-text">连接音乐账号</span>
      </span>
    </button>

    <!-- 已登录（单平台或双平台） -->
    <button
      v-else
      class="user-capsule user-capsule--logged-in"
      :class="{ 'user-capsule--expanded': isExpanded }"
      @click="toggleExpand"
      type="button"
    >
      <FrostedGlass :corner-radius="999" variant="interactive" />
      <span class="capsule-content">
        <!-- 单平台：真实头像 + 平台角标 + 昵称 -->
        <template v-if="nLoggedIn !== qLoggedIn">
          <span class="avatar-wrap" :class="singleIsNetease ? 'is-netease' : 'is-qq'">
            <img
              v-if="singleUser?.avatarUrl && !singleAvatarError"
              :src="fixedUrl(singleUser.avatarUrl)"
              alt="avatar"
              referrerpolicy="no-referrer"
            />
            <span v-else class="avatar-fallback">&#9835;</span>
            <span class="platform-badge" :class="singleIsNetease ? 'netease' : 'qq'"></span>
          </span>
          <span class="capsule-name">{{ singleUser?.nickname || '音乐用户' }}</span>
        </template>

        <!-- 双平台：两个真实头像重叠 + 各自平台角标 -->
        <template v-else>
          <span class="dual-avatars">
            <span class="avatar-wrap is-netease">
              <img
                v-if="nUser?.avatarUrl && !nAvatarError"
                :src="fixedUrl(nUser.avatarUrl)"
                alt="netease"
                referrerpolicy="no-referrer"
              />
              <span v-else class="avatar-fallback">&#9835;</span>
              <span class="platform-badge netease" :class="{ offline: !nLoggedIn }"></span>
            </span>
            <span class="avatar-wrap is-qq">
              <img
                v-if="qUser?.avatarUrl && !qAvatarError"
                :src="fixedUrl(qUser.avatarUrl)"
                alt="qq"
                referrerpolicy="no-referrer"
              />
              <span v-else class="avatar-fallback">&#9835;</span>
              <span class="platform-badge qq" :class="{ offline: !qLoggedIn }"></span>
            </span>
          </span>
        </template>

        <svg class="capsule-chevron" width="12" height="12" viewBox="0 0 12 12">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.3"
            fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </button>

    <!-- 展开面板：双平台账号管理 -->
    <Transition :css="false" @enter="dropdownTransition.onEnter" @leave="dropdownTransition.onLeave">
      <div v-if="isExpanded" class="capsule-panel">
        <FrostedGlass :corner-radius="16" variant="floating" />
        <div class="capsule-panel-content">
          <div class="panel-title">音乐账号</div>

          <!-- 网易云行 -->
          <div class="panel-account" :class="{ 'is-default': defaultSource === 'netease', 'is-offline': !nLoggedIn }">
            <span class="avatar-wrap is-netease panel-avatar">
              <img
                v-if="nLoggedIn && nUser?.avatarUrl && !nAvatarError"
                :src="fixedUrl(nUser.avatarUrl)"
                alt="netease"
                referrerpolicy="no-referrer"
              />
              <span v-else class="avatar-fallback">&#9835;</span>
              <span class="platform-badge netease" :class="{ offline: !nLoggedIn }"></span>
            </span>
            <span class="account-info">
              <span class="account-name">
                {{ nLoggedIn ? (nUser?.nickname || '网易云用户') : '网易云音乐' }}
                <span v-if="nLoggedIn && defaultSource === 'netease'" class="star">&#9733;</span>
              </span>
              <span class="account-status">
                {{ nLoggedIn ? '网易云 · 已连接' : '网易云 · 未连接' }}
              </span>
            </span>
            <span class="account-actions">
              <template v-if="nLoggedIn">
                <button class="mini-btn" @click="goToMusic('netease')">歌单</button>
                <button class="mini-btn danger" @click="handleNeteaseLogout">退出</button>
              </template>
              <button v-else class="mini-btn mini-btn--login netease" @click="handleNeteaseLogin">登录</button>
            </span>
          </div>

          <!-- QQ 音乐行 -->
          <div class="panel-account" :class="{ 'is-default': defaultSource === 'qq', 'is-offline': !qLoggedIn }">
            <span class="avatar-wrap is-qq panel-avatar">
              <img
                v-if="qLoggedIn && qUser?.avatarUrl && !qAvatarError"
                :src="fixedUrl(qUser.avatarUrl)"
                alt="qq"
                referrerpolicy="no-referrer"
              />
              <span v-else class="avatar-fallback">&#9835;</span>
              <span class="platform-badge qq" :class="{ offline: !qLoggedIn }"></span>
            </span>
            <span class="account-info">
              <span class="account-name">
                {{ qLoggedIn ? (qUser?.nickname || 'QQ 用户') : 'QQ 音乐' }}
                <span v-if="qLoggedIn && defaultSource === 'qq'" class="star">&#9733;</span>
              </span>
              <span class="account-status">
                {{ qLoggedIn ? 'QQ 音乐 · 已连接' : 'QQ 音乐 · 未连接' }}<span v-if="qLoggedIn && qUser?.vip"> · VIP</span>
              </span>
            </span>
            <span class="account-actions">
              <template v-if="qLoggedIn">
                <button v-if="defaultSource !== 'qq'" class="mini-btn" @click="setDefault('qq')">设为默认</button>
                <button v-else class="mini-btn" @click="goToMusic('qq')">歌单</button>
                <button class="mini-btn danger" @click="handleQqLogout">退出</button>
              </template>
              <button v-else class="mini-btn mini-btn--login qq" @click="handleQqLogin">登录</button>
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import FrostedGlass from '@/components/FrostedGlass.vue'
import { useDropdownTransition } from '@/composables/useGsapTransition'
import { useNeteaseStatus } from '@/composables/useNeteaseStatus'
import { useQqStatus } from '@/composables/useQqStatus'
import { useSfx } from '@/composables/useSfx'

const router = useRouter()
const dropdownTransition = useDropdownTransition('top right')
const sfx = useSfx()

// 双平台状态（模块级单例，仅在本组件内消费，不改动 composable 本身）
const netease = useNeteaseStatus()
const qq = useQqStatus()

const nLoggedIn = netease.isLoggedIn
const qLoggedIn = qq.isLoggedIn
const nUser = netease.userInfo
const qUser = qq.userInfo

const isExpanded = ref(false)
const nAvatarError = ref(false)
const qAvatarError = ref(false)
const rootEl = ref<HTMLElement | null>(null)

// 默认音乐来源（仅胶囊内视觉状态 + 持久化，不影响其他功能）
const STORAGE_KEY = 'beatzfit:default-music-source'
const defaultSource = ref<'netease' | 'qq'>(
  (localStorage.getItem(STORAGE_KEY) as 'netease' | 'qq') || 'netease'
)

// 折叠态单平台展示用：取已登录的那个账号
const singleUser = computed(() => (nLoggedIn.value ? nUser.value : qUser.value))
const singleIsNetease = computed(() => nLoggedIn.value)
const singleAvatarError = computed(() =>
  nLoggedIn.value ? nAvatarError.value : qAvatarError.value
)

onMounted(async () => {
  await Promise.all([netease.checkLoginStatus(), qq.checkLoginStatus()])
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})

function handleClickOutside(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) {
    isExpanded.value = false
  }
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
  if (isExpanded.value) sfx.airBloom()
  else sfx.retract()
}

function fixedUrl(url?: string) {
  return url ? url.replace(/^http:\/\//, 'https://') : ''
}

function setDefault(source: 'netease' | 'qq') {
  sfx.detent()
  defaultSource.value = source
  localStorage.setItem(STORAGE_KEY, source)
}

async function handleNeteaseLogin() {
  sfx.confirm()
  if (!window.electronAPI?.netease) return
  try {
    const result = await window.electronAPI.netease.openLogin()
    if (result.success) {
      await netease.checkLoginStatus(true)
      window.dispatchEvent(new CustomEvent('beatzfit:neteaseLoginChanged', { detail: { loggedIn: true } }))
    }
  } catch (e) {
    console.error('[UserCapsule] Netease login failed:', e)
  }
}

async function handleQqLogin() {
  sfx.confirm()
  if (!window.electronAPI?.qq) return
  try {
    const result = await window.electronAPI.qq.openLogin()
    if (result.success) {
      await qq.checkLoginStatus(true)
      window.dispatchEvent(new CustomEvent('beatzfit:qqLoginChanged', { detail: { loggedIn: true } }))
    }
  } catch (e) {
    console.error('[UserCapsule] QQ login failed:', e)
  }
}

// 网易云退出后保留原行为：自动重开登录窗口
async function handleNeteaseLogout() {
  if (!window.electronAPI?.netease) return
  await window.electronAPI.netease.logout()
  netease.clearStatus()
  isExpanded.value = false
  window.dispatchEvent(new CustomEvent('beatzfit:neteaseLoginChanged', { detail: { loggedIn: false } }))
  setTimeout(async () => {
    try {
      const result = await window.electronAPI?.netease?.openLogin()
      if (result?.success) {
        await netease.checkLoginStatus(true)
        window.dispatchEvent(new CustomEvent('beatzfit:neteaseLoginChanged', { detail: { loggedIn: true } }))
      }
    } catch (e) {
      console.error('[UserCapsule] Netease re-login failed:', e)
    }
  }, 500)
}

async function handleQqLogout() {
  if (!window.electronAPI?.qq) return
  await window.electronAPI.qq.logout()
  qq.clearStatus()
  isExpanded.value = false
  window.dispatchEvent(new CustomEvent('beatzfit:qqLoginChanged', { detail: { loggedIn: false } }))
}

function goToMusic(_source?: 'netease' | 'qq') {
  isExpanded.value = false
  router.push('/music')
}
</script>

<style lang="scss" scoped>
.user-capsule-wrapper {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  -webkit-app-region: no-drag;
}

// == Capsule Button ==
.user-capsule {
  position: relative;
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--text-small);
  overflow: hidden;
  transition: transform 200ms var(--ease-spring);
  will-change: transform;

  &:active {
    transform: scale(0.96) translateZ(0);
    transition: transform 100ms ease-out;
  }

  &--logged-out {
    padding: 6px 14px;
    border-radius: var(--radius-full);
  }

  &--logged-in {
    padding: 4px 10px 4px 4px;
    border-radius: var(--radius-full);
  }
}

.capsule-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  white-space: nowrap;
}

.capsule-icon {
  font-size: 14px;
  color: var(--accent-mist);
}

.capsule-text {
  font-size: var(--text-small);
  color: var(--text-secondary);
}

.capsule-name {
  font-size: var(--text-small);
  color: var(--text-primary);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-chevron {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 200ms var(--ease-standard);

  .user-capsule--expanded & {
    transform: rotate(180deg);
  }
}

// == 头像 + 平台角标（红=网易 / 绿=QQ）==
.avatar-wrap {
  position: relative;
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 50%;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
    display: block;
  }

  .avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    font-size: 13px;
    color: var(--accent-mist);
  }

  .platform-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1px solid rgba(232, 235, 240, 0.5);

    &.netease, &.qq {
      background: #31c27c;
    }

    &.offline {
      background: #e24b4a;
    }
  }
}

// 双平台折叠态：头像重叠
.dual-avatars {
  display: inline-flex;
  align-items: center;

  .avatar-wrap.is-netease {
    z-index: 2;
  }

  .avatar-wrap.is-qq {
    z-index: 1;
    margin-left: -10px;
  }
}

// == Expanded Panel ==
.capsule-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 280px;
  z-index: var(--z-dropdown);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  overflow: hidden;

  & > *:not(.frosted-glass) {
    position: relative;
    z-index: 1;
  }
}

.capsule-panel-content {
  position: relative;
  z-index: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel-title {
  font-size: 10.5px;
  letter-spacing: 1.2px;
  color: rgba(255, 255, 255, 0.4);
  margin: 2px 4px 2px;
}

// 每平台一行
.panel-account {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);

  // 未登录状态：暗淡显示
  &.is-offline {
    opacity: 0.65;

    .avatar-fallback {
      background: rgba(255, 255, 255, 0.06);
    }
  }

  .panel-avatar {
    width: 34px;
    height: 34px;

    .platform-badge {
      width: 10px;
      height: 10px;
    }
  }

  .account-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .account-name {
    font-size: 12.5px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    .star {
      color: #e2c04b;
    }
  }

  .account-status {
    font-size: 10.5px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
}

.mini-btn {
  font-size: 10.5px;
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 3px 7px;
  background: none;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--duration-micro) var(--ease-standard),
              color var(--duration-micro) var(--ease-standard);

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  &.danger {
    color: rgba(255, 120, 130, 0.85);

    &:hover {
      background: rgba(232, 17, 35, 0.12);
      color: rgb(232, 17, 35);
    }
  }

  // 登录按钮：平台色边框
  &--login {
    font-weight: 500;

    &.netease, &.qq {
      color: rgba(233, 235, 239, 0.92);
      border-color: rgba(233, 235, 239, 0.38);

      &:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #f2f4f7;
      }
    }
  }
}

// capsule-dropdown 过渡已迁移至 GSAP JS hooks (useDropdownTransition)
</style>
