export interface TrackRow {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  cover_path: string | null
  source: 'local' | 'netease'
  source_id: string | null
  local_path: string
  lyrics_path: string | null
  added_at: string
  last_played_at: string | null
  content_hash: string | null
}

/** Result of importing files — includes both new tracks and duplicates. */
export interface ImportResult {
  tracks: TrackRow[]
  /** Existing tracks that were already in the library (by path or by content hash). */
  duplicates: TrackRow[]
}

export interface ExerciseRow {
  id: string
  name: string
  chinese_name: string | null
  body_part: string
  body_part_zh: string | null
  equipment: string
  equipment_zh: string | null
  target: string
  target_zh: string | null
  gif_url: string | null
  instructions: string | null
  precautions_zh: string | null
  cached_at: string
}

export interface WorkoutPlanRow {
  id: string
  name: string
  body_part: string | null
  equipment: string | null
  exercises: string
  created_at: string
  updated_at: string
}

export interface WorkoutRecordRow {
  id: string
  date: string
  plan_id: string | null
  plan_name: string
  duration_seconds: number
  calories_burned: number | null
  exercises: string
  completed: number
  created_at: string
}

export interface AppSettingRow {
  key: string
  value: string
  updated_at: string
}

export interface PlaylistRow {
  id: string
  name: string
  cover_path: string | null
  description: string | null
  track_count: number
  created_at: string
  updated_at: string
}

export interface PlaylistTrackRow {
  playlist_id: string
  track_id: string
  position: number
  added_at: string
}
