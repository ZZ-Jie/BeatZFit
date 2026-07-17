/**
 * 水晶绽放可视化器 (Crystal Bloom)
 *
 * 基于 3d_Design/threejs-challenge 效果移植，从 React Three Fiber 转为原生 Three.js。
 * 核心视觉：3000 个胶囊体实例排列在 Fibonacci 球面上，4 个玻璃质感小球环绕公转，
 * 靠近胶囊体时产生位移变形（"绽放"效果），中心黑色球体提供深度遮挡。
 *
 * 与原 demo 的差异：
 * - 移除 lights:true 和 Three.js 阴影系统（用 fake shadow 替代）
 * - 用背景渐变色模拟折射效果替代 KawaseBlurPass（玻璃球显示背景色 + 高光/反射）
 * - 移除后处理 Bloom/Vignette/SMAA
 * - 玻璃球不响应音频，始终保持恒定丝滑公转（与原始一致）
 *
 * 音频适配映射（仅作用于胶囊体和中心球，玻璃球不响应）：
 *   lowFreq       → 位移衰减强度
 *   burstIntensity → 位移爆发 (power 降低 → 更尖锐)
 *   beatStrength   → 逐实例脉冲（每颗胶囊随机响应强度，非规律呼吸）
 *   rmsTimeDomain  → 整体微旋转 + 胶囊缩放
 *   各频段         → 逐实例位移放大（a_instanceRand 控制每颗响应不同）
 */

import * as THREE from 'three'
import gsap from 'gsap'
import type { AudioSpectrumData } from './audioAnalyzer'
import { AudioAnimationController } from './audioAnimationLayer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrystalBloomTransform {
  rotationX: number
  rotationY: number
  scale: number
}

interface CrystalBloomOptions {
  quality: 'high' | 'medium' | 'low'
}

// ---------------------------------------------------------------------------
// Constants — 与原始 threejs-challenge 完全一致
// ---------------------------------------------------------------------------

const MIN_SCALE = 0.5
const MAX_SCALE = 2.0
const DEFAULT_SCALE = 1.0
const ROTATION_SENSITIVITY = 0.005
const ZOOM_SENSITIVITY = 0.0015
const MAX_PITCH = 1.2

// 原始 demo 始终使用 3000 个实例
const INSTANCE_COUNT = 3000

const BASE_ORBIT_RADIUS = 1.9
const BASE_SPHERE_RADIUS = 0.3
const INV_SQRT2 = 1 / Math.SQRT2

// 玻璃球公转配置 — 全部圆形轨道, 无理数速度比消除碰撞
// 4 个轨道平面两两不同: yz / xz / y+(x+z)√2 对角 / xy
// 有音频时缩小玻璃球尺寸, 无音频时恢复原始大小
interface SphereOrbitConfig {
  speed: number
  phase: number
  dir: number
  // 轨道平面正交基 (两两不同平面)
  planeU: [number, number, number]
  planeV: [number, number, number]
}

const SPHERE_CONFIGS: SphereOrbitConfig[] = [
  // 球 0: yz 平面
  { speed: 0.70,                phase: 0,               dir: 1,
    planeU: [0, 1, 0], planeV: [0, 0, 1] },
  // 球 1: xz 平面 (反向)
  { speed: 0.70 * Math.SQRT2,   phase: Math.PI * 0.5,  dir: -1,
    planeU: [1, 0, 0], planeV: [0, 0, 1] },
  // 球 2: y 轴 + (x+z)/√2 对角平面 (与球 0,1,3 都不同)
  { speed: 0.70 * Math.sqrt(3), phase: Math.PI,         dir: 1,
    planeU: [0, 1, 0], planeV: [INV_SQRT2, 0, INV_SQRT2] },
  // 球 3: xy 平面 (反向)
  { speed: 0.70 * Math.PI * 0.5, phase: Math.PI * 1.5, dir: -1,
    planeU: [1, 0, 0], planeV: [0, 1, 0] },
]

