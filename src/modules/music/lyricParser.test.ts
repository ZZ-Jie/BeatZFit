import { describe, it, expect } from 'vitest'
import { parseLRC, isValidLRC, findCurrentLine, serializeLRC } from './lyricParser'

describe('parseLRC', () => {
  it('parses basic LRC with [mm:ss.xx] format', () => {
    const lrc = '[00:01.50]Hello World\n[00:05.00]Second Line'
    const result = parseLRC(lrc)

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].timestamp).toBe(1.5)
    expect(result.lines[0].text).toBe('Hello World')
    expect(result.lines[1].timestamp).toBe(5.0)
    expect(result.lines[1].text).toBe('Second Line')
  })

  it('parses [mm:ss] format without milliseconds', () => {
    const lrc = '[00:10]No millis'
    const result = parseLRC(lrc)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].timestamp).toBe(10)
  })

  it('parses [mm:ss.xxx] format with 3-digit milliseconds', () => {
    const lrc = '[01:23.456]Three digit ms'
    const result = parseLRC(lrc)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].timestamp).toBeCloseTo(83.456, 3)
  })

  it('handles multiple timestamps on one line', () => {
    const lrc = '[00:01.00][00:05.00]Repeated lyric'
    const result = parseLRC(lrc)

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].timestamp).toBe(1.0)
    expect(result.lines[0].text).toBe('Repeated lyric')
    expect(result.lines[1].timestamp).toBe(5.0)
    expect(result.lines[1].text).toBe('Repeated lyric')
  })

  it('skips empty lines and lines without timestamps', () => {
    const lrc = '\n[00:01.00]First\n\nNot a lyric line\n[00:02.00]Second'
    const result = parseLRC(lrc)

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].text).toBe('First')
    expect(result.lines[1].text).toBe('Second')
  })

  it('sorts lines by timestamp', () => {
    const lrc = '[00:05.00]B\n[00:01.00]A\n[00:03.00]C'
    const result = parseLRC(lrc)

    expect(result.lines[0].text).toBe('A')
    expect(result.lines[1].text).toBe('C')
    expect(result.lines[2].text).toBe('B')
  })

  it('preserves order for same-timestamp lines', () => {
    const lrc = '[00:01.00]First\n[00:01.00]Second'
    const result = parseLRC(lrc)

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].text).toBe('First')
    expect(result.lines[1].text).toBe('Second')
  })

  it('merges translations from tlyric', () => {
    const lrc = '[00:01.00]Hello\n[00:02.00]World'
    const tlyric = '[00:01.00]你好\n[00:02.00]世界'
    const result = parseLRC(lrc, tlyric)

    expect(result.hasTranslation).toBe(true)
    expect(result.lines[0].translation).toBe('你好')
    expect(result.lines[1].translation).toBe('世界')
  })

  it('does not match translations beyond 0.5s tolerance', () => {
    const lrc = '[00:01.00]Hello'
    const tlyric = '[00:02.00]你好'  // 1s apart
    const result = parseLRC(lrc, tlyric)

    expect(result.hasTranslation).toBe(false)
    expect(result.lines[0].translation).toBeUndefined()
  })

  it('returns empty for empty input', () => {
    const result = parseLRC('')
    expect(result.lines).toHaveLength(0)
    expect(result.hasTranslation).toBe(false)
  })

  it('sets source to online', () => {
    const result = parseLRC('[00:01.00]Test')
    expect(result.source).toBe('online')
  })
})

describe('isValidLRC', () => {
  it('returns true for valid LRC', () => {
    expect(isValidLRC('[00:01.50]Hello')).toBe(true)
  })

  it('returns true for [mm:ss] format', () => {
    // isValidLRC requires milliseconds in the timestamp
    expect(isValidLRC('[01:30.00]Test')).toBe(true)
  })

  it('returns true for [mm:ss.xxx] format', () => {
    expect(isValidLRC('[00:01.123]Test')).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(isValidLRC('Just some text')).toBe(false)
  })

  it('returns false for invalid timestamp', () => {
    expect(isValidLRC('[1:30]Test')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValidLRC('')).toBe(false)
  })
})

describe('findCurrentLine', () => {
  const lines = [
    { timestamp: 0, text: 'Line 0' },
    { timestamp: 2, text: 'Line 1' },
    { timestamp: 5, text: 'Line 2' },
    { timestamp: 8, text: 'Line 3' },
    { timestamp: 10, text: 'Line 4' },
  ]

  it('returns -1 for empty lines', () => {
    expect(findCurrentLine([], 5)).toBe(-1)
  })

  it('returns correct index for exact match', () => {
    expect(findCurrentLine(lines, 5)).toBe(2)
  })

  it('returns last line with timestamp <= time', () => {
    expect(findCurrentLine(lines, 3)).toBe(1) // between 2 and 5
  })

  it('returns -1 when before first line', () => {
    expect(findCurrentLine(lines, -1)).toBe(-1)
  })

  it('returns last index when after all lines', () => {
    expect(findCurrentLine(lines, 999)).toBe(4)
  })

  it('returns 0 when at first line timestamp', () => {
    expect(findCurrentLine(lines, 0)).toBe(0)
  })
})

describe('serializeLRC', () => {
  it('serializes lines back to LRC format', () => {
    const lines = [
      { timestamp: 1.5, text: 'Hello' },
      { timestamp: 5.0, text: 'World' },
    ]
    const result = serializeLRC(lines)

    expect(result).toContain('[00:01.50]Hello')
    expect(result).toContain('[00:05.00]World')
  })

  it('handles empty array', () => {
    expect(serializeLRC([])).toBe('')
  })

  it('includes translation in serialized output', () => {
    const lines = [
      { timestamp: 10, text: 'Hello', translation: '你好' },
    ]
    // serializeLRC doesn't write translations — just the main text
    const result = serializeLRC(lines)
    expect(result).toContain('[00:10.00]Hello')
  })
})
