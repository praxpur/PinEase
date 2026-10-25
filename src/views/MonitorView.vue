<script setup lang="ts">
import { computed, watch } from 'vue'
import { ArrowUpRight, ArrowRight, Play, Pause, Square, ScanLine, Check, ShieldCheck, ChevronRight, CircleHelp, Leaf, Timer, Eye } from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'
import { clock, duration } from '@/lib/format'
import CameraPreview from '@/components/CameraPreview.vue'
const store = useMonitorStore()
watch(() => store.phase, (phase, previous) => {
  if (phase === 'ready' || phase === 'monitoring' && (previous === 'idle' || previous === 'loading')) {
    requestAnimationFrame(() => document.querySelector('.monitor-layout')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }))
  }
})
const primaryLabel = computed(() => store.busy ? '正在准备…' : store.phase === 'paused' ? '继续监测' : store.phase === 'ready' ? '开始 8 秒校准' : store.phase === 'calibrating' ? '正在校准…' : store.phase === 'monitoring' ? '暂停一下' : '开始监测')
async function primary() {
  if (store.phase === 'paused') await store.resume()
  else if (store.phase === 'ready') store.beginCalibration()
  else if (store.phase === 'monitoring') store.pause()
  else await store.startCamera()
}
const statusDescription = computed(() => {
  if (store.phase === 'idle') return '先花几秒找到舒服的坐姿。之后，让提醒轻一点，让专注久一点。'
  if (store.phase === 'loading') return '首次准备可能需要一点时间。你的画面始终留在这台设备上。'
  if (store.phase === 'calibrating') return '保持你觉得舒服的坐姿，头部和肩膀尽量保持稳定。'
  if (store.phase === 'paused') return '摄像头已关闭。准备好了，再继续刚才的专注。'
  if (store.demo) return '这是模拟的监测过程，不会打开摄像头，也不会写入真实历史。'
  return store.reason
})
</script>

