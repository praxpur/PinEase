<script setup lang="ts">
import { computed, ref } from 'vue'
import { Moon, Camera, Bell, ShieldCheck, Download, Upload, Trash2, ScanLine, ChevronRight, ArrowUpRight } from 'lucide-vue-next'
import { themePreference, setTheme, type ThemePreference } from '@/lib/theme'
import { useMonitorStore } from '@/stores/monitor'
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
const store = useMonitorStore()
const confirm = ref<'history' | 'calibration' | 'defaults' | null>(null)
const file = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const notificationSupported = computed(() => !store.desktopRuntime && 'Notification' in window)
function changeTheme(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'system' || value === 'light' || value === 'dark') setTheme(value as ThemePreference)
}
function number(key: keyof Settings, event: Event) { void store.updateSettings({ [key]: Number((event.target as HTMLInputElement).value) }) }
function selected(key: 'cameraId' | 'view' | 'cameraFacingMode' | 'modelPreference', event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (key === 'modelPreference') { void store.updateSettings({ modelPreference: value === 'full' || value === 'lite' ? value : 'auto' }); return }
  void store.updateSettings(key === 'cameraFacingMode' ? { cameraFacingMode: value === 'environment' ? 'environment' : 'user', cameraId: '' } : { [key]: value })
}
async function importFile(event: Event) {
  const selectedFile = (event.target as HTMLInputElement).files?.[0]
  if (!selectedFile) return
  importing.value = true
  try {
    if (selectedFile.size > 10 * 1024 * 1024) throw new Error('备份超过 10 MB，请选择较小的 PinEase 备份。')
    await store.importBackup(await selectedFile.text())
  } catch (failure) { store.announce('未能导入', failure instanceof Error ? failure.message : '备份格式不正确。', 'error') }
  finally { importing.value = false; if (file.value) file.value.value = '' }
}
async function confirmAction() {
  try {
    if (confirm.value === 'history') await store.deleteHistory()
    if (confirm.value === 'calibration') await store.resetProfiles()
    if (confirm.value === 'defaults') { const saved = await store.updateSettings({ ...DEFAULT_SETTINGS }); if (saved) store.announce('已恢复默认设置') }
    confirm.value = null
  } catch { store.announce('暂时未完成', '浏览器存储不可用，请先导出记录。', 'error') }
}
async function testDesktopNotification() {
  const desktop = window.pineaseDesktop
  if (!desktop) return
  const available = await desktop.notificationAvailable()
  const shown = available && await desktop.notify('PinEase · 测试提醒', '桌面通知已可用。')
  store.announce(shown ? '测试通知已发送' : '桌面通知不可用', shown ? '若未显示，请检查系统通知设置。' : '页面内提醒仍然可用。', shown ? 'info' : 'error')
}
</script>

