<template>
  <canvas ref="canvasRef" class="aurora-canvas" data-aurora-canvas></canvas>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { useGlobalVisualizer, auroraAccentColor } from '@/composables/useGlobalVisualizer'
import { AURORA_VERT as vert, AURORA_FRAG as frag } from '@/modules/visualizer/auroraShader'

const { lyricAudioData } = useGlobalVisualizer()

const canvasRef = ref<HTMLCanvasElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null
let uniforms: Record<string, THREE.IUniform> = {}
let rafId = 0
let disposed = false

// Smoothed bass value for aurora pulsing
let smoothBass = 0
let smoothMouseX = 0.5
let smoothMouseY = 0.5
let targetMouseX = 0.5
let targetMouseY = 0.5

// ── GLSL imported from auroraShader.ts (shared with threeScene.ts) ──

function onResize() {
  if (!renderer || !uniforms.uRes) return
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h)
  ;(uniforms.uRes.value as THREE.Vector2).set(w, h)
}

function onMouseMove(e: MouseEvent) {
  targetMouseX = e.clientX / window.innerWidth
  targetMouseY = 1 - e.clientY / window.innerHeight
}

function frame() {
  if (disposed) return
  rafId = requestAnimationFrame(frame)

  const now = performance.now()
  const t = now * 0.001

  // Smooth mouse
  smoothMouseX += (targetMouseX - smoothMouseX) * 0.05
  smoothMouseY += (targetMouseY - smoothMouseY) * 0.05

  // Smooth bass from audio data
  const targetBass = lyricAudioData.value.bass || 0
  smoothBass += (targetBass - smoothBass) * 0.1

  // Update uniforms
  uniforms.uTime.value = t
  ;(uniforms.uMouse.value as THREE.Vector2).set(smoothMouseX, smoothMouseY)
  uniforms.uBass.value = smoothBass

  // Read accent color from threeScene (computed by its updateAurora method)
  // This includes idle/playing/cover-derived color logic.
  // Apply user-configurable brightness multiplier from ControlPanel.
  const brightnessStr = getComputedStyle(document.documentElement).getPropertyValue('--cp-aurora-brightness').trim()
  const brightness = brightnessStr ? parseFloat(brightnessStr) : 1.0
  ;(uniforms.uAccent.value as THREE.Color).setRGB(
    auroraAccentColor.r * brightness,
    auroraAccentColor.g * brightness,
    auroraAccentColor.b * brightness
  )

  if (renderer && scene && camera) {
    renderer.render(scene, camera)
  }
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uBass: { value: 0 },
      uAccent: { value: new THREE.Color(0x7ec8e3) },
      uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    }

    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    scene.add(mesh)

    onResize()
    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMouseMove)

    frame()
  } catch (e) {
    console.error('[AuroraBackground] Failed to init:', e)
  }
})

onUnmounted(() => {
  disposed = true
  cancelAnimationFrame(rafId)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', onMouseMove)

  if (renderer) {
    renderer.dispose()
    renderer = null
  }
  scene = null
  camera = null
})
</script>

<style scoped>
.aurora-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
}
</style>
