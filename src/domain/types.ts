export type ViewMode = 'front' | 'side'
export type TrackingSide = 'left' | 'right'
export type CameraFacingMode = 'user' | 'environment'
export type PoseModelPreference = 'auto' | 'full' | 'lite'
export interface HeadPose {
  // Raw XYZ Euler angles in degrees from MediaPipe's column-major face transform.
  // Signs are matrix-relative; left/right/up/down labels require camera validation.
  pitch: number
  yaw: number
  roll: number
  faceCenterX: number
  faceCenterY: number
  faceWidth: number
  observedAt: number
}
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
  modelPreference: PoseModelPreference
  headPoseEnabled: boolean
  cameraFacingMode: CameraFacingMode
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
  eyeCareAuto: boolean
  lowLightBoost: boolean
  fps: number
  pomodoroEnabled: boolean
  pomodoroFocusMinutes: number
  pomodoroShortBreakMinutes: number
  pomodoroLongBreakMinutes: number
  pomodoroLongInterval: number
  pomodoroAutoStartBreak: boolean
  pomodoroAutoStartFocus: boolean
}

export interface Features {
  neck: number | null
  drop: number
  shift: number
  shoulders: number
  scale: number
  side: TrackingSide
  // Optional for profiles saved before vertical posture measurements were introduced.
  headPitch?: number | null
  headTilt?: number | null
  neckHeight?: number | null
}

export interface Calibration {
  faceBaseline?: { pitch: number; yaw: number; roll: number } | null
  featureVersion?: number
  poseModel?: 'full' | 'lite'
  calibrationNoise?: Partial<Record<'drop' | 'shift' | 'shoulders' | 'scale' | 'neck' | 'headPitch' | 'headTilt' | 'neckHeight', number>>
  channelCoverage?: Partial<Record<'headPitch' | 'headTilt' | 'neckHeight', number>>
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
  channelQuality?: Partial<Record<'headPitch' | 'headTilt' | 'neckHeight' | 'neckAngle' | 'shoulderTilt' | 'headShift' | 'proximity', number>>
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
  accountingVersion?: 2
  candidateSeconds?: number
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
  candidateSeconds: number
  goodSeconds: number
  badSeconds: number
  unknownSeconds: number
  effectiveSeconds: number
  reminders: number
  sessions: number
  ratio: number | null
  score?: number | null
  grade?: string | null
}

export interface VisionFrame {
  type: 'frame'
  timestamp: number
  landmarks: Landmark[]
  width: number
  height: number
  blink: number | null
  inferenceMs: number
  headPose?: HeadPose | null
  poseInferenceMs?: number
  faceInferenceMs?: number | null
  faceTimestamp?: number | null
  droppedFrames?: number
}

export type VisionReply =
  | VisionFrame
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; model: 'full' | 'lite'; blink: boolean; headPoseAvailable: boolean; warning?: string }
  | { type: 'error'; message: string }

export const DEFAULT_SETTINGS: Settings = {
  cameraId: '',
  modelPreference: 'auto',
  headPoseEnabled: false,
  cameraFacingMode: 'user',
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
  eyeCareAuto: true,
  lowLightBoost: true,
  fps: 12,
  pomodoroEnabled: true,
  pomodoroFocusMinutes: 25,
  pomodoroShortBreakMinutes: 5,
  pomodoroLongBreakMinutes: 15,
  pomodoroLongInterval: 4,
  pomodoroAutoStartBreak: true,
  pomodoroAutoStartFocus: false,
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
