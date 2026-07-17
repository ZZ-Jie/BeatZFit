<script setup lang="ts">
/**
 * WorkoutShareCard — 训练战绩分享卡片
 *
 * 训练完成（或手动结束）后弹出的简约高级风格卡片，
 * 使用 Canvas 2D 合成图片供用户保存到剪贴板或本地文件。
 *
 * 卡片包含三大视觉元素：
 * 1. 可视化背景：实时频谱波形 + 封面模糊光晕
 * 2. 歌曲信息：当前播放的歌曲名称 + 艺术家
 * 3. 训练数据：时长、动作数、总组数、总次数
 */
import { ref, watch, onBeforeUnmount, computed, nextTick } from 'vue'
import gsap from 'gsap'
import { useMusicStore } from '@/stores/music'
import { useModalTransition } from '@/composables/useGsapTransition'
import { getVisualizerEngine } from '@/modules/visualizer/audioAnalyzer'
import { useSfx } from '@/composables/useSfx'

interface ShareCardData {
  planName: string
  durationSeconds: number
  completed: boolean
  totalSets: number
  totalReps: number
  exerciseCount: number
}

interface Props {
  visible: boolean
  data: ShareCardData | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ close: [] }>()

const musicStore = useMusicStore()
const modalTransition = useModalTransition()
const sfx = useSfx()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const cardRef = ref<HTMLElement | null>(null)
const isSaving = ref(false)
const saveSuccess = ref(false)

const currentTrack = computed(() => musicStore.currentTrack)

/** 格式化时长 mm:ss */
function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 格式化日期 */
function formatDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = (now.getMonth() + 1).toString().padStart(2, '0')
  const d = now.getDate().toString().padStart(2, '0')
  return `${y}.${m}.${d}`
}

// ── 关键修复：watch visible + data，当卡片变为可见时触发绘制 ──
watch(
  () => [props.visible, props.data],
  async ([visible]) => {
    if (visible && props.data) {
      await nextTick()
      // 再等一帧确保 DOM 中的 canvas 已渲染
      requestAnimationFrame(() => {
        drawCard()
        animateIn()
      })
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (cardRef.value) gsap.killTweensOf(cardRef.value)
})

function animateIn() {
  if (!cardRef.value) return
  gsap.fromTo(cardRef.value,
    { autoAlpha: 0, scale: 0.92, y: 24 },
    { autoAlpha: 1, scale: 1, y: 0, duration: 0.45, ease: 'back.out(1.2)' }
  )
}

/**
 * 从音频分析引擎获取当前频谱快照
 * 返回 64 个归一化频段值 (0-1)
 */
function captureSpectrum(): number[] {
  const engine = getVisualizerEngine()
  const analyser = engine.getAnalyser()
  if (!analyser) return []

  const bufferLength = analyser.frequencyBinCount
  const dataArray = new Uint8Array(bufferLength)
  analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>)

  // 压缩为 64 个频段（对数采样，模拟听觉感知）
  const bands = 64
  const result: number[] = []
  const step = Math.max(1, Math.floor(bufferLength / bands / 2)) // 只取前一半（人耳敏感范围）

  for (let i = 0; i < bands; i++) {
    const start = Math.floor((i / bands) * (bufferLength / 2))
    const end = Math.min(bufferLength / 2, start + step)
    let sum = 0
    let count = 0
    for (let j = start; j < end; j++) {
      sum += dataArray[j]
      count++
    }
    result.push(count > 0 ? sum / count / 255 : 0)
  }

  return result
}

/**
 * 在 Canvas 上绘制训练卡片。
 * 尺寸 1080×1350 (4:5 比例, 适合社交媒体分享)
 */
function drawCard() {
  const canvas = canvasRef.value
  if (!canvas || !props.data) return

  const W = 1080
  const H = 1350
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const data = props.data

  // ══════════════════════════════════════════════════════════════
  // 1. 深色渐变背景
  // ══════════════════════════════════════════════════════════════
  const bgGrad = ctx.createLinearGradient(0, 0, W, H)
  bgGrad.addColorStop(0, '#0a0a14')
  bgGrad.addColorStop(0.5, '#0f0f1a')
  bgGrad.addColorStop(1, '#12121e')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  // ══════════════════════════════════════════════════════════════
  // 2. 封面模糊光晕（如果有当前歌曲封面）
  // ══════════════════════════════════════════════════════════════
  const coverUrl = currentTrack.value?.coverPath
    ? musicStore.toCoverUrl(currentTrack.value.coverPath)
    : undefined

  if (coverUrl) {
    // 异步加载封面图 — 先绘制其他内容，封面加载后重绘
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      drawCoverGlow(ctx, img, W, H)
      // 重绘所有文字内容（因为封面光晕可能覆盖）
      drawCardContent(ctx, W, H, data)
    }
    img.onerror = () => {
      // 封面加载失败，用纯渐变光晕替代
      drawGradientGlow(ctx, W, H)
      drawCardContent(ctx, W, H, data)
    }
    img.src = coverUrl
  } else {
    drawGradientGlow(ctx, W, H)
  }

  // 同步绘制文字内容（如果封面加载慢，用户先看到文字；加载完成后重绘）
  drawCardContent(ctx, W, H, data)
}

