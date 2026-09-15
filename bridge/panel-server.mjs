import { OBSWebSocket } from 'obs-websocket-js'
import { Atem } from 'atem-connection'
import QRCode from 'qrcode'
import { readFileSync, writeFileSync, renameSync, existsSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { isIP } from 'node:net'
import { Pairing, newSecret } from './pairing.mjs'
import { createPanel } from './panel-core.mjs'
import { createBridge } from './core.mjs'
import { sanitizeOperations } from './shared-profile.mjs'

const registry = resolve(process.env.PANEL_REGISTRY_PATH || '')
const publicUrl = new URL(process.env.PANEL_PUBLIC_URL || '')
if (publicUrl.protocol !== 'https:' || !publicUrl.hostname.endsWith('.ts.net') || publicUrl.pathname !== '/panel' ||
  publicUrl.port || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new Error('Invalid private panel URL')
if (!process.env.PANEL_REGISTRY_PATH || realpathSync(dirname(registry)) !== dirname(registry) ||
  (existsSync(registry) && lstatSync(registry).isSymbolicLink())) throw new Error('Invalid registry location')
const records = existsSync(registry) ? JSON.parse(readFileSync(registry, 'utf8')) : []
const pairing = new Pairing({ records, save: (next) => {
  const temp = registry + '.tmp'
  if (existsSync(temp) && lstatSync(temp).isSymbolicLink()) throw new Error('Invalid registry temporary file')
  writeFileSync(temp, JSON.stringify(next), { mode: 0o600 })
  renameSync(temp, registry)
} })
const profilePath = resolve(dirname(registry), 'operations.json')
if (existsSync(profilePath) && lstatSync(profilePath).isSymbolicLink()) throw new Error('Invalid profile location')
const sharedProfile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : { revision: 0, profile: null }
if (!Number.isSafeInteger(sharedProfile.revision) || sharedProfile.revision < 0) throw new Error('Invalid profile revision')
if (sharedProfile.profile) sharedProfile.profile = sanitizeOperations(sharedProfile.profile)
const obs = new OBSWebSocket()
let ready = false
let stopping = false
let reconnect
obs.on('ConnectionClosed', () => { ready = false })
obs.on('ConnectionError', () => { ready = false })
async function connectObs() {
  if (stopping || process.env.PANEL_OBS_ENABLED !== '1') return
  if (!ready) {
    let timer
    try {
      const port = Number(process.env.PANEL_OBS_PORT || 4455)
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || !process.env.PANEL_OBS_PASSWORD) throw new Error('OBS configuration required')
      await Promise.race([obs.connect(`ws://127.0.0.1:${port}`, process.env.PANEL_OBS_PASSWORD),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), 8000) })])
      ready = true
    } catch { ready = false; await obs.disconnect().catch(() => {}) }
    finally { clearTimeout(timer) }
  }
  if (!stopping) reconnect = setTimeout(connectObs, 3000)
}
let atem
let atemServer
let atemRequest
const address = process.env.ATEM_ADDRESS
if (address) {
  if (isIP(address) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) throw new Error('Invalid ATEM LAN address')
  atem = new Atem()
  const internalToken = newSecret()
  atemServer = createBridge({ atem, token: internalToken, origins: ['https://aominn.github.io'] })
  await new Promise((resolve, reject) => { atemServer.once('error', reject); atemServer.listen(0, '127.0.0.1', resolve) })
  const internalUrl = `http://127.0.0.1:${atemServer.address().port}`
  atemRequest = async (path, data) => {
    const response = await fetch(`${internalUrl}/${path}`, { method: data ? 'POST' : 'GET',
      headers: { Origin: 'https://aominn.github.io', Authorization: `Bearer ${internalToken}`, 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(6500), redirect: 'error' })
    return { status: response.status, data: await response.json() }
  }
  void atem.connect(address).catch(() => {})
}
const { publicServer, adminServer } = createPanel({ pairing, obs, obsReady: () => ready, atemRequest,
  adminSecret: process.env.PANEL_ADMIN_TOKEN, origins: ['https://aominn.github.io'], publicUrl: publicUrl.href,
  sharedProfile, saveProfile: (value) => {
    const temp = profilePath + '.tmp'
    if (existsSync(temp) && lstatSync(temp).isSymbolicLink()) throw new Error('Invalid profile temporary file')
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
    renameSync(temp, profilePath)
  },
  name: process.env.PANEL_NAME || '機材PC', makeQr: (link) => QRCode.toDataURL(link, { width: 320, margin: 2 }) })
const shutdown = () => {
  stopping = true
  clearTimeout(reconnect)
  for (const server of [publicServer, adminServer, atemServer].filter(Boolean)) { server.close(); server.closeAllConnections() }
  void obs.disconnect().catch(() => {})
  void atem?.destroy()
}
for (const server of [publicServer, adminServer]) server.on('error', () => { console.error('Panel listener unavailable. Close this window and check ports.'); shutdown() })
publicServer.listen(8789, '127.0.0.1')
adminServer.listen(8790, '127.0.0.1')
void connectObs()
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
