import type { AppSettings, ConnectionProfile, QuickAction } from '../types'

export const SETTINGS_STORAGE_KEY = 'obs-remote-panel.settings.v1'

const now = () => new Date().toISOString()

const id = () => crypto.randomUUID()

export const DEFAULT_QUICK_ACTIONS = (): QuickAction[] => [
  { id: id(), kind: 'slide-previous', label: '前のスライド', color: '#4e78d0' },
  { id: id(), kind: 'slide-next', label: '次のスライド', color: '#2aa879' },
  { id: id(), kind: 'record', label: '録画', color: '#c84b56' },
  { id: id(), kind: 'stream', label: '配信', color: '#a75bd6' }
]

export function createProfile(name = '自宅OBS'): ConnectionProfile {
  return {
    id: id(),
    name,
    url: '',
    password: '',
    autoReconnect: true,
    selectedSlideshowInput: '',
    favoriteScenes: [],
    favoriteAudioInputs: [],
    sceneOrder: [],
    hiddenScenes: [],
    quickActions: DEFAULT_QUICK_ACTIONS(),
    visibleDetailActions: [
      'stream',
      'record',
      'virtual-camera',
      'replay-buffer',
      'studio-mode',
      'stats'
    ],
    updatedAt: now()
  }
}

export function createDefaultSettings(): AppSettings {
  const profile = createProfile()
  return {
    schemaVersion: 1,
    profiles: [profile],
    activeProfileId: profile.id,
    ui: {
      confirmDangerousActions: true,
      syncPasswords: false
    },
    revision: 0,
    updatedAt: now()
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const QUICK_ACTION_KINDS = new Set([
  'scene',
  'slide-previous',
  'slide-next',
  'mute',
  'source-visibility',
  'record',
  'stream',
  'virtual-camera',
  'replay-buffer',
  'replay-save',
  'studio-transition'
])

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isQuickAction(value: unknown): value is QuickAction {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    QUICK_ACTION_KINDS.has(value.kind) &&
    typeof value.label === 'string' &&
    typeof value.color === 'string' &&
    (value.target === undefined || typeof value.target === 'string')
  )
}

function isProfile(value: unknown): value is ConnectionProfile {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    typeof value.password === 'string' &&
    typeof value.autoReconnect === 'boolean' &&
    typeof value.selectedSlideshowInput === 'string' &&
    isStringArray(value.favoriteScenes) &&
    isStringArray(value.favoriteAudioInputs) &&
    isStringArray(value.sceneOrder) &&
    isStringArray(value.hiddenScenes) &&
    Array.isArray(value.quickActions) &&
    value.quickActions.every(isQuickAction) &&
    isStringArray(value.visibleDetailActions) &&
    typeof value.updatedAt === 'string'
  )
}

export function validateSettings(value: unknown): value is AppSettings {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.profiles)) {
    return false
  }
  return (
    value.profiles.length > 0 &&
    value.profiles.every(isProfile) &&
    typeof value.activeProfileId === 'string' &&
    value.profiles.some((profile) => profile.id === value.activeProfileId) &&
    isObject(value.ui) &&
    typeof value.ui.confirmDangerousActions === 'boolean' &&
    typeof value.ui.syncPasswords === 'boolean' &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.updatedAt === 'string'
  )
}

export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): AppSettings {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return createDefaultSettings()
    const parsed: unknown = JSON.parse(raw)
    return validateSettings(parsed) ? parsed : createDefaultSettings()
  } catch {
    return createDefaultSettings()
  }
}

export function saveSettings(
  settings: AppSettings,
  storage: Pick<Storage, 'setItem'> = localStorage
): boolean {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

export function touchSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    revision: settings.revision + 1,
    updatedAt: now()
  }
}

export function withoutSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => ({ ...profile, password: '' }))
  }
}

export function exportSettings(settings: AppSettings): string {
  return JSON.stringify(withoutSecrets(settings), null, 2)
}

export function importSettings(json: string): AppSettings {
  const parsed: unknown = JSON.parse(json)
  if (!validateSettings(parsed)) {
    throw new Error('設定ファイルの形式またはschemaVersionが不正です。')
  }
  return touchSettings(withoutSecrets(parsed))
}

export function mergeCloudSettings(local: AppSettings, cloud: AppSettings): AppSettings {
  if (!validateSettings(cloud)) throw new Error('クラウド設定の形式が不正です。')
  const passwords = new Map(local.profiles.map((profile) => [profile.id, profile.password]))
  return {
    ...cloud,
    profiles: cloud.profiles.map((profile) => ({
      ...profile,
      password: passwords.get(profile.id) ?? ''
    }))
  }
}

export function getPasswordSecrets(settings: AppSettings): Record<string, string> {
  return Object.fromEntries(
    settings.profiles
      .filter((profile) => profile.password.length > 0)
      .map((profile) => [profile.id, profile.password])
  )
}

export function applyPasswordSecrets(
  settings: AppSettings,
  secrets: Record<string, string>
): AppSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => ({
      ...profile,
      password: secrets[profile.id] ?? profile.password
    }))
  }
}

export function validateObsUrl(url: string, allowInsecure = import.meta.env.DEV): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'wss:') return null
    if (allowInsecure && parsed.protocol === 'ws:') return null
    return '本番ではtailnet内の wss:// URLを指定してください。'
  } catch {
    return '接続先URLの形式が正しくありません。'
  }
}