// Background: pure black (matches inner sphere)
const COLOR_CAPSULE = '#B2B8BB'
const COLOR_BG = '#000000'
const COLOR_INNER_SPHERE = 0x111111

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const heroVertexShader = /* glsl */ `
  attribute vec3 a_instancePos;
  attribute vec4 a_instanceQuaternions;
  attribute float a_instanceRand;

  varying vec3 v_worldPosition;
  varying vec2 v_uv;
  varying vec3 v_instancePos;
  varying vec3 v_viewPosition;
  varying vec3 v_viewNormal;
  varying vec3 v_modelPosition;
  varying vec3 v_worldNormal;
  varying float v_instanceRand;

  uniform float u_scale;
  uniform float u_displacementStrength;
  uniform float u_displacementPower;
  uniform float u_audioPulse;
  uniform float u_time;
  uniform vec3 u_sphere1Position;
  uniform vec3 u_sphere2Position;
  uniform vec3 u_sphere3Position;
  uniform vec3 u_sphere4Position;

  #define saturate( a ) clamp( a, 0.0, 1.0 )

  float linearStep(float edge0, float edge1, float x) {
      return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  }

  vec3 rotateByQuaternion(vec3 v, vec4 q) {
      return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }

  vec3 inverseTransformDirection(in vec3 dir, in mat4 matrix) {
      return normalize((vec4(dir, 0.0) * matrix).xyz);
  }

  void main() {
      vec3 pos = position;
      vec3 norm = normal;

      float distanceToSphere1 = length(a_instancePos - u_sphere1Position);
      float distanceToSphere2 = length(a_instancePos - u_sphere2Position);
      float distanceToSphere3 = length(a_instancePos - u_sphere3Position);
      float distanceToSphere4 = length(a_instancePos - u_sphere4Position);

      float attenuationStrength = u_displacementStrength;

      float displacement = 1.0 - clamp(1.0 / (attenuationStrength * distanceToSphere1 * distanceToSphere1), 0.0, 1.0);
      displacement = min(displacement, 1.0 - clamp(1.0 / (attenuationStrength * distanceToSphere2 * distanceToSphere2), 0.0, 1.0));
      displacement = min(displacement, 1.0 - clamp(1.0 / (attenuationStrength * distanceToSphere3 * distanceToSphere3), 0.0, 1.0));
      displacement = min(displacement, 1.0 - clamp(1.0 / (attenuationStrength * distanceToSphere4 * distanceToSphere4), 0.0, 1.0));

      // 逐实例音频响应：每颗胶囊有不同的脉冲放大系数
      // 严禁缩放放大——保持原始大小，通过弹动和颜色响应音频
      float instanceAmp = 0.3 + a_instanceRand * 1.4;  // 0.3x ~ 1.7x
      // 位移 power 受弹簧阻尼 burst 驱动
      float instanceDispPower = u_displacementPower * (1.0 - a_instanceRand * 0.2 * u_audioPulse);

      float tip = 1.0 - step(-2.5, pos.y);
      if (tip > 0.5) {
          pos.y = -2.5;
          norm = vec3(0, -1, 0);
      }

      pos = rotateByQuaternion(pos, a_instanceQuaternions);
      pos *= u_scale;  // 恒定大小，不随音频放大
      pos += a_instancePos;

      // 基础位移（玻璃球接近度驱动，弹簧阻尼平滑）
      pos += normalize(a_instancePos) * 0.4 * pow(displacement, instanceDispPower);

      // 逐实例弹性弹动——形成场域效果
      // 每颗胶囊以不同频率/相位径向弹动，相邻胶囊因位置相近而同步→场域波纹
      // 弹簧阻尼 u_audioPulse 驱动振幅（平滑升降，不会瞬态拉开间隙）
      vec3 radialDir = normalize(a_instancePos);
      float spatialPhase = radialDir.x * 2.5 + radialDir.y * 2.0 + radialDir.z * 1.8;
      float bounceFreq = 8.0 + a_instanceRand * 6.0;     // 8-14 Hz, 轻微差异
      float bouncePhase = spatialPhase + a_instanceRand * 1.5;
      float bounceAmp = u_audioPulse * instanceAmp * 0.015; // 极小振幅, 保持紧密排列
      pos += radialDir * sin(u_time * bounceFreq + bouncePhase) * bounceAmp;

      norm = rotateByQuaternion(norm, a_instanceQuaternions);

      vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * viewPosition;

      vec4 worldPosition = (modelMatrix * vec4(pos, 1.0));

      v_uv = uv;
      v_viewNormal = normalize(normalMatrix * norm);
      v_worldPosition = worldPosition.xyz;
      v_modelPosition = position;
      v_viewPosition = -viewPosition.xyz;
      v_instancePos = a_instancePos;
      v_worldNormal = inverseTransformDirection(v_viewNormal, viewMatrix);
      v_instanceRand = a_instanceRand;
  }
`

