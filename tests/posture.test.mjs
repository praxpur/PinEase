import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/domain/posture.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { observe, makeCalibration, classify, smoothFeatures, normalCoverage, advancePostureHold, resumePostureHold, acceptFrameTimestamp, checkCalibrationCoverage } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const settings = { sensitivity: 1 }
const point = (x, y, confidence = .95) => ({ x, y, z: 0, visibility: confidence, presence: confidence })
function profileFrame(index = 0, side = 'right') {
  const points = Array.from({ length: 33 }, () => point(0, 0, .1))
  points[0] = point(.65, .34)
  points[7] = point(.59, .29, .8)
  points[8] = point(.59, .29)
  // Small independent errors between overlapping shoulders must not invalidate side calibration.
  points[11] = point(.504 + (index % 9) * .001, .52 + ((index % 5) - 2) * .01, .8)
  points[12] = point(.50, .52)
  if (side === 'left') { [points[7], points[8]] = [points[8], points[7]]; [points[11], points[12]] = [points[12], points[11]] }
  return points
}
const samples = (side = 'right') => Array.from({ length: 60 }, (_, i) => {
  const result = observe(profileFrame(i, side), 640, 480, 'side')
  assert.equal(result.valid, true)
  return result.features
})

test('a missing calibrated pitch cannot confirm recovery, while other deviations still report', () => {
  const baseline = { side: 'left', neck: 0, drop: -.5, shift: 0, shoulders: 0, scale: .3, headPitch: 0, neckHeight: null }
  const profile = { view: 'front', baseline }
  const missing = { ...baseline, headPitch: null }
  const result = classify(missing, profile, settings)
  assert.equal(result.bad, false)
  assert.equal(result.unknown, true)
  assert.equal(result.channels.headPitch.status, 'unknown')
  assert.match(result.reason, /无法确认姿态已恢复/)
  assert.equal(classify({ ...missing, shoulders: 18 }, profile, settings).bad, true)
  assert.equal(classify({ ...missing, shoulders: 18 }, profile, settings).channels.shoulderTilt.status, 'bad')
  assert.equal(classify({ ...baseline, headPitch: 0 }, profile, settings).unknown, undefined)
  assert.equal(classify({ ...baseline, headPitch: 0 }, profile, settings).channels.headPitch.status, 'normal')
})

test('normal status describes only the posture channels actually covered', () => {
  const baseline = { side: 'left', neck: 0, drop: -.5, shift: 0, shoulders: 0, scale: .3, headPitch: 0, headTilt: 0, neckHeight: .65 }
  const profile = { view: 'front', baseline }
  const covered = classify({ ...baseline }, profile, settings)
  assert.match(normalCoverage(covered.channels), /头部俯仰、歪头倾角与头颈含胸范围未见持续偏离/)
  const noNeckReference = classify({ ...baseline, neckHeight: null }, { ...profile, baseline: { ...baseline, headTilt: null, neckHeight: null } }, settings)
  assert.match(normalCoverage(noNeckReference.channels), /头部俯仰与双肩范围未见持续偏离/)
  const sideCovered = classify({ ...baseline }, { view: 'side', baseline }, settings)
  assert.match(normalCoverage(sideCovered.channels), /头颈与含胸参考未见持续偏离/)
  const sideNoNeckHeight = classify({ ...baseline, neckHeight: null }, { view: 'side', baseline: { ...baseline, neckHeight: null } }, settings)
  assert.match(normalCoverage(sideNoNeckHeight.channels), /头颈角度未见持续偏离/)
})

test('switching posture reason starts a fresh hold instead of borrowing the previous one', () => {
  const first = advancePostureHold({ reason: null, since: null }, '低头', 1000, 6, false)
  const switched = advancePostureHold(first, '侧倾', 6500, 6, false)
  assert.equal(switched.confirmed, false)
  assert.equal(switched.since, 6500)
  const confirmed = advancePostureHold(switched, '侧倾', 12500, 6, false)
  assert.equal(confirmed.confirmed, true)
  const changedAfterConfirmation = advancePostureHold(confirmed, '头部前伸', 13000, 6, true)
  assert.equal(changedAfterConfirmation.confirmed, false)
})

