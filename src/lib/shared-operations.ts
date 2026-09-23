import type { ConnectionProfile } from '../types'
import { compatibleSettings, createDefaultSettings, restoreCompatibleSettings, validateSettings } from './settings'
const fields = ['name', 'quickActions', 'favoriteScenes', 'favoriteAudioInputs', 'sceneOrder', 'hiddenScenes',
  'visibleDetailActions', 'selectedSlideshowInput', 'selectedSourceScene', 'selectedAudioInput'] as const
export function sharedOperations(profile: ConnectionProfile) {
  const serialized = compatibleSettings({ ...createDefaultSettings(), profiles: [profile], activeProfileId: profile.id }).profiles[0]
  const transferableFields = [...fields, 'atemQuickActions' as const]
  return Object.fromEntries(transferableFields.filter((key) => serialized[key] !== undefined)
    .map((key) => [key, serialized[key]]))
}
export function applySharedOperations(profile: ConnectionProfile, value: unknown): ConnectionProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('共有設定の形式が不正です。')
  const record = value as Record<string, unknown>
  const transferableFields = [...fields, 'atemQuickActions' as const]
  const next = { ...profile, ...Object.fromEntries(transferableFields.filter((key) => record[key] !== undefined)
    .map((key) => [key, record[key]])) }
  if (!validateSettings({ ...createDefaultSettings(), profiles: [next], activeProfileId: next.id })) throw new Error('共有設定の形式が不正です。')
  return restoreCompatibleSettings({ ...createDefaultSettings(), profiles: [next], activeProfileId: next.id }).profiles[0]
}
