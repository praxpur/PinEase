<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { ArrowUpRight, X, ShieldCheck, Expand, Leaf } from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'
import { clock } from '@/lib/format'
import AppDialog from '@/components/ui/AppDialog.vue'
const store = useMonitorStore()
const desktopUnsubscribe = ref<(() => void) | null>(null)
const privacy = ref(false)
const installPrompt = shallowInstall()
function shallowInstall() { return ref<(Event & { prompt: () => Promise<void> }) | null>(null) }
const restTitle = computed(() => store.restKind === 'posture' ? '让身体回到舒服的位置。' : '给自己一分钟。')
onMounted(() => {
  void store.init()
  if (window.pineaseDesktop?.isDesktop) {
    desktopUnsubscribe.value = window.pineaseDesktop.onCommand((command) => { void store.handleDesktopCommand(command) })
    watch(() => store.phase, (phase) => window.pineaseDesktop?.setState(phase === 'monitoring' || phase === 'ready' || phase === 'calibrating' ? 'running' : phase === 'paused' ? 'paused' : 'idle'), { immediate: true })
  }
  if (!window.pineaseDesktop?.isDesktop) window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt.value = event as Event & { prompt: () => Promise<void> } })
})
onBeforeUnmount(() => desktopUnsubscribe.value?.())
async function install() { await installPrompt.value?.prompt(); installPrompt.value = null }
async function fullscreen() {
  try { await document.documentElement.requestFullscreen() } catch { store.announce('继续在页面里休息', '浏览器没有开启全屏。') }
}
</script>

<template>
  <a href="#main-content" class="skip-link">跳转到内容</a>
  <div class="app-shell">
    <header class="site-header">
      <RouterLink to="/" class="brand" aria-label="PinEase 青松坐姿首页">
        <svg width="28" height="36" viewBox="0 0 28 36" fill="none" aria-hidden="true"><path d="M14 32V10M14 4L5 17H10L3 26H25L18 17H23L14 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>
        <span>PinEase<small>青松坐姿</small></span>
      </RouterLink>
      <nav class="main-nav" aria-label="主导航"><RouterLink to="/">监测</RouterLink><RouterLink to="/history">历史</RouterLink><RouterLink to="/settings">设置</RouterLink></nav>
      <div class="header-status"><span v-if="store.demo" class="demo-badge">演示模式</span><span v-else-if="store.running" class="header-live"><span class="status-dot on" />正在监测</span><span v-else class="header-local"><ShieldCheck :size="14" />本地运行</span><button v-if="installPrompt && !store.desktopRuntime" class="small-button install-button" @click="install">安装到桌面<ArrowUpRight :size="13" /></button></div>
    </header>
    <main id="main-content" class="main-content"><RouterView /></main>
    <footer class="site-footer"><div class="footer-brand">PinEase<span>给专注一点空间。</span></div><div class="footer-links"><button @click="privacy = true">隐私与数据</button><span>人体工学习惯提醒 · 非医疗诊断</span></div><span class="footer-year">2026</span></footer>
  </div>
  <Transition name="toast">
    <div v-if="store.toast" class="toast-message" :class="store.toast.kind" role="status" aria-live="polite"><Leaf :size="20" :stroke-width="1.5" /><div><strong>{{ store.toast.title }}</strong><p v-if="store.toast.message">{{ store.toast.message }}</p></div><button class="icon-button" aria-label="关闭提醒" @click="store.dismissToast"><X :size="16" /></button></div>
  </Transition>
  <AppDialog :open="privacy" title="记录属于你。" description="画面留在设备上，数据由你决定。" @update:open="privacy = $event">
    <div class="privacy-detail"><h3>画面与关键点</h3><p>摄像头画面和逐帧关键点只用于本机识别，不录制、不保存，也不会上传服务器。</p><h3>保存的内容</h3><p>参考坐姿的汇总参数、设置、状态区间和提醒记录保存在本机。清除应用数据会移除它们，你可以先导出备份。</p><h3>运行方式</h3><p>{{ store.desktopRuntime ? 'Windows 应用最小化到托盘后仍可监测；电脑锁定或睡眠时暂停。' : '网页切换到后台会暂停并关闭摄像头。回到页面后可手动继续。' }}休息画面作用于本应用，不会调节其他软件或系统亮度。</p><h3>你的选择</h3><p>开始前由你授权摄像头；暂停或结束会关闭设备。{{ store.desktopRuntime ? '桌面版提供应用内提醒。' : '声音和浏览器通知由你开启。' }}</p></div>
  </AppDialog>
  <AppDialog :open="store.restOpen" :title="restTitle" :description="store.restKind === 'posture' ? '放松肩膀，回到你的舒适参考。坐姿恢复后，这个页面会自动退去。' : '离开屏幕，活动一下，看看远处。准备好了，随时可以回来。'" @update:open="store.closeRest()">
    <div class="rest-content"><Leaf :size="42" :stroke-width="1" /><span class="rest-clock">{{ clock(store.restRemaining) }}</span><p>不赶时间，慢慢来。</p></div>
    <div class="dialog-actions"><button class="button button-outline" @click="fullscreen"><Expand :size="15" />进入全屏</button><button class="button button-primary" @click="store.closeRest">返回监测</button></div>
  </AppDialog>
</template>

