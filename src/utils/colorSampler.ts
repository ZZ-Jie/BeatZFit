/**
 * Cover / ambient color sampler.
 *
 * Given an image URL, downsamples it, extracts dominant colors via k-means,
 * and returns a palette suitable for tinting LiquidGlass components. Results
 * are cached by URL so repeated lookups (e.g. every time a track is selected)
 * are cheap.
 */

export interface CoverPalette {
  primary: string   // dominant color
  secondary: string // second dominant color
  rim: string       // bright rim light color
  dark: string      // dark shade for subtle backgrounds
  light: string     // light tint for highlights
  vivid: string     // most vivid/saturated color (for lyric tinting)
}

const DEFAULT_PALETTE: CoverPalette = {
primary: '#FFFFFF',
secondary: '#CCCCCC',
rim: '#E8E8E8',
dark: '#1A1A1A',
light: '#F0F0F0',
vivid: '#FFFFFF',
}

const CACHE = new Map<string, CoverPalette>()
const MAX_CACHE_SIZE = 32

export function sampleCoverPalette(url: string | null | undefined): Promise<CoverPalette> {
  if (!url) return Promise.resolve(DEFAULT_PALETTE)

  const cached = CACHE.get(url)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve) => {
    const img = new Image()

    // beat:// is a cross-origin custom protocol; without crossOrigin the
    // canvas becomes tainted and getImageData() throws SecurityError.
    // The beat:// handler returns Access-Control-Allow-Origin: * so CORS
    // always succeeds.  Always set crossOrigin for ALL protocols.
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        const palette = extractPalette(img)
        setCache(url, palette)
        resolve(palette)
      } catch (e) {
        console.warn('[colorSampler] Failed to extract palette:', e)
        resolve(DEFAULT_PALETTE)
      }
    }

    img.onerror = () => {
      resolve(DEFAULT_PALETTE)
    }

    img.src = url
  })
}

function setCache(url: string, palette: CoverPalette): void {
  if (CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = CACHE.keys().next().value
    if (firstKey !== undefined) {
      CACHE.delete(firstKey)
    }
  }
  CACHE.set(url, palette)
}

function extractPalette(img: HTMLImageElement): CoverPalette {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2d context')

  const SIZE = 64
  canvas.width = SIZE
  canvas.height = SIZE
  ctx.drawImage(img, 0, 0, SIZE, SIZE)

  const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
  const pixels: Array<[number, number, number]> = []

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    if (a < 128) continue

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    // Skip near-black / near-white pixels; they don't contribute useful color.
    if (luminance < 18 || luminance > 245) continue

    pixels.push([r, g, b])
  }

  if (pixels.length < 10) return DEFAULT_PALETTE

  const clusters = kMeans(pixels, 5, 15)
  clusters.sort((a, b) => b.size - a.size)

  const primary = clusters[0]?.center ?? DEFAULT_PALETTE.primary
  const secondary = clusters[1]?.center ?? primary
  const rim = lighten(primary, 0.55)
  const dark = darken(primary, 0.55)
  const light = lighten(primary, 0.35)

  // ── Vivid color: weighted blend of top saturated clusters ──
  // Instead of picking just the single most saturated cluster (which can
  // feel flat/monotone), we score ALL clusters by saturation × luminance
  // quality, then blend the top 2-3 together weighted by their score × size.
  // This produces a richer color that reflects the album's full palette.
  // If all clusters are near-gray (low saturation), fall back to white.

  interface ClusterScore {
    center: [number, number, number]
    score: number
    weight: number
  }

  const scored: ClusterScore[] = []
  for (const c of clusters) {
    if (c.size < 5) continue // skip tiny clusters
    const [r, g, b] = c.center
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx // 0=gray, 1=fully saturated
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    // Score: saturation * (1 - distance from mid-luminance)
    // Prefers vivid colors that are not too dark or too bright
    const lumScore = 1 - Math.abs(lum - 128) / 128
    const score = sat * 0.7 + lumScore * 0.3
    // Weight = score × cluster size — bigger & more vivid clusters dominate
    scored.push({ center: c.center, score, weight: score * c.size })
  }

  // Need at least one scored cluster
  if (scored.length === 0) {
    return {
      primary: rgbToHex(primary),
      secondary: rgbToHex(secondary),
      rim: rgbToHex(rim),
      dark: rgbToHex(dark),
      light: rgbToHex(light),
      vivid: '#FFFFFF',
    }
  }

  // Sort by weight descending, take top clusters (up to 3)
  scored.sort((a, b) => b.weight - a.weight)
  const topClusters = scored.slice(0, Math.min(3, scored.length))

  // Weighted average of the top clusters' RGB values
  let totalWeight = 0
  let blendR = 0, blendG = 0, blendB = 0
  for (const cs of topClusters) {
    blendR += cs.center[0] * cs.weight
    blendG += cs.center[1] * cs.weight
    blendB += cs.center[2] * cs.weight
    totalWeight += cs.weight
  }
  const vivid: [number, number, number] = totalWeight > 0
    ? [Math.round(blendR / totalWeight), Math.round(blendG / totalWeight), Math.round(blendB / totalWeight)]
    : primary

  // If the blended vivid color is too desaturated, use white for readability
  const [vr, vg, vb] = vivid
  const vmx = Math.max(vr, vg, vb)
  const vmn = Math.min(vr, vg, vb)
  const vividSat = vmx === 0 ? 0 : (vmx - vmn) / vmx
  const vividLum = 0.2126 * vr + 0.7152 * vg + 0.0722 * vb
  let vividResult: [number, number, number]
  if (vividSat < 0.12 || vividLum < 25) {
    // Near-gray or near-black album → use white for lyric readability
    vividResult = [255, 255, 255]
  } else {
    // Boost saturation and ensure minimum brightness
    vividResult = boostColor(vivid)
  }

  return {
    primary: rgbToHex(primary),
    secondary: rgbToHex(secondary),
    rim: rgbToHex(rim),
    dark: rgbToHex(dark),
    light: rgbToHex(light),
    vivid: rgbToHex(vividResult),
  }
}

