import type { Calibration, Features, Landmark, Observation, Settings, TrackingSide, ViewMode } from './types'

export const POSTURE_FEATURE_VERSION = 2

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
  const leftEar = points[7]
  const rightEar = points[8]
  const frontHead = view === 'front' && usable(leftEar) && usable(rightEar)
  const earX = frontHead ? (leftEar.x + rightEar.x) / 2 : usable(ear) ? ear.x : null
  const earY = frontHead ? (leftEar.y + rightEar.y) / 2 : view === 'side' && usable(ear) ? ear.y : null
  const earSpan = frontHead ? Math.abs(rightEar.x - leftEar.x) * width : 0
  const noseEarX = usable(nose) && earX !== null ? Math.abs(nose.x - earX) * width : 0
  // Frontal yaw can shrink the ear span and masquerade as pitch: only use centered, visible ears.
  const pitchVisible = usable(nose) && earY !== null && (view === 'front'
    ? frontHead && earSpan >= width * 0.04 && noseEarX < earSpan * 0.35
    : noseEarX >= width * 0.025)
  const headPitch = pitchVisible ? degrees(Math.atan2((nose.y - earY!) * height, view === 'front' ? earSpan / 2 : noseEarX)) : null
  const headSize = pitchVisible ? Math.hypot(noseEarX, (nose.y - earY!) * height) : 0
  const verticalScale = view === 'front' ? span : headSize
  const headShoulderY = view === 'front' ? centerY : shoulder!.y
  const leftHip = points[23]
  const rightHip = points[24]
  const hipY = view === 'front'
    ? usable(leftHip) && usable(rightHip) ? (leftHip.y + rightHip.y) / 2 : null
    : usable(hip) ? hip.y : null
  // Relative heights remove global y translation; a body scale removes uniform camera zoom.
  // Side-view scale uses the nose-ear length, never the near-zero overlapping shoulder span.
  const neckHeight = verticalScale > 3 && earY !== null && headShoulderY > earY
    ? (headShoulderY - earY) * height / verticalScale : null
  const torsoHeight = verticalScale > 3 && hipY !== null && hipY - headShoulderY > 0.08
    ? (hipY - headShoulderY) * height / verticalScale : null
  const features: Features = {
    neck, torso, side, headPitch, neckHeight, torsoHeight,
    // Front-facing features become ill-conditioned when the shoulders overlap in profile.
    // Side monitoring only uses neck/torso angles; do not derive ratios from that tiny span.
    drop: view === 'front' && usable(nose) && span > 3 ? (nose.y - centerY) * height / span : 0,
    shift: view === 'front' && usable(nose) && span > 3 ? (nose.x - centerX) * width / span : 0,
    shoulders: view === 'front' && usable(ls) && usable(rs) ? degrees(Math.atan2((rs.y - ls.y) * height, Math.abs(rs.x - ls.x) * width)) : 0,
    scale: view === 'front' ? span / width : 0,
  }
  const q = view === 'front' ? Math.min(quality(nose), quality(ls), quality(rs)) : Math.min(quality(ear), quality(shoulder))
  const score = (...indices: number[]) => indices.every(i => usable(points[i])) ? Math.min(...indices.map(i => quality(points[i]))) : undefined
  const channelQuality: Observation['channelQuality'] = {
    headPitch: pitchVisible ? score(...(view === 'front' ? [0, 7, 8] : [0, side === 'left' ? 7 : 8])) : undefined,
    neckHeight: neckHeight === null ? undefined : score(...(view === 'front' ? [7, 8, 11, 12] : [0, side === 'left' ? 7 : 8, side === 'left' ? 11 : 12])),
    torsoHeight: torsoHeight === null ? undefined : score(...(view === 'front' ? [11, 12, 23, 24] : [0, side === 'left' ? 7 : 8, side === 'left' ? 11 : 12, side === 'left' ? 23 : 24])),
    neckAngle: neck === null ? undefined : score(side === 'left' ? 7 : 8, side === 'left' ? 11 : 12),
    torsoAngle: torso === null ? undefined : score(side === 'left' ? 11 : 12, side === 'left' ? 23 : 24),
    shoulderTilt: view === 'front' ? score(11, 12) : undefined,
    headShift: view === 'front' ? score(0, 11, 12) : undefined,
    proximity: view === 'front' ? score(11, 12) : undefined,
  }
  return { valid: true, noPerson: false, reason: '', features, quality: q, channelQuality }
}

export interface PostureChannel {
  status: 'normal' | 'bad' | 'unknown' | 'disabled'
  value: number | null
  reference: number | null
  difference: number | null
  unit: 'degree' | 'ratio'
  reason: string
  landmarkScore: number | null
}

