import type { Landmark } from './types'

export const ALIEN_MESSAGE = { emoji: '👽', title: '你是外星人吗？' }

function usable(p: Landmark | undefined): p is Landmark {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1
    && Math.min(p.visibility ?? 1, p.presence ?? 1) >= 0.7
}

// Use anatomical orientation rather than a missing pose or the height of the nose alone.
export function detectInversion(points: Landmark[], width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  const le = points[2], re = points[5], lm = points[9], rm = points[10], nose = points[0]
  if (usable(le) && usable(re) && usable(lm) && usable(rm) && usable(nose)) {
    const ex = (le.x + re.x) / 2, ey = (le.y + re.y) / 2
    const mx = (lm.x + rm.x) / 2, my = (lm.y + rm.y) / 2
    const dx = (ex - mx) * width, dy = (my - ey) * height
    const eyeSpan = Math.hypot((le.x - re.x) * width, (le.y - re.y) * height)
    const faceHeight = Math.hypot(dx, dy)
    if (eyeSpan >= width * 0.025 && faceHeight >= height * 0.025 && faceHeight < eyeSpan * 2.5) {
      const roll = Math.atan2(dx, dy) * 180 / Math.PI
      // The nose should lie between the eyes and mouth along the face's vertical axis.
      const nosePosition = ((nose.x - mx) * width * dx + (my - nose.y) * height * dy) / (faceHeight * faceHeight)
      return nosePosition > 0.05 && nosePosition < 0.95 && Math.abs(roll) >= 145
    }
  }
  return false
}

export class InversionTracker {
  private candidate = false
  private since = 0
  private lastFrame: number | null = null
  private fired = false
  private lastShown = -Infinity

  reset() {
    this.candidate = false
    this.lastFrame = null
    this.fired = false
    this.lastShown = -Infinity
  }

  update(inverted: boolean, now: number): boolean {
    if (!Number.isFinite(now)) return false
    if (this.lastFrame !== null && (now - this.lastFrame > 750 || now < this.lastFrame)) {
      this.candidate = false
      this.fired = false
    }
    this.lastFrame = now
    if (inverted !== this.candidate) {
      this.candidate = inverted
      this.since = now
      this.fired = false
    }
    if (!inverted || this.fired || now - this.since < 2000 || now - this.lastShown < 45000) return false
    this.fired = true
    this.lastShown = now
    return true
  }
}
