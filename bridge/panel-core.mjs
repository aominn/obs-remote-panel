import { createServer } from 'node:http'
import { allowedRequest, eventFields, isMutation } from './obs-policy.mjs'
import { equalSecret } from './pairing.mjs'
import { sanitizeOperations } from './shared-profile.mjs'

async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON required')
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 16384) throw new Error('Request too large')
    chunks.push(chunk)
  }
  // Decode once: network chunks can split a Japanese UTF-8 character.
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON')
  return value
}
const bearer = (req) => req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
function send(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}
async function timeout(promise, ms, onTimeout) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => { onTimeout(); reject(new Error('Timed out')) }, ms)
  })]) } finally { clearTimeout(timer) }
}
export function createPanel({ pairing, obs, obsReady, atemRequest, adminSecret, origins, publicUrl, makeQr,
  name = '機材PC', timeoutMs = 5000, sharedProfile = { revision: 0, profile: null }, saveProfile = () => {} }) {
  if (typeof adminSecret !== 'string' || adminSecret.length < 32) throw new Error('Missing admin secret')
  if (!origins?.length || origins.some((v) => new URL(v).origin !== v)) throw new Error('Invalid origins')
  let sequence = 0
  const events = []
  const listeners = []
  let writesBusy = false
  let fault = false
  let reads = 0
  let pairingCount = 0
  let rateReset = 0
  for (const [type, fields] of Object.entries(eventFields)) {
    const listener = (data = {}) => {
      events.push({ seq: ++sequence, type, data: Object.fromEntries(fields.filter((key) => data[key] !== undefined).map((key) => [key, data[key]])) })
      if (events.length > 1000) events.shift()
    }
    obs.on(type, listener)
    listeners.push([type, listener])
  }
  const publicServer = createServer(async (req, res) => {
    const origin = req.headers.origin
    res.setHeader('Vary', 'Origin')
    if (!origins.includes(origin)) return send(res, 403, { error: 'Origin denied' })
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return send(res, 204, {})
    try {
      const url = new URL(req.url, 'http://localhost')
      const path = url.pathname.replace(/^\/panel(?=\/)/, '')
      if (path.startsWith('/pair/') && req.method === 'POST') {
        if (Date.now() > rateReset) { pairingCount = 0; rateReset = Date.now() + 60000 }
        if (++pairingCount > 180) return send(res, 429, { error: 'Too many pairing requests' })
        const data = await body(req)
        if (path === '/pair/request') return send(res, 200, pairing.request(data.invite, data.name, data.secret))
        if (path === '/pair/claim') return send(res, 200, { ...pairing.claim(data.id, data.secret), hubName: name })
        return send(res, 404, { error: 'Not found' })
      }
      const token = bearer(req)
      if (!pairing.authenticate(token)) return send(res, 401, { error: 'Device not registered or revoked' })
      if (req.method === 'GET' && path === '/profile') return send(res, 200, sharedProfile)
      if (req.method === 'POST' && path === '/profile') {
        const data = await body(req)
        if (!pairing.authenticate(token)) return send(res, 401, { error: 'Device revoked' })
        if (data.revision !== sharedProfile.revision) return send(res, 409, { error: 'Profile changed; reload before saving' })
        const next = { revision: sharedProfile.revision + 1, profile: sanitizeOperations(data.profile) }
        saveProfile(next)
        sharedProfile = next
        return send(res, 200, { revision: next.revision })
      }
      if (req.method === 'GET' && path === '/status') return send(res, 200, { name, obsReady: obsReady(), sequence, fault })
      if (req.method === 'GET' && path === '/obs/events') {
        const since = Number(url.searchParams.get('since'))
        if (!Number.isSafeInteger(since) || since < 0) return send(res, 400, { error: 'Invalid cursor' })
        return send(res, 200, { ready: obsReady(), sequence, gap: since > sequence || (events.length > 0 && since < events[0].seq - 1), events: events.filter((e) => e.seq > since) })
      }
      if (req.method === 'POST' && path === '/obs/call') {
        const { type, data = {} } = await body(req)
        if (!pairing.authenticate(token)) return send(res, 401, { error: 'Device revoked' })
        if (typeof type !== 'string' || !allowedRequest(type, data)) return send(res, 400, { error: 'Unsupported operation' })
        if (!obsReady()) return send(res, 503, { error: 'OBS disconnected' })
        const mutation = isMutation(type)
        if (mutation && (writesBusy || fault)) return send(res, 409, { error: 'Busy or stopped after uncertain operation' })
        if (!mutation && reads >= 32) return send(res, 429, { error: 'Too many reads' })
        if (mutation) writesBusy = true
        else reads++
        try {
          const result = await timeout(obs.call(type, data), timeoutMs, () => { if (mutation) fault = true })
          if (!pairing.authenticate(token)) return send(res, 401, { error: 'Device revoked' })
          return send(res, 200, result ?? {})
        } catch { return send(res, 502, { error: 'OBS operation failed; not retried' }) }
        finally { if (mutation) writesBusy = false; else reads-- }
      }
      if (atemRequest && ((path === '/atem/state' && req.method === 'GET') || (path === '/atem/command' && req.method === 'POST'))) {
        const data = req.method === 'POST' ? await body(req) : undefined
        if (!pairing.authenticate(token)) return send(res, 401, { error: 'Device revoked' })
        const result = await atemRequest(path.endsWith('/state') ? 'state' : 'command', data)
        if (!pairing.authenticate(token)) return send(res, 401, { error: 'Device revoked' })
        return send(res, result.status, result.data)
      }
      return send(res, 404, { error: 'Not found or not configured' })
    } catch { return send(res, 400, { error: 'Invalid or expired request' }) }
  })
  const adminServer = createServer(async (req, res) => {
    // Admin has its own loopback-only listener, never mounted under /panel.
    if (req.headers.origin || !equalSecret(bearer(req), adminSecret)) return send(res, 403, { error: 'Denied' })
    try {
      if (req.method === 'GET' && req.url === '/status') {
        let atemReady = null
        if (atemRequest) {
          try { const result = await atemRequest('state'); atemReady = result.status === 200 && result.data.connected === true }
          catch { atemReady = false }
        }
        return send(res, 200, { ...pairing.status(), obsReady: obsReady(), atemReady, fault })
      }
      if (req.method !== 'POST') return send(res, 404, { error: 'Not found' })
      const data = await body(req)
      if (req.url === '/invite') {
        const invite = pairing.issue()
        const encoded = Buffer.from(JSON.stringify({ url: publicUrl, invite: invite.invite })).toString('base64url')
        const link = `https://aominn.github.io/obs-remote-panel/#pair=${encoded}`
        return send(res, 200, { link, expires: invite.expires, qr: await makeQr(link) })
      }
      if (req.url === '/approve') { pairing.approve(data.id); return send(res, 200, {}) }
      if (req.url === '/revoke') { pairing.revoke(data.id); return send(res, 200, {}) }
      return send(res, 404, { error: 'Not found' })
    } catch { return send(res, 400, { error: 'Request rejected or expired' }) }
  })
  for (const server of [publicServer, adminServer]) { server.requestTimeout = 10000; server.headersTimeout = 10000 }
  publicServer.on('close', () => { for (const [event, fn] of listeners) obs.off(event, fn) })
  return { publicServer, adminServer }
}
