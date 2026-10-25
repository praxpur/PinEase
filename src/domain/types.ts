export type ViewMode = 'front' | 'side'
export type TrackingSide = 'left' | 'right'
export type Phase = 'idle' | 'loading' | 'ready' | 'calibrating' | 'monitoring' | 'paused'
export type PostureState = 'need_cal' | 'normal' | 'candidate_bad' | 'bad' | 'unknown' | 'absent' | 'paused'
export type ReminderKind = 'posture' | 'break' | 'eyes'
export type DemoPose = 'normal' | 'bad' | 'absent'

export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
  presence?: number
}

export interface Settings {
  cameraId: string
  view: ViewMode
  showPreview: boolean
  showSkeleton: boolean
  sensitivity: number
  holdSeconds: number
  recoverySeconds: number
  cooldownSeconds: number
  sitMinutes: number
  restSeconds: number
  breakEnabled: boolean
  soundEnabled: boolean
  soundVolume: number
  soundRepeats: number
  notificationsEnabled: boolean
  focusReminder: boolean
  blinkEnabled: boolean
  fps: number
}

export interface Features {
  neck: number | null
  torso: number | null
  drop: number
  shift: number
  shoulders: number
  scale: number
  side: TrackingSide
}

export interface Calibration {
  id: string
  view: ViewMode
  cameraId: string
  aspect: number
  createdAt: number
  side: TrackingSide
  baseline: Features
  sampleCount: number
}

export interface Observation {
  valid: boolean
  noPerson: boolean
  reason: string
  features: Features | null
  quality: number
}

export interface StateSegment {
  startedAt: number
  endedAt: number
  seconds: number
  state: PostureState
  reason: string
}

export interface ReminderEvent {
  at: number
  kind: ReminderKind
  message: string
}

export interface SessionRecord {
  id: string
  mode: 'real' | 'demo'
  startedAt: number
  endedAt: number | null
  view: ViewMode
  goodSeconds: number
  badSeconds: number
  unknownSeconds: number
  absentSeconds: number
  pausedSeconds: number
  reminders: ReminderEvent[]
  segments: StateSegment[]
}

export interface DailyStats {
  date: string
  goodSeconds: number
  badSeconds: number
  unknownSeconds: number
  effectiveSeconds: number
  reminders: number
  sessions: number
  ratio: number | null
}

export interface VisionFrame {
  type: 'frame'
  timestamp: number
  landmarks: Landmark[]
  width: number
  height: number
  blink: number | null
  inferenceMs: number
}

export type VisionReply =
  | VisionFrame
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; blink: boolean; warning?: string }
  | { type: 'error'; message: string }

export const DEFAULT_SETTINGS: Settings = {
  cameraId: '',
  view: 'front',
  showPreview: true,
  showSkeleton: true,
  sensitivity: 1,
  holdSeconds: 6,
  recoverySeconds: 2,
  cooldownSeconds: 90,
  sitMinutes: 45,
  restSeconds: 60,
  breakEnabled: true,
  soundEnabled: false,
  soundVolume: 70,
  soundRepeats: 2,
  notificationsEnabled: false,
  focusReminder: false,
  blinkEnabled: false,
  fps: 12,
}

export const STATE_LABELS: Record<PostureState, string> = {
  need_cal: '先校准，找到你的参考坐姿',
  normal: '坐得不错，继续专注',
  candidate_bad: '姿态有些变化',
  bad: '轻轻坐直一些',
  unknown: '暂时看不清',
  absent: '未检测到人',
  paused: '监测已暂停',
}
