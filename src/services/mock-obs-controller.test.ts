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

  it('ソース操作シーンをプログラムとは独立して維持する', async () => {
    const controller = new MockObsController()
    await controller.connect(createProfile())

    await controller.refreshSources('資料共有')
    expect(controller.getState()).toMatchObject({
      currentProgramScene: 'メインカメラ',
      sourceSceneName: '資料共有'
    })
    expect(controller.getState().sources.map((source) => source.sourceName)).toEqual([
      'スライド資料',
      'レーザーポインター'
    ])

    const pointer = controller.getState().sources.find(
      (source) => source.sourceName === 'レーザーポインター'
    )
    expect(pointer).toBeDefined()
    await controller.setSourceEnabled(pointer!, true)
    await controller.refreshSources('休憩中')
    await controller.refreshSources('資料共有')

    expect(
      controller.getState().sources.find((source) => source.sourceName === 'レーザーポインター')
    ).toMatchObject({ enabled: true })
    expect(controller.getState().currentProgramScene).toBe('メインカメラ')
  })

  it('選択した音声入力だけを操作する', async () => {
    const controller = new MockObsController()
    await controller.connect(createProfile())

    await controller.setInputMuted('BGM', false)
    await controller.setInputVolume('BGM', -18.5)

    expect(controller.getState().inputs.find((input) => input.name === 'BGM')).toMatchObject({
      muted: false,
      volumeDb: -18.5
    })
    expect(controller.getState().inputs.find((input) => input.name === 'マイク')).toMatchObject({
      muted: false,
      volumeDb: -8
    })
  })
})
