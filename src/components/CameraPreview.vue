<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Camera, CameraOff, Eye, EyeOff, ShieldCheck, Pause, Play, Square, X } from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'
import PostureIllustration from './PostureIllustration.vue'
const store = useMonitorStore()
const video = ref<HTMLVideoElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const hasPreview = computed(() => !!store.stream && store.settings.showPreview)
const connections = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [7, 11], [8, 12]]
let resize: ResizeObserver | null = null

async function changeView(event: Event) {
  const view = (event.target as HTMLSelectElement).value
  if (view !== 'front' && view !== 'side') return
  if (store.demo && store.phase !== 'idle') await store.endSession()
  await store.updateSettings({ view })
}
async function attach() {
  if (!video.value) return
  video.value.srcObject = store.stream
  if (store.stream) { try { await video.value.play() } catch { /* 视频等待挂载后播放 */ } }
}
function draw() {
  const target = canvas.value
  if (!target) return
  const rect = target.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  target.width = Math.round(rect.width * dpr)
  target.height = Math.round(rect.height * dpr)
  const ctx = target.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, rect.width, rect.height)
  if (!hasPreview.value || !store.settings.showSkeleton) return
  const points = store.landmarks
  const scale = Math.min(rect.width / store.frameWidth, rect.height / store.frameHeight)
  const w = store.frameWidth * scale
  const h = store.frameHeight * scale
  const ox = (rect.width - w) / 2
  const oy = (rect.height - h) / 2
  ctx.strokeStyle = store.state === 'bad' ? '#e7b57a' : '#b7d7a5'
  ctx.fillStyle = '#e5efdc'
  ctx.lineWidth = 2
  for (const [from, to] of connections) {
    const a = points[from!]
    const b = points[to!]
    if (!a || !b || (a.visibility ?? 1) < 0.55 || (b.visibility ?? 1) < 0.55) continue
    ctx.beginPath()
    ctx.moveTo(ox + a.x * w, oy + a.y * h)
    ctx.lineTo(ox + b.x * w, oy + b.y * h)
    ctx.stroke()
  }
  for (const i of [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24]) {
    const p = points[i]
    if (!p || (p.visibility ?? 1) < 0.55) continue
    ctx.beginPath(); ctx.arc(ox + p.x * w, oy + p.y * h, 3, 0, Math.PI * 2); ctx.fill()
  }
}
watch(() => store.stream, attach)
watch(() => [store.landmarks, store.settings.showSkeleton, store.settings.showPreview], draw)
onMounted(() => {
  void attach()
  if (canvas.value) { resize = new ResizeObserver(draw); resize.observe(canvas.value) }
})
onBeforeUnmount(() => { resize?.disconnect(); if (video.value) video.value.srcObject = null })
</script>

<template>
  <div class="camera-panel" :class="{ 'has-video': hasPreview }">
    <div class="camera-toolbar">
      <span class="camera-label"><span class="status-dot" :class="store.running ? 'on' : ''" />{{ store.demo ? '演示画面 · 模拟数据' : store.running ? '摄像头已开启' : '你的专注空间' }}</span>
      <button v-if="store.stream" class="camera-privacy-button" @click="store.updateSettings({ showPreview: !store.settings.showPreview })">
        <Eye v-if="store.settings.showPreview" :size="15" /><EyeOff v-else :size="15" />{{ store.settings.showPreview ? '隐藏画面' : '显示画面' }}
      </button>
      <span v-else class="small-uppercase">A LITTLE MORE AT EASE</span>
    </div>
    <div class="camera-stage">
      <video ref="video" autoplay muted playsinline :class="{ invisible: !hasPreview }" />
      <canvas ref="canvas" :class="{ invisible: !hasPreview }" />
      <div v-if="!hasPreview" class="camera-placeholder">
        <PostureIllustration v-if="!store.stream && store.phase !== 'paused'" :view="store.demo && store.phase !== 'idle' ? 'front' : store.settings.view" :bad="store.demo && store.phase !== 'idle' && store.demoPose === 'bad'" />
        <template v-else><CameraOff :size="36" :stroke-width="1.25" /><p>{{ store.phase === 'paused' ? '给自己一点休息' : '画面已隐藏，监测仍在进行' }}</p></template>
        <span v-if="store.demo && store.demoPose === 'absent'" class="demo-absent">演示：已离开座位</span>
      </div>
      <div v-if="store.phase === 'loading'" class="camera-loading"><span class="loader" /><span>准备摄像头与本地识别…</span></div>
      <Transition name="fun">
        <div v-if="store.funMoment" class="fun-moment" role="status" aria-live="polite" aria-atomic="true">
          <span class="fun-emoji" aria-hidden="true">{{ store.funMoment.emoji }}</span>
          <div><strong>{{ store.funMoment.title }}</strong></div>
          <button class="icon-button" aria-label="关闭" @click="store.dismissFun"><X :size="15" /></button>
        </div>
      </Transition>
      <div v-if="store.phase === 'calibrating'" class="calibration-overlay">
        <span class="calibration-count">{{ Math.max(0, Math.ceil((100 - store.calibrationProgress) / 12.5)) }}</span>
        <p>舒适地坐好，保持几秒</p>
        <div class="calibration-track"><i :style="{ width: store.calibrationProgress + '%' }" /></div>
      </div>
    </div>
    <div class="camera-footer"><span><ShieldCheck :size="14" />画面只在当前设备处理</span><span v-if="store.running || store.phase === 'paused'" class="camera-inline-controls"><button v-if="store.phase !== 'calibrating'" @click="store.phase === 'paused' ? store.resume() : store.pause()"><Play v-if="store.phase === 'paused'" :size="12" /><Pause v-else :size="12" />{{ store.phase === 'paused' ? '继续' : '暂停' }}</button><button @click="store.endSession"><Square :size="10" />结束</button></span><label class="camera-mode-select"><Camera :size="14" /><span class="sr-only">监测模式</span><select aria-label="监测模式" title="切换模式会结束当前监测，请按新机位重新开始" :value="store.demo && store.phase !== 'idle' ? 'front' : store.settings.view" :disabled="store.busy || store.phase === 'calibrating'" @change="changeView"><option value="front">正面模式</option><option value="side">侧面模式</option></select></label></div>
  </div>
</template>