export interface PostureVerdict {
  bad: boolean
  reason: string
  deviation: number
  unknown?: boolean
  channels: Record<'headPitch' | 'neckHeight' | 'torsoHeight' | 'neckAngle' | 'torsoAngle' | 'shoulderTilt' | 'headShift' | 'proximity', PostureChannel>
}

export function advancePostureHold(previous: { reason: string | null; since: number | null }, reason: string, now: number, holdSeconds: number, alreadyConfirmed: boolean) {
  const sameReason = previous.reason === reason
  const since = sameReason && previous.since !== null ? previous.since : now
  return { reason, since, confirmed: sameReason && alreadyConfirmed || now - since >= holdSeconds * 1000 }
}

export function resumePostureHold(since: number | null, gapStarted: number, now: number, maxGapMs = 750): number | null {
  const gap = now - gapStarted
  return since !== null && Number.isFinite(gap) && gap >= 0 && gap <= maxGapMs ? since + gap : null
}

export function acceptFrameTimestamp(capturedAt: number, receivedAt: number, previousCapture: number, maxAgeMs = 1500): boolean {
  const age = receivedAt - capturedAt
  return Number.isFinite(capturedAt) && Number.isFinite(receivedAt)
    && capturedAt > previousCapture && age >= -100 && age <= maxAgeMs
}

export function checkCalibrationCoverage(timestamps: number[], minimumSpanMs = 6000, maximumGapMs = 1500): { valid: boolean; reason: string } {
  if (timestamps.length < 20) return { valid: false, reason: '有效样本还不够，请让头肩持续清晰入镜。' }
  if (timestamps.some((time, index) => !Number.isFinite(time) || index > 0 && time <= timestamps[index - 1]!)) {
    return { valid: false, reason: '校准采样时间异常，请重新开始。' }
  }
  if (timestamps.at(-1)! - timestamps[0]! < minimumSpanMs) {
    return { valid: false, reason: '清晰画面持续时间不足，请保持姿势并重新校准。' }
  }
  if (timestamps.some((time, index) => index > 0 && time - timestamps[index - 1]! > maximumGapMs)) {
    return { valid: false, reason: '校准期间画面中断较久，请调整光线或机位后重试。' }
  }
  return { valid: true, reason: '' }
}

export function normalCoverage(channels: PostureVerdict['channels']): string {
  const head = channels.headPitch.status === 'normal' ? '头部俯仰' : '可见头肩'
  const torso = channels.torsoHeight.status !== 'disabled' ? channels.torsoHeight : channels.torsoAngle
  const torsoNote = torso.status === 'normal' ? '躯干参考未见持续偏离'
    : torso.status === 'bad' ? '躯干有变化，尚未满足整体提醒条件'
      : torso.status === 'unknown' ? '躯干暂不可判断' : '躯干检测未启用'
  return `${head}范围未见持续偏离；${torsoNote}`
}

