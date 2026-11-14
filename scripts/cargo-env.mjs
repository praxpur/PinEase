import { existsSync } from 'node:fs'
import path from 'node:path'

export function withRustEnv(baseEnv = process.env) {
  const env = { ...baseEnv }
  const fallbackCargoHome = 'D:\\Codes\\Projects\\readest\\.build-tools\\cargo'
  const fallbackRustupHome = 'D:\\Codes\\Projects\\readest\\.build-tools\\rustup'

  if (!env.CARGO_HOME && existsSync(path.join(fallbackCargoHome, 'bin', 'cargo.exe'))) {
    env.CARGO_HOME = fallbackCargoHome
  }
  if (!env.RUSTUP_HOME && existsSync(fallbackRustupHome)) {
    env.RUSTUP_HOME = fallbackRustupHome
  }

  const cargoBin = env.CARGO_HOME ? path.join(env.CARGO_HOME, 'bin') : ''
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
  if (cargoBin && existsSync(cargoBin)) {
    const segments = (env[pathKey] || '').split(path.delimiter).filter(Boolean)
    if (!segments.some((item) => item.toLowerCase() === cargoBin.toLowerCase())) {
      env[pathKey] = `${cargoBin}${path.delimiter}${env[pathKey] || ''}`
    }
  }
  return env
}
