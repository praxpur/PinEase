import type { VisionFrame, VisionReply } from '@/domain/types'

export class VisionCamera {
  stream: MediaStream | null = null
  video: HTMLVideoElement | null = null
  private worker: Worker | null = null
  private timer: number | null = null
  private busy = false
  private closed = false
  private lastVideoTime = -1
  private rejectReady: ((reason: Error) => void) | null = null

  constructor(private onFrame: (frame: VisionFrame) => void, private onError: (message: string) => void) {}

  async open(cameraId: string, blink: boolean, fps: number): Promise<{ delegate: string; blink: boolean; warning?: string; cameraId: string }> {
    this.closed = false
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('摄像头需要 localhost 或 HTTPS。请通过本地启动地址打开。')
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('当前浏览器缺少识别所需能力，请使用新版 Chrome 或 Edge。')
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: 'user' }) },
    })
    if (this.closed) { this.stream.getTracks().forEach((t) => t.stop()); throw new Error('已取消启动。') }
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.className = 'capture-source'
    this.video.setAttribute('aria-hidden', 'true')
    this.video.srcObject = this.stream
    document.body.append(this.video)
    await this.video.play()
    const track = this.stream.getVideoTracks()[0]
    if (track) track.onended = () => { if (!this.closed) this.onError('摄像头已断开，请重新连接后开始。') }
    this.worker = new Worker(new URL('../workers/vision.worker.ts', import.meta.url), { type: 'module' })
    const result = await new Promise<{ delegate: string; blink: boolean; warning?: string }>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('模型加载超时，请检查本地模型文件。')), 60000)
      this.rejectReady = (error) => { clearTimeout(timeout); reject(error) }
      this.worker!.onerror = () => { clearTimeout(timeout); const message = '识别线程未能启动，请更新浏览器或重新打开页面。'; reject(new Error(message)); this.onError(message) }
      this.worker!.onmessage = (event: MessageEvent<VisionReply>) => {
        const data = event.data
        if (this.closed) return
        if (data.type === 'ready') { clearTimeout(timeout); this.rejectReady = null; resolve(data) }
        if (data.type === 'error') { clearTimeout(timeout); this.busy = false; reject(new Error(data.message)); this.onError(data.message) }
        if (data.type === 'frame') { this.busy = false; this.onFrame(data) }
      }
      const assets = new URL(import.meta.env.BASE_URL, window.location.href).href
      this.worker!.postMessage({ type: 'init', assets, blink })
    })
    if (this.closed) throw new Error('已取消启动。')
    this.timer = window.setInterval(() => { void this.capture() }, 1000 / Math.max(fps, blink ? 15 : 5))
    return { ...result, cameraId: track?.getSettings().deviceId ?? cameraId }
  }

  private async capture() {
    if (this.closed || this.busy || !this.video || !this.worker || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return
    this.busy = true
    this.lastVideoTime = this.video.currentTime
    try {
      const bitmap = await createImageBitmap(this.video)
      if (this.closed || !this.worker) { bitmap.close(); this.busy = false; return }
      this.worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap])
    } catch { this.busy = false }
  }

  close(): void {
    this.closed = true
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.rejectReady?.(new Error('已取消启动。'))
    this.rejectReady = null
    this.worker?.terminate()
    this.worker = null
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    this.stream = null
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove() }
    this.video = null
    this.busy = false
  }
}

export function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '摄像头权限未允许。请在地址栏的权限设置中允许后重试。'
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return '没有找到选定的摄像头。请在设置中重新选择。'
    if (error.name === 'NotReadableError') return '摄像头可能被其他应用占用，请关闭占用它的应用后重试。'
  }
  return error instanceof Error ? error.message : '暂时无法启动摄像头，请重试。'
}

