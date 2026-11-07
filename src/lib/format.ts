import type { DailyStats, SessionRecord } from '@/domain/types'

export interface OrgDailyMetric {
  date: string
  effectiveSeconds: number
  goodRatio: number | null
  reminders: number
  score: number | null
}

export interface OrgReportPayload {
  schema: 'pinease-org-v1'
  anonymousId: string
  seatLabel: string
  generatedAt: string
  days: number
  effectiveSeconds: number
  goodSeconds: number
  badSeconds: number
  reminders: number
  averageScore: number | null
  daily: OrgDailyMetric[]
}

export interface OrgAggregateSummary {
  terminalCount: number
  totalEffectiveSeconds: number
  averageGoodRatio: number | null
  averageScore: number | null
  totalReminders: number
  seats: Array<{ seatLabel: string; effectiveSeconds: number; goodRatio: number | null; score: number | null; reminders: number }>
}

export function computeHealthScore(goodSeconds: number, badSeconds: number, reminders: number): { score: number | null; grade: string | null } {
  const effective = Math.max(0, goodSeconds) + Math.max(0, badSeconds)
  if (effective <= 0) return { score: null, grade: null }
  const ratio = Math.max(0, Math.min(1, goodSeconds / effective))
  const hours = Math.max(0.25, effective / 3600)
  const remindersPerHour = Math.max(0, reminders) / hours
  const ratioPart = ratio * 85
  const stabilityPart = Math.max(0, 15 - remindersPerHour * 2.5)
  const score = Math.min(100, Math.max(0, Math.round(ratioPart + stabilityPart)))
  const grade = score >= 88 ? '舒展' : score >= 75 ? '平稳' : score >= 60 ? '需留意' : '易疲劳'
  return { score, grade }
}

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
    const { score, grade } = computeHealthScore(goodSeconds, badSeconds, reminders)
    return { date, goodSeconds, badSeconds, candidateSeconds, unknownSeconds, effectiveSeconds, reminders, sessions, ratio: effectiveSeconds > 0 ? goodSeconds / effectiveSeconds : null, score, grade }
  })
}

export function csvSummary(records: SessionRecord[], days: number): string {
  const rows = ['日期,参考坐姿秒数,确认偏离秒数,候选变化秒数,未知秒数,有效监测秒数,参考坐姿占比,提醒次数,健康评分']
  for (const d of dailyStats(records, days)) {
    rows.push([d.date, Math.round(d.goodSeconds), Math.round(d.badSeconds), Math.round(d.candidateSeconds), Math.round(d.unknownSeconds), Math.round(d.effectiveSeconds), d.ratio === null ? '' : Math.round(d.ratio * 100) + '%', d.reminders, d.score ?? ''].join(','))
  }
  return '\uFEFF' + rows.join('\r\n')
}

export function buildOrgSummary(records: SessionRecord[], days: 7 | 30 = 7, seatLabel = '自习座位-01'): OrgReportPayload {
  const stats = dailyStats(records, days)
  const effectiveSeconds = Math.round(stats.reduce((sum, s) => sum + s.effectiveSeconds, 0))
  const goodSeconds = Math.round(stats.reduce((sum, s) => sum + s.goodSeconds, 0))
  const badSeconds = Math.round(stats.reduce((sum, s) => sum + s.badSeconds, 0))
  const reminders = stats.reduce((sum, s) => sum + s.reminders, 0)
  const { score: averageScore } = computeHealthScore(goodSeconds, badSeconds, reminders)
  const seed = (records[0]?.id ?? 'node').slice(0, 8)
  return {
    schema: 'pinease-org-v1',
    anonymousId: 'anon-' + seed,
    seatLabel: seatLabel.trim().slice(0, 32) || '自习座位-01',
    generatedAt: new Date().toISOString(),
    days,
    effectiveSeconds,
    goodSeconds,
    badSeconds,
    reminders,
    averageScore,
    daily: stats.map((d) => ({
      date: d.date,
      effectiveSeconds: Math.round(d.effectiveSeconds),
      goodRatio: d.ratio === null ? null : Math.round(d.ratio * 100),
      reminders: d.reminders,
      score: d.score ?? null,
    })),
  }
}

export function aggregateOrgReports(reports: OrgReportPayload[]): OrgAggregateSummary {
  const valid = reports.filter((r) => r && r.schema === 'pinease-org-v1' && typeof r.effectiveSeconds === 'number')
  if (!valid.length) {
    return { terminalCount: 0, totalEffectiveSeconds: 0, averageGoodRatio: null, averageScore: null, totalReminders: 0, seats: [] }
  }
  const totalEffectiveSeconds = valid.reduce((sum, r) => sum + Math.max(0, r.effectiveSeconds), 0)
  const totalGood = valid.reduce((sum, r) => sum + Math.max(0, r.goodSeconds), 0)
  const totalBad = valid.reduce((sum, r) => sum + Math.max(0, r.badSeconds), 0)
  const totalReminders = valid.reduce((sum, r) => sum + Math.max(0, r.reminders), 0)
  const averageGoodRatio = totalEffectiveSeconds > 0 ? Math.round((totalGood / totalEffectiveSeconds) * 100) : null
  const { score: averageScore } = computeHealthScore(totalGood, totalBad, totalReminders)
  const seats = valid.map((r) => ({
    seatLabel: r.seatLabel || r.anonymousId,
    effectiveSeconds: Math.round(r.effectiveSeconds),
    goodRatio: r.effectiveSeconds > 0 ? Math.round((r.goodSeconds / r.effectiveSeconds) * 100) : null,
    score: r.averageScore,
    reminders: r.reminders,
  }))
  return { terminalCount: valid.length, totalEffectiveSeconds, averageGoodRatio, averageScore, totalReminders, seats }
}

export function demoOrgReports(): OrgReportPayload[] {
  const presets = [
    { seat: '信院机房 A-01', good: 14200, bad: 1800, rem: 4 },
    { seat: '信院机房 A-02', good: 11800, bad: 2900, rem: 7 },
    { seat: '信院机房 A-03', good: 16500, bad: 1200, rem: 2 },
    { seat: '图书馆自习 B-08', good: 19400, bad: 2600, rem: 5 },
    { seat: '图书馆自习 B-12', good: 9600, bad: 3100, rem: 9 },
    { seat: '实验室工位 C-04', good: 21200, bad: 1950, rem: 3 },
  ]
  return presets.map((p, idx) => {
    const { score } = computeHealthScore(p.good, p.bad, p.rem)
    return {
      schema: 'pinease-org-v1',
      anonymousId: `anon-demo-${idx + 1}`,
      seatLabel: p.seat,
      generatedAt: new Date().toISOString(),
      days: 7,
      effectiveSeconds: p.good + p.bad,
      goodSeconds: p.good,
      badSeconds: p.bad,
      reminders: p.rem,
      averageScore: score,
      daily: [],
    }
  })
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
