import { beforeEach, expect, it } from 'vitest'
import { newDeviceSecret, panelUrl, parseInvitation, readRegistration, saveRegistration } from './device-registration'
import { createDefaultSettings, exportSettings } from './settings'
import { exportProtectedSettings } from './settings-transfer'
import { applySharedOperations, sharedOperations } from './shared-operations'

beforeEach(() => localStorage.clear())
const url = 'https://pc.example.ts.net/panel'
it('registration secrets are separate from settings, even protected exports', async () => {
  const settings = createDefaultSettings()
  settings.profiles[0].hub = { url }
  const token = newDeviceSecret()
  expect(token).toHaveLength(43)
  saveRegistration(url, { token, id: 'device', name: 'phone' })
  expect(readRegistration(url)?.token).toBe(token)
  expect(exportSettings(settings)).not.toContain(token)
  const json = await exportProtectedSettings(settings, 'long-passphrase-test')
  expect(json).not.toContain(token)
  expect(readRegistration('https://other.example.ts.net/panel')).toBeNull()
  saveRegistration(url, null)
  expect(readRegistration(url)).toBeNull()
})
it('only accepts official app links and Tailscale HTTPS panel endpoints', () => {
  const invite = newDeviceSecret()
  const link = `https://aominn.github.io/obs-remote-panel/#pair=${btoa(JSON.stringify({ url, invite }))}`
  expect(parseInvitation(link)).toEqual({ url, invite })
  for (const invalid of ['http://pc.example.ts.net/panel', 'https://evil.example/panel', `${url}?password=x`, 'https://u:p@pc.example.ts.net/panel', `${url}/admin`]) {
    expect(() => panelUrl(invalid)).toThrow()
  }
  expect(() => parseInvitation(link.replace('aominn.github.io', 'evil.example'))).toThrow()
})
it('operation sharing preserves settings but cannot change credentials or endpoints', () => {
  const profile = createDefaultSettings().profiles[0]
  profile.hub = { url }
  profile.password = 'local-password'
  profile.atem = { url: 'https://old.example.ts.net/atem', token: 'local-key' }
  expect(JSON.stringify(sharedOperations(profile))).not.toContain('local-key')
  const next = applySharedOperations(profile, { ...sharedOperations(profile), name: '別の操作端末', password: 'injected', hub: { url: 'https://evil.example/panel' } })
  expect(next.name).toBe('別の操作端末')
  expect(next.password).toBe('local-password')
  expect(next.hub).toEqual({ url })
})
