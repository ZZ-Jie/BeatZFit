<template>
  <div class="splash-overlay" ref="rootEl" @click="dismiss" @keydown.escape="dismiss">
    <canvas ref="canvasEl" class="splash-canvas"></canvas>

    <!-- 四角装饰线 (Apple 风格边框低语) -->
    <span class="splash-corner corner-tl" ref="cTL"></span>
    <span class="splash-corner corner-tr" ref="cTR"></span>
    <span class="splash-corner corner-bl" ref="cBL"></span>
    <span class="splash-corner corner-br" ref="cBR"></span>

    <!-- Logo 层 -->
    <div class="splash-logo" ref="logoEl">
      <!-- 柔光背板, 确保 Logo 在水面之上可读 -->
      <div class="splash-glow" ref="glowEl"></div>
      <div class="splash-icon" ref="iconEl">
        <!-- 哑铃图标 -->
        <svg viewBox="0 0 32 32" class="splash-icon-svg">
          <!-- 杠铃杆 -->
          <rect x="9" y="14.8" width="14" height="2.4" rx="1.2" fill="rgba(40,35,25,0.55)"/>
          <!-- 左侧内挡片 -->
          <rect x="7" y="12.5" width="2" height="7" rx="0.8" fill="rgba(40,35,25,0.65)"/>
          <!-- 左侧配重片 -->
          <rect x="3" y="9.5" width="3.5" height="13" rx="1.5" fill="rgba(40,35,25,0.75)"/>
          <!-- 右侧内挡片 -->
          <rect x="23" y="12.5" width="2" height="7" rx="0.8" fill="rgba(40,35,25,0.65)"/>
          <!-- 右侧配重片 -->
          <rect x="25.5" y="9.5" width="3.5" height="13" rx="1.5" fill="rgba(40,35,25,0.75)"/>
        </svg>
      </div>
      <div class="splash-text" ref="textEl">BeatZ Fit</div>
    </div>

    <!-- 跳过提示 -->
    <div class="splash-hint" ref="hintEl">点击进入</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import gsap from 'gsap'

const emit = defineEmits<{ done: [] }>()

// ── DOM refs ──
const rootEl = ref<HTMLDivElement>()
const canvasEl = ref<HTMLCanvasElement>()
const logoEl = ref<HTMLDivElement>()
const iconEl = ref<HTMLDivElement>()
const textEl = ref<HTMLDivElement>()
const glowEl = ref<HTMLDivElement>()
const hintEl = ref<HTMLDivElement>()
const cTL = ref<HTMLSpanElement>()
const cTR = ref<HTMLSpanElement>()
const cBL = ref<HTMLSpanElement>()
const cBR = ref<HTMLSpanElement>()

// ── State ──
let renderer: THREE.WebGLRenderer | null = null
// Display pass
let displayScene: THREE.Scene | null = null
let displayCamera: THREE.OrthographicCamera | null = null
let displayMesh: THREE.Mesh | null = null
let displayMaterial: THREE.ShaderMaterial | null = null
// Simulation pass (ping-pong FBO)
let simScene: THREE.Scene | null = null
let simCamera: THREE.OrthographicCamera | null = null
let simMesh: THREE.Mesh | null = null
let simMaterial: THREE.ShaderMaterial | null = null
let rtA: THREE.WebGLRenderTarget | null = null
let rtB: THREE.WebGLRenderTarget | null = null

const SIM_SIZE = 512 // 模拟纹理分辨率

let rafId = 0
let clock: THREE.Clock | null = null
let disposed = false
let introTimeline: gsap.core.Timeline | null = null
let idleTweens: gsap.core.Tween[] = []
let charSpans: HTMLSpanElement[] = []
let resizeHandler: (() => void) | null = null
let mouseMoveHandler: ((e: MouseEvent) => void) | null = null
let touchHandler: ((e: TouchEvent) => void) | null = null

