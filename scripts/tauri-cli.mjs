import { existsSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { withRustEnv } from './cargo-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const binName = process.platform === 'win32' ? 'tauri.cmd' : 'tauri'
const localTauriBin = path.join(root, 'node_modules', '.bin', binName)

if (!existsSync(localTauriBin)) {
  console.error('Missing @tauri-apps/cli binary in node_modules/.bin. Run `npm install` first.')
  process.exit(1)
}

if (process.platform === 'win32' && args[0] === 'build') {
  const releaseDir = path.join(root, 'src-tauri', 'target', 'release')
  if (existsSync(releaseDir)) {
    for (const entry of readdirSync(releaseDir)) {
      if (/^pinease\.exe\.old\./i.test(entry)) {
        try {
          unlinkSync(path.join(releaseDir, entry))
        } catch {
          // ignore still-locked old executable
        }
      }
    }
    const exePath = path.join(releaseDir, 'PinEase.exe')
    if (existsSync(exePath)) {
      try {
        unlinkSync(exePath)
      } catch {
        try {
          renameSync(exePath, `${exePath}.old.${Date.now()}`)
        } catch {
          // ignore if rename fails
        }
      }
    }
  }
}

const result = spawnSync(localTauriBin, args, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: withRustEnv(process.env),
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 0)
