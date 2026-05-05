import { deflateSync } from 'node:zlib'
import { Buffer } from 'node:buffer'

const PROFILE_PALETTE = [
  '#1a73e8',
  '#d93025',
  '#188038',
  '#9334e6',
  '#0b8043',
  '#1967d2',
  '#a142f4',
  '#e8710a',
  '#137333',
  '#7627bb',
  '#c5221f',
  '#0d652d',
] as const

export function colorForProfile(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0
  return PROFILE_PALETTE[Math.abs(h) % PROFILE_PALETTE.length]
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return [26, 115, 232]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)

  const stride = width * 4
  const filtered = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    filtered.writeUInt8(0, y * (stride + 1))
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(filtered, { level: 9 })

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function drawRoundedSquare(size: number, color: [number, number, number]): Buffer {
  const radius = Math.floor(size * 0.22)
  const buf = Buffer.alloc(size * size * 4)
  const right = size - 1
  const bottom = size - 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      let dx = 0
      let dy = 0
      if (x < radius) dx = radius - x - 0.5
      else if (x > right - radius) dx = x - (right - radius) - 0.5
      if (y < radius) dy = radius - y - 0.5
      else if (y > bottom - radius) dy = y - (bottom - radius) - 0.5
      const d = Math.sqrt(dx * dx + dy * dy)
      let alpha: number
      if (d <= radius - 1) alpha = 255
      else if (d >= radius) alpha = 0
      else alpha = Math.round((radius - d) * 255)
      buf[i] = color[0]
      buf[i + 1] = color[1]
      buf[i + 2] = color[2]
      buf[i + 3] = alpha
    }
  }
  return buf
}

function pngsToIco(pngs: Buffer[]): Buffer {
  const headerSize = 6
  const entrySize = 16
  const dirSize = headerSize + entrySize * pngs.length

  let offset = dirSize
  const offsets: number[] = []
  for (const png of pngs) {
    offsets.push(offset)
    offset += png.length
  }

  const ico = Buffer.alloc(offset)
  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(pngs.length, 4)

  for (let i = 0; i < pngs.length; i++) {
    const png = pngs[i]
    const w = png.readUInt32BE(16)
    const h = png.readUInt32BE(20)
    const e = headerSize + entrySize * i
    ico.writeUInt8(w >= 256 ? 0 : w, e)
    ico.writeUInt8(h >= 256 ? 0 : h, e + 1)
    ico.writeUInt8(0, e + 2)
    ico.writeUInt8(0, e + 3)
    ico.writeUInt16LE(1, e + 4)
    ico.writeUInt16LE(32, e + 6)
    ico.writeUInt32LE(png.length, e + 8)
    ico.writeUInt32LE(offsets[i], e + 12)
    png.copy(ico, offsets[i])
  }

  return ico
}

export function buildProfileIco(colorHex: string): Buffer {
  const color = hexToRgb(colorHex)
  const sizes = [16, 32, 48, 64, 128, 256]
  const pngs = sizes.map((s) => encodePng(s, s, drawRoundedSquare(s, color)))
  return pngsToIco(pngs)
}
