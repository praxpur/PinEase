<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDownToLine, ArrowUpRight, ChevronRight, Clock3, Leaf } from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'
import { dailyStats, dateLabel, duration, localDay, shortTime } from '@/lib/format'
import { demoRecords } from '@/lib/demo'
import type { SessionRecord } from '@/domain/types'
import AppDialog from '@/components/ui/AppDialog.vue'
import TrendChart from '@/components/TrendChart.vue'
const store = useMonitorStore()
const days = ref(7)
const example = ref(false)
const details = ref<SessionRecord | null>(null)
const source = computed(() => example.value ? demoRecords() : store.records)
const stats = computed(() => dailyStats(source.value, days.value))
const summary = computed(() => {
  const effective = stats.value.reduce((sum, s) => sum + s.effectiveSeconds, 0)
  const good = stats.value.reduce((sum, s) => sum + s.goodSeconds, 0)
  return { effective, ratio: effective ? Math.round(good / effective * 100) : null, reminders: stats.value.reduce((sum, s) => sum + s.reminders, 0), activeDays: stats.value.filter((s) => s.effectiveSeconds > 0).length }
})
const visibleRecords = computed(() => {
  const first = stats.value[0]?.date ?? localDay()
  const last = stats.value[stats.value.length - 1]?.date ?? localDay()
  return source.value.filter(s => s.segments.some(segment => localDay(segment.endedAt) >= first && localDay(segment.startedAt) <= last)).slice(0, 30)
})
const simulated = computed(() => example.value || store.demo)
</script>

<template>
  <div class="page-enter">
    <header class="page-heading">
      <div><div class="eyebrow">YOUR OWN RHYTHM</div><h1>看见自己的节奏。</h1><p>一点点觉察，留在每一天的记录里。</p></div>
      <button class="button button-outline" :disabled="simulated || !store.sessions.length" @click="store.exportCSV"><ArrowDownToLine :size="16" />导出汇总</button>
    </header>
    <div class="history-toolbar">
      <div class="segmented"><button v-for="range in [7, 30]" :key="range" :class="{ selected: days === range }" :aria-pressed="days === range" @click="days = range">最近 {{ range }} 天</button></div>
      <button class="text-button" @click="example = !example">{{ example ? '返回我的记录' : '看看示例记录' }}<ArrowUpRight :size="15" /></button>
    </div>
    <div v-if="simulated" class="notice demo-notice">正在查看模拟数据，示例不会写入你的真实记录。</div>
    <section class="history-overview">
      <div><span class="metric-label">有效监测</span><strong>{{ duration(summary.effective) }}</strong></div>
      <div><span class="metric-label">参考坐姿占比</span><strong>{{ summary.ratio === null ? '—' : summary.ratio + '%' }}</strong></div>
      <div><span class="metric-label">提醒次数</span><strong>{{ summary.reminders }}<small> 次</small></strong></div>
      <div><span class="metric-label">有记录的日子</span><strong>{{ summary.activeDays }}<small> 天</small></strong></div>
    </section>
    <section class="chart-grid">
      <div class="chart-panel"><div class="chart-heading"><h2>每天的专注</h2><span>分钟</span></div><div class="chart-legend"><i class="legend-dot green" />参考坐姿<i class="legend-dot amber" />偏离参考</div><TrendChart :stats="stats" /></div>
      <div class="chart-panel"><div class="chart-heading"><h2>舒适参考的占比</h2><span>有效监测期间</span></div><div class="chart-description">没有有效记录的日期保留为空</div><TrendChart :stats="stats" variant="ratio" /></div>
    </section>
    <section class="records-section">
      <div class="section-title-row"><h2>每一段专注</h2><span class="muted-text">{{ visibleRecords.length }} 段记录</span></div>
      <div v-if="!visibleRecords.length" class="history-empty"><Leaf :size="30" :stroke-width="1.1" /><h3>第一段记录，从今天开始</h3><p>完成一次监测后，时长与提醒会安静地留在这里。</p><RouterLink to="/" class="text-link">开始一段专注<ArrowUpRight :size="16" /></RouterLink></div>
      <div v-else class="records-table">
        <div class="record-table-head"><span>开始时间</span><span>有效时长</span><span>参考坐姿</span><span>提醒</span><span /></div>
        <button v-for="record in visibleRecords" :key="record.id" class="record-row" @click="details = record">
          <span><strong>{{ dateLabel(localDay(record.startedAt)) }}</strong><small>{{ shortTime(record.startedAt) }} · {{ record.view === 'front' ? '正面' : '侧面' }}{{ record.endedAt === null ? ' · 未结束' : '' }}</small></span>
          <span>{{ duration(record.goodSeconds + record.badSeconds) }}</span>
          <span>{{ record.goodSeconds + record.badSeconds > 0 ? Math.round(record.goodSeconds / (record.goodSeconds + record.badSeconds) * 100) + '%' : '—' }}</span>
          <span>{{ record.reminders.length }} 次</span><ChevronRight :size="16" />
        </button>
      </div>
      <p class="records-footnote">占比由可靠识别的时长计算。未知、离座和暂停单列，避免把没有观察到的时间算成正常。</p>
    </section>
    <AppDialog :open="!!details" title="这一段专注" description="记录仅包含状态和统计，不包含摄像头画面。" @update:open="details = null">
      <template v-if="details">
        <div class="detail-date"><Clock3 :size="16" />{{ new Date(details.startedAt).toLocaleString('zh-CN') }}</div>
        <dl class="detail-stats"><div><dt>参考坐姿</dt><dd>{{ duration(details.goodSeconds) }}</dd></div><div><dt>偏离参考</dt><dd>{{ duration(details.badSeconds) }}</dd></div><div><dt>未知 / 校准</dt><dd>{{ duration(details.unknownSeconds) }}</dd></div><div><dt>离座 / 暂停</dt><dd>{{ duration(details.absentSeconds + details.pausedSeconds) }}</dd></div></dl>
        <h3 class="detail-heading">提醒记录</h3>
        <ul class="reminder-list"><li v-for="(event, index) in details.reminders" :key="index"><span>{{ shortTime(event.at) }}</span>{{ event.message }}</li><li v-if="!details.reminders.length" class="muted-text">这一段没有触发提醒。</li></ul>
      </template>
    </AppDialog>
  </div>
</template>

