import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DevicePairing } from './device-pairing'
import { createProfile } from '../lib/settings'
import { readRegistration, saveRegistration } from '../lib/device-registration'
const url = 'https://pc.example.ts.net/panel'
const link = `https://aominn.github.io/obs-remote-panel/#pair=${btoa(JSON.stringify({ url, invite: 'i'.repeat(43) }))}`
beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('requires explicit request, shows confirmation number, stores only after approval', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-device', code: '123456', expires: Date.now() + 120000 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ approved: false })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ approved: true, hubName: '機材PC' })))
  vi.stubGlobal('fetch', fetcher)
  const registered = vi.fn()
  render(<DevicePairing initialLink={link} profile={createProfile()} mockMode={false} onRegistered={registered} updateProfile={vi.fn()} onForget={vi.fn()} />)
  expect(fetcher).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'この端末の登録を申請' })) })
  expect(screen.getByText('123456')).toBeVisible()
  expect(readRegistration(url)).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(registered).toHaveBeenCalledWith(url, '機材PC')
  expect(readRegistration(url)?.id).toBe('new-device')
  expect(screen.getByText(/登録しました/)).toBeVisible()
})
it('registered devices can forget local access and disconnect without exposing the token', async () => {
  const user = userEvent.setup()
  const profile = { ...createProfile(), hub: { url } }
  const token = 's'.repeat(43)
  saveRegistration(url, { id: 'device', token, name: 'phone' })
  const forget = vi.fn()
  const { container } = render(<DevicePairing initialLink="" profile={profile} mockMode={false} onRegistered={vi.fn()} updateProfile={vi.fn()} onForget={forget} />)
  expect(container.textContent).not.toContain(token)
  await user.click(screen.getByRole('button', { name: 'この端末の登録情報を忘れる' }))
  expect(readRegistration(url)).toBeNull()
  expect(forget).toHaveBeenCalledOnce()
})
