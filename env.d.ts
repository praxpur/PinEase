/// <reference types="vite/client" />
export {}

declare global {
  interface Window {
    pineaseDesktop?: {
      readonly isDesktop: true
      onCommand: (callback: (command: 'pause' | 'resume' | 'quit') => void) => () => void
      setState: (state: 'idle' | 'running' | 'paused') => void
      readyToQuit: () => void
    }
  }
}
