/**
 * 音频动效层 — 4 频段方案 (参考 docs/粒子律动方案.md)
 *
 * 接收 AudioSpectrumData 并通过弹簧阻尼系统输出平滑的 4 频段值，
 * 供各可视化预设在 update() 中读取。所有 getter 返回弹簧阻尼平滑值，
 * 低频 & burst 使用高刚度+低阻尼以快速响应脉冲，高频使用低刚度+高阻尼以消除抖动。
 *
 * 输出属性:
 *   lowFreq / midLowFreq / midHighFreq / highFreq — 4 频段能量 (0-1)
 *   rms — 时域 RMS 音量 (0-1)
 *   burstIntensity — 拍点爆发强度 (0-1)
 *   blendedScale — 活动态缩放与待机呼吸的平滑混合
 *   standbyBlend / isStandby — 待机模式状态
 */

import type * as THREE from 'three'
import type { AudioSpectrumData } from './audioAnalyzer'

// =========================================================================
// 工具函数
// =========================================================================

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 帧率无关的指数平滑系数 */
function smoothFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt)
}

// =========================================================================
// 弹簧阻尼系统 (Spring-Damper System)
// =========================================================================

/**
 * 二阶弹簧阻尼跟踪器 (Underdamped Spring-Damper)
 *
 * 模拟一个连接到目标值的弹簧 + 阻尼器。
 * 当目标值快速变化时，输出会以自然的弹性方式跟随，
 * 不会像线性 lerp 那样生硬，也不会像无阻尼弹簧那样永久振荡。
 *
 * F = -k*(x - target) - c*v
 *   k = stiffness (弹性系数, 越大回位越快)
 *   c = damping (阻尼系数, 越大振荡衰减越快)
 *
 * 临界阻尼: c = 2*sqrt(k) → 无振荡但可能偏慢
 * 欠阻尼: c < 2*sqrt(k) → 有轻微振荡, 更自然
 */
function springDamper(
  current: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): { value: number; velocity: number } {
  const force = -stiffness * (current - target) - damping * velocity
  const newVelocity = velocity + force * dt
  const newValue = current + newVelocity * dt
  return { value: newValue, velocity: newVelocity }
}

/**
 * 弹簧阻尼状态容器
 */
class SpringState {
  value = 0
  velocity = 0

  /**
   * 更新弹簧状态并返回新值
   * @param target 目标值
   * @param stiffness 弹性系数 (默认 120, 回位速度适中)
   * @param damping 阻尼系数 (默认 14, 略欠阻尼, 有微弹感)
   * @param dt 帧时间
   */
  update(target: number, stiffness = 120, damping = 14, dt: number): number {
    const result = springDamper(this.value, this.velocity, target, stiffness, damping, dt)
    this.value = result.value
    this.velocity = result.velocity
    return this.value
  }

  reset(value = 0): void {
    this.value = value
    this.velocity = 0
  }
}

// =========================================================================
// 主控制器
// =========================================================================

export class AudioAnimationController {
  // ── 4 频段 (参考 粒子律动方案.md) ──
  private _lowFreq = 0      // 0-1, 20-250Hz
  private _midLowFreq = 0   // 0-1, 250-500Hz
  private _midHighFreq = 0  // 0-1, 500-2000Hz
  private _highFreq = 0     // 0-1, 2000Hz+
  private _rms = 0          // 0-1, 时域 RMS
  private _burst = 0        // 0-1, 拍点爆发强度

  // ── 弹簧阻尼状态 (让运动更丝滑) ──
  private _springLowFreq = new SpringState()
  private _springMidLowFreq = new SpringState()
  private _springMidHighFreq = new SpringState()
  private _springHighFreq = new SpringState()
  private _springRms = new SpringState()
  private _springBurst = new SpringState()

  /** 低频能量 (0-1) — 弹簧阻尼平滑值 */
  get lowFreq(): number { return this._springLowFreq.value }
  /** 中低频能量 (0-1) — 弹簧阻尼平滑值 */
  get midLowFreq(): number { return this._springMidLowFreq.value }
  /** 中高频能量 (0-1) — 弹簧阻尼平滑值 */
  get midHighFreq(): number { return this._springMidHighFreq.value }
  /** 高频能量 (0-1) — 弹簧阻尼平滑值 */
  get highFreq(): number { return this._springHighFreq.value }
  /** 时域 RMS 音量 (0-1) — 弹簧阻尼平滑值 */
  get rms(): number { return this._springRms.value }
  /** 拍点爆发强度 (0-1) — 弹簧阻尼平滑值 */
  get burstIntensity(): number { return this._springBurst.value }

