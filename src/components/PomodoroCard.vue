<script setup lang="ts">
import { computed } from 'vue'
import { Play, Pause, RotateCcw, SkipForward, Timer, Coffee } from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'
import { clock } from '@/lib/format'
import { POMODORO_PHASE_LABELS, pomodoroProgress, type PomodoroPhase } from '@/domain/pomodoro'

const store = useMonitorStore()

const phases = computed<Array<{ id: PomodoroPhase; label: string; minutes: number }>>(() => [
  { id: 'focus', label: '专注', minutes: store.settings.pomodoroFocusMinutes },
  { id: 'short_break', label: '短休', minutes: store.settings.pomodoroShortBreakMinutes },
  { id: 'long_break', label: '长休', minutes: store.settings.pomodoroLongBreakMinutes },
])

const displayTime = computed(() => clock(Math.ceil(store.pomodoro.remainingSeconds)))
const progress = computed(() => pomodoroProgress(store.pomodoro))
const phaseLabel = computed(() => POMODORO_PHASE_LABELS[store.pomodoro.phase])
const isBreak = computed(() => store.pomodoro.phase !== 'focus')
const isRunning = computed(() => store.pomodoro.status === 'running')
</script>

<template>
  <section class="pomodoro-card" :class="{ 'is-break': isBreak, 'is-running': isRunning }" aria-label="番茄钟模式">
    <div class="pomodoro-main">
      <div class="pomodoro-meta">
        <div class="pomodoro-title-row">
          <span class="pomodoro-badge">
            <Coffee v-if="isBreak" :size="13" />
            <Timer v-else :size="13" />
            番茄钟 · {{ phaseLabel }}
          </span>
          <span class="pomodoro-count">已完成 {{ store.pomodoro.completedCount }} 个番茄</span>
        </div>
        <div class="pomodoro-tabs" role="group" aria-label="番茄钟阶段">
          <button
            v-for="item in phases"
            :key="item.id"
            type="button"
            class="pomodoro-tab"
            :class="{ active: store.pomodoro.phase === item.id }"
            :aria-pressed="store.pomodoro.phase === item.id"
            :disabled="isRunning"
            @click="store.choosePomodoroPhase(item.id)"
          >
            {{ item.label }} · {{ item.minutes }}分
          </button>
        </div>
        <p class="pomodoro-hint">
          <template v-if="store.pomodoroOnBreak && store.running">
            休息计时中，已自动暂停姿态与久坐打扰，放心舒展一下。
          </template>
          <template v-else-if="isBreak">
            起身走动或远眺一会，第 {{ store.pomodoro.cycleCount }}/{{ store.settings.pomodoroLongInterval }} 轮后进入长休息。
          </template>
          <template v-else>
            可独立计时，也可配合姿态监测使用；每 {{ store.settings.pomodoroLongInterval }} 轮专注自动进入长休息。
          </template>
        </p>
      </div>

      <div class="pomodoro-timer-block">
        <strong class="pomodoro-clock" aria-live="off">{{ displayTime }}</strong>
        <div class="pomodoro-actions">
          <button
            v-if="!isRunning"
            type="button"
            class="button button-primary pomodoro-primary-btn"
            @click="store.startPomodoro()"
          >
            <Play :size="14" />
            {{ store.pomodoro.status === 'paused' ? '继续' : isBreak ? '开始休息' : '开始专注' }}
          </button>
          <button
            v-else
            type="button"
            class="button button-outline pomodoro-primary-btn"
            @click="store.pausePomodoro()"
          >
            <Pause :size="14" />
            暂停
          </button>
          <button
            type="button"
            class="small-button pomodoro-icon-btn"
            title="跳到下一阶段"
            aria-label="跳到下一阶段"
            @click="store.skipPomodoro()"
          >
            <SkipForward :size="14" />
            跳过
          </button>
          <button
            type="button"
            class="small-button pomodoro-icon-btn"
            title="重置当前阶段"
            aria-label="重置当前阶段"
            @click="store.resetPomodoro()"
          >
            <RotateCcw :size="14" />
            重置
          </button>
        </div>
      </div>
    </div>
    <div class="pomodoro-progress-track" aria-hidden="true">
      <div class="pomodoro-progress-fill" :style="{ width: progress + '%' }" />
    </div>
  </section>
</template>
