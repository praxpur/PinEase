const { app, BrowserWindow, Menu, Tray, nativeImage, net, powerMonitor, protocol, session, ipcMain } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { isTrustedUrl, canRequest, canCheck } = require('./permissions.cjs')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

const APP_URL = 'app://pinease/'
const developmentUrl = process.env.PINEASE_DEV_URL
const titleBarColors = {
  light: { color: '#f8f7f2', symbolColor: '#3b5337', height: 38 },
  dark: { color: '#273229', symbolColor: '#e0e8dc', height: 38 },
}
let windowRef = null
let trayRef = null
let appState = 'idle'
let allowQuit = false
let quitPending = false

if (!app.requestSingleInstanceLock()) app.quit()
app.setPath('userData', path.join(app.getPath('appData'), 'PinEase'))

function sendCommand(command) {
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('desktop:command', command)
}

function showWindow() {
  if (!windowRef || windowRef.isDestroyed()) return
  if (windowRef.isMinimized()) windowRef.restore()
  windowRef.show()
  windowRef.focus()
}

function updateTrayMenu() {
  if (!trayRef) return
  const running = appState === 'running'
  const paused = appState === 'paused'
  trayRef.setToolTip(`PinEase · ${running ? '正在监测' : paused ? '监测已暂停' : '待机'}`)
  trayRef.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: showWindow },
    { type: 'separator' },
    { label: '暂停监测', enabled: running, click: () => sendCommand('pause') },
    { label: '继续监测', enabled: paused, click: () => sendCommand('resume') },
    { type: 'separator' },
    { label: '退出 PinEase', click: () => app.quit() },
  ]))
}

async function registerAppProtocol() {
  const distRoot = path.resolve(app.getAppPath(), 'dist')
  protocol.handle('app', async (request) => {
    try {
      if (!isTrustedUrl(request.url)) return new Response('Forbidden', { status: 403 })
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
      const resource = path.resolve(distRoot, relative)
      if (resource !== distRoot && !resource.startsWith(distRoot + path.sep)) return new Response('Forbidden', { status: 403 })
      return await net.fetch(pathToFileURL(resource).href)
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors.light,
    icon: path.join(app.getAppPath(), 'dist', 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  windowRef.webContents.on('will-navigate', (event, target) => {
    if (!isTrustedUrl(target, developmentUrl)) event.preventDefault()
  })
  windowRef.on('ready-to-show', showWindow)
  windowRef.on('close', (event) => {
    if (!allowQuit) {
      event.preventDefault()
      windowRef.hide()
    }
  })
  windowRef.on('closed', () => { windowRef = null })
  if (developmentUrl) void windowRef.loadURL(developmentUrl)
  else void windowRef.loadURL(APP_URL)
}

function requestQuitAfterSave() {
  if (quitPending) return
  if (!windowRef || windowRef.isDestroyed()) {
    allowQuit = true
    app.quit()
    return
  }
  quitPending = true
  sendCommand('quit')
  setTimeout(() => {
    allowQuit = true
    app.quit()
  }, 8000).unref()
}

app.on('second-instance', showWindow)
app.on('before-quit', (event) => {
  if (allowQuit) return
  event.preventDefault()
  requestQuitAfterSave()
})

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('cn.pinease.desktop')
  await registerAppProtocol()
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = !!webContents && webContents === windowRef?.webContents && isTrustedUrl(webContents.getURL(), developmentUrl)
      && isTrustedUrl(details.requestingUrl || webContents.getURL(), developmentUrl)
    callback(trusted && canRequest(permission, details))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (webContents && webContents !== windowRef?.webContents) return false
    const source = details.requestingUrl || requestingOrigin
    return isTrustedUrl(source, developmentUrl) && canCheck(permission, details)
  })
  ipcMain.on('desktop:state', (event, state) => {
    if (event.sender !== windowRef?.webContents) return
    if (state === 'idle' || state === 'running' || state === 'paused') {
      appState = state
      updateTrayMenu()
    }
  })
  ipcMain.on('desktop:theme', (event, theme) => {
    if (event.sender !== windowRef?.webContents || !Object.hasOwn(titleBarColors, theme)) return
    windowRef.setTitleBarOverlay(titleBarColors[theme])
  })
  ipcMain.on('desktop:quit-ready', (event) => {
    if (event.sender !== windowRef?.webContents || !quitPending) return
    allowQuit = true
    app.quit()
  })
  createWindow()
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'dist', 'favicon.ico'))
  trayRef = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  trayRef.on('click', showWindow)
  updateTrayMenu()
  powerMonitor.on('suspend', () => sendCommand('pause'))
  powerMonitor.on('lock-screen', () => sendCommand('pause'))
  // Resume intentionally leaves the session paused until the user resumes it.
})

app.on('window-all-closed', () => {})
