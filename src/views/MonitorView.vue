<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowUpRight, Play, Pause, ScanLine, Check, ShieldCheck, ChevronRight, CircleHelp, Leaf, Timer, Eye } from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'
import { clock, duration } from '@/lib/format'
import CameraPreview from '@/components/CameraPreview.vue'
import PomodoroCard from '@/components/PomodoroCard.vue'
const store = useMonitorStore()
const debugOpen = ref(false)
const DEBUG_TAGS = ['自由调试', '正常', '仰头', '低头', '歪头(左)', '歪头(右)', '转头(左)', '转头(右)', '驼背', '高低肩'] as const

function selectDebugTag(tag: string) {
  store.testActionTag = tag
}

async function clearDebugLog() {
  store.telemetryCount = 0
  if (typeof fetch === 'function') {
    await fetch('/__telemetry', { method: 'DELETE' }).catch(() => {})
  }
  store.announce('调试日志已清空', '可以选择不同姿势标签进行动作采样。')
}

const debugMetrics = computed(() => {
  const f = store.feature
  const b = store.profile?.baseline
  if (!f || !b) return []
  const fmt = (val: number | null | undefined, suffix = '') => typeof val === 'number' && Number.isFinite(val) ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}${suffix}` : '—'
  const dPitch = f.headPitch != null && b.headPitch != null ? f.headPitch - b.headPitch : null
  const dTilt = f.headTilt != null && b.headTilt != null ? f.headTilt - b.headTilt : null
  const nComp = f.neckHeight != null && b.neckHeight != null && b.neckHeight > 0.05 ? (1 - f.neckHeight / b.neckHeight) * 100 : null
  const dShldr = f.shoulders - b.shoulders
  const dDrop = (f.drop - b.drop) * 100
  const dShift = (f.shift - b.shift) * 100
  const closer = b.scale > 0.08 ? (f.scale / b.scale - 1) * 100 : null
  return [
    { label: '俯仰角差 (仰<-15° / 低>15°)', value: fmt(dPitch, '°') },
    { label: '双耳歪头差 (|歪|>8.5°)', value: fmt(dTilt, '°') },
    { label: '头颈压缩率 (驼背>11%)', value: fmt(nComp, '%') },
    { label: '高低肩差 (|肩|>4.8°)', value: fmt(dShldr, '°') },
    { label: '鼻肩下沉差 (drop)', value: fmt(dDrop, '%') },
    { label: '鼻肩横移差 (shift)', value: fmt(dShift, '%') },
    { label: '画面远近差 (closer)', value: fmt(closer, '%') },
  ]
})
watch(() => store.phase, (phase, previous) => {
  if (phase === 'ready' || phase === 'monitoring' && (previous === 'idle' || previous === 'loading')) {
    requestAnimationFrame(() => document.querySelector('.monitor-layout')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }))
  }
})
const primaryLabel = computed(() => store.busy ? '正在准备…' : store.phase === 'paused' ? '继续监测' : store.phase === 'ready' ? '开始 8 秒校准' : store.phase === 'calibrating' ? '正在校准…' : store.phase === 'monitoring' ? '暂停监测' : '开始监测')
const postureCoverage = computed(() => {
  const baseline = store.profile?.baseline
  if (!baseline) return ''
  const head = baseline.headPitch == null ? '鼻耳参考不足，俯仰未启用' : '抬头 / 低头'
  if (store.profile?.view === 'front') {
    const tilt = baseline.headTilt == null ? '歪头兜底 · 高低肩' : '歪头 · 高低肩'
    const slouch = baseline.neckHeight == null ? '前倾驼背 · 屏幕距离' : '含胸驼背 · 屏幕距离'
    return `${head} · ${tilt} · ${slouch}`
  }
  const sideSlouch = baseline.neckHeight == null ? '头颈角度' : '含胸驼背 · 头颈角度'
  return `${head} · ${sideSlouch}`
})
const lightingDescription = computed(() => {
  const l = store.lighting
  if (l.status === 'dark') return l.boostApplied ? `环境偏暗（亮度 ${l.luma}）· 已启用暗光提亮补偿` : `环境偏暗（亮度 ${l.luma}）· 建议补充桌面照明`
  if (l.status === 'backlit') return l.boostApplied ? `检测到逆光（中心 ${l.centerLuma} / 背景 ${l.edgeLuma}）· 已增强暗部` : `检测到逆光 · 建议避开背后强光`
  return `光线良好（亮度 ${l.luma}）`
})
const channelLabels = {
  headPitch: '头部俯仰', headTilt: '头部歪斜', neckHeight: '头颈高度',
  neckAngle: '头颈角度', shoulderTilt: '高低肩倾角',
  headShift: '头部横移', proximity: '画面尺度',
} as const
const channelStatus = { normal: '未见偏离', bad: '偏离参考', unknown: '暂不可判断', disabled: '未启用' } as const
const channelDetails = computed(() => store.displayChannels
  ? Object.entries(store.displayChannels)
    .filter(([key, result]) => !(store.profile?.view === 'front' && key === 'neckAngle' && result.status === 'disabled'))
    .map(([key, result]) => ({ label: channelLabels[key as keyof typeof channelLabels], status: result.status, text: channelStatus[result.status], score: result.landmarkScore }))
  : [])
async function primary() {
  if (store.phase === 'paused') await store.resume()
  else if (store.phase === 'ready') store.beginCalibration()
  else if (store.phase === 'monitoring') store.pause()
  else await store.startCamera()
}
const statusDescription = computed(() => {
  if (store.phase === 'idle') return '先花几秒找到舒服的坐姿。之后，让提醒轻一点，让专注久一点。'
  if (store.phase === 'loading') return '首次准备可能需要一点时间。你的画面始终留在这台设备上。'
  if (store.phase === 'calibrating') return store.settings.view === 'side'
    ? '保持舒适坐姿，让同一侧鼻子、耳朵与肩膀清晰稳定入镜。'
    : '保持舒适坐姿，让鼻子、双耳与双肩尽量清晰稳定。'
  if (store.phase === 'paused') return '摄像头已关闭。准备好了，再继续刚才的专注。'
  if (store.demo) return '这是模拟的监测过程，不会打开摄像头，也不会写入真实历史。'
  return store.displayReason
})
</script>

<template>
  <div class="page-enter">
    <section class="monitor-hero" :class="{ 'monitor-hero-active': store.phase !== 'idle' }">
      <div class="monitor-hero-main">
        <div class="eyebrow">
          <span class="tiny-line" />一个安静的桌边提醒
          <span class="hero-inline-note"><ShieldCheck :size="12" />本地处理 · 不保存摄像头画面</span>
        </div>
        <h1 v-if="store.phase === 'idle'">坐得舒服一些，<span>专注久一点。</span></h1>
        <h1 v-else>{{ store.demo ? '体验监测' : store.phase === 'paused' ? '监测已暂停' : store.phase === 'ready' ? '准备校准' : store.phase === 'calibrating' ? '建立参考坐姿' : store.phase === 'loading' ? '正在准备' : '此刻的坐姿' }}</h1>
        <p v-if="store.phase === 'idle'" class="hero-description">不用时刻惦记姿势。找到自己的舒适参考，让轻轻的提醒陪你度过每一段专注。</p>
      </div>
      <div v-if="store.phase === 'idle'" class="hero-actions">
        <button class="button button-primary" @click="primary">
          <Play :size="16" />
          {{ primaryLabel }}<ArrowUpRight :size="16" />
        </button>
      </div>
      <div v-else-if="store.running && !store.demo" class="hero-actions">
        <button type="button" class="small-button" :aria-pressed="debugOpen" :class="{ active: debugOpen }" @click="debugOpen = !debugOpen">
          {{ debugOpen ? '收起姿态调试' : '姿态调试模式' }}
        </button>
      </div>
    </section>

    <div v-if="store.error" role="alert" class="notice error-notice"><CircleHelp :size="19" /><div><strong>暂时无法开始</strong><p>{{ store.error }}</p></div></div>
    <div v-if="store.storageWarning" class="notice">{{ store.storageWarning }}</div>

    <div v-if="store.running && !store.demo && debugOpen" class="demo-controller" style="flex-direction: column; align-items: stretch; gap: 10px; margin-top: 0; margin-bottom: 14px">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
          <strong>姿态调试模式（已记录 {{ store.telemetryCount }} 帧 · 当前标签：{{ store.testActionTag }}）</strong>
          <div class="segmented" style="flex-wrap: wrap; gap: 4px">
            <button
              v-for="tag in DEBUG_TAGS"
              :key="tag"
              type="button"
              :aria-pressed="store.testActionTag === tag"
              :class="{ selected: store.testActionTag === tag }"
              @click="selectDebugTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px">
          <button type="button" class="text-button" @click="clearDebugLog">清空日志</button>
          <button type="button" class="text-button" @click="debugOpen = false">收起</button>
        </div>
      </div>

      <div style="padding: 10px 12px; border-radius: 8px; background: rgba(148, 163, 184, 0.08); font-size: 12px; display: flex; flex-direction: column; gap: 6px">
        <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px">
          <span><strong>即时状态（未防抖）：</strong>{{ store.state }} · {{ store.reason }}</span>
          <span><strong>展示状态（防抖后）：</strong>{{ store.displayState }} · {{ store.displayReason }}</span>
        </div>
        <div v-if="debugMetrics.length" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 4px 12px; padding-top: 6px; border-top: 1px dashed rgba(148, 163, 184, 0.25)">
          <div v-for="m in debugMetrics" :key="m.label" style="display: flex; justify-content: space-between; gap: 6px">
            <span style="opacity: 0.8">{{ m.label }}</span>
            <strong style="font-variant-numeric: tabular-nums">{{ m.value }}</strong>
          </div>
        </div>
      </div>
    </div>

    <section class="monitor-layout">
      <CameraPreview />
      <aside class="session-panel">
        <div class="panel-kicker"><span>此刻</span><span v-if="store.demo" class="demo-badge">模拟数据</span><span v-else class="small-uppercase">LIVE</span></div>
        <div class="state-symbol" :class="store.stateColor"><Check v-if="store.displayState === 'normal' && store.phase === 'monitoring'" :size="30" :stroke-width="1.5" /><Pause v-else-if="store.phase === 'paused'" :size="26" :stroke-width="1.5" /><ScanLine v-else :size="28" :stroke-width="1.3" /></div>
        <h2 class="state-title">{{ store.stateLabel }}</h2>
        <p class="state-description">{{ statusDescription }}</p>
        <div class="session-time"><span>本次有效监测</span><strong>{{ clock(store.elapsed) }}</strong></div>
        <div v-if="store.settings.headPoseEnabled && store.phase === 'monitoring' && !store.demo" class="head-pose-info" role="status">
          <strong>人脸头姿参考 · 实验</strong>
          <p v-if="!store.headPoseAvailable">人脸模型不可用，坐姿监测继续。</p>
          <p v-else-if="!store.profile?.faceBaseline">请重新校准，并让人脸持续清晰入镜。</p>
          <p v-else-if="!store.headPoseDelta">当前人脸不清晰或未匹配，暂不可判断。</p>
          <p v-else>相对参考：俯仰 {{ store.headPoseDelta.pitch.toFixed(0) }}° · 左右转动 {{ store.headPoseDelta.yaw.toFixed(0) }}° · 歪斜 {{ store.headPoseDelta.roll.toFixed(0) }}°</p>
          <p>角度方向及效果待真人验证，不触发提醒。</p>
        </div>
        <div v-if="store.phase === 'calibrating'" class="sample-note">已收集 {{ store.calibrationSamples }} 个有效样本</div>
        <div v-else-if="store.phase === 'ready'" class="setup-note"><span>01</span><p>{{ store.settings.view === 'front' ? '让鼻子、双耳与双肩进入画面，舒适地坐好即可开始校准。' : '让摄像头看清同一侧的鼻子、耳朵与肩膀，舒适坐好即可开始校准。' }}</p></div>
        <div v-else-if="store.running && !store.demo" class="signal-line"><span class="status-dot" :class="store.displayQuality >= 0.55 ? 'on' : ''" />{{ store.displayQuality >= 0.55 ? '关键点清晰' : '等待清晰画面' }}<span>{{ store.settings.view === 'front' ? '正面参考' : '侧面参考' }}</span></div>
        <p v-if="store.phase === 'monitoring' && !store.demo" class="sample-note">识别模型：{{ store.engine }}<template v-if="store.performanceStats.samples"> · 推理 p50 {{ store.performanceStats.p50Ms }}ms / p95 {{ store.performanceStats.p95Ms }}ms</template></p>
        <p v-if="store.running && !store.demo" class="sample-note">{{ lightingDescription }}</p>
        <p v-if="store.phase === 'monitoring' && !store.demo" class="sample-note">{{ postureCoverage }}</p>
        <details v-if="store.phase === 'monitoring' && !store.demo && channelDetails.length" class="channel-details">
          <summary>查看各项检测</summary>
          <ul><li v-for="item in channelDetails" :key="item.label"><span>{{ item.label }}</span><strong :class="item.status">{{ item.text }}<small v-if="item.score !== null"> · 点位分数 {{ item.score.toFixed(2) }}</small></strong></li></ul>
          <p>点位分数来自模型可见度/存在度，不表示姿态判断正确率。提醒仍按综合规则判断。</p>
        </details>
        <button v-if="store.phase === 'ready'" class="button button-primary calibration-button" @click="store.beginCalibration"><ScanLine :size="16" />开始 8 秒校准</button>
        <button v-if="store.phase === 'monitoring' && !store.demo" class="recalibrate-button" @click="store.beginCalibration"><ScanLine :size="15" />重新校准<ChevronRight :size="14" /></button>
      </aside>
    </section>

    <div v-if="store.demo && store.phase !== 'idle'" class="demo-controller">
      <div><strong>试试不同状态</strong><span>模拟画面；异常会经过保持时间后提醒</span></div>
      <div class="segmented"><button :aria-pressed="store.demoPose === 'normal'" :class="{ selected: store.demoPose === 'normal' }" @click="store.demoPose = 'normal'">舒适坐姿</button><button :aria-pressed="store.demoPose === 'bad'" :class="{ selected: store.demoPose === 'bad' }" @click="store.demoPose = 'bad'">持续低头</button><button :aria-pressed="store.demoPose === 'absent'" :class="{ selected: store.demoPose === 'absent' }" @click="store.demoPose = 'absent'">离开座位</button></div>
    </div>

    <PomodoroCard v-if="store.settings.pomodoroEnabled" />

    <section class="today-section">
      <div class="section-title-row"><h2>今天，一点点积累</h2><RouterLink to="/history" class="text-link">查看历史<ArrowUpRight :size="15" /></RouterLink></div>
      <div class="today-metrics">
        <div><span class="metric-label">今日健康评分</span><strong>{{ store.today.score == null ? '—' : store.today.score }}<small v-if="store.today.grade"> · {{ store.today.grade }}</small></strong><p>结合参考坐姿占比与提醒频率计算</p></div>
        <div><span class="metric-label">有效监测</span><strong>{{ duration(store.today.effectiveSeconds) }}</strong><p>清晰识别下的在座记录</p></div>
        <div><span class="metric-label">参考坐姿占比</span><strong>{{ store.today.ratio === null ? '—' : Math.round(store.today.ratio * 100) + '%' }}</strong><p>正常时长 / 有效监测时长</p></div>
        <div><span class="metric-label">轻提醒</span><strong>{{ store.today.reminders }}<small> 次</small></strong><p>姿态、休息与护眼提醒</p></div>
        <div v-if="store.settings.blinkEnabled"><span class="metric-label">眨眼参考频率</span><strong>{{ store.blinkRate === null ? '—' : store.blinkRate }}<small v-if="store.blinkRate !== null"> 次/分</small></strong><p>{{ store.blinkAvailable ? store.blinkStatus : '开启真实监测后开始采集' }}</p><p>已识别 {{ store.blinkCount }} 次 · 有效观察 {{ store.blinkObservedSeconds }} 秒</p></div>
      </div>
      <p v-if="store.demo" class="demo-footnote">当前展示的是演示数据，与真实记录分开。</p>
    </section>

    <section class="gentle-guide">
      <div class="guide-heading"><span class="eyebrow">以你为参考</span><h2>简单开始，<br />慢慢养成习惯。</h2></div>
      <ol>
        <li><span class="step-number">01</span><div><h3>找到舒适的参考</h3><p>坐好，校准。它记住你在这个机位下的起点。</p></div></li>
        <li><span class="step-number">02</span><div><h3>继续做手头的事</h3><p>持续的姿态变化才会触发提醒，短暂动作留有余地。</p></div></li>
        <li><span class="step-number">03</span><div><h3>偶尔回头看看</h3><p>用本地记录了解自己的节奏，给休息留一点时间。</p></div></li>
      </ol>
    </section>
    <div class="closing-note"><Timer :size="16" /><span>暂时看不清、离座和暂停，都不会算成有效专注。</span><Eye :size="16" class="closing-eye" /></div>
  </div>
</template>
