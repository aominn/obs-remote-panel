import { EventEmitter, once } from 'node:events'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBridge, snapshot } from './core.mjs'

const token = 'test-only-key-not-a-real-credential-1234'
const origin = 'https://aominn.github.io'
class FakeAtem extends EventEmitter {
  state = {
    info: { model: 16, productIdentifier: 'ATEM Mini Extreme' },
    inputs: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, { inputId: i + 1, longName: `Cam ${i + 1}`, internalPortType: 0 }])),
    video: { mixEffects: [{ programInput: 1, previewInput: 2, transitionPosition: { inTransition: false } }] }
  }
  calls = []
  fail = false
  async changeProgramInput(input, me) {
    this.calls.push(['program', input, me])
    if (this.fail) throw new Error('device rejected')
    this.state.video.mixEffects[0].programInput = input
  }
  async changePreviewInput(input, me) {
    this.calls.push(['preview', input, me])
    this.state.video.mixEffects[0].previewInput = input
  }
  async cut(me) { this.calls.push(['cut', me]) }
  async autoTransition(me) { this.calls.push(['auto', me]) }
}

async function fixture(t, options = {}) {
  const atem = new FakeAtem()
  const server = createBridge({ atem, token, origins: [origin], ...options })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  atem.emit('connected')
  const url = `http://127.0.0.1:${server.address().port}`
  const request = (path, command, headers = {}) => fetch(`${url}${path}`, {
    method: command ? 'POST' : 'GET',
    headers: { Origin: origin, Authorization: `Bearer ${token}`, ...(command ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: command ? JSON.stringify(command) : undefined
  })
  return { atem, request, url }
}

test('model input counts, real program/preview and disconnected state', () => {
  const atem = new FakeAtem()
  assert.equal(snapshot(atem, true).inputs.length, 8)
  atem.state.info.model = 15
  assert.equal(snapshot(atem, true).inputs.length, 4)
  assert.equal(snapshot(atem, false).program, null)
  atem.state.info.model = 99
  assert.equal(snapshot(atem, true).connected, false)
})

for (const [model, name, count] of [
  [13, 'ATEM Mini', 4], [14, 'ATEM Mini Pro', 4], [15, 'ATEM Mini Pro ISO', 4],
  [16, 'ATEM Mini Extreme', 8], [17, 'ATEM Mini Extreme ISO', 8]
]) {
  test(`${name}: detects model and sends all controls to M/E 0`, async (t) => {
    const { atem, request } = await fixture(t)
    atem.state.info = { model, productIdentifier: name }
    const state = await (await request('/state')).json()
    assert.equal(state.connected, true)
    assert.equal(state.model, name)
    assert.deepEqual(state.inputs.map((input) => input.id), Array.from({ length: count }, (_, i) => i + 1))
    for (const action of ['program', 'preview', 'cut', 'auto']) {
      assert.equal((await request('/command', { action, input: count })).status, 200)
    }
    assert.deepEqual(atem.calls, [['program', count, 0], ['preview', count, 0], ['cut', 0], ['auto', 0]])
    assert.equal((await request('/command', { action: 'program', input: count + 1 })).status, 400)
  })
}

test('uses actual physical inputs and names without fabricating missing inputs', async (t) => {
  const { atem, request } = await fixture(t)
  atem.state.info.model = 17
  atem.state.inputs = {
    8: { inputId: 8, longName: '資料', internalPortType: 0 },
    2: { inputId: 2, longName: '', internalPortType: 0 },
    3: { inputId: 3, longName: 'Not external', internalPortType: 1 },
    0: { inputId: 0, longName: 'Black', internalPortType: 0 },
    1000: { inputId: 1000, longName: 'Color', internalPortType: 0 }
  }
  assert.deepEqual((await (await request('/state')).json()).inputs, [{ id: 2, name: 'HDMI 2' }, { id: 8, name: '資料' }])
  assert.equal((await request('/command', { action: 'preview', input: 1 })).status, 400)
  atem.state.inputs[8].longName = '資料更新'
  assert.equal((await (await request('/state')).json()).inputs[1].name, '資料更新')
  assert.deepEqual(atem.calls, [])
})

test('unsupported models fail closed even with a supported product name', async (t) => {
  const { atem, request } = await fixture(t)
  for (const model of [0, 21, 22, 23, 26, 27, 28, 33, 99]) {
    atem.state.info = { model, productIdentifier: 'ATEM Mini Extreme ISO' }
    const state = await (await request('/state')).json()
    assert.equal(state.connected, false)
    assert.deepEqual(state.inputs, [])
    assert.equal(state.program, null)
    for (const action of ['program', 'preview', 'cut', 'auto']) {
      assert.equal((await request('/command', { action, input: 1 })).status, 503)
    }
  }
  assert.deepEqual(atem.calls, [])
})

test('authenticated commands target M/E 0 and return device state', async (t) => {
  const { atem, request } = await fixture(t)
  for (const action of ['program', 'preview', 'cut', 'auto']) {
    assert.equal((await request('/atem/command', { action, input: 3 })).status, 200)
  }
  assert.deepEqual(atem.calls, [['program', 3, 0], ['preview', 3, 0], ['cut', 0], ['auto', 0]])
  atem.state.video.mixEffects[0].programInput = 8 // A physical panel change, not a web command.
  const response = await request('/state')
  assert.equal((await response.json()).program, 8)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('origin and token required; preflight grants no command authority', async (t) => {
  const { atem, request, url } = await fixture(t)
  assert.equal((await request('/command', { action: 'cut' }, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await request('/command', { action: 'cut' }, { Authorization: '' })).status, 401)
  assert.equal((await request('/state', undefined, { Authorization: 'Bearer wrong' })).status, 401)
  assert.equal((await fetch(`${url}/state`)).status, 403)
  assert.equal((await fetch(`${url}/command`, { method: 'OPTIONS', headers: { Origin: origin } })).status, 204)
  assert.deepEqual(atem.calls, [])
})

test('reject invalid, disconnected and in-transition commands', async (t) => {
  const { atem, request } = await fixture(t)
  assert.equal((await request('/command', { action: 'audio' })).status, 400)
  assert.equal((await request('/command', { action: 'program', input: 9 })).status, 400)
  atem.state.video.mixEffects[0].transitionPosition.inTransition = true
  assert.equal((await request('/command', { action: 'cut' })).status, 409)
  atem.emit('disconnected')
  assert.equal((await request('/command', { action: 'cut' })).status, 503)
  assert.deepEqual(atem.calls, [])
})

test('device rejection does not fabricate a program change', async (t) => {
  const { atem, request } = await fixture(t)
  atem.fail = true
  assert.equal((await request('/command', { action: 'program', input: 3 })).status, 502)
  assert.equal((await (await request('/state')).json()).program, 1)
})

test('concurrent commands are rejected; timeout fails closed', async (t) => {
  const { atem, request } = await fixture(t, { commandTimeout: 100 })
  let started
  const ready = new Promise((resolve) => { started = resolve })
  atem.cut = () => { started(); return new Promise(() => {}) }
  const first = request('/command', { action: 'cut' })
  await ready
  assert.equal((await request('/command', { action: 'auto' })).status, 409)
  assert.equal((await first).status, 502)
  assert.equal((await (await request('/state')).json()).connected, false)
})
