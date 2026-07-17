/**
 * Convert an exercise GIF URL to a renderer-safe URL.
 *
 * Exercise GIF URLs are stored as `https://static.exercisedb.dev/media/{id}.gif`
 * in the database.  We proxy them through the `beat://` custom protocol so
 * the main process fetches server-side (bypassing renderer CORS).  If the
 * CDN is unreachable, the `beat://` handler automatically falls back to a
 * locally-bundled GIF file.
 *
 * This mirrors the pattern used by `musicStore.toCoverUrl()`.
 */
export function toExerciseMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  // Already a beat:// or data: URL — pass through unchanged
  if (url.startsWith('beat://') || url.startsWith('data:')) return url
  // Wrap remote URLs in beat:// proxy (encodeURIComponent matches the
  // pattern used by musicStore.toCoverUrl / toMediaUrl)
  return `beat://${encodeURIComponent(url)}`
}
