import { describe, expect, it, vi } from 'vitest'
import { loadActiveTab, saveActiveTab } from './view-state'

describe('画面の選択状態', () => {
  it('有効なメインタブを保存して復元する', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }

    expect(loadActiveTab(storage)).toBe('quick')
    expect(saveActiveTab('sources', storage)).toBe(true)
    expect(loadActiveTab(storage)).toBe('sources')
  })

  it('壊れた値やStorage例外ではクイックへ安全に戻る', () => {
    expect(loadActiveTab({ getItem: () => 'unknown' })).toBe('quick')
    expect(loadActiveTab({ getItem: () => { throw new Error('blocked') } })).toBe('quick')
    expect(saveActiveTab('audio', { setItem: vi.fn(() => { throw new Error('blocked') }) })).toBe(false)
  })
})
