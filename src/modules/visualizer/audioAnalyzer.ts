/**
 * Web Audio API 频谱分析器
 *
 * 实时音频分析引擎，通过 requestAnimationFrame 驱动，每帧执行 FFT 分析
 * 并输出 AudioSpectrumData 供可视化器使用。分析开销约 0.3ms/帧 (帧预算的 ~2%)。
 *
 * 分析链路:
 * 1. FFT 频谱获取 (2048 → 1024 bins)
 * 2. 7 频段听觉语义划分 + 动态峰值归一化
 * 3. 4 频段能量均值 (lowFreq 20-250Hz, midLowFreq 250-500Hz,
 *    midHighFreq 500-2000Hz, highFreq 2000Hz+) + 时域 RMS
 * 4. 5 频段 onset 检测 (sub/kick/body/vocal/snap)
 *    - 快慢双包络跟随 → rise = fast - slow → onset 信号
 *    - 频段间加权融合 → drumOnset / musicalOnset
 * 5. 自适应阈值节拍检测 + Tempo (BPM) 跟踪
 * 6. 瞬态通道 (subBassPunch / kickPunch / bassTransient)
 * 7. 无音频信号时输出全零静默数据
 */

import { Howler } from 'howler'

export type FrequencyBand = 'subBass' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'treble' | 'presence' | 'volume' | 'beat'

export interface AudioSpectrumData {
  // ===== 兼容字段 =====
  bass: number       // 0-1 低频能量 (subBass + bass combined)
  mid: number        // 0-1 中频能量 (lowMid + mid + highMid combined)
  treble: number     // 0-1 高频能量 (treble + presence combined)
  volume: number     // 0-1 总音量
  beat: number       // 0-1 节拍检测强度 (向后兼容, = beatStrength)
  rawFrequencies: Uint8Array  // 原始频率数据

  // ===== 4 频段 (参考 粒子律动方案.md) =====
  lowFreq: number      // 0-1, 20-250Hz 低频能量
  midLowFreq: number   // 0-1, 250-500Hz 中低频能量
  midHighFreq: number  // 0-1, 500-2000Hz 中高频能量
  highFreq: number     // 0-1, 2000Hz+ 高频能量
  rmsTimeDomain: number // 0-1, 时域 RMS (从 getByteTimeDomainData 计算)
  burstIntensity: number // 0-1, 拍点爆发强度 (4.0/sec 衰减)
  subBassTremor: number // 0-1, 30-80Hz 重低音能量 (用于相机震颤)

  // ===== 扩展频段 =====
  subBass: number    // 0-1 20-60Hz sub-bass
  lowMid: number     // 0-1 150-400Hz low-mid
  highMid: number    // 0-1 2.5-6kHz high-mid
  presence: number   // 0-1 16kHz+ presence

  // ===== 频谱特征 =====
  spectralFlux: number      // 0-1 energy change rate
  spectralCentroid: number  // 0-1 spectral "brightness"

  // ===== Mineradio 风格 onset 检测 =====
  onset: number           // 0-1 综合 onset 强度 (drum + musical)
  drumOnset: number       // 0-1 鼓组 onset (sub/kick/body 上升)
  musicalOnset: number    // 0-1 音乐 onset (body/vocal/snap 上升)
  beatStrength: number    // 0-1 细粒度节拍强度 (0=无节拍, 1=强节拍)
  tempo: number           // BPM 估计 (0 = 未知)
  tempoConfidence: number // 0-1 tempo 置信度

  // ===== 瞬态通道 (Enhanced Beat Response) =====
  // 快速攻击/快速衰减的信号，捕捉每个鼓点的“打击感”
  // 与 smoothBass/smoothSubBass 的慢速包络互补
  subBassPunch: number    // 0-1 sub-bass 瞬态 (20-60Hz, attack~10ms, release~120ms)
  kickPunch: number       // 0-1 kick 瞬态 (52-165Hz, attack~8ms, release~80ms)
  bassTransient: number   // 0-1 综合低频瞬态 = max(subBassPunch, kickPunch) 加权
}

// =========================================================================
// 工具函数
// =========================================================================

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** 不对称包络 (attack快/release慢) */
function env(prev: number, next: number, attack: number, release: number): number {
  const k = next > prev ? attack : release
  return prev + (next - prev) * k
}

/** dt 无关的指数包络系数 */
function envCoeff(dt: number, timeConstant: number): number {
  return 1 - Math.exp(-dt / Math.max(timeConstant, 0.001))
}

// =========================================================================
// 5 频段 onset 检测参数 (Mineradio 风格)
// =========================================================================

interface BandState {
  fast: number       // 快包络 (attack ~40ms)
  slow: number       // 慢包络 (attack ~330ms)
  prevEnergy: number // 上一帧能量 (for flux)
  rise: number       // fast - slow (onset 信号)
  flux: number       // 帧间能量变化
}

function createBandState(): BandState {
  return { fast: 0, slow: 0, prevEnergy: 0, rise: 0, flux: 0 }
}

// 频段定义 (Hz)
interface BandDef {
  lo: number
  hi: number
}
const ONSET_BANDS: Record<string, BandDef> = {
  sub:   { lo: 38,   hi: 74   },
  kick:  { lo: 52,   hi: 165  },
  body:  { lo: 165,  hi: 420  },
  vocal: { lo: 420,  hi: 2600 },
  snap:  { lo: 1800, hi: 9200 },
}