/**
 * 绘制封面模糊光晕作为背景装饰
 */
function drawCoverGlow(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number) {
  // 在右上角绘制大尺寸模糊封面作为氛围光源
  ctx.save()
  ctx.globalAlpha = 0.15
  ctx.filter = 'blur(80px) saturate(180%)'
  // 绘制放大裁切的封面
  const scale = Math.max(W / img.width, H / img.height) * 1.5
  const sw = img.width * scale
  const sh = img.height * scale
  ctx.drawImage(img, (W - sw) / 2, -sh * 0.2, sw, sh)
  ctx.restore()

  // 左下角再来一个较小的光晕
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.filter = 'blur(60px) saturate(200%)'
  const scale2 = Math.max(W / img.width, H / img.height) * 0.8
  const sw2 = img.width * scale2
  const sh2 = img.height * scale2
  ctx.drawImage(img, -sw2 * 0.3, H - sh2 * 0.7, sw2, sh2)
  ctx.restore()
}

/**
 * 无封面时用渐变光晕替代
 */
function drawGradientGlow(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const glowGrad1 = ctx.createRadialGradient(W * 0.2, H * 0.15, 0, W * 0.2, H * 0.15, 400)
  glowGrad1.addColorStop(0, 'rgba(126, 200, 227, 0.08)')
  glowGrad1.addColorStop(1, 'rgba(126, 200, 227, 0)')
  ctx.fillStyle = glowGrad1
  ctx.fillRect(0, 0, W, H)

  const glowGrad2 = ctx.createRadialGradient(W * 0.85, H * 0.8, 0, W * 0.85, H * 0.8, 350)
  glowGrad2.addColorStop(0, 'rgba(250, 88, 106, 0.06)')
  glowGrad2.addColorStop(1, 'rgba(250, 88, 106, 0)')
  ctx.fillStyle = glowGrad2
  ctx.fillRect(0, 0, W, H)
}

/**
 * 绘制卡片的所有文字和数据内容
 */
