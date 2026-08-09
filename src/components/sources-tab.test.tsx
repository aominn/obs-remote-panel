import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createProfile } from '../lib/settings'
import { MockObsController } from '../services/mock-obs-controller'
import { SourcesTab } from './sources-tab'

describe('ソース画面のスライドショー操作', () => {
  it('slideshow_v2のソースだけに操作を表示し、正しい対象へ送信する', async () => {
    const user = userEvent.setup()
    const controller = new MockObsController()
    const profile = { ...createProfile(), selectedSourceScene: '資料共有' }
    await controller.connect(profile)
    await controller.refreshSources('資料共有')
    const triggerSlide = vi.spyOn(controller, 'triggerSlide')

    render(
      <SourcesTab
        profile={profile}
        obsState={controller.getState()}
        controller={controller}
        updateProfile={() => undefined}
        reportError={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: '資料スライドショーを前へ' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'スライド背景画像を次へ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'レーザーポインターを次へ' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '資料スライドショーを次へ' }))
    expect(triggerSlide).toHaveBeenCalledWith('資料スライドショー', 'next')
  })

  it('グループ内のslideshow_v2にも操作を表示する', async () => {
    const controller = new MockObsController()
    const profile = { ...createProfile(), selectedSourceScene: 'メインカメラ' }
    await controller.connect(profile)
    await controller.refreshSources('メインカメラ')

    render(
      <SourcesTab
        profile={profile}
        obsState={controller.getState()}
        controller={controller}
        updateProfile={() => undefined}
        reportError={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: 'グループ内スライドを次へ' })).toBeVisible()
  })
})
