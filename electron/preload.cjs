const { contextBridge, ipcRenderer } = require('electron')

const commands = new Set(['pause', 'resume', 'quit'])

contextBridge.exposeInMainWorld('pineaseDesktop', Object.freeze({
  isDesktop: true,
  onCommand(callback) {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, command) => {
      if (commands.has(command)) callback(command)
    }
    ipcRenderer.on('desktop:command', listener)
    return () => ipcRenderer.removeListener('desktop:command', listener)
  },
  setState(state) {
    if (state === 'idle' || state === 'running' || state === 'paused') ipcRenderer.send('desktop:state', state)
  },
  setTheme(theme) {
    if (theme === 'light' || theme === 'dark') ipcRenderer.send('desktop:theme', theme)
  },
  notify(title, body) {
    if (typeof title !== 'string' || typeof body !== 'string') return Promise.resolve(false)
    return ipcRenderer.invoke('desktop:notify', title, body)
  },
  notificationAvailable() {
    return ipcRenderer.invoke('desktop:notification-available')
  },
  setRestOverlay(active) {
    return ipcRenderer.invoke('desktop:rest-overlay', Boolean(active))
  },
  readyToQuit() {
    ipcRenderer.send('desktop:quit-ready')
  },
}))
