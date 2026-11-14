import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const commands = new Set(['pause', 'resume', 'quit'])

export function installDesktopBridge(): boolean {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false
  if (window.pineaseDesktop?.isDesktop) return true

  // Prevent Edge WebView2 from aggressively throttling background timers when minimized to tray.
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    void navigator.locks.request('pinease-desktop-keepalive', () => new Promise(() => {})).catch(() => {})
  }

  window.pineaseDesktop = Object.freeze({
    isDesktop: true as const,
    windowControls: true,
    onCommand(callback: (command: 'pause' | 'resume' | 'quit') => void) {
      if (typeof callback !== 'function') return () => {}
      let active = true
      let unlistenFn: (() => void) | null = null
      void listen<string>('desktop:command', (event) => {
        const command = event.payload
        if (active && (command === 'pause' || command === 'resume' || command === 'quit') && commands.has(command)) {
          callback(command)
        }
      }).then((fn) => {
        if (active) unlistenFn = fn
        else fn()
      }).catch(() => {})
      return () => {
        active = false
        unlistenFn?.()
        unlistenFn = null
      }
    },
    setState(state: 'idle' | 'running' | 'paused') {
      if (state === 'idle' || state === 'running' || state === 'paused') {
        void invoke('desktop_set_state', { stateName: state }).catch(() => {})
      }
    },
    setTheme(theme: 'light' | 'dark') {
      if (theme === 'light' || theme === 'dark') {
        void invoke('desktop_set_theme', { theme }).catch(() => {})
      }
    },
    async notify(title: string, body: string) {
      if (typeof title !== 'string' || typeof body !== 'string') return false
      try { return await invoke<boolean>('desktop_notify', { title, body }) } catch { return false }
    },
    async notificationAvailable() {
      try { return await invoke<boolean>('desktop_notification_available') } catch { return false }
    },
    async setRestOverlay(active: boolean) {
      try { return await invoke<boolean>('desktop_set_rest_overlay', { active: Boolean(active) }) } catch { return false }
    },
    readyToQuit() {
      void invoke('desktop_ready_to_quit').catch(() => {})
    },
    minimizeWindow() {
      void invoke('desktop_window_action', { action: 'minimize' }).catch(() => {})
    },
    toggleMaximizeWindow() {
      void invoke('desktop_window_action', { action: 'toggle_maximize' }).catch(() => {})
    },
    closeWindow() {
      void invoke('desktop_window_action', { action: 'hide' }).catch(() => {})
    },
  })
  return true
}

installDesktopBridge()
