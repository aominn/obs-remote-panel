import { describe, expect, it } from 'vitest'
import { createDefaultSettings, createProfile, exportSettings, importSettings, getPasswordSecrets,
  applyPasswordSecrets, mergeCloudSettings, loadSettings, saveSettings, SETTINGS_STORAGE_KEY, ATEM_KEYS_STORAGE_KEY } from './settings'
import { exportProtectedSettings, readTransferredSettings } from './settings-transfer'

function configured() {
  const settings = createDefaultSettings()
  settings.profiles[0].password = 'private-obs-password'
  settings.profiles[0].atem = { url: 'https://pc.example.ts.net/atem', token: 'a'.repeat(44) }
  return settings
}

describe('environment transfer', () => {
  it('stores remembered ATEM keys outside the legacy document and forgets them explicitly', () => {
    const settings = configured()
    const entries = new Map<string, string>()
    const storage = { getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) } }
    expect(saveSettings(settings, storage)).toBe(true)
    expect(entries.get(SETTINGS_STORAGE_KEY)).not.toContain('a'.repeat(44))
    expect(entries.get(ATEM_KEYS_STORAGE_KEY)).toContain('a'.repeat(44))
    expect(loadSettings(storage).profiles[0].atem?.token).toBe('a'.repeat(44))
    delete settings.profiles[0].atem!.token
    saveSettings(settings, storage)
    expect(loadSettings(storage).profiles[0].atem?.token).toBeUndefined()
  })
  it('normal export/import always strips both secrets but keeps ATEM URL', () => {
    const settings = configured()
    const json = exportSettings(settings)
    expect(json).not.toContain(settings.profiles[0].password)
    expect(json).not.toContain(settings.profiles[0].atem!.token)
    const imported = importSettings(JSON.stringify(settings))
    expect(imported.profiles[0].password).toBe('')
    expect(imported.profiles[0].atem).toEqual({ url: settings.profiles[0].atem!.url })
  })
  it('encrypted file restores profiles and keys, never emits plaintext URLs/secrets', async () => {
    const settings = configured()
    const json = await exportProtectedSettings(settings, 'a-long-test-passphrase')
    expect(json).not.toContain(settings.profiles[0].atem!.url)
    expect(json).not.toContain(settings.profiles[0].atem!.token)
    expect(json).not.toContain(settings.profiles[0].password)
    const result = await readTransferredSettings(json, 'a-long-test-passphrase')
    expect(result.protected).toBe(true)
    expect(result.settings.profiles).toEqual(settings.profiles)
    await expect(readTransferredSettings(json, 'wrong-passphrase')).rejects.toThrow()
    await expect(exportProtectedSettings(settings, 'short')).rejects.toThrow('12')
  })
  it('rejects oversized and excessive-work payloads', async () => {
    await expect(readTransferredSettings('a'.repeat(4 * 1024 * 1024 + 1), '')).rejects.toThrow('4MB')
    await expect(readTransferredSettings(JSON.stringify({ format: 'obs-remote-panel-encrypted-settings', version: 1,
      payload: { iterations: 2_000_000_000 } }), 'test')).rejects.toThrow('形式')
  })
  it('ATEM cloud secrets require separate opt-in and are bound to the URL', () => {
    const local = configured()
    expect(getPasswordSecrets(local)).toEqual({})
    local.ui.syncAtemKeys = true
    const secrets = getPasswordSecrets(local)
    const target = importSettings(exportSettings(local))
    expect(applyPasswordSecrets(target, secrets).profiles[0].atem?.token).toBeUndefined()
    expect(applyPasswordSecrets(target, secrets, true).profiles[0].atem?.token).toBe('a'.repeat(44))
    target.profiles[0].atem!.url = 'https://different.example.ts.net/atem'
    expect(applyPasswordSecrets(target, secrets, true).profiles[0].atem?.token).toBeUndefined()
  })
  it('cloud cannot inject plaintext keys or enable device consent', () => {
    const local = configured()
    const cloud = configured()
    cloud.profiles[0].id = local.profiles[0].id
    cloud.activeProfileId = local.activeProfileId
    cloud.ui.syncAtemKeys = true
    cloud.profiles[0].atem!.url = 'https://different.example.ts.net/atem'
    const merged = mergeCloudSettings(local, cloud)
    expect(merged.profiles[0].atem?.token).toBeUndefined()
    expect(merged.ui.syncAtemKeys).toBe(false)
  })
  it('migrates browser-wide ATEM URL only into the active legacy profile', () => {
    const settings = createDefaultSettings()
    settings.profiles.push(createProfile('other'))
    const migrated = loadSettings({ getItem: (key) => key === SETTINGS_STORAGE_KEY ? JSON.stringify(settings)
      : 'https://pc.example.ts.net/atem' })
    expect(migrated.profiles[0].atem?.url).toBe('https://pc.example.ts.net/atem')
    expect(migrated.profiles[1].atem).toBeUndefined()
  })
})