export function classify(features: Features, profile: Calibration, settings: Settings, channelQuality?: Observation['channelQuality']): PostureVerdict {
  const primary = classifyPrimary(features, profile, settings)
  const baseline = profile.baseline
  const multiplier = 1 / settings.sensitivity
  const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)
  const channel = (key: keyof PostureVerdict['channels'], value: number | null | undefined, reference: number | null | undefined, unit: 'degree' | 'ratio', threshold: number, reason: string, enabled = true): PostureChannel => {
    const landmarkScore = channelQuality?.[key] ?? null
    if (!enabled || !finite(reference)) return { status: 'disabled', value: finite(value) ? value : null, reference: finite(reference) ? reference : null, difference: null, unit, reason: '校准时没有建立这一项参考', landmarkScore: null }
    if (!finite(value)) return { status: 'unknown', value: null, reference, difference: null, unit, reason: '当前关键点或拍摄角度不足，暂不可判断', landmarkScore }
    const difference = value - reference
    return { status: Math.abs(difference) > threshold * multiplier ? 'bad' : 'normal', value, reference, difference, unit, reason, landmarkScore }
  }
  const compression = (value: number | null | undefined, reference: number | null | undefined) => finite(value) && finite(reference) && reference > 0.05 ? 1 - value / reference : null
  const pitch = channel('headPitch', features.headPitch, baseline.headPitch, 'degree', 14, '头部俯仰偏离参考')
  if (pitch.status !== 'disabled' && pitch.status !== 'unknown' && pitch.difference !== null) pitch.status = pitch.difference > 14 * multiplier || pitch.difference < -16 * multiplier ? 'bad' : 'normal'
  const neckCompression = compression(features.neckHeight, baseline.neckHeight)
  const torsoCompression = compression(features.torsoHeight, baseline.torsoHeight)
  const onlyIncrease = (item: PostureChannel, threshold: number): PostureChannel => {
    if (item.difference !== null) item.status = item.difference > threshold * multiplier ? 'bad' : 'normal'
    return item
  }
  const channels: PostureVerdict['channels'] = {
    headPitch: pitch,
    neckHeight: onlyIncrease(channel('neckHeight', neckCompression, 0, 'ratio', .22, '头颈高度低于参考', finite(baseline.neckHeight)), .22),
    torsoHeight: onlyIncrease(channel('torsoHeight', torsoCompression, 0, 'ratio', .2, '躯干高度低于参考', finite(baseline.torsoHeight)), .2),
    neckAngle: channel('neckAngle', features.neck, baseline.neck, 'degree', 12, '头颈角度偏离参考', profile.view === 'side'),
    torsoAngle: channel('torsoAngle', features.torso, baseline.torso, 'degree', 10, '躯干角度偏离参考', profile.view === 'side'),
    shoulderTilt: channel('shoulderTilt', features.shoulders, baseline.shoulders, 'degree', 9, '肩线角度偏离参考', profile.view === 'front'),
    headShift: channel('headShift', features.shift, baseline.shift, 'ratio', .2, '头部横向位置偏离参考', profile.view === 'front'),
    proximity: onlyIncrease(channel('proximity', finite(features.scale) && baseline.scale > .08 ? features.scale / baseline.scale - 1 : null, 0, 'ratio', .23, '画面尺度比参考更大', profile.view === 'front' && baseline.scale > .08), .23),
  }
  // These measurements are evidence, not independent diagnoses. The existing
  // composite rule remains the source of the primary reminder until it is replaced.
  return { ...primary, channels }
}

function classifyPrimary(features: Features, profile: Calibration, settings: Settings): { bad: boolean; reason: string; deviation: number; unknown?: boolean } {
  const baseline = profile.baseline
  const multiplier = 1 / settings.sensitivity
  const available = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)
  const compression = (current: number | null | undefined, reference: number | null | undefined) =>
    available(current) && available(reference) && reference > 0.05 ? 1 - current / reference : 0
  const neckCompression = compression(features.neckHeight, baseline.neckHeight)
  const torsoCompression = compression(features.torsoHeight, baseline.torsoHeight)
  const torsoMeasured = available(features.torsoHeight) && available(baseline.torsoHeight)
  const pitchDiff = available(features.headPitch) && available(baseline.headPitch) ? features.headPitch - baseline.headPitch : null
  const pitchUnavailable = available(baseline.headPitch) && !available(features.headPitch)
  const noConfirmedDeviation = (deviation: number) => pitchUnavailable
    ? { bad: false, unknown: true, reason: '暂时看不清头部俯仰，无法确认姿态已恢复', deviation }
    : { bad: false, reason: '保持舒适的参考坐姿', deviation }
  const headDrop = features.drop - baseline.drop
  if (torsoCompression > 0.14 * multiplier && (neckCompression > 0.1 * multiplier || pitchDiff !== null && pitchDiff > 10 * multiplier || profile.view === 'front' && headDrop > 0.09 * multiplier)) {
    return { bad: true, reason: '头肩下沉、躯干收拢，可能有些含胸', deviation: Math.max(neckCompression, torsoCompression) * 100 }
  }
  if (torsoCompression > 0.2 * multiplier) return { bad: true, reason: '上身有些下沉，请回到参考坐姿', deviation: torsoCompression * 100 }
  if (pitchDiff !== null && pitchDiff > 14 * multiplier) return { bad: true, reason: '头部有些低下', deviation: pitchDiff }
  if (pitchDiff !== null && pitchDiff < -16 * multiplier) return { bad: true, reason: '头部有些抬高', deviation: -pitchDiff }
  // Shrugging raises shoulders toward the ears while lengthening the shoulder-hip gap.
  const neckDropSupported = torsoMeasured ? torsoCompression >= -0.04 * multiplier : pitchDiff !== null && pitchDiff > 6 * multiplier
  if (neckCompression > 0.22 * multiplier && neckDropSupported) return { bad: true, reason: '头颈有些下沉', deviation: neckCompression * 100 }
  if (profile.view === 'side') {
    const neckDiff = features.neck !== null && baseline.neck !== null ? Math.abs(features.neck - baseline.neck) : 0
    const torsoDiff = features.torso !== null && baseline.torso !== null ? Math.abs(features.torso - baseline.torso) : 0
    if (neckDiff > 12 * multiplier) return { bad: true, reason: '头颈偏离参考位置', deviation: neckDiff }
    if (torsoDiff > 10 * multiplier) return { bad: true, reason: '身体偏离参考位置', deviation: torsoDiff }
    return noConfirmedDeviation(neckDiff)
  }
  const drop = features.drop - baseline.drop
  const shift = Math.abs(features.shift - baseline.shift)
  const tilt = Math.abs(features.shoulders - baseline.shoulders)
  const closer = baseline.scale > 0.08 ? features.scale / baseline.scale - 1 : 0
  if (drop > 0.13 * multiplier && (!torsoMeasured || torsoCompression >= -0.04 * multiplier)) return { bad: true, reason: '头部有些低下', deviation: drop * 100 }
  if (drop < -0.18 * multiplier) return { bad: true, reason: '头部有些抬高', deviation: -drop * 100 }
  if (tilt > 9 * multiplier || shift > 0.2 * multiplier) return { bad: true, reason: '身体有些侧倾', deviation: Math.max(tilt, shift * 100) }
  if (closer > 0.23 * multiplier) return { bad: true, reason: '身体比参考位置更靠近屏幕', deviation: closer * 100 }
  return noConfirmedDeviation(Math.max(0, drop * 100))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] ?? 0 : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

