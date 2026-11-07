import type { Features, HeadPose, Landmark } from '@/domain/types'

export type LightingStatus = 'normal' | 'dark' | 'backlit'

export interface LightingReport {
  luma: number
  centerLuma: number
  edgeLuma: number
  contrast: number
  status: LightingStatus
  gamma: number
  boostApplied: boolean
}

export interface PerformanceReport {
  samples: number
  p50Ms: number
  p95Ms: number
  avgMs: number
  estimatedFps: number
  degraded: boolean
}

export type NeckExerciseStep = 'left' | 'right' | 'up' | 'done'

export function analyzeLighting(pixels: Uint8ClampedArray | number[], width: number, height: number): LightingReport {
  if (!width || !height || pixels.length < width * height * 4) {
    return { luma: 128, centerLuma: 128, edgeLuma: 128, contrast: 32, status: 'normal', gamma: 1, boostApplied: false }
  }
  let sum = 0
  let sumSq = 0
  let centerSum = 0
  let centerCount = 0
  let edgeSum = 0
  let edgeCount = 0
  const totalPixels = width * height
  const xMin = width * 0.25
  const xMax = width * 0.75
  const yMin = height * 0.2
  const yMax = height * 0.85

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = pixels[idx] ?? 0
      const g = pixels[idx + 1] ?? 0
      const b = pixels[idx + 2] ?? 0
      const yVal = 0.299 * r + 0.587 * g + 0.114 * b
      sum += yVal
      sumSq += yVal * yVal
      if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) {
        centerSum += yVal
        centerCount++
      } else {
        edgeSum += yVal
        edgeCount++
      }
    }
  }

  const luma = sum / totalPixels
  const variance = Math.max(0, sumSq / totalPixels - luma * luma)
  const contrast = Math.sqrt(variance)
  const centerLuma = centerCount > 0 ? centerSum / centerCount : luma
  const edgeLuma = edgeCount > 0 ? edgeSum / edgeCount : luma

  if (edgeLuma >= 165 && centerLuma <= 95 && edgeLuma - centerLuma >= 45) {
    const gamma = Math.max(0.58, Math.min(0.82, centerLuma / 135))
    return { luma: Math.round(luma), centerLuma: Math.round(centerLuma), edgeLuma: Math.round(edgeLuma), contrast: Math.round(contrast), status: 'backlit', gamma: Number(gamma.toFixed(2)), boostApplied: true }
  }

  if (luma < 72 || centerLuma < 65) {
    const ref = Math.min(luma, centerLuma)
    const gamma = Math.max(0.52, Math.min(0.82, ref / 110))
    return { luma: Math.round(luma), centerLuma: Math.round(centerLuma), edgeLuma: Math.round(edgeLuma), contrast: Math.round(contrast), status: 'dark', gamma: Number(gamma.toFixed(2)), boostApplied: true }
  }

  return { luma: Math.round(luma), centerLuma: Math.round(centerLuma), edgeLuma: Math.round(edgeLuma), contrast: Math.round(contrast), status: 'normal', gamma: 1, boostApplied: false }
}

export function applyGammaLut(pixels: Uint8ClampedArray, gamma: number): void {
  if (!Number.isFinite(gamma) || gamma <= 0 || Math.abs(gamma - 1) < 0.03) return
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(i / 255, gamma))))
  }
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = lut[pixels[i]!]!
    pixels[i + 1] = lut[pixels[i + 1]!]!
    pixels[i + 2] = lut[pixels[i + 2]!]!
  }
}

export function summarizePerformance(latenciesMs: number[], frameTimestamps: number[]): PerformanceReport {
  const valid = latenciesMs.filter((n) => Number.isFinite(n) && n >= 0)
  if (!valid.length) {
    return { samples: 0, p50Ms: 0, p95Ms: 0, avgMs: 0, estimatedFps: 0, degraded: false }
  }
  const sorted = [...valid].sort((a, b) => a - b)
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] ?? 0
  const p50Ms = Number(pick(0.5).toFixed(1))
  const p95Ms = Number(pick(0.95).toFixed(1))
  const avgMs = Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1))

  let estimatedFps = 0
  if (frameTimestamps.length >= 2) {
    const spanSec = (frameTimestamps[frameTimestamps.length - 1]! - frameTimestamps[0]!) / 1000
    if (spanSec > 0.1) estimatedFps = Number(((frameTimestamps.length - 1) / spanSec).toFixed(1))
  }
  const degraded = valid.length >= 12 && p95Ms > 110
  return { samples: valid.length, p50Ms, p95Ms, avgMs, estimatedFps, degraded }
}

export function checkNeckExerciseMatch(
  step: NeckExerciseStep,
  headPoseDelta: { pitch: number; yaw: number; roll: number } | null,
  feature: Features | null,
  baseline: Features | null,
  landmarks?: Landmark[],
): boolean {
  if (step === 'done') return true
  if (headPoseDelta) {
    if (step === 'left' && (headPoseDelta.yaw <= -8 || headPoseDelta.roll <= -6)) return true
    if (step === 'right' && (headPoseDelta.yaw >= 8 || headPoseDelta.roll >= 6)) return true
    if (step === 'up' && Math.abs(headPoseDelta.pitch) >= 5) return true
  }
  if (feature && baseline) {
    const shiftDiff = feature.shift - baseline.shift
    const dropDiff = feature.drop - baseline.drop
    if (step === 'left' && shiftDiff <= -0.06) return true
    if (step === 'right' && shiftDiff >= 0.06) return true
    if (step === 'up' && dropDiff <= -0.03) return true
  }
  if (landmarks && landmarks.length >= 13) {
    const nose = landmarks[0]
    const ls = landmarks[11]
    const rs = landmarks[12]
    if (nose && ls && rs) {
      const midX = (ls.x + rs.x) / 2
      const span = Math.max(0.08, Math.hypot(ls.x - rs.x, ls.y - rs.y))
      const relX = (nose.x - midX) / span
      if (step === 'left' && relX <= -0.08) return true
      if (step === 'right' && relX >= 0.08) return true
    }
  }
  return false
}
