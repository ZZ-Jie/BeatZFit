/**
 * LRC 歌词解析器
 * 支持 [mm:ss.xx] 和 [mm:ss] 格式
 * 支持翻译歌词（由 netease service 传递的 tlyric）
 */

export interface LyricsLine {
  timestamp: number // seconds
  text: string
  translation?: string
}

export interface ParsedLyrics {
  lines: LyricsLine[]
  source: 'file' | 'online' | 'manual' | 'embedded'
  hasTranslation: boolean
}

interface RawLine extends LyricsLine {
  /** Original appearance order (line index in the source LRC) used as a
   * stable tiebreaker when timestamps are equal — keeps the parser from
   * shuffling lines that share a timestamp but were authored in a fixed
   * sequence in the source. */
  order: number
}

/**
 * Parse raw LRC string into structured lines
 */
export function parseLRC(lrcRaw: string, tlyricRaw?: string): ParsedLyrics {
  const lines = parseLyricText(lrcRaw)
  const translations = tlyricRaw ? parseLyricText(tlyricRaw) : []

  // Match translations to lines by timestamp. Netease's translation track is
  // often misaligned with the main lyric by tens to hundreds of milliseconds,
  // and occasionally segmented differently — so we widen the tolerance and
  // pick the nearest translation instead of requiring a near-exact match.
  const mergedLines: LyricsLine[] = lines.map((line) => {
    let best: RawLine | undefined
    let bestDelta = Infinity
    for (const t of translations) {
      const d = Math.abs(t.timestamp - line.timestamp)
      if (d < bestDelta) {
        bestDelta = d
        best = t
      }
    }
    // 0.5s tolerance: large enough to absorb common Netease drift, small
    // enough to avoid pulling in unrelated adjacent translations.
    const translation = bestDelta <= 0.5 ? best?.text : undefined
    return {
      timestamp: line.timestamp,
      text: line.text,
      translation,
    }
  })

  return {
    lines: mergedLines,
    source: 'online',
    hasTranslation: mergedLines.some((l) => !!l.translation),
  }
}

function parseLyricText(text: string): RawLine[] {
  if (!text) return []

  const lines: RawLine[] = []
  const timeRegex = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\]/g
  const rawLines = text.split('\n')
  let order = 0 // global appearance counter for stable sorting

  for (const raw of rawLines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Reset regex state since matchAll with a global regex is fine, but we
    // re-run replace below using the same instance — be explicit.
    timeRegex.lastIndex = 0
    const matches = [...trimmed.matchAll(timeRegex)]
    if (matches.length === 0) continue

    // Strip all timestamp tags from the visible text. Keep the remainder
    // as-is (may be empty for instrumental/interlude placeholder lines).
    timeRegex.lastIndex = 0
    const textPart = trimmed.replace(timeRegex, '').trim()

    for (const match of matches) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
      const timestamp = minutes * 60 + seconds + ms / 1000

      lines.push({ timestamp, text: textPart, order: order++ })
    }
  }

  // Stable sort by timestamp, using the original appearance order as a
  // tiebreaker. The LRC source is already time-ordered in practice; a plain
  // `sort((a,b) => a.timestamp - b.timestamp)` is NOT stable in V8 for equal
  // keys, which previously shuffled multi-timestamp lines and same-timestamp
  // verses out of their authored order.
  lines.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order)

  return lines
}

/**
 * Simple LRC validation
 */
export function isValidLRC(text: string): boolean {
  return /\[\d{2}:\d{2}[.:]\d{2,3}\]/.test(text)
}

/**
 * Find the current line index for the given time
 */
export function findCurrentLine(lines: LyricsLine[], timeInSeconds: number): number {
  if (lines.length === 0) return -1

  let currentIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timestamp <= timeInSeconds) {
      currentIndex = i
    } else {
      break
    }
  }

  return currentIndex
}

/**
 * Convert parsed lyrics back into a file-savable format
 */
export function serializeLRC(lines: LyricsLine[]): string {
  return lines.map(l => {
    const min = Math.floor(l.timestamp / 60)
    const sec = Math.floor(l.timestamp % 60)
    const ms = Math.floor((l.timestamp % 1) * 100)
    return `[${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}]${l.text}`
  }).join('\n')
}