test('a brief landmark gap pauses hold time but a long gap resets it', () => {
  assert.equal(resumePostureHold(1000, 4000, 4500), 1500)
  assert.equal(resumePostureHold(1000, 4000, 4900), null)
  assert.equal(advancePostureHold({ reason: '低头', since: 1500 }, '低头', 6500, 6, false).confirmed, false)
  assert.equal(advancePostureHold({ reason: '低头', since: 1500 }, '低头', 7500, 6, false).confirmed, true)
})

test('only recent, monotonically captured frames can update posture', () => {
  assert.equal(acceptFrameTimestamp(1000, 1200, -Infinity), true)
  assert.equal(acceptFrameTimestamp(1000, 1201, 1000), false)
  assert.equal(acceptFrameTimestamp(900, 1200, 1000), false)
  assert.equal(acceptFrameTimestamp(1100, 2700, 1000), false)
  assert.equal(acceptFrameTimestamp(1400, 1200, 1000), false)
  assert.equal(acceptFrameTimestamp(NaN, 1200, 1000), false)
})

test('side observation reports visible ear and shoulder channel quality', () => {
  const points = profileFrame()
  const result = observe(points, 640, 480, 'side')
  assert.equal(result.valid, true)
  assert.ok(result.channelQuality.neckAngle >= .8)
  assert.ok(result.quality >= .8)
})

test('calibration requires sustained samples across time, not a last-second burst', () => {
  const stable = Array.from({ length: 31 }, (_, i) => i * 220)
  assert.equal(checkCalibrationCoverage(stable).valid, true)
  assert.match(checkCalibrationCoverage(Array.from({ length: 30 }, (_, i) => 7000 + i * 30)).reason, /持续时间不足/)
  assert.match(checkCalibrationCoverage([...stable.slice(0, 15), ...stable.slice(15).map(t => t + 2000)]).reason, /中断较久/)
  assert.equal(checkCalibrationCoverage(stable.slice(0, 19)).valid, false)
})

test('frontal calibration rejects unstable horizontal position and apparent size', () => {
  const baseline = { side: 'left', neck: null, drop: -.5, shift: 0, shoulders: 0, scale: .3, headPitch: null, neckHeight: null }
  const stable = Array.from({ length: 30 }, () => ({ ...baseline }))
  assert.doesNotThrow(() => makeCalibration(stable, 'front', 'camera', 4 / 3))
  const movingSideways = stable.map((s, i) => ({ ...s, shift: i % 2 ? .2 : -.2 }))
  assert.throws(() => makeCalibration(movingSideways, 'front', 'camera', 4 / 3), /左右移动/)
  const movingCloser = stable.map((s, i) => ({ ...s, scale: i % 2 ? .36 : .24 }))
  assert.throws(() => makeCalibration(movingCloser, 'front', 'camera', 4 / 3), /身体大小变化/)
})

test('half-body side view calibrates with overlapping shoulders on either side', () => {
  for (const side of ['left', 'right']) {
    const values = samples(side)
    const calibration = makeCalibration(values, 'side', 'camera', 4 / 3)
    assert.equal(calibration.side, side)
    assert.equal(calibration.sampleCount, 60)
    assert.ok(calibration.baseline.neck > 20, 'accept a personal baseline rather than forcing a vertical neck')
    assert.equal(classify(values[0], calibration, settings).bad, false)
    assert.equal(classify({ ...values[0], neck: values[0].neck + 20 }, calibration, settings).bad, true)
  }
})

test('side calibration ignores unstable frontal ratios from overlapping shoulders', () => {
  const values = samples().map((s, i) => ({ ...s, drop: i % 2 ? 20 : -20, shoulders: i % 2 ? 60 : -60 }))
  assert.doesNotThrow(() => makeCalibration(values, 'side', 'camera', 4 / 3))
  assert.throws(() => makeCalibration(values, 'front', 'camera', 4 / 3), /姿态变化/)
})