// onset 融合权重 (来自 Mineradio)
const DRUM_ONSET_WEIGHTS = { subRise: 0.88, subFlux: 0.66, kickRise: 1.62, kickFlux: 1.34 }
const MUSICAL_ONSET_WEIGHTS = { bodyRise: 0.34, vocalRise: 0.52, snapRise: 0.08, rmsFlux: 0.20 }
const MUSICAL_ONSET_SCALE = 0.16

// =========================================================================
// 主引擎
// =========================================================================

export class AudioVisualizerEngine {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private gainNode: GainNode | null = null
  private masterGain: GainNode | null = null
  private animationId: number | null = null
  private dataArray: Uint8Array | null = null
  private ownsAudioContext = false

  // 上一帧频谱 (for spectral flux)
  private prevData: Uint8Array | null = null

  // ===== 平滑频率值 (7频段, 向后兼容) =====
  private smoothBass = 0
  private smoothSubBass = 0
  private smoothMid = 0
  private smoothLowMid = 0
  private smoothHighMid = 0
  private smoothTreble = 0
  private smoothPresence = 0

  // ===== 动态峰值归一化 =====
  private bassPeak = 0.030
  private subBassPeak = 0.020
  private midPeak = 0.026
  private lowMidPeak = 0.022
  private highMidPeak = 0.024
  private treblePeak = 0.018
  private presencePeak = 0.012

  // ===== 低频瞬态 =====
  private lowTrans = 0

  // ===== Enhanced Beat Response: 瞬态提取 =====
  // 快速包络跟随器，捕捉鼓点的打击瞬间
  // attack ~10ms (2帧), release ~100ms (6帧)
  private subBassPunchEnv = 0   // sub-bass 快速包络
  private kickPunchEnv = 0      // kick 快速包络
  private bassTransientSmooth = 0 // 综合瞬态平滑值

  // ===== 旧节拍检测 (向后兼容 beat 字段) =====
  private beatHistory: number[] = []
  private beatThreshold = 1.3
  private beatDecay = 0.95
  private currentBeatValue = 0

  // ===== Spectral flux =====
  private fluxHistory: number[] = []
  private fluxSum = 0
  private prevFlux = 0

  // ===== 5 频段 onset 检测状态 =====
  private bandStates: Record<string, BandState> = {
    sub: createBandState(),
    kick: createBandState(),
    body: createBandState(),
    vocal: createBandState(),
    snap: createBandState(),
  }

  // ===== 自适应阈值 =====
  private onsetAvg = 0       // onset 滑动平均
  private onsetPeak = 0.01   // onset 峰值 (衰减)
  private onsetHistory: number[] = []
  private onsetSum = 0       // 增量求和，避免每帧 reduce

  // ===== 节拍检测 =====
  private beatPulse = 0          // 当前节拍脉冲值 (指数衰减)
  private lastBeatTime = 0       // 上次节拍时间 (performance.now)
  private beatScore = 0          // 当前节拍得分

  // ===== Tempo 跟踪 =====
  private tempoBPM = 0           // 估计 BPM
  private tempoConfidence = 0    // 置信度 0-1
  private beatIntervals: number[] = [] // 最近节拍间隔 (ms)
  private consecutiveHits = 0    // 连续命中计数
  private lastHitAt = 0          // 上次命中时间

  // ===== 回调 =====
  private onData: ((data: AudioSpectrumData) => void) | null = null

  // ===== 质量设置 =====
  private quality: 'high' | 'medium' | 'low' = 'high'
  private loopRunning = false

  // ===== 时域数据 (for RMS) =====
  private timeDataArray: Uint8Array | null = null

  // ===== 4 频段 bin 边界 (基于 sampleRate 动态计算) =====
  private freqBins = { lowEnd: 0, midLowEnd: 0, midHighEnd: 0, highEnd: 0, tremorStart: 0, tremorEnd: 0 }

  // ===== Burst intensity (拍点爆发, 4.0/sec 衰减) =====
  private burstIntensity = 0

  // ===== 调试日志 =====
  private debugEnabled = false
  private lastLogTime = 0
  private lastBeatLogTime = 0
  private lastTempoLogTime = 0
  private corsWarned = false
  private connectionLogged = false

  setQuality(quality: 'high' | 'medium' | 'low'): void {
    this.quality = quality
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled
  }

  private log(msg: string, ...args: any[]): void {
    if (this.debugEnabled) {
      console.log(`[AudioAnalyzer] ${msg}`, ...args)
    }
  }

  private getFftSize(): number {
    switch (this.quality) {
      case 'low': return 1024
      case 'medium': return 1536
      case 'high': return 2048
    }
  }

  // =====================================================================
  // 连接方法
  // =====================================================================

