import { Database as SqlJsDatabase } from 'sql.js'

export function runMigrations(db: SqlJsDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `)

  const versionResult = db.exec('SELECT MAX(version) as version FROM schema_version')
  let version = 0
  if (versionResult.length > 0 && versionResult[0].values.length > 0) {
    version = (versionResult[0].values[0][0] as number) ?? 0
  }

  const migrations: Record<number, string> = {
    1: `
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT 'Unknown Artist',
        album TEXT NOT NULL DEFAULT 'Unknown Album',
        duration REAL NOT NULL DEFAULT 0,
        cover_path TEXT,
        source TEXT NOT NULL DEFAULT 'local',
        source_id TEXT,
        local_path TEXT NOT NULL,
        lyrics_path TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_played_at TEXT
      );

      CREATE TABLE IF NOT EXISTS cached_exercises (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        chinese_name TEXT,
        body_part TEXT NOT NULL,
        body_part_zh TEXT,
        equipment TEXT NOT NULL,
        equipment_zh TEXT,
        target TEXT NOT NULL,
        target_zh TEXT,
        gif_url TEXT,
        instructions TEXT,
        precautions_zh TEXT,
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS workout_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        body_part TEXT,
        equipment TEXT,
        exercises TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS workout_records (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        plan_id TEXT,
        plan_name TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        calories_burned REAL,
        exercises TEXT NOT NULL DEFAULT '[]',
        completed INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    2: `
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cover_path TEXT,
        description TEXT,
        track_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (playlist_id, track_id),
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pid
        ON playlist_tracks(playlist_id, position);
    `,
    3: `
      -- Track ExerciseDB sync state for resume-on-next-startup logic.
      -- status: 'pending' | 'completed' | 'partial'
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    4: `
      -- Add content_hash column for deduplication of local music files.
      -- Allows detecting duplicate audio files by content (not just by path),
      -- enabling "file link" behavior to avoid duplicate storage.
      ALTER TABLE tracks ADD COLUMN content_hash TEXT;
      CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash);
    `
  }

  for (let v = version + 1; v <= Object.keys(migrations).length; v++) {
    const sql = migrations[v]
    if (sql) {
      db.run(sql)
      db.run('INSERT INTO schema_version (version) VALUES (?)', [v])
    }
  }
}
