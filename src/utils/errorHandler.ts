/**
 * Unified Error Handling Utilities
 *
 * Provides consistent error handling patterns across the app:
 * - `safeAsync`: wrap async operations with structured error capture
 * - `safeSync`: wrap sync operations with structured error capture
 * - `logError`: categorized error logging with context
 * - `userFacingError`: create errors that include user-readable messages
 *
 * Usage guidelines:
 *   1. Never use bare `catch {}` — always at least log via `logError`
 *   2. For user-facing operations, use `safeAsync` + check result
 *   3. For background tasks, use `safeAsync` + log on failure
 *   4. For IPC handlers, return `{ success: false, error: message }`
 */

/** Error categories for structured logging */
export type ErrorCategory =
  | 'audio'        // Audio playback / analysis errors
  | 'cache'        // Cache read/write errors
  | 'network'      // Network/API errors (Netease, ExerciseDB)
  | 'database'     // SQLite operations
  | 'filesystem'   // File I/O
  | 'render'       // WebGL / Three.js rendering
  | 'validation'   // Input validation
  | 'unknown'

/** Structured error result */
export interface ErrorResult {
  success: false
  error: string
  category: ErrorCategory
  cause?: unknown
}

/** Success result */
export interface SuccessResult<T = void> {
  success: true
  data: T
}

/** Union result type for operations that can fail */
export type Result<T = void> = SuccessResult<T> | ErrorResult

/**
 * Wrap an async operation with structured error capture.
 * Never throws — returns a Result union.
 *
 * @example
 * const result = await safeAsync(() => fetchData(), 'cache')
 * if (!result.success) { logError(result.error, result.category); return }
 * return result.data
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  category: ErrorCategory = 'unknown',
): Promise<Result<T>> {
  try {
    const data = await fn()
    return { success: true, data }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: message, category, cause: e }
  }
}

/**
 * Wrap a sync operation with structured error capture.
 * Never throws — returns a Result union.
 */
export function safeSync<T>(
  fn: () => T,
  category: ErrorCategory = 'unknown',
): Result<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: message, category, cause: e }
  }
}

/**
 * Categorized error logger.
 * Uses console.warn for expected errors, console.error for unexpected ones.
 *
 * @param message Human-readable error description
 * @param category Error category for filtering
 * @param cause Original error object (optional)
 */
export function logError(
  message: string,
  category: ErrorCategory = 'unknown',
  cause?: unknown,
): void {
  const prefix = `[${category}]`
  const detail = cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : cause != null ? String(cause) : ''

  // 'validation' and 'network' are expected error types → warn
  // all others are unexpected → error
  if (category === 'validation' || category === 'network') {
    if (detail) {
      console.warn(`${prefix} ${message}`, detail)
    } else {
      console.warn(`${prefix} ${message}`)
    }
  } else {
    if (detail) {
      console.error(`${prefix} ${message}`, detail)
    } else {
      console.error(`${prefix} ${message}`)
    }
  }
}

/**
 * Create a user-facing error with a readable message.
 * Use for errors that should be displayed to the user.
 */
export function userFacingError(
  message: string,
  category: ErrorCategory = 'unknown',
  cause?: unknown,
): ErrorResult {
  return { success: false, error: message, category, cause }
}

/**
 * Type guard: checks if a Result is an error.
 */
export function isError<T>(result: Result<T>): result is ErrorResult {
  return !result.success
}

/**
 * Type guard: checks if a Result is successful.
 */
export function isSuccess<T>(result: Result<T>): result is SuccessResult<T> {
  return result.success
}
