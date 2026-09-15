import type { ConnectionProfile } from '../types'
import { createDefaultSettings, validateSettings } from './settings'
const fields = ['name', 'quickActions', 'favoriteScenes', 'favoriteAudioInputs', 'sceneOrder', 'hiddenScenes',
  'visibleDetailActions', 'selectedSlideshowInput', 'selectedSourceScene', 'selectedAudioInput'] as const
export function sharedOperations(profile: ConnectionProfile) {
  return Object.fromEntries(fields.filter((key) => profile[key] !== undefined).map((key) => [key, profile[key]]))
}
export function applySharedOperations(profile: ConnectionProfile, value: unknown): ConnectionProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('共有設定の形式が不正です。')
  const record = value as Record<string, unknown>
  const next = { ...profile, ...Object.fromEntries(fields.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])) }
  if (!validateSettings({ ...createDefaultSettings(), profiles: [next], activeProfileId: next.id })) throw new Error('共有設定の形式が不正です。')
  return next
}
