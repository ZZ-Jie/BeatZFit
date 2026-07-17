/**
 * 音频律动粒子可视化器
 *
 * 基于教程 3d_Design/01_Creating-Audio-Reactive-Visuals-with-Dynamic-Particles-in-Three-js.md 实现。
 * 使用 Box(1,1,1) 或 Cylinder(r=1,h=4) 几何体，通过 curl noise + z-wave 着色器
 * 驱动粒子运动，4 频段音频分析经 AudioAnimationController 弹簧阻尼平滑后映射到:
 *   高频 → 粒子振幅, 中低频 → 偏移增益, 低频 → 时间速度, burst → 节拍重置+旋转
 *
 * 性能优化:
 * - frustumCulled = false (粒子位移超出包围球)
 * - 早期 discard 丢弃透明像素
 * - time 变量取模防止 float 精度溢出
 * - gsap.killTweensOf 防止内存泄漏
 * - 移除 material.needsUpdate 避免着色器重编译卡顿
 */

import * as THREE from 'three'
import gsap from 'gsap'
import type { AudioSpectrumData } from './audioAnalyzer'
import { AudioAnimationController } from './audioAnimationLayer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AudioReactiveShape = 'box' | 'cylinder'

export interface AudioReactiveTransform {
  rotationX: number
  rotationY: number
  scale: number
}

interface ReactiveParticleOptions {
  quality: 'high' | 'medium' | 'low'
  shape: AudioReactiveShape
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SCALE = 0.6
const MAX_SCALE = 3.0
const ROTATION_SENSITIVITY = 0.005
const ZOOM_SENSITIVITY = 0.0015
const MAX_PITCH = 1.2

// Minimum time between shape resets (ms). The reference uses BPM-synced
// intervals; we approximate with a fixed cooldown since we don't have a
// BPM manager.
const RESET_COOLDOWN_MS = 5000

// RGB threshold for dark-pixel visibility boost (cover color sampling)
const DARK_PIXEL_THRESHOLD = 30

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class AudioReactiveParticlesVisualizer {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private renderer: THREE.WebGLRenderer
  private options: ReactiveParticleOptions

  // Three.js objects (matching reference structure: holder → objectsHolder → pointsMesh)
  private holder: THREE.Group
  private objectsHolder: THREE.Group | null = null
  private pointsMesh: THREE.Object3D | null = null
  private geometry: THREE.BufferGeometry | null = null
  private material: THREE.ShaderMaterial | null = null

  // Audio-reactive state (matches reference)
  private time = 0
  private clock = new THREE.Clock()
  private isPlaying = false
  private currentShape: AudioReactiveShape
  // Base frequency animated by gsap on resetMesh (matching reference: 0.5–3 range).
  // Per-frame audio modulation is NOT added on top — the reference animates
  // frequency purely via gsap, and we follow that approach.
  private baseFrequency = 2

  // Timestamp of last shape reset for cooldown enforcement
  private lastResetTime = 0

  /** 4-band audio controller (project-specific, provides spring-damped values) */
  private animController: AudioAnimationController

  // Cover colors (5-stop gradient, sampled from cover image)
  private coverColors: THREE.Color[] = []

  // Interaction state
  private currentTransform: AudioReactiveTransform
  private targetTransform: AudioReactiveTransform
  private isDragging = false
  private lastPointerX = 0
  private lastPointerY = 0
  private interactionContainer: HTMLElement | null = null
  private onTransformChange: ((t: AudioReactiveTransform) => void) | null = null

  // Bound handlers
  private boundPointerDown = this.onPointerDown.bind(this)
  private boundPointerMove = this.onPointerMove.bind(this)
  private boundPointerUp = this.onPointerUp.bind(this)
  private boundWheel = this.onWheel.bind(this)
  private boundTouchStart = this.onTouchStart.bind(this)
  private boundTouchMove = this.onTouchMove.bind(this)
  private boundTouchEnd = this.onTouchEnd.bind(this)

  // Touch state
  private touchStartDist = 0
  private touchStartScale = 1

  // Shader uniforms (reference defaults, extended with 5-color + pixelRatio + opacity)
  private uniforms: {
    time: { value: number }
    offsetSize: { value: number }
    size: { value: number }
    frequency: { value: number }
    amplitude: { value: number }
    offsetGain: { value: number }
    maxDistance: { value: number }
    colorStop0: { value: THREE.Color }
    colorStop1: { value: THREE.Color }
    colorStop2: { value: THREE.Color }
    colorStop3: { value: THREE.Color }
    colorStop4: { value: THREE.Color }
    uPixelRatio: { value: number }
    uOpacity: { value: number }
  }

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options: ReactiveParticleOptions
  ) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.options = options
    this.currentShape = options.shape

