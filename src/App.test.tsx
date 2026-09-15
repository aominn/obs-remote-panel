import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { createDefaultSettings, createProfile, SETTINGS_STORAGE_KEY } from './lib/settings'
import { AtemController } from './services/atem-controller'
import App from './App'

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn()
  })
}))

describe('ローカル専用モード', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

  it('Supabase未設定でも白画面にならず起動する', () => {
    render(<App />)
    expect(screen.getByText('OBS Remote Panel')).toBeVisible()
    expect(screen.getByText('クイック操作')).toBeVisible()
  })

  it('environment changes disconnect ATEM without reconnecting or switching hardware', async () => {
    const settings = createDefaultSettings()
    const other = createProfile('会場B')
    other.atem = { url: 'https://other.example.ts.net/atem' }
    settings.profiles.push(other)
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    window.history.replaceState({}, '', '/?mock=1')
    const connect = vi.spyOn(AtemController.prototype, 'connect')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /ATEM$/ }))
    await user.click(screen.getByRole('button', { name: 'ATEMに接続' }))
    expect(screen.getByRole('button', { name: 'CUT' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /接続・同期$/ }))
    await user.selectOptions(screen.getByLabelText('プロファイル', { exact: true }), other.id)
    await user.click(screen.getByRole('button', { name: /ATEM$/ }))
    expect(screen.getByRole('button', { name: 'CUT' })).toBeDisabled()
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('cancelled import leaves the current environment unchanged', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: /接続・同期$/ }))
    const imported = createDefaultSettings()
    imported.profiles[0].name = '取り込まない環境'
    const file = new File([JSON.stringify(imported)], 'settings.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(imported) })
    await user.upload(container.querySelector('input[type=file]')!, file)
    expect(window.confirm).toHaveBeenCalled()
    expect(screen.getByLabelText('プロファイル名')).not.toHaveValue('取り込まない環境')
  })
})
