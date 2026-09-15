import type { AppSettings, ConnectionProfile, QuickAction } from '../types'

export const SETTINGS_STORAGE_KEY = 'obs-remote-panel.settings.v1'
export const ATEM_KEYS_STORAGE_KEY = 'obs-remote-panel.atem-keys.v1'

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
    selectedSourceScene: '',
    selectedAudioInput: '',
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
    (value.hub === undefined || (isObject(value.hub) && typeof value.hub.url === 'string')) &&
    (value.atem === undefined || (isObject(value.atem) && typeof value.atem.url === 'string' &&
      (value.atem.token === undefined || typeof value.atem.token === 'string'))) &&
    typeof value.autoReconnect === 'boolean' &&
    typeof value.selectedSlideshowInput === 'string' &&
    (value.selectedSourceScene === undefined || typeof value.selectedSourceScene === 'string') &&
    (value.selectedAudioInput === undefined || typeof value.selectedAudioInput === 'string') &&
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
    (value.ui.syncAtemKeys === undefined || typeof value.ui.syncAtemKeys === 'boolean') &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.updatedAt === 'string'
  )
}

export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): AppSettings {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : createDefaultSettings()
    const settings = validateSettings(parsed) ? parsed : createDefaultSettings()
    // Migrate the old browser-wide URL once, into the active environment only.
    const legacyUrl = storage.getItem('obs-remote-panel.atem-url')
    if (legacyUrl && /^https?:\/\//.test(legacyUrl) && !settings.profiles.some((profile) => profile.atem)) {
      return { ...settings, profiles: settings.profiles.map((profile) => profile.id === settings.activeProfileId
        ? { ...profile, atem: { url: legacyUrl } } : profile) }
    }
    // Keep optional remembered ATEM keys out of the legacy settings document.
    // Older cached app versions export/sync that document without knowing this field.
    let keys: unknown = null
    try { keys = JSON.parse(storage.getItem(ATEM_KEYS_STORAGE_KEY) ?? 'null') } catch { /* No remembered keys. */ }
    return { ...settings, profiles: settings.profiles.map((profile) => {
      if (!profile.atem) return profile
      const saved = isObject(keys) ? keys[profile.id] : null
      return { ...profile, atem: { url: profile.atem.url,
        ...(isObject(saved) && saved.url === profile.atem.url && typeof saved.token === 'string'
          ? { token: saved.token } : {}) } }
    }) }
  } catch {
    return createDefaultSettings()
  }
}

export function saveSettings(
  settings: AppSettings,
  storage: Pick<Storage, 'setItem'> = localStorage
): boolean {
  try {
    const keys = Object.fromEntries(settings.profiles.filter((profile) => profile.atem?.token)
      .map((profile) => [profile.id, profile.atem]))
    storage.setItem(ATEM_KEYS_STORAGE_KEY, JSON.stringify(keys))
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings,
      profiles: settings.profiles.map((profile) => ({ ...profile,
        ...(profile.atem ? { atem: { url: profile.atem.url } } : {}) })) }))
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
    profiles: settings.profiles.map((profile) => ({ ...profile, password: '',
      ...(profile.atem ? { atem: { url: profile.atem.url } } : {}) }))
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
    ...withoutSecrets(cloud),
    ui: { ...cloud.ui, syncAtemKeys: Boolean(local.ui.syncAtemKeys) },
    profiles: withoutSecrets(cloud).profiles.map((profile) => ({
      ...profile,
      password: passwords.get(profile.id) ?? '',
      ...(profile.atem ? { atem: { url: profile.atem.url,
        ...(local.profiles.find((item) => item.id === profile.id)?.atem?.url === profile.atem.url
          ? { token: local.profiles.find((item) => item.id === profile.id)?.atem?.token } : {}) } } : {})
    }))
  }
}

export function getPasswordSecrets(settings: AppSettings): Record<string, string> {
  return Object.fromEntries(
    [...settings.profiles
      .filter(() => settings.ui.syncPasswords)
      .filter((profile) => profile.password.length > 0)
      .map((profile) => [profile.id, profile.password]),
    ...settings.profiles.filter((profile) => settings.ui.syncAtemKeys && profile.atem?.token)
      .map((profile) => [`atem:${profile.id}`, JSON.stringify({ url: profile.atem!.url, token: profile.atem!.token })])]
  )
}

export function applyPasswordSecrets(
  settings: AppSettings,
  secrets: Record<string, string>,
  includeAtemKeys = false
): AppSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => ({
      ...profile,
      password: secrets[profile.id] ?? profile.password,
      ...(includeAtemKeys && profile.atem ? { atem: restoreAtemSecret(profile, secrets) } : {})
    }))
  }
}

function restoreAtemSecret(profile: ConnectionProfile, secrets: Record<string, string>) {
  try {
    const value: unknown = JSON.parse(secrets[`atem:${profile.id}`] ?? 'null')
    if (isObject(value) && value.url === profile.atem?.url && typeof value.token === 'string' && value.token.length >= 32) {
      return { url: profile.atem!.url, token: value.token }
    }
  } catch { /* Invalid optional secrets do not replace local credentials. */ }
  return profile.atem!
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
