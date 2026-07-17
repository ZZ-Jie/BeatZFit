/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'howler' {
  export { Howl, Howler } from 'howler/dist/howler.core.min.js'
}

declare module 'troika-three-text' {
  import * as THREE from 'three'
  export class Text extends THREE.Mesh {
    text: string
    font: string | null
    fontSize: number
    color: number | string
    anchorX: string | number
    anchorY: string | number
    letterSpacing: number
    lineHeight: number
    bevelEnabled: boolean
    bevelSegments: number
    bevelSize: number
    bevelThickness: number
    sync: () => void
    dispose: () => void
  }
}
