import { describe, expect, it } from 'vitest'
import { createDefaultSettings, loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from './settings'

const OLD_V1_KINDS = new Set([
  'scene', 'slide-previous', 'slide-next', 'mute', 'source-visibility', 'record', 'stream',
  'virtual-camera', 'replay-buffer', 'replay-save', 'studio-transition'
])

function oldV1Accepts(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as Record<string, unknown>
  if (settings.schemaVersion !== 1 || !Array.isArray(settings.profiles) || settings.profiles.length === 0) return false
  const profiles = settings.profiles as Record<string, unknown>[]
  const validProfiles = profiles.every((profile) =>
    typeof profile.id === 'string' && typeof profile.name === 'string' && typeof profile.url === 'string' &&
    typeof profile.password === 'string' && typeof profile.autoReconnect === 'boolean' &&
    typeof profile.selectedSlideshowInput === 'string' && Array.isArray(profile.favoriteScenes) &&
    Array.isArray(profile.favoriteAudioInputs) && Array.isArray(profile.sceneOrder) &&
    Array.isArray(profile.hiddenScenes) && Array.isArray(profile.visibleDetailActions) &&
    typeof profile.updatedAt === 'string' && Array.isArray(profile.quickActions) &&
    (profile.quickActions as Record<string, unknown>[]).every((action) =>
      typeof action.id === 'string' && typeof action.kind === 'string' && OLD_V1_KINDS.has(action.kind) &&
      typeof action.label === 'string' && typeof action.color === 'string' &&
      (action.target === undefined || typeof action.target === 'string')))
  const ui = settings.ui as Record<string, unknown> | undefined
  return validProfiles && typeof settings.activeProfileId === 'string' &&
    profiles.some((profile) => profile.id === settings.activeProfileId) && Boolean(ui) &&
    typeof ui!.confirmDangerousActions === 'boolean' && typeof ui!.syncPasswords === 'boolean' &&
    Number.isInteger(settings.revision) && typeof settings.updatedAt === 'string'
}

describe('v1 quick-action compatibility', () => {
  it.each([undefined, false, true])('keeps profiles valid for old clients and restores ATEM action order (oneTap=%s)', (oneTap) => {
    const settings = createDefaultSettings()
    const originalProfileId = settings.profiles[0].id
    settings.profiles[0].quickActions = [
      { id: 'scene', kind: 'scene', label: 'Scene', color: '#111111', target: 'A' },
      { id: 'program', kind: 'atem-program', label: 'Program', color: '#222222', target: '2', ...(oneTap === undefined ? {} : { oneTap }) },
      { id: 'record', kind: 'record', label: 'Record', color: '#333333' },
      { id: 'cut', kind: 'atem-cut', label: 'CUT', color: '#444444' }
    ]
    const entries = new Map<string, string>()
    const storage = { getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) } }

    expect(saveSettings(settings, storage)).toBe(true)
    const persisted = JSON.parse(entries.get(SETTINGS_STORAGE_KEY)!)
    expect(oldV1Accepts(persisted)).toBe(true)
    expect(persisted.profiles[0].id).toBe(originalProfileId)
    expect(persisted.profiles[0].quickActions.map((action: { id: string }) => action.id)).toEqual(['scene', 'record'])
    expect(loadSettings(storage).profiles[0].quickActions).toEqual(settings.profiles[0].quickActions)
  })
})