    this.currentTransform = { rotationX: 0, rotationY: 0, scale: 1 }
    this.targetTransform = { rotationX: 0, rotationY: 0, scale: 1 }

    // Default cover colors (neutral gradient)
    this.coverColors = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xcccccc),
      new THREE.Color(0x888888),
      new THREE.Color(0x444444),
      new THREE.Color(0x222222),
    ]

    // Uniforms — matching reference defaults exactly:
    //   offsetSize=2, size=1.1, frequency=2, amplitude=1, offsetGain=0, maxDistance=1.8
    this.uniforms = {
      time: { value: 0 },
      offsetSize: { value: 2 },
      size: { value: 1.1 },
      frequency: { value: 2 },
      amplitude: { value: 1 },
      offsetGain: { value: 0 },
      maxDistance: { value: 1.8 },
      colorStop0: { value: this.coverColors[0].clone() },
      colorStop1: { value: this.coverColors[1].clone() },
      colorStop2: { value: this.coverColors[2].clone() },
      colorStop3: { value: this.coverColors[3].clone() },
      colorStop4: { value: this.coverColors[4].clone() },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uOpacity: { value: 1 },
    }

    // holder — added directly to scene (matching reference: App.holder)
    this.holder = new THREE.Group()
    this.holder.name = 'audioReactiveHolder'
    this.scene.add(this.holder)

    this.animController = new AudioAnimationController()

    // Create initial mesh
    this.createMesh(this.currentShape)
  }

  // ---------------------------------------------------------------------------
  // Mesh creation (matching reference geometry formulas exactly)
  // ---------------------------------------------------------------------------

  private createMesh(shape: AudioReactiveShape): void {
    // objectsHolder — child of holder, holds the points mesh (matching reference)
    this.objectsHolder = new THREE.Group()
    this.holder.add(this.objectsHolder)

    // Create material once
    if (!this.material) {
      this.material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
        transparent: true,
        uniforms: this.uniforms,
      })
    }

    if (shape === 'box') {
      this.createBoxMesh()
    } else {
      this.createCylinderMesh()
    }
  }

  private createBoxMesh(): void {
    // Reference: BoxGeometry(1, 1, 1, widthSeg, heightSeg, depthSeg)
    // with random segments for unique structure each time.
    const widthSeg = Math.floor(THREE.MathUtils.randInt(5, 20))
    const heightSeg = Math.floor(THREE.MathUtils.randInt(1, 40))
    const depthSeg = Math.floor(THREE.MathUtils.randInt(5, 80))
    this.geometry = new THREE.BoxGeometry(1, 1, 1, widthSeg, heightSeg, depthSeg)

    // Reference: offsetSize = randInt(30, 60)
    this.uniforms.offsetSize.value = Math.floor(THREE.MathUtils.randInt(30, 60))
    this.uniforms.size.value = 1.1
    this.uniforms.maxDistance.value = 1.8
    this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
    // NOTE: needsUpdate is intentionally NOT set. The shader source never
    // changes between box/cylinder — only uniform values differ. Setting
    // needsUpdate=true forces a full GLSL recompilation (50-200ms stutter)
    // on every beat-triggered reset, which is the single biggest source of
    // jank in this preset.

    // Reference: pointsMesh is an Object3D container, rotated X=π/2
    this.pointsMesh = new THREE.Object3D()
    this.pointsMesh.rotateX(Math.PI / 2)
    this.objectsHolder!.add(this.pointsMesh)

    const points = new THREE.Points(this.geometry, this.material!)
    // The vertex shader displaces particles far beyond the geometry's
    // bounding sphere (curl noise + z-wave). Three.js computes frustum
    // culling from the original bounding sphere, so it can incorrectly
    // cull visible particles. Disabling it is both a correctness fix and
    // saves per-frame bounding-sphere checks.
    points.frustumCulled = false
    this.pointsMesh.add(points)

    // Reference: gsap rotation animation on the container
    gsap.to(this.pointsMesh.rotation, {
      duration: 3,
      x: Math.random() * Math.PI,
      z: Math.random() * Math.PI * 2,
      ease: 'none',
    })

    // Position: camera is at z=11.5. Both geometries pushed well forward
    // (closer to camera) to make particles appear larger on screen.
    // Box at z≈8-10 (distance ≈1.5-3.5).
    gsap.to(this.holder.position, {
      duration: 0.6,
      z: THREE.MathUtils.randFloat(8, 10),
      ease: 'elastic.out(0.8)',
    })
  }

  private createCylinderMesh(): void {
    // Reference: CylinderGeometry(1, 1, 4, 64*radialSeg, 64*heightSeg, true)
    // The cylinder is inherently larger than the box (h=4 vs box side=1).
    // Rather than shrinking the geometry (which changes curl-noise density
    // and can make particles look sparse), push the cylinder further from
    // the camera so its apparent screen size matches the box more closely.
    const radialSeg = Math.floor(THREE.MathUtils.randInt(1, 3))
    const heightSeg = Math.floor(THREE.MathUtils.randInt(1, 5))
    this.geometry = new THREE.CylinderGeometry(1, 1, 4, 64 * radialSeg, 64 * heightSeg, true)

    // Reference: offsetSize = randInt(30, 60), size = 2
    this.uniforms.offsetSize.value = Math.floor(THREE.MathUtils.randInt(30, 60))
    this.uniforms.size.value = 2
    this.uniforms.maxDistance.value = 1.8
    this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
    // NOTE: needsUpdate intentionally omitted (see createBoxMesh for rationale).

    // Reference: pointsMesh is a Points object with rotation (π/2, 0, 0)
    this.pointsMesh = new THREE.Points(this.geometry, this.material!)
    this.pointsMesh.rotation.set(Math.PI / 2, 0, 0)
    // Disable frustum culling — vertex shader displaces beyond bounding sphere.
    this.pointsMesh.frustumCulled = false
    this.objectsHolder!.add(this.pointsMesh)

    // Push cylinder ~2.25 units further from camera than box to compensate
    // for its 4× larger geometry. Box sits at z≈8-10 (distance ≈1.5-3.5);
    // cylinder at z≈5.75-7.75 (distance ≈3.75-5.75).
    let rotY = 0
    let posZ = THREE.MathUtils.randFloat(5.75, 7.75)
    if (Math.random() < 0.2) {
      rotY = Math.PI / 2
      posZ = THREE.MathUtils.randFloat(5.25, 7.25)
    }
    gsap.to(this.objectsHolder!.rotation, {
      duration: 0.2,
      y: rotY,
      ease: 'elastic.out(0.2)',
    })
    gsap.to(this.holder.position, {
      duration: 0.6,
      z: posZ,
      ease: 'elastic.out(0.8)',
    })
  }

  private destroyMesh(): void {
    if (this.pointsMesh) {
      // Kill any gsap tweens targeting the old mesh before disposing,
      // so orphaned tweens don't try to update null/disposed objects.
      gsap.killTweensOf(this.pointsMesh.rotation)
      this.objectsHolder?.remove(this.pointsMesh)
      // For box: pointsMesh is an Object3D container, geometry is on the child Points
      // For cylinder: pointsMesh IS the Points, geometry is on it
      if (this.pointsMesh instanceof THREE.Points) {
        this.pointsMesh.geometry?.dispose()
      } else {
        // Object3D container — dispose child Points geometry
        this.pointsMesh.children.forEach(child => {
          if (child instanceof THREE.Points) child.geometry?.dispose()
        })
      }
      this.pointsMesh = null
    }
    this.geometry?.dispose()
    this.geometry = null
    // CRITICAL: remove the old objectsHolder from holder to prevent scene-graph
    // leakage. Without this, every resetMesh() leaves an empty Group in holder,
    // and over long playback hundreds of empty groups accumulate — each one is
    // traversed every frame by the renderer, causing progressive slowdown.
    if (this.objectsHolder) {
      this.holder.remove(this.objectsHolder)
      this.objectsHolder = null
    }
  }

  /**
   * Reset mesh — matching reference: destroy → random shape → create.
   * The reference doesn't animate scale on reset; it just swaps. We follow
   * that approach for simplicity and to avoid the "explosion" effect that
   * scale animations caused in previous iterations.
   *
   * Also animates frequency via gsap (matching reference: 0.5–3 range).
   */
  private resetMesh(): void {
    // Kill gsap tweens on the old mesh before destroying it, to prevent
    // orphaned tween references from updating disposed objects.
    if (this.pointsMesh) gsap.killTweensOf(this.pointsMesh.rotation)
    if (this.objectsHolder) gsap.killTweensOf(this.objectsHolder.rotation)
    gsap.killTweensOf(this.holder.position)
    gsap.killTweensOf(this, 'baseFrequency')

    this.destroyMesh()

    const shape: AudioReactiveShape = Math.random() < 0.5 ? 'cylinder' : 'box'
    this.currentShape = shape
    this.createMesh(shape)

    // Reference: gsap.to(frequency, { value: randFloat(0.5, 3), duration: 2, ease: 'expo.inOut' })
    gsap.to(this, {
      duration: 2,
      baseFrequency: THREE.MathUtils.randFloat(0.5, 3),
      ease: 'expo.inOut',
    })
  }

  // ---------------------------------------------------------------------------
  // Audio update — adapted from reference's exact formulas to 4-band analysis
  // ---------------------------------------------------------------------------

  update(data: AudioSpectrumData): void {
    const dt = Math.min(this.clock.getDelta(), 0.1)

    // Update 4-band audio controller
    this.animController.update(data, dt, this.camera)

    // ── Reference audio mapping (adapted to 4-band) ──
    // Reference:
    //   amplitude = 0.8 + mapLinear(high, 0, 0.6, -0.1, 0.2)  → [0.7, 1.0]
    //   offsetGain = mid * 0.6
    //   time += clamp(mapLinear(low, 0.6, 1, 0.2, 0.5), 0.2, 0.5)
    //   frequency = baseFrequency (animated by gsap on reset)
    //
    // 4-band adaptation:
    //   highFreq (2000Hz+)  → amplitude  (same as reference's "high")
    //   (midLowFreq + midHighFreq) / 2  → offsetGain  (approximates reference's "mid")
    //   lowFreq (20-250Hz)  → time speed  (same as reference's "low")
    //
    // Inlined THREE.MathUtils calls to avoid per-frame function-call overhead.
    // mapLinear(x, a, b, c, d) = c + (d - c) * (x - a) / (b - a)
    if (this.isPlaying && !this.animController.isStandby) {
      const highFreq = this.animController.highFreq
      const midLowFreq = this.animController.midLowFreq
      const midHighFreq = this.animController.midHighFreq
      const lowFreq = this.animController.lowFreq

      // Amplitude: high freq drives subtle pulsing [0.7, 1.0]
      // mapLinear(highFreq, 0, 0.6, -0.1, 0.2) → 0.8 + result
      this.uniforms.amplitude.value = 0.8 + (-0.1 + 0.3 * highFreq / 0.6)

      // Offset gain: mid frequencies drive z-axis wave motion
      this.uniforms.offsetGain.value = (midLowFreq + midHighFreq) * 0.3

      // Time speed: low freq drives curl noise evolution speed
      // mapLinear(lowFreq, 0.6, 1, 0.2, 0.5) = 0.2 + 0.3 * (lowFreq - 0.6) / 0.4
      let t = 0.2 + 0.3 * (lowFreq - 0.6) / 0.4
      if (t < 0.2) t = 0.2
      else if (t > 0.5) t = 0.5
      this.time += t
      // Wrap time to prevent float precision degradation in the curl noise
      // function after hours of playback. The noise uses floor()/fract() which
      // lose precision with large values. 100000 is well beyond any perceptible
      // cycle length (at 0.5/frame * 60fps = 30/sec, this is ~55 minutes).
      if (this.time > 100000) this.time -= 100000

      // Frequency: gsap-animated baseFrequency only (matching reference)
      this.uniforms.frequency.value = this.baseFrequency
    } else {
      // Standby (matching reference defaults)
      this.uniforms.frequency.value = 0.8
      this.uniforms.amplitude.value = 1
      this.uniforms.offsetGain.value = 0
      this.time += 0.2
    }

    this.uniforms.time.value = this.time

    // ── Scale: user zoom only (no audio-driven scale — matching reference) ──
    this.holder.scale.setScalar(this.currentTransform.scale)

    // ── Beat response (matching reference's onBPMBeat) ──
    // Reference: 30% resetMesh, 30% rotate on beat
    // Short-circuit the cheap checks before calling performance.now().
    if (
      this.isPlaying &&
      !this.animController.isStandby &&
      data.beatStrength > 0.5
    ) {
      const now = performance.now()
      if (now - this.lastResetTime > RESET_COOLDOWN_MS) {
        // 30% chance to rotate the holder (matching reference's autoRotate)
        if (Math.random() < 0.3) {
          gsap.to(this.objectsHolder!.rotation, {
            duration: 15,
            z: Math.random() * Math.PI,
            ease: 'elastic.out(0.2)',
            overwrite: true,
          })
        }
        // 30% chance to reset mesh (matching reference's resetMesh)
        if (Math.random() < 0.3) {
          this.resetMesh()
          this.lastResetTime = now
        }
      }
    }

    // ── Transform interpolation (damped lerp) ──
    const k = 1 - Math.pow(0.001, dt)
    this.currentTransform.rotationX = lerp(this.currentTransform.rotationX, this.targetTransform.rotationX, k)
    this.currentTransform.rotationY = lerp(this.currentTransform.rotationY, this.targetTransform.rotationY, k)
    this.currentTransform.scale = lerp(this.currentTransform.scale, this.targetTransform.scale, k)

    this.holder.rotation.x = this.currentTransform.rotationX
    this.holder.rotation.y = this.currentTransform.rotationY
  }

  // ---------------------------------------------------------------------------
  // Cover color sampling (project-specific, unchanged)
  // ---------------------------------------------------------------------------

  async loadCover(url: string): Promise<boolean> {
    if (!url) {
      this.updateCoverColors([
        new THREE.Color(0xffffff),
        new THREE.Color(0xcccccc),
        new THREE.Color(0x888888),
        new THREE.Color(0x444444),
        new THREE.Color(0x222222),
      ])
      return true
    }

    try {
      const colors = await this.sampleCoverColors(url)
      if (colors.length === 5) {
        this.updateCoverColors(colors)
        return true
      }
      return false
    } catch (e) {
      console.warn('[audioReactiveParticles] Failed to apply cover colors:', e)
      return false
    }
  }

  private async sampleCoverColors(url: string): Promise<THREE.Color[]> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          const size = 48
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Failed to get canvas context'))
            return
          }
          ctx.drawImage(img, 0, 0, size, size)
          const imageData = ctx.getImageData(0, 0, size, size).data
          const colors = this.extractVibrantColors(imageData, size, 5)
          resolve(colors)
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('Failed to load cover image'))
      img.src = url
    })
  }

  private extractVibrantColors(imageData: Uint8ClampedArray, size: number, count: number): THREE.Color[] {
    const pixels: Array<[number, number, number]> = []
    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i]
      const g = imageData[i + 1]
      const b = imageData[i + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const l = (max + min) / 2 / 255
      const s = max === 0 ? 0 : (max - min) / max
      if (l > 0.15 && l < 0.9 && s > 0.2) {
        pixels.push([r, g, b])
      }
    }
    if (pixels.length < count * 10) {
      for (let i = 0; i < imageData.length; i += 4) {
        pixels.push([imageData[i], imageData[i + 1], imageData[i + 2]])
      }
    }
    const clusters = this.kMeansClustering(pixels, count)
    let darkAllowance = 1
    const processed: Array<[number, number, number]> = clusters.map(([r, g, b]) => {
      const isDark = r < DARK_PIXEL_THRESHOLD && g < DARK_PIXEL_THRESHOLD && b < DARK_PIXEL_THRESHOLD
      if (isDark && darkAllowance > 0) {
        darkAllowance--
        return [Math.max(r, 25), Math.max(g, 25), Math.max(b, 25)]
      }
      return this.boostColor(r, g, b)
    })
    processed.sort((a, b) => {
      const hueA = this.rgbToHue(a[0], a[1], a[2])
      const hueB = this.rgbToHue(b[0], b[1], b[2])
      return hueA - hueB
    })
    return processed.map(([r, g, b]) => new THREE.Color(r / 255, g / 255, b / 255))
  }

  private kMeansClustering(pixels: Array<[number, number, number]>, k: number): Array<[number, number, number]> {
    if (pixels.length === 0) return Array(k).fill([128, 128, 128])
    const step = Math.floor(pixels.length / k)
    const centroids: Array<[number, number, number]> = []
    for (let i = 0; i < k; i++) {
      const idx = Math.min(i * step, pixels.length - 1)
      centroids.push([...pixels[idx]])
    }
    for (let iter = 0; iter < 10; iter++) {
      const clusters: Array<Array<[number, number, number]>> = Array(k).fill(null).map(() => [])
      for (const pixel of pixels) {
        let minDist = Infinity
        let closest = 0
        for (let c = 0; c < k; c++) {
          const dist = this.colorDistance(pixel, centroids[c])
          if (dist < minDist) { minDist = dist; closest = c }
        }
        clusters[closest].push(pixel)
      }
      let changed = false
      for (let c = 0; c < k; c++) {
        if (clusters[c].length > 0) {
          let rSum = 0, gSum = 0, bSum = 0
          for (const [r, g, b] of clusters[c]) { rSum += r; gSum += g; bSum += b }
          const len = clusters[c].length
          const newR = Math.round(rSum / len)
          const newG = Math.round(gSum / len)
          const newB = Math.round(bSum / len)
          if (centroids[c][0] !== newR || centroids[c][1] !== newG || centroids[c][2] !== newB) {
            centroids[c] = [newR, newG, newB]
            changed = true
          }
        }
      }
      if (!changed) break
    }
    return centroids
  }

  private colorDistance(a: [number, number, number], b: [number, number, number]): number {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
  }

  private rgbToHue(r: number, g: number, b: number): number {
    const rn = r / 255, gn = g / 255, bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const d = max - min
    if (d === 0) return 0
    let h = 0
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
    return h
  }

  private boostColor(r: number, g: number, b: number): [number, number, number] {
    const rn = r / 255, gn = g / 255, bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    const s = max === 0 ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
    const hue = this.rgbToHue(r, g, b)
    const newS = Math.min(Math.max(s * 1.4, 0.35), 1.0)
    let newL: number
    if (l < 0.15) { newL = 0.25 + l * 0.5 } else { newL = Math.min(l * 1.3, 0.85) }
    const c = (1 - Math.abs(2 * newL - 1)) * newS
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
    const m = newL - c / 2
    let r1 = 0, g1 = 0, b1 = 0
    if (hue < 60) { r1 = c; g1 = x; b1 = 0 }
    else if (hue < 120) { r1 = x; g1 = c; b1 = 0 }
    else if (hue < 180) { r1 = 0; g1 = c; b1 = x }
    else if (hue < 240) { r1 = 0; g1 = x; b1 = c }
    else if (hue < 300) { r1 = x; g1 = 0; b1 = c }
    else { r1 = c; g1 = 0; b1 = x }
    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)]
  }

  private updateCoverColors(colors: THREE.Color[]): void {
    this.coverColors = colors
    this.uniforms.colorStop0.value.copy(colors[0])
    this.uniforms.colorStop1.value.copy(colors[1])
    this.uniforms.colorStop2.value.copy(colors[2])
    this.uniforms.colorStop3.value.copy(colors[3])
    this.uniforms.colorStop4.value.copy(colors[4])
  }

  // ---------------------------------------------------------------------------
  // Interaction system
  // ---------------------------------------------------------------------------

  attachInteraction(container: HTMLElement, onChange?: (t: AudioReactiveTransform) => void): void {
    this.interactionContainer = container
    this.onTransformChange = onChange || null
    container.addEventListener('pointerdown', this.boundPointerDown)
    container.addEventListener('wheel', this.boundWheel, { passive: false })
    container.addEventListener('touchstart', this.boundTouchStart, { passive: true })
    document.addEventListener('pointermove', this.boundPointerMove)
    document.addEventListener('pointerup', this.boundPointerUp)
    document.addEventListener('pointercancel', this.boundPointerUp)
    document.addEventListener('touchmove', this.boundTouchMove, { passive: false })
    document.addEventListener('touchend', this.boundTouchEnd)
  }

  detachInteraction(): void {
    if (this.interactionContainer) {
      this.interactionContainer.removeEventListener('pointerdown', this.boundPointerDown)
      this.interactionContainer.removeEventListener('wheel', this.boundWheel)
      this.interactionContainer.removeEventListener('touchstart', this.boundTouchStart)
      this.interactionContainer = null
    }
    document.removeEventListener('pointermove', this.boundPointerMove)
    document.removeEventListener('pointerup', this.boundPointerUp)
    document.removeEventListener('pointercancel', this.boundPointerUp)
    document.removeEventListener('touchmove', this.boundTouchMove)
    document.removeEventListener('touchend', this.boundTouchEnd)
    this.onTransformChange = null
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.isOnInteractiveChild(e.target)) return
    this.isDragging = true
    this.lastPointerX = e.clientX
    this.lastPointerY = e.clientY
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDragging) return
    const dx = e.clientX - this.lastPointerX
    const dy = e.clientY - this.lastPointerY
    this.lastPointerX = e.clientX
    this.lastPointerY = e.clientY
    this.targetTransform.rotationY += dx * ROTATION_SENSITIVITY
    this.targetTransform.rotationX = clamp(
      this.targetTransform.rotationX + dy * ROTATION_SENSITIVITY,
      -MAX_PITCH, MAX_PITCH
    )
  }

  private onPointerUp(): void { this.isDragging = false }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    let delta = e.deltaY
    if (e.deltaMode === 1) delta *= 16
    else if (e.deltaMode === 2) delta *= 400
    const factor = 1 - delta * ZOOM_SENSITIVITY
    this.targetTransform.scale = clamp(this.targetTransform.scale * factor, MIN_SCALE, MAX_SCALE)
  }

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      this.touchStartDist = Math.hypot(dx, dy)
      this.touchStartScale = this.targetTransform.scale
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1 && this.isDragging) {
      const dx = e.touches[0].clientX - this.lastPointerX
      const dy = e.touches[0].clientY - this.lastPointerY
      this.lastPointerX = e.touches[0].clientX
      this.lastPointerY = e.touches[0].clientY
      this.targetTransform.rotationY += dx * ROTATION_SENSITIVITY
      this.targetTransform.rotationX = clamp(
        this.targetTransform.rotationX + dy * ROTATION_SENSITIVITY,
        -MAX_PITCH, MAX_PITCH
      )
    } else if (e.touches.length === 2) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy) || 1
      const factor = dist / this.touchStartDist
      this.targetTransform.scale = clamp(this.touchStartScale * factor, MIN_SCALE, MAX_SCALE)
    }
  }

  private onTouchEnd(): void { this.isDragging = false }

  private isOnInteractiveChild(target: EventTarget | null): boolean {
    let el = target as HTMLElement | null
    while (el && el !== this.interactionContainer) {
      if (el.dataset && el.dataset.noRotate !== undefined) return true
      if (el.classList && (
        el.classList.contains('preset-floater') ||
        el.classList.contains('stage-header') ||
        el.classList.contains('cover-thumb') ||
        el.classList.contains('dome-flip-btn')
      )) return true
      el = el.parentElement
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setPlaying(playing: boolean): void { this.isPlaying = playing }

  getTransform(): AudioReactiveTransform { return { ...this.currentTransform } }

  resetTransform(): void { this.targetTransform = { rotationX: 0, rotationY: 0, scale: 1 } }

  resize(): void { /* No-op */ }

  dispose(): void {
    this.animController.dispose()
    this.detachInteraction()
    // Kill all running gsap tweens to prevent orphaned references
    // from updating disposed/null objects after disposal.
    if (this.pointsMesh) gsap.killTweensOf(this.pointsMesh.rotation)
    if (this.objectsHolder) gsap.killTweensOf(this.objectsHolder.rotation)
    gsap.killTweensOf(this.holder.position)
    gsap.killTweensOf(this, 'baseFrequency')
    this.destroyMesh()
    this.material?.dispose()
    this.material = null
    this.scene.remove(this.holder)
  }

  // ---------------------------------------------------------------------------
  // GLSL Shaders — faithful to reference with minimal project adaptations
  // ---------------------------------------------------------------------------

  private getVertexShader(): string {
    return /* glsl */ `
      varying float vDistance;

      uniform float time;
      uniform float offsetSize;
      uniform float size;
      uniform float offsetGain;
      uniform float amplitude;
      uniform float frequency;
      uniform float maxDistance;
      uniform float uPixelRatio;

      vec3 mod289(vec3 x){
        return x-floor(x*(1./289.))*289.;
      }

      vec2 mod289(vec2 x){
        return x-floor(x*(1./289.))*289.;
      }

      vec3 permute(vec3 x){
        return mod289(((x*34.)+1.)*x);
      }

      float noise(vec2 v) {
        const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
        vec2 i=floor(v+dot(v,C.yy));
        vec2 x0=v-i+dot(i,C.xx);
        vec2 i1;
        i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
        vec4 x12=x0.xyxy+C.xxzz;
        x12.xy-=i1;
        i=mod289(i);
        vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))
        +i.x+vec3(0.,i1.x,1.));
        vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
        m=m*m;
        m=m*m;
        vec3 x=2.*fract(p*C.www)-1.;
        vec3 h=abs(x)-.5;
        vec3 ox=floor(x+.5);
        vec3 a0=x-ox;
        m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
        vec3 g;
        g.x=a0.x*x0.x+h.x*x0.y;
        g.yz=a0.yz*x12.xz+h.yz*x12.yw;
        return 130.*dot(m,g);
      }

      vec3 curl(float x,float y,float z) {
        float eps=1.,eps2=2.*eps;
        float n1,n2,a,b;
        x+=time*.05;
        y+=time*.05;
        z+=time*.05;
        vec3 curl=vec3(0.);
        n1=noise(vec2(x,y+eps));
        n2=noise(vec2(x,y-eps));
        a=(n1-n2)/eps2;
        n1=noise(vec2(x,z+eps));
        n2=noise(vec2(x,z-eps));
        b=(n1-n2)/eps2;
        curl.x=a-b;
        n1=noise(vec2(y,z+eps));
        n2=noise(vec2(y,z-eps));
        a=(n1-n2)/eps2;
        n1=noise(vec2(x+eps,z));
        n2=noise(vec2(x-eps,z));
        b=(n1-n2)/eps2;
        curl.y=a-b;
        n1=noise(vec2(x+eps,y));
        n2=noise(vec2(x-eps,y));
        a=(n1-n2)/eps2;
        n1=noise(vec2(y+eps,z));
        n2=noise(vec2(y-eps,z));
        b=(n1-n2)/eps2;
        curl.z=a-b;
        return curl;
      }

      void main() {
        // ── Exact reference vertex shader logic ──
        vec3 newpos = position;
        vec3 target = position + (normal*.1) + curl(newpos.x * frequency, newpos.y * frequency, newpos.z * frequency) * amplitude;

        float d = length(newpos - target) / maxDistance;
        newpos = mix(position, target, pow(d, 4.));

        // Z-axis wave motion driven by offsetGain (reference line, was missing
        // in previous iterations — adds organic depth movement)
        newpos.z += sin(time) * (.1 * offsetGain);

        vec4 mvPosition = modelViewMatrix * vec4(newpos, 1.);

        // Perspective-corrected point size (reference formula + uPixelRatio)
        gl_PointSize = (size + (pow(d,3.) * offsetSize) * (1./-mvPosition.z)) * uPixelRatio;

        gl_Position = projectionMatrix * mvPosition;

        vDistance = d;
      }
    `
  }

  private getFragmentShader(): string {
    return /* glsl */ `
      varying float vDistance;

      uniform vec3 colorStop0;
      uniform vec3 colorStop1;
      uniform vec3 colorStop2;
      uniform vec3 colorStop3;
      uniform vec3 colorStop4;
      uniform float uOpacity;

      float circle(in vec2 _st,in float _radius){
        vec2 dist=_st-vec2(.5);
        return 1.-smoothstep(_radius-(_radius*.01),
        _radius+(_radius*.01),
        dot(dist,dist)*4.);
      }

      vec3 multiGradient(float t){
        t = clamp(t, 0., 1.);
        float seg = t * 4.;
        int idx = int(floor(seg));
        float f = fract(seg);

        if(idx <= 0) return mix(colorStop0, colorStop1, f);
        if(idx == 1) return mix(colorStop1, colorStop2, f);
        if(idx == 2) return mix(colorStop2, colorStop3, f);
        return mix(colorStop3, colorStop4, f);
      }

      void main(){
        vec2 uv = vec2(gl_PointCoord.x,1.-gl_PointCoord.y);
        float circ = circle(uv,1.);
        // Early discard for transparent point-sprite corners (~21% of pixel
        // area). Saves blending / depth operations with zero visual change
        // since these pixels have alpha ≈ 0.
        if (circ < 0.01) discard;

        vec3 color = multiGradient(vDistance);
        // Reference: gl_FragColor = vec4(color, circ.r * vDistance)
        // Added +0.12 for minimum visibility and uOpacity for fade control
        float alpha = circ * (vDistance + 0.12) * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