export function makeCalibration(samples: Features[], view: ViewMode, cameraId: string, aspect: number, poseModel: 'full' | 'lite' = 'lite'): Calibration {
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
  if (view === 'front' && spread(valid.map((s) => s.shift)) > 0.08) {
    throw new Error('校准时头部左右移动较多，请保持位置稳定后重试。')
  }
  if (view === 'front') {
    const scales = valid.map((s) => s.scale)
    if (spread(scales) > Math.max(0.015, median(scales) * 0.08)) {
      throw new Error('校准时画面中的身体大小变化较多，请固定机位并保持距离。')
    }
  }
  const necks = valid.flatMap((s) => s.neck === null ? [] : [s.neck])
  if (view === 'side' && (necks.length < 20 || spread(necks) > 4)) throw new Error('侧面关键点不够稳定，请调整光线和机位。')
  const torsos = valid.flatMap((s) => s.torso === null ? [] : [s.torso])
  const stableTorso = torsos.length >= Math.max(20, Math.ceil(valid.length / 2)) && spread(torsos) <= 4
  const stableVertical = (key: 'headPitch' | 'neckHeight' | 'torsoHeight') => {
    const values = valid.flatMap(s => typeof s[key] === 'number' && Number.isFinite(s[key]) ? [s[key] as number] : [])
    if (values.length < Math.max(20, Math.ceil(valid.length * 0.6))) return null
    const center = median(values)
    return spread(values) <= (key === 'headPitch' ? 4.5 : Math.max(0.035, Math.abs(center) * 0.08)) ? center : null
  }
  return {
    featureVersion: POSTURE_FEATURE_VERSION,
    poseModel,
    id: cameraId + ':' + view, view, cameraId, aspect, side, createdAt: Date.now(), sampleCount: valid.length,
    baseline: {
      side, neck: necks.length ? median(necks) : null, torso: stableTorso ? median(torsos) : null,
      drop: median(valid.map((s) => s.drop)), shift: median(valid.map((s) => s.shift)),
      shoulders: median(valid.map((s) => s.shoulders)), scale: median(valid.map((s) => s.scale)),
      headPitch: stableVertical('headPitch'), neckHeight: stableVertical('neckHeight'), torsoHeight: stableVertical('torsoHeight'),
    },
  }
}

export function smoothFeatures(previous: Features | null, next: Features, dt: number): Features {
  if (!previous || previous.side !== next.side || dt > 1.5) return next
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / 0.35)
  const blend = (a: number, b: number) => a + alpha * (b - a)
  const optionalBlend = (a: number | null | undefined, b: number | null | undefined) =>
    typeof b !== 'number' ? null : typeof a !== 'number' ? b : blend(a, b)
  return {
    side: next.side,
    neck: next.neck === null ? null : previous.neck === null ? next.neck : blend(previous.neck, next.neck),
    torso: next.torso === null ? null : previous.torso === null ? next.torso : blend(previous.torso, next.torso),
    drop: blend(previous.drop, next.drop), shift: blend(previous.shift, next.shift),
    shoulders: blend(previous.shoulders, next.shoulders), scale: blend(previous.scale, next.scale),
    headPitch: optionalBlend(previous.headPitch, next.headPitch),
    neckHeight: optionalBlend(previous.neckHeight, next.neckHeight),
    torsoHeight: optionalBlend(previous.torsoHeight, next.torsoHeight),
  }
}

