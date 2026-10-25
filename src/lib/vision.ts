import type { VisionFrame, VisionReply } from '@/domain/types'

export class VisionCamera {
  stream: MediaStream | null = null
  video: HTMLVideoElement | null = null
  private worker: Worker | null = null
  private fallbackVideo: HTMLVideoElement | null = null
  private timer: number | null = null
  private busy = false
  private closed = false
  private lastVideoTime = -1
  private rejectReady: ((reason: Error) => void) | null = null

  constructor(
    private onFrame: (frame: VisionFrame) => void,
    private onError: (message: string) => void,
    private getPreviewVideo: () => HTMLVideoElement | null,
  ) {}

  async open(cameraId: string, facingMode: 'user' | 'environment', blink: boolean, fps: number): Promise<{ delegate: string; blink: boolean; warning?: string; cameraId: string }> {
    this.closed = false
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('摄像头需要 localhost 或 HTTPS。请通过本地启动地址打开。')
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('当前浏览器缺少识别所需能力，请使用新版 Chrome 或 Edge。')
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: facingMode } }) },
    })
    if (this.closed) { this.stream.getTracks().forEach((t) => t.stop()); throw new Error('已取消启动。') }
    this.video = this.getPreviewVideo()
    if (!this.video) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
      throw new Error('摄像头预览还未准备好，请返回监测页后重试。')
    }
    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = this.stream
    await this.video.play().catch(() => {
      throw new Error('无法播放摄像头画面。请确认浏览器允许自动播放媒体，然后重试。')
    })
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
    if (this.closed || this.busy || !this.worker || !this.stream) return
    this.busy = true
    try {
      const preview = this.getPreviewVideo()
      let source = preview?.srcObject === this.stream ? preview : null
      if (!source) {
        // Route changes unmount the visible preview. Keep capture alive independently.
        if (!this.fallbackVideo) {
          const fallback = document.createElement('video')
          fallback.muted = true
          fallback.playsInline = true
          fallback.className = 'capture-source'
          fallback.setAttribute('aria-hidden', 'true')
          fallback.srcObject = this.stream
          document.body.append(fallback)
          this.fallbackVideo = fallback
        }
        source = this.fallbackVideo
        if (source.paused) await source.play()
      }
      if (this.closed || !this.worker) { this.busy = false; return }
      if (this.video !== source) { this.video = source; this.lastVideoTime = -1 }
      if (source.readyState < 2 || source.currentTime === this.lastVideoTime) { this.busy = false; return }
      this.lastVideoTime = source.currentTime
      const timestamp = performance.now()
      const bitmap = await createImageBitmap(source)
      if (this.closed || !this.worker) { bitmap.close(); this.busy = false; return }
      this.worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap])
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
    const ownedStream = this.stream
    ownedStream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    for (const video of new Set([this.video, this.fallbackVideo])) {
      // A cancelled startup must not detach a newer session sharing the preview element.
      if (video && ownedStream && video.srcObject === ownedStream) { video.pause(); video.srcObject = null }
    }
    this.fallbackVideo?.remove()
    this.fallbackVideo = null
    this.stream = null
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

