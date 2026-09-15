const STORAGE = 'obs-remote-panel.registered-devices.v1'
export interface Registration { token: string; id: string; name: string }
export function panelUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.port || url.username || url.password ||
    url.pathname !== '/panel' || url.search || url.hash) throw new Error('機材PCのTailscale HTTPS /panel URLが必要です。')
  return url.href
}
export function readRegistration(url: string): Registration | null {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    const record = records[panelUrl(url)]
    return record && /^[\w-]{43}$/.test(record.token) && typeof record.id === 'string' && typeof record.name === 'string' ? record : null
  } catch { return null }
}
export function saveRegistration(url: string, value: Registration | null) {
  const records = JSON.parse(localStorage.getItem(STORAGE) || '{}')
  if (value) records[panelUrl(url)] = value
  else delete records[panelUrl(url)]
  localStorage.setItem(STORAGE, JSON.stringify(records))
}
export function newDeviceSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function parseInvitation(link: string): { url: string; invite: string } {
  const parsed = new URL(link)
  if (parsed.origin !== 'https://aominn.github.io' || parsed.pathname !== '/obs-remote-panel/' || parsed.search || parsed.hash.length > 2048) {
    throw new Error('機材PCで発行した登録リンクを指定してください。')
  }
  const encoded = new URLSearchParams(parsed.hash.slice(1)).get('pair') || ''
  const data = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))
  if (!/^[\w-]{43}$/.test(data.invite)) throw new Error('登録情報が不正です。')
  return { url: panelUrl(data.url), invite: data.invite }
}
export async function panelFetch(url: string, path: string, token?: string, data?: unknown, signal?: AbortSignal) {
  const response = await fetch(`${panelUrl(url)}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store', credentials: 'omit', redirect: 'error',
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(7000)])
  })
  if (!response.ok) throw new Error(response.status === 401 ? '端末登録が解除されたか無効です。機材PCから再登録してください。'
    : '機材PCが応答しません。Tailscale・起動状態・登録の有効期限を確認してください。')
  return response.json()
}