// ── Mouse state ──
// mouseUV: 当前鼠标在模拟纹理空间的位置 (0..1)
// mousePrevUV: 上一帧位置 (用于计算速度)
// mouseVel: 平滑后的速度向量
const mouseTarget = { x: 0, y: 0 } // normalized -1..1 (for DOM parallax)
const mouseUV = { x: 0.5, y: 0.5 }
const mousePrevUV = { x: 0.5, y: 0.5 }
const mouseVel = { x: 0, y: 0 }
let mouseStrength = 0 // 平滑后的扰动强度
let mouseActive = false // 鼠标是否已移动过

// ── Reduced motion ──
const reduced = typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
const tScale = reduced ? 0.2 : 1.0

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x }
function smooth01(x: number): number { x = clamp01(x); return x * x * (3 - 2 * x) }

// ════════════════════════════════════════════════════════════════════
//  Shaders
// ════════════════════════════════════════════════════════════════════

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

// ── 模拟着色器: 2D 波方程 (ping-pong) ──
// 纹理 R 通道 = 当前高度, G 通道 = 上一帧高度
// 每帧: new = (邻居平均) * 2 - 前一帧, 再乘阻尼, 注入鼠标扰动
// 这产生物理真实的波纹传播、干涉和衰减 — 水向两边自然排开
const simFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev;       // 前一帧状态 (R=当前, G=前一帧)
  uniform vec2  uTexel;          // 1/模拟分辨率
  uniform vec2  uMouse;          // 鼠标位置 (uv 空间 0..1)
  uniform vec2  uMouseVel;       // 鼠标速度 (uv 空间/帧)
  uniform float uMouseStrength;  // 鼠标扰动强度 (0..1)
  uniform float uDamping;        // 波阻尼 (0.995)
  uniform float uReducedMotion;
  varying vec2 vUv;

  void main() {
    vec4 state = texture2D(uPrev, vUv);
    float cur  = state.r;
    float prev = state.g;

    // 采样四邻居 (当前高度)
    float l = texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r;
    float r = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r;
    float u = texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r;
    float d = texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r;

    // 2D 波方程: new = (四邻居之和)/2 - 前一帧
    float newH = (l + r + u + d) * 0.5 - prev;
    newH *= uDamping;

    // ── 鼠标扰动: 在鼠标位置注入凹陷 (水被推低) ──
    // 波方程自然将此凹陷向外传播 → 两侧水波向两边排开
    // 扰乱强度与鼠标速度成正比, 静止时不注入
    float motionScale = 1.0 - uReducedMotion * 0.9;
    float dist = distance(vUv, uMouse);
    // 柔和的圆形笔刷, 半径随强度微调
    float brushRadius = 0.018 + 0.012 * uMouseStrength;
    float brush = smoothstep(brushRadius, 0.0, dist) * uMouseStrength * 0.045 * motionScale;
    newH -= brush; // 负值 = 凹陷

    gl_FragColor = vec4(newH, cur, 0.0, 1.0);
  }
