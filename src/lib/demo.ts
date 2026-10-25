import type { Calibration, Features, SessionRecord } from '@/domain/types'
import { dayRange } from './format'

export const DEMO_FEATURES: Features = { neck: 5, torso: 2, drop: -0.7, shift: 0, shoulders: 0, scale: 0.32, side: 'left' }

export function demoCalibration(): Calibration {
  return { id: 'demo', view: 'front', cameraId: 'demo', createdAt: Date.now(), aspect: 4 / 3, side: 'left', sampleCount: 40, baseline: { ...DEMO_FEATURES } }
}

export function demoRecords(): SessionRecord[] {
  return dayRange(7).map((day, i): SessionRecord => {
    const startedAt = new Date(day + 'T09:30:00').getTime()
    const good = [2520, 3480, 2160, 3960, 3180, 4320, 2880][i] ?? 3000
    const bad = [480, 540, 420, 600, 360, 480, 300][i] ?? 400
    return {
      id: 'sample-' + day, mode: 'demo', startedAt, endedAt: startedAt + (good + bad) * 1000, view: 'front',
      goodSeconds: good, badSeconds: bad, unknownSeconds: 0, absentSeconds: 0, pausedSeconds: 0,
      reminders: Array.from({ length: i % 3 + 1 }, (_, index) => ({ at: startedAt + (index + 1) * 500000, kind: 'posture' as const, message: '坐姿提醒（示例）' })),
      segments: [
        { startedAt, endedAt: startedAt + good * 1000, seconds: good, state: 'normal', reason: '舒适参考坐姿' },
        { startedAt: startedAt + good * 1000, endedAt: startedAt + (good + bad) * 1000, seconds: bad, state: 'bad', reason: '头部低下（示例）' },
      ],
    }
  }).reverse()
}

