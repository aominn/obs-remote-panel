import { describe, expect, it } from 'vitest'
import { createProfile } from './settings'
import {
  backfillSlideshowActionTargets,
  slideshowInputs
} from './slideshow'
import type { InputInfo } from '../types'

const input = (name: string, kind: string): InputInfo => ({
  name,
  kind,
  muted: false,
  volumeDb: 0,
  isAudio: false
})

describe('スライドショー対象', () => {
  it('入力種別がslideshow_v2と完全一致する入力だけを候補にする', () => {
    expect(
      slideshowInputs([
        input('資料スライド', 'slideshow_v2'),
        input('slideという名前の静止画像', 'image_source'),
        input('旧スライドショー', 'slideshow')
      ]).map((item) => item.name)
    ).toEqual(['資料スライド'])
  })

  it('対象なしの既存カードだけを既存設定の有効な対象で補完する', () => {
    const profile = createProfile()
    profile.selectedSlideshowInput = '資料スライド'
    profile.quickActions = [
      { id: 'previous', kind: 'slide-previous', label: '前へ', color: '#000000' },
      {
        id: 'next',
        kind: 'slide-next',
        label: '次へ',
        color: '#000000',
        target: '削除済みスライド'
      }
    ]

    const result = backfillSlideshowActionTargets(profile, [
      input('先頭スライド', 'slideshow_v2'),
      input('資料スライド', 'slideshow_v2')
    ])

    expect(result.quickActions[0].target).toBe('資料スライド')
    expect(result.quickActions[1].target).toBe('削除済みスライド')
  })

  it('既存設定の対象が候補にない場合は最初の候補を使い、候補なしでは変更しない', () => {
    const profile = createProfile()
    profile.selectedSlideshowInput = '静止画像'

    expect(
      backfillSlideshowActionTargets(profile, [input('先頭スライド', 'slideshow_v2')])
        .quickActions.slice(0, 2).map((action) => action.target)
    ).toEqual(['先頭スライド', '先頭スライド'])
    expect(backfillSlideshowActionTargets(profile, [input('静止画像', 'image_source')])).toBe(profile)
  })
})
