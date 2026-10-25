import type { Calibration, Features, Landmark, Observation, Settings, TrackingSide, ViewMode } from './types'

const QUALITY = 0.55
const degrees = (radians: number) => radians * 180 / Math.PI
const quality = (p: Landmark | undefined) => p ? Math.min(p.visibility ?? 1, p.presence ?? 1) : 0
const usable = (p: Landmark | undefined): p is Landmark => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && quality(p) >= QUALITY

function angle(lower: Landmark, upper: Landmark, width: number, height: number): number | null {
  const dx = (upper.x - lower.x) * width
  const dy = (lower.y - upper.y) * height
  return dy > 3 ? degrees(Math.atan2(dx, dy)) : null
}

export function observe(points: Landmark[], width: number, height: number, view: ViewMode, fixedSide?: TrackingSide): Observation {
  const unknown = (reason: string, noPerson = false): Observation => ({ valid: false, noPerson, reason, features: null, quality: 0 })
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return unknown('画面尺寸无效，请重新打开摄像头')
  if (!points.length) return unknown('画面里暂时未检测到人', true)
  const nose = points[0]
  const ls = points[11]
  const rs = points[12]
  const leftScore = usable(points[7]) && usable(ls) ? Math.min(quality(points[7]), quality(ls)) : 0
  const rightScore = usable(points[8]) && usable(rs) ? Math.min(quality(points[8]), quality(rs)) : 0
  const side = fixedSide ?? (leftScore >= rightScore ? 'left' : 'right')
  const ear = points[side === 'left' ? 7 : 8]
  const shoulder = points[side === 'left' ? 11 : 12]
  const hip = points[side === 'left' ? 23 : 24]
  if (view === 'front' && (!usable(nose) || !usable(ls) || !usable(rs))) return unknown('请让头部和双肩完整进入画面')
  if (view === 'side' && (!usable(ear) || !usable(shoulder))) return unknown('侧面模式需要看清耳朵和肩膀')
  const centerX = usable(ls) && usable(rs) ? (ls.x + rs.x) / 2 : shoulder?.x ?? 0
  const centerY = usable(ls) && usable(rs) ? (ls.y + rs.y) / 2 : shoulder?.y ?? 0
  const span = usable(ls) && usable(rs) ? Math.hypot((ls.x - rs.x) * width, (ls.y - rs.y) * height) : 0
  const neck = usable(ear) && usable(shoulder) ? angle(shoulder, ear, width, height) : null
  const torso = usable(hip) && usable(shoulder) ? angle(hip, shoulder, width, height) : null
  if (view === 'side' && neck === null) return unknown('请检查侧面摄像头的高度和拍摄范围')
  if (view === 'front' && span < width * 0.08) return unknown('双肩太小或角度偏侧，请调整摄像头')
  const features: Features = {
    neck, torso, side,
    // Front-facing features become ill-conditioned when the shoulders overlap in profile.
    // Side monitoring only uses neck/torso angles; do not derive ratios from that tiny span.
    drop: view === 'front' && usable(nose) && span > 3 ? (nose.y - centerY) * height / span : 0,
    shift: view === 'front' && usable(nose) && span > 3 ? (nose.x - centerX) * width / span : 0,
    shoulders: view === 'front' && usable(ls) && usable(rs) ? degrees(Math.atan2((rs.y - ls.y) * height, Math.abs(rs.x - ls.x) * width)) : 0,
    scale: view === 'front' ? span / width : 0,
  }
  const q = view === 'front' ? Math.min(quality(nose), quality(ls), quality(rs)) : Math.min(quality(ear), quality(shoulder))
  return { valid: true, noPerson: false, reason: '', features, quality: q }
}

