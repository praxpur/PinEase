import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark, VisionReply } from '@/domain/types'

interface WorkerContext {
  ModuleFactory?: unknown
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (data: VisionReply) => void
}
const scope = self as unknown as WorkerContext
let pose: PoseLandmarker | null = null
let face: FaceLandmarker | null = null
let delegate: 'GPU' | 'CPU' = 'CPU'
let processing = false
let lastTimestamp = -1

async function initialize(data: { assets: string; blink: boolean }) {
  pose?.close()
  face?.close()
  pose = null
  face = null
  lastTimestamp = -1
  // This is an ES module Worker: the classic loader does not publish ModuleFactory here.
  const files = await FilesetResolver.forVisionTasks(data.assets + 'wasm', true)
  // ES modules run once, but MediaPipe consumes and clears this factory per task.
  // Restore it before each task (and CPU retry) so cached imports work too.
  const { default: wasmFactory } = await import(/* @vite-ignore */ files.wasmLoaderPath)
  const options = {
    runningMode: 'VIDEO' as const, numPoses: 1,
    minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
  }
  try {
    scope.ModuleFactory = wasmFactory
    pose = await PoseLandmarker.createFromOptions(files, {
      ...options, baseOptions: { modelAssetPath: data.assets + 'models/pose_landmarker_lite.task', delegate: 'GPU' },
    })
    delegate = 'GPU'
  } catch {
    scope.ModuleFactory = wasmFactory
    pose = await PoseLandmarker.createFromOptions(files, {
      ...options, baseOptions: { modelAssetPath: data.assets + 'models/pose_landmarker_lite.task', delegate: 'CPU' },
    })
    delegate = 'CPU'
  }
  let warning: string | undefined
  if (data.blink) {
    try {
      scope.ModuleFactory = wasmFactory
      face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.assets + 'models/face_landmarker.task', delegate },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      })
    } catch (error) {
      console.warn('MediaPipe face initialization failed', error)
      warning = '眨眼模型暂时无法加载，坐姿监测仍可继续。'
    }
  }
  scope.postMessage({ type: 'ready', delegate, blink: !!face, warning })
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
    if (face) {
      const result = face.detectForVideo(bitmap, timestamp)
      const categories = result.faceBlendshapes[0]?.categories ?? []
      const left = categories.find((c) => c.categoryName === 'eyeBlinkLeft')?.score
      const right = categories.find((c) => c.categoryName === 'eyeBlinkRight')?.score
      if (left !== undefined && right !== undefined) blink = (left + right) / 2
    }
    scope.postMessage({ type: 'frame', timestamp: data.timestamp, landmarks, width: bitmap.width, height: bitmap.height, blink, inferenceMs: performance.now() - begin })
  } catch {
    scope.postMessage({ type: 'error', message: '识别过程遇到问题。结束本次监测后重新开始。' })
  } finally { processing = false; bitmap.close() }
}

