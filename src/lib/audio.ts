export function cuePlan(volume: number, repeats: number) {
  const level = Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : 70)) / 100
  const count = Math.round(Math.max(1, Math.min(3, Number.isFinite(repeats) ? repeats : 2)))
  return { gain: level * level * 0.6, count, duration: 0.48, spacing: 0.64 }
}

export function playReminder(context: AudioContext, volume: number, repeats: number) {
  const plan = cuePlan(volume, repeats)
  if (plan.gain === 0) return
  for (let i = 0; i < plan.count; i++) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + 0.03 + i * plan.spacing
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(i % 2 ? 784 : 659, start)
    oscillator.connect(gain)
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.linearRampToValueAtTime(plan.gain, start + 0.035)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + plan.duration)
    oscillator.start(start)
    oscillator.stop(start + plan.duration + 0.02)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  }
}