  /**
   * 连接到 Howler 的 master gain（本地文件, html5=false）
   */
  connectToGain(masterGain: GainNode): boolean {
    try {
      this.masterGain = masterGain
      this.audioContext = masterGain.context as AudioContext

      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = this.getFftSize()
      this.analyser.smoothingTimeConstant = 0.7

      masterGain.connect(this.analyser)

      const bufferLength = this.analyser.frequencyBinCount
      this.dataArray = new Uint8Array(bufferLength)
      this.prevData = new Uint8Array(bufferLength)
      this.timeDataArray = new Uint8Array(bufferLength)
      this.ownsAudioContext = false
      this.calcFreqBins()

      if (!this.connectionLogged) {
        this.log('Connected to Howler master gain (Web Audio mode)')
        this.log(`  FFT size: ${this.analyser.fftSize}, bins: ${bufferLength}, sampleRate: ${this.audioContext.sampleRate}Hz`)
        this.connectionLogged = true
      }
      return true
    } catch (e) {
      console.error('[AudioAnalyzer] Failed to connect to gain:', e)
      return false
    }
  }

  /**
   * 连接到 HTML5 Audio 元素，使用指定的 AudioContext
   * 用于 Netease 流 (html5=true)。Howler 在 html5 模式下不通过 Web Audio
   * 路由音频，所以我们用 createMediaElementSource 接入。
   *
   * beat:// 协议返回 Access-Control-Allow-Origin: *，所以 CORS 不再是问题。
   */
  connectToElementWithContext(audioElement: HTMLAudioElement, ctx: AudioContext): boolean {
    try {
      this.audioContext = ctx
      this.ownsAudioContext = false

      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = this.getFftSize()
      this.analyser.smoothingTimeConstant = 0.7

      // createMediaElementSource 只能调用一次; 如果之前调用过会抛异常
      try {
        this.source = ctx.createMediaElementSource(audioElement)
      } catch {
        // 已经创建过 source — 可能是 track 切换后复用了同一个 audio 元素
        // 尝试直接连接 analyser (假设之前的 source 仍然有效)
        this.log('MediaElementSource already exists, reconnecting analyser only')
      }

      if (this.source) {
        this.source.connect(this.analyser)
      }
      this.analyser.connect(ctx.destination)

      const bufferLength = this.analyser.frequencyBinCount
      this.dataArray = new Uint8Array(bufferLength)
      this.prevData = new Uint8Array(bufferLength)
      this.timeDataArray = new Uint8Array(bufferLength)

      ctx.resume().catch((e) => console.warn('[AudioAnalyzer] resume() failed (non-critical):', e))
      this.calcFreqBins()

      if (!this.connectionLogged) {
        this.log('Connected to HTML5 audio element via Howler AudioContext')
        this.log(`  FFT size: ${this.analyser.fftSize}, bins: ${bufferLength}, sampleRate: ${ctx.sampleRate}Hz`)
        this.connectionLogged = true
      }
      return true
    } catch (e) {
      console.error('[AudioAnalyzer] Failed to connect to element:', e)
      return false
    }
  }

  /**
   * 连接到 HTML5 Audio 元素（创建新 AudioContext — 旧接口, 保留向后兼容）
   */
  connectToElement(audioElement: HTMLAudioElement): boolean {
    try {
      this.audioContext = new AudioContext()
      this.ownsAudioContext = true

      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = this.getFftSize()
      this.analyser.smoothingTimeConstant = 0.7

      this.source = this.audioContext.createMediaElementSource(audioElement)
      this.source.connect(this.analyser)
      this.analyser.connect(this.audioContext.destination)

      const bufferLength = this.analyser.frequencyBinCount
      this.dataArray = new Uint8Array(bufferLength)
      this.prevData = new Uint8Array(bufferLength)
      this.timeDataArray = new Uint8Array(bufferLength)

      this.audioContext.resume().catch((e) => console.warn('[AudioAnalyzer] resume() failed (non-critical):', e))
      this.calcFreqBins()

      if (!this.connectionLogged) {
        this.log('Connected to HTML5 audio element (new AudioContext)')
        this.log(`  FFT size: ${this.analyser.fftSize}, bins: ${bufferLength}`)
        this.connectionLogged = true
      }
      return true
    } catch (e) {
      console.error('[AudioAnalyzer] Failed to connect to element:', e)
      return false
    }
  }

