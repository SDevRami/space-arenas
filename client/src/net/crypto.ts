// Phase 3: client-side encryption for cloud backups (Web Crypto, zero deps).
// The passphrase never leaves the device: we derive an AES-GCM key via PBKDF2 and ship only
// the ciphertext (+ salt/IV). The server gets a sha-256 of the passphrase so it can reject
// wrong-passphrase restores without ever seeing the blobs.

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PBKDF2_ITERATIONS = 150_000
const SALT_BYTES = 16
const IV_BYTES = 12

const deriveKey = (passphrase: string, salt: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle
    .importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      ),
    )

/** sha-256 hex of the passphrase — the fingerprint sent to the server at upload/restore. */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Encrypts `payload` with the passphrase → base64(salt ‖ iv ‖ cipher). */
export const encryptPayload = async (payload: string, passphrase: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(payload)))
  const out = new Uint8Array(salt.byteLength + iv.byteLength + cipher.byteLength)
  out.set(salt, 0)
  out.set(iv, salt.byteLength)
  out.set(cipher, salt.byteLength + iv.byteLength)
  return btoa(String.fromCharCode(...out))
}

/** Decrypts a bundle from encryptPayload; throws on a wrong passphrase. */
export const decryptPayload = async (bundle: string, passphrase: string): Promise<string> => {
  const raw = Uint8Array.from(atob(bundle), (c) => c.charCodeAt(0))
  const salt = raw.slice(0, SALT_BYTES)
  const iv = raw.slice(SALT_BYTES, SALT_BYTES + IV_BYTES)
  const cipher = raw.slice(SALT_BYTES + IV_BYTES)
  const key = await deriveKey(passphrase, salt)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return decoder.decode(plain)
}