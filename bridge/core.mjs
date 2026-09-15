import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

// Model IDs from atem-connection 3.10.2. Do not infer support from product names.
const MINI_INPUT_LIMITS = new Map([
  [13, 4], // Mini
  [14, 4], // Mini Pro
  [15, 4], // Mini Pro ISO
  [16, 8], // Mini Extreme
  [17, 8] // Mini Extreme ISO (not G2)
])

// Show only physical HDMI inputs actually reported by a supported device.
export function snapshot(atem, connected) {
  const state = atem.state
  const count = MINI_INPUT_LIMITS.get(state?.info.model) || 0
  const me = state?.video.mixEffects[0]
  const ready = Boolean(connected && count && me)
  return {
    connected: ready,
    model: state?.info.productIdentifier || '',
    inputs: ready ? Object.values(state.inputs)
      .filter((input) => Number.isInteger(input.inputId) && input.inputId >= 1 && input.inputId <= count && input.internalPortType === 0)
      .sort((a, b) => a.inputId - b.inputId)
      .map((input) => ({ id: input.inputId, name: input.longName || `HDMI ${input.inputId}` })) : [],
    program: ready ? me.programInput : null,
    preview: ready ? me.previewInput : null,
    transitioning: ready ? Boolean(me.transitionPosition?.inTransition) : false
  }
}

export function createBridge({ atem, token, origins, commandTimeout = 5000 }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('ATEM_BRIDGE_TOKEN must contain at least 32 characters')
  if (!origins?.length || origins.some((origin) => new URL(origin).origin !== origin)) {
    throw new Error('ATEM_BRIDGE_ORIGINS must contain exact origins')
  }
  let connected = false
  let busy = false
  let fault = false
  atem.on('connected', () => { connected = true; fault = false })
  atem.on('disconnected', () => { connected = false })
  atem.on('error', () => { connected = false })
  const getState = () => ({ ...snapshot(atem, connected && !fault), busy })
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Vary', 'Origin')
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const origin = req.headers.origin
    if (!origin || !origins.includes(origin)) return send(403, { error: 'Origin not allowed' })
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    const provided = Buffer.from(req.headers.authorization || '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return send(401, { error: 'Authentication failed' })
    }
    // Tailscale Serve may preserve or strip the /atem mount prefix.
    const path = req.url?.replace(/^\/atem(?=\/)/, '')
    if (req.method === 'GET' && path === '/state') return send(200, getState())
    if (req.method !== 'POST' || path !== '/command') return send(404, { error: 'Not found' })
    if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON required' })
    let body = ''
    try {
      for await (const chunk of req) {
        body += chunk.toString()
        if (body.length > 1024) return send(413, { error: 'Request too large' })
      }
      const command = JSON.parse(body)
      if (!command || !['program', 'preview', 'cut', 'auto'].includes(command.action)) {
        return send(400, { error: 'Invalid command' })
      }
      const current = getState()
      if (!current.connected) return send(503, { error: 'ATEM disconnected or unsupported' })
      if (busy || current.transitioning) return send(409, { error: 'ATEM busy' })
      if (['program', 'preview'].includes(command.action) &&
          !current.inputs.some((input) => input.id === command.input)) {
        return send(400, { error: 'Invalid input' })
      }
      busy = true
      let timer
      try {
        const operation = command.action === 'program' ? atem.changeProgramInput(command.input, 0)
          : command.action === 'preview' ? atem.changePreviewInput(command.input, 0)
            : command.action === 'cut' ? atem.cut(0) : atem.autoTransition(0)
        await Promise.race([
          operation,
          new Promise((_, reject) => {
            timer = setTimeout(() => { fault = true; reject(new Error('timeout')) }, commandTimeout)
          })
        ])
        // Command acknowledgement is not a state update. Read only actual device state.
        send(200, getState())
      } catch {
        send(502, { error: 'ATEM操作を確認できませんでした。本体の状態を確認してください。' })
      } finally {
        clearTimeout(timer)
        busy = false
      }
    } catch {
      send(400, { error: 'Invalid request' })
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  return server
}