const heroFragmentShader = /* glsl */ `
  varying vec3 v_worldPosition;
  varying vec2 v_uv;
  varying vec3 v_instancePos;
  varying vec3 v_viewPosition;
  varying vec3 v_viewNormal;
  varying vec3 v_modelPosition;
  varying vec3 v_worldNormal;
  varying float v_instanceRand;

  uniform vec3 u_lightPosition;
  uniform sampler2D u_noiseTexture;
  uniform vec2 u_noiseTexelSize;
  uniform vec2 u_noiseCoordOffset;
  uniform vec3 u_color;
  uniform float u_audioBrightness;
  uniform float u_audioPulse;
  uniform float u_time;

  #define saturate( a ) clamp( a, 0.0, 1.0 )

  float linearStep(float edge0, float edge1, float x) {
      return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  }

  void main() {
      vec3 viewNormal = normalize(v_viewNormal);
      vec3 L = normalize(u_lightPosition - v_instancePos);
      vec3 N = normalize(normalize(v_instancePos) + 0.2 * normalize(v_worldNormal));
      float NdL = max(0., dot(N, L));

      // 使用 v_instancePos（局部空间）计算距离，与原始 demo 一致
      float distFromLight = length(u_lightPosition - v_instancePos);
      float attenuation = 1.0 / (0.00025 * pow(distFromLight, 8.0));

      float ao = linearStep(-0.5, -3.0, v_modelPosition.y);

      // Fake shadow: 模拟内球（半径1.5）遮挡光源。
      // 胶囊体方向与光源方向的点积 < 0 → 在内球阴影中
      float facingLight = dot(normalize(v_instancePos), normalize(u_lightPosition));
      float fakeShadow = smoothstep(-0.35, 0.35, facingLight);
      float shadow = 0.4 + 0.6 * fakeShadow;

      vec3 color = u_color;
      // 逐实例亮度：弹簧阻尼基础亮度 + 位置相位振荡闪烁
      // 场域效果：相邻胶囊因位置相近而同步闪烁
      float instanceBrightness = u_audioBrightness * (0.5 + v_instanceRand * 1.5);
      vec3 radialDir = normalize(v_instancePos);
      float spatialPhase = radialDir.x * 2.5 + radialDir.y * 2.0 + radialDir.z * 1.8;
      float brightOsc = sin(u_time * 6.0 + spatialPhase + v_instanceRand * 1.5) * u_audioPulse * v_instanceRand * 0.12;
      color *= (1.0 + instanceBrightness * 0.6 + u_audioPulse * v_instanceRand * 0.2 + brightOsc);
      color *= clamp(attenuation + smoothstep(-0.05, 1.0, NdL), 0.0, 1.0);
      color = pow(color, vec3(0.8));
      color *= ao * ao;
      color *= shadow;

      gl_FragColor = vec4(color, 1.0);
      gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0 / 2.2));
  }
`

const sphereVertexShader = /* glsl */ `
  varying vec3 v_viewNormal;
  varying vec2 v_uv;
  varying vec3 v_modelPosition;
  varying vec3 v_worldPosition;
  varying vec3 v_viewPosition;

  #define saturate( a ) clamp( a, 0.0, 1.0 )
  vec3 inverseTransformDirection(in vec3 dir, in mat4 matrix) {
      return normalize((vec4(dir, 0.0) * matrix).xyz);
  }

  void main () {
      vec3 pos = position;
      vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);

      gl_Position = projectionMatrix * viewPosition;

      vec4 worldPosition = (modelMatrix * vec4(pos, 1.0));
      v_viewNormal = normalMatrix * normal;
      v_uv = uv;
      v_modelPosition = position;
      v_worldPosition = worldPosition.xyz;
      v_viewPosition = -viewPosition.xyz;
  }
`