test('side calibration still rejects insufficient samples and unstable neck angles', () => {
  assert.throws(() => makeCalibration(samples().slice(0, 19), 'side', 'camera', 4 / 3), /样本/)
  const moving = samples().map((s, i) => ({ ...s, neck: i % 2 ? 10 : 40 }))
  assert.throws(() => makeCalibration(moving, 'side', 'camera', 4 / 3), /不够稳定/)
})

test('hidden, offscreen and invalid ear/shoulder points remain unusable', () => {
  for (const bad of [point(.59, .29, .2), point(.59, 1.1), point(NaN, .29)]) {
    const points = profileFrame(); points[8] = bad
    assert.equal(observe(points, 640, 480, 'side', 'right').valid, false)
  }
  assert.equal(observe([], 640, 480, 'side').noPerson, true)
  assert.equal(observe(profileFrame(), 0, 480, 'side').valid, false)
  assert.equal(observe(profileFrame(), 640, 480, 'front').valid, false)
})

test('smoothing does not blend measurements from opposite sides', () => {
  const previous = samples()[0]
  const next = { ...previous, side: 'left', neck: -30 }
  assert.equal(smoothFeatures(previous, next, .1).neck, -30)
})


test('initial side selection prefers the visible pair over an offscreen high-confidence ear', () => {
  const points = profileFrame()
  points[8] = point(1.2, .29)
  const result = observe(points, 640, 480, 'side')
  assert.equal(result.valid, true)
  assert.equal(result.features.side, 'left')
})

test('stable frontal calibration remains valid when the better ear alternates', () => {
  const values = Array.from({ length: 30 }, (_, i) => {
    const points = profileFrame()
    points[0] = point(.5, .3)
    points[11] = point(.35, .55)
    points[12] = point(.65, .55)
    points[7] = point(.43, .32, i % 2 ? .8 : .95)
    points[8] = point(.57, .32, i % 2 ? .95 : .8)
    const result = observe(points, 640, 480, 'front')
    assert.equal(result.valid, true)
    return result.features
  })
  const calibration = makeCalibration(values, 'front', 'camera', 4 / 3)
  assert.equal(calibration.sampleCount, 30)
  assert.equal(classify(values[0], calibration, settings).bad, false)
})

function frontalFrame() {
  const points = Array.from({ length: 33 }, () => point(0, 0, .1))
  points[0] = point(.5, .3)
  points[7] = point(.43, .29); points[8] = point(.57, .29)
  points[11] = point(.35, .55); points[12] = point(.65, .55)
  return points
}
function verticalReference(points, view = 'front') {
  const read = frame => observe(frame, 640, 480, view, 'left').features
  const reference = makeCalibration(Array.from({ length: 40 }, () => read(points)), view, 'camera', 4 / 3)
  return { read, reference, verdict: frame => classify(read(frame), reference, settings) }
}

test('frontal nose-ear y changes distinguish lowering and raising the head', () => {
  const { verdict, reference } = verticalReference(frontalFrame())
  assert.equal(reference.featureVersion, 2)
  for (const [offset, reason] of [[.07, '头部有些低下'], [-.06, '头部有些抬高']]) {
    const moved = frontalFrame(); moved[0].y += offset
    assert.equal(verdict(moved).reason, reason)
  }
})

test('frontal ear roll and lateral shift detect head tilt and distinguish uneven shoulders', () => {
  const { verdict } = verticalReference(frontalFrame())
  const tiltedHead = frontalFrame()
  tiltedHead[7].y += .022
  tiltedHead[8].y -= .022
  const tiltResult = verdict(tiltedHead)
  assert.equal(tiltResult.bad, true)
  assert.equal(tiltResult.reason, '头部有些歪斜')
  assert.equal(tiltResult.channels.headTilt.status, 'bad')
  assert.equal(tiltResult.channels.headPitch.status, 'normal')

  const unevenShoulders = frontalFrame()
  unevenShoulders[11].y += .04
  unevenShoulders[12].y -= .04
  const shoulderResult = verdict(unevenShoulders)
  assert.equal(shoulderResult.bad, true)
  assert.match(shoulderResult.reason, /高低肩/)
  assert.equal(shoulderResult.channels.shoulderTilt.status, 'bad')
})