  // ===== Public getters for EQ integration =====
  /**
   * Returns the current analyser node (or null if not connected).
   * Used by the EQ composable to insert filters between the analyser
   * and the AudioContext destination.
   */
  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  /**
   * Returns the current AudioContext (or null if not connected).
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext
  }

  disconnect(): void {
    this.stopLoop()

    if (this.source) {
      try { this.source.disconnect() } catch (e) { this.log('source.disconnect failed:', e) }
      this.source = null
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect() } catch (e) { this.log('gainNode.disconnect failed:', e) }
      this.gainNode = null
    }
    if (this.analyser) {
      try { this.analyser.disconnect() } catch (e) { this.log('analyser.disconnect failed:', e) }
      this.analyser = null
    }
    if (this.audioContext && this.ownsAudioContext) {
      this.audioContext.close?.().catch((e) => console.warn('[AudioAnalyzer] close() failed (non-critical):', e))
    }
    this.audioContext = null
    this.ownsAudioContext = false
    this.masterGain = null

    // Reset all state
    this.smoothBass = this.smoothMid = this.smoothTreble = 0
    this.smoothSubBass = this.smoothLowMid = this.smoothHighMid = this.smoothPresence = 0
    this.subBassPunchEnv = 0
    this.kickPunchEnv = 0
    this.bassTransientSmooth = 0
    this.bassPeak = 0.030
    this.subBassPeak = 0.020
    this.midPeak = 0.026
    this.lowMidPeak = 0.022
    this.highMidPeak = 0.024
    this.treblePeak = 0.018
    this.presencePeak = 0.012
    this.beatHistory = []
    this.fluxHistory = []
    this.fluxSum = 0
    this.beatSum = 0
    this.currentBeatValue = 0
    this.prevFlux = 0
    this.lowTrans = 0

    // Reset onset state
    this.bandStates = {
      sub: createBandState(), kick: createBandState(), body: createBandState(),
      vocal: createBandState(), snap: createBandState(),
    }
    this.onsetAvg = 0
    this.onsetPeak = 0.01
    this.onsetHistory = []
    this.onsetSum = 0
    this.beatPulse = 0
    this.beatScore = 0
    this.burstIntensity = 0
    this.tempoBPM = 0
    this.tempoConfidence = 0
    this.beatIntervals = []
    this.consecutiveHits = 0
    this.lastHitAt = 0
    this.corsWarned = false
    this.connectionLogged = false

  }

  startLoop(onData: (data: AudioSpectrumData) => void): void {
    // 防止重复启动多个 rAF 循环
    if (this.animationId !== null) {
      this.onData = onData
      return
    }
    this.onData = onData
    this.tick()
  }

  stopLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    this.onData = null
  }

  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  // =====================================================================
  // 主循环
  // =====================================================================

  private tick = (): void => {
    this.animationId = null

    // 无分析器连接 — 输出静默数据
    if (!this.analyser || !this.dataArray || !this.prevData) {
      this.onData?.(this.getSilentData())
      this.animationId = requestAnimationFrame(this.tick)
      return
    }

    this.analyser.getByteFrequencyData(this.dataArray as Uint8Array<ArrayBuffer>)

    // 全零检测: 无音频播放或跨域受限
    let allZero = true
    for (let i = 0; i < Math.min(50, this.dataArray.length); i++) {
      if (this.dataArray[i] > 0) { allZero = false; break }
    }

    if (allZero) {
      if (!this.corsWarned) {
        this.log('No audio signal detected (silence or CORS issue)')
        this.corsWarned = true
      }
      this.onData?.(this.getSilentData())
      this.animationId = requestAnimationFrame(this.tick)
      return
    }

    // 音频信号恢复
    if (this.corsWarned) {
      this.log('✓ Audio signal restored — real audio analysis active')
      this.corsWarned = false
    }

    const data = this.processSpectrum(this.dataArray, this.prevData)
    this.prevData.set(this.dataArray)

    this.onData?.(data)
    this.animationId = requestAnimationFrame(this.tick)
  }

  /**
   * 生成全零静默数据 — 无音频信号时使用，确保所有动效归零
   * 缓存对象避免每帧创建新对象
   */
  private silentData: AudioSpectrumData = {
    bass: 0, mid: 0, treble: 0, volume: 0, beat: 0,
    rawFrequencies: new Uint8Array(256),
    lowFreq: 0, midLowFreq: 0, midHighFreq: 0, highFreq: 0,
    rmsTimeDomain: 0, burstIntensity: 0, subBassTremor: 0,
    subBass: 0, lowMid: 0, highMid: 0, presence: 0,
    spectralFlux: 0, spectralCentroid: 0,
    onset: 0, drumOnset: 0, musicalOnset: 0, beatStrength: 0,
    tempo: 0, tempoConfidence: 0,
    subBassPunch: 0, kickPunch: 0, bassTransient: 0,
  }

  private getSilentData(): AudioSpectrumData {
    // 更新 tempo 状态（可能从上次播放中保留）
    this.silentData.tempo = this.tempoBPM
    this.silentData.tempoConfidence = this.tempoConfidence
    return this.silentData
  }

  // =====================================================================
  // 4 频段 bin 边界计算 (基于 sampleRate, 参考 粒子律动方案.md)
  // =====================================================================

  private calcFreqBins(): void {
    if (!this.audioContext || !this.analyser) return
    const ny = this.audioContext.sampleRate / 2
    const bc = this.analyser.frequencyBinCount
    const fpb = ny / bc
    this.freqBins.lowEnd     = Math.max(1, Math.floor(250 / fpb))
    this.freqBins.midLowEnd  = Math.max(this.freqBins.lowEnd + 1, Math.floor(500 / fpb))
    this.freqBins.midHighEnd = Math.max(this.freqBins.midLowEnd + 1, Math.floor(2000 / fpb))
    this.freqBins.highEnd    = bc
    // 30-80Hz sub-bass tremor band
    this.freqBins.tremorStart = Math.max(1, Math.floor(30 / fpb))
    this.freqBins.tremorEnd   = Math.max(this.freqBins.tremorStart + 1, Math.floor(80 / fpb))
  }

