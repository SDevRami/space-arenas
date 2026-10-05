import QRCode from 'qrcode'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const INVITES_DIR = join(process.cwd(), 'invites')

const SIZE = 320
const MARGIN = 2
const ECL: QRCode.QRCodeErrorCorrectionLevel = 'M'

let cache: { code: string; png: Buffer } | null = null

export const inviteUrl = (code: string, passphrase: string, ip: string, port: number): string => {
  const params = new URLSearchParams({ code })
  if (passphrase) params.set('pass', passphrase)
  return `http://${ip}:${port}/?${params.toString()}`
}

export const refreshInviteQr = async (code: string, passphrase: string, ip: string, port: number): Promise<void> => {
  const url = inviteUrl(code, passphrase, ip, port)
  const png = await QRCode.toBuffer(url, { width: SIZE, margin: MARGIN, errorCorrectionLevel: ECL })
  cache = { code, png }
  try {
    mkdirSync(INVITES_DIR, { recursive: true })
    writeFileSync(join(INVITES_DIR, `invite-${code}.png`), png)
  } catch {
    /* invites folder unwritable — in-memory serve still works */
  }
}

export const inviteQrPng = (code: string): Buffer | null => {
  if (cache && cache.code === code) return cache.png
  return null
}
