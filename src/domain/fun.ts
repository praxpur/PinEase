import type { Calibration, Landmark, ViewMode } from './types'

export type FunKind = 'alien' | 'owl' | 'closer' | 'stretch'
export const FUN_MESSAGES: Record<FunKind, { emoji: string; title: string; message: string }> = {
  alien: { emoji: '👽', title: '你是外星人吗？', message: '地球坐姿指南：这一页请正着看。' },
  owl: { emoji: '🦉', title: '正在加载猫头鹰模式……', message: '好奇心满格，脖子也记得放松一下。' },
  closer: { emoji: '🔍', title: '再近一点，就要钻进屏幕啦。', message: '给自己和屏幕留一点空间。' },
  stretch: { emoji: '🙌', title: '收到！休息申请已批准。', message: '伸个懒腰，让肩膀也放个小假。' },
}

function usable(p: Landmark | undefined): p is Landmark {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1
    && Math.min(p.visibility ?? 1, p.presence ?? 1) >= 0.7
}

// Use anatomical orientation rather than a missing pose or the height of the nose alone.
export function detectFun(points: Landmark[], width: number, height: number, view: ViewMode, profile: Calibration | null): FunKind | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const le = points[2], re = points[5], lm = points[9], rm = points[10], nose = points[0]
  const ls = points[11], rs = points[12], lw = points[15], rw = points[16]
  const elbowL = points[13], elbowR = points[14]
  if ([le, re, lm, rm, nose].every(usable) && usable(le) && usable(re) && usable(lm) && usable(rm) && usable(nose)) {
    const ex = (le.x + re.x) / 2, ey = (le.y + re.y) / 2
    const mx = (lm.x + rm.x) / 2, my = (lm.y + rm.y) / 2
    const dx = (ex - mx) * width, dy = (my - ey) * height
    const eyeSpan = Math.hypot((le.x - re.x) * width, (le.y - re.y) * height)
    const faceHeight = Math.hypot(dx, dy)
    if (eyeSpan >= width * 0.025 && faceHeight >= height * 0.025 && faceHeight < eyeSpan * 2.5) {
      const roll = Math.atan2(dx, dy) * 180 / Math.PI
      // The nose should lie between the eyes and mouth along the face's vertical axis.
      const nosePosition = ((nose.x - mx) * width * dx + (my - nose.y) * height * dy) / (faceHeight * faceHeight)
      if (nosePosition > 0.05 && nosePosition < 0.95) {
        if (Math.abs(roll) >= 145) return 'alien'
        if (view === 'front' && usable(ls) && usable(rs)) {
          const left = ls.x < rs.x ? ls : rs, right = ls.x < rs.x ? rs : ls
          const shoulderRoll = Math.atan2((right.y - left.y) * height, (right.x - left.x) * width) * 180 / Math.PI
          const tilt = Math.abs(roll - shoulderRoll)
          if (Math.abs(roll) >= 25 && Math.abs(roll) <= 65 && tilt >= 25 && tilt <= 65) return 'owl'
        }
      }
    }
  }
  if (usable(nose) && usable(ls) && usable(rs) && usable(lw) && usable(rw) && usable(elbowL) && usable(elbowR)) {
    const headAboveShoulders = nose.y < Math.min(ls.y, rs.y)
    if (headAboveShoulders && lw.y < nose.y - 0.04 && rw.y < nose.y - 0.04
      && elbowL.y < ls.y - 0.03 && elbowR.y < rs.y - 0.03) return 'stretch'
  }
  if (view === 'front' && profile?.view === 'front' && Math.abs(profile.aspect - width / height) <= 0.08
    && profile.baseline.scale > 0.08 && usable(nose) && usable(ls) && usable(rs)) {
    const span = Math.hypot((ls.x - rs.x) * width, (ls.y - rs.y) * height) / width
    if (span / profile.baseline.scale > 1.35 && nose.y < Math.min(ls.y, rs.y)) return 'closer'
  }
  return null
}

export class FunTracker {
  private candidate: FunKind | null = null
  private since = 0
  private lastFrame: number | null = null
  private fired = false
  private lastShown = -Infinity
  private lastByKind: Partial<Record<FunKind, number>> = {}

  reset() {
    this.candidate = null
    this.lastFrame = null
    this.fired = false
    this.lastShown = -Infinity
    this.lastByKind = {}
  }

  update(kind: FunKind | null, now: number): FunKind | null {
    if (!Number.isFinite(now)) return null
    if (this.lastFrame !== null && (now - this.lastFrame > 750 || now < this.lastFrame)) {
      this.candidate = null
      this.fired = false
    }
    this.lastFrame = now
    if (kind !== this.candidate) {
      this.candidate = kind
      this.since = now
      this.fired = false
    }
    if (!kind || this.fired || now - this.since < 2000 || now - this.lastShown < 10000
      || now - (this.lastByKind[kind] ?? -Infinity) < 45000) return null
    this.fired = true
    this.lastShown = now
    this.lastByKind[kind] = now
    return kind
  }
}
