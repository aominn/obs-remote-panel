import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { createProfile } from '../lib/settings'
import type { ConnectionProfile } from '../types'
import { AtemController } from '../services/atem-controller'
import { AtemTab } from './atem-tab'

afterEach(cleanup)

it('ATEM input buses, CUT/AUTO and disconnected controls', async () => {
  const user = userEvent.setup()
  const controller = new AtemController(true)
  render(<AtemTab controller={controller} mockMode />)
  expect(screen.getByRole('button', { name: 'CUT' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'ATEMに接続' }))
  expect(screen.getByRole('button', { name: '本番 HDMI 1' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'プレビュー HDMI 4' }))
  expect(controller.getState().program).toBe(1)
  await user.click(screen.getByRole('button', { name: 'CUT' }))
  expect(screen.getByRole('button', { name: '本番 HDMI 4' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'AUTO' }))
  expect(controller.getState().program).toBe(1)
  act(() => controller.disconnect())
  expect(screen.getByRole('button', { name: 'AUTO' })).toBeDisabled()
})

it('uses the saved profile key, supports forgetting it and clears it when URL changes', async () => {
  const user = userEvent.setup()
  const controller = new AtemController(true)
  const connect = vi.spyOn(controller, 'connect').mockResolvedValue(undefined)
  const initial = createProfile('会場')
  initial.atem = { url: 'https://pc.example.ts.net/atem', token: 's'.repeat(44) }
  let latest: ConnectionProfile = initial
  function Harness() {
    const [profile, setProfile] = useState(initial)
    latest = profile
    return <AtemTab controller={controller} mockMode={false} profile={profile} updateProfile={setProfile} />
  }
  render(<Harness />)
  expect(screen.getByRole('checkbox')).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'ATEMに接続' }))
  expect(connect).toHaveBeenCalledWith(initial.atem.url, initial.atem.token)
  await user.click(screen.getByRole('checkbox'))
  expect(latest.atem?.token).toBeUndefined()
  await user.type(screen.getByLabelText('接続キー', { exact: true }), 'new-key'.repeat(6))
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'ATEMに接続' }))
  expect(latest.atem?.token).toBe('new-key'.repeat(6))
  await user.clear(screen.getByLabelText('仲介サービスのHTTPS URL'))
  expect(latest.atem?.token).toBeUndefined()
  expect(screen.getByLabelText('接続キー', { exact: true })).toHaveValue('')
})

it('does not save a session-only key or a rejected key', async () => {
  const user = userEvent.setup()
  const controller = new AtemController(true)
  const connect = vi.spyOn(controller, 'connect').mockResolvedValue(undefined)
  const profile = createProfile()
  profile.atem = { url: 'https://pc.example.ts.net/atem' }
  const updateProfile = vi.fn()
  render(<AtemTab controller={controller} mockMode={false} profile={profile} updateProfile={updateProfile} />)
  await user.type(screen.getByLabelText('接続キー', { exact: true }), 'x'.repeat(44))
  await user.click(screen.getByRole('button', { name: 'ATEMに接続' }))
  expect(updateProfile.mock.calls[0][0](profile).atem?.token).toBeUndefined()
  updateProfile.mockClear()
  connect.mockRejectedValue(new Error('Rejected'))
  await user.click(screen.getByRole('checkbox'))
  await user.type(screen.getByLabelText('接続キー', { exact: true }), 'x'.repeat(44))
  await user.click(screen.getByRole('button', { name: 'ATEMに接続' }))
  expect(updateProfile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Rejected')
})
