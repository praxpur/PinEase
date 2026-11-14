import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { withRustEnv } from './cargo-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const env = withRustEnv(process.env)
const cargoExe = env.CARGO_HOME ? path.join(env.CARGO_HOME, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo') : 'cargo'

const result = spawnSync(cargoExe, args, {
  cwd: path.join(root, 'src-tauri'),
  stdio: 'inherit',
  env,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 0)
