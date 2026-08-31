const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0

function sha256(data: Uint8Array): Uint8Array {
  const bitLenLo = data.length * 8
  const padLen = (((data.length + 8) >>> 6) << 6) + 64
  const m = new Uint8Array(padLen)
  m.set(data)
  m[data.length] = 0x80
  for (let i = 0; i < 8; i++) m[padLen - 1 - i] = Math.floor(bitLenLo / 2 ** (8 * i)) % 256

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      w[i] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + SHA256_K[i] + w[i]) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff
    out[i * 4 + 3] = h[i] & 0xff
  }
  return out
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key
  if (k.length > 64) k = sha256(k)
  const oKey = new Uint8Array(64)
  const iKey = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    const kb = i < k.length ? k[i] : 0
    oKey[i] = kb ^ 0x5c
    iKey[i] = kb ^ 0x36
  }
  const inner = new Uint8Array(64 + message.length)
  inner.set(iKey)
  inner.set(message, 64)
  const innerHash = sha256(inner)
  const outer = new Uint8Array(64 + innerHash.length)
  outer.set(oKey)
  outer.set(innerHash, 64)
  return sha256(outer)
}

export function pbkdf2Sha256Hex(passphrase: string, salt: string, iterations: number, keyLen: number): string {
  const enc = new TextEncoder()
  const password = enc.encode(passphrase)
  const saltBytes = enc.encode(salt)
  const hLen = 32
  const blocks = Math.ceil(keyLen / hLen)
  const out = new Uint8Array(blocks * hLen)
  for (let block = 1; block <= blocks; block++) {
    const blockBytes = new Uint8Array(4)
    blockBytes[0] = (block >>> 24) & 0xff
    blockBytes[1] = (block >>> 16) & 0xff
    blockBytes[2] = (block >>> 8) & 0xff
    blockBytes[3] = block & 0xff
    const saltInt = new Uint8Array(saltBytes.length + 4)
    saltInt.set(saltBytes)
    saltInt.set(blockBytes, saltBytes.length)
    let u = hmacSha256(password, saltInt)
    const t = u.slice()
    for (let i = 1; i < iterations; i++) {
      u = hmacSha256(password, u)
      for (let j = 0; j < hLen; j++) t[j] ^= u[j]
    }
    out.set(t, (block - 1) * hLen)
  }
  let hex = ''
  for (let i = 0; i < keyLen; i++) hex += out[i].toString(16).padStart(2, '0')
  return hex
}
