import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadModule(file, mocks = {}, globals = {}) {
  const cache = new Map()
  const load = (target) => {
    const abs = path.resolve(root, target)
    if (cache.has(abs)) return cache.get(abs)
    const source = readFileSync(abs, 'utf8')
      .replaceAll('import.meta.env.BASE_URL', JSON.stringify('/'))
      .replaceAll('import.meta.url', JSON.stringify('http://localhost/src/main.ts'))
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const exports = {}
    cache.set(abs, exports)
    vm.runInNewContext(code, {
      exports, console, URL, DOMException, setTimeout, clearTimeout, ...globals,
      require: (name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts')
        if (name.startsWith('.')) return load(path.resolve(path.dirname(abs), name + '.ts'))
        return require(name)
      },
    }, { filename: abs })
    return exports
  }
  return load(file)
}

const pomodoroMod = loadModule('src/domain/pomodoro.ts')
const storageMod = loadModule('src/lib/storage.ts')

const config = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longInterval: 3,
  autoStartBreak: true,
  autoStartFocus: false,
}

test('pomodoro: focus -> short_break -> long_break cycle and autoStart behavior', () => {
  let s = pomodoroMod.createPomodoroState(config)
  assert.equal(s.phase, 'focus')
  assert.equal(s.status, 'idle')
  assert.equal(s.remainingSeconds, 1500)

  s = pomodoroMod.startPomodoroState(s)
  assert.equal(s.status, 'running')

  let res = pomodoroMod.tickPomodoroState(s, 500, config)
  assert.equal(res.event, null)
  assert.equal(res.state.remainingSeconds, 1000)
  assert.equal(Math.round(pomodoroMod.pomodoroProgress(res.state)), 33)

  // Complete round 1 -> short break auto-starts
  res = pomodoroMod.tickPomodoroState(res.state, 1000, config)
  assert.equal(res.event, 'focus_complete')
  assert.equal(res.state.phase, 'short_break')
  assert.equal(res.state.status, 'running')
  assert.equal(res.state.completedCount, 1)
  assert.equal(res.state.cycleCount, 1)
  assert.equal(res.state.remainingSeconds, 300)

  // Complete short break -> focus waits for manual start (autoStartFocus = false)
  res = pomodoroMod.tickPomodoroState(res.state, 300, config)
  assert.equal(res.event, 'break_complete')
  assert.equal(res.state.phase, 'focus')
  assert.equal(res.state.status, 'idle')

  // Complete rounds 2 and 3 -> round 3 enters long_break and resets cycleCount
  s = pomodoroMod.startPomodoroState(res.state)
  res = pomodoroMod.tickPomodoroState(s, 1500, config)
  assert.equal(res.state.phase, 'short_break')
  assert.equal(res.state.cycleCount, 2)

  res = pomodoroMod.tickPomodoroState(res.state, 300, config)
  s = pomodoroMod.startPomodoroState(res.state)
  res = pomodoroMod.tickPomodoroState(s, 1500, config)
  assert.equal(res.event, 'focus_complete')
  assert.equal(res.state.phase, 'long_break')
  assert.equal(res.state.remainingSeconds, 900)
  assert.equal(res.state.completedCount, 3)
  assert.equal(res.state.cycleCount, 0)
})

test('pomodoro: manual skip, pause, phase selection, and reset preserve expected counts', () => {
  let s = pomodoroMod.createPomodoroState(config)
  s = pomodoroMod.startPomodoroState(s)
  s = pomodoroMod.tickPomodoroState(s, 120, config).state
  s = pomodoroMod.pausePomodoroState(s)
  assert.equal(s.status, 'paused')
  assert.equal(s.remainingSeconds, 1380)

  // Manual skip does not increment completedCount
  const skipped = pomodoroMod.advancePomodoroState(s, config, false)
  assert.equal(skipped.event, null)
  assert.equal(skipped.state.phase, 'short_break')
  assert.equal(skipped.state.status, 'idle')
  assert.equal(skipped.state.completedCount, 0)

  const longSelected = pomodoroMod.selectPomodoroPhase(skipped.state, 'long_break', config)
  assert.equal(longSelected.phase, 'long_break')
  assert.equal(longSelected.remainingSeconds, 900)

  const reset = pomodoroMod.resetPomodoroState({ ...longSelected, remainingSeconds: 42, status: 'paused' }, config)
  assert.equal(reset.status, 'idle')
  assert.equal(reset.remainingSeconds, 900)
})

test('pomodoro: sanitizeSettings clamps out-of-range pomodoro values and defaults booleans', () => {
  const sanitized = storageMod.sanitizeSettings({
    pomodoroEnabled: 'invalid',
    pomodoroFocusMinutes: 500,
    pomodoroShortBreakMinutes: 0,
    pomodoroLongBreakMinutes: 1,
    pomodoroLongInterval: 99,
    pomodoroAutoStartBreak: false,
    pomodoroAutoStartFocus: true,
  })
  assert.equal(sanitized.pomodoroEnabled, true)
  assert.equal(sanitized.pomodoroFocusMinutes, 90)
  assert.equal(sanitized.pomodoroShortBreakMinutes, 1)
  assert.equal(sanitized.pomodoroLongBreakMinutes, 5)
  assert.equal(sanitized.pomodoroLongInterval, 8)
  assert.equal(sanitized.pomodoroAutoStartBreak, false)
  assert.equal(sanitized.pomodoroAutoStartFocus, true)
})

test('pomodoro: store actions control timer state and suppress posture alerts while on break', () => {
  const intervals = new Map()
  let id = 0
  const pinia = require('pinia')
  pinia.setActivePinia(pinia.createPinia())
  const typesMod = loadModule('src/domain/types.ts')
  const storeMod = loadModule('src/stores/monitor.ts', {
    '@/lib/storage': {
      loadData: async () => ({ settings: typesMod.DEFAULT_SETTINGS, calibrations: [], sessions: [] }),
      saveSettings: async () => {},
      saveSession: async () => {},
      saveCalibration: async () => {},
      sanitizeSettings: storageMod.sanitizeSettings,
    },
    '@/lib/vision': { VisionCamera: class {}, cameraError: (e) => e.message },
  }, {
    window: {
      setTimeout: () => ++id,
      clearTimeout: () => {},
      setInterval: (fn) => { intervals.set(++id, fn); return id },
      clearInterval: (n) => intervals.delete(n),
    },
    document: { hidden: false },
    navigator: { mediaDevices: {} },
    performance: { now: () => 0 },
    crypto: { randomUUID: () => String(++id) },
  })

  const store = storeMod.useMonitorStore()
  assert.equal(store.pomodoro.phase, 'focus')
  assert.equal(store.pomodoroOnBreak, false)

  store.choosePomodoroPhase('short_break')
  assert.equal(store.pomodoro.phase, 'short_break')
  store.startPomodoro()
  assert.equal(store.pomodoro.status, 'running')
  assert.equal(store.pomodoroOnBreak, true)
  assert.equal(intervals.size, 1)

  store.pausePomodoro()
  assert.equal(store.pomodoro.status, 'paused')
  assert.equal(store.pomodoroOnBreak, false)
  assert.equal(intervals.size, 0)

  store.resetPomodoro()
  assert.equal(store.pomodoro.status, 'idle')
  assert.equal(store.pomodoro.remainingSeconds, 300)
})
