/** Counts complete close/reopen cycles only across continuous reliable samples. */
export class BlinkTracker {
  private previous: number | null = null
  private closedAt: number | null = null
  private times: number[] = []
  private intervals: { start: number; end: number }[] = []
  private detected = 0
  private cadenceOkay = false
  reset() { this.previous = this.closedAt = null; this.times = []; this.intervals = []; this.detected = 0; this.cadenceOkay = false }
  update(score: number | null, now: number) {
    if (score === null || !Number.isFinite(score) || score < 0 || score > 1) {
      this.previous = this.closedAt = null
      this.cadenceOkay = false
      return this.snapshot(now)
    }
    const gap = this.previous === null ? 0 : now - this.previous
    this.cadenceOkay = gap > 0 && gap <= 150
    if (!this.cadenceOkay) this.closedAt = null
    else this.intervals.push({ start: this.previous!, end: now })
    if (score > 0.55) this.closedAt ??= now
    if (score < 0.25 && this.closedAt !== null) {
      const duration = now - this.closedAt
      if (duration >= 40 && duration <= 1200) { this.times.push(now); this.detected++ }
      this.closedAt = null
    }
    this.previous = now
    return this.snapshot(now)
  }
  snapshot(now: number) {
    const cutoff = now - 60000
    this.times = this.times.filter(t => t > cutoff)
    this.intervals = this.intervals.filter(t => t.end > cutoff)
    const seconds = this.intervals.reduce((sum, t) => sum + t.end - Math.max(t.start, cutoff), 0) / 1000
    const fresh = this.cadenceOkay && this.previous !== null && now - this.previous <= 250
    const fps = seconds > 0 ? this.intervals.length / seconds : 0
    return { count: this.detected, seconds, fresh, fps, rate: fresh && fps >= 8 && seconds >= 20 ? Math.round(this.times.length * 60 / seconds) : null }
  }
}


/** Require two visible, sufficiently separated eyes; an absent/sideways face is unknown. */
export function readBlinkScore(points: { x: number; y: number }[] | undefined, categories: { categoryName: string; score: number }[]) {
  const eyes = points ? [points[33], points[263]] : []
  if (eyes.length !== 2 || !eyes.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)) return null
  if (Math.abs(eyes[0]!.x - eyes[1]!.x) < 0.04) return null
  const left = categories.find(c => c.categoryName === 'eyeBlinkLeft')?.score
  const right = categories.find(c => c.categoryName === 'eyeBlinkRight')?.score
  if (left === undefined || right === undefined || !Number.isFinite(left) || !Number.isFinite(right) || left < 0 || left > 1 || right < 0 || right > 1) return null
  return (left + right) / 2
}