  /**
   * 计算 4 频段能量均值 + 时域 RMS (参考 粒子律动方案.md / audio_visualizer.html)
   */
  private compute4BandFeatures(data: Uint8Array): {
    lowFreq: number; midLowFreq: number; midHighFreq: number; highFreq: number
    rms: number; subBassTremor: number
  } {
    const { lowEnd, midLowEnd, midHighEnd, highEnd, tremorStart, tremorEnd } = this.freqBins
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0
    let c0 = 0, c1 = 0, c2 = 0, c3 = 0
    // 30-80Hz sub-bass tremor band
    let tremorSum = 0, tremorCount = 0

    for (let i = 0; i < highEnd; i++) {
      const v = data[i] / 255
      if (i < lowEnd) { s0 += v; c0++ }
      else if (i < midLowEnd) { s1 += v; c1++ }
      else if (i < midHighEnd) { s2 += v; c2++ }
      else { s3 += v; c3++ }
      // 30-80Hz sub-bass
      if (i >= tremorStart && i < tremorEnd) { tremorSum += v; tremorCount++ }
    }

    // 时域 RMS
    let rms = 0
    if (this.timeDataArray) {
      this.analyser!.getByteTimeDomainData(this.timeDataArray as Uint8Array<ArrayBuffer>)
      let rs = 0
      for (let i = 0; i < this.timeDataArray.length; i++) {
        const n = (this.timeDataArray[i] - 128) / 128
        rs += n * n
      }
      rms = Math.sqrt(rs / this.timeDataArray.length)
    }

    return {
      lowFreq: c0 > 0 ? s0 / c0 : 0,
      midLowFreq: c1 > 0 ? s1 / c1 : 0,
      midHighFreq: c2 > 0 ? s2 / c2 : 0,
      highFreq: c3 > 0 ? s3 / c3 : 0,
      rms,
      subBassTremor: tremorCount > 0 ? tremorSum / tremorCount : 0,
    }
  }

  // =====================================================================
  // 频谱处理 — 7 频段 + onset 检测 + 节拍 + tempo
  // =====================================================================

