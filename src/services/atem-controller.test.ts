import { afterEach, describe, expect, it, vi } from 'vitest'
import { AtemController, bridgeUrl, type AtemState } from './atem-controller'

const initial: AtemState = {
  connected: true, model: 'ATEM Mini Pro ISO',
  inputs: [{ id: 1, name: 'Camera' }, { id: 2, name: 'Slides' }],
  program: 1, preview: 2, busy: false, transitioning: false
}
const token = 'test-only-key-not-a-real-credential-1234'
const response = (state = initial) => new Response(JSON.stringify(state), { status: 200 })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('ATEM controller', () => {
  it('validates secure bridge URLs', () => {
    expect(bridgeUrl('https://pc.example/atem/')).toBe('https://pc.example/atem')
    expect(bridgeUrl('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788')
    expect(() => bridgeUrl('http://192.168.1.3')).toThrow()
    expect(() => bridgeUrl('https://user:secret@pc.example')).toThrow()
    expect(() => bridgeUrl('https://pc.example?token=secret')).toThrow()
  })

  it('sends exact commands without optimistic state and blocks duplicate requests', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AtemController()
    await controller.connect('https://pc.example/atem', token)
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
    fetchMock.mockResolvedValueOnce(response({ ...initial, program: 2 }))
    const pending = controller.command('program', 2)
    expect(controller.getState().program).toBe(1)
    await expect(controller.command('cut')).rejects.toThrow()
    expect(fetchMock).toHaveBeenLastCalledWith('https://pc.example/atem/command', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'program', input: 2 })
    }))
    finish(response())
    await pending
    expect(controller.getState().program).toBe(2)
    controller.disconnect()
  })

  it('failure rejects and hides stale on-air state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('{}', { status: 502 })))
    const controller = new AtemController()
    await controller.connect('https://pc.example/atem', token)
    await expect(controller.command('program', 2)).rejects.toThrow()
    expect(controller.getState()).toMatchObject({ connected: false, program: null })
    controller.disconnect()
  })

  it('polls physical state changes and recovers after a temporary outage', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response({ ...initial, program: 2 })))
    const controller = new AtemController()
    await controller.connect('https://pc.example/atem', token)
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.getState().connected).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.getState()).toMatchObject({ connected: true, program: 2 })
    controller.disconnect()
  })

  it('ignores a poll started before a completed command', async () => {
    vi.useFakeTimers()
    let finish!: (response: Response) => void
    const fetchMock = vi.fn().mockResolvedValueOnce(response())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ ...initial, program: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AtemController()
    await controller.connect('https://pc.example/atem', token)
    await vi.advanceTimersByTimeAsync(1000)
    await controller.command('program', 2)
    finish(response())
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getState().program).toBe(2)
    controller.disconnect()
  })

  it('ignores late state after disconnect', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
    const controller = new AtemController()
    const pending = controller.connect('https://pc.example/atem', token)
    controller.disconnect()
    finish(response())
    await pending
    expect(controller.getState().connected).toBe(false)
  })

  it('mock supports independent preview, program, CUT and AUTO', async () => {
    const controller = new AtemController(true)
    await controller.connect('', '')
    await controller.command('preview', 4)
    expect(controller.getState()).toMatchObject({ program: 1, preview: 4 })
    await controller.command('cut')
    expect(controller.getState()).toMatchObject({ program: 4, preview: 1 })
    await controller.command('program', 8)
    await controller.command('auto')
    expect(controller.getState()).toMatchObject({ program: 1, preview: 8 })
    controller.disconnect()
  })
})