`

// ── 显示着色器: 读取模拟纹理 + 环境波浪 → 法线光照 ──
const displayFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uRipples;    // 模拟结果 (R = 高度)
  uniform float uTime;
  uniform vec2  uResolution;
  uniform float uIntro;
  uniform float uReducedMotion;
  varying vec2 vUv;

  // ── 噪声工具 ──
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  // ── 环境波浪高度 (基底水面, 无鼠标交互时也流动) ──
  float ambientHeight(vec2 uv) {
    vec2 p = uv - 0.5;
    float ar = uResolution.x / uResolution.y;
    p.x *= ar;
    p *= 2.2;

    vec2 warp = vec2(
      fbm(p * 0.55 + vec2(0.0, uTime * 0.09)),
      fbm(p * 0.55 + vec2(3.0, -uTime * 0.09))
    );
    vec2 wp = p + (warp - 0.5) * 0.62;

    float h = 0.0;
    // 主浪组: 横向行进波 (从左向右涌动)
    h += 0.45 * sin(wp.x * 0.42 + wp.y * 0.03 - uTime * 0.25);
    h += 0.85 * sin(wp.x * 0.88 + wp.y * 0.06 - uTime * 0.42);
    h += 0.50 * sin(wp.x * 1.45 + wp.y * 0.10 - uTime * 0.68);
    h += 0.18 * sin(wp.x * 2.70 + wp.y * 0.16 - uTime * 1.05);
    // 交叉浪组: 纵向分量, 打破单向感 → 增强立体感
    h += 0.30 * sin(wp.y * 0.80 - wp.x * 0.05 - uTime * 0.35);
    h += 0.16 * sin(wp.y * 1.60 + wp.x * 0.08 - uTime * 0.58);

    // 节拍脉冲
    float beat  = 0.5 + 0.5 * sin(uTime * 0.70);
    float front = wp.x * 0.55 + wp.y * 0.14;
    float pulse = pow(0.5 + 0.5 * sin(front * 1.8 - uTime * 0.80), 5.0);
    h += pulse * (0.65 + 0.45 * beat);

    return h;
  }

  // ── 总高度 = 涟漪 (来自模拟) + 环境波浪 ──
  float totalHeight(vec2 uv) {
    float ripple = texture2D(uRipples, uv).r;
    float ambient = ambientHeight(uv);
    float motionScale = 1.0 - uReducedMotion * 0.85;
    return ripple * 2.0 * motionScale + ambient;
  }

  void main() {
    vec2 uv = vUv;
    float hc = totalHeight(uv);

    // 屏幕空间导数求法线 — 同时捕获涟漪和环境波浪的斜率
    float bump = 0.42;
    vec2 dH = vec2(dFdx(hc) * uResolution.x, dFdy(hc) * uResolution.y);
    vec3 N = normalize(vec3(-dH * bump, 1.0));

    // 主光: 右上前
    vec3 L  = normalize(vec3(0.30, 0.52, 0.80));
    vec3 V  = vec3(0.0, 0.0, 1.0);
    vec3 Hf = normalize(L + V);
    float ndl = clamp(dot(N, L), 0.0, 1.0);
    float ndh = clamp(dot(N, Hf), 0.0, 1.0);
    float spec  = pow(ndh, 64.0);
    float sheen = pow(ndh, 12.0) * 0.22;

    // 补光: 左下, 提亮暗谷
    vec3 L2 = normalize(vec3(-0.45, -0.25, 0.55));
    float fill = 0.15 * max(dot(N, L2), 0.0);
    // 边缘补光: 增强曲面立体感
    vec3 L3 = normalize(vec3(0.0, 0.6, 0.8));
    float rim = 0.08 * max(dot(N, L3), 0.0);

    // 菲涅尔边缘
    float fres = pow(1.0 - clamp(N.z, 0.0, 1.0), 3.5);

    // 高度色阶: 深谷 → 水体 → 波峰
    float n = clamp(hc * 0.14 + 0.5, 0.0, 1.0);
    vec3 deep   = vec3(0.006, 0.008, 0.014);
    vec3 body   = vec3(0.30, 0.26, 0.22);
    vec3 crestC = vec3(0.85, 0.80, 0.72);
    vec3 base = mix(deep, body, smoothstep(0.0, 0.58, n));
    base = mix(base, crestC, smoothstep(0.50, 1.0, n));
    // 冷色次表面散射 (水深感)
    base = mix(base, base * vec3(0.72, 0.85, 1.10), (1.0 - n) * 0.45);

    // 合成
    vec3 col = base * (0.25 + 0.75 * ndl);
    col += base * fill;
    col += base * rim;
    col += spec * vec3(0.98, 0.95, 0.88) * 0.55;
    col += sheen * vec3(0.90, 0.88, 0.85) * 0.40;
    col += fres * vec3(0.35, 0.42, 0.55) * 0.22;
    col *= (1.0 - 0.22 * length(uv - 0.5)); // 晕影

    // 节拍呼吸
    float bass = 0.5 + 0.5 * sin(uTime * 0.70);
    col *= (0.48 + 0.32 * bass);

    // 主淡入
    vec3 bg = vec3(0.004, 0.005, 0.009);
    col = mix(bg, col, clamp(uIntro, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`

