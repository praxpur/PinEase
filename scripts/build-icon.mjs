import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(path.join(root, 'public', 'icon.svg'))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map((size) =>
  sharp(source, { density: 384 }).resize(size, size).png().toBuffer(),
))

const headerSize = 6 + sizes.length * 16
const icon = Buffer.alloc(headerSize + images.reduce((sum, image) => sum + image.length, 0))
icon.writeUInt16LE(1, 2)
icon.writeUInt16LE(sizes.length, 4)

let offset = headerSize
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16
  const image = images[index]
  icon.writeUInt8(size === 256 ? 0 : size, entry)
  icon.writeUInt8(size === 256 ? 0 : size, entry + 1)
  icon.writeUInt16LE(1, entry + 4)
  icon.writeUInt16LE(32, entry + 6)
  icon.writeUInt32LE(image.length, entry + 8)
  icon.writeUInt32LE(offset, entry + 12)
  image.copy(icon, offset)
  offset += image.length
}

await writeFile(path.join(root, 'public', 'favicon.ico'), icon)
console.log(`Updated public/favicon.ico from public/icon.svg (${sizes.join(', ')}px)`)
