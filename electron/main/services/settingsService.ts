import { queryOne, queryAll, exec, persistDatabase } from '../db'
import type { AppSettingRow } from '../db/schema'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export class SettingsService {
  get(key: string): string | undefined {
    const row = queryOne<AppSettingRow>(
      'SELECT * FROM app_settings WHERE key = ?', [key]
    )
    return row?.value
  }

  set(key: string, value: string): void {
    exec(`
      INSERT OR REPLACE INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `, [key, value])
    persistDatabase()
  }

  getAll(): Record<string, string> {
    const rows = queryAll<AppSettingRow>('SELECT * FROM app_settings')
    const result: Record<string, string> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return result
  }

  reset(): void {
    exec('DELETE FROM app_settings')
    persistDatabase()
  }

  getWindowState(): WindowState {
    const value = this.get('windowState')
    if (value) {
      try {
        return JSON.parse(value)
      } catch {
        // fall through
      }
    }
    return {
      width: 1440,
      height: 920,
      isMaximized: false
    }
  }

  saveWindowState(state: WindowState): void {
    this.set('windowState', JSON.stringify(state))
  }
}
