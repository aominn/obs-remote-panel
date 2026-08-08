import { describe, expect, it } from 'vitest'
import {
  inputVolumeRequest,
  mediaActionRequest,
  sceneItemEnabledRequest
} from './obs-controller'

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
})
