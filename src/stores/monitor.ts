import { computed, markRaw, ref, shallowRef, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS, STATE_LABELS, type Calibration, type DemoPose, type Features, type Landmark, type Phase, type PostureState, type ReminderKind, type SessionRecord, type Settings, type VisionFrame } from '@/domain/types'
import { classify, makeCalibration, observe, smoothFeatures } from '@/domain/posture'
import * as storage from '@/lib/storage'
import { dailyStats, downloadFile, localDay } from '@/lib/format'
import { DEMO_FEATURES, demoCalibration } from '@/lib/demo'
import { BlinkTracker } from '@/domain/blink'
import { detectFun, FUN_MESSAGES, FunTracker, type FunKind } from '@/domain/fun'
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
  const cameraId = ref('')
  const devices = ref<MediaDeviceInfo[]>([])
  const calibrationProgress = ref(0)
  const calibrationSamples = ref(0)
  const feature = shallowRef<Features | null>(null)
  const deviation = ref(0)
  const session = ref<SessionRecord | null>(null)
  const demoSessions = ref<SessionRecord[]>([])
  const continuousSeconds = ref(0)
  const blinkRate = ref<number | null>(null)
  const blinkAvailable = ref(false)
  const blinkCount = ref(0)
  const blinkObservedSeconds = ref(0)
  const blinkStatus = ref('开启眨眼参考后开始采集')
  const blinkTracker = new BlinkTracker()
  const funTracker = new FunTracker()
  const funMoment = ref<(typeof FUN_MESSAGES)[FunKind] & { preview: boolean } | null>(null)
  let funTimer: number | null = null
  const toast = ref<{ title: string; message: string; kind: 'info' | 'reminder' | 'error' } | null>(null)
  const restOpen = ref(false)
  const restRemaining = ref(0)
  const restKind = ref<ReminderKind>('break')

  let camera: VisionCamera | null = null
  let token = 0
  let timer: number | null = null
  let saveTimer: number | null = null
  let toastTimer: number | null = null
  let lastTick = 0
  let lastFrame = 0
  let lastSmooth = 0
  let badSince: number | null = null
  let goodSince: number | null = null
  let absentSince: number | null = null
  let calibrationStart = 0
  let calibrationBuffer: Features[] = []
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
  const today = computed(() => dailyStats(records.value, 1)[0]!)
  const elapsed = computed(() => session.value ? session.value.goodSeconds + session.value.badSeconds : 0)
  const stateLabel = computed(() => phase.value === 'idle' ? '还没有开始' : phase.value === 'loading' ? '正在准备摄像头' : STATE_LABELS[state.value])
  const stateColor = computed(() => {
    if (state.value === 'normal' && phase.value === 'monitoring') return 'green'
    if (state.value === 'bad') return 'amber'
    if (state.value === 'candidate_bad') return 'soft'
    return 'muted'
  })

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
      if (document.hidden && running.value) pause('页面移到后台，已暂停监测')
    })
    window.addEventListener('pagehide', () => {
      camera?.close()
      void persist()
    })
  }

  async function refreshDevices() {
    try {
      devices.value = (await navigator.mediaDevices?.enumerateDevices() ?? []).filter((d) => d.kind === 'videoinput')
    } catch { devices.value = [] }
  }

  function queueSave(job: () => Promise<void>) {
    saving = saving.then(job).catch(() => {
      storageWarning.value = '记录暂时无法写入浏览器，请先导出备份。'
    })
    return saving
  }

  async function persist() {
    if (!session.value || demo.value) return
    const snapshot = JSON.parse(JSON.stringify(session.value)) as SessionRecord
    await queueSave(() => storage.saveSession(snapshot))
    const index = sessions.value.findIndex((s) => s.id === snapshot.id)
    if (index >= 0) sessions.value[index] = snapshot
    else sessions.value.unshift(snapshot)
  }

  function resetDynamics() {
    resetFun()
    feature.value = null
    lastFrame = 0
    lastSmooth = 0
    badSince = goodSince = absentSince = null
    blinkTracker.reset()
    blinkFaceMissing = true
    blinkCount.value = blinkObservedSeconds.value = 0
    blinkStatus.value = '等待清晰双眼与连续采样'
    blinkRate.value = null
    quality.value = 0
    landmarks.value = []
  }

  function createSession(mode: 'real' | 'demo') {
    session.value = {
      id: crypto.randomUUID(), mode, startedAt: Date.now(), endedAt: null, view: mode === 'demo' ? 'front' : settings.value.view,
      goodSeconds: 0, badSeconds: 0, unknownSeconds: 0, absentSeconds: 0, pausedSeconds: 0,
      reminders: [], segments: [],
    }
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
    if (s === 'bad' || s === 'candidate_bad') r.badSeconds += dt
    if (s === 'unknown' || s === 'need_cal') r.unknownSeconds += dt
    if (s === 'absent') r.absentSeconds += dt
    if (s === 'paused') r.pausedSeconds += dt
  }

  function tick() {
    if (settings.value.blinkEnabled && blinkAvailable.value && phase.value === 'monitoring') showBlink(performance.now())
    const now = performance.now()
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
    }))
    camera = active
    try {
      const result = await active.open(settings.value.cameraId, settings.value.blinkEnabled, settings.value.fps)
      if (generation !== token) { active.close(); return }
      cameraId.value = result.cameraId
      stream.value = active.stream ? markRaw(active.stream) : null
      engine.value = result.delegate
      blinkAvailable.value = result.blink
      frameWidth.value = active.video?.videoWidth || 640
      frameHeight.value = active.video?.videoHeight || 480
      const aspect = frameWidth.value / frameHeight.value
      profileMismatch = !!profile.value && Math.abs(profile.value.aspect - aspect) > 0.08
      phase.value = profile.value && !profileMismatch ? 'monitoring' : 'ready'
      state.value = phase.value === 'monitoring' ? 'unknown' : 'need_cal'
      reason.value = profileMismatch ? '画面比例变了，请重新校准' : profile.value ? '等待识别你的坐姿' : '准备好后，花 8 秒建立参考坐姿'
      if (!session.value) createSession('real')
      else lastTick = performance.now()
      if (result.warning) announce('坐姿监测已准备好', result.warning)
      await refreshDevices()
      if (settings.value.soundEnabled) prepareAudio()
    } catch (failure) {
      active.close()
      stream.value = null
      if (generation !== token) return
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

  function updatePosture(f: Features, reference: Calibration, now: number) {
    const exitSensitivity = state.value === 'bad' ? settings.value.sensitivity / 0.7 : settings.value.sensitivity
    const verdict = classify(f, reference, { ...settings.value, sensitivity: exitSensitivity })
    deviation.value = verdict.deviation
    if (verdict.bad) {
      const latched = state.value === 'bad'
      goodSince = null
      badSince ??= now
      state.value = latched || now - badSince >= settings.value.holdSeconds * 1000 ? 'bad' : 'candidate_bad'
      reason.value = verdict.reason
    } else {
      badSince = null
      if (state.value === 'bad') {
        goodSince ??= now
        if (now - goodSince < settings.value.recoverySeconds * 1000) { reason.value = '正在回到参考坐姿'; return }
      }
      state.value = 'normal'
      reason.value = '保持舒适的参考坐姿'
      goodSince = null
      if (restOpen.value && restKind.value === 'posture') closeRest()
    }
  }

  function handleObservation(points: Landmark[], now: number, width: number, height: number) {
    const result = observe(points, width, height, settings.value.view, phase.value === 'calibrating' ? undefined : profile.value?.side)
    quality.value = result.quality
    if (!result.valid || !result.features) {
      feature.value = null
      lastSmooth = 0
      badSince = goodSince = null
      if (result.noPerson) {
        absentSince ??= now
        state.value = now - absentSince >= 5000 ? 'absent' : 'unknown'
      } else { absentSince = null; state.value = 'unknown' }
      reason.value = result.reason
      if (state.value === 'absent') continuousSeconds.value = 0
      if (restOpen.value && restKind.value === 'posture') closeRest()
      return
    }
    absentSince = null
    if (phase.value === 'calibrating') {
      calibrationBuffer.push(result.features)
      calibrationSamples.value = calibrationBuffer.length
      feature.value = result.features
      return
    }
    if (phase.value === 'ready' || !profile.value || profileMismatch) { state.value = 'need_cal'; return }
    const elapsed = lastSmooth ? (now - lastSmooth) / 1000 : 10
    feature.value = smoothFeatures(feature.value, result.features, elapsed)
    lastSmooth = now
    updatePosture(feature.value, profile.value, now)
  }

  function onFrame(frame: VisionFrame) {
    if (!running.value || demo.value) return
    lastFrame = performance.now()
    landmarks.value = frame.landmarks
    frameWidth.value = frame.width
    frameHeight.value = frame.height
    inferenceMs.value = frame.inferenceMs
    handleObservation(frame.landmarks, lastFrame, frame.width, frame.height)
    if (settings.value.funEnabled && (phase.value === 'ready' || phase.value === 'monitoring')) {
      const kind = funTracker.update(detectFun(frame.landmarks, frame.width, frame.height, settings.value.view, profileMismatch ? null : profile.value), lastFrame)
      if (kind) showFun(kind)
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
    if (result.seconds >= 30 && result.rate !== null && result.rate < 8) remind('eyes', '看看远处，放松一下眼睛')
  }

  function beginCalibration() {
    if (!running.value || demo.value || phase.value === 'calibrating') return
    resetFun()
    calibrationStart = performance.now()
    calibrationBuffer = []
    calibrationSamples.value = 0
    calibrationProgress.value = 0
    phase.value = 'calibrating'
    state.value = 'need_cal'
    reason.value = '保持舒适坐姿，头部和肩膀尽量不动'
    feature.value = null
    badSince = goodSince = null
  }

  function finishCalibration() {
    if (phase.value !== 'calibrating') return
    try {
      const result = makeCalibration(calibrationBuffer, settings.value.view, cameraId.value, frameWidth.value / frameHeight.value)
      profiles.value = [result, ...profiles.value.filter((p) => p.id !== result.id)]
      profileMismatch = false
      calibrationProgress.value = 100
      phase.value = 'monitoring'
      state.value = 'normal'
      reason.value = '参考坐姿已保存，继续专注吧'
      feature.value = null
      lastSmooth = 0
      void queueSave(() => storage.saveCalibration(result))
      announce('校准完成', result.view === 'side' && result.baseline.torso === null
        ? '已建立侧面头颈参考；髋部未持续清晰入镜，本次不判断躯干。'
        : '换机位或坐得更近时，可以随时重新校准。')
    } catch (failure) {
      phase.value = 'ready'
      state.value = 'need_cal'
      calibrationProgress.value = 0
      reason.value = failure instanceof Error ? failure.message : '校准未完成，请再试一次。'
      announce('再调整一下', reason.value, 'error')
    }
  }

  function pause(message = '监测已暂停，摄像头已关闭') {
    if (!running.value) return
    tick()
    phase.value = 'paused'
    state.value = 'paused'
    reason.value = message
    camera?.close()
    camera = null
    stream.value = null
    calibrationBuffer = []
    resetDynamics()
    restOpen.value = false
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
    restOpen.value = false
    if (timer !== null) clearInterval(timer)
    if (saveTimer !== null) clearInterval(saveTimer)
    timer = saveTimer = null
    if (session.value) {
      session.value.endedAt = Date.now()
      if (demo.value) {
        demoSessions.value = [JSON.parse(JSON.stringify(session.value)) as SessionRecord, ...demoSessions.value.filter((r) => r.id !== session.value?.id)]
      } else await persist()
    }
    session.value = null
    resetDynamics()
    reason.value = '本次监测已结束'
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
    if (settings.value.notificationsEnabled && !demo.value && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('PinEase · 青松坐姿', { body: message, tag: 'pinease-' + kind, icon: new URL(import.meta.env.BASE_URL + 'icon.svg', window.location.href).href }) } catch { /* 页面提醒继续可用 */ }
    }
    if (kind === 'break' || kind === 'posture' && settings.value.focusReminder) {
      restKind.value = kind
      restRemaining.value = settings.value.restSeconds
      restEnd = now + settings.value.restSeconds * 1000
      restOpen.value = true
    }
    void persist()
  }

  function closeRest() {
    if (restKind.value === 'break') {
      continuousSeconds.value = 0
      nextBreak = settings.value.sitMinutes * 60
    }
    restOpen.value = false
  }

  async function updateSettings(partial: Partial<Settings>) {
    const next = storage.sanitizeSettings({ ...settings.value, ...partial })
    const needsRestart = next.view !== settings.value.view || next.cameraId !== settings.value.cameraId || next.blinkEnabled !== settings.value.blinkEnabled || next.fps !== settings.value.fps
    if (needsRestart && (running.value || phase.value === 'paused' || busy.value)) await endSession()
    settings.value = next
    if (!next.funEnabled) resetFun()
    if (next.soundEnabled) prepareAudio()
    nextBreak = continuousSeconds.value + next.sitMinutes * 60
    await queueSave(() => storage.saveSettings({ ...next }))
    if (needsRestart) announce('设置已保存', '下次开始监测时使用新的设置。')
  }

  async function requestNotifications() {
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

  function exportCSV() {
    const rows = ['日期,正常秒数,偏离秒数,未知秒数,有效秒数,良好占比,提醒次数']
    for (const d of dailyStats(sessions.value, 30)) rows.push([d.date, Math.round(d.goodSeconds), Math.round(d.badSeconds), Math.round(d.unknownSeconds), Math.round(d.effectiveSeconds), d.ratio === null ? '' : Math.round(d.ratio * 100) + '%', d.reminders].join(','))
    downloadFile('PinEase-summary-' + localDay() + '.csv', '\uFEFF' + rows.join('\r\n'), 'text/csv;charset=utf-8')
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

  function dismissFun() {
    if (funTimer !== null) window.clearTimeout(funTimer)
    funTimer = null
    funMoment.value = null
  }

  function resetFun() {
    dismissFun()
    funTracker.reset()
  }

  function showFun(kind: FunKind, preview = false) {
    dismissFun()
    funMoment.value = { ...FUN_MESSAGES[kind], preview }
    funTimer = window.setTimeout(dismissFun, 5000)
  }

  function previewFun(kind: FunKind) {
    if (demo.value && phase.value === 'monitoring' && settings.value.funEnabled) showFun(kind, true)
  }

  return {
    settings, profiles, sessions, records, phase, state, reason, error, storageWarning, initialized, busy, running,
    demo, demoPose, stream, landmarks, frameWidth, frameHeight, quality, inferenceMs, engine, devices,
    calibrationProgress, calibrationSamples, feature, deviation, session, today, elapsed, profile,
    continuousSeconds, blinkRate, blinkAvailable, blinkCount, blinkObservedSeconds, blinkStatus, toast, restOpen, restRemaining, restKind, stateLabel, stateColor,
    init, startCamera, startDemo, beginCalibration, pause, resume, endSession, updateSettings, refreshDevices,
    requestNotifications, resetProfiles, exportBackup, exportCSV, importBackup, deleteHistory, dismissToast,
    closeRest, announce, previewSound, funMoment, dismissFun, previewFun,
  }
})

