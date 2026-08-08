import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
