<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { isDarkTheme } from '@/lib/theme'
import type { DailyStats } from '@/domain/types'
use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])
const props = defineProps<{ stats: DailyStats[]; variant?: 'time' | 'ratio' }>()
const element = ref<HTMLDivElement | null>(null)
let chart: ECharts | null = null
let observer: ResizeObserver | null = null
function render() {
  if (!chart) return
  const styles = getComputedStyle(document.documentElement)
  const color = (name: string) => styles.getPropertyValue('--chart-' + name).trim()
  const options: EChartsCoreOption = {
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

<template><div ref="element" class="trend-chart" role="img" :aria-label="variant === 'ratio' ? '良好坐姿占比趋势' : '每日有效监测时长趋势'" /></template>

