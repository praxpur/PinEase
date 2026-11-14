<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertCircle, BarChart3, CalendarDays, CheckCircle2, ChevronDown, MinusCircle, ShieldCheck } from 'lucide-vue-next'
import { init, use, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { dateLabel } from '@/lib/format'
import { isDarkTheme } from '@/lib/theme'
import type { DailyStats } from '@/domain/types'
use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])
const props = defineProps<{ stats: DailyStats[]; variant?: 'time' | 'ratio' }>()
const element = ref<HTMLDivElement | null>(null)
let chart: ECharts | null = null
let observer: ResizeObserver | null = null

const maxDaySeconds = computed(() => {
  const peak = Math.max(...props.stats.map((s) => s.goodSeconds + s.badSeconds), 0)
  return peak > 0 ? peak : 3600
})

const activeDayCount = computed(() => props.stats.filter((s) => s.effectiveSeconds > 0).length)

function goodWidth(day: DailyStats): string {
  const total = day.goodSeconds + day.badSeconds
  if (total <= 0) return '0%'
  return Math.max(4, Math.round((day.goodSeconds / maxDaySeconds.value) * 100)) + '%'
}

function badWidth(day: DailyStats): string {
  if (day.badSeconds <= 0) return '0%'
  return Math.max(3, Math.round((day.badSeconds / maxDaySeconds.value) * 100)) + '%'
}

function ratioPercent(day: DailyStats): number {
  return day.ratio === null ? 0 : Math.round(day.ratio * 100)
}

function dayTone(day: DailyStats): 'good' | 'steady' | 'warn' | 'empty' {
  if (day.ratio === null || day.effectiveSeconds <= 0) return 'empty'
  const pct = Math.round(day.ratio * 100)
  if (pct >= 85) return 'good'
  if (pct >= 70) return 'steady'
  return 'warn'
}

function render() {
  if (!chart) return
  const styles = getComputedStyle(document.documentElement)
  const color = (name: string) => styles.getPropertyValue('--chart-' + name).trim()
  const options: EChartsCoreOption = {
    animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    animationDuration: 500,
    textStyle: { fontFamily: 'Arial, Microsoft YaHei, sans-serif', fontSize: 11, color: color('text') },
    tooltip: { trigger: 'axis', backgroundColor: color('surface'), borderColor: color('border'), padding: 12, textStyle: { color: color('text'), fontSize: 12 } },
    grid: { left: 40, right: 12, top: 22, bottom: 30 },
    xAxis: { type: 'category', data: props.stats.map((s) => s.date.slice(5).replace('-', '/')), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { margin: 14, color: color('text') } },
    yAxis: { type: 'value', max: props.variant === 'ratio' ? 100 : undefined, axisLabel: { color: color('text'), formatter: props.variant === 'ratio' ? '{value}%' : '{value}分' }, splitLine: { lineStyle: { color: color('grid'), type: 'dashed' } } },
    series: props.variant === 'ratio'
      ? [{ name: '良好占比', type: 'line', smooth: 0.2, connectNulls: false, data: props.stats.map((s) => s.ratio === null ? null : Math.round(s.ratio * 100)), symbolSize: 6, lineStyle: { color: color('line'), width: 2 }, itemStyle: { color: color('line') }, areaStyle: { color: color('area'), opacity: 0.7 } }]
      : [
        { name: '参考坐姿', type: 'bar', stack: 'time', barMaxWidth: 28, itemStyle: { color: color('good'), borderRadius: [0, 0, 3, 3] }, data: props.stats.map((s) => Number((s.goodSeconds / 60).toFixed(1))) },
        { name: '偏离参考', type: 'bar', stack: 'time', barMaxWidth: 28, itemStyle: { color: color('bad'), borderRadius: [4, 4, 0, 0] }, data: props.stats.map((s) => Number((s.badSeconds / 60).toFixed(1))) },
      ],
  }
  chart.setOption(options, true)
}
watch(() => [props.stats, props.variant, isDarkTheme.value], render, { deep: true, flush: 'post' })
onMounted(() => {
  if (!element.value) return
  chart = init(element.value)
  render()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(element.value)
})
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose() })
</script>