// ════════════════════════════════════════════════════════════════════
//  Three.js 初始化
// ════════════════════════════════════════════════════════════════════

function createRenderTarget(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  })
  rt.texture.generateMipmaps = false
  return rt
}

function initThree(): boolean {
  const canvas = canvasEl.value
  const root = rootEl.value
  if (!canvas || !root) return false

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
  } catch {
    return false
  }

  const w = root.clientWidth || window.innerWidth
  const h = root.clientHeight || window.innerHeight

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
  renderer.setClearColor(0x020204, 1)
  renderer.autoClear = false

  // ── Display pass ──
  displayScene = new THREE.Scene()
  displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // ── Simulation pass ──
  simScene = new THREE.Scene()
  simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // Ping-pong render targets
  rtA = createRenderTarget()
  rtB = createRenderTarget()

  // Simulation material
  const simTexel = 1.0 / SIM_SIZE
  simMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: simFragmentShader,
    uniforms: {
      uPrev: { value: rtA.texture },
      uTexel: { value: new THREE.Vector2(simTexel, simTexel) },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uMouseVel: { value: new THREE.Vector2(0, 0) },
      uMouseStrength: { value: 0 },
      uDamping: { value: 0.988 },
      uReducedMotion: { value: reduced ? 1.0 : 0.0 },
    },
    depthTest: false,
    depthWrite: false,
  })

  const simGeom = new THREE.PlaneGeometry(2, 2)
  simMesh = new THREE.Mesh(simGeom, simMaterial)
  simScene.add(simMesh)

  // Display material
  displayMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: displayFragmentShader,
    uniforms: {
      uRipples: { value: rtB.texture },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(w, h) },
      uIntro: { value: 0 },
      uReducedMotion: { value: reduced ? 1.0 : 0.0 },
    },
    depthTest: false,
    depthWrite: false,
  })

  const displayGeom = new THREE.PlaneGeometry(2, 2)
  displayMesh = new THREE.Mesh(displayGeom, displayMaterial)
  displayScene.add(displayMesh)

  return true
}

// ════════════════════════════════════════════════════════════════════
//  渲染循环
// ════════════════════════════════════════════════════════════════════

let prevT = 0
function tick() {
  if (disposed || !renderer || !displayScene || !displayCamera ||
      !simScene || !simCamera || !simMaterial || !displayMaterial ||
      !rtA || !rtB || !clock) return

  const t = clock.getElapsedTime()
  prevT = t

  // ── 更新鼠标速度与强度 ──
  const dx = mouseUV.x - mousePrevUV.x
  const dy = mouseUV.y - mousePrevUV.y
  const speed = Math.sqrt(dx * dx + dy * dy)
  // 平滑强度: 鼠标移动时上升, 静止时衰减
  const targetStrength = mouseActive ? Math.min(speed * 50, 1.0) : 0
  mouseStrength += (targetStrength - mouseStrength) * 0.3
  // 平滑速度向量 (用于着色器, 未来可扩展方向性扰动)
  mouseVel.x += (dx - mouseVel.x) * 0.4
  mouseVel.y += (dy - mouseVel.y) * 0.4
  mousePrevUV.x = mouseUV.x
  mousePrevUV.y = mouseUV.y

  // ── Pass 1: 波模拟 (ping-pong) ──
  // 从 rtA 读取, 写入 rtB
  ;(simMaterial.uniforms.uPrev.value as THREE.Texture) = rtA.texture
  ;(simMaterial.uniforms.uMouse.value as THREE.Vector2).set(mouseUV.x, mouseUV.y)
  ;(simMaterial.uniforms.uMouseVel.value as THREE.Vector2).set(mouseVel.x, mouseVel.y)
  simMaterial.uniforms.uMouseStrength.value = mouseStrength

  renderer.setRenderTarget(rtB)
  renderer.clear()
  renderer.render(simScene, simCamera)
  renderer.setRenderTarget(null)

  // 交换: 下一帧从 rtB 读取, 写入 rtA
  const tmp = rtA
  rtA = rtB
  rtB = tmp

  // ── Pass 2: 显示 ──
  ;(displayMaterial.uniforms.uRipples.value as THREE.Texture) = rtA.texture
  displayMaterial.uniforms.uTime.value = t
  displayMaterial.uniforms.uIntro.value = smooth01((t - 0.05) / (0.7 * tScale))

  renderer.clear()
  renderer.render(displayScene, displayCamera)

  rafId = requestAnimationFrame(tick)
}

