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
const { dailyStats, csvSummary } = load('../src/lib/format.ts')

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
