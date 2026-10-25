import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/domain/fun.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { detectFun, FunTracker } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const point = (x, y, confidence = .95) => ({ x, y, z: 0, visibility: confidence, presence: confidence })
function frame() {
  const p = Array.from({ length: 33 }, () => point(.5, .5, .1))
  p[2] = point(.45, .25); p[5] = point(.55, .25)
  p[9] = point(.47, .35); p[10] = point(.53, .35); p[0] = point(.5, .3)
  p[11] = point(.3, .5); p[12] = point(.7, .5)
  return p
}
const detect = (p, profile = null, view = 'front') => detectFun(p, 640, 480, view, profile)
function rotateFace(p, degrees) {
  const a = degrees * Math.PI / 180
  for (const i of [0, 2, 5, 9, 10]) {
    const x = (p[i].x - .5) * 640, y = (p[i].y - .3) * 480
    p[i] = point(.5 + (x * Math.cos(a) - y * Math.sin(a)) / 640, .3 + (x * Math.sin(a) + y * Math.cos(a)) / 480)
  }
  return p
}

test('normal, missing, unreliable and offscreen landmarks do not trigger an alien', () => {
  assert.equal(detect(frame()), null)
  assert.equal(detect([]), null)
  for (const bad of [point(.5, .3, .2), point(NaN, .3), point(.5, 1.2)]) {
    const p = rotateFace(frame(), 180); p[0] = bad
    assert.equal(detect(p), null)
  }
  assert.equal(detectFun(frame(), 0, 480, 'front', null), null)
})

test('inversion uses facial anatomy even when the shoulders are not visible', () => {
  const p = rotateFace(frame(), 180)
  p[11].visibility = p[12].visibility = .1
  assert.equal(detect(p), 'alien')
  assert.equal(detect(p, null, 'side'), 'alien')
})

test('head tilt works in either direction and accounts for the image aspect ratio', () => {
  assert.equal(detect(rotateFace(frame(), 35)), 'owl')
  assert.equal(detect(rotateFace(frame(), -35)), 'owl')
  assert.equal(detect(rotateFace(frame(), 10)), null)
  assert.equal(detect(rotateFace(frame(), 35), null, 'side'), null)
  const p = rotateFace(frame(), 35)
  const dy = Math.tan(35 * Math.PI / 180) * .4 * 640 / 480
  p[11].y -= dy / 2; p[12].y += dy / 2
  assert.equal(detect(p), null, 'leaning the whole body is not independent head tilt')
})

test('both wrists and elbows must be raised for a stretch', () => {
  const p = frame()
  p[15] = point(.25, .1); p[16] = point(.75, .1)
  p[13] = point(.2, .35); p[14] = point(.8, .35)
  assert.equal(detect(p), 'stretch')
  p[16].y = .6; assert.equal(detect(p), null)
  p[16].y = .1; p[13].visibility = .1; assert.equal(detect(p), null)
})

test('closer requires a compatible frontal calibration, not a fixed body size', () => {
  const p = frame()
  const profile = { view: 'front', aspect: 4 / 3, baseline: { scale: .28 } }
  assert.equal(detect(p, profile), 'closer')
  assert.equal(detect(p), null)
  assert.equal(detect(p, { ...profile, baseline: { scale: .4 } }), null)
  assert.equal(detect(p, { ...profile, view: 'side' }), null)
  assert.equal(detect(p, { ...profile, aspect: 16 / 9 }), null)
})

function hold(tracker, kind, start, end) {
  const fired = []
  for (let t = start; t <= end; t += 100) {
    const result = tracker.update(kind, t)
    if (result) fired.push([t, result])
  }
  return fired
}

test('two second hold, one shot per pose, global and per-kind cooldowns', () => {
  const tracker = new FunTracker()
  assert.deepEqual(hold(tracker, 'alien', 0, 60000), [[2000, 'alien']])
  tracker.update(null, 60100)
  assert.deepEqual(hold(tracker, 'alien', 60200, 63000), [[62200, 'alien']])
  assert.deepEqual(hold(tracker, 'owl', 63100, 73000), [[72200, 'owl']])
  assert.deepEqual(hold(tracker, 'alien', 73100, 110000), [[107200, 'alien']])
})

test('lost frames, changed actions, pause/reset and invalid time cannot complete a stale hold', () => {
  const tracker = new FunTracker()
  assert.deepEqual(hold(tracker, 'owl', 0, 1500), [])
  assert.deepEqual(hold(tracker, 'owl', 3000, 4900), [])
  assert.equal(tracker.update('owl', 5000), 'owl')
  tracker.reset()
  assert.deepEqual(hold(tracker, 'alien', 6000, 7900), [])
  assert.deepEqual(hold(tracker, 'stretch', 8000, 9900), [])
  assert.equal(tracker.update('stretch', NaN), null)
  assert.equal(tracker.update('stretch', 10000), 'stretch')
  tracker.reset()
  assert.deepEqual(hold(tracker, 'alien', 11000, 12000), [])
  tracker.update(null, 12100)
  assert.deepEqual(hold(tracker, 'alien', 12200, 14100), [])
  assert.equal(tracker.update('alien', 14200), 'alien')
})