  private processSpectrum(data: Uint8Array, prevData: Uint8Array): AudioSpectrumData {
    const len = data.length
    const sampleRate = this.audioContext?.sampleRate ?? 44100
    const fftSize = this.analyser?.fftSize ?? 2048
    const binHz = sampleRate / fftSize  // 每个 bin 的频率宽度

    const dt = 1 / 60 // 假设 60fps

    // ── 7 频段边界 (向后兼容) ──
    const subBassEnd = Math.max(1, Math.floor(len * 0.003))
    const bassEnd = Math.floor(len * 0.035)
    const lowMidEnd = Math.floor(len * 0.08)
    const midEnd = Math.floor(len * 0.18)
    const highMidEnd = Math.floor(len * 0.28)
    const trebleEnd = Math.floor(len * 0.55)

    let bSub = 0, bBass = 0, mLow = 0, mMid = 0, mHigh = 0, tHigh = 0, pHigh = 0

    for (let i = 0; i < subBassEnd; i++) bSub += data[i] / 255
    for (let i = subBassEnd; i < bassEnd; i++) bBass += data[i] / 255
    for (let i = bassEnd; i < lowMidEnd; i++) mLow += data[i] / 255
    for (let i = lowMidEnd; i < midEnd; i++) mMid += data[i] / 255
    for (let i = midEnd; i < highMidEnd; i++) mHigh += data[i] / 255
    for (let i = highMidEnd; i < trebleEnd; i++) tHigh += data[i] / 255
    for (let i = trebleEnd; i < len; i++) pHigh += data[i] / 255

    // ── Spectral flux (低频段) ──
    let flux = 0
    for (let i = 0; i < bassEnd; i++) {
      const diff = data[i] - prevData[i]
      if (diff > 0) flux += diff / 255
    }
    flux /= bassEnd

    // ── 动态峰值归一化 ──
    this.subBassPeak = Math.max(this.subBassPeak * 0.993, bSub, 0.020)
    this.bassPeak = Math.max(this.bassPeak * 0.994, bBass, 0.030)
    this.lowMidPeak = Math.max(this.lowMidPeak * 0.992, mLow, 0.022)
    this.midPeak = Math.max(this.midPeak * 0.993, mMid, 0.026)
    this.highMidPeak = Math.max(this.highMidPeak * 0.993, mHigh, 0.024)
    this.treblePeak = Math.max(this.treblePeak * 0.992, tHigh, 0.018)
    this.presencePeak = Math.max(this.presencePeak * 0.991, pHigh, 0.012)

    const rSub = Math.min(1, Math.pow(bSub / Math.max(0.020, this.subBassPeak * 0.70), 0.80))
    const rBass = Math.min(1, Math.pow(bBass / Math.max(0.030, this.bassPeak * 0.66), 0.78))
    const rLow = Math.min(1, Math.pow(mLow / Math.max(0.022, this.lowMidPeak * 0.70), 0.82))
    const rMid = Math.min(1, Math.pow(mMid / Math.max(0.026, this.midPeak * 0.70), 0.86))
    const rHigh = Math.min(1, Math.pow(mHigh / Math.max(0.024, this.highMidPeak * 0.72), 0.88))
    const rTreb = Math.min(1, Math.pow(tHigh / Math.max(0.018, this.treblePeak * 0.74), 0.90))
    const rPres = Math.min(1, Math.pow(pHigh / Math.max(0.012, this.presencePeak * 0.76), 0.92))

    // ── 低频瞬态 ──
    const lowNow = bBass / Math.max(1, bassEnd - subBassEnd)
    const lowRise = Math.max(0, lowNow - this.lowTrans)
    this.lowTrans = lowNow

    // ── 7 频段不对称包络 (向后兼容) ──
    // 低频使用更慢的 attack/release，过滤快速闪烁
    // 注意：cap 提高到 0.95（原 0.75），保留动态范围
    this.smoothSubBass = env(this.smoothSubBass, Math.min(0.95, rSub * 0.85), 0.12, 0.030)
    this.smoothBass = env(this.smoothBass, Math.min(0.92, rBass * 0.78 + lowRise * 0.020), 0.10, 0.040)
    this.smoothLowMid = env(this.smoothLowMid, Math.min(0.72, rLow * 0.70), 0.18, 0.050)
    this.smoothMid = env(this.smoothMid, Math.min(0.68, rMid * 0.64), 0.18, 0.060)
    this.smoothHighMid = env(this.smoothHighMid, Math.min(0.64, rHigh * 0.60), 0.16, 0.055)
    this.smoothTreble = env(this.smoothTreble, Math.min(0.56, rTreb * 0.54), 0.18, 0.055)
    this.smoothPresence = env(this.smoothPresence, Math.min(0.48, rPres * 0.50), 0.15, 0.050)

    // ── Enhanced Beat Response: 瞬态提取 ──
    // 快速包络跟随器，捕捉鼓点的打击瞬间
    // attack ~10ms (极快，0.5 系数 ≈ 2帧到达目标)
    // release ~120ms (快，0.06 系数 ≈ 16帧衰减到 1/e)
    // 与 smoothBass 的慢速包络（attack 0.10, release 0.040）形成互补：
    //   - smoothBass 追踪持续低频能量（贝斯线、合成器低音）
    //   - punch 追踪瞬时打击（kick drum、808 hit）
    const kPunchAttack = envCoeff(dt, 0.010)   // 10ms attack
    const kPunchRelease = envCoeff(dt, 0.120)  // 120ms release
    this.subBassPunchEnv = env(this.subBassPunchEnv, rSub, kPunchAttack, kPunchRelease)
    this.kickPunchEnv = env(this.kickPunchEnv, rBass, kPunchAttack * 1.2, kPunchRelease * 0.7)

    // 综合低频瞬态：subBass 和 kick 的加权最大值
    const subBassPunch = clamp01(this.subBassPunchEnv * 1.15)  // 略微增益
    const kickPunch = clamp01(this.kickPunchEnv * 1.20)        // kick 稍微更敏感
    const bassTransient = clamp01(Math.max(subBassPunch * 0.6, kickPunch * 0.8))
    this.bassTransientSmooth = bassTransient

    // ── Spectral flux 归一化 ──
    this.fluxHistory.push(flux)
    this.fluxSum += flux
    if (this.fluxHistory.length > 43) {
      this.fluxSum -= this.fluxHistory.shift()!
    }
    const avgFlux = this.fluxSum / Math.max(1, this.fluxHistory.length)
    const normFlux = clamp01((flux - avgFlux * 1.2) * 3)

    // ── 合成兼容字段 ──
    const bass = clamp01(this.smoothSubBass * 0.4 + this.smoothBass * 0.6)
    const mid = clamp01(this.smoothLowMid * 0.3 + this.smoothMid * 0.5 + this.smoothHighMid * 0.2)
    const treble = clamp01(this.smoothTreble * 0.6 + this.smoothPresence * 0.4)
    const volume = clamp01((bass + mid + treble) / 3)

    // =====================================================================
    // 5 频段 onset 检测 (Mineradio 风格)
    // =====================================================================
    const onsetData = this.computeOnset(data, prevData, binHz, dt, volume)

    // ── 旧节拍检测 (向后兼容 beat 字段) ──
    const legacyBeat = this.detectBeat(volume, normFlux)

    // ── 综合 beatStrength: 取旧节拍和新 onset 的最大值 ──
    const beatStrength = clamp01(Math.max(legacyBeat, onsetData.beatPulse))

    // ── 4 频段 + 时域 RMS (参考 粒子律动方案.md) ──
    const band4 = this.compute4BandFeatures(data)

    // ── Burst intensity: beatStrength 驱动, 4.0/sec 衰减 ──
    if (beatStrength > 0.5) {
      this.burstIntensity = Math.max(this.burstIntensity, beatStrength)
    }
    this.burstIntensity = Math.max(0, this.burstIntensity - 4.0 * dt)

    // ── 日志 (节流) ──
    this.maybeLogDebug(onsetData, beatStrength, volume)

    return {
      bass, mid, treble, volume, beat: beatStrength,
      rawFrequencies: data,
      // 4 频段 (参考 粒子律动方案.md)
      lowFreq: band4.lowFreq,
      midLowFreq: band4.midLowFreq,
      midHighFreq: band4.midHighFreq,
      highFreq: band4.highFreq,
      rmsTimeDomain: band4.rms,
      burstIntensity: this.burstIntensity,
      subBassTremor: band4.subBassTremor,
      subBass: clamp01(this.smoothSubBass),
      lowMid: clamp01(this.smoothLowMid),
      highMid: clamp01(this.smoothHighMid),
      presence: clamp01(this.smoothPresence),
      spectralFlux: normFlux,
      spectralCentroid: clamp01((this.smoothHighMid + this.smoothTreble + this.smoothPresence) / Math.max(0.01, bass + mid + treble)),
      // 新字段
      onset: onsetData.onset,
      drumOnset: onsetData.drumOnset,
      musicalOnset: onsetData.musicalOnset,
      beatStrength,
      tempo: this.tempoBPM,
      tempoConfidence: this.tempoConfidence,
      // Enhanced Beat Response: 瞬态通道
      subBassPunch,
      kickPunch,
      bassTransient,
    }
  }

