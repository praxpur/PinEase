import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/domain/fun.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { detectInversion, InversionTracker } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const point = (x, y, confidence = .95) => ({ x, y, z: 0, visibility: confidence, presence: confidence })
function frame() {
  const p = Array.from({ length: 33 }, () => point(.5, .5, .1))
  p[2] = point(.45, .25); p[5] = point(.55, .25)
  p[9] = point(.47, .35); p[10] = point(.53, .35); p[0] = point(.5, .3)
  p[11] = point(.3, .5); p[12] = point(.7, .5)
  return p
}
const detect = (p) => detectInversion(p, 640, 480)
function rotateFace(p, degrees) {
  const a = degrees * Math.PI / 180
  for (const i of [0, 2, 5, 9, 10]) {
    const x = (p[i].x - .5) * 640, y = (p[i].y - .3) * 480
    p[i] = point(.5 + (x * Math.cos(a) - y * Math.sin(a)) / 640, .3 + (x * Math.sin(a) + y * Math.cos(a)) / 480)
  }
  return p
}

test('normal, missing, unreliable and offscreen landmarks do not trigger an alien', () => {
  assert.equal(detect(frame()), false)
  assert.equal(detect([]), false)
  for (const bad of [point(.5, .3, .2), point(NaN, .3), point(.5, 1.2)]) {
    const p = rotateFace(frame(), 180); p[0] = bad
    assert.equal(detect(p), false)
  }
  assert.equal(detectInversion(frame(), 0, 480), false)
})

test('inversion uses facial anatomy even when the shoulders are not visible', () => {
  const p = rotateFace(frame(), 180)
  p[11].visibility = p[12].visibility = .1
  assert.equal(detect(p), true)
  assert.equal(detect(rotateFace(frame(), -165)), true)
})

test('head tilt and horizontal faces no longer trigger any easter egg', () => {
  for (const degrees of [-120, -90, -35, 10, 35, 90, 120]) {
    assert.equal(detect(rotateFace(frame(), degrees)), false)
  }
})

test('raised hands and enlarged upright poses no longer trigger any easter egg', () => {
  const p = frame()
  p[15] = point(.25, .1); p[16] = point(.75, .1)
  p[13] = point(.2, .35); p[14] = point(.8, .35)
  assert.equal(detect(p), false)
  const enlarged = frame().map(p => ({ ...p, x: .5 + (p.x - .5) * 1.5, y: .4 + (p.y - .4) * 1.5 }))
  assert.equal(detect(enlarged), false)
})

function hold(tracker, inverted, start, end) {
  const fired = []
  for (let t = start; t <= end; t += 100) {
    const result = tracker.update(inverted, t)
    if (result) fired.push([t, result])
  }
  return fired
}

test('two second hold, one shot per pose and 45 second cooldown', () => {
  const tracker = new InversionTracker()
  assert.deepEqual(hold(tracker, true, 0, 6000), [[2000, true]])
  tracker.update(false, 6100)
  assert.deepEqual(hold(tracker, true, 6200, 65000), [[47000, true]])
  tracker.update(false, 65100)
  assert.deepEqual(hold(tracker, true, 65200, 100000), [[92000, true]])
})

test('lost frames, upright poses, pause/reset and invalid time cannot complete a stale hold', () => {
  const tracker = new InversionTracker()
  assert.deepEqual(hold(tracker, true, 0, 1500), [])
  assert.deepEqual(hold(tracker, true, 3000, 4900), [])
  assert.equal(tracker.update(true, 5000), true)
  tracker.reset()
  assert.deepEqual(hold(tracker, true, 6000, 7900), [])
  assert.equal(tracker.update(false, 8000), false)
  assert.deepEqual(hold(tracker, true, 8100, 10000), [])
  assert.equal(tracker.update(true, NaN), false)
  assert.equal(tracker.update(true, 10100), true)
  tracker.reset()
  assert.deepEqual(hold(tracker, true, 11000, 12000), [])
  tracker.update(false, 12100)
  assert.deepEqual(hold(tracker, true, 12200, 14100), [])
  assert.equal(tracker.update(true, 14200), true)
})
