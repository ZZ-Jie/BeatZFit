import { type CSSProperties, type VNode } from 'vue'
import type { FragmentShaderType } from './shader-util'
export enum GlassMode {
  standard = 'standard',
  polar = 'polar',
  prominent = 'prominent',
  shader = 'shader',
  frosted = 'frosted',
}
export interface GlassFilterProps {
  id: string
  displacementScale: number
  aberrationIntensity: number
  width: number | string
  height: number | string
  mode: GlassMode
  shaderMapUrl?: string
}

export interface GlassContainerProps {
  className?: string
  style?: Partial<CSSProperties>
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  mouseOffset?: { x: number; y: number }
  onMouseLeave?: () => void
  onMouseEnter?: () => void
  onMouseDown?: () => void
  onMouseUp?: () => void
  active?: boolean
  overLight?: boolean
  cornerRadius?: number
  padding?: string
  glassSize?: { width: number; height: number }
  onClick?: () => void
  mode?: GlassMode | undefined,
  effect?: FragmentShaderType
  asBackground?: boolean
}

export interface LiquidGlassProps {
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  cornerRadius?: number
  globalMousePos?: { x: number; y: number }
  mouseOffset?: { x: number; y: number }
  mouseContainer?: HTMLElement
  className?: string
  padding?: string
  style?: Partial<CSSProperties>
  overLight?: boolean
  mode?: GlassMode | undefined
  onClick?: () => void,
  effect?: FragmentShaderType
  asBackground?: boolean
  // Dynamic lighting / environmental color absorption
  ambientColor?: string | null
  reflectionIntensity?: number
  rimLightColor?: string | null
  lightAngle?: number
}
