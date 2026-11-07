import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { readHeadPose } from '@/lib/head-pose'
import { visionPlan } from '@/lib/vision-options'
import { readBlinkScore } from '@/domain/blink'
import type { HeadPose, Landmark, PoseModelPreference, VisionReply } from '@/domain/types'

interface WorkerContext {
  ModuleFactory?: unknown
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (data: VisionReply) => void
}
const scope = self as unknown as WorkerContext
let pose: PoseLandmarker | null = null
let face: FaceLandmarker | null = null
let delegate: 'GPU' | 'CPU' = 'CPU'
let model: 'full' | 'lite' = 'lite'
let processing = false
let lastTimestamp = -1
let faceFrameWarning = false
let blinkEnabled = false
let headPoseEnabled = false

async function initialize(data: { assets: string; blink: boolean; headPose?: boolean; preference?: PoseModelPreference }) {
  pose?.close()
  face?.close()
  pose = null
  face = null
  lastTimestamp = -1
  faceFrameWarning = false
  blinkEnabled = data.blink === true
  headPoseEnabled = data.headPose === true
  const plan = visionPlan(data.preference ?? 'auto', blinkEnabled, headPoseEnabled)
  // This is an ES module Worker: the classic loader does not publish ModuleFactory here.
  const files = await FilesetResolver.forVisionTasks(data.assets + 'wasm', true)
  // ES modules run once, but MediaPipe consumes and clears this factory per task.
  // Restore it before each task (and CPU retry) so cached imports work too.
  const { default: wasmFactory } = await import(/* @vite-ignore */ files.wasmLoaderPath)
  const options = {
    runningMode: 'VIDEO' as const, numPoses: 1,
    minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
  }
  const attempts = plan.attempts
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      scope.ModuleFactory = wasmFactory
      pose = await PoseLandmarker.createFromOptions(files, {
        ...options, baseOptions: { modelAssetPath: data.assets + 'models/' + attempt.file, delegate: attempt.delegate },
      })
      model = attempt.model
      delegate = attempt.delegate
      break
    } catch (error) { lastError = error }
  }
  if (!pose) throw lastError instanceof Error ? lastError : new Error('姿态模型无法加载')
  const warnings: string[] = []
  if (model === 'lite' && data.preference !== 'lite') warnings.push('Full 模型不可用，已改用 Lite。')
  if (plan.useFace) {
    for (const faceDelegate of delegate === 'GPU' ? ['GPU', 'CPU'] as const : ['CPU'] as const) {
      try {
        scope.ModuleFactory = wasmFactory
        face = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: data.assets + 'models/face_landmarker.task', delegate: faceDelegate },
          runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: blinkEnabled,
          outputFacialTransformationMatrixes: headPoseEnabled,
          minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
        })
        if (faceDelegate !== delegate) warnings.push('人脸检测使用 CPU。')
        break
      } catch (error) { console.warn('MediaPipe face initialization failed', error) }
    }
    if (!face) warnings.push('人脸模型暂时无法加载，坐姿监测仍可继续。')
  }
  scope.postMessage({ type: 'ready', delegate, model, blink: !!face && blinkEnabled, headPoseAvailable: !!face && headPoseEnabled, warning: warnings.join(' ') || undefined })
}

scope.onmessage = async (event: MessageEvent) => {
  const data = event.data
  if (data.type === 'init') {
    try { await initialize(data) } catch (error) {
      console.error('MediaPipe initialization failed', error)
      scope.postMessage({ type: 'error', message: '识别模型加载失败：' + (error instanceof Error ? error.message : String(error)) })
    }
    return
  }
  if (data.type !== 'frame') return
  const bitmap: ImageBitmap = data.bitmap
  if (!pose || processing) { bitmap.close(); return }
  processing = true
  try {
    const timestamp = Math.max(data.timestamp, lastTimestamp + 1)
    lastTimestamp = timestamp
    const begin = performance.now()
    const result = pose.detectForVideo(bitmap, timestamp)
    const landmarks: Landmark[] = result.landmarks[0] ?? []
    let blink: number | null = null
    let headPose: HeadPose | null = null
    let faceInferenceMs: number | null = null
    const poseInferenceMs = performance.now() - begin
    if (face) {
      try {
        const faceStart = performance.now()
        const faceResult = face.detectForVideo(bitmap, timestamp)
        faceInferenceMs = performance.now() - faceStart
        if (blinkEnabled) blink = readBlinkScore(faceResult.faceLandmarks[0], faceResult.faceBlendshapes[0]?.categories ?? [])
        if (headPoseEnabled) headPose = readHeadPose(faceResult.facialTransformationMatrixes[0], faceResult.faceLandmarks[0], landmarks[0], data.timestamp)
      } catch (error) {
        // Optional eye inference must not stop posture monitoring.
        if (!faceFrameWarning) console.warn('Face inference unavailable; posture continues', error)
        faceFrameWarning = true
      }
    }
    scope.postMessage({ type: 'frame', timestamp: data.timestamp, landmarks, width: bitmap.width, height: bitmap.height, blink, headPose, faceTimestamp: headPose ? data.timestamp : null, poseInferenceMs, faceInferenceMs, inferenceMs: performance.now() - begin })
  } catch {
    scope.postMessage({ type: 'error', message: '识别过程遇到问题。结束本次监测后重新开始。' })
  } finally { processing = false; bitmap.close() }
}