const sphereFragmentShader = /* glsl */ `
  varying vec3 v_viewNormal;
  varying vec3 v_viewPosition;
  varying vec3 v_worldPosition;
  varying vec2 v_uv;

  uniform vec3 u_lightPosition;
  uniform sampler2D u_matcap;
  uniform vec3 u_bgColor;

  vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
      return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
  }

  void main() {
      vec3 viewNormal = normalize(v_viewNormal);

      vec3 N = inverseTransformDirection(viewNormal, viewMatrix);
      vec3 V = normalize(cameraPosition - v_worldPosition);
      vec3 L = u_lightPosition - v_worldPosition;
      float lightDistance = length(L);
      L /= lightDistance;

      vec3 H = normalize(V + L);
      float spec = max(0.0, dot(H, N));
      float NdV = max(0., dot(N, V));
      float fresnel = pow(1.0 - NdV, 5.0);

      // Matcap — view-space normal mapped to matcap UV
      vec3 viewDir = normalize( v_viewPosition );
      vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
      vec3 y = cross( viewDir, x );
      vec2 uv = vec2( dot( x, v_viewNormal ), dot( y, v_viewNormal ) ) * 0.495 + 0.5;
      vec4 matcapColor = texture2D( u_matcap, uv );

      // 模拟折射：背景为纯黑，玻璃球透过的场景也是黑色
      vec3 sceneBlurred = pow(u_bgColor, vec3(2.2));

      // 与原始 demo 完全一致的合成方式：
      // color = sceneBlurred + specular + matcap_reflection + fresnel
      vec3 color = sceneBlurred;
      color += 0.2 * pow(spec, 500.0);                            // 锐利高光点
      color += 0.03 * pow(matcapColor.rgb, vec3(2.2));           // 微弱玻璃反射
      color += 0.005 * fresnel;                                   // 菲涅尔边缘

      // 原始: gl_FragColor = vec4(0.8 * color, 1.) — 不透明，0.8x 亮度
      gl_FragColor = vec4(0.8 * color, 1.0);
      gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0 / 2.2));
  }
`

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class CrystalBloomVisualizer {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private renderer: THREE.WebGLRenderer
  private options: CrystalBloomOptions

  // Three.js objects
  private group: THREE.Group
  private heroMesh: THREE.Mesh | null = null
  private heroGeometry: THREE.InstancedBufferGeometry | null = null
  private heroMaterial: THREE.ShaderMaterial | null = null
  private innerSphere: THREE.Mesh | null = null
  private glassSpheres: THREE.Mesh[] = []
  private glassGeometry: THREE.SphereGeometry | null = null
  private glassMaterial: THREE.ShaderMaterial | null = null
  // 玻璃球轨道半径过渡值 (有音频→2.7, 无音频→1.9)
  private currentOrbitRadius = BASE_ORBIT_RADIUS

  // Textures
  private noiseTexture: THREE.Texture | null = null
  private matcapTexture: THREE.Texture | null = null

  // State
  private isPlaying = false
  private disposed = false
  private clock = new THREE.Clock()

  // Audio controller
  private animController: AudioAnimationController

  // Interaction state
  private currentTransform: CrystalBloomTransform
  private targetTransform: CrystalBloomTransform
  private isDragging = false
  private lastPointerX = 0
  private lastPointerY = 0
  private interactionContainer: HTMLElement | null = null
  private onTransformChange: ((t: CrystalBloomTransform) => void) | null = null

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

  // Auto-spin accumulator (separate from user drag rotation)
  private autoSpinY = 0

  // Pre-allocated scratch objects
  private _spherePositions: THREE.Vector3[] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]

  // Uniforms
  private heroUniforms: Record<string, THREE.IUniform>
  private sphereUniforms: Record<string, THREE.IUniform>

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options: CrystalBloomOptions
  ) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.options = options

    this.currentTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
    this.targetTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }

    this.animController = new AudioAnimationController()

    // Load textures
    const texLoader = new THREE.TextureLoader()
    this.noiseTexture = texLoader.load('/assets/bnoise.png')
    this.noiseTexture.wrapS = THREE.RepeatWrapping
    this.noiseTexture.wrapT = THREE.RepeatWrapping

    this.matcapTexture = texLoader.load('/assets/glass.png')

    const lightPosition = new THREE.Vector3(-1, 0.8, 0.25).normalize().multiplyScalar(5)

    // Build uniforms
    this.heroUniforms = {
      u_scale: { value: 0.06 },
      u_lightPosition: { value: lightPosition },
      u_noiseTexture: { value: this.noiseTexture },
      u_noiseTexelSize: { value: new THREE.Vector2(1 / 128, 1 / 128) },
      u_noiseCoordOffset: { value: new THREE.Vector2(0, 0) },
      u_color: { value: new THREE.Color(COLOR_CAPSULE) },
      u_sphere1Position: { value: new THREE.Vector3(0, 0, 0) },
      u_sphere2Position: { value: new THREE.Vector3(0, 0, 0) },
      u_sphere3Position: { value: new THREE.Vector3(0, 0, 0) },
      u_sphere4Position: { value: new THREE.Vector3(0, 0, 0) },
      u_displacementStrength: { value: 4.0 },
      u_displacementPower: { value: 0.7 },
      u_audioBrightness: { value: 0 },
      u_audioPulse: { value: 0 },
      u_audioRms: { value: 0 },
      u_time: { value: 0 },
    }

    this.sphereUniforms = {
      u_lightPosition: { value: lightPosition },
      u_matcap: { value: this.matcapTexture },
      u_bgColor: { value: new THREE.Color(COLOR_BG) },
    }

    // Group 位于原点，无偏移、无缩放——相机调整为 z=5/FOV=75 匹配原始 demo
    this.group = new THREE.Group()
    this.group.name = 'crystalBloomGroup'
    this.scene.add(this.group)

    this.buildScene()
  }

  // ---------------------------------------------------------------------------
  // Scene construction
  // ---------------------------------------------------------------------------

  private buildScene(): void {
    // ── Background plane removed — Aurora global background shows through ──

    // ── Inner black sphere (depth occlusion) ──
    const innerGeo = new THREE.SphereGeometry(1.5, 32, 32)
    const innerMat = new THREE.MeshBasicMaterial({ color: COLOR_INNER_SPHERE })
    this.innerSphere = new THREE.Mesh(innerGeo, innerMat)
    this.innerSphere.renderOrder = -1
    this.group.add(this.innerSphere)

    // ── Hero mesh (instanced capsules) ──
    this.buildHeroMesh()

    // ── Glass spheres ──
    this.buildGlassSpheres()
  }

  private buildHeroMesh(): void {
    // Reference capsule geometry
    const refGeometry = new THREE.CapsuleGeometry(1, 4, 4, 16)
    refGeometry.computeBoundingBox()

    // Instanced buffer geometry
    const geometry = new THREE.InstancedBufferGeometry()
    for (const id in refGeometry.attributes) {
      geometry.setAttribute(id, refGeometry.attributes[id])
    }
    geometry.setIndex(refGeometry.index)

    // Fibonacci sphere distribution — 始终使用 3000 个实例（与原始一致）
    const positionsArray = new Float32Array(INSTANCE_COUNT * 3)
    const quaternionsArray = new Float32Array(INSTANCE_COUNT * 4)
    const randsArray = new Float32Array(INSTANCE_COUNT)

    const sphereRadius = 1.5
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const up = new THREE.Vector3(0, 1, 0)
    const tempPos = new THREE.Vector3()
    const tempQuat = new THREE.Quaternion()

    for (let i = 0, i3 = 0, i4 = 0; i < INSTANCE_COUNT; i++, i3 += 3, i4 += 4) {
      const y = 1 - (i / (INSTANCE_COUNT - 1)) * 2
      const radius = Math.sqrt(1 - y * y)
      const theta = goldenAngle * i

      const x = Math.cos(theta) * radius * sphereRadius
      const z = Math.sin(theta) * radius * sphereRadius
      const posY = y * sphereRadius

      positionsArray[i3] = x
      positionsArray[i3 + 1] = posY
      positionsArray[i3 + 2] = z

      tempPos.set(-x, -posY, -z).normalize()
      tempQuat.setFromUnitVectors(up, tempPos)

      quaternionsArray[i4] = tempQuat.x
      quaternionsArray[i4 + 1] = tempQuat.y
      quaternionsArray[i4 + 2] = tempQuat.z
      quaternionsArray[i4 + 3] = tempQuat.w

      // 每颗胶囊的随机响应系数 (0~1)
      randsArray[i] = Math.random()
    }

    geometry.setAttribute('a_instancePos', new THREE.InstancedBufferAttribute(positionsArray, 3))
    geometry.setAttribute('a_instanceQuaternions', new THREE.InstancedBufferAttribute(quaternionsArray, 4))
    geometry.setAttribute('a_instanceRand', new THREE.InstancedBufferAttribute(randsArray, 1))

    this.heroGeometry = geometry

    this.heroMaterial = new THREE.ShaderMaterial({
      vertexShader: heroVertexShader,
      fragmentShader: heroFragmentShader,
      uniforms: this.heroUniforms,
    })

    this.heroMesh = new THREE.Mesh(geometry, this.heroMaterial)
    this.heroMesh.renderOrder = 0
    this.heroMesh.frustumCulled = false
    this.group.add(this.heroMesh)
  }

  private buildGlassSpheres(): void {
    this.glassGeometry = new THREE.SphereGeometry(BASE_SPHERE_RADIUS, 32, 32)

    // 不透明玻璃材质：用背景色模拟折射（与原始 demo 的 sceneBlurred 效果一致）
    this.glassMaterial = new THREE.ShaderMaterial({
      vertexShader: sphereVertexShader,
      fragmentShader: sphereFragmentShader,
      uniforms: this.sphereUniforms,
    })

    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(this.glassGeometry, this.glassMaterial)
      mesh.renderOrder = 1
      this.glassSpheres.push(mesh)
      this.group.add(mesh)
    }

  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async loadCover(_url: string): Promise<boolean> {
    // No cover loading for this preset — colors are fixed to original grays.
    return true
  }

  update(data: AudioSpectrumData): void {
    if (this.disposed) return

    const dt = Math.min(this.clock.getDelta(), 0.1)
    const time = this.clock.getElapsedTime()

    // Update audio animation controller (弹簧阻尼系统)
    this.animController.update(data, dt)

    // ── 音频参数：使用弹簧阻尼平滑值 ──
    // 弹簧阻尼系统保证平滑升降，避免瞬态拉开间隙
    //   lowFreq — 低频能量 (stiffness 200, damping 18, ~10ms 响应)
    //   rms — 时域 RMS (stiffness 90, damping 14, 稳定追踪)
    //   burstIntensity — 拍点爆发 (stiffness 250, damping 20, 快速脉冲)
    //   beatStrength — 节拍强度 (原始值, 用于脉冲驱动)
    const lowFreq = this.animController.lowFreq
    const rms = this.animController.rms
    const burst = this.animController.burstIntensity
    const beatStrength = data.beatStrength ?? 0

    // ── 玻璃球公转：圆形轨道, 有音频时推远半径 (1.9→2.7), 无音频恢复 ──
    const isAudioActive = rms > 0.01 || beatStrength > 0.05

    // 平滑过渡轨道半径 (有音频→2.7, 无音频→1.9)
    const radiusTarget = isAudioActive ? BASE_ORBIT_RADIUS + 0.8 : BASE_ORBIT_RADIUS
    const radiusLerp = 1.0 - Math.exp(-6.0 * dt)  // ~150ms 过渡
    this.currentOrbitRadius += (radiusTarget - this.currentOrbitRadius) * radiusLerp

    for (let i = 0; i < 4; i++) {
      const config = SPHERE_CONFIGS[i]

      // 圆形轨道: P = r * (cos(a) * planeU + sin(a) * planeV)
      const angle = config.dir * config.speed * time + config.phase
      const ca = Math.cos(angle)
      const sa = Math.sin(angle)
      const r = this.currentOrbitRadius
      const [ux, uy, uz] = config.planeU
      const [vx, vy, vz] = config.planeV
      const px = r * (ca * ux + sa * vx)
      const py = r * (ca * uy + sa * vy)
      const pz = r * (ca * uz + sa * vz)

      this._spherePositions[i].set(px, py, pz)
      if (this.glassSpheres[i]) {
        this.glassSpheres[i].position.copy(this._spherePositions[i])
      }
    }

    // Update sphere position uniforms (for displacement)
    ;(this.heroUniforms.u_sphere1Position.value as THREE.Vector3).copy(this._spherePositions[0])
    ;(this.heroUniforms.u_sphere2Position.value as THREE.Vector3).copy(this._spherePositions[1])
    ;(this.heroUniforms.u_sphere3Position.value as THREE.Vector3).copy(this._spherePositions[2])
    ;(this.heroUniforms.u_sphere4Position.value as THREE.Vector3).copy(this._spherePositions[3])

    // ── Displacement strength (低频驱动, 弹簧阻尼平滑) ──
    this.heroUniforms.u_displacementStrength.value = 4.0 + lowFreq * 4.0

    // ── Displacement power (burst 驱动, 弹簧阻尼平滑) ──
    this.heroUniforms.u_displacementPower.value = 0.7 - burst * 0.3

    // ── Capsule base scale (固定不变，不响应音频) ──
    this.heroUniforms.u_scale.value = 0.06

    // ── Audio brightness (RMS + beat 混合, 弹簧阻尼) ──
    this.heroUniforms.u_audioBrightness.value = rms * 0.5 + beatStrength * 0.3

    // ── Per-instance audio pulse (beat 驱动, 供着色器弹动振荡) ──
    this.heroUniforms.u_audioPulse.value = beatStrength
    this.heroUniforms.u_audioRms.value = rms

    // ── Time (供着色器逐实例振荡相位) ──
    this.heroUniforms.u_time.value = time

    // ── Blue noise offset (changes every frame for dithering) ──
    const noiseOffset = this.heroUniforms.u_noiseCoordOffset.value as THREE.Vector2
    noiseOffset.set(Math.random(), Math.random())

    // ── Inner sphere pulse (低频 + beat 驱动, 无延迟) ──
    if (this.innerSphere) {
      const innerScale = 1.0 + lowFreq * 0.08 + beatStrength * 0.05
      this.innerSphere.scale.setScalar(innerScale)
    }

    // ── Auto-spin (RMS-driven slow rotation, separate from user drag) ──
    const spinSpeed = 0.05 + rms * 0.3
    this.autoSpinY += spinSpeed * dt

    // ── Apply user interaction transform ──
    // 拖拽时直接跟手（无 lerp），非拖拽时平滑过渡
    if (this.isDragging) {
      this.currentTransform.rotationX = this.targetTransform.rotationX
      this.currentTransform.rotationY = this.targetTransform.rotationY
      this.currentTransform.scale = this.targetTransform.scale
    } else {
      const lerpFactor = 1.0 - Math.exp(-20.0 * dt)
      this.currentTransform.rotationX += (this.targetTransform.rotationX - this.currentTransform.rotationX) * lerpFactor
      this.currentTransform.rotationY += (this.targetTransform.rotationY - this.currentTransform.rotationY) * lerpFactor
      this.currentTransform.scale += (this.targetTransform.scale - this.currentTransform.scale) * lerpFactor
    }

    // Combine auto-spin + user rotation
    this.group.rotation.x = this.currentTransform.rotationX
    this.group.rotation.y = this.autoSpinY + this.currentTransform.rotationY
    this.group.scale.setScalar(this.currentTransform.scale)
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing
    if (!playing) {
      this.heroUniforms.u_audioBrightness.value = 0
      this.heroUniforms.u_audioPulse.value = 0
      this.heroUniforms.u_audioRms.value = 0
    }
  }

  resize(): void {
    // No viewport-dependent resources to resize
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // Kill any pending gsap tweens
    gsap.killTweensOf(this.currentTransform)
    gsap.killTweensOf(this.targetTransform)

    // Detach interaction
    this.detachInteraction()

    // Dispose geometries
    this.heroGeometry?.dispose()
    this.glassGeometry?.dispose()
    this.innerSphere?.geometry?.dispose()

    // Dispose materials
    this.heroMaterial?.dispose()
    this.glassMaterial?.dispose()
    ;(this.innerSphere?.material as THREE.Material | undefined)?.dispose()

    // Dispose textures
    this.noiseTexture?.dispose()
    this.matcapTexture?.dispose()

    // Remove all objects from group
    while (this.group.children.length > 0) {
      this.group.children[0].removeFromParent()
    }
    this.group.removeFromParent()

    this.heroMesh = null
    this.heroGeometry = null
    this.heroMaterial = null
    this.innerSphere = null
    this.glassSpheres = []
    this.glassGeometry = null
    this.glassMaterial = null
    this.noiseTexture = null
    this.matcapTexture = null

    this.animController.dispose()
  }

  // ---------------------------------------------------------------------------
  // Interaction (drag rotate + wheel zoom)
  // ---------------------------------------------------------------------------

  attachInteraction(container: HTMLElement, callback: (t: CrystalBloomTransform) => void): void {
    this.interactionContainer = container
    this.onTransformChange = callback
    container.addEventListener('pointerdown', this.boundPointerDown)
    container.addEventListener('pointermove', this.boundPointerMove)
    container.addEventListener('pointerup', this.boundPointerUp)
    container.addEventListener('pointercancel', this.boundPointerUp)
    container.addEventListener('wheel', this.boundWheel, { passive: false })
    container.addEventListener('touchstart', this.boundTouchStart, { passive: false })
    container.addEventListener('touchmove', this.boundTouchMove, { passive: false })
    container.addEventListener('touchend', this.boundTouchEnd)
  }

  detachInteraction(): void {
    if (this.interactionContainer) {
      this.interactionContainer.removeEventListener('pointerdown', this.boundPointerDown)
      this.interactionContainer.removeEventListener('pointermove', this.boundPointerMove)
      this.interactionContainer.removeEventListener('pointerup', this.boundPointerUp)
      this.interactionContainer.removeEventListener('pointercancel', this.boundPointerUp)
      this.interactionContainer.removeEventListener('wheel', this.boundWheel)
      this.interactionContainer.removeEventListener('touchstart', this.boundTouchStart)
      this.interactionContainer.removeEventListener('touchmove', this.boundTouchMove)
      this.interactionContainer.removeEventListener('touchend', this.boundTouchEnd)
    }
    this.interactionContainer = null
    this.onTransformChange = null
  }

  getTransform(): CrystalBloomTransform {
    return { ...this.currentTransform }
  }

  resetTransform(): void {
    this.targetTransform = { rotationX: 0, rotationY: 0, scale: DEFAULT_SCALE }
    gsap.to(this.currentTransform, {
      rotationX: 0,
      rotationY: 0,
      scale: DEFAULT_SCALE,
      duration: 0.6,
      ease: 'power2.out',
      onUpdate: () => {
        this.onTransformChange?.(this.currentTransform)
      },
    })
  }

  // --- Pointer handlers ---

  private onPointerDown(e: PointerEvent): void {
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
    this.targetTransform.rotationX += dy * ROTATION_SENSITIVITY
    this.targetTransform.rotationX = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.targetTransform.rotationX))

    this.onTransformChange?.(this.targetTransform)
  }

  private onPointerUp(): void {
    this.isDragging = false
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    const delta = -e.deltaY * ZOOM_SENSITIVITY
    this.targetTransform.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.targetTransform.scale + delta))
    this.onTransformChange?.(this.targetTransform)
  }

  // --- Touch handlers ---

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      this.isDragging = true
      this.lastPointerX = e.touches[0].clientX
      this.lastPointerY = e.touches[0].clientY
    } else if (e.touches.length === 2) {
      this.isDragging = false
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      this.touchStartDist = Math.sqrt(dx * dx + dy * dy)
      this.touchStartScale = this.targetTransform.scale
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault()
    if (e.touches.length === 1 && this.isDragging) {
      const dx = e.touches[0].clientX - this.lastPointerX
      const dy = e.touches[0].clientY - this.lastPointerY
      this.lastPointerX = e.touches[0].clientX
      this.lastPointerY = e.touches[0].clientY

      this.targetTransform.rotationY += dx * ROTATION_SENSITIVITY
      this.targetTransform.rotationX += dy * ROTATION_SENSITIVITY
      this.targetTransform.rotationX = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.targetTransform.rotationX))
      this.onTransformChange?.(this.targetTransform)
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (this.touchStartDist > 0) {
        const scale = this.touchStartScale * (dist / this.touchStartDist)
        this.targetTransform.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
        this.onTransformChange?.(this.targetTransform)
      }
    }
  }

  private onTouchEnd(): void {
    this.isDragging = false
  }
}
