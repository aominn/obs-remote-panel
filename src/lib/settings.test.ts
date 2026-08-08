import { describe, expect, it } from 'vitest'
import {
  createDefaultSettings,
  exportSettings,
  importSettings,
  loadSettings,
  SETTINGS_STORAGE_KEY,
  validateObsUrl
} from './settings'

describe('ローカル設定', () => {
  it('壊れたJSONでも安全な初期設定へ戻る', () => {
    const settings = loadSettings({
      getItem: (key) => (key === SETTINGS_STORAGE_KEY ? '{broken' : null)
    })
    expect(settings.schemaVersion).toBe(1)
    expect(settings.profiles).toHaveLength(1)
  })

  it('未知のschemaVersionでも安全な初期設定へ戻る', () => {
    const settings = loadSettings({ getItem: () => JSON.stringify({ schemaVersion: 99 }) })
    expect(settings.schemaVersion).toBe(1)
    expect(settings.profiles[0].name).toBe('自宅OBS')
  })

  it('壊れた内部配列でも白画面にせず初期設定へ戻る', () => {
    const broken = createDefaultSettings()
    broken.profiles[0].quickActions = [{ broken: true }] as never
    const settings = loadSettings({ getItem: () => JSON.stringify(broken) })
    expect(settings.profiles[0].quickActions[0].kind).toBe('slide-previous')
  })

  it('標準エクスポートとインポートからパスワードを除外する', () => {
    const settings = createDefaultSettings()
    settings.profiles[0].password = 'never-export-me'
    const json = exportSettings(settings)
    expect(json).not.toContain('never-export-me')
    expect(importSettings(json).profiles[0].password).toBe('')
  })

  it('本番接続先はWSSだけを受理する', () => {
    expect(validateObsUrl('wss://obs.example.ts.net/', false)).toBeNull()
    expect(validateObsUrl('ws://100.64.0.1:4455', false)).toContain('wss://')
    expect(validateObsUrl('not-a-url', false)).toContain('形式')
  })
})
