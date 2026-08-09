import type { OBSWebSocket } from 'obs-websocket-js'
import { describe, expect, it, vi } from 'vitest'
import {
  AUDIO_MONITOR_OFF,
  AUDIO_MONITOR_ON,
  AUDIO_MONITOR_ONLY,
  inputAudioMonitorRequest,
  inputVolumeRequest,
  isInputAudioMonitoringOn,
  mediaActionRequest,
  RealObsController,
  sceneItemEnabledRequest
} from './obs-controller'

class FakeObsWebSocket {
  private readonly handlers = new Map<string, (event: Record<string, unknown>) => void>()
  readonly call = vi.fn(async (requestType: string) => {
    switch (requestType) {
      case 'GetInputList':
        return { inputs: [{ inputName: 'マイク', inputKind: 'wasapi_input_capture' }] }
      case 'GetInputMute':
        return { inputMuted: false }
      case 'GetInputVolume':
        return { inputVolumeDb: -8 }
      case 'GetInputAudioMonitorType':
        return { monitorType: AUDIO_MONITOR_OFF }
      default:
        return {}
    }
  })

  on(eventName: string, handler: (event: Record<string, unknown>) => void) {
    this.handlers.set(eventName, handler)
    return this
  }

  emit(eventName: string, event: Record<string, unknown>) {
    this.handlers.get(eventName)?.(event)
  }
}

describe('OBS WebSocket v5リクエスト', () => {
  it('スライドのPREVIOUS/NEXTを正しく生成する', () => {
    expect(mediaActionRequest('スライド', 'previous')).toEqual({
      inputName: 'スライド',
      mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS'
    })
    expect(mediaActionRequest('スライド', 'next')).toEqual({
      inputName: 'スライド',
      mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT'
    })
  })

  it('sceneNameとsceneItemIdで表示状態を切り替える', () => {
    expect(
      sceneItemEnabledRequest(
        {
          sceneName: 'メイン',
          sceneItemId: 42,
          sourceName: 'カメラ',
          enabled: false,
          isGroup: false
        },
        true
      )
    ).toEqual({ sceneName: 'メイン', sceneItemId: 42, sceneItemEnabled: true })
  })

  it('dB値で音量リクエストを生成する', () => {
    expect(inputVolumeRequest('マイク', -12.5)).toEqual({
      inputName: 'マイク',
      inputVolumeDb: -12.5
    })
  })

  it('モニタリングON/OFFのリクエスト値を正しく生成する', () => {
    expect(inputAudioMonitorRequest('マイク', true)).toEqual({
      inputName: 'マイク',
      monitorType: AUDIO_MONITOR_ON
    })
    expect(inputAudioMonitorRequest('マイク', false)).toEqual({
      inputName: 'マイク',
      monitorType: AUDIO_MONITOR_OFF
    })
    expect(isInputAudioMonitoringOn(AUDIO_MONITOR_ONLY)).toBe(true)
  })

  it('OBSイベントによるモニタリング状態変更を同期する', async () => {
    const websocket = new FakeObsWebSocket()
    const controller = new RealObsController(websocket as unknown as OBSWebSocket)
    await controller.refreshInputs()

    websocket.emit('InputAudioMonitorTypeChanged', {
      inputName: 'マイク',
      monitorType: AUDIO_MONITOR_ONLY
    })

    expect(controller.getState().inputs[0]).toMatchObject({
      name: 'マイク',
      monitorType: AUDIO_MONITOR_ONLY
    })
  })

  it('モニタリング取得だけが失敗しても音声入力を残す', async () => {
    const websocket = new FakeObsWebSocket()
    websocket.call.mockImplementation(async (requestType: string) => {
      if (requestType === 'GetInputList') {
        return { inputs: [{ inputName: 'マイク', inputKind: 'wasapi_input_capture' }] }
      }
      if (requestType === 'GetInputMute') return { inputMuted: false }
      if (requestType === 'GetInputVolume') return { inputVolumeDb: -8 }
      if (requestType === 'GetInputAudioMonitorType') throw new Error('unsupported')
      return {}
    })
    const controller = new RealObsController(websocket as unknown as OBSWebSocket)

    await controller.refreshInputs()

    expect(controller.getState().inputs).toEqual([
      expect.objectContaining({ name: 'マイク', isAudio: true, monitorType: undefined })
    ])
  })
})
