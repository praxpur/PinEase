import { copyFile, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const wasmSource = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const wasmTarget = join(root, 'public', 'wasm')
const modelTarget = join(root, 'public', 'models')
await mkdir(wasmTarget, { recursive: true })
await mkdir(modelTarget, { recursive: true })
for (const name of await readdir(wasmSource)) {
  if (name.endsWith('.js') || name.endsWith('.wasm')) await copyFile(join(wasmSource, name), join(wasmTarget, name))
}

const models = [
  { name: 'pose_landmarker_lite.task', url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
  { name: 'face_landmarker.task', url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
]
const manifest = []
for (const model of models) {
  const target = join(modelTarget, model.name)
  let existing = false
  try { existing = (await stat(target)).size > 100000 } catch { /* 首次下载 */ }
  if (!existing) {
    let downloaded = false
    for (let attempt = 0; attempt < 3 && !downloaded; attempt++) {
      try {
        const response = await fetch(model.url, { signal: AbortSignal.timeout(90000) })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length < 100000 || buffer.subarray(0, 50).toString().toLowerCase().includes('<html')) throw new Error('下载内容不是有效的模型文件')
        await writeFile(target, buffer)
        downloaded = true
      } catch (error) {
        if (attempt === 2) throw new Error(model.name + ' 下载失败：' + error.message)
      }
    }
  }
  const buffer = await readFile(target)
  manifest.push({ file: model.name, source: model.url, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') })
  process.stdout.write(model.name + ' · ' + (buffer.length / 1024 / 1024).toFixed(1) + ' MB\n')
}
await writeFile(join(modelTarget, 'sources.json'), JSON.stringify({ package: '@mediapipe/tasks-vision', models: manifest }, null, 2))
process.stdout.write('本地识别资源已准备完成。\n')

