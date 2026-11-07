import type { DailyStats, SessionRecord } from '@/domain/types'

export function localDay(time: number | Date = Date.now()): string {
  const d = new Date(time)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return h + ' 小时 ' + m + ' 分'
  if (m > 0) return m + ' 分 ' + (total % 60) + ' 秒'
  return total + ' 秒'
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

export function shortTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function dateLabel(date: string): string {
  const [, month, day] = date.split('-')
  return Number(month) + '月' + Number(day) + '日'
}

export function dayRange(days: number, end = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(end)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - (days - 1 - i))
    return localDay(d)
  })
}

export function dailyStats(records: SessionRecord[], days: number): DailyStats[] {
  return dayRange(days).map((date) => {
    let goodSeconds = 0
    let badSeconds = 0
    let candidateSeconds = 0
    let unknownSeconds = 0
    let reminders = 0
    let sessions = 0
    for (const record of records) {
      const dayStart = new Date(date + 'T00:00:00').getTime()
      const next = new Date(dayStart); next.setDate(next.getDate() + 1)
      const dayEnd = next.getTime()
      const segments = record.segments.filter(s => s.endedAt > dayStart && s.startedAt < dayEnd)
      if (segments.length) sessions++
      for (const s of segments) {
        const span = s.endedAt - s.startedAt
        const overlap = Math.max(0, Math.min(s.endedAt, dayEnd) - Math.max(s.startedAt, dayStart))
        const seconds = span > 0 ? s.seconds * overlap / span : 0
        if (s.state === 'normal') goodSeconds += seconds
        if (s.state === 'bad' || s.state === 'candidate_bad' && record.accountingVersion !== 2) badSeconds += seconds
        if (s.state === 'candidate_bad') candidateSeconds += seconds
        if (s.state === 'unknown' || s.state === 'need_cal') unknownSeconds += seconds
      }
      reminders += record.reminders.filter((e) => localDay(e.at) === date).length
    }
    const effectiveSeconds = goodSeconds + badSeconds
    return { date, goodSeconds, badSeconds, candidateSeconds, unknownSeconds, effectiveSeconds, reminders, sessions, ratio: effectiveSeconds > 0 ? goodSeconds / effectiveSeconds : null }
  })
}

export function csvSummary(records: SessionRecord[], days: number): string {
  const rows = ['日期,参考坐姿秒数,确认偏离秒数,候选变化秒数,未知秒数,有效监测秒数,参考坐姿占比,提醒次数']
  for (const d of dailyStats(records, days)) {
    rows.push([d.date, Math.round(d.goodSeconds), Math.round(d.badSeconds), Math.round(d.candidateSeconds), Math.round(d.unknownSeconds), Math.round(d.effectiveSeconds), d.ratio === null ? '' : Math.round(d.ratio * 100) + '%', d.reminders].join(','))
  }
  return '\uFEFF' + rows.join('\r\n')
}

export function downloadFile(name: string, contents: string, type = 'application/json'): void {
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([contents], { type }))
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

