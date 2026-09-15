import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoutedObsTransport } from './obs-transport'
import { createProfile } from '../lib/settings'
import { saveRegistration } from '../lib/device-registration'
import { RealObsController } from './obs-controller'
const url = 'https://pc.example.ts.net/panel'
beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function setup() {
  const transport = new RoutedObsTransport()
  const profile = { ...createProfile(), hub: { url } }
  saveRegistration(url, { id: 'device', name: 'PC', token: 'a'.repeat(43) })
  transport.configure(profile)
  return transport
}
it('sends only device token and allowed request data, not the OBS password', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ obsReady: true, sequence: 0 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ inputMuted: true })))
  vi.stubGlobal('fetch', fetcher)
  const transport = setup()
  await transport.connect('ws://127.0.0.1:4455', 'do-not-transmit')
  await transport.call('SetInputMute', { inputName: 'マイク', inputMuted: true })
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('do-not-transmit')
  expect(fetcher.mock.calls[1][0]).toBe(`${url}/obs/call`)
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ type: 'SetInputMute', data: { inputName: 'マイク', inputMuted: true } })
  await transport.disconnect()
})
it('syncs events and reports revoked credentials as a lost connection', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ obsReady: true, sequence: 0 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ready: true, sequence: 1, events: [{ type: 'InputMuteStateChanged', data: { inputName: 'マイク', inputMuted: true } }] })))
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
  vi.stubGlobal('fetch', fetcher)
  const transport = setup()
  const muted = vi.fn()
  const disconnected = vi.fn()
  transport.on('InputMuteStateChanged', muted)
  transport.on('ConnectionClosed', disconnected)
  await transport.connect()
  await vi.advanceTimersByTimeAsync(750)
  expect(muted).toHaveBeenCalledWith({ inputName: 'マイク', inputMuted: true })
  await vi.advanceTimersByTimeAsync(750)
  expect(disconnected).toHaveBeenCalledOnce()
  await transport.disconnect()
})
it('unregistered devices do not send any OBS request', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const transport = new RoutedObsTransport()
  transport.configure({ ...createProfile(), hub: { url } })
  await expect(transport.connect()).rejects.toThrow('登録')
  expect(fetcher).not.toHaveBeenCalled()
})

it('a fast OBS reconnect still invalidates the old snapshot and stops polling until reconnected', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ obsReady: true, sequence: 0 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ready: true, sequence: 1, events: [{ type: 'ConnectionClosed', data: {} }] })))
  vi.stubGlobal('fetch', fetcher)
  const transport = setup()
  const disconnected = vi.fn()
  transport.on('ConnectionClosed', disconnected)
  await transport.connect()
  await vi.advanceTimersByTimeAsync(3000)
  expect(disconnected).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledTimes(2)
  await transport.disconnect()
})

it('real controller refreshes through the paired transport and preserves mute state after rejection', async () => {
  const responses: Record<string, unknown> = {
    GetSceneList: { scenes: [{ sceneName: 'メイン' }], currentProgramSceneName: 'メイン', currentPreviewSceneName: 'メイン' },
    GetSceneItemList: { sceneItems: [] },
    GetInputList: { inputs: [{ inputName: 'マイク', inputKind: 'wasapi_input_capture' }] },
    GetInputMute: { inputMuted: false }, GetInputVolume: { inputVolumeDb: -8 },
    GetInputAudioMonitorType: { monitorType: 'OBS_MONITORING_TYPE_NONE' },
    GetStreamStatus: { outputActive: false }, GetRecordStatus: { outputActive: false, outputPaused: false },
    GetVirtualCamStatus: { outputActive: false }, GetReplayBufferStatus: { outputActive: false },
    GetStudioModeEnabled: { studioModeEnabled: false },
    GetSceneTransitionList: { transitions: [], currentSceneTransitionName: 'Cut' }, GetCurrentSceneTransition: { transitionDuration: 300 }, GetStats: {}
  }
  let rejectMute = true
  const fetcher = vi.fn(async (endpoint: string, options: RequestInit) => {
    if (endpoint.endsWith('/status')) return new Response(JSON.stringify({ obsReady: true, sequence: 0 }))
    const { type } = JSON.parse(options.body as string)
    if (type === 'SetInputMute') return new Response('{}', { status: rejectMute ? 502 : 200 })
    expect(responses).toHaveProperty(type)
    return new Response(JSON.stringify(responses[type]))
  })
  vi.stubGlobal('fetch', fetcher)
  const controller = new RealObsController(setup())
  await controller.connect({ ...createProfile(), hub: { url } })
  expect(controller.getState().connectionStatus).toBe('connected')
  expect(controller.getState().inputs[0]).toMatchObject({ name: 'マイク', muted: false })
  await expect(controller.setInputMuted('マイク', true)).rejects.toThrow()
  expect(controller.getState().inputs[0].muted).toBe(false)
  rejectMute = false
  await controller.setInputMuted('マイク', true)
  expect(controller.getState().inputs[0].muted).toBe(true)
  expect(fetcher.mock.calls.filter(([, options]) => options.body && JSON.parse(options.body as string).type === 'SetInputMute')).toHaveLength(2)
  await controller.disconnect()
})
