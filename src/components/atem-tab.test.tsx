import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
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