<template>
  <div ref="element" class="trend-chart" role="img" :aria-label="variant === 'ratio' ? '参考坐姿占比趋势，详细数值见下方数据表' : '每日有效监测时长趋势，详细数值见下方数据表'" />
  <details class="chart-data">
    <summary class="chart-data-summary">
      <span class="chart-data-trigger">
        <span class="chart-data-icon"><BarChart3 :size="14" /></span>
        <span>查看每日数据表</span>
      </span>
      <span class="chart-data-meta">
        <span class="chart-data-pill"><CalendarDays :size="12" />{{ activeDayCount }}/{{ stats.length }} 天有记录</span>
        <ChevronDown :size="14" class="chart-data-chevron" />
      </span>
    </summary>
    <div class="chart-data-body">
      <table class="chart-data-table">
        <caption class="sr-only">{{ variant === 'ratio' ? '每天的参考坐姿占比' : '每天的有效监测时长' }}</caption>
        <thead>
          <tr>
            <th scope="col">日期与状态</th>
            <th scope="col">{{ variant === 'ratio' ? '舒适占比图示' : '每日时长分布图' }}</th>
            <th v-if="variant !== 'ratio'" scope="col">参考 / 偏离</th>
            <th scope="col">占比</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in stats" :key="day.date" :class="'tone-' + dayTone(day)">
            <th scope="row" class="chart-day-cell">
              <span class="day-status-icon" :class="dayTone(day)" :title="day.grade || '无记录'">
                <CheckCircle2 v-if="dayTone(day) === 'good'" :size="14" />
                <ShieldCheck v-else-if="dayTone(day) === 'steady'" :size="14" />
                <AlertCircle v-else-if="dayTone(day) === 'warn'" :size="14" />
                <MinusCircle v-else :size="14" />
              </span>
              <div class="day-label-group">
                <strong>{{ dateLabel(day.date) }}</strong>
                <small>{{ day.date.slice(5) }}</small>
              </div>
            </th>
            <td class="chart-visual-cell">
              <div v-if="day.effectiveSeconds <= 0" class="visual-bar-track is-empty">
                <span class="visual-empty-hint">当日暂无有效监测</span>
              </div>
              <div v-else-if="variant === 'ratio'" class="visual-ratio-row">
                <svg class="mini-ring" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="mini-ring-bg" cx="12" cy="12" r="9" />
                  <circle
                    class="mini-ring-fill"
                    :class="dayTone(day)"
                    cx="12"
                    cy="12"
                    r="9"
                    :stroke-dasharray="`${Math.round(ratioPercent(day) * 0.565)} 60`"
                  />
                </svg>
                <div class="visual-bar-track">
                  <i class="visual-bar-good" :class="dayTone(day)" :style="{ width: ratioPercent(day) + '%' }" />
                </div>
              </div>
              <div v-else class="visual-bar-track stacked">
                <i class="visual-bar-good" :style="{ width: goodWidth(day) }" :title="`参考坐姿 ${Math.round(day.goodSeconds / 60)} 分钟`" />
                <i v-if="day.badSeconds > 0" class="visual-bar-bad" :style="{ width: badWidth(day) }" :title="`偏离参考 ${Math.round(day.badSeconds / 60)} 分钟`" />
              </div>
            </td>
            <td v-if="variant !== 'ratio'" class="chart-duration-cell">
              <span class="duration-chip good"><i class="chip-dot green" />{{ Math.round(day.goodSeconds / 60) }}分</span>
              <span class="duration-chip bad"><i class="chip-dot amber" />{{ Math.round(day.badSeconds / 60) }}分</span>
            </td>
            <td class="chart-ratio-cell">
              <span v-if="day.ratio === null" class="ratio-badge empty">无记录</span>
              <span v-else class="ratio-badge" :class="dayTone(day)">
                {{ ratioPercent(day) }}%
                <small v-if="day.grade">{{ day.grade }}</small>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>

