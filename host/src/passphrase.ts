import { pbkdf2Sync, randomBytes } from 'node:crypto'

export const hashPassphrase = (passphrase: string, roomCode: string): string => {
  const salt = `space-arenas:${roomCode}`
  return pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256').toString('hex')
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const newRoomCode = (): string => {
  let out = ''
  const bytes = randomBytes(4)
  for (let i = 0; i < 4; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length]
  return out
}

export const newSeed = (): number => randomBytes(4).readUInt32LE(0)