  // ── 待机模式 ──
  private _isStandby = true
  get isStandby(): boolean { return this._isStandby }
  private _standbyTime = 0
  private _standbyBlend = 1.0
  get standbyBlend(): number { return this._standbyBlend }
  private get standbyBreathScale(): number {
    return 1.0 + Math.sin(this._standbyTime * 0.8) * 0.02
  }

  /** 平滑混合缩放倍率 — 保留音频动效, 移除待机呼吸 */
  get blendedScale(): number {
    const activeScale = 1.0 + this._springLowFreq.value * 0.22 + this._springBurst.value * 0.35
    // 待机时也保持 1.0, 不再有 sin 呼吸
    return lerp(activeScale, 1.0, this._standbyBlend)
  }

  // =====================================================================
  // 主更新 — 由各预设在 update() 中调用
  // =====================================================================

  update(
    data: AudioSpectrumData,
    dt: number,
    _camera?: THREE.Camera,
    _cameraBaseZ?: number,
  ): void {
    // ── 直接使用 analyser 输出值 (低频/爆发不额外平滑以保证实时脉冲) ──
    // analyser.smoothingTimeConstant = 0.7 已提供频域平滑
    const rawLowFreq = clamp01(data.lowFreq ?? data.bass)
    const rawMidLowFreq = clamp01(data.midLowFreq ?? data.mid * 0.5)
    const rawMidHighFreq = clamp01(data.midHighFreq ?? data.mid * 0.5)
    const rawHighFreq = clamp01(data.highFreq ?? data.treble)
    const rawRms = clamp01(data.rmsTimeDomain ?? data.volume)
    const rawBurst = clamp01(data.burstIntensity ?? 0)

    // ── 弹簧阻尼系统 ──
    // 低频 & burst: 高刚度 + 低阻尼 → 快速响应脉冲, 轻微弹性回弹
    // 中频: 中等刚度 + 中等阻尼 → 流畅跟随
    // 高频: 低刚度 + 高阻尼 → 平滑无抖动
    // RMS: 中等刚度 + 中等阻尼 → 稳定音量追踪
    this._springLowFreq.update(rawLowFreq, 200, 18, dt)
    this._springBurst.update(rawBurst, 250, 20, dt)
    this._springMidLowFreq.update(rawMidLowFreq, 100, 16, dt)
    this._springMidHighFreq.update(rawMidHighFreq, 100, 16, dt)
    this._springHighFreq.update(rawHighFreq, 80, 18, dt)
    this._springRms.update(rawRms, 90, 14, dt)

    // 原始值直接存储 (用于需要无延迟响应的场景, 如 burst 触发)
    this._lowFreq = rawLowFreq
    this._midLowFreq = rawMidLowFreq
    this._midHighFreq = rawMidHighFreq
    this._highFreq = rawHighFreq
    this._rms = rawRms
    this._burst = rawBurst

    // ── 待机模式检测 (带滞后) ──
    if (this._isStandby) {
      this._isStandby = this._rms < 0.02
    } else {
      this._isStandby = this._rms < 0.005
    }

    // ── 平滑过渡 standbyBlend ──
    const blendTarget = this._isStandby ? 1.0 : 0.0
    this._standbyBlend = lerp(this._standbyBlend, blendTarget, smoothFactor(3.0, dt))

    if (this._isStandby) {
      this._standbyTime += dt
    } else {
      this._standbyTime += dt * 0.3
    }
  }

  // =====================================================================
  // 生命周期
  // =====================================================================

  reset(): void {
    this._lowFreq = 0
    this._midLowFreq = 0
    this._midHighFreq = 0
    this._highFreq = 0
    this._rms = 0
    this._burst = 0
    this._isStandby = true
    this._standbyTime = 0
    this._standbyBlend = 1.0
    this._springLowFreq.reset()
    this._springMidLowFreq.reset()
    this._springMidHighFreq.reset()
    this._springHighFreq.reset()
    this._springRms.reset()
    this._springBurst.reset()
  }

  dispose(): void {
    // 无资源需要释放
  }
}