// ── 拆分文字为逐字符 span ──
function splitText(): HTMLSpanElement[] {
  const el = textEl.value
  if (!el) return []
  const source = el.textContent || ''
  el.textContent = ''
  const spans: HTMLSpanElement[] = []
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const span = document.createElement('span')
    span.className = 'splash-char' + (ch === ' ' ? ' splash-char-space' : '')
    span.textContent = ch === ' ' ? '\u00A0' : ch
    el.appendChild(span)
    spans.push(span)
  }
  return spans
}

// ── 淡出并销毁 ──
let dismissing = false
function dismiss() {
  if (dismissing || disposed) return
  dismissing = true

  const corners = [cTL.value, cTR.value, cBL.value, cBR.value].filter(Boolean) as HTMLElement[]
  const tlOut = gsap.timeline({
    onComplete: () => {
      emit('done')
    },
  })

  if (hintEl.value) {
    tlOut.to(hintEl.value, {
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in',
    }, 0)
  }

  tlOut.to(corners, {
    opacity: 0,
    duration: 0.4,
    ease: 'power2.in',
  }, 0)

  const fadeTargets = [iconEl.value, ...charSpans].filter((el): el is HTMLElement => !!el)
  if (fadeTargets.length) {
    tlOut.to(fadeTargets, {
      opacity: 0,
      y: '-=14',
      duration: 0.5,
      stagger: 0.012,
      ease: 'power2.in',
    }, 0.1)
  }

  if (glowEl.value) {
    tlOut.to(glowEl.value, {
      opacity: 0,
      duration: 0.5,
      ease: 'power2.in',
    }, 0.1)
  }

  if (displayMaterial) {
    tlOut.to(displayMaterial.uniforms.uIntro, {
      value: 0,
      duration: 0.6,
      ease: 'power2.inOut',
    }, 0.15)
  }

  if (rootEl.value) {
    tlOut.to(rootEl.value, {
      opacity: 0,
      duration: 0.4,
      ease: 'power1.in',
      onComplete: () => {
        cleanup()
      },
    }, 0.4)
  } else {
    cleanup()
  }
}

// ── 清理资源 ──
function cleanup() {
  if (disposed) return
  disposed = true

  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }

  idleTweens.forEach(tw => tw.kill())
  idleTweens = []
  if (introTimeline) {
    introTimeline.kill()
    introTimeline = null
  }

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  if (mouseMoveHandler) {
    window.removeEventListener('mousemove', mouseMoveHandler)
    mouseMoveHandler = null
  }
  if (touchHandler) {
    window.removeEventListener('touchmove', touchHandler)
    touchHandler = null
  }

  if (simMesh) {
    simMesh.geometry.dispose()
    simMesh = null
  }
  if (simMaterial) {
    simMaterial.dispose()
    simMaterial = null
  }
  if (displayMesh) {
    displayMesh.geometry.dispose()
    displayMesh = null
  }
  if (displayMaterial) {
    displayMaterial.dispose()
    displayMaterial = null
  }
  if (rtA) {
    rtA.dispose()
    rtA = null
  }
  if (rtB) {
    rtB.dispose()
    rtB = null
  }
  if (renderer) {
    renderer.dispose()
    renderer = null
  }
  displayScene = null
  displayCamera = null
  simScene = null
  simCamera = null
  clock = null
}

