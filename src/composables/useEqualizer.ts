import { ref } from 'vue'
import { Howler } from 'howler'

/**
 * 10-Band Audio Equalizer
 *
 * Inserts a chain of BiquadFilterNode (peaking) filters between the audio
 * source and the AudioContext destination. Works for both:
 *   - Web Audio mode (local files): masterGain → EQ → destination
 *     (analyser taps masterGain separately, sees pre-EQ signal)
 *   - HTML5 mode (Netease): analyser → EQ → destination
 *     (source → analyser still works, EQ sits after analyser)
 *
 * The EQ is transparent when all gains are 0 dB.
 *
 * Frequency bands (standard 10-band EQ):
 *   60Hz, 170Hz, 310Hz, 600Hz, 1kHz, 3kHz, 6kHz, 12kHz, 14kHz, 16kHz
 */

export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const
export const EQ_BAND_COUNT = EQ_BANDS.length

export interface EQPreset {
  name: string
  label: string
  gains: number[] // length must match EQ_BANDS
}

export const EQ_PRESETS: EQPreset[] = [
  { name: 'flat', label: '原声', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'bass-boost', label: '低音增强', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'treble-boost', label: '高音增强', gains: [0, 0, 0, 0, 0, 2, 4, 5, 6, 6] },
  { name: 'vocal', label: '人声', gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: 'rock', label: '摇滚', gains: [5, 3, -1, -2, 1, 2, 4, 5, 5, 4] },
  { name: 'pop', label: '流行', gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
  { name: 'jazz', label: '爵士', gains: [3, 2, 0, 2, 2, 0, 0, 1, 2, 3] },
  { name: 'classical', label: '古典', gains: [4, 3, 0, 0, 0, 0, 0, 2, 3, 4] },
  { name: 'electronic', label: '电子', gains: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5] },
  { name: 'hiphop', label: '嘻哈', gains: [5, 4, 2, 1, 0, 0, 0, 1, 2, 3] },
]

const STORAGE_KEY = 'beatzfit-eq-settings'

interface EQSettings {
  enabled: boolean
  gains: number[]
  presetName: string
}

function loadSettings(): EQSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        enabled: parsed.enabled ?? false,
        gains: Array.isArray(parsed.gains) && parsed.gains.length === EQ_BAND_COUNT
          ? parsed.gains
          : [...EQ_PRESETS[0].gains],
        presetName: parsed.presetName ?? 'flat',
      }
    }
  } catch (e) {
    console.warn('[Equalizer] Failed to load settings from localStorage:', e)
  }
  return { enabled: false, gains: [...EQ_PRESETS[0].gains], presetName: 'flat' }
}

function saveSettings(settings: EQSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('[Equalizer] Failed to save settings to localStorage:', e)
  }
}

// ===== Module-level singleton =====
let filters: BiquadFilterNode[] = []
let inputNode: AudioNode | null = null
let audioCtx: AudioContext | null = null
let isConnected = false

// ===== Shared reactive state (module-level singleton) =====
// These must be shared across all useEqualizer() callers so that toggling
// the EQ in the panel updates the button highlight in PlayerBar, etc.
const _saved = loadSettings()
const _eqEnabled = ref(_saved.enabled)
const _eqGains = ref<number[]>([..._saved.gains])
const _eqPresetName = ref(_saved.presetName)

function createFilterChain(ctx: AudioContext, gains: number[]): BiquadFilterNode[] {
  const nodes: BiquadFilterNode[] = []
  for (let i = 0; i < EQ_BANDS.length; i++) {
    const filter = ctx.createBiquadFilter()
    if (i === 0) {
      filter.type = 'lowshelf'
    } else if (i === EQ_BANDS.length - 1) {
      filter.type = 'highshelf'
    } else {
      filter.type = 'peaking'
    }
    filter.frequency.value = EQ_BANDS[i]
    filter.Q.value = 1.0
    filter.gain.value = gains[i] || 0
    nodes.push(filter)
  }
  // Chain: filter[0] → filter[1] → ... → filter[n]
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].connect(nodes[i + 1])
  }
  return nodes
}

/**
 * Insert the EQ chain between an input node and the AudioContext destination.
 *
 * CRITICAL: Only disconnects the specific input → ctx.destination connection,
 * NOT all connections from input. This preserves other connections (e.g.
 * masterGain → analyser for the visualizer).
 *
 * Web Audio API: AudioNode.disconnect(destinationNode) disconnects only the
 * specific connection to that destination, leaving other connections intact.
 */
