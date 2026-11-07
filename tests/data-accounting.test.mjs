import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const load = (file, dependencies = {}) => {
  const exports = {}
  vm.runInNewContext(compile(file), { exports, require: name => dependencies[name] ?? require(name), console, Date }, { filename: file })
  return exports
}
const { DEFAULT_SETTINGS } = load('../src/domain/types.ts')
const { validSession } = load('../src/lib/storage.ts', { '@/domain/types': { DEFAULT_SETTINGS } })
const { dailyStats, csvSummary, computeHealthScore, buildOrgSummary, aggregateOrgReports } = load('../src/lib/format.ts')
const { analyzeLighting, applyGammaLut, summarizePerformance, checkNeckExerciseMatch } = load('../src/lib/lighting.ts')

function record(accountingVersion) {
  const day = new Date(); day.setHours(12, 0, 0, 0)
  const startedAt = day.getTime()
  const segments = [
    { startedAt, endedAt: startedAt + 10000, seconds: 10, state: 'normal', reason: '' },
    { startedAt: startedAt + 10000, endedAt: startedAt + 16000, seconds: 6, state: 'candidate_bad', reason: '' },
    { startedAt: startedAt + 16000, endedAt: startedAt + 21000, seconds: 5, state: 'bad', reason: '' },
  ]
  return { id: 'session', mode: 'real', startedAt, endedAt: startedAt + 21000, view: 'front', goodSeconds: 10,
    badSeconds: accountingVersion === 2 ? 5 : 11, unknownSeconds: 0, absentSeconds: 0, pausedSeconds: 0,
    ...(accountingVersion === 2 ? { accountingVersion, candidateSeconds: 6 } : {}), segments, reminders: [] }
}

test('new sessions keep candidate time separate; legacy records retain their original totals', () => {
  const current = record(2), legacy = record(undefined)
  assert.equal(validSession(current), true)
  assert.equal(validSession(legacy), true)
  const now = dailyStats([current], 1)[0]
  assert.equal(now.candidateSeconds, 6)
  assert.equal(now.badSeconds, 5)
  assert.equal(now.effectiveSeconds, 15)
  assert.equal(now.ratio, 10 / 15)
  const old = dailyStats([legacy], 1)[0]
  assert.equal(old.badSeconds, 11)
  assert.equal(old.candidateSeconds, 6)
  assert.equal(old.effectiveSeconds, 21)
  assert.match(csvSummary([current], 1), /候选变化秒数/)
  assert.equal(validSession({ ...current, candidateSeconds: 0 }), false)
})

test('daily health score and organization desensitized summary aggregate accurately', () => {
  const empty = computeHealthScore(0, 0, 0)
  assert.equal(empty.score, null)
  assert.equal(empty.grade, null)
  const high = computeHealthScore(3400, 200, 1)
  assert.ok(high.score >= 88)
  assert.equal(high.grade, '舒展')
  const current = record(2)
  const org1 = buildOrgSummary([current], 7, '机房 A-01')
  assert.equal(org1.schema, 'pinease-org-v1')
  assert.equal(org1.seatLabel, '机房 A-01')
  assert.equal(org1.effectiveSeconds, 15)
  const board = aggregateOrgReports([org1, { ...org1, seatLabel: '机房 A-02', goodSeconds: 20, badSeconds: 0, effectiveSeconds: 20 }])
  assert.equal(board.terminalCount, 2)
  assert.equal(board.totalEffectiveSeconds, 35)
  assert.equal(board.averageGoodRatio, Math.round((30 / 35) * 100))
})

test('lighting analysis detects dark and backlit frames and gamma LUT brightens low light', () => {
  const darkPixels = new Uint8ClampedArray(16 * 12 * 4)
  for (let i = 0; i < darkPixels.length; i += 4) { darkPixels[i] = 35; darkPixels[i + 1] = 35; darkPixels[i + 2] = 35; darkPixels[i + 3] = 255 }
  const darkReport = analyzeLighting(darkPixels, 16, 12)
  assert.equal(darkReport.status, 'dark')
  assert.ok(darkReport.gamma < 1)
  applyGammaLut(darkPixels, darkReport.gamma)
  assert.ok(darkPixels[0] > 35)

  const backlitPixels = new Uint8ClampedArray(20 * 20 * 4)
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const idx = (y * 20 + x) * 4
      const isCenter = x >= 5 && x <= 15 && y >= 4 && y <= 17
      const val = isCenter ? 55 : 225
      backlitPixels[idx] = val; backlitPixels[idx + 1] = val; backlitPixels[idx + 2] = val; backlitPixels[idx + 3] = 255
    }
  }
  const backlitReport = analyzeLighting(backlitPixels, 20, 20)
  assert.equal(backlitReport.status, 'backlit')
})

test('performance monitor computes p50/p95 and neck exercise matches head pose or feature shifts', () => {
  const perf = summarizePerformance([20, 22, 25, 24, 21, 23, 26, 28, 30, 125, 130, 140], [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100])
  assert.equal(perf.samples, 12)
  assert.ok(perf.p95Ms >= 125)
  assert.equal(perf.degraded, true)
  assert.equal(checkNeckExerciseMatch('left', { pitch: 0, yaw: -12, roll: 0 }, null, null), true)
  assert.equal(checkNeckExerciseMatch('right', { pitch: 0, yaw: 12, roll: 0 }, null, null), true)
  assert.equal(checkNeckExerciseMatch('up', { pitch: 8, yaw: 0, roll: 0 }, null, null), true)
})

