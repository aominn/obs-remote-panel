import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createProfile } from '../lib/settings'
import {
  AUDIO_MONITOR_OFF,
  AUDIO_MONITOR_ON,
  type ObsController
} from '../services/obs-controller'
import { EMPTY_OBS_STATE } from '../types'
import { AudioTab } from './audio-tab'

describe('音声モニタリング操作', () => {
  it('ON/OFFを文字とaria-pressedで表示し、選択中の入力だけを切り替える', async () => {
    const user = userEvent.setup()
    const profile = { ...createProfile(), selectedAudioInput: 'マイク' }
    const setInputAudioMonitoring = vi.fn().mockResolvedValue(undefined)
    const controller = { setInputAudioMonitoring } as unknown as ObsController
    const baseState = {
      ...EMPTY_OBS_STATE,
      connectionStatus: 'connected' as const,
      inputs: [{
        name: 'マイク',
        kind: 'wasapi_input_capture',
        muted: false,
        volumeDb: -8,
        isAudio: true,
        monitorType: AUDIO_MONITOR_OFF
      }]
    }
    const props = {
      profile,
      controller,
      updateProfile: vi.fn(),
      reportError: vi.fn()
    }
    const { rerender } = render(<AudioTab {...props} obsState={baseState} />)

    const offButton = screen.getByRole('button', { name: 'モニタリング OFF' })
    expect(offButton).toHaveAttribute('aria-pressed', 'false')
    await user.click(offButton)
    expect(setInputAudioMonitoring).toHaveBeenCalledWith('マイク', true)

    rerender(
      <AudioTab
        {...props}
        obsState={{
          ...baseState,
          inputs: [{ ...baseState.inputs[0], monitorType: AUDIO_MONITOR_ON }]
        }}
      />
    )
    const onButton = screen.getByRole('button', { name: 'モニタリング ON' })
    expect(onButton).toHaveAttribute('aria-pressed', 'true')
    await user.click(onButton)
    expect(setInputAudioMonitoring).toHaveBeenLastCalledWith('マイク', false)
  })

  it('処理中はボタンを無効化して連打を防ぐ', async () => {
    const user = userEvent.setup()
    const profile = { ...createProfile(), selectedAudioInput: 'マイク' }
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const setInputAudioMonitoring = vi.fn(() => pending)
    const controller = { setInputAudioMonitoring } as unknown as ObsController
    render(
      <AudioTab
        profile={profile}
        obsState={{
          ...EMPTY_OBS_STATE,
          connectionStatus: 'connected',
          inputs: [{
            name: 'マイク',
            kind: 'wasapi_input_capture',
            muted: false,
            volumeDb: -8,
            isAudio: true,
            monitorType: AUDIO_MONITOR_OFF
          }]
        }}
        controller={controller}
        updateProfile={() => undefined}
        reportError={() => undefined}
      />
    )

    const button = screen.getByRole('button', { name: 'モニタリング OFF' })
    await user.click(button)
    expect(button).toBeDisabled()
    expect(setInputAudioMonitoring).toHaveBeenCalledTimes(1)
    finish()
  })
})
