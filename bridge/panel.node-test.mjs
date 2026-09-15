import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Pairing, newSecret } from './pairing.mjs'
import { createPanel } from './panel-core.mjs'
import { allowedRequest } from './obs-policy.mjs'
import QRCode from 'qrcode'
import { request as httpRequest } from 'node:http'

test('pairing is one-use, expires, requires approval, persists only hashes, and can be revoked', () => {
  let time = 0
  let saved
  const pairing = new Pairing({ now: () => time, save: (r) => { saved = r } })
  const invite = pairing.issue()
  const secret = newSecret()
  const request = pairing.request(invite.invite, 'スマホ', secret)
  assert.equal(pairing.authenticate(secret), null)
  assert.equal(pairing.claim(request.id, secret).approved, false)
  assert.throws(() => pairing.request(invite.invite, 'another', newSecret()))
  assert.throws(() => pairing.claim(request.id, newSecret()))
  pairing.approve(request.id)
  assert.equal(pairing.claim(request.id, secret).approved, true)
  assert.equal(JSON.stringify(saved).includes(secret), false)
  assert.equal(JSON.stringify(pairing.status()).includes('hash'), false)
  const restarted = new Pairing({ records: saved })
  assert.equal(restarted.authenticate(secret).name, 'スマホ')
  restarted.revoke(request.id)
  assert.equal(restarted.authenticate(secret), null)
  const expired = pairing.issue()
  time = expired.expires
  assert.throws(() => pairing.request(expired.invite, 'expired', newSecret()))
  const req = pairing.request(pairing.issue().invite, 'late', newSecret())
  time = req.expires
  assert.throws(() => pairing.approve(req.id))
})
test('a persistence failure never authorizes a device or silently revokes another', () => {
  const p = new Pairing({ save: () => { throw new Error('disk full') } })
  const key = newSecret()
  const req = p.request(p.issue().invite, 'test', key)
  assert.throws(() => p.approve(req.id))
  assert.equal(p.authenticate(key), null)
})
test('OBS policy denies secrets, URLs, vendor operations, batches and invalid parameters', () => {
  for (const op of ['GetInputSettings', 'SetInputSettings', 'GetStreamServiceSettings', 'CallVendorRequest', 'Sleep', 'GetProfileParameter']) {
    assert.equal(allowedRequest(op, {}), false)
  }
  assert.equal(allowedRequest('SetInputMute', { inputName: 'マイク', inputMuted: true }), true)
  assert.equal(allowedRequest('SetInputMute', { inputName: 'マイク', inputMuted: 'true' }), false)
  assert.equal(allowedRequest('GetSceneList', { url: 'http://evil' }), false)
  assert.equal(allowedRequest('SetInputVolume', { inputName: 'マイク', inputVolumeDb: Infinity }), false)
  assert.equal(allowedRequest('__proto__', {}), false)
})
async function start(t, opts = {}) {
  const pairing = new Pairing()
  const key = newSecret()
  const req = pairing.request(pairing.issue().invite, 'test device', key)
  pairing.approve(req.id)
  const obs = new EventEmitter()
  const calls = []
  obs.call = async (...args) => { calls.push(args); return { inputMuted: true } }
  const adminSecret = newSecret()
  const servers = createPanel({ pairing, obs, obsReady: () => true, origins: ['https://aominn.github.io'],
    publicUrl: 'https://test.example.ts.net/panel', adminSecret, makeQr: (link) => QRCode.toDataURL(link), ...opts })
  await Promise.all(Object.values(servers).map((s) => new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))))
  t.after(async () => { for (const s of Object.values(servers)) { s.closeAllConnections(); await new Promise((resolve) => s.close(resolve)) } })
  const request = async (path, data, token = key, origin = 'https://aominn.github.io', admin = false) => {
    const server = admin ? servers.adminServer : servers.publicServer
    const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: data === undefined ? 'GET' : 'POST', headers: { ...(origin ? { Origin: origin } : {}),
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
    return { status: result.status, data: await result.json() }
  }
  return { pairing, key, id: req.id, adminSecret, request, obs, calls, port: servers.publicServer.address().port }
}

async function rawRequest(env, path, chunks = []) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: env.port, path, method: 'POST',
      headers: { Origin: 'https://aominn.github.io', Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' } }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    if (chunks.length) request.write(chunks[0])
    setTimeout(() => request.end(chunks[1]), 10)
  })
}

