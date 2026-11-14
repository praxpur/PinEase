import type { Settings } from '@/domain/types'

export type PomodoroPhase = 'focus' | 'short_break' | 'long_break'
export type PomodoroStatus = 'idle' | 'running' | 'paused'
export type PomodoroEvent = 'focus_complete' | 'break_complete'

export interface PomodoroConfig {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longInterval: number
  autoStartBreak: boolean
  autoStartFocus: boolean
}

export interface PomodoroState {
  phase: PomodoroPhase
  status: PomodoroStatus
  remainingSeconds: number
  totalSeconds: number
  completedCount: number
  cycleCount: number
}

export const POMODORO_PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: '专注时段',
  short_break: '短休息',
  long_break: '长休息',
}

export function pomodoroConfigFromSettings(settings: Pick<
  Settings,
  | 'pomodoroFocusMinutes'
  | 'pomodoroShortBreakMinutes'
  | 'pomodoroLongBreakMinutes'
  | 'pomodoroLongInterval'
  | 'pomodoroAutoStartBreak'
  | 'pomodoroAutoStartFocus'
>): PomodoroConfig {
  return {
    focusMinutes: settings.pomodoroFocusMinutes,
    shortBreakMinutes: settings.pomodoroShortBreakMinutes,
    longBreakMinutes: settings.pomodoroLongBreakMinutes,
    longInterval: settings.pomodoroLongInterval,
    autoStartBreak: settings.pomodoroAutoStartBreak,
    autoStartFocus: settings.pomodoroAutoStartFocus,
  }
}

export function phaseDurationSeconds(phase: PomodoroPhase, config: PomodoroConfig): number {
  const minutes = phase === 'focus'
    ? config.focusMinutes
    : phase === 'short_break'
      ? config.shortBreakMinutes
      : config.longBreakMinutes
  return Math.max(60, Math.round(minutes * 60))
}

export function createPomodoroState(config: PomodoroConfig): PomodoroState {
  const total = phaseDurationSeconds('focus', config)
  return {
    phase: 'focus',
    status: 'idle',
    remainingSeconds: total,
    totalSeconds: total,
    completedCount: 0,
    cycleCount: 0,
  }
}

export function startPomodoroState(state: PomodoroState): PomodoroState {
  if (state.status === 'running') return state
  return { ...state, status: 'running' }
}

export function pausePomodoroState(state: PomodoroState): PomodoroState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused' }
}

export function selectPomodoroPhase(state: PomodoroState, phase: PomodoroPhase, config: PomodoroConfig): PomodoroState {
  const total = phaseDurationSeconds(phase, config)
  return {
    ...state,
    phase,
    status: 'idle',
    remainingSeconds: total,
    totalSeconds: total,
  }
}

export function resetPomodoroState(state: PomodoroState, config: PomodoroConfig): PomodoroState {
  const total = phaseDurationSeconds(state.phase, config)
  return {
    ...state,
    status: 'idle',
    remainingSeconds: total,
    totalSeconds: total,
  }
}

export function advancePomodoroState(
  state: PomodoroState,
  config: PomodoroConfig,
  auto: boolean,
): { state: PomodoroState; event: PomodoroEvent | null } {
  if (state.phase === 'focus') {
    const completedCount = auto ? state.completedCount + 1 : state.completedCount
    const nextCycle = state.cycleCount + 1
    const isLong = nextCycle >= Math.max(2, config.longInterval)
    const nextPhase: PomodoroPhase = isLong ? 'long_break' : 'short_break'
    const total = phaseDurationSeconds(nextPhase, config)
    const status: PomodoroStatus = auto && config.autoStartBreak ? 'running' : 'idle'
    return {
      event: auto ? 'focus_complete' : null,
      state: {
        phase: nextPhase,
        status,
        remainingSeconds: total,
        totalSeconds: total,
        completedCount,
        cycleCount: isLong ? 0 : nextCycle,
      },
    }
  }

  const total = phaseDurationSeconds('focus', config)
  const status: PomodoroStatus = auto && config.autoStartFocus ? 'running' : 'idle'
  return {
    event: auto ? 'break_complete' : null,
    state: {
      phase: 'focus',
      status,
      remainingSeconds: total,
      totalSeconds: total,
      completedCount: state.completedCount,
      cycleCount: state.cycleCount,
    },
  }
}

export function tickPomodoroState(
  state: PomodoroState,
  dtSeconds: number,
  config: PomodoroConfig,
): { state: PomodoroState; event: PomodoroEvent | null } {
  if (state.status !== 'running' || dtSeconds <= 0) return { state, event: null }
  const remaining = Math.max(0, state.remainingSeconds - dtSeconds)
  if (remaining > 0) {
    return { state: { ...state, remainingSeconds: remaining }, event: null }
  }
  return advancePomodoroState(state, config, true)
}

export function pomodoroProgress(state: PomodoroState): number {
  if (state.totalSeconds <= 0) return 0
  const done = Math.max(0, state.totalSeconds - state.remainingSeconds)
  return Math.min(100, Math.max(0, (done / state.totalSeconds) * 100))
}