  /**
   * Mineradio 风格 5 频段 onset 检测
   *
   * 每个频段维护 fast (~40ms) 和 slow (~330ms) 两条包络。
   * rise = max(0, fast - slow) 是 onset 信号。
   * flux = 帧间能量变化，也是 onset 的重要补充。
   *
   * drumOnset = subRise*0.88 + subFlux*0.66 + kickRise*1.62 + kickFlux*1.34
   * musicalOnset = bodyRise*0.34 + vocalRise*0.52 + snapRise*0.08 + rmsFlux*0.20
   * onset = drumOnset + musicalOnset * 0.16
   *
   * 自适应阈值: onsetAvg 跟踪平均, onsetPeak 衰减跟踪峰值
   * score = (onset - floor) / (onsetPeak - floor)
   * score > threshold → 触发节拍
   */
  private computeOnset(
    data: Uint8Array,
    prevData: Uint8Array,
    binHz: number,
    dt: number,
    rms: number,
  ): {
    onset: number
    drumOnset: number
    musicalOnset: number
    beatPulse: number
  } {
    // ── 计算每个频段的 RMS 能量 ──
    const bandEnergies: Record<string, number> = {}
    for (const [name, def] of Object.entries(ONSET_BANDS)) {
      const loBin = Math.max(1, Math.floor(def.lo / binHz))
      const hiBin = Math.min(data.length - 1, Math.ceil(def.hi / binHz))
      let sum = 0
      let count = 0
      for (let i = loBin; i <= hiBin; i++) {
        sum += data[i] / 255
        count++
      }
      bandEnergies[name] = count > 0 ? sum / count : 0
    }

    // ── 快慢包络跟随 ──
    const kFastAttack = envCoeff(dt, 0.040)  // 40ms
    const kFastRelease = envCoeff(dt, 0.120) // 120ms
    const kSlow = envCoeff(dt, 0.330)        // 330ms

    for (const name of Object.keys(this.bandStates)) {
      const s = this.bandStates[name]
      const energy = bandEnergies[name] ?? 0

      // fast: 不对称 (attack 快, release 慢)
      s.fast = env(s.fast, energy, kFastAttack, kFastRelease)
      // slow: 对称追踪
      s.slow = s.slow + (energy - s.slow) * kSlow

      // onset 信号
      s.rise = Math.max(0, s.fast - s.slow)

      // spectral flux (帧间能量变化)
      s.flux = Math.max(0, energy - s.prevEnergy)
      s.prevEnergy = energy
    }

    const subRise = this.bandStates.sub.rise
    const subFlux = this.bandStates.sub.flux
    const kickRise = this.bandStates.kick.rise
    const kickFlux = this.bandStates.kick.flux
    const bodyRise = this.bandStates.body.rise
    const vocalRise = this.bandStates.vocal.rise
    const snapRise = this.bandStates.snap.rise

    // RMS flux (整体能量变化)
    const rmsFlux = Math.max(0, rms - (this.bandStates.body.slow * 0.5 + this.bandStates.vocal.slow * 0.5))

    // ── onset 融合 ──
    const drumOnset = clamp01(
      subRise * DRUM_ONSET_WEIGHTS.subRise +
      subFlux * DRUM_ONSET_WEIGHTS.subFlux +
      kickRise * DRUM_ONSET_WEIGHTS.kickRise +
      kickFlux * DRUM_ONSET_WEIGHTS.kickFlux
    )
    const musicalOnset = clamp01(
      bodyRise * MUSICAL_ONSET_WEIGHTS.bodyRise +
      vocalRise * MUSICAL_ONSET_WEIGHTS.vocalRise +
      snapRise * MUSICAL_ONSET_WEIGHTS.snapRise +
      rmsFlux * MUSICAL_ONSET_WEIGHTS.rmsFlux
    )
    const onset = clamp01(drumOnset + musicalOnset * MUSICAL_ONSET_SCALE)

    // ── 自适应阈值 ──
    this.onsetHistory.push(onset)
    this.onsetSum += onset
    if (this.onsetHistory.length > 80) {
      this.onsetSum -= this.onsetHistory.shift()!
    }
    this.onsetAvg = this.onsetSum / this.onsetHistory.length
    this.onsetPeak = Math.max(this.onsetPeak * 0.985, onset, 0.01) // 缓慢衰减

    const floor = this.onsetAvg * 0.6
    const range = Math.max(0.01, this.onsetPeak - floor)
    const score = clamp01((onset - floor) / range)

    // ── Tempo 辅助: 稳定时降低门槛 ──
    const tempoAssist = this.tempoConfidence > 0.4 ? 0.15 * this.tempoConfidence : 0
    const triggerThreshold = 0.45 - tempoAssist

    // ── 节拍触发 ──
    const now = performance.now()
    const minBeatGap = 180 // 最小节拍间隔 180ms (~333 BPM 上限)

    let beatTriggered = false
    if (score > triggerThreshold && (now - this.lastBeatTime) > minBeatGap) {
      beatTriggered = true
      this.beatScore = score
      this.lastBeatTime = now

      // 节拍脉冲: onset 强度驱动
      const pulseStrength = clamp01(0.3 + onset * 1.5 + drumOnset * 0.8)
      this.beatPulse = Math.max(this.beatPulse, pulseStrength)

      // ── Tempo 跟踪 ──
      this.updateTempo(now)
    }

    // 节拍脉冲指数衰减
    this.beatPulse *= Math.pow(0.36, dt) // ~60ms 半衰期

    return {
      onset,
      drumOnset,
      musicalOnset,
      beatPulse: this.beatPulse,
    }
  }

