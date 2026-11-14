/// <reference types="vite/client" />
export {}

declare global {
  interface Window {
    pineaseDesktop?: {
      readonly isDesktop: true
      readonly windowControls?: boolean
      onCommand: (callback: (command: 'pause' | 'resume' | 'quit') => void) => () => void
      setState: (state: 'idle' | 'running' | 'paused') => void
      setTheme: (theme: 'light' | 'dark') => void
      notify: (title: string, body: string) => Promise<boolean>
      notificationAvailable: () => Promise<boolean>
      setRestOverlay?: (active: boolean) => Promise<boolean>
      readyToQuit: () => void
      minimizeWindow?: () => void
      toggleMaximizeWindow?: () => void
      closeWindow?: () => void
    }
  }
}