<template>
  <div class="page-enter">
    <header class="page-heading"><div><div class="eyebrow">MAKE IT YOURS</div><h1>以你的节奏。</h1><p>{{ store.desktopRuntime ? '桌面应用可最小化到托盘；电脑锁屏或睡眠时会暂停。' : '调整提醒的轻重，给专注留出空间。切到后台时网页会暂停监测。' }}</p></div></header>
    <div v-if="store.storageWarning" class="notice" role="status">{{ store.storageWarning }} <button class="text-button" @click="store.exportBackup">导出历史备份</button></div>
    <nav class="settings-jump" aria-label="设置分组"><a href="#settings-appearance">外观</a><a href="#settings-camera">摄像头</a><a href="#settings-reminders">提醒</a><a href="#settings-rest">休息</a><a href="#settings-data">数据</a></nav>
    <div class="settings-layout">
      <aside class="settings-note"><LeafIllustration /><h2>每个人的桌边，<br />都不太一样。</h2><p>换了摄像头、机位或座椅高度，重新校准会更合适。</p><RouterLink to="/" class="text-link">回到监测<ArrowUpRight :size="15" /></RouterLink><div class="settings-note-bottom"><ShieldCheck :size="17" /><span>设置与记录<br />保存在这台设备上</span></div></aside>
      <div class="settings-sections">
        <section id="settings-appearance" class="settings-panel">
          <h2><Moon :size="18" />外观</h2>
          <div class="setting-row"><div><label for="theme">显示模式</label><p>跟随系统自动切换，也可以选择日间或夜间</p></div><select id="theme" :value="themePreference" @change="changeTheme"><option value="system">跟随系统</option><option value="light">日间模式</option><option value="dark">夜间模式</option></select></div>
        </section>
        <section id="settings-camera" class="settings-panel">
          <h2><Camera :size="18" />摄像头与参考坐姿</h2>
          <p class="settings-restart-note">更换摄像头、机位、运行节奏或识别功能会结束当前监测；新设置将在下次开始时生效。</p>
          <div v-if="!store.desktopRuntime" class="setting-row"><div><label for="camera-facing">手机摄像头方向</label><p>切换后需重新开始并按新机位校准</p></div><select id="camera-facing" :value="store.settings.cameraFacingMode" :disabled="store.busy" @change="selected('cameraFacingMode', $event)"><option value="user">前置摄像头</option><option value="environment">后置摄像头</option></select></div>
          <div class="setting-row"><div><label for="camera">使用的摄像头</label><p>开始监测并授权后可看到设备名称</p></div><select id="camera" :value="store.settings.cameraId" :disabled="store.busy" @change="selected('cameraId', $event)"><option value="">默认摄像头</option><option v-for="(device, index) in store.devices" :key="device.deviceId" :value="device.deviceId">{{ device.label || '摄像头 ' + (index + 1) }}</option></select></div>
          <div class="setting-row"><div><label for="view">拍摄机位</label><p>每个机位使用独立的参考坐姿</p></div><select id="view" :value="store.settings.view" :disabled="store.busy" @change="selected('view', $event)"><option value="front">正面 · 头部与双肩</option><option value="side">侧面 · 耳朵与肩膀</option></select></div>
          <div class="setting-row"><div><label for="pose-model">姿态模型</label><p>切换模型会结束本次监测；新模型需要重新校准</p></div><select id="pose-model" :value="store.settings.modelPreference" :disabled="store.busy" @change="selected('modelPreference', $event)"><option value="auto">自动 · 优先 Full</option><option value="full">精细 · Full</option><option value="lite">节能 · Lite</option></select></div>
          <div class="setting-row"><div><strong>人脸头姿参考（实验）</strong><p>显示相对校准的角度变化；需清晰人脸，不用于姿态提醒。切换会结束监测。</p></div><AppSwitch :model-value="store.settings.headPoseEnabled" label="人脸头姿参考（实验）" :disabled="store.busy" @update:model-value="store.updateSettings({ headPoseEnabled: $event })" /></div>
          <div class="setting-row"><div><label for="fps">运行节奏</label><p>设备发热或卡顿时可以选择节能；切换会结束当前监测</p></div><select id="fps" :value="store.settings.fps" @change="number('fps', $event)"><option :value="7">节能</option><option :value="12">平衡</option><option :value="20">顺畅</option></select></div>
          <div class="setting-row"><div><strong>暗光与逆光自适应补偿</strong><p>环境偏暗或背后逆光时，自动增强画面暗部以提高关键点稳定性</p></div><AppSwitch :model-value="store.settings.lowLightBoost" label="暗光与逆光自适应补偿" @update:model-value="store.updateSettings({ lowLightBoost: $event })" /></div>
          <div class="setting-row"><div><strong>显示摄像头画面</strong><p>关闭预览仍会继续监测</p></div><AppSwitch :model-value="store.settings.showPreview" label="显示摄像头画面" @update:model-value="store.updateSettings({ showPreview: $event })" /></div>
          <div class="setting-row"><div><strong>显示关键点连线</strong><p>方便确认头部与肩膀是否在画面内</p></div><AppSwitch :model-value="store.settings.showSkeleton" label="显示关键点连线" @update:model-value="store.updateSettings({ showSkeleton: $event })" /></div>
          <button class="setting-link" @click="confirm = 'calibration'"><ScanLine :size="16" />清除参考坐姿<span>{{ store.profiles.length }} 组</span><ChevronRight :size="15" /></button>
        </section>

        <section id="settings-reminders" class="settings-panel">
          <h2><Bell :size="18" />轻轻提醒</h2>
          <div class="setting-row slider-row"><div><label for="sensitivity">提醒灵敏度</label><p>从宽松开始，按体验慢慢调整</p></div><div class="range-control"><input id="sensitivity" type="range" min="0.6" max="1.6" step="0.1" :value="store.settings.sensitivity" @change="number('sensitivity', $event)" /><span>{{ store.settings.sensitivity < 0.9 ? '宽松' : store.settings.sensitivity > 1.2 ? '敏感' : '适中' }}</span></div></div>
          <div class="setting-row"><div><label for="hold">持续多久再提醒</label><p>给捡笔、喝水和短暂动作留一点余地</p></div><div class="number-control"><input id="hold" type="number" min="2" max="20" :value="store.settings.holdSeconds" @change="number('holdSeconds', $event)" /><span>秒</span></div></div>
          <div class="setting-row"><div><label for="cooldown">两次提醒的间隔</label><p>持续偏离时也不会频繁打断</p></div><div class="number-control"><input id="cooldown" type="number" min="15" max="300" step="15" :value="store.settings.cooldownSeconds" @change="number('cooldownSeconds', $event)" /><span>秒</span></div></div>
          <div class="setting-row"><div><strong>声音提示</strong><p>可调整音量与响铃次数，默认关闭</p></div><AppSwitch :model-value="store.settings.soundEnabled" label="声音提示" @update:model-value="store.updateSettings({ soundEnabled: $event })" /></div>
          <div class="setting-row"><div><label for="sound-volume">提示音量</label><p>试听后按环境调整；同时检查系统音量</p></div><div class="range-control"><input id="sound-volume" type="range" min="0" max="100" step="5" :value="store.settings.soundVolume" @input="number('soundVolume', $event)" /><span>{{ store.settings.soundVolume }}%</span></div></div>
          <div class="setting-row"><div><label for="sound-repeats">每次响铃</label><p>增加响铃次数，让提醒更容易听到</p></div><select id="sound-repeats" :value="store.settings.soundRepeats" @change="number('soundRepeats', $event)"><option :value="1">1 声</option><option :value="2">2 声</option><option :value="3">3 声</option></select></div>
          <div class="setting-row"><div><strong>试听提示音</strong><p>按当前音量和次数试听，不改变声音开关</p></div><button class="small-button" @click="store.previewSound">试听</button></div>
          <div v-if="!store.desktopRuntime" class="setting-row"><div><strong>浏览器通知</strong><p>{{ notificationSupported ? store.settings.notificationsEnabled ? '浏览器通知已开启' : '由你决定是否允许通知' : '此浏览器使用页面内提醒' }}</p></div><button class="small-button" :disabled="!notificationSupported" @click="store.settings.notificationsEnabled ? store.updateSettings({ notificationsEnabled: false }) : store.requestNotifications()">{{ store.settings.notificationsEnabled ? '关闭通知' : '允许通知' }}</button></div>
          <div v-if="store.desktopRuntime" class="setting-row"><div><strong>桌面通知</strong><p>缩小到托盘后也可收到；可先发送测试通知</p></div><button class="small-button" @click="testDesktopNotification">测试通知</button></div>
          <div class="setting-row"><div><strong>全屏休息引导（坐直自动恢复）</strong><p>持续偏离时唤起休息画面（桌面版自动置顶全屏），坐姿恢复后自动退去</p></div><AppSwitch :model-value="store.settings.focusReminder" label="全屏休息引导（坐直自动恢复）" @update:model-value="store.updateSettings({ focusReminder: $event })" /></div>
        </section>

        <section id="settings-rest" class="settings-panel">
          <h2><Bell :size="18" />休息与护眼</h2>
          <div class="setting-row"><div><strong>番茄钟模式</strong><p>在监测页显示番茄钟计时器，休息阶段自动暂停姿态打扰</p></div><AppSwitch :model-value="store.settings.pomodoroEnabled" label="番茄钟模式" @update:model-value="store.updateSettings({ pomodoroEnabled: $event })" /></div>
          <div v-if="store.settings.pomodoroEnabled" class="setting-row"><div><label for="pomodoro-focus">番茄专注时长</label><p>单轮专注倒计时</p></div><div class="number-control"><input id="pomodoro-focus" type="number" min="1" max="90" step="5" :value="store.settings.pomodoroFocusMinutes" @change="number('pomodoroFocusMinutes', $event)" /><span>分钟</span></div></div>
          <div v-if="store.settings.pomodoroEnabled" class="setting-row"><div><label for="pomodoro-short">短休息时长</label><p>每轮专注后的短暂放松</p></div><div class="number-control"><input id="pomodoro-short" type="number" min="1" max="30" step="1" :value="store.settings.pomodoroShortBreakMinutes" @change="number('pomodoroShortBreakMinutes', $event)" /><span>分钟</span></div></div>
          <div v-if="store.settings.pomodoroEnabled" class="setting-row"><div><label for="pomodoro-long">长休息时长</label><p>完成多轮番茄后的长休息</p></div><div class="number-control"><input id="pomodoro-long" type="number" min="5" max="60" step="5" :value="store.settings.pomodoroLongBreakMinutes" @change="number('pomodoroLongBreakMinutes', $event)" /><span>分钟</span></div></div>
          <div v-if="store.settings.pomodoroEnabled" class="setting-row"><div><label for="pomodoro-interval">长休息周期</label><p>每完成几轮专注进入一次长休息</p></div><div class="number-control"><input id="pomodoro-interval" type="number" min="2" max="8" step="1" :value="store.settings.pomodoroLongInterval" @change="number('pomodoroLongInterval', $event)" /><span>轮</span></div></div>
          <div v-if="store.settings.pomodoroEnabled" class="setting-row"><div><strong>专注结束自动开始休息</strong><p>倒计时结束后自动进入休息计时</p></div><AppSwitch :model-value="store.settings.pomodoroAutoStartBreak" label="专注结束自动开始休息" @update:model-value="store.updateSettings({ pomodoroAutoStartBreak: $event })" /></div>
          <div v-if="store.settings.pomodoroEnabled" class="setting-row"><div><strong>休息结束自动开始专注</strong><p>关闭时等待你手动开启下一轮专注</p></div><AppSwitch :model-value="store.settings.pomodoroAutoStartFocus" label="休息结束自动开始专注" @update:model-value="store.updateSettings({ pomodoroAutoStartFocus: $event })" /></div>
          <div class="setting-row"><div><strong>久坐提醒</strong><p>按可靠识别的在座时间累计，离座后重新开始</p></div><AppSwitch :model-value="store.settings.breakEnabled" label="久坐提醒" @update:model-value="store.updateSettings({ breakEnabled: $event })" /></div>
          <div class="setting-row"><div><label for="sit">专注一段时间后休息</label><p>暂停和看不清的时段不会累加</p></div><div class="number-control"><input id="sit" type="number" min="10" max="120" step="5" :disabled="!store.settings.breakEnabled" :value="store.settings.sitMinutes" @change="number('sitMinutes', $event)" /><span>分钟</span></div></div>
          <div class="setting-row"><div><label for="rest">休息倒计时</label><p>你可以提前返回监测</p></div><div class="number-control"><input id="rest" type="number" min="20" max="300" step="10" :value="store.settings.restSeconds" @change="number('restSeconds', $event)" /><span>秒</span></div></div>
          <div class="setting-row"><div><strong>眨眼参考与护眼提醒</strong><p>需正面看清双眼；侧面可能不可用。切换会结束当前监测</p></div><AppSwitch :model-value="store.settings.blinkEnabled" label="眨眼参考与护眼提醒" @update:model-value="store.updateSettings({ blinkEnabled: $event })" /></div>
          <div class="setting-row"><div><strong>眨眼偏少自动开启护眼暖光</strong><p>检测到眨眼频率过低时，自动开启柔和暖色滤镜减轻视觉疲劳</p></div><AppSwitch :model-value="store.settings.eyeCareAuto" label="眨眼偏少自动开启护眼暖光" @update:model-value="store.updateSettings({ eyeCareAuto: $event })" /></div>
          <div class="setting-row"><div><strong>柔和护眼暖光滤镜</strong><p>当前状态：{{ store.eyeCareActive ? '已开启暖光保护' : '未开启' }}</p></div><button class="small-button" @click="store.toggleEyeCare()">{{ store.eyeCareActive ? '关闭护眼暖光' : '立即开启护眼' }}</button></div>
          <p v-if="store.settings.blinkEnabled" class="blink-diagnostics" role="status">{{ store.blinkAvailable ? store.phase === 'monitoring' ? store.blinkStatus : '开始监测并完成校准后统计' : '人脸模型将在开始真实监测时加载' }}<br />已识别 {{ store.blinkCount }} 次 · 最近一分钟有效观察 {{ store.blinkObservedSeconds }} 秒</p>
        </section>

        <section id="settings-data" class="settings-panel">
          <h2><ShieldCheck :size="18" />记录属于你</h2>
          <p class="privacy-copy">摄像头画面与逐帧关键点不保存、不上传。这里只保留参考参数、监测状态区间与提醒记录。</p>
          <div class="backup-actions">
            <button class="button button-outline" @click="store.exportBackup"><Download :size="16" />导出备份</button>
            <button class="button button-outline" :disabled="importing" @click="file?.click()"><Upload :size="16" />{{ importing ? '导入中…' : '导入备份' }}</button>
            <button class="button button-outline" @click="store.exportEvaluationReport"><Download :size="16" />导出算法鲁棒性评测报告</button>
            <input ref="file" class="sr-only" type="file" accept=".json,application/json" @change="importFile" />
          </div>
          <button class="setting-link danger-link" @click="confirm = 'history'"><Trash2 :size="16" />清除监测历史<span>{{ store.sessions.length }} 段</span><ChevronRight :size="15" /></button>
          <button class="setting-link" @click="confirm = 'defaults'">恢复默认设置<ChevronRight :size="15" /></button>
        </section>
      </div>
    </div>
    <AppDialog :open="!!confirm" :title="confirm === 'history' ? '清除监测历史？' : confirm === 'calibration' ? '清除参考坐姿？' : '恢复默认设置？'" :description="confirm === 'history' ? '当前监测会结束。此操作会删除本设备上的真实历史，建议先导出备份。' : confirm === 'calibration' ? '当前监测会结束。之后需要重新建立参考坐姿。' : '提醒与摄像头设置会恢复初始值，历史记录会保留。'" @update:open="confirm = null">
      <div class="dialog-actions"><button class="button button-outline" @click="confirm = null">取消</button><button class="button" :class="confirm === 'history' ? 'button-danger' : 'button-primary'" @click="confirmAction">确认</button></div>
    </AppDialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, h } from 'vue'
const LeafIllustration = defineComponent({
  setup: () => () => h('svg', { viewBox: '0 0 110 150', fill: 'none', width: 78, height: 106, 'aria-hidden': 'true' }, [
    h('path', { d: 'M55 140V42M55 94Q9 92 16 53Q55 51 55 94M55 71Q95 70 91 31Q54 28 55 71M55 45Q34 26 55 7Q75 25 55 45', stroke: '#849375', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ]),
})
export default { components: { LeafIllustration } }
</script>