function drawCardContent(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  data: ShareCardData
) {
  // ══════════════════════════════════════════════════════════════
  // 3. 频谱可视化波形（底部装饰带）
  // ══════════════════════════════════════════════════════════════
  const spectrum = captureSpectrum()
  if (spectrum.length > 0) {
    drawSpectrumWave(ctx, W, H, spectrum)
  }

  // ══════════════════════════════════════════════════════════════
  // 4. 顶部品牌区
  // ══════════════════════════════════════════════════════════════
  ctx.textAlign = 'center'
  ctx.font = '300 42px "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.fillText('BeatZFit', W / 2, 90)

  ctx.font = '400 18px "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.fillText('MUSIC · DRIVEN · TRAINING', W / 2, 122)

  // 顶部分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(120, 165)
  ctx.lineTo(W - 120, 165)
  ctx.stroke()

  // ══════════════════════════════════════════════════════════════
  // 5. 状态标签
  // ══════════════════════════════════════════════════════════════
  const statusText = data.completed ? 'TRAINING COMPLETE' : 'TRAINING ENDED'
  const statusColor = data.completed ? '#58D68D' : '#F5B041'
  ctx.font = '600 16px "Noto Sans SC", sans-serif'
  ctx.fillStyle = statusColor
  ctx.fillText(statusText, W / 2, 215)

  // ══════════════════════════════════════════════════════════════
  // 6. 训练计划名称
  // ══════════════════════════════════════════════════════════════
  ctx.font = '600 52px "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  let planName = data.planName
  if (ctx.measureText(planName).width > W - 240) {
    while (ctx.measureText(planName + '...').width > W - 240 && planName.length > 0) {
      planName = planName.slice(0, -1)
    }
    planName += '...'
  }
  ctx.fillText(planName, W / 2, 290)

  // ══════════════════════════════════════════════════════════════
  // 7. 核心数据区
  // ══════════════════════════════════════════════════════════════
  const statsY = 420
  const statItems = [
    { label: '时长', value: formatDuration(data.durationSeconds), unit: '' },
    { label: '动作', value: String(data.exerciseCount), unit: '个' },
    { label: '总组数', value: String(data.totalSets), unit: '组' },
    { label: '总次数', value: String(data.totalReps), unit: '次' },
  ]

  const statSpacing = (W - 240) / statItems.length
  statItems.forEach((item, i) => {
    const x = 120 + statSpacing * (i + 0.5)

    // 数值
    ctx.font = '700 56px "Noto Sans SC", sans-serif'
    ctx.fillStyle = 'rgba(250, 88, 106, 0.9)'
    ctx.textAlign = 'center'
    ctx.fillText(item.value, x, statsY)

    // 单位
    if (item.unit) {
      const valueWidth = ctx.measureText(item.value).width
      ctx.font = '400 20px "Noto Sans SC", sans-serif'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.textAlign = 'left'
      ctx.fillText(item.unit, x + valueWidth / 2 + 4, statsY)
    }

    // 标签
    ctx.font = '400 18px "Noto Sans SC", sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.textAlign = 'center'
    ctx.fillText(item.label, x, statsY + 40)
  })

  // ══════════════════════════════════════════════════════════════
  // 8. 歌曲信息区
  // ══════════════════════════════════════════════════════════════
  const musicY = 580
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.beginPath()
  ctx.moveTo(120, musicY - 30)
  ctx.lineTo(W - 120, musicY - 30)
  ctx.stroke()

  if (currentTrack.value) {
    ctx.font = '400 16px "Noto Sans SC", sans-serif'
    ctx.fillStyle = 'rgba(126, 200, 227, 0.6)'
    ctx.textAlign = 'center'
    ctx.fillText('♫ 伴随音乐', W / 2, musicY)

    ctx.font = '500 28px "Noto Sans SC", sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    let trackTitle = currentTrack.value.title
    if (ctx.measureText(trackTitle).width > W - 240) {
      while (ctx.measureText(trackTitle + '...').width > W - 240 && trackTitle.length > 0) {
        trackTitle = trackTitle.slice(0, -1)
      }
      trackTitle += '...'
    }
    ctx.fillText(trackTitle, W / 2, musicY + 38)

    ctx.font = '400 20px "Noto Sans SC", sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.fillText(currentTrack.value.artist, W / 2, musicY + 68)
  } else {
    ctx.font = '400 18px "Noto Sans SC", sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.textAlign = 'center'
    ctx.fillText('无音乐播放', W / 2, musicY + 20)
  }

  // ══════════════════════════════════════════════════════════════
  // 9. 底部品牌区
  // ══════════════════════════════════════════════════════════════
  const footerY = H - 180
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.beginPath()
  ctx.moveTo(120, footerY)
  ctx.lineTo(W - 120, footerY)
  ctx.stroke()

  ctx.font = '400 20px "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.textAlign = 'center'
  ctx.fillText(formatDate(), W / 2, footerY + 40)

  ctx.font = '300 16px "Noto Sans SC", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.fillText('BeatZFit — 用音乐驱动每一次训练', W / 2, H - 80)
}

/**
 * 绘制频谱可视化波形作为卡片背景装饰
 * 波形位于卡片中下部，呈镜像对称的频谱柱状图
 */
