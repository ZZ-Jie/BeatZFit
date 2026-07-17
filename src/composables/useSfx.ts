/**
 * useSfx — 交互音效引擎
 *
 * 全部由 Web Audio API 程序化合成，零音频文件。
 * 4 个音效：
 *   - detent    机械段落：两声极快的双击，像旋钮走过一格（选择/切换）
 *   - airBloom  空气绽放：气流涌起 + 柔音铺底（面板/菜单呼出）
 *   - retract   收回：纯五度下行两音（面板/菜单关闭）
 *   - confirm   确认：纯五度上行两音（确认/成功）
 *
 * 使用 localStorage 持久化开关，与 useGlobalToast 同为 module-level singleton。
 * 遵守 prefers-reduced-motion 时自动静音。
 */

import { ref, readonly } from 'vue'

// ── 开关状态 (module-level singleton) ──────────────────────

const STORAGE_KEY = 'beatzfit:sfxEnabled'
const _enabled = ref(loadEnabled())

function loadEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) return raw === '1'
  } catch { /* ignore */ }
  // 默认开启
  return true
}

function saveEnabled(val: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, val ? '1' : '0')
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('beatzfit:sfxChanged'))
}

export function setSfxEnabled(val: boolean) {
  _enabled.value = val
  saveEnabled(val)
}

export function getSfxEnabled(): boolean {
  return _enabled.value
}

// ── Web Audio 引擎 ─────────────────────────────────────────

let AC: AudioContext | null = null
const MASTER = 0.7

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!AC) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return null
    AC = new Ctor()
  }
  if (AC.state === 'suspended') AC.resume()
  return AC
}

/** 一个音调：频率(可滑音) + 波形 + 时长 + 音量包络 */
function tone(opts: {
  freq?: number
  to?: number | null
  type?: OscillatorType
  dur?: number
  gain?: number
  attack?: number
  detune?: number
} = {}): void {
  const { freq = 440, to = null, type = 'sine', dur = 0.12, gain = 0.3, attack = 0.004, detune = 0 } = opts
  const c = ctx()
  if (!c) return
  const t = c.currentTime
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.detune.value = detune
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur)
  const peak = gain * MASTER
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

/** 一段噪声：带通/低通滤波 + 包络（用于咔哒/气流质感） */
function noise(opts: {
  dur?: number
  type?: BiquadFilterType
  freq?: number
  to?: number | null
  q?: number
  gain?: number
  attack?: number
} = {}): void {
  const { dur = 0.06, type = 'bandpass', freq = 2000, to = null, q = 1.2, gain = 0.3, attack = 0.002 } = opts
  const c = ctx()
  if (!c) return
  const t = c.currentTime
  const n = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, n, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = type
  f.Q.value = q
  f.frequency.setValueAtTime(freq, t)
  if (to) f.frequency.exponentialRampToValueAtTime(Math.max(80, to), t + dur)
  const g = c.createGain()
  const peak = gain * MASTER
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(f).connect(g).connect(c.destination)
  src.start(t)
  src.stop(t + dur + 0.02)
}

// ── 5 个音效定义 ───────────────────────────────────────────

/** 机械段落：两声极快的双击，像旋钮走过一格 */
function detent(): void {
  if (!_enabled.value) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
  noise({ dur: 0.014, type: 'bandpass', freq: 1600, q: 2, gain: 0.26 })
  setTimeout(() => noise({ dur: 0.012, type: 'bandpass', freq: 1400, q: 2, gain: 0.16 }), 34)
}

/** 空气绽放：气流涌起 + 柔音铺底，最有氛围感 */
function airBloom(): void {
  if (!_enabled.value) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
  noise({ dur: 0.22, type: 'lowpass', freq: 400, to: 2600, q: 0.8, gain: 0.16, attack: 0.05 })
  tone({ freq: 440, to: 660, type: 'sine', dur: 0.2, gain: 0.12, attack: 0.04 })
}

/** 收回：纯五度下行两音，与「确认」镜像呼应 */
function retract(): void {
  if (!_enabled.value) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
  tone({ freq: 990, type: 'sine', dur: 0.09, gain: 0.24, attack: 0.005 })
  setTimeout(() => tone({ freq: 660, type: 'sine', dur: 0.13, gain: 0.24, attack: 0.005 }), 80)
}

/** 确认：纯五度上行两音，愉悦的成功感 */
function confirm(): void {
  if (!_enabled.value) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
  tone({ freq: 660, type: 'sine', dur: 0.09, gain: 0.24, attack: 0.005 })
  setTimeout(() => tone({ freq: 990, type: 'sine', dur: 0.13, gain: 0.24, attack: 0.005 }), 80)
}

// ── Composable ─────────────────────────────────────────────

export interface SfxAPI {
  /** 机械段落：选择/切换/翻页 */
  detent: typeof detent
  /** 空气绽放：面板/菜单呼出 */
  airBloom: typeof airBloom
  /** 收回：面板/菜单关闭 */
  retract: typeof retract
  /** 确认：确认/成功 */
  confirm: typeof confirm
  /** 音效总开关 (只读 ref) */
  enabled: typeof _enabled
}

export function useSfx(): SfxAPI {
  return {
    detent,
    airBloom,
    retract,
    confirm,
    enabled: readonly(_enabled) as typeof _enabled,
  }
}

// ── 监听外部开关变化 (跨组件同步) ──────────────────────────
if (typeof window !== 'undefined') {
  window.addEventListener('beatzfit:sfxChanged', () => {
    _enabled.value = loadEnabled()
  })
}
