import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../lib/settings'
import { MockObsController } from '../services/mock-obs-controller'
import { EMPTY_OBS_STATE } from '../types'
import { QuickTab } from './quick-tab'

describe('クイック操作の安全性', () => {
  it('OBS未接続時は操作ボタンを無効化する', () => {
    const settings = createDefaultSettings()
    render(
      <QuickTab
        profile={settings.profiles[0]}
        settings={settings}
        obsState={EMPTY_OBS_STATE}
        controller={new MockObsController()}
        updateProfile={() => undefined}
        reportError={() => undefined}
      />
    )
    expect(screen.getByRole('button', { name: '前のスライド' })).toBeDisabled()
    expect(screen.getByText('OBS未接続のため操作ボタンは無効です。')).toBeVisible()
  })

  it('カードごとに指定した別々のスライドショーを操作する', async () => {
    const user = userEvent.setup()
    const settings = createDefaultSettings()
    const profile = {
      ...settings.profiles[0],
      quickActions: [
        {
          id: 'first',
          kind: 'slide-previous' as const,
          label: '画像を前へ',
          color: '#000000',
          target: '画像スライドショー'
        },
        {
          id: 'second',
          kind: 'slide-next' as const,
          label: '資料を次へ',
          color: '#000000',
          target: '資料スライドショー'
        }
      ]
    }
    const controller = new MockObsController()
    await controller.connect(profile)
    const triggerSlide = vi.spyOn(controller, 'triggerSlide')

    render(
      <QuickTab
        profile={profile}
        settings={settings}
        obsState={controller.getState()}
        controller={controller}
        updateProfile={() => undefined}
        reportError={() => undefined}
      />
    )

    await user.click(screen.getByRole('button', { name: /画像を前へ/ }))
    await user.click(screen.getByRole('button', { name: /資料を次へ/ }))
    expect(triggerSlide).toHaveBeenNthCalledWith(1, '画像スライドショー', 'previous')
    expect(triggerSlide).toHaveBeenNthCalledWith(2, '資料スライドショー', 'next')
  })

  it('対象がOBSに存在しないスライドカードを無効化する', async () => {
    const settings = createDefaultSettings()
    const profile = {
      ...settings.profiles[0],
      quickActions: [{
        id: 'missing',
        kind: 'slide-next' as const,
        label: '削除済みを次へ',
        color: '#000000',
        target: '削除済みスライド'
      }]
    }
    const controller = new MockObsController()
    await controller.connect(profile)

    render(
      <QuickTab
        profile={profile}
        settings={settings}
        obsState={controller.getState()}
        controller={controller}
        updateProfile={() => undefined}
        reportError={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: /削除済みを次へ/ })).toBeDisabled()
    expect(screen.getAllByText(/対象が見つからないスライド操作は無効/).at(-1)).toBeVisible()
  })
})
