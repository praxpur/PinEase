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
