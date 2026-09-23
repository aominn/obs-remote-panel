import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../lib/settings'
import { AtemController } from '../services/atem-controller'
import { MockObsController } from '../services/mock-obs-controller'
import { EMPTY_OBS_STATE, type ConnectionProfile } from '../types'
import { QuickTab } from './quick-tab'

afterEach(() => vi.restoreAllMocks())

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('クイック操作の安全性', () => {
  it('OBS未接続時は操作ボタンを無効化する', () => {
    const settings = createDefaultSettings()
    render(
      <QuickTab
        profile={settings.profiles[0]}
        settings={settings}
        obsState={EMPTY_OBS_STATE}
        controller={new MockObsController()}
        atemController={new AtemController(true)}
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
        atemController={new AtemController(true)}
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
        atemController={new AtemController(true)}
        updateProfile={() => undefined}
        reportError={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: /削除済みを次へ/ })).toBeDisabled()
    expect(screen.getAllByText(/対象が見つからないスライド操作は無効/).at(-1)).toBeVisible()
  })

  it('ATEM入力一覧からPROGRAM操作を登録できる', async () => {
    const user = userEvent.setup()
    const settings = createDefaultSettings()
    const profile = { ...settings.profiles[0], quickActions: [] }
    const atemController = new AtemController(true)
    await atemController.connect('', '')
    let updated: ConnectionProfile = profile

    render(
      <QuickTab
        profile={profile}
        settings={settings}
        obsState={EMPTY_OBS_STATE}
        controller={new MockObsController()}
        atemController={atemController}
        updateProfile={(updater) => { updated = updater(updated) }}
        reportError={() => undefined}
      />
    )

    await user.click(screen.getByRole('button', { name: '配置を編集' }))
    await user.selectOptions(screen.getByLabelText('操作'), 'atem-program')
    expect(screen.getByRole('option', { name: 'HDMI 1' })).toHaveValue('1')
    await user.selectOptions(screen.getByLabelText('対象'), '2')
    await user.click(screen.getByRole('button', { name: '追加' }))

    expect(updated.quickActions).toEqual([
      expect.objectContaining({ kind: 'atem-program', target: '2' })
    ])
  })

  it('PROGRAMは確認後に実行し、PREVIEWは確認なしで実行する', async () => {
    const user = userEvent.setup()
    const settings = createDefaultSettings()
    const profile = { ...settings.profiles[0], quickActions: [
      { id: 'program', kind: 'atem-program' as const, label: '本番2', color: '#000000', target: '2' },
      { id: 'preview', kind: 'atem-preview' as const, label: '次は3', color: '#000000', target: '3' }
    ] }
    const atemController = new AtemController(true)
    await atemController.connect('', '')
    const command = vi.spyOn(atemController, 'command')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <QuickTab profile={profile} settings={settings} obsState={EMPTY_OBS_STATE}
        controller={new MockObsController()} atemController={atemController}
        updateProfile={() => undefined} reportError={() => undefined} />
    )

    await user.click(screen.getByRole('button', { name: /本番2/ }))
    await user.click(screen.getByRole('button', { name: /次は3/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenNthCalledWith(1, 'program', 2)
    expect(command).toHaveBeenNthCalledWith(2, 'preview', 3)
  })

  it('CUTとAUTOは対象なしで登録済み操作を実行し、確認キャンセルも尊重する', async () => {
    const user = userEvent.setup()
    const settings = createDefaultSettings()
    const profile = { ...settings.profiles[0], quickActions: [
      { id: 'cut', kind: 'atem-cut' as const, label: '切替', color: '#000000' },
      { id: 'auto', kind: 'atem-auto' as const, label: '自動切替', color: '#000000' }
    ] }
    const atemController = new AtemController(true)
    await atemController.connect('', '')
    const command = vi.spyOn(atemController, 'command')
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    render(
      <QuickTab profile={profile} settings={settings} obsState={EMPTY_OBS_STATE}
        controller={new MockObsController()} atemController={atemController}
        updateProfile={() => undefined} reportError={() => undefined} />
    )

    await user.click(screen.getByRole('button', { name: '切替' }))
    await user.click(screen.getByRole('button', { name: '自動切替' }))
    expect(command).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenCalledWith('auto')
  })

  it('ATEM未接続時はATEM操作だけを無効化し、自動接続しない', async () => {
    const settings = createDefaultSettings()
    const profile = { ...settings.profiles[0], quickActions: [
      { id: 'cut', kind: 'atem-cut' as const, label: 'ATEM切替', color: '#000000' }
    ] }
    const atemController = new AtemController(true)
    const connect = vi.spyOn(atemController, 'connect')

    render(
      <QuickTab profile={profile} settings={settings} obsState={EMPTY_OBS_STATE}
        controller={new MockObsController()} atemController={atemController}
        updateProfile={() => undefined} reportError={() => undefined} />
    )

    expect(screen.getByRole('button', { name: 'ATEM切替' })).toBeDisabled()
    expect(screen.getByText(/ATEM未接続、または操作中/)).toBeVisible()
    expect(connect).not.toHaveBeenCalled()
  })
})
