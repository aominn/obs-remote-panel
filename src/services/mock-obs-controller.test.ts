import { describe, expect, it, vi } from 'vitest'
import { createProfile } from '../lib/settings'
import { MockObsController } from './mock-obs-controller'

describe('モックOBS', () => {
  it('主要操作と状態イベントを再現する', async () => {
    const controller = new MockObsController()
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    await controller.connect(createProfile())

    await controller.setCurrentScene('資料共有')
    await controller.setInputMuted('マイク', true)
    await controller.setInputVolume('マイク', -20)
    await controller.toggleStream()
    await controller.toggleRecord()
    await controller.toggleVirtualCamera()
    await controller.toggleReplayBuffer()
    await controller.setStudioMode(true)
    await controller.triggerSlide('画像スライドショー', 'next')

    const state = controller.getState()
    expect(state.connectionStatus).toBe('connected')
    expect(state.currentProgramScene).toBe('資料共有')
    expect(state.inputs.find((input) => input.name === 'マイク')).toMatchObject({
      muted: true,
      volumeDb: -20
    })
    expect(state.outputs).toMatchObject({
      streamActive: true,
      recordActive: true,
      virtualCameraActive: true,
      replayBufferActive: true
    })
    expect(state.studioMode).toBe(true)
    expect(state.lastAction).toBe('画像スライドショー: 次へ（モック）')
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })
})
