import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/domain/posture.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { observe, makeCalibration, classify, smoothFeatures } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
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
  points[23] = point(.4, 1.2)
  points[24] = point(.4, 1.2)
  if (side === 'left') { [points[7], points[8]] = [points[8], points[7]]; [points[11], points[12]] = [points[12], points[11]] }
  return points
}
const samples = (side = 'right') => Array.from({ length: 60 }, (_, i) => {
  const result = observe(profileFrame(i, side), 640, 480, 'side')
  assert.equal(result.valid, true)
  return result.features
})

test('half-body side view calibrates with overlapping shoulders and no visible hips, on either side', () => {
  for (const side of ['left', 'right']) {
    const values = samples(side)
    const calibration = makeCalibration(values, 'side', 'camera', 4 / 3)
    assert.equal(calibration.side, side)
    assert.equal(calibration.sampleCount, 60)
    assert.equal(calibration.baseline.torso, null)
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

test('torso reference requires sustained stable visible hips; sporadic or jittery hips stay optional', () => {
  const values = samples()
  const stable = values.map(s => ({ ...s, torso: 5 }))
  assert.equal(makeCalibration(stable, 'side', 'camera', 4 / 3).baseline.torso, 5)
  const sporadic = values.map((s, i) => ({ ...s, torso: i < 20 ? 5 : null }))
  assert.equal(makeCalibration(sporadic, 'side', 'camera', 4 / 3).baseline.torso, null)
  const jittery = values.map((s, i) => ({ ...s, torso: i % 2 ? 0 : 30 }))
  assert.equal(makeCalibration(jittery, 'side', 'camera', 4 / 3).baseline.torso, null)
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
  points[23] = point(.38, .88); points[24] = point(.62, .88)
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

test('side view detects nose-ear pitch changes without requiring visible hips', () => {
  const base = profileFrame(2, 'left')
  const { verdict, reference } = verticalReference(base, 'side')
  assert.equal(reference.baseline.torsoHeight, null)
  for (const [offset, reason] of [[.06, '头部有些低下'], [-.06, '头部有些抬高']]) {
    const moved = structuredClone(base); moved[0].y += offset
    assert.equal(verdict(moved).reason, reason)
  }
})

test('combined head-shoulder sinking and torso compression reports possible slouching', () => {
  const { verdict } = verticalReference(frontalFrame())
  const slouch = frontalFrame()
  for (const index of [7, 8]) slouch[index].y += .08
  slouch[0].y += .1
  for (const index of [11, 12]) slouch[index].y += .05
  assert.equal(verdict(slouch).bad, true)
  assert.match(verdict(slouch).reason, /含胸/)
})

test('side-view vertical contraction also detects slouching with a stable visible hip', () => {
  const base = profileFrame(2, 'left')
  base[23] = point(.45, .85)
  const { verdict } = verticalReference(base, 'side')
  const slouch = structuredClone(base)
  slouch[7].y += .1; slouch[0].y += .1; slouch[11].y += .055
  assert.match(verdict(slouch).reason, /含胸/)
})

test('pitch rotation preserves the side-view head length and does not invent torso compression', () => {
  const base = profileFrame(2, 'left'); base[23] = point(.45, .85)
  const { verdict, read, reference } = verticalReference(base, 'side')
  const rotated = structuredClone(base)
  const dx = (base[0].x - base[7].x) * 640
  const dy = (base[0].y - base[7].y) * 480
  const rotation = 25 * Math.PI / 180
  rotated[0].x = base[7].x + (dx * Math.cos(rotation) - dy * Math.sin(rotation)) / 640
  rotated[0].y = base[7].y + (dx * Math.sin(rotation) + dy * Math.cos(rotation)) / 480
  assert.equal(verdict(rotated).reason, '头部有些低下')
  assert.ok(Math.abs(read(rotated).torsoHeight - reference.baseline.torsoHeight) < 1e-8)
})

test('uniform y translation and modest uniform scaling preserve the calibrated posture', () => {
  const { verdict, read, reference } = verticalReference(frontalFrame())
  const translated = frontalFrame().map(p => ({ ...p, y: p.y + .04 }))
  const scaled = frontalFrame().map(p => ({ ...p, x: .5 + (p.x - .5) * 1.1, y: .5 + (p.y - .5) * 1.1 }))
  for (const points of [translated, scaled]) {
    assert.equal(verdict(points).bad, false)
    for (const key of ['headPitch', 'neckHeight', 'torsoHeight']) assert.ok(Math.abs(read(points)[key] - reference.baseline[key]) < 1e-8, key)
  }
})

test('shoulder shrug alone is not reported as lowering the head or slouching', () => {
  const { verdict } = verticalReference(frontalFrame())
  const shrug = frontalFrame()
  shrug[11].y -= .065; shrug[12].y -= .065
  assert.equal(verdict(shrug).bad, false)
})

test('missing hips suppress torso measurements without fabricating a spine verdict', () => {
  const { read, reference } = verticalReference(frontalFrame())
  const hidden = frontalFrame(); hidden[23].visibility = .1; hidden[24].y = 1.2
  const features = read(hidden)
  assert.equal(features.torsoHeight, null)
  assert.equal(classify(features, reference, settings).bad, false)
  const missing = makeCalibration(Array.from({ length: 40 }, () => features), 'front', 'camera', 4 / 3)
  assert.equal(missing.baseline.torsoHeight, null)
})

test('head yaw, missing ears and unstable optional metrics do not invent pitch references', () => {
  const { read } = verticalReference(frontalFrame())
  const turned = frontalFrame(); turned[0].x = .57
  assert.equal(read(turned).headPitch, null)
  const missing = frontalFrame(); missing[7].presence = .1
  assert.equal(read(missing).headPitch, null)
  const moving = Array.from({ length: 40 }, (_, i) => ({ ...read(frontalFrame()), headPitch: i % 2 ? 30 : -30, torsoHeight: i % 2 ? 1.5 : .3 }))
  const reference = makeCalibration(moving, 'front', 'camera', 4 / 3)
  assert.equal(reference.baseline.headPitch, null)
  assert.equal(reference.baseline.torsoHeight, null)
})

test('smoothing clears unavailable vertical metrics immediately and keeps legacy profiles compatible', () => {
  const { read, reference } = verticalReference(frontalFrame())
  const next = { ...read(frontalFrame()), headPitch: null, neckHeight: null, torsoHeight: null }
  const smoothed = smoothFeatures(read(frontalFrame()), next, .1)
  assert.equal(smoothed.headPitch, null); assert.equal(smoothed.torsoHeight, null)
  const legacy = structuredClone(reference)
  delete legacy.featureVersion
  for (const key of ['headPitch', 'neckHeight', 'torsoHeight']) delete legacy.baseline[key]
  const verdict = classify(smoothed, legacy, settings)
  assert.equal(verdict.bad, false)
  assert.ok(Number.isFinite(verdict.deviation))
})
