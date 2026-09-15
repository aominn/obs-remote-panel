import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'

export const newSecret = () => randomBytes(32).toString('base64url')
export const digest = (value) => createHash('sha256').update(value).digest('hex')
export const validSecret = (value) => typeof value === 'string' && /^[\w-]{43}$/.test(value)
export function equalSecret(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false
  return timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(expected)))
}
export class Pairing {
  constructor({ records = [], save = () => {}, now = Date.now } = {}) {
    if (!Array.isArray(records) || records.length > 32 || records.some((r) =>
      typeof r.id !== 'string' || typeof r.name !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash) || typeof r.createdAt !== 'number')) {
      throw new Error('Invalid device registry; refusing to overwrite it')
    }
    this.records = records
    if (new Set(records.map((r) => r.id)).size !== records.length || new Set(records.map((r) => r.hash)).size !== records.length) throw new Error('Duplicate device records')
    this.save = save
    this.now = now
    this.pending = new Map()
    this.invite = null
  }
  clean() {
    for (const [id, request] of this.pending) if (request.expires <= this.now()) this.pending.delete(id)
  }
  issue() {
    this.clean()
    const secret = newSecret()
    this.invite = { hash: digest(secret), expires: this.now() + 120_000 }
    return { invite: secret, expires: this.invite.expires }
  }
  request(invite, name, secret) {
    this.clean()
    if (!validSecret(invite) || !validSecret(secret) || !this.invite ||
      this.invite.expires <= this.now() || this.invite.hash !== digest(invite)) throw new Error('Invalid or expired invitation')
    if (typeof name !== 'string' || !name.trim() || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid device name')
    if (this.pending.size >= 16 || this.records.length >= 32) throw new Error('Device limit reached')
    if (this.records.some((r) => r.hash === digest(secret)) || [...this.pending.values()].some((r) => r.hash === digest(secret))) throw new Error('Duplicate device secret')
    this.invite = null // One use; knowledge of an invitation alone grants no control.
    const request = { id: randomUUID(), name: name.trim(), hash: digest(secret),
      code: String(randomInt(100000, 1000000)), expires: this.now() + 120_000, approved: false }
    this.pending.set(request.id, request)
    return { id: request.id, code: request.code, expires: request.expires }
  }
  approve(id) {
    this.clean()
    const request = this.pending.get(id)
    if (!request || request.approved) throw new Error('Request expired or already approved')
    if (this.records.length >= 32) throw new Error('Device limit reached')
    const next = [...this.records, { id, name: request.name, hash: request.hash, createdAt: this.now() }]
    this.save(next) // A failed save must never grant transient authority.
    this.records = next
    request.approved = true
  }
  claim(id, secret) {
    this.clean()
    const request = this.pending.get(id)
    if (!validSecret(secret) || !request || request.hash !== digest(secret)) throw new Error('Request expired')
    return { approved: request.approved && this.records.some((r) => r.id === id), name: request.name }
  }
  revoke(id) {
    const next = this.records.filter((r) => r.id !== id)
    this.save(next)
    this.records = next
    this.pending.delete(id)
  }
  authenticate(secret) {
    if (!validSecret(secret)) return null
    const hash = digest(secret)
    return this.records.find((r) => timingSafeEqual(Buffer.from(hash), Buffer.from(r.hash))) ?? null
  }
  status() {
    this.clean()
    return { devices: this.records.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
      pending: [...this.pending.values()].filter((r) => !r.approved).map(({ id, name, code, expires }) => ({ id, name, code, expires })) }
  }
}
