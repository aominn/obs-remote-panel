import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('Supabase未設定でも白画面にならず起動する', () => {
    render(<App />)
    expect(screen.getByText('OBS Remote Panel')).toBeVisible()
    expect(screen.getByText('クイック操作')).toBeVisible()
  })
})
