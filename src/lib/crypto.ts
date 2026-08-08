export interface EncryptedSecrets {
  version: 1
  algorithm: 'AES-GCM'
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

const ITERATIONS = 310_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export class SecretDecryptionError extends Error {
  constructor() {
    super('同期用パスフレーズが違うか、暗号データが破損しています。')
    this.name = 'SecretDecryptionError'
  }
}

export async function encryptSecrets(
  secrets: Record<string, string>,
  passphrase: string
): Promise<EncryptedSecrets> {
  if (!passphrase) throw new Error('同期用パスフレーズを入力してください。')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(secrets))
  )
  return {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  }
}

function validatePayload(payload: EncryptedSecrets) {
  if (
    payload.version !== 1 ||
    payload.algorithm !== 'AES-GCM' ||
    payload.kdf !== 'PBKDF2-SHA-256' ||
    payload.iterations < 100_000
  ) {
    throw new SecretDecryptionError()
  }
}

export async function decryptSecrets(
  payload: EncryptedSecrets,
  passphrase: string
): Promise<Record<string, string>> {
  try {
    validatePayload(payload)
    const salt = base64ToBytes(payload.salt)
    const iv = base64ToBytes(payload.iv)
    const ciphertext = base64ToBytes(payload.ciphertext)
    const key = await deriveKey(passphrase, salt, payload.iterations)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    const parsed: unknown = JSON.parse(decoder.decode(plaintext))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SecretDecryptionError()
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  } catch (error) {
    if (error instanceof SecretDecryptionError) throw error
    throw new SecretDecryptionError()
  }
}