function kMeans(
  pixels: Array<[number, number, number]>,
  k: number,
  maxIterations: number
): Array<{ center: [number, number, number]; size: number }> {
  // Seed centroids by picking pixels spread across the sorted luminance range.
  const sorted = [...pixels].sort((a, b) => luminance(a) - luminance(b))
  const step = Math.max(1, Math.floor(sorted.length / k))
  let centroids: Array<[number, number, number]> = []
  for (let i = 0; i < k; i++) {
    centroids.push(sorted[Math.min(i * step, sorted.length - 1)])
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    const sums: Array<[number, number, number]> = Array.from({ length: k }, () => [0, 0, 0])
    const counts = new Array(k).fill(0)

    for (const p of pixels) {
      let bestIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < k; i++) {
        const dist = colorDistance(p, centroids[i])
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = i
        }
      }
      sums[bestIdx][0] += p[0]
      sums[bestIdx][1] += p[1]
      sums[bestIdx][2] += p[2]
      counts[bestIdx]++
    }

    const newCentroids: Array<[number, number, number]> = []
    for (let i = 0; i < k; i++) {
      if (counts[i] === 0) {
        newCentroids.push(centroids[i])
      } else {
        newCentroids.push([
          Math.round(sums[i][0] / counts[i]),
          Math.round(sums[i][1] / counts[i]),
          Math.round(sums[i][2] / counts[i]),
        ])
      }
    }

    if (centroids.every((c, i) => colorDistance(c, newCentroids[i]) < 1)) {
      break
    }
    centroids = newCentroids
  }

  const sums: Array<[number, number, number]> = Array.from({ length: k }, () => [0, 0, 0])
  const counts = new Array(k).fill(0)
  for (const p of pixels) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < k; i++) {
      const dist = colorDistance(p, centroids[i])
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    sums[bestIdx][0] += p[0]
    sums[bestIdx][1] += p[1]
    sums[bestIdx][2] += p[2]
    counts[bestIdx]++
  }

  return centroids.map((center, i) => ({
    center: counts[i] > 0
      ? [
          Math.round(sums[i][0] / counts[i]),
          Math.round(sums[i][1] / counts[i]),
          Math.round(sums[i][2] / counts[i]),
        ]
      : center,
    size: counts[i],
  }))
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) +
    Math.pow(a[1] - b[1], 2) +
    Math.pow(a[2] - b[2], 2)
  )
}

function lighten([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  return [
    Math.round(r + (255 - r) * amount),
    Math.round(g + (255 - g) * amount),
    Math.round(b + (255 - b) * amount),
  ]
}

function darken([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  return [
    Math.round(r * (1 - amount)),
    Math.round(g * (1 - amount)),
    Math.round(b * (1 - amount)),
  ]
}

/**
 * Boost a color's saturation and ensure minimum brightness for readability.
 * Converts RGB → HSL, increases saturation, clamps lightness to a readable
 * range, then converts back to RGB.
 */
function boostColor([r, g, b]: [number, number, number]): [number, number, number] {
  // RGB → HSL
  const rn = r / 255, gn = g / 255, bn = b / 255
  const mx = Math.max(rn, gn, bn)
  const mn = Math.min(rn, gn, bn)
  let h = 0, s = 0
  const l = (mx + mn) / 2

  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    switch (mx) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break
      case gn: h = (bn - rn) / d + 2; break
      case bn: h = (rn - gn) / d + 4; break
    }
    h *= 60
  }

  // Boost saturation: ensure at least 0.5, scale up by 1.3
  s = Math.min(1, Math.max(0.5, s * 1.3))
  // Clamp lightness to readable range: 0.55–0.75
  const lClamped = Math.max(0.55, Math.min(0.75, l))

  // HSL → RGB
  const c = (1 - Math.abs(2 * lClamped - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lClamped - c / 2
  let r1 = 0, g1 = 0, b1 = 0
  if (h < 60) { r1 = c; g1 = x; b1 = 0 }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0 }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }

  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
