import { ipcMain, BrowserWindow } from 'electron'
import { queryAll, queryOne, exec, persistDatabase } from '../db'
import { ExerciseService, type SyncResult } from '../services/exerciseService'

const exerciseService = new ExerciseService()

export function registerFitnessIPC() {
  // Exercise IPC
  ipcMain.handle('exercise:sync', async (event) => {
    try {
      const sender = BrowserWindow.fromWebContents(event.sender)
      const result = await exerciseService.syncFromAPI((progress) => {
        // Push incremental progress to the renderer
        if (sender && !sender.isDestroyed()) {
          sender.webContents.send('exercise:syncProgress', progress)
        }
      })
      return { success: true, data: result }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Check sync status — used by frontend to decide if auto-sync is needed
  ipcMain.handle('exercise:syncStatus', async () => {
    try {
      return { success: true, data: { status: exerciseService.getSyncStatus() } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Background sync — same as exercise:sync but always runs (even if data exists)
  // Used for auto-resuming incomplete syncs on app startup
  ipcMain.handle('exercise:autoSync', async (event) => {
    try {
      // Only sync if not already completed
      if (!exerciseService.needsSync()) {
        return { success: true, data: { skipped: true } }
      }
      const sender = BrowserWindow.fromWebContents(event.sender)
      const result = await exerciseService.syncFromAPI((progress) => {
        if (sender && !sender.isDestroyed()) {
          sender.webContents.send('exercise:syncProgress', progress)
        }
      })
      return { success: true, data: result }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('exercise:list', async (_event, filter?: any) => {
    try {
      const exercises = exerciseService.list(filter)
      return { success: true, data: { exercises } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('exercise:getById', async (_event, id: string) => {
    try {
      const exercise = exerciseService.getById(id)
      return { success: true, data: { exercise } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('exercise:count', async () => {
    try {
      const count = exerciseService.count()
      return { success: true, data: { count } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('exercise:getBodyParts', async () => {
    try {
      const bodyParts = exerciseService.getBodyParts()
      return { success: true, data: { bodyParts } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('exercise:getEquipments', async () => {
    try {
      const equipments = exerciseService.getEquipments()
      return { success: true, data: { equipments } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Workout IPC
  ipcMain.handle('workout:createPlan', async (_event, plan: any) => {
    try {
      // 验证计划名称
      const name = (plan.name || '').trim()
      if (!name) {
        return { success: false, error: '计划名称不能为空' }
      }
      if (name.length > 50) {
        return { success: false, error: '计划名称不能超过50个字符' }
      }
      // 验证动作列表
      if (!plan.exercises || !Array.isArray(plan.exercises) || plan.exercises.length === 0) {
        return { success: false, error: '至少需要选择一个动作' }
      }
      // 检查重名（大小写不敏感，去除前后空格）
      const existing = queryOne('SELECT id FROM workout_plans WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [name])
      if (existing) {
        return { success: false, error: '已存在同名计划，请使用不同的名称' }
      }

      const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      exec(`
        INSERT INTO workout_plans (id, name, body_part, equipment, exercises, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [id, name, plan.bodyPart || null, plan.equipment || null, JSON.stringify(plan.exercises || [])])
      persistDatabase()

      const created = queryOne('SELECT * FROM workout_plans WHERE id = ?', [id])
      return { success: true, data: { plan: created } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workout:listPlans', async () => {
    try {
      const plans = queryAll('SELECT * FROM workout_plans ORDER BY updated_at DESC')
      return { success: true, data: { plans } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workout:getPlan', async (_event, id: string) => {
    try {
      const plan = queryOne('SELECT * FROM workout_plans WHERE id = ?', [id])
      return { success: true, data: { plan } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workout:deletePlan', async (_event, id: string) => {
    try {
      exec('DELETE FROM workout_plans WHERE id = ?', [id])
      persistDatabase()
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workout:updatePlan', async (_event, id: string, plan: any) => {
    try {
      // 验证计划名称
      const name = (plan.name || '').trim()
      if (!name) {
        return { success: false, error: '计划名称不能为空' }
      }
      if (name.length > 50) {
        return { success: false, error: '计划名称不能超过50个字符' }
      }
      // 验证动作列表
      if (!plan.exercises || !Array.isArray(plan.exercises) || plan.exercises.length === 0) {
        return { success: false, error: '至少需要选择一个动作' }
      }
      // 检查重名（排除自身）
      const existing = queryOne('SELECT id FROM workout_plans WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ? LIMIT 1', [name, id])
      if (existing) {
        return { success: false, error: '已存在同名计划，请使用不同的名称' }
      }

      exec(`
        UPDATE workout_plans
        SET name = ?, body_part = ?, equipment = ?, exercises = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [name, plan.bodyPart || null, plan.equipment || null, JSON.stringify(plan.exercises || []), id])
      persistDatabase()

      const updated = queryOne('SELECT * FROM workout_plans WHERE id = ?', [id])
      return { success: true, data: { plan: updated } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workout:createRecord', async (_event, record: any) => {
    try {
      const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      exec(`
        INSERT INTO workout_records (id, date, plan_id, plan_name, duration_seconds, calories_burned, exercises, completed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [
        id, record.date, record.planId || null, record.planName,
        record.durationSeconds, record.caloriesBurned || null,
        JSON.stringify(record.exercises || []), record.completed ? 1 : 0
      ])
      persistDatabase()

      const created = queryOne('SELECT * FROM workout_records WHERE id = ?', [id])
      return { success: true, data: { record: created } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workout:listRecords', async () => {
    try {
      const records = queryAll('SELECT * FROM workout_records ORDER BY created_at DESC LIMIT 50')
      return { success: true, data: { records } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workout:getStats', async () => {
    try {
      const todayTotal = queryOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM workout_records WHERE date = date('now')"
      )
      const weekDuration = queryOne<{ total: number }>(
        "SELECT COALESCE(SUM(duration_seconds), 0) as total FROM workout_records WHERE date >= date('now', '-7 days')"
      )
      const weekHeatmap = queryAll<{ date: string; count: number }>(`
        SELECT date, COUNT(*) as count
        FROM workout_records
        WHERE date >= date('now', '-6 days')
        GROUP BY date
        ORDER BY date
      `)

      return {
        success: true,
        data: {
          stats: {
            todayWorkouts: todayTotal?.count ?? 0,
            weekDurationSeconds: weekDuration?.total ?? 0,
            weekHeatmap
          }
        }
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