function insertEQ(input: AudioNode, ctx: AudioContext, gains: number[]) {
  if (isConnected) return // Already inserted

  try {
    // Only disconnect the specific destination connection.
    // This preserves masterGain → analyser (visualizer tap).
    input.disconnect(ctx.destination)
  } catch (e) {
    /* expected: input might not be connected to destination yet */
    console.warn('[Equalizer] Expected disconnect failure (not connected to destination):', e)
  }

  filters = createFilterChain(ctx, gains)
  input.connect(filters[0])
  filters[filters.length - 1].connect(ctx.destination)

  inputNode = input
  audioCtx = ctx
  isConnected = true
}

/**
 * Remove the EQ chain and reconnect input → destination directly.
 * Only reconnects the specific destination connection.
 */
function removeEQ() {
  if (!inputNode || !audioCtx || !isConnected) return
  try {
    // Disconnect EQ filters
    if (filters.length > 0) {
      filters.forEach(f => f.disconnect())
    }
    // Only disconnect the connection from input to the first filter
    try { inputNode.disconnect(filters[0]) } catch (e) { console.warn('[Equalizer] Failed to disconnect from first filter:', e) }
    // Reconnect input → destination
    inputNode.connect(audioCtx.destination)
  } catch (e) {
    console.warn('[Equalizer] Failed to remove EQ chain:', e)
  }
  filters = []
  inputNode = null
  audioCtx = null
  isConnected = false
}

/**
 * Update the gain of a single EQ band.
 */
function setBandGain(bandIndex: number, gainDb: number) {
  if (filters[bandIndex]) {
    filters[bandIndex].gain.value = gainDb
  }
}

/**
 * Update all band gains at once.
 */
function setAllGains(gains: number[]) {
  for (let i = 0; i < filters.length && i < gains.length; i++) {
    filters[i].gain.value = gains[i]
  }
}

// ===== Vue Composable =====

export function useEqualizer() {
  // Use shared module-level refs — all callers see the same state
  const eqEnabled = _eqEnabled
  const eqGains = _eqGains
  const eqPresetName = _eqPresetName

  /**
   * Try to connect the EQ to Howler's master gain (Web Audio mode).
   * Should be called after Howler initializes. Safe to call multiple times.
   *
   * For HTML5 mode, use connectToNode() with the analyser instead.
   */
  function tryConnect() {
    if (isConnected) {
      if (eqEnabled.value) setAllGains(eqGains.value)
      return
    }

    // Try Howler's master gain (works for Web Audio mode)
    const masterGain = (Howler as any)._masterGain || (Howler as any).masterGain
    const ctx = (Howler as any).ctx || (Howler as any)._ctx
    if (masterGain && ctx) {
      if (eqEnabled.value) {
        insertEQ(masterGain, ctx, eqGains.value)
      } else {
        // Store reference for when EQ is toggled on
        inputNode = masterGain
        audioCtx = ctx
      }
    }
  }

  /**
   * Connect EQ using a specific node (e.g. analyser node from visualizer).
   * Used for HTML5 mode where the analyser is the last node before destination.
   */
  function connectToNode(node: AudioNode, ctx: AudioContext) {
    if (isConnected) {
      if (eqEnabled.value) setAllGains(eqGains.value)
      return
    }
    if (eqEnabled.value) {
      insertEQ(node, ctx, eqGains.value)
    } else {
      // Store for later when EQ is enabled
      inputNode = node
      audioCtx = ctx
    }
  }

  function toggleEQ() {
    eqEnabled.value = !eqEnabled.value
    if (eqEnabled.value) {
      // Enable: insert EQ chain if we have a node reference
      if (inputNode && audioCtx && !isConnected) {
        insertEQ(inputNode, audioCtx, eqGains.value)
      }
    } else {
      // Disable: remove EQ chain
      removeEQ()
    }
    saveSettings({
      enabled: eqEnabled.value,
      gains: [...eqGains.value],
      presetName: eqPresetName.value,
    })
  }

  function setGain(bandIndex: number, gainDb: number) {
    const clamped = Math.max(-12, Math.min(12, gainDb))
    eqGains.value[bandIndex] = clamped
    setBandGain(bandIndex, clamped)
    eqPresetName.value = 'custom'
    saveSettings({
      enabled: eqEnabled.value,
      gains: [...eqGains.value],
      presetName: eqPresetName.value,
    })
  }

  function applyPreset(preset: EQPreset) {
    eqGains.value = [...preset.gains]
    eqPresetName.value = preset.name
    setAllGains(preset.gains)
    saveSettings({
      enabled: eqEnabled.value,
      gains: [...eqGains.value],
      presetName: eqPresetName.value,
    })
  }

  function disconnect() {
    removeEQ()
  }

  return {
    eqEnabled,
    eqGains,
    eqPresetName,
    EQ_BANDS,
    EQ_PRESETS,
    tryConnect,
    connectToNode,
    toggleEQ,
    setGain,
    applyPreset,
    disconnect,
  }
}