function drawSpectrumWave(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  spectrum: number[]
) {
  const waveY = H * 0.72 // 波形中心 Y 坐标
  const barCount = spectrum.length
  const barWidth = (W - 240) / barCount
  const startX = 120
  const maxBarHeight = 120 // 单侧最大高度

  ctx.save()

  // 绘制镜像频谱柱
  for (let i = 0; i < barCount; i++) {
    const value = spectrum[i]
    // 应用幂律压缩使低能量也可见
    const height = Math.pow(value, 0.7) * maxBarHeight
    if (height < 1) continue

    const x = startX + i * barWidth + barWidth * 0.15
    const barW = barWidth * 0.7

    // 渐变色：从中心向外渐变
    const ratio = i / barCount
    let r: number, g: number, b: number
    if (ratio < 0.33) {
      // 低频 — 青色
      r = 126; g = 200; b = 227
    } else if (ratio < 0.66) {
      // 中频 — 紫色
      r = 180; g = 130; b = 220
    } else {
      // 高频 — 粉红
      r = 250; g = 88; b = 106
    }

    // 上半部分（向上延伸）
    const upperGrad = ctx.createLinearGradient(0, waveY - height, 0, waveY)
    upperGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
    upperGrad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.25)`)
    upperGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.5)`)
    ctx.fillStyle = upperGrad
    roundRect(ctx, x, waveY - height, barW, height, barW / 2)
    ctx.fill()

    // 下半部分（向下延伸，镜像，更短）
    const lowerHeight = height * 0.4
    const lowerGrad = ctx.createLinearGradient(0, waveY, 0, waveY + lowerHeight)
    lowerGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`)
    lowerGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = lowerGrad
    roundRect(ctx, x, waveY, barW, lowerHeight, barW / 2)
    ctx.fill()
  }

  // 中心线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(120, waveY)
  ctx.lineTo(W - 120, waveY)
  ctx.stroke()

  ctx.restore()
}

/** 圆角矩形辅助函数 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

/** 保存到剪贴板 */
async function saveToClipboard() {
  sfx.confirm()
  const canvas = canvasRef.value
  if (!canvas) return
  isSaving.value = true
  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    if (!blob) throw new Error('Canvas toBlob failed')

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ])
    saveSuccess.value = true
    setTimeout(() => { saveSuccess.value = false }, 3000)
  } catch (e) {
    console.warn('[WorkoutShareCard] Clipboard write failed, trying file save:', e)
    await saveToFile()
  } finally {
    isSaving.value = false
  }
}

/** 保存到本地文件 (通过 Electron) */
async function saveToFile() {
  sfx.confirm()
  const canvas = canvasRef.value
  if (!canvas) return
  isSaving.value = true
  try {
    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.split(',')[1]
    if (window.electronAPI) {
      const result = await (window.electronAPI as any).music?.saveImage?.(base64, `beatzfit-${Date.now()}.png`)
      if (result?.success) {
        saveSuccess.value = true
        setTimeout(() => { saveSuccess.value = false }, 3000)
      } else {
        downloadDataUrl(dataUrl)
      }
    } else {
      downloadDataUrl(dataUrl)
    }
  } catch (e) {
    console.error('[WorkoutShareCard] Save failed:', e)
  } finally {
    isSaving.value = false
  }
}

function downloadDataUrl(dataUrl: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `beatzfit-training-${Date.now()}.png`
  a.click()
  saveSuccess.value = true
  setTimeout(() => { saveSuccess.value = false }, 3000)
}

function handleClose() {
  sfx.retract()
  if (cardRef.value) {
    gsap.to(cardRef.value, {
      autoAlpha: 0,
      scale: 0.95,
      duration: 0.25,
      ease: 'power2.in',
      onComplete: () => emit('close')
    })
  } else {
    emit('close')
  }
}
</script>

<template>
  <Transition :css="false" @enter="modalTransition.onEnter" @leave="modalTransition.onLeave">
    <div v-if="visible" class="share-overlay" @click.self="handleClose">
      <div class="share-card-wrapper" ref="cardRef">
        <!-- Canvas 预览 -->
        <div class="share-canvas-container">
          <canvas ref="canvasRef" class="share-canvas"></canvas>
        </div>

        <!-- 操作区 -->
        <div class="share-actions">
          <div class="share-status" v-if="saveSuccess">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8L6.5 11.5L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>已保存到剪贴板</span>
          </div>

          <div class="share-btns">
            <button class="share-btn share-btn--primary" @click="saveToClipboard" :disabled="isSaving">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="4" y="3" width="8" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M6 1.5H10V3H6V1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
              {{ isSaving ? '保存中...' : '复制到剪贴板' }}
            </button>
            <button class="share-btn" @click="saveToFile" :disabled="isSaving">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2V11M4 7L8 11L12 7M3 14H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              保存图片
            </button>
            <button class="share-btn share-btn--ghost" @click="handleClose">
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.share-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 5, 10, 0.6);
  backdrop-filter: blur(12px) saturate(120%);
  -webkit-backdrop-filter: blur(12px) saturate(120%);
}

.share-card-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
  max-height: 90vh;
}

.share-canvas-container {
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 32px 80px rgba(0, 0, 0, 0.5),
    0 8px 24px rgba(0, 0, 0, 0.3);
  max-height: 70vh;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    border: 1px solid rgba(255, 255, 255, 0.08);
    pointer-events: none;
  }
}

.share-canvas {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  width: auto;
  height: auto;
}

.share-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
}

.share-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: var(--radius-full);
  background: rgba(88, 214, 141, 0.12);
  border: 1px solid rgba(88, 214, 141, 0.25);
  color: #58D68D;
  font-size: var(--text-small);
  animation: status-pop 0.3s ease-out;
}

@keyframes status-pop {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.share-btns {
  display: flex;
  gap: var(--space-sm);
}

.share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-secondary);
  font-size: var(--text-small);
  cursor: pointer;
  transition: all 150ms var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--glass-bg-hover);
    color: var(--text-primary);
    border-color: var(--glass-border-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &--primary {
    background: rgba(250, 88, 106, 0.15);
    border-color: rgba(250, 88, 106, 0.25);
    color: var(--accent-mist);

    &:hover:not(:disabled) {
      background: rgba(250, 88, 106, 0.25);
    }
  }

  &--ghost {
    background: transparent;
  }
}

@media (max-width: 600px) {
  .share-card-wrapper {
    width: calc(100vw - 32px);
  }

  .share-btns {
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>