// ── 生命周期 ──
onMounted(() => {
  const root = rootEl.value
  if (!root) return

  const threeOk = initThree()

  // 拆分文字
  charSpans = splitText()

  const corners = [cTL.value, cTR.value, cBL.value, cBR.value].filter(Boolean) as HTMLElement[]

  // ── 事件监听 ──
  resizeHandler = () => {
    if (!renderer || !displayMaterial || !rootEl.value) return
    const w = rootEl.value.clientWidth || window.innerWidth
    const h = rootEl.value.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    ;(displayMaterial.uniforms.uResolution.value as THREE.Vector2).set(w, h)
  }
  window.addEventListener('resize', resizeHandler)

  mouseMoveHandler = (e: MouseEvent) => {
    // 更新鼠标 UV (模拟纹理空间 0..1, Y 翻转)
    mouseUV.x = e.clientX / window.innerWidth
    mouseUV.y = 1.0 - e.clientY / window.innerHeight
    mouseActive = true

    // DOM 视差 (normalized -1..1)
    mouseTarget.x = (e.clientX / window.innerWidth - 0.5) * 2
    mouseTarget.y = -(e.clientY / window.innerHeight - 0.5) * 2
    const x = mouseTarget.x
    const y = mouseTarget.y
    if (logoEl.value) gsap.to(logoEl.value, { x: x * -5, duration: 0.7, ease: 'power3.out', overwrite: 'auto' })
    if (iconEl.value) gsap.to(iconEl.value, { x: x * -14, y: y * -9, duration: 0.55, ease: 'power3.out', overwrite: 'auto' })
    if (textEl.value) gsap.to(textEl.value, { x: x * -7, y: y * -3.5, duration: 0.85, ease: 'power3.out', overwrite: 'auto' })
    if (glowEl.value) gsap.to(glowEl.value, { x: x * -6, y: y * -4, duration: 0.8, ease: 'power3.out', overwrite: 'auto' })
  }
  window.addEventListener('mousemove', mouseMoveHandler)

  touchHandler = (e: TouchEvent) => {
    if (!e.touches || !e.touches[0]) return
    const t = e.touches[0]
    mouseUV.x = t.clientX / window.innerWidth
    mouseUV.y = 1.0 - t.clientY / window.innerHeight
    mouseActive = true
  }
  window.addEventListener('touchmove', touchHandler, { passive: true })

  // ── 启动渲染循环 ──
  if (threeOk) {
    clock = new THREE.Clock()
    prevT = 0
    tick()
  } else {
    if (root) root.style.background = '#020204'
  }

  // ── GSAP Logo 揭示时间线 ──
  introTimeline = gsap.timeline()

  if (glowEl.value) {
    introTimeline.fromTo(glowEl.value,
      { opacity: 0, scale: 0.6 },
      { opacity: 1, scale: 1, duration: 1.2 * tScale, ease: 'power2.out' },
      0.4
    )
  }

  if (iconEl.value) {
    introTimeline.fromTo(iconEl.value,
      { opacity: 0, scale: 0.55, x: -30, y: 12 },
      { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.95 * tScale, ease: 'expo.out' },
      1.5
    )
  }

  introTimeline.to(charSpans,
    { opacity: 1, y: 0, duration: 0.7 * tScale, stagger: 0.045 * tScale, ease: 'expo.out' },
    1.8
  )

  introTimeline.to(corners,
    { opacity: 0.65, duration: 0.8 * tScale, stagger: 0.06 * tScale, ease: 'power2.out' },
    2.8
  )

  if (hintEl.value) {
    introTimeline.to(hintEl.value,
      { opacity: 0.5, duration: 0.6 * tScale, ease: 'power2.out' },
      3.2
    )
  }

  // ── 闲置循环 ──
  const idleStart = 4.2

  if (iconEl.value) {
    idleTweens.push(gsap.to(iconEl.value, {
      scale: 1.02,
      duration: 6,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: idleStart,
    }))
  }

  if (logoEl.value) {
    idleTweens.push(gsap.to(logoEl.value, {
      y: '+=2.5',
      duration: 5.5,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: idleStart + 0.4,
    }))
  }

  if (glowEl.value) {
    idleTweens.push(gsap.to(glowEl.value, {
      opacity: 0.7,
      duration: 4.5,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: idleStart + 0.2,
    }))
  }

  idleTweens.push(gsap.to(corners, {
    opacity: 0.32,
    duration: 7,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
    delay: idleStart + 0.2,
  }))

  // ── 等待用户点击进入 (不自动消失) ──
})

