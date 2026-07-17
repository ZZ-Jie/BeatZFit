import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from 'sql.js'
import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { runMigrations } from './migrations'

let SQL: SqlJsStatic | null = null
let db: SqlJsDatabase | null = null
let dbPath: string = ''

export function getDatabasePath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'beatzfit.db')
}

export async function initDatabase(): Promise<SqlJsDatabase> {
  if (db) return db

  SQL = await initSqlJs()
  dbPath = getDatabasePath()

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  runMigrations(db)
  persistDatabase()

  return db
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function persistDatabase(): void {
  if (!db) return

  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(dbPath, buffer)
}

// Helper: run a query that returns rows (SELECT)
export function queryAll<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
  const database = getDatabase()
  const stmt = database.prepare(sql)
  try {
    if (params.length > 0) stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as T
      rows.push(row)
    }
    return rows
  } finally {
    stmt.free()
  }
}

// Helper: run a query that returns a single row
export function queryOne<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): T | undefined {
  const database = getDatabase()
  const stmt = database.prepare(sql)
  try {
    if (params.length > 0) stmt.bind(params)
    if (stmt.step()) {
      return stmt.getAsObject() as T
    }
    return undefined
  } finally {
    stmt.free()
  }
}

// Helper: execute a mutation (INSERT/UPDATE/DELETE)
//
// NOTE: This does NOT auto-persist to disk.  Callers must call
// persistDatabase() explicitly after batch operations.  This is
// critical for performance — persisting on every INSERT would
// cause 1500 full DB exports during exercise sync.
export function exec(sql: string, params: SqlValue[] = []): void {
  const database = getDatabase()
  database.run(sql, params)
}

export function closeDatabase(): void {
  if (db) {
    persistDatabase()
    db.close()
    db = null
  }
}