export function classify(features: Features, profile: Calibration, settings: Settings): { bad: boolean; reason: string; deviation: number } {
  const baseline = profile.baseline
  const multiplier = 1 / settings.sensitivity
  if (profile.view === 'side') {
    const neckDiff = features.neck !== null && baseline.neck !== null ? Math.abs(features.neck - baseline.neck) : 0
    const torsoDiff = features.torso !== null && baseline.torso !== null ? Math.abs(features.torso - baseline.torso) : 0
    if (neckDiff > 12 * multiplier) return { bad: true, reason: '头颈偏离参考位置', deviation: neckDiff }
    if (torsoDiff > 10 * multiplier) return { bad: true, reason: '身体偏离参考位置', deviation: torsoDiff }
    return { bad: false, reason: '保持舒适的参考坐姿', deviation: neckDiff }
  }
  const drop = features.drop - baseline.drop
  const shift = Math.abs(features.shift - baseline.shift)
  const tilt = Math.abs(features.shoulders - baseline.shoulders)
  const closer = baseline.scale > 0.08 ? features.scale / baseline.scale - 1 : 0
  if (drop > 0.13 * multiplier) return { bad: true, reason: '头部有些低下', deviation: drop * 100 }
  if (tilt > 9 * multiplier || shift > 0.2 * multiplier) return { bad: true, reason: '身体有些侧倾', deviation: Math.max(tilt, shift * 100) }
  if (closer > 0.23 * multiplier) return { bad: true, reason: '身体比参考位置更靠近屏幕', deviation: closer * 100 }
  return { bad: false, reason: '保持舒适的参考坐姿', deviation: Math.max(0, drop * 100) }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] ?? 0 : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

export function makeCalibration(samples: Features[], view: ViewMode, cameraId: string, aspect: number): Calibration {
  const side: TrackingSide = samples.filter((s) => s.side === 'left').length >= samples.length / 2 ? 'left' : 'right'
  const valid = view === 'side' ? samples.filter((s) => s.side === side) : samples
  if (valid.length < 20) throw new Error('有效样本还不够。调整好机位后再试一次。')
  const spread = (values: number[]) => {
    const m = median(values)
    return median(values.map((v) => Math.abs(v - m)))
  }
  if (view === 'front' && (spread(valid.map((s) => s.drop)) > 0.045 || spread(valid.map((s) => s.shoulders)) > 3.5)) {
    throw new Error('刚才的姿态变化较多。保持舒适坐姿，再校准一次。')
  }
  const necks = valid.flatMap((s) => s.neck === null ? [] : [s.neck])
  if (view === 'side' && (necks.length < 20 || spread(necks) > 4)) throw new Error('侧面关键点不够稳定，请调整光线和机位。')
  const torsos = valid.flatMap((s) => s.torso === null ? [] : [s.torso])
  const stableTorso = torsos.length >= Math.max(20, Math.ceil(valid.length / 2)) && spread(torsos) <= 4
  return {
    id: cameraId + ':' + view, view, cameraId, aspect, side, createdAt: Date.now(), sampleCount: valid.length,
    baseline: {
      side, neck: necks.length ? median(necks) : null, torso: stableTorso ? median(torsos) : null,
      drop: median(valid.map((s) => s.drop)), shift: median(valid.map((s) => s.shift)),
      shoulders: median(valid.map((s) => s.shoulders)), scale: median(valid.map((s) => s.scale)),
    },
  }
}

export function smoothFeatures(previous: Features | null, next: Features, dt: number): Features {
  if (!previous || previous.side !== next.side || dt > 1.5) return next
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / 0.35)
  const blend = (a: number, b: number) => a + alpha * (b - a)
  return {
    side: next.side,
    neck: next.neck === null ? null : previous.neck === null ? next.neck : blend(previous.neck, next.neck),
    torso: next.torso === null ? null : previous.torso === null ? next.torso : blend(previous.torso, next.torso),
    drop: blend(previous.drop, next.drop), shift: blend(previous.shift, next.shift),
    shoulders: blend(previous.shoulders, next.shoulders), scale: blend(previous.scale, next.scale),
  }
}