test('split Japanese UTF-8 bodies are preserved and malformed request URLs cannot crash the broker', async (t) => {
  const env = await start(t)
  const body = Buffer.from(JSON.stringify({ type: 'SetInputMute', data: { inputName: 'マイク', inputMuted: true } }))
  const split = body.indexOf(Buffer.from('マ')) + 1
  assert.equal(await rawRequest(env, '/panel/obs/call', [body.subarray(0, split), body.subarray(split)]), 200)
  assert.equal(env.calls[0][1].inputName, 'マイク')
  assert.equal(await rawRequest(env, '//['), 400)
  assert.equal((await env.request('/panel/status')).status, 200)
})
test('public routes require device auth + exact Origin; admin never exposed through public routes', async (t) => {
  const env = await start(t)
  assert.equal((await env.request('/panel/status')).status, 200)
  assert.equal((await env.request('/panel/status', undefined, newSecret())).status, 401)
  assert.equal((await env.request('/panel/status', undefined, env.key, 'https://evil.example')).status, 403)
  assert.equal((await env.request('/panel/status', undefined, env.key, '')).status, 403)
  assert.equal((await env.request('/panel/approve', { id: 'x' })).status, 404)
  assert.equal((await env.request('/status', undefined, env.adminSecret, 'https://aominn.github.io', true)).status, 403)
  assert.equal((await env.request('/status', undefined, env.adminSecret, '', true)).status, 200)
  env.pairing.revoke(env.id)
  assert.equal((await env.request('/panel/status')).status, 401)
})
test('full HTTP registration with QR and admin approval; no hardware passwords in response', async (t) => {
  const env = await start(t)
  const invite = await env.request('/invite', {}, env.adminSecret, '', true)
  assert.equal(invite.status, 200)
  assert.ok(invite.data.qr.startsWith('data:image/png;base64,'))
  const fragment = new URL(invite.data.link).hash.slice('#pair='.length)
  const payload = JSON.parse(Buffer.from(fragment, 'base64url'))
  const key = newSecret()
  const req = await env.request('/panel/pair/request', { invite: payload.invite, name: 'スマホ', secret: key }, '')
  assert.equal(req.status, 200)
  assert.equal((await env.request('/panel/status', undefined, key)).status, 401)
  assert.equal((await env.request('/approve', { id: req.data.id }, env.adminSecret, '', true)).status, 200)
  const claim = await env.request('/panel/pair/claim', { id: req.data.id, secret: key }, '')
  assert.equal(claim.data.approved, true)
  assert.equal(JSON.stringify(claim).includes(key), false)
  assert.equal((await env.request('/panel/status', undefined, key)).status, 200)
})
test('broker forwards exact allowed operations and strips sensitive event fields', async (t) => {
  const env = await start(t)
  assert.equal((await env.request('/panel/obs/call', { type: 'SetInputMute', data: { inputName: 'マイク', inputMuted: true } })).status, 200)
  assert.deepEqual(env.calls[0], ['SetInputMute', { inputName: 'マイク', inputMuted: true }])
  assert.equal((await env.request('/panel/obs/call', { type: 'GetInputSettings', data: {} })).status, 400)
  env.obs.emit('InputCreated', { inputName: 'test', defaultInputSettings: { password: 'do-not-forward' } })
  env.obs.emit('InputMuteStateChanged', { inputName: 'マイク', inputMuted: true })
  const events = await env.request('/panel/obs/events?since=0')
  assert.equal(JSON.stringify(events).includes('do-not-forward'), false)
  assert.equal(events.data.events[1].data.inputMuted, true)
})
test('mutation timeout is not retried and locks further writes; reads remain available', async (t) => {
  const env = await start(t, { timeoutMs: 10 })
  env.obs.call = () => new Promise(() => {})
  assert.equal((await env.request('/panel/obs/call', { type: 'StartStream' })).status, 502)
  assert.equal((await env.request('/panel/obs/call', { type: 'StartStream' })).status, 409)
  assert.equal((await env.request('/panel/status')).data.fault, true)
})
test('ATEM requests require paired device auth and preserve target/direction', async (t) => {
  const calls = []
  const env = await start(t, { atemRequest: async (...args) => { calls.push(args); return { status: 200, data: { connected: true } } } })
  assert.equal((await env.request('/panel/atem/command', { action: 'preview', input: 4 })).status, 200)
  assert.deepEqual(calls, [['command', { action: 'preview', input: 4 }]])
  env.pairing.revoke(env.id)
  assert.equal((await env.request('/panel/atem/command', { action: 'cut' })).status, 401)
  assert.equal(calls.length, 1)
})
test('shared operations exclude credentials, require authorization and reject conflicting writes', async (t) => {
  let saved
  const env = await start(t, { saveProfile: (value) => { saved = value } })
  const profile = { name: '配信PC', quickActions: [{ id: 'a', kind: 'scene', label: 'test', color: '#fff', target: 'Scene' }],
    password: 'do-not-save', hub: { token: 'secret' }, atem: { token: 'secret' }, url: 'http://elsewhere' }
  assert.equal((await env.request('/panel/profile', { revision: 0, profile })).status, 200)
  assert.equal(JSON.stringify(saved).includes('secret'), false)
  assert.equal(JSON.stringify(saved).includes('do-not-save'), false)
  assert.equal((await env.request('/panel/profile', { revision: 0, profile })).status, 409)
  assert.equal((await env.request('/panel/profile')).data.profile.quickActions[0].target, 'Scene')
  assert.equal((await env.request('/panel/profile', undefined, newSecret())).status, 401)
})
