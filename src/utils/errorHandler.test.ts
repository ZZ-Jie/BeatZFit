import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  safeAsync,
  safeSync,
  logError,
  userFacingError,
  isError,
  isSuccess,
} from './errorHandler'

describe('safeAsync', () => {
  it('wraps successful async operations', async () => {
    const result = await safeAsync(async () => 42, 'cache')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe(42)
    }
  })

  it('captures errors from async operations', async () => {
    const result = await safeAsync(async () => {
      throw new Error('Disk full')
    }, 'cache')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Disk full')
      expect(result.category).toBe('cache')
      expect(result.cause).toBeInstanceOf(Error)
    }
  })

  it('handles non-Error throws', async () => {
    const result = await safeAsync(async () => {
      throw 'string error'
    }, 'audio')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('string error')
      expect(result.category).toBe('audio')
    }
  })

  it('uses unknown category by default', async () => {
    const result = await safeAsync(async () => {
      throw new Error('test')
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.category).toBe('unknown')
    }
  })
})

describe('safeSync', () => {
  it('wraps successful sync operations', () => {
    const result = safeSync(() => 'hello', 'filesystem')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('hello')
    }
  })

  it('captures sync errors', () => {
    const result = safeSync(() => {
      throw new Error('Parse failed')
    }, 'database')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Parse failed')
      expect(result.category).toBe('database')
    }
  })
})

describe('logError', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('uses console.warn for validation errors', () => {
    logError('Invalid input', 'validation')
    expect(warnSpy).toHaveBeenCalledWith('[validation] Invalid input')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('uses console.warn for network errors', () => {
    logError('Connection timeout', 'network')
    expect(warnSpy).toHaveBeenCalledWith('[network] Connection timeout')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('uses console.error for unexpected errors', () => {
    logError('Audio context lost', 'audio')
    expect(errorSpy).toHaveBeenCalledWith('[audio] Audio context lost')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('includes cause detail when provided', () => {
    const cause = new Error('Underlying issue')
    logError('Operation failed', 'cache', cause)
    expect(errorSpy).toHaveBeenCalledWith(
      '[cache] Operation failed',
      'Error: Underlying issue',
    )
  })

  it('handles non-Error cause', () => {
    logError('Failed', 'audio', 'some string')
    expect(errorSpy).toHaveBeenCalledWith(
      '[audio] Failed',
      'some string',
    )
  })
})

describe('userFacingError', () => {
  it('creates an ErrorResult with message', () => {
    const result = userFacingError('Unable to load track', 'audio')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Unable to load track')
    expect(result.category).toBe('audio')
  })

  it('includes cause when provided', () => {
    const cause = new TypeError('Invalid URL')
    const result = userFacingError('Network request failed', 'network', cause)
    expect(result.cause).toBe(cause)
  })
})

describe('Type guards', () => {
  it('isError returns true for ErrorResult', () => {
    const result = userFacingError('test', 'cache')
    expect(isError(result)).toBe(true)
  })

  it('isError returns false for SuccessResult', () => {
    const result = safeSync(() => 42)
    expect(isError(result)).toBe(false)
  })

  it('isSuccess returns true for SuccessResult', () => {
    const result = safeSync(() => 42)
    expect(isSuccess(result)).toBe(true)
  })

  it('isSuccess returns false for ErrorResult', () => {
    const result = userFacingError('test', 'cache')
    expect(isSuccess(result)).toBe(false)
  })
})