<template>
  <div class="page-enter">
    <section class="monitor-hero">
      <div>
        <div class="eyebrow"><span class="tiny-line" />一个安静的桌边提醒</div>
        <h1>坐得舒服一些。<br /><span>专注久一点。</span></h1>
        <p class="hero-description">不用时刻惦记姿势。找到自己的舒适参考，<br class="desktop-only" />让轻轻的提醒陪你度过每一段专注。</p>
        <div class="hero-actions">
          <button class="button button-primary" :disabled="store.busy || store.phase === 'calibrating'" @click="primary">
            <Pause v-if="store.phase === 'monitoring'" :size="17" /><ScanLine v-else-if="store.phase === 'ready'" :size="17" /><Play v-else :size="16" />
            {{ primaryLabel }}<ArrowUpRight v-if="store.phase === 'idle'" :size="16" />
          </button>
          <button v-if="store.phase === 'idle'" class="text-button" @click="store.startDemo">先体验一下<ArrowRight :size="16" /></button>
          <button v-else class="text-button" @click="store.endSession"><Square :size="13" />结束本次</button>
        </div>
        <div class="hero-note"><ShieldCheck :size="13" />本地处理 · 不保存摄像头画面</div>
      </div>
      <div class="hero-editorial"><span class="editorial-number">01 — YOUR OWN PACE</span><div class="editorial-line" /><p>舒适的姿势，<br />从觉察开始。</p><Leaf :size="30" :stroke-width="1.15" /></div>
    </section>

    <div v-if="store.error" role="alert" class="notice error-notice"><CircleHelp :size="19" /><div><strong>暂时无法开始</strong><p>{{ store.error }}</p></div><button class="text-button" @click="store.startDemo">用演示模式体验<ChevronRight :size="15" /></button></div>
    <div v-if="store.storageWarning" class="notice">{{ store.storageWarning }}</div>

    <section class="monitor-layout">
      <CameraPreview />
      <aside class="session-panel">
        <div class="panel-kicker"><span>此刻</span><span v-if="store.demo" class="demo-badge">模拟数据</span><span v-else class="small-uppercase">LIVE</span></div>
        <div class="state-symbol" :class="store.stateColor"><Check v-if="store.state === 'normal' && store.phase === 'monitoring'" :size="34" :stroke-width="1.5" /><Pause v-else-if="store.phase === 'paused'" :size="30" :stroke-width="1.5" /><ScanLine v-else :size="32" :stroke-width="1.3" /></div>
        <h2 class="state-title">{{ store.stateLabel }}</h2>
        <p class="state-description">{{ statusDescription }}</p>
        <div class="session-time"><span>本次有效监测</span><strong>{{ clock(store.elapsed) }}</strong></div>
        <div v-if="store.phase === 'calibrating'" class="sample-note">已收集 {{ store.calibrationSamples }} 个有效样本</div>
        <div v-else-if="store.phase === 'ready'" class="setup-note"><span>01</span><p>{{ store.settings.view === 'front' ? '让头部与双肩进入画面，舒适地坐好，然后开始校准。' : '让摄像头看清一侧的耳朵与肩膀，坐好后开始校准。' }}</p></div>
        <div v-else-if="store.running && !store.demo" class="signal-line"><span class="status-dot" :class="store.quality >= 0.55 ? 'on' : ''" />{{ store.quality >= 0.55 ? '关键点清晰' : '等待清晰画面' }}<span>{{ store.settings.view === 'front' ? '正面参考' : '侧面参考' }}</span></div>
        <button v-if="store.phase === 'ready'" class="button button-primary calibration-button" @click="store.beginCalibration"><ScanLine :size="16" />开始 8 秒校准</button>
        <button v-if="store.phase === 'monitoring' && !store.demo" class="recalibrate-button" @click="store.beginCalibration"><ScanLine :size="15" />重新校准<ChevronRight :size="14" /></button>
      </aside>
    </section>

    <div v-if="store.demo && store.phase !== 'idle'" class="demo-controller">
      <div><strong>试试不同状态</strong><span>模拟画面；异常会经过保持时间后提醒</span></div>
      <div class="segmented"><button :aria-pressed="store.demoPose === 'normal'" :class="{ selected: store.demoPose === 'normal' }" @click="store.demoPose = 'normal'">舒适坐姿</button><button :aria-pressed="store.demoPose === 'bad'" :class="{ selected: store.demoPose === 'bad' }" @click="store.demoPose = 'bad'">持续低头</button><button :aria-pressed="store.demoPose === 'absent'" :class="{ selected: store.demoPose === 'absent' }" @click="store.demoPose = 'absent'">离开座位</button></div>
    </div>

    <section class="today-section">
      <div class="section-title-row"><h2>今天，一点点积累</h2><RouterLink to="/history" class="text-link">查看历史<ArrowUpRight :size="15" /></RouterLink></div>
      <div class="today-metrics">
        <div><span class="metric-label">有效监测</span><strong>{{ duration(store.today.effectiveSeconds) }}</strong><p>清晰识别下的在座记录</p></div>
        <div><span class="metric-label">参考坐姿占比</span><strong>{{ store.today.ratio === null ? '—' : Math.round(store.today.ratio * 100) + '%' }}</strong><p>正常时长 / 有效监测时长</p></div>
        <div><span class="metric-label">轻提醒</span><strong>{{ store.today.reminders }}<small> 次</small></strong><p>姿态、休息与护眼提醒</p></div>
        <div v-if="store.settings.blinkEnabled"><span class="metric-label">眨眼参考频率</span><strong>{{ store.blinkRate === null ? '—' : store.blinkRate }}<small v-if="store.blinkRate !== null"> 次/分</small></strong><p>{{ store.blinkAvailable ? '近期清晰人脸下的估计' : '开启真实监测后开始采集' }}</p></div>
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

