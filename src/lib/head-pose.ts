import type { HeadPose, Landmark } from '@/domain/types'

type MatrixLike = { rows: number; columns: number; data: number[] }

const degrees = (radians: number) => radians * 180 / Math.PI

/** Read raw XYZ angles from MediaPipe's 4x4 column-major face transform. */
export function readHeadPose(matrix: MatrixLike | undefined, facePoints: Landmark[] | undefined, poseNose: Landmark | undefined, observedAt: number): HeadPose | null {
  if (!matrix || matrix.rows !== 4 || matrix.columns !== 4 || matrix.data.length !== 16 || !Number.isFinite(observedAt)) return null
  if (!matrix.data.every(Number.isFinite) || !facePoints || facePoints.length < 300) return null
  const usable = (point: Landmark | undefined): point is Landmark => !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  const points = [facePoints[1], facePoints[33], facePoints[263], facePoints[61], facePoints[291]]
  if (!points.every(usable)) return null
  const xs = points.map(point => point!.x)
  const ys = points.map(point => point!.y)
  const faceCenterX = (Math.min(...xs) + Math.max(...xs)) / 2
  const faceCenterY = (Math.min(...ys) + Math.max(...ys)) / 2
  const faceWidth = Math.max(...xs) - Math.min(...xs)
  if (faceWidth < 0.035 || faceWidth > 0.8) return null
  if (!usable(poseNose) || Math.min(poseNose.visibility ?? 1, poseNose.presence ?? 1) < 0.55 || Math.hypot(poseNose.x - faceCenterX, poseNose.y - faceCenterY) > Math.max(0.12, faceWidth * 0.75)) return null

  const m = matrix.data
  // Normalize matrix columns: a similarity transform can include uniform scale.
  const xScale = Math.hypot(m[0]!, m[1]!, m[2]!)
  const yScale = Math.hypot(m[4]!, m[5]!, m[6]!)
  const zScale = Math.hypot(m[8]!, m[9]!, m[10]!)
  if (Math.min(xScale, yScale, zScale) < 0.5 || Math.max(xScale, yScale, zScale) > 2) return null
  const x = [m[0]! / xScale, m[1]! / xScale, m[2]! / xScale]
  const y = [m[4]! / yScale, m[5]! / yScale, m[6]! / yScale]
  const z = [m[8]! / zScale, m[9]! / zScale, m[10]! / zScale]
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const determinant = x[0]! * (y[1]! * z[2]! - y[2]! * z[1]!) - y[0]! * (x[1]! * z[2]! - x[2]! * z[1]!) + z[0]! * (x[1]! * y[2]! - x[2]! * y[1]!)
  if (Math.abs(dot(x, y)) > 0.08 || Math.abs(dot(x, z)) > 0.08 || Math.abs(dot(y, z)) > 0.08 || determinant < 0.9 || determinant > 1.1) return null
  const pitch = degrees(Math.atan2(m[6]! / yScale, m[10]! / zScale))
  const yaw = degrees(Math.asin(Math.max(-1, Math.min(1, -m[2]! / xScale))))
  const roll = degrees(Math.atan2(m[1]! / xScale, m[0]! / xScale))
  if (![pitch, yaw, roll].every(Number.isFinite) || [pitch, yaw, roll].some(value => Math.abs(value) > 85)) return null
  return { pitch, yaw, roll, faceCenterX, faceCenterY, faceWidth, observedAt }
}


export type FaceBaseline = Pick<HeadPose, 'pitch' | 'yaw' | 'roll'>
/** Require consistent observations across calibration, and never infer a reference from sparse frames. */
export function calibrateHeadPose(samples: HeadPose[]): FaceBaseline | null {
  if (samples.length < 20 || samples[samples.length - 1]!.observedAt - samples[0]!.observedAt < 6000) return null
  if (samples.some((s, i) => !Number.isFinite(s.observedAt) || i > 0 && (s.observedAt <= samples[i - 1]!.observedAt || s.observedAt - samples[i - 1]!.observedAt > 1500))) return null
  const median = (items: number[]) => { const values = [...items].sort((a, b) => a - b); const mid = Math.floor(values.length / 2); return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2 }
  const baseline = {} as FaceBaseline
  for (const key of ['pitch', 'yaw', 'roll'] as const) {
    const values = samples.map(s => s[key])
    if (values.some(v => !Number.isFinite(v))) return null
    const center = median(values)
    const deviations = values.map(v => Math.abs(v - center)).sort((a, b) => a - b)
    if (median(deviations) > 4 || deviations[Math.floor((deviations.length - 1) * 0.8)]! > 8) return null
    baseline[key] = center
  }
  return baseline
}
