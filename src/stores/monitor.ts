import { computed, markRaw, ref, shallowRef, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS, STATE_LABELS, type Calibration, type DemoPose, type Features, type HeadPose, type Landmark, type Phase, type PostureState, type ReminderKind, type SessionRecord, type Settings, type VisionFrame } from '@/domain/types'
import { acceptFrameTimestamp, advancePostureHold, checkCalibrationCoverage, classify, makeCalibration, normalCoverage, observe, resumePostureHold, smoothFeatures, POSTURE_FEATURE_VERSION, type PostureVerdict } from '@/domain/posture'
import * as storage from '@/lib/storage'
import { buildOrgSummary, computeHealthScore, dailyStats, downloadFile, duration, localDay } from '@/lib/format'
import { DEMO_FEATURES, demoCalibration } from '@/lib/demo'
import { calibrateHeadPose } from '@/lib/head-pose'
import { checkNeckExerciseMatch, summarizePerformance, type LightingReport, type NeckExerciseStep } from '@/lib/lighting'
import { BlinkTracker } from '@/domain/blink'
import { detectInversion, ALIEN_MESSAGE, InversionTracker } from '@/domain/fun'
import { playReminder } from '@/lib/audio'
import { cameraError, VisionCamera } from '@/lib/vision'

export const useMonitorStore = defineStore('monitor', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const profiles = ref<Calibration[]>([])
  const sessions = ref<SessionRecord[]>([])
  const phase = ref<Phase>('idle')
  const state = ref<PostureState>('need_cal')
  const reason = ref('打开摄像头，建立你的参考坐姿')
  const error = ref('')
  const storageWarning = ref('')
  const initialized = ref(false)
  const busy = computed(() => phase.value === 'loading')
  const running = computed(() => ['ready', 'calibrating', 'monitoring'].includes(phase.value))
  const demo = ref(false)
  const demoPose = ref<DemoPose>('normal')
  const stream = shallowRef<MediaStream | null>(null)
  const landmarks = shallowRef<Landmark[]>([])
  const frameWidth = ref(640)
  const frameHeight = ref(480)
  const quality = ref(0)
  const inferenceMs = ref(0)
  const engine = ref('')
  const poseModel = ref<'full' | 'lite'>('lite')
  const cameraId = ref('')
  const devices = ref<MediaDeviceInfo[]>([])
  const calibrationProgress = ref(0)
  const calibrationSamples = ref(0)
  const feature = shallowRef<Features | null>(null)
  const channels = shallowRef<PostureVerdict['channels'] | null>(null)
  const deviation = ref(0)
  const session = ref<SessionRecord | null>(null)
  const demoSessions = ref<SessionRecord[]>([])
  const continuousSeconds = ref(0)
  const blinkRate = ref<number | null>(null)
  const blinkAvailable = ref(false)
  const headPoseAvailable = ref(false)
  const headPose = shallowRef<HeadPose | null>(null)
  const headPoseDelta = computed(() => {
    const current = headPose.value, baseline = profile.value?.faceBaseline
    if (!current || !baseline || !settings.value.headPoseEnabled || phase.value !== 'monitoring') return null
    return { pitch: current.pitch - baseline.pitch, yaw: current.yaw - baseline.yaw, roll: current.roll - baseline.roll }
  })
  const blinkCount = ref(0)
  const blinkObservedSeconds = ref(0)
  const blinkStatus = ref('开启眨眼参考后开始采集')
  const blinkTracker = new BlinkTracker()
  const funTracker = new InversionTracker()
  const funMoment = ref<typeof ALIEN_MESSAGE | null>(null)
  let funTimer: number | null = null
  const toast = ref<{ title: string; message: string; kind: 'info' | 'reminder' | 'error' } | null>(null)
  const restOpen = ref(false)
  const restRemaining = ref(0)
  const restKind = ref<ReminderKind>('break')
  const desktopRuntime = ref(window.pineaseDesktop?.isDesktop === true)
  const eyeCareActive = ref(false)
  const lighting = ref<LightingReport>({ luma: 128, centerLuma: 128, edgeLuma: 128, contrast: 32, status: 'normal', gamma: 1, boostApplied: false })
  const latencyWindow = ref<number[]>([])
  const frameTimeWindow = ref<number[]>([])
  const performanceStats = computed(() => summarizePerformance(latencyWindow.value, frameTimeWindow.value))
  const evalMetrics = ref({ totalFrames: 0, validFrames: 0, darkFrames: 0, backlitFrames: 0, candidateTransitions: 0, confirmedTransitions: 0 })
  const exerciseActive = ref(false)
  const exerciseStep = ref<NeckExerciseStep>('left')
  const exerciseProgress = ref(0)
  let performanceWarned = false
  let cameraPreview: HTMLVideoElement | null = null

  let camera: VisionCamera | null = null
  let token = 0
  let timer: number | null = null
  let saveTimer: number | null = null
  let toastTimer: number | null = null
  let lastTick = 0
  let lastFrame = 0
  let lastCapture = -Infinity
  let lastSmooth = 0
  let badSince: number | null = null
  let badReason: string | null = null
  let badGapStarted: number | null = null
  let badConfirmedBeforeGap = false
  let goodSince: number | null = null
  let absentSince: number | null = null
  let calibrationStart = 0
  let calibrationBuffer: Features[] = []
  let calibrationTimestamps: number[] = []
  let faceCalibrationSamples: HeadPose[] = []
  let restEnd = 0
  let nextBreak = 0
  let audio: AudioContext | null = null
  let blinkFaceMissing = true
  let profileMismatch = false
  let saving = Promise.resolve()
  const lastReminder: Record<ReminderKind, number> = { posture: -Infinity, break: -Infinity, eyes: -Infinity }

  const profile = computed<Calibration | null>(() => {
    if (demo.value) return demoCalibration()
    const id = cameraId.value || settings.value.cameraId
    return profiles.value.find((p) => p.view === settings.value.view && (id ? p.cameraId === id : true)) ?? null
  })
  const records = computed(() => {
    const base = demo.value ? demoSessions.value : sessions.value
    return session.value ? [session.value, ...base.filter((s) => s.id !== session.value?.id)] : base
  })
  const realRecords = computed(() => session.value?.mode === 'real'
    ? [session.value, ...sessions.value.filter(s => s.id !== session.value?.id)] : sessions.value)
  const today = computed(() => dailyStats(records.value, 1)[0]!)
  const elapsed = computed(() => session.value ? session.value.goodSeconds + session.value.badSeconds : 0)
  const stateLabel = computed(() => phase.value === 'idle' ? '还没有开始' : phase.value === 'loading' ? '正在准备摄像头' : STATE_LABELS[state.value])
  const stateColor = computed(() => {
    if (state.value === 'normal' && phase.value === 'monitoring') return 'green'
    if (state.value === 'bad') return 'amber'
    if (state.value === 'candidate_bad') return 'soft'
    return 'muted'
  })

  function toggleEyeCare(force?: boolean) {
    eyeCareActive.value = typeof force === 'boolean' ? force : !eyeCareActive.value
    try {
      document?.documentElement?.classList?.toggle('eye-care-mode', eyeCareActive.value)
    } catch { /* test env safe */ }
  }

  function startNeckExercise() {
    exerciseActive.value = true
    exerciseStep.value = 'left'
    exerciseProgress.value = 0
  }

  function advanceNeckExercise(matched: boolean, dtSeconds: number) {
    if (!exerciseActive.value || exerciseStep.value === 'done') return
    const rate = matched ? 55 : demo.value || !running.value ? 35 : 18
    exerciseProgress.value = Math.min(100, exerciseProgress.value + rate * dtSeconds)
    if (exerciseProgress.value >= 100) {
      if (exerciseStep.value === 'left') {
        exerciseStep.value = 'right'
        exerciseProgress.value = 0
      } else if (exerciseStep.value === 'right') {
        exerciseStep.value = 'up'
        exerciseProgress.value = 0
      } else if (exerciseStep.value === 'up') {
        exerciseStep.value = 'done'
        exerciseProgress.value = 100
        announce('颈部舒展完成', '肩膀放松，继续保持舒适的节奏。')
      }
    }
  }

  function announce(title: string, message = '', kind: 'info' | 'reminder' | 'error' = 'info') {
    toast.value = { title, message, kind }
    if (toastTimer !== null) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { toast.value = null }, kind === 'reminder' ? 7500 : 5000)
  }

  async function init() {
    if (initialized.value) return
    initialized.value = true
    try {
      const data = await storage.loadData()
      settings.value = data.settings
      profiles.value = data.calibrations
      sessions.value = data.sessions
    } catch { storageWarning.value = '浏览器存储暂不可用，本次记录只会保留在当前页面。你仍可以导出备份。' }
    await refreshDevices()
    document.addEventListener('visibilitychange', () => {
      if (!desktopRuntime.value && document.hidden && (running.value || busy.value)) pause('页面移到后台，已暂停监测')
    })
    window.addEventListener('pagehide', () => {
      if (running.value || busy.value) pause('页面已离开，监测已暂停')
      else void persist()
    })
  }

  async function refreshDevices() {
    try {
      devices.value = (await navigator.mediaDevices?.enumerateDevices() ?? []).filter((d) => d.kind === 'videoinput')
    } catch { devices.value = [] }
  }

  function queueSave(job: () => Promise<void>): Promise<boolean> {
    let succeeded = false
    saving = saving.then(async () => { await job(); succeeded = true }).catch(() => {
      storageWarning.value = '记录暂时无法写入本机，请先导出备份。'
    })
    return saving.then(() => succeeded)
  }

  async function persist(record: SessionRecord | null = session.value) {
    if (!record || record.mode === 'demo') return
    const snapshot = JSON.parse(JSON.stringify(record)) as SessionRecord
    await queueSave(() => storage.saveSession(snapshot))
    const index = sessions.value.findIndex((s) => s.id === snapshot.id)
    if (index >= 0) sessions.value[index] = snapshot
    else sessions.value.unshift(snapshot)
  }

  function resetDynamics() {
    resetFun()
    feature.value = null
    channels.value = null
    headPose.value = null
    lastFrame = 0
    lastCapture = -Infinity
    lastSmooth = 0
    badSince = goodSince = absentSince = null
    badReason = null
    badGapStarted = null
    badConfirmedBeforeGap = false
    blinkTracker.reset()
    blinkFaceMissing = true
    blinkCount.value = blinkObservedSeconds.value = 0
    blinkStatus.value = '等待清晰双眼与连续采样'
    blinkRate.value = null
    quality.value = 0
    landmarks.value = []
    latencyWindow.value = []
    frameTimeWindow.value = []
    lighting.value = { luma: 128, centerLuma: 128, edgeLuma: 128, contrast: 32, status: 'normal', gamma: 1, boostApplied: false }
    performanceWarned = false
  }

  function createSession(mode: 'real' | 'demo') {
    session.value = {
      id: crypto.randomUUID(), mode, startedAt: Date.now(), endedAt: null, view: mode === 'demo' ? 'front' : settings.value.view,
      accountingVersion: 2, candidateSeconds: 0,
      goodSeconds: 0, badSeconds: 0, unknownSeconds: 0, absentSeconds: 0, pausedSeconds: 0,
      reminders: [], segments: [],
    }
    evalMetrics.value = { totalFrames: 0, validFrames: 0, darkFrames: 0, backlitFrames: 0, candidateTransitions: 0, confirmedTransitions: 0 }
    continuousSeconds.value = 0
    nextBreak = settings.value.sitMinutes * 60
    lastReminder.posture = lastReminder.break = lastReminder.eyes = -Infinity
    lastTick = performance.now()
    if (timer !== null) window.clearInterval(timer)
    timer = window.setInterval(tick, 1000)
    if (saveTimer !== null) window.clearInterval(saveTimer)
    saveTimer = window.setInterval(() => { void persist() }, 10000)
  }

  function addSegment(s: PostureState, message: string, dt: number) {
    const r = session.value
    if (!r || dt <= 0) return
    const end = Date.now()
    const start = end - dt * 1000
    const last = r.segments[r.segments.length - 1]
    if (last && last.state === s && last.reason === message && localDay(last.startedAt) === localDay(start) && start - last.endedAt < 2500) {
      last.endedAt = end
      last.seconds += dt
    } else r.segments.push({ startedAt: start, endedAt: end, seconds: dt, state: s, reason: message })
    if (s === 'normal') r.goodSeconds += dt
    if (s === 'bad') r.badSeconds += dt
    if (s === 'candidate_bad') r.candidateSeconds = (r.candidateSeconds ?? 0) + dt
    if (s === 'unknown' || s === 'need_cal') r.unknownSeconds += dt
    if (s === 'absent') r.absentSeconds += dt
    if (s === 'paused') r.pausedSeconds += dt
  }

  function tick() {
    if (settings.value.blinkEnabled && blinkAvailable.value && phase.value === 'monitoring') showBlink(performance.now())
    const now = performance.now()
    if (headPose.value && now - headPose.value.observedAt > 1500) headPose.value = null
    const gap = Math.max(0, (now - lastTick) / 1000)
    const dt = Math.min(gap, 1.5)
    lastTick = now
    if (!session.value) return
    if (demo.value && phase.value === 'monitoring') {
      handleDemo(now)
    }
    let current = state.value
    if (phase.value === 'paused') current = 'paused'
    else if (phase.value === 'calibrating' || phase.value === 'ready') current = 'need_cal'
    else if (!demo.value && (now - lastFrame > 2500 || gap > 2.5)) {
      current = 'unknown'
      state.value = 'unknown'
      reason.value = '等待可靠的摄像头画面'
      badSince = goodSince = null
      badReason = null
      badGapStarted = null
      badConfirmedBeforeGap = false
    }
    addSegment(current, reason.value, dt)
    if (current === 'normal' || current === 'bad' || current === 'candidate_bad') continuousSeconds.value += dt
    if (current === 'absent') continuousSeconds.value = 0
    if (phase.value === 'calibrating') {
      calibrationProgress.value = Math.min(100, (now - calibrationStart) / 80)
      if (now - calibrationStart >= 8000) finishCalibration()
    }
    if (phase.value === 'monitoring' && current === 'bad') remind('posture', reason.value)
    if (settings.value.breakEnabled && continuousSeconds.value >= nextBreak && phase.value === 'monitoring') {
      remind('break', '专注了一段时间，起来走走吧')
      nextBreak = continuousSeconds.value + settings.value.sitMinutes * 60
    }
    if (restOpen.value) {
      if (exerciseActive.value && exerciseStep.value !== 'done') {
        const matched = checkNeckExerciseMatch(exerciseStep.value, headPoseDelta.value, feature.value, profile.value?.baseline ?? null, landmarks.value)
        advanceNeckExercise(matched, dt)
      }
      restRemaining.value = Math.max(0, Math.ceil((restEnd - now) / 1000))
      if (restRemaining.value === 0) closeRest()
    }
  }

  async function startCamera(resuming = false) {
    if (busy.value || running.value) return
    if (!resuming) {
      if (session.value) await endSession()
      demo.value = false
      error.value = ''
      session.value = null
    }
    const generation = ++token
    phase.value = 'loading'
    resetDynamics()
    profileMismatch = false
    const active = markRaw(new VisionCamera(onFrame, (message) => {
      if (generation !== token) return
      error.value = message
      void endSession()
    }, () => cameraPreview, (report) => {
      lighting.value = report
    }))
    camera = active
    try {
      const result = await active.open(settings.value.cameraId, settings.value.cameraFacingMode, settings.value.blinkEnabled, settings.value.fps, settings.value.modelPreference, settings.value.headPoseEnabled, settings.value.lowLightBoost)
      if (generation !== token) { active.close(); return }
      cameraId.value = result.cameraId
      stream.value = active.stream ? markRaw(active.stream) : null
      engine.value = (result.model === 'full' ? 'Full' : 'Lite') + ' · ' + result.delegate
      poseModel.value = result.model === 'full' ? 'full' : 'lite'
      blinkAvailable.value = result.blink
      headPoseAvailable.value = result.headPoseAvailable === true
      frameWidth.value = active.video?.videoWidth || 640
      frameHeight.value = active.video?.videoHeight || 480
      const aspect = frameWidth.value / frameHeight.value
      const updatedFeatures = !!profile.value && profile.value.featureVersion !== POSTURE_FEATURE_VERSION
      const changedModel = !!profile.value && (profile.value.poseModel ?? 'lite') !== poseModel.value
      profileMismatch = updatedFeatures || changedModel || !!profile.value && Math.abs(profile.value.aspect - aspect) > 0.08
      phase.value = profile.value && !profileMismatch ? 'monitoring' : 'ready'
      state.value = phase.value === 'monitoring' ? 'unknown' : 'need_cal'
      reason.value = updatedFeatures ? '检测特征已更新，请重新校准' : changedModel ? '姿态模型已切换，请重新校准' : profileMismatch ? '画面比例变了，请重新校准' : profile.value ? '等待识别你的坐姿' : '准备好后，花 8 秒建立参考坐姿'
      if (!session.value) createSession('real')
      else lastTick = performance.now()
      if (result.warning) announce('坐姿监测已准备好', result.warning)
      await refreshDevices()
      if (settings.value.soundEnabled) prepareAudio()
    } catch (failure) {
      active.close()
      if (generation !== token) return
      stream.value = null
      if (camera === active) camera = null
      error.value = cameraError(failure)
      phase.value = resuming && session.value ? 'paused' : 'idle'
      state.value = resuming ? 'paused' : 'need_cal'
    }
  }

  async function startDemo() {
    await endSession()
    token++
    error.value = ''
    demo.value = true
    demoPose.value = 'normal'
    blinkAvailable.value = false
    headPoseAvailable.value = false
    resetDynamics()
    phase.value = 'monitoring'
    state.value = 'normal'
    reason.value = '演示中：保持舒适的参考坐姿'
    engine.value = '演示'
    createSession('demo')
    handleDemo(performance.now())
  }

  function handleDemo(now: number) {
    lastFrame = now
    quality.value = demoPose.value === 'absent' ? 0 : 0.98
    if (demoPose.value === 'absent') {
      handleObservation([], now, 640, 480)
      return
    }
    const f = { ...DEMO_FEATURES, drop: demoPose.value === 'bad' ? -0.4 : -0.7 }
    feature.value = f
    updatePosture(f, demoCalibration(), now)
  }

  function updatePosture(f: Features, reference: Calibration, now: number, channelQuality?: import('@/domain/types').Observation['channelQuality']) {
    const previousState = state.value
    if (badGapStarted !== null) {
      badSince = resumePostureHold(badSince, badGapStarted, now)
      if (badSince === null) { badReason = null; badConfirmedBeforeGap = false }
      badGapStarted = null
    }
    const wasConfirmed = state.value === 'bad' || badConfirmedBeforeGap
    const exitSensitivity = wasConfirmed ? settings.value.sensitivity / 0.7 : settings.value.sensitivity
    const verdict = classify(f, reference, { ...settings.value, sensitivity: exitSensitivity }, channelQuality)
    channels.value = verdict.channels
    deviation.value = verdict.deviation
    if (verdict.unknown) {
      badGapStarted ??= now
      badConfirmedBeforeGap ||= state.value === 'bad'
      goodSince = null
      state.value = 'unknown'
      reason.value = verdict.reason
      if (restOpen.value && restKind.value === 'posture') closeRest()
      return
    }
    if (verdict.bad) {
      goodSince = null
      const hold = advancePostureHold({ reason: badReason, since: badSince }, verdict.reason, now, settings.value.holdSeconds, wasConfirmed)
      badReason = hold.reason
      badSince = hold.since
      badConfirmedBeforeGap = false
      state.value = hold.confirmed ? 'bad' : 'candidate_bad'
      if (previousState !== 'candidate_bad' && state.value === 'candidate_bad') evalMetrics.value.candidateTransitions++
      if (previousState !== 'bad' && state.value === 'bad') evalMetrics.value.confirmedTransitions++
      reason.value = verdict.reason
    } else {
      badSince = null
      badReason = null
      badConfirmedBeforeGap = false
      if (wasConfirmed) {
        goodSince ??= now
        if (now - goodSince < settings.value.recoverySeconds * 1000) { state.value = 'bad'; reason.value = '正在回到参考坐姿'; return }
      }
      state.value = 'normal'
      reason.value = normalCoverage(verdict.channels)
      goodSince = null
      if (restOpen.value && restKind.value === 'posture') closeRest()
    }
  }

  function handleObservation(points: Landmark[], now: number, width: number, height: number) {
    const result = observe(points, width, height, settings.value.view, phase.value === 'calibrating' ? undefined : profile.value?.side)
    quality.value = result.quality
    evalMetrics.value.totalFrames++
    if (lighting.value.status === 'dark') evalMetrics.value.darkFrames++
    if (lighting.value.status === 'backlit') evalMetrics.value.backlitFrames++
    if (!result.valid || !result.features) {
      feature.value = null
      channels.value = null
      lastSmooth = 0
      goodSince = null
      if (badGapStarted === null) {
        badGapStarted = now
        badConfirmedBeforeGap = state.value === 'bad'
      }
      if (result.noPerson) {
        absentSince ??= now
        state.value = now - absentSince >= 5000 ? 'absent' : 'unknown'
      } else { absentSince = null; state.value = 'unknown' }
      reason.value = result.reason
      if (state.value === 'absent') continuousSeconds.value = 0
      if (restOpen.value && restKind.value === 'posture') closeRest()
      return
    }
    evalMetrics.value.validFrames++
    absentSince = null
    if (phase.value === 'calibrating') {
      channels.value = null
      calibrationBuffer.push(result.features)
      calibrationTimestamps.push(now)
      const leftSamples = settings.value.view === 'side' ? calibrationBuffer.filter(sample => sample.side === 'left').length : 0
      calibrationSamples.value = settings.value.view === 'side' ? Math.max(leftSamples, calibrationBuffer.length - leftSamples) : calibrationBuffer.length
      feature.value = result.features
      return
    }
    if (phase.value === 'ready' || !profile.value || profileMismatch) { state.value = 'need_cal'; return }
    const elapsed = lastSmooth ? (now - lastSmooth) / 1000 : 10
    feature.value = smoothFeatures(feature.value, result.features, elapsed)
    lastSmooth = now
    updatePosture(feature.value, profile.value, now, result.channelQuality)
  }

  function onFrame(frame: VisionFrame) {
    if (!running.value || demo.value) return
    if (!acceptFrameTimestamp(frame.timestamp, performance.now(), lastCapture)) return
    lastCapture = frame.timestamp
    lastFrame = frame.timestamp
    landmarks.value = frame.landmarks
    frameWidth.value = frame.width
    frameHeight.value = frame.height
    const calibrated = profile.value
    if (calibrated && Math.abs(calibrated.aspect - frame.width / frame.height) > 0.08 && !profileMismatch) {
      profileMismatch = true
      phase.value = 'ready'
      state.value = 'need_cal'
      reason.value = '画面比例变了，请重新校准'
      announce('需要重新校准', '摄像头方向或画面比例已变化，请重新校准后继续监测。')
    }
    inferenceMs.value = frame.inferenceMs
    latencyWindow.value = [...latencyWindow.value.slice(-29), frame.inferenceMs]
    frameTimeWindow.value = [...frameTimeWindow.value.slice(-29), frame.timestamp]
    if (!performanceWarned && poseModel.value === 'full' && performanceStats.value.degraded) {
      performanceWarned = true
      announce('推理耗时偏高', '当前设备运行 Full 模型较慢，可在设置中切换为「节能 · Lite」以降低功耗。')
    }
    handleObservation(frame.landmarks, frame.timestamp, frame.width, frame.height)
    headPose.value = settings.value.headPoseEnabled ? frame.headPose ?? null : null
    if (phase.value === 'calibrating' && quality.value >= 0.55 && headPose.value) faceCalibrationSamples.push(headPose.value)
    if (phase.value === 'ready' || phase.value === 'monitoring') {
      if (funTracker.update(detectInversion(frame.landmarks, frame.width, frame.height), frame.timestamp)) showFun()
    }
    if (settings.value.blinkEnabled && blinkAvailable.value && phase.value === 'monitoring') handleBlink(frame.blink, frame.timestamp)
  }

  function showBlink(now: number, faceMissing = blinkFaceMissing) {
    const result = blinkTracker.snapshot(now)
    blinkRate.value = result.rate
    blinkCount.value = result.count
    blinkObservedSeconds.value = Math.floor(result.seconds)
    blinkStatus.value = faceMissing ? '未看清双眼，请面向摄像头并改善光线'
      : !result.fresh || result.fps < 8 ? '采样不足或较慢，暂不估算频率'
      : result.seconds < 20 ? '正在积累有效观察（至少 20 秒）'
      : '正在估算近期频率，短促眨眼仍可能漏计'
    return result
  }

  function handleBlink(score: number | null, now: number) {
    blinkFaceMissing = score === null
    blinkTracker.update(score, now)
    const result = showBlink(now, score === null)
    if (result.seconds >= 30 && result.rate !== null && result.rate < 8) {
      if (settings.value.eyeCareAuto && !eyeCareActive.value) {
        toggleEyeCare(true)
        remind('eyes', '近期眨眼偏少，已为你自动开启柔和护眼模式')
      } else {
        remind('eyes', '看看远处，放松一下眼睛')
      }
    }
  }

  function beginCalibration() {
    if (!running.value || demo.value || phase.value === 'calibrating') return
    resetFun()
    calibrationStart = performance.now()
    calibrationBuffer = []
    calibrationTimestamps = []
    faceCalibrationSamples = []
    calibrationSamples.value = 0
    calibrationProgress.value = 0
    phase.value = 'calibrating'
    state.value = 'need_cal'
    reason.value = '保持舒适坐姿，头部和肩膀尽量不动'
    feature.value = null
    badSince = goodSince = null
    badReason = null
    badGapStarted = null
    badConfirmedBeforeGap = false
  }

  function finishCalibration() {
    if (phase.value !== 'calibrating') return
    try {
      const leftCount = calibrationBuffer.filter(sample => sample.side === 'left').length
      const dominantSide = leftCount >= calibrationBuffer.length / 2 ? 'left' : 'right'
      const coverageTimes = settings.value.view === 'side'
        ? calibrationTimestamps.filter((_time, index) => calibrationBuffer[index]?.side === dominantSide)
        : calibrationTimestamps
      const timeCoverage = checkCalibrationCoverage(coverageTimes)
      if (!timeCoverage.valid) throw new Error(timeCoverage.reason)
      const result = makeCalibration(calibrationBuffer, settings.value.view, cameraId.value, frameWidth.value / frameHeight.value, poseModel.value)
      result.faceBaseline = settings.value.headPoseEnabled ? calibrateHeadPose(faceCalibrationSamples) : null
      profiles.value = [result, ...profiles.value.filter((p) => p.id !== result.id)]
      profileMismatch = false
      calibrationProgress.value = 100
      phase.value = 'monitoring'
      state.value = 'normal'
      reason.value = '参考坐姿已建立，继续专注吧'
      feature.value = null
      lastSmooth = 0
      void queueSave(() => storage.saveCalibration(result)).then(saved => { if (!saved) announce('参考仅在本次运行有效', '校准未能写入本机，请检查存储。', 'error') })
      const coverage = []
      if (settings.value.headPoseEnabled && !result.faceBaseline) coverage.push('人脸参考不足，头姿实验功能暂不可用')
      if (result.baseline.headPitch == null) coverage.push('鼻耳位置未持续清晰，头部俯仰参考未启用')
      if (result.view === 'side' && result.baseline.torsoHeight == null && result.baseline.torso == null) coverage.push('髋部参考不足，含胸与上身下沉检测未启用')
      announce('校准完成', coverage.length ? coverage.join('；') + '。其余检测继续工作。' : result.baseline.torsoHeight != null ? '已建立头部俯仰与躯干高度参考。换机位后请重新校准。' : '已建立头肩坐姿参考。换机位后请重新校准。')
    } catch (failure) {
      phase.value = 'ready'
      state.value = 'need_cal'
      calibrationProgress.value = 0
      reason.value = failure instanceof Error ? failure.message : '校准未完成，请再试一次。'
      announce('再调整一下', reason.value, 'error')
    }
  }

  function pause(message = '监测已暂停，摄像头已关闭') {
    if (busy.value) { void endSession(); reason.value = message; return }
    if (!running.value) return
    tick()
    phase.value = 'paused'
    state.value = 'paused'
    reason.value = message
    camera?.close()
    camera = null
    stream.value = null
    calibrationBuffer = []
    calibrationTimestamps = []
    resetDynamics()
    closeRest()
    void persist()
  }

  async function resume() {
    if (phase.value !== 'paused') return
    if (demo.value) {
      phase.value = 'monitoring'
      lastTick = performance.now()
      state.value = 'normal'
      resetDynamics()
      handleDemo(performance.now())
    } else await startCamera(true)
  }

  async function endSession() {
    if (phase.value !== 'idle' && session.value) tick()
    token++
    camera?.close()
    camera = null
    stream.value = null
    phase.value = 'idle'
    state.value = 'need_cal'
    closeRest()
    if (timer !== null) clearInterval(timer)
    if (saveTimer !== null) clearInterval(saveTimer)
    timer = saveTimer = null
    const ended = session.value
    session.value = null
    demo.value = false
    resetDynamics()
    reason.value = '本次监测已结束'
    if (ended) {
      ended.endedAt = Date.now()
      if (ended.mode === 'demo') {
        demoSessions.value = [JSON.parse(JSON.stringify(ended)) as SessionRecord, ...demoSessions.value.filter(r => r.id !== ended.id)]
      } else await persist(ended)
    }
  }

  function prepareAudio() {
    try { audio ??= new AudioContext(); void audio.resume() } catch { audio = null }
  }

  async function playCue(preview = false) {
    if (!preview && !settings.value.soundEnabled) return
    prepareAudio()
    if (!audio) { announce('声音暂不可用', '请检查浏览器与系统音量。', 'error'); return }
    try {
      await audio.resume()
      playReminder(audio, settings.value.soundVolume, settings.value.soundRepeats)
    } catch { announce('声音暂不可用', '请点击试听并检查系统音量。', 'error') }
  }

  function previewSound() { void playCue(true) }

  function remind(kind: ReminderKind, message: string) {
    const now = performance.now()
    const cooldown = kind === 'eyes' ? 300 : settings.value.cooldownSeconds
    if (now - lastReminder[kind] < cooldown * 1000 || phase.value !== 'monitoring') return
    lastReminder[kind] = now
    session.value?.reminders.push({ at: Date.now(), kind, message })
    announce(kind === 'posture' ? '坐得舒服一些' : kind === 'eyes' ? '给眼睛一点休息' : '该活动一下了', message, 'reminder')
    void playCue()
    if (desktopRuntime.value) void window.pineaseDesktop?.notify('PinEase · 青松坐姿', message)
    if (!desktopRuntime.value && settings.value.notificationsEnabled && !demo.value && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('PinEase · 青松坐姿', { body: message, tag: 'pinease-' + kind, icon: new URL(import.meta.env.BASE_URL + 'icon.svg', window.location.href).href }) } catch { /* 页面提醒继续可用 */ }
    }
    if (kind === 'break' || kind === 'posture' && settings.value.focusReminder) {
      restKind.value = kind
      restRemaining.value = settings.value.restSeconds
      restEnd = now + settings.value.restSeconds * 1000
      restOpen.value = true
      exerciseActive.value = false
      exerciseStep.value = 'left'
      exerciseProgress.value = 0
      if (desktopRuntime.value && settings.value.focusReminder) {
        void window.pineaseDesktop?.setRestOverlay?.(true)
      }
    }
    void persist()
  }

  function closeRest() {
    if (restOpen.value && restKind.value === 'break') {
      continuousSeconds.value = 0
      nextBreak = settings.value.sitMinutes * 60
    }
    const wasOpen = restOpen.value
    restOpen.value = false
    exerciseActive.value = false
    if (wasOpen) {
      if (desktopRuntime.value) void window.pineaseDesktop?.setRestOverlay?.(false)
      try {
        if (document?.fullscreenElement && typeof document.exitFullscreen === 'function') {
          void document.exitFullscreen().catch(() => {})
        }
      } catch { /* ignore */ }
    }
  }

  async function testDesktopNotification() {
    if (!desktopRuntime.value || !window.pineaseDesktop) return
    const available = await window.pineaseDesktop.notificationAvailable()
    if (!available) { announce('系统通知暂不可用', '请检查 Windows 通知设置。', 'error'); return }
    const sent = await window.pineaseDesktop.notify('PinEase · 测试提醒', '这是一条测试通知，不计入监测历史。')
    announce(sent ? '已发送测试通知' : '测试通知未显示', sent ? '请检查系统通知中心。' : '请检查 Windows 通知设置。', sent ? 'info' : 'error')
  }

  async function updateSettings(partial: Partial<Settings>): Promise<boolean> {
    const next = storage.sanitizeSettings({ ...settings.value, ...partial })
    if (camera) camera.lowLightBoost = next.lowLightBoost
    const needsRestart = next.view !== settings.value.view || next.cameraId !== settings.value.cameraId || next.cameraFacingMode !== settings.value.cameraFacingMode || next.blinkEnabled !== settings.value.blinkEnabled || next.headPoseEnabled !== settings.value.headPoseEnabled || next.modelPreference !== settings.value.modelPreference || next.fps !== settings.value.fps
    if (needsRestart && (running.value || phase.value === 'paused' || busy.value)) await endSession()
    const breakChanged = next.sitMinutes !== settings.value.sitMinutes || next.breakEnabled !== settings.value.breakEnabled
    settings.value = next
    if (next.soundEnabled) prepareAudio()
    if (breakChanged) nextBreak = next.sitMinutes * 60
    const saved = await queueSave(() => storage.saveSettings({ ...next }))
    if (!saved) announce('设置仅在当前页面生效', '本机存储失败，请检查存储空间并导出备份。', 'error')
    else if (needsRestart) announce('设置已保存', '下次开始监测时使用新的设置。')
    return saved
  }

  async function requestNotifications() {
    if (desktopRuntime.value) return
    if (!('Notification' in window)) { announce('当前浏览器不支持通知', '页面内提醒仍然可用。'); return }
    const permission = await Notification.requestPermission()
    await updateSettings({ notificationsEnabled: permission === 'granted' })
    announce(permission === 'granted' ? '通知已开启' : '继续使用页面提醒')
  }

  async function resetProfiles() {
    await endSession()
    await storage.clearCalibrations()
    profiles.value = []
    announce('参考坐姿已清除', '下次开始时重新校准。')
  }

  function exportBackup() {
    const values = [...sessions.value]
    if (session.value?.mode === 'real') {
      const index = values.findIndex((r) => r.id === session.value?.id)
      if (index >= 0) values[index] = session.value
      else values.unshift(session.value)
    }
    downloadFile('PinEase-backup-' + localDay() + '.json', JSON.stringify({ application: 'PinEase', schema: 1, exportedAt: new Date().toISOString(), sessions: toRaw(values) }, null, 2))
    announce('备份已导出', '包含真实监测记录，不包含摄像头画面。')
  }

  function exportCSV(days: 7 | 30 = 30) {
    const rows = ['日期,正常秒数,偏离秒数,未知秒数,有效秒数,良好占比,提醒次数,健康评分']
    for (const d of dailyStats(realRecords.value, days)) rows.push([d.date, Math.round(d.goodSeconds), Math.round(d.badSeconds), Math.round(d.unknownSeconds), Math.round(d.effectiveSeconds), d.ratio === null ? '' : Math.round(d.ratio * 100) + '%', d.reminders, d.score ?? ''].join(','))
    downloadFile('PinEase-summary-' + days + 'd-' + localDay() + '.csv', '\uFEFF' + rows.join('\r\n'), 'text/csv;charset=utf-8')
  }

  function exportOrgReport(days: 7 | 30 = 7, seatLabel = '自习座位-01') {
    const payload = buildOrgSummary(realRecords.value, days, seatLabel)
    downloadFile(`PinEase-org-seat-${localDay()}.json`, JSON.stringify(payload, null, 2))
    announce('脱敏统计包已导出', '仅包含聚合时长与评分，不含摄像头画面或个人隐私标识。')
  }

  function exportEvaluationReport() {
    const all = realRecords.value
    const totalGood = all.reduce((sum, s) => sum + s.goodSeconds, 0)
    const totalBad = all.reduce((sum, s) => sum + s.badSeconds, 0)
    const totalCandidate = all.reduce((sum, s) => sum + (s.candidateSeconds ?? 0), 0)
    const totalUnknown = all.reduce((sum, s) => sum + s.unknownSeconds, 0)
    const totalEffective = totalGood + totalBad
    const totalReminders = all.reduce((sum, s) => sum + s.reminders.length, 0)
    const { score } = computeHealthScore(totalGood, totalBad, totalReminders)
    const perf = performanceStats.value
    const m = evalMetrics.value
    const validFrameRatio = m.totalFrames > 0 ? Math.round((m.validFrames / m.totalFrames) * 100) + '%' : '待实测采集'
    const debounceFilterRate = m.candidateTransitions > 0
      ? Math.max(0, Math.round(((m.candidateTransitions - m.confirmedTransitions) / m.candidateTransitions) * 100)) + '%'
      : '—'
    const md = [
      '# 青松坐姿（PinEase）设备端推理视觉姿态识别系统评测记录',
      '',
      `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
      `- 运行环境：${desktopRuntime.value ? 'Windows Electron 桌面端' : 'Web 浏览器端'}`,
      `- 识别引擎与模型：${engine.value || settings.value.modelPreference}（设定帧率 ${settings.value.fps} FPS，机位：${settings.value.view === 'front' ? '正面' : '侧面'}）`,
      `- 暗光/逆光自适应补偿：${settings.value.lowLightBoost ? '已开启' : '未开启'}（当前环境亮度 Luma=${lighting.value.luma}，状态：${lighting.value.status}）`,
      '',
      '## 一、推理性能与功耗平衡指标',
      `- 采样帧数：${perf.samples} 帧（本次运行累计 ${m.totalFrames} 帧）`,
      `- 单帧推理耗时中位数（p50）：${perf.p50Ms} ms`,
      `- 单帧推理耗时 95 分位（p95）：${perf.p95Ms} ms`,
      `- 单帧平均推理耗时：${perf.avgMs} ms`,
      `- 实际有效吞吐帧率：${perf.estimatedFps || settings.value.fps} FPS`,
      '',
      '## 二、关键点鲁棒性与时间窗口防抖（Debouncing）评估',
      `- 关键点有效检出率：${validFrameRatio}（有效帧 ${m.validFrames} / 总帧数 ${m.totalFrames}）`,
      `- 暗光/逆光帧占比：暗光 ${m.darkFrames} 帧，逆光 ${m.backlitFrames} 帧`,
      `- 候选姿态变化触发次数：${m.candidateTransitions} 次`,
      `- 持续超阈值确认偏离次数：${m.confirmedTransitions} 次（保持阈值 ${settings.value.holdSeconds} 秒）`,
      `- 短时动作防抖过滤率：${debounceFilterRate}`,
      '',
      '## 三、累计有效监测与健康评分统计',
      `- 真实监测会话总数：${all.length} 段`,
      `- 累计有效在座时长：${duration(totalEffective)}（正常 ${duration(totalGood)} / 偏离 ${duration(totalBad)}）`,
      `- 累计候选微调时长（未触发误报）：${duration(totalCandidate)}`,
      `- 累计未知/遮挡剥离时长：${duration(totalUnknown)}`,
      `- 综合坐姿健康评分：${score === null ? '暂无' : score + ' / 100 分'}`,
    ].join('\r\n')
    downloadFile(`PinEase-评测报告-${localDay()}.md`, md, 'text/markdown;charset=utf-8')
    announce('评测报告已导出', '已生成 Markdown 格式的推理性能与防抖鲁棒性评测报告。')
  }

  async function importBackup(text: string) {
    const count = await storage.importHistory(text)
    const data = await storage.loadData()
    sessions.value = data.sessions
    announce('备份已导入', '恢复了 ' + count + ' 条记录，相同记录已合并。')
  }

  async function deleteHistory() {
    await endSession()
    await storage.clearHistory()
    sessions.value = []
    announce('监测历史已清除')
  }

  function dismissToast() { toast.value = null }

  function bindCameraPreview(video: HTMLVideoElement | null) { cameraPreview = video }

  function updateVideoSize(width: number, height: number) {
    if (!width || !height) return
    frameWidth.value = width
    frameHeight.value = height
  }

  async function handleDesktopCommand(command: 'pause' | 'resume' | 'quit') {
    if (command === 'pause') pause('电脑锁定或进入睡眠，监测已暂停')
    if (command === 'resume') await resume()
    if (command === 'quit') {
      await endSession()
      window.pineaseDesktop?.readyToQuit()
    }
  }

  function dismissFun() {
    if (funTimer !== null) window.clearTimeout(funTimer)
    funTimer = null
    funMoment.value = null
  }

  function resetFun() {
    dismissFun()
    funTracker.reset()
  }

  function showFun() {
    dismissFun()
    funMoment.value = { ...ALIEN_MESSAGE }
    funTimer = window.setTimeout(dismissFun, 5000)
  }

  return {
    settings, profiles, sessions, records, realRecords, phase, state, reason, error, storageWarning, initialized, busy, running, desktopRuntime,
    demo, demoPose, stream, landmarks, frameWidth, frameHeight, quality, inferenceMs, engine, poseModel, devices,
    calibrationProgress, calibrationSamples, feature, channels, deviation, session, today, elapsed, profile,
    continuousSeconds, headPoseAvailable, headPose, headPoseDelta, blinkRate, blinkAvailable, blinkCount, blinkObservedSeconds, blinkStatus, toast, restOpen, restRemaining, restKind, stateLabel, stateColor,
    eyeCareActive, lighting, performanceStats, evalMetrics, exerciseActive, exerciseStep, exerciseProgress,
    init, startCamera, startDemo, beginCalibration, pause, resume, endSession, updateSettings, refreshDevices,
    requestNotifications, testDesktopNotification, resetProfiles, exportBackup, exportCSV, exportOrgReport, exportEvaluationReport, importBackup, deleteHistory, dismissToast,
    closeRest, announce, previewSound, funMoment, dismissFun, bindCameraPreview, updateVideoSize, handleDesktopCommand, toggleEyeCare, startNeckExercise,
  }
})
