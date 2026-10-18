// Provider credentials at rest: AES-256-GCM, fresh 12-byte nonce per encryption,
// stored as nonce(12) || tag(16) || ciphertext in a bytea column.
// Never log plaintext or the key; never send either to the browser.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const NONCE_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY is not set')
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)')
  return k
}

export function encrypt(text: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

export function decrypt(buf: Buffer): string {
  if (buf.length <= NONCE_BYTES + TAG_BYTES) throw new Error('Encrypted value is too short')
  const nonce = buf.subarray(0, NONCE_BYTES)
  const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key(), nonce)
  decipher.setAuthTag(tag) // tampered data fails here instead of returning garbage
  return Buffer.concat([decipher.update(buf.subarray(NONCE_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
}

/** For the UI: show only the last 4 characters of a secret. */
export function mask(secret: string): string {
  return secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`
}

/** Convenience for JSON credential bundles (e.g. Twilio SID + token). */
export const encryptJson = (value: unknown) => encrypt(JSON.stringify(value))
export const decryptJson = <T = unknown>(buf: Buffer): T => JSON.parse(decrypt(buf))
