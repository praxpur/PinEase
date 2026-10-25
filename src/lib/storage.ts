import { openDB, type DBSchema } from 'idb'
import { DEFAULT_SETTINGS, type Calibration, type SessionRecord, type Settings } from '@/domain/types'

interface PinEaseDB extends DBSchema {
  preferences: { key: string; value: Settings }
  calibrations: { key: string; value: Calibration }
  sessions: { key: string; value: SessionRecord; indexes: { startedAt: number } }
}

let databasePromise: ReturnType<typeof openDB<PinEaseDB>> | null = null
const db = () => databasePromise ??= openDB<PinEaseDB>('pinease-complete', 1, {
  upgrade(database) {
    database.createObjectStore('preferences')
    database.createObjectStore('calibrations', { keyPath: 'id' })
    const sessions = database.createObjectStore('sessions', { keyPath: 'id' })
    sessions.createIndex('startedAt', 'startedAt')
  },
})

export async function loadData() {
  const database = await db()
  const [settings, calibrations, sessions] = await Promise.all([
    database.get('preferences', 'settings'),
    database.getAll('calibrations'),
    database.getAll('sessions'),
  ])
  return {
    settings: sanitizeSettings(settings ?? {}),
    calibrations: calibrations.filter(validCalibration),
    sessions: sessions.filter(validSession).sort((a, b) => b.startedAt - a.startedAt),
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).put('preferences', JSON.parse(JSON.stringify(settings)) as Settings, 'settings')
}

export async function saveCalibration(profile: Calibration): Promise<void> {
  await (await db()).put('calibrations', JSON.parse(JSON.stringify(profile)) as Calibration)
}

export async function saveSession(record: SessionRecord): Promise<void> {
  await (await db()).put('sessions', JSON.parse(JSON.stringify(record)) as SessionRecord)
}

export async function clearHistory(): Promise<void> {
  await (await db()).clear('sessions')
}

export async function clearCalibrations(): Promise<void> {
  await (await db()).clear('calibrations')
}

function bounded(value: unknown, low: number, high: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback
}

export function sanitizeSettings(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const defaults = DEFAULT_SETTINGS
  const flag = (key: keyof Settings): boolean => typeof v[key] === 'boolean' ? v[key] as boolean : defaults[key] as boolean
  return {
    cameraId: typeof v.cameraId === 'string' ? v.cameraId.slice(0, 256) : '',
    view: v.view === 'side' ? 'side' : 'front',
    showPreview: flag('showPreview'), showSkeleton: flag('showSkeleton'),
    sensitivity: bounded(v.sensitivity, 0.6, 1.6, defaults.sensitivity),
    holdSeconds: bounded(v.holdSeconds, 2, 20, defaults.holdSeconds),
    recoverySeconds: bounded(v.recoverySeconds, 1, 8, defaults.recoverySeconds),
    cooldownSeconds: bounded(v.cooldownSeconds, 15, 300, defaults.cooldownSeconds),
    sitMinutes: bounded(v.sitMinutes, 10, 120, defaults.sitMinutes),
    restSeconds: bounded(v.restSeconds, 20, 300, defaults.restSeconds),
    breakEnabled: flag('breakEnabled'), soundEnabled: flag('soundEnabled'),
    soundVolume: bounded(v.soundVolume, 0, 100, defaults.soundVolume),
    soundRepeats: Math.round(bounded(v.soundRepeats, 1, 3, defaults.soundRepeats)),
    notificationsEnabled: flag('notificationsEnabled'), focusReminder: flag('focusReminder'),
    blinkEnabled: flag('blinkEnabled'), fps: bounded(v.fps, 5, 20, defaults.fps),
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validCalibration(v: unknown): v is Calibration {
  if (!v || typeof v !== 'object') return false
  const p = v as Calibration
  const b = p.baseline
  return typeof p.id === 'string' && (p.view === 'front' || p.view === 'side')
    && typeof p.cameraId === 'string' && finite(p.aspect) && p.aspect > 0
    && finite(p.createdAt) && finite(p.sampleCount) && p.sampleCount >= 20
    && (p.side === 'left' || p.side === 'right') && !!b
    && finite(b.drop) && finite(b.shift) && finite(b.shoulders) && finite(b.scale)
    && (b.neck === null || finite(b.neck)) && (b.torso === null || finite(b.torso))
}

export function validSession(v: unknown): v is SessionRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as SessionRecord
  const states = ['normal', 'candidate_bad', 'bad', 'unknown', 'absent', 'paused', 'need_cal']
  return typeof r.id === 'string' && r.id.length < 150 && r.mode === 'real'
    && finite(r.startedAt) && r.startedAt > 0 && (r.endedAt === null || finite(r.endedAt))
    && (r.view === 'front' || r.view === 'side')
    && [r.goodSeconds, r.badSeconds, r.unknownSeconds, r.absentSeconds, r.pausedSeconds].every((n) => finite(n) && n >= 0)
    && Array.isArray(r.segments) && r.segments.length <= 100000
    && r.segments.every((s) => s && finite(s.startedAt) && finite(s.endedAt) && s.endedAt >= s.startedAt && finite(s.seconds) && s.seconds >= 0 && states.includes(s.state) && typeof s.reason === 'string')
    && Array.isArray(r.reminders) && r.reminders.length <= 10000
    && r.reminders.every((e) => e && finite(e.at) && ['posture', 'break', 'eyes'].includes(e.kind) && typeof e.message === 'string')
}

export async function importHistory(text: string): Promise<number> {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('这不是 PinEase 的备份文件。')
  const source = parsed as { application?: string; schema?: number; sessions?: unknown[] }
  if (source.application !== 'PinEase' || source.schema !== 1 || !Array.isArray(source.sessions) || source.sessions.length > 5000) {
    throw new Error('备份格式不正确或记录数量过多。')
  }
  if (!source.sessions.every(validSession)) throw new Error('备份中有无法识别的记录，未导入。')
  const database = await db()
  const transaction = database.transaction('sessions', 'readwrite')
  for (const session of source.sessions) {
    const existing = await transaction.store.get(session.id)
    const latest = (record: SessionRecord) => record.segments[record.segments.length - 1]?.endedAt ?? record.endedAt ?? record.startedAt
    if (!existing || latest(session) >= latest(existing)) await transaction.store.put(session)
  }
  await transaction.done
  return source.sessions.length
}