onUnmounted(() => {
  cleanup()
})
</script>

<style scoped lang="scss">
.splash-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  overflow: hidden;
  background: #020204;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.splash-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  display: block;
}

// ── 四角装饰线 ──
.splash-corner {
  position: absolute;
  z-index: 3;
  width: 10px;
  height: 10px;
  border-color: rgba(245, 240, 232, 0.14);
  border-style: solid;
  border-width: 0;
  opacity: 0;
  will-change: opacity;
}
.corner-tl { top: 26px; left: 26px; border-top-width: 1px; border-left-width: 1px; }
.corner-tr { top: 26px; right: 26px; border-top-width: 1px; border-right-width: 1px; }
.corner-bl { bottom: 26px; left: 26px; border-bottom-width: 1px; border-left-width: 1px; }
.corner-br { bottom: 26px; right: 26px; border-bottom-width: 1px; border-right-width: 1px; }

// ── Logo 层 ──
.splash-logo {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 18px;
  will-change: transform;
  transform: translate3d(0, 0, 0);
}

// 柔光背板 — 在水面之上为 Logo 提供可读性
.splash-glow {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 520px;
  height: 220px;
  transform: translate(-50%, -50%);
  background: radial-gradient(
    ellipse at center,
    rgba(3, 3, 6, 0.80) 0%,
    rgba(3, 3, 6, 0.50) 35%,
    rgba(3, 3, 6, 0.0) 70%
  );
  border-radius: 50%;
  z-index: -1;
  opacity: 0;
  will-change: opacity, transform;
  pointer-events: none;
}

// 图标方块 — 暖色金属质感
.splash-icon {
  width: 58px;
  height: 58px;
  border-radius: 14px;
  background: linear-gradient(
    155deg,
    #f8f2ea 0%,
    #ece2cf 50%,
    #c8bca0 100%
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18),
    inset 1px 0 0 rgba(255, 255, 255, 0.18),
    0 6px 18px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  will-change: transform, opacity;
  flex-shrink: 0;
}

.splash-icon-svg {
  width: 36px;
  height: 36px;
  opacity: 0.9;
}

// 文字
.splash-text {
  font-family: 'Quicksand', sans-serif;
  font-weight: 700;
  font-size: 64px;
  letter-spacing: -0.05em;
  color: #f5f0e8;
  line-height: 1;
  display: flex;
  will-change: transform;
  white-space: nowrap;
}

.splash-char {
  display: inline-block;
  opacity: 0;
  transform: translate3d(0, 0.42em, 0);
  will-change: transform, opacity;
}

.splash-char-space {
  width: 0.32em;
}

// 跳过提示
.splash-hint {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 400;
  color: rgba(245, 240, 232, 0.38);
  letter-spacing: 0.04em;
  opacity: 0;
  will-change: opacity;
  pointer-events: none;
  user-select: none;
}

// ── 减弱动效 ──
@media (prefers-reduced-motion: reduce) {
  .splash-icon-svg {
    animation: none !important;
  }
}
</style>
