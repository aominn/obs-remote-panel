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

describe('per-button PROGRAM confirmation', () => {
  async function setup(kind: ConnectionProfile['quickActions'][number]['kind'] = 'atem-program',
    oneTap?: boolean, block?: string, confirmDangerousActions = true) {
    const settings = createDefaultSettings()
    settings.ui.confirmDangerousActions = confirmDangerousActions
    let profile: ConnectionProfile = { ...settings.profiles[0], quickActions: [
      { id: 'action', kind, label: 'Action', color: '#123456', target: '2',
        ...(oneTap === undefined ? {} : { oneTap }) }
    ] }
    const atemController = new AtemController(true)
    if (block !== 'disconnected') await atemController.connect('', '')
    const state = { ...atemController.getState(),
      ...(block === 'busy' ? { busy: true } : {}),
      ...(block === 'transition' ? { transitioning: true } : {}),
      ...(block === 'missing' ? { inputs: [] } : {}) }
    vi.spyOn(atemController, 'getState').mockReturnValue(state)
    const connect = vi.spyOn(atemController, 'connect')
    const command = vi.spyOn(atemController, 'command').mockResolvedValue()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const controller = new MockObsController()
    const record = vi.spyOn(controller, 'toggleRecord').mockResolvedValue()
    const view = () => <QuickTab profile={profile} settings={settings}
      obsState={{ ...EMPTY_OBS_STATE, connectionStatus: 'connected' }}
      controller={controller} atemController={atemController}
      updateProfile={(updater) => { profile = updater(profile); rendered.rerender(view()) }}
      reportError={() => undefined} />
    const rendered = render(view())
    return { user: userEvent.setup(), command, confirm, connect, record, profile: () => profile }
  }

  it.each([undefined, false, true])('PROGRAM oneTap=%s', async (oneTap) => {
    const { user, command, confirm } = await setup('atem-program', oneTap)
    await user.click(screen.getByRole('button', { name: /Action/ }))
    expect(confirm).toHaveBeenCalledTimes(oneTap === true ? 0 : 1)
    expect(command).toHaveBeenCalledExactlyOnceWith('program', 2)
  })

  it('respects global confirmation OFF', async () => {
    const { user, command, confirm } = await setup('atem-program', false, undefined, false)
    await user.click(screen.getByRole('button', { name: /Action/ }))
    expect(confirm).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledExactlyOnceWith('program', 2)
  })

  it.each(['atem-program', 'atem-cut', 'atem-auto'] as const)('cancels %s safely', async (kind) => {
    const { user, command, confirm } = await setup(kind, kind !== 'atem-program')
    confirm.mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: /Action/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(command).not.toHaveBeenCalled()
  })

  it.each(['atem-cut', 'atem-auto'] as const)('stray flag does not bypass %s', async (kind) => {
    const { user, command, confirm } = await setup(kind, true)
    await user.click(screen.getByRole('button', { name: /Action/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenCalledExactlyOnceWith(kind === 'atem-cut' ? 'cut' : 'auto')
  })

  it('PREVIEW needs no confirmation', async () => {
    const { user, command, confirm } = await setup('atem-preview', true)
    await user.click(screen.getByRole('button', { name: /Action/ }))
    expect(confirm).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledExactlyOnceWith('preview', 2)
  })

  it('OBS dangerous actions still confirm with a stray flag', async () => {
    const { user, record, confirm } = await setup('record', true)
    confirm.mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: /Action/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(record).not.toHaveBeenCalled()
  })

  it.each(['disconnected', 'missing', 'busy', 'transition'])('blocks one-tap when %s', async (block) => {
    const { user, command, confirm, connect } = await setup('atem-program', true, block)
    const button = screen.getByRole('button', { name: /Action/ })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(command).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('edits only the PROGRAM flag, defaults OFF and can turn it OFF again', async () => {
    const { user, profile, command } = await setup()
    const original = { ...profile().quickActions[0] }
    await user.click(screen.getByRole('button', { name: '配置を編集' }))
    const checkbox = screen.getByRole('checkbox', { name: '確認なしで1タップ実行' })
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('ONにするとこのボタンは確認なしでATEMの本番出力を切り替えます。')).toBeVisible()
    await user.click(checkbox)
    expect(profile().quickActions).toEqual([{ ...original, oneTap: true }])
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    expect(profile().quickActions).toEqual([{ ...original, oneTap: false }])
    expect(command).not.toHaveBeenCalled()
  })

  it.each(['atem-preview', 'atem-cut', 'atem-auto', 'record'] as const)('does not offer one-tap for %s', async (kind) => {
    const { user } = await setup(kind)
    await user.click(screen.getByRole('button', { name: '配置を編集' }))
    expect(screen.queryByRole('checkbox', { name: '確認なしで1タップ実行' })).not.toBeInTheDocument()
  })

  it('keeps confirmation independent for two PROGRAM buttons after editing', async () => {
    const settings = createDefaultSettings()
    let profile: ConnectionProfile = { ...settings.profiles[0], quickActions: [
      { id: 'one', kind: 'atem-program', label: 'PC1', color: '#123456', target: '1' },
      { id: 'two', kind: 'atem-program', label: 'PC2', color: '#654321', target: '2' }
    ] }
    const original = structuredClone(profile.quickActions)
    const atemController = new AtemController(true)
    await atemController.connect('', '')
    const command = vi.spyOn(atemController, 'command').mockResolvedValue()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const controller = new MockObsController()
    const view = () => <QuickTab profile={profile} settings={settings} obsState={EMPTY_OBS_STATE}
      controller={controller} atemController={atemController}
      updateProfile={(updater) => { profile = updater(profile); rendered.rerender(view()) }}
      reportError={() => undefined} />
    const rendered = render(view())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '配置を編集' }))
    const toggles = screen.getAllByRole('checkbox', { name: '確認なしで1タップ実行' })
    expect(toggles).toHaveLength(2)
    await user.click(toggles[1])
    expect(profile.quickActions).toEqual([original[0], { ...original[1], oneTap: true }])
    expect(settings.ui.confirmDangerousActions).toBe(true)
    await user.click(screen.getByRole('button', { name: '編集を完了' }))
    await user.click(screen.getByRole('button', { name: /PC2/ }))
    expect(confirm).not.toHaveBeenCalled()
    expect(command).toHaveBeenNthCalledWith(1, 'program', 2)
    await user.click(screen.getByRole('button', { name: /PC1/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenNthCalledWith(2, 'program', 1)
    expect(command).toHaveBeenCalledTimes(2)
  })
})