test('side view detects nose-ear pitch changes', () => {
  const base = profileFrame(2, 'left')
  const { verdict } = verticalReference(base, 'side')
  for (const [offset, reason] of [[.06, '头部有些低下'], [-.06, '头部有些抬高']]) {
    const moved = structuredClone(base); moved[0].y += offset
    assert.equal(verdict(moved).reason, reason)
  }
})

test('combined head-shoulder sinking reports slouching', () => {
  const { verdict } = verticalReference(frontalFrame())
  const slouch = frontalFrame()
  for (const index of [7, 8]) slouch[index].y += .08
  slouch[0].y += .1
  for (const index of [11, 12]) slouch[index].y += .05
  assert.equal(verdict(slouch).bad, true)
  assert.match(verdict(slouch).reason, /含胸|驼背/)
})

test('side-view vertical contraction also detects slouching', () => {
  const base = profileFrame(2, 'left')
  const { verdict } = verticalReference(base, 'side')
  const slouch = structuredClone(base)
  slouch[7].y += .1; slouch[0].y += .1; slouch[11].y += .055
  assert.match(verdict(slouch).reason, /含胸|驼背/)
})

test('pitch rotation preserves the side-view head length', () => {
  const base = profileFrame(2, 'left')
  const { verdict } = verticalReference(base, 'side')
  const rotated = structuredClone(base)
  const dx = (base[0].x - base[7].x) * 640
  const dy = (base[0].y - base[7].y) * 480
  const rotation = 25 * Math.PI / 180
  rotated[0].x = base[7].x + (dx * Math.cos(rotation) - dy * Math.sin(rotation)) / 640
  rotated[0].y = base[7].y + (dx * Math.sin(rotation) + dy * Math.cos(rotation)) / 480
  assert.equal(verdict(rotated).reason, '头部有些低下')
})

test('uniform y translation and modest uniform scaling preserve the calibrated posture', () => {
  const { verdict, read, reference } = verticalReference(frontalFrame())
  const translated = frontalFrame().map(p => ({ ...p, y: p.y + .04 }))
  const scaled = frontalFrame().map(p => ({ ...p, x: .5 + (p.x - .5) * 1.1, y: .5 + (p.y - .5) * 1.1 }))
  for (const points of [translated, scaled]) {
    assert.equal(verdict(points).bad, false)
    for (const key of ['headPitch', 'headTilt', 'neckHeight']) assert.ok(Math.abs(read(points)[key] - reference.baseline[key]) < 1e-8, key)
  }
})

test('shoulder shrug alone is not reported as lowering the head or slouching', () => {
  const { verdict } = verticalReference(frontalFrame())
  const shrug = frontalFrame()
  shrug[11].y -= .065; shrug[12].y -= .065
  assert.equal(verdict(shrug).bad, false)
})

test('head yaw, missing ears and unstable optional metrics do not invent pitch references', () => {
  const { read } = verticalReference(frontalFrame())
  const turned = frontalFrame(); turned[0].x = .57
  assert.equal(read(turned).headPitch, null)
  const missing = frontalFrame(); missing[7].presence = .1
  assert.equal(read(missing).headPitch, null)
  const moving = Array.from({ length: 40 }, (_, i) => ({ ...read(frontalFrame()), headPitch: i % 2 ? 30 : -30 }))
  const reference = makeCalibration(moving, 'front', 'camera', 4 / 3)
  assert.equal(reference.baseline.headPitch, null)
})

test('smoothing clears unavailable vertical metrics immediately and keeps legacy profiles compatible', () => {
  const { read, reference } = verticalReference(frontalFrame())
  const next = { ...read(frontalFrame()), headPitch: null, neckHeight: null }
  const smoothed = smoothFeatures(read(frontalFrame()), next, .1)
  assert.equal(smoothed.headPitch, null)
  const legacy = structuredClone(reference)
  delete legacy.featureVersion
  for (const key of ['headPitch', 'neckHeight']) delete legacy.baseline[key]
  const verdict = classify(smoothed, legacy, settings)
  assert.equal(verdict.bad, false)
  assert.ok(Number.isFinite(verdict.deviation))
})