  /**
   * Tempo 跟踪: 记录节拍间隔, 通过直方图估计 BPM
   */
  private updateTempo(now: number): void {
    if (this.lastHitAt > 0) {
      const gap = now - this.lastHitAt
      // 合理范围: 250ms (240 BPM) ~ 1500ms (40 BPM)
      if (gap >= 250 && gap <= 1500) {
        this.beatIntervals.push(gap)
        if (this.beatIntervals.length > 16) this.beatIntervals.shift()

        this.consecutiveHits++
        if (this.consecutiveHits >= 3) {
          // 估计 BPM: 取最近间隔的中位数
          const sorted = [...this.beatIntervals].sort((a, b) => a - b)
          const median = sorted[Math.floor(sorted.length / 2)]
          const bpm = 60000 / median

          // 平滑更新
          if (this.tempoBPM === 0) {
            this.tempoBPM = bpm
          } else {
            this.tempoBPM = this.tempoBPM * 0.7 + bpm * 0.3
          }

          // 置信度
          this.tempoConfidence = clamp(this.consecutiveHits / 10, 0, 0.95)
        }
      } else if (gap > 1500) {
        // 间隔太大, 重置
        this.consecutiveHits = Math.max(0, this.consecutiveHits - 2)
        this.tempoConfidence *= 0.5
      }
    }
    this.lastHitAt = now

    // tempo 日志 (节流: 5秒一次或 BPM 变化 > 5)
    if (this.debugEnabled && this.tempoBPM > 0 && this.tempoConfidence > 0.3) {
      if (now - this.lastTempoLogTime > 5000) {
        this.log(`Tempo: ${this.tempoBPM.toFixed(1)} BPM (confidence: ${this.tempoConfidence.toFixed(2)})`)
        this.lastTempoLogTime = now
      }
    }
  }

  // =====================================================================
  // 调试日志
  // =====================================================================

  private maybeLogDebug(
    onsetData: { onset: number; drumOnset: number; musicalOnset: number; beatPulse: number },
    beatStrength: number,
    volume: number,
  ): void {
    if (!this.debugEnabled) return
    const now = performance.now()

    // 节拍日志 (节流: 最多每 800ms 一次)
    if (beatStrength > 0.5 && now - this.lastBeatLogTime > 800) {
      this.log(
        `Beat: strength=${beatStrength.toFixed(2)} | ` +
        `onset=${onsetData.onset.toFixed(3)} drum=${onsetData.drumOnset.toFixed(3)} ` +
        `musical=${onsetData.musicalOnset.toFixed(3)} | ` +
        `vol=${volume.toFixed(2)}` +
        (this.tempoBPM > 0 ? ` | tempo=${this.tempoBPM.toFixed(0)}BPM` : '')
      )
      this.lastBeatLogTime = now
    }

    // 状态日志 (节流: 每 10 秒一次)
    if (now - this.lastLogTime > 10000) {
      this.log(
        `Status: vol=${volume.toFixed(2)} bass_peak=${this.bassPeak.toFixed(3)} ` +
        `onsetAvg=${this.onsetAvg.toFixed(3)} onsetPeak=${this.onsetPeak.toFixed(3)}`
      )
      this.lastLogTime = now
    }
  }

  /**
   * 旧节拍检测 (向后兼容, 结果会被 onset 检测覆盖)
   * 使用增量求和避免每帧 reduce
   */
  private beatSum = 0
  private detectBeat(currentVolume: number, flux: number): number {
    this.beatHistory.push(currentVolume)
    this.beatSum += currentVolume
    if (this.beatHistory.length > 43) {
      this.beatSum -= this.beatHistory.shift()!
    }
    const avg = this.beatSum / Math.max(1, this.beatHistory.length)

    const volBeat = currentVolume > avg * this.beatThreshold
    const fluxBeat = flux > 0.6

    if (volBeat || fluxBeat) {
      this.currentBeatValue = Math.max(volBeat ? 0.7 : 0, fluxBeat ? 0.9 : 0)
    } else {
      this.currentBeatValue *= this.beatDecay
    }

    return clamp01(this.currentBeatValue)
  }

}

// =========================================================================
// 单例
// =========================================================================

let engineInstance: AudioVisualizerEngine | null = null

export function getVisualizerEngine(): AudioVisualizerEngine {
  if (!engineInstance) {
    engineInstance = new AudioVisualizerEngine()
  }
  return engineInstance
}
