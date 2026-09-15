export interface AtemState {
  connected: boolean
  model: string
  inputs: { id: number; name: string }[]
  program: number | null
  preview: number | null
  transitioning: boolean
  busy: boolean
}
export type AtemAction = 'program' | 'preview' | 'cut' | 'auto'
export const EMPTY_ATEM: AtemState = {
  connected: false, model: '', inputs: [], program: null, preview: null,
  transitioning: false, busy: false
}

export function bridgeUrl(value: string) {
  const url = new URL(value)
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('HTTPSの接続先を指定してください（同じPCではlocalhostのHTTPも利用できます）。')
  }
  return url.href.replace(/\/$/, '')
}

function parseState(data: unknown): AtemState {
  if (!data || typeof data !== 'object') throw new Error('ATEM状態の形式が不正です。')
  const state = data as AtemState
  if (typeof state.connected !== 'boolean' || typeof state.model !== 'string' ||
      typeof state.transitioning !== 'boolean' || typeof state.busy !== 'boolean' ||
      !Array.isArray(state.inputs) || state.inputs.length > 8 ||
      !state.inputs.every((input) => Number.isInteger(input.id) && input.id >= 1 && input.id <= 8 && typeof input.name === 'string') ||
      !(state.program === null || Number.isInteger(state.program)) ||
      !(state.preview === null || Number.isInteger(state.preview))) {
    throw new Error('ATEM状態の形式が不正です。')
  }
  return state
}

export class AtemController {
  private state: AtemState = { ...EMPTY_ATEM }
  private listeners = new Set<(state: AtemState) => void>()
  private timer?: ReturnType<typeof setTimeout>
  private abort?: AbortController
  private generation = 0
  private commandRevision = 0
  private pending = false
  private url = ''
  private token = ''
  constructor(private readonly mock = false) {}
  getState = () => this.state
  subscribe = (listener: (state: AtemState) => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private emit(state: AtemState) {
    this.state = state
    this.listeners.forEach((listener) => listener(state))
  }
  private async request(path: string, command?: { action: AtemAction; input?: number }) {
    const response = await fetch(`${this.url}/${path}`, {
      method: command ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.token}`, ...(command ? { 'Content-Type': 'application/json' } : {}) },
      body: command ? JSON.stringify(command) : undefined,
      cache: 'no-store', credentials: 'omit', redirect: 'error',
      signal: AbortSignal.any([this.abort!.signal, AbortSignal.timeout(7000)])
    })
    if (!response.ok) throw new Error(response.status === 401
      ? 'ATEM接続キーが一致しません。'
      : 'ATEMとの通信に失敗しました。本体の状態を確認してください。')
    return parseState(await response.json())
  }
  async connect(url: string, token: string) {
    this.disconnect()
    if (this.mock) {
      this.emit({ connected: true, model: 'ATEM Mini Extreme（モック）',
        inputs: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `HDMI ${i + 1}` })),
        program: 1, preview: 2, transitioning: false, busy: false })
      return
    }
    this.url = bridgeUrl(url)
    if (token.length < 32) throw new Error('PC側で設定した32文字以上の接続キーを入力してください。')
    this.token = token
    this.abort = new AbortController()
    const generation = this.generation
    try {
      const state = await this.request('state')
      if (generation !== this.generation) return
      this.emit(state)
      this.poll(generation)
    } catch (error) {
      if (generation === this.generation) this.disconnect()
      throw error
    }
  }
  private poll(generation: number) {
    this.timer = setTimeout(async () => {
      if (generation !== this.generation) return
      if (!this.pending) {
        const revision = this.commandRevision
        try {
          const state = await this.request('state')
          if (generation === this.generation && revision === this.commandRevision && !this.pending) this.emit(state)
        } catch {
          if (generation === this.generation && revision === this.commandRevision) this.emit({ ...EMPTY_ATEM })
        }
      }
      if (generation === this.generation) this.poll(generation)
    }, 1000)
  }
  disconnect = () => {
    this.generation++
    clearTimeout(this.timer)
    this.abort?.abort()
    this.token = ''
    this.pending = false
    this.emit({ ...EMPTY_ATEM })
  }
  async command(action: AtemAction, input?: number) {
    if (!this.state.connected || this.pending || this.state.busy || this.state.transitioning) {
      throw new Error('ATEM未接続、または操作中です。')
    }
    if ((action === 'program' || action === 'preview') && !this.state.inputs.some((item) => item.id === input)) {
      throw new Error('入力が見つかりません。')
    }
    const generation = this.generation
    this.commandRevision++
    this.pending = true
    this.emit({ ...this.state, busy: true })
    try {
      if (this.mock) {
        this.emit({ ...this.state, busy: false,
          program: action === 'program' ? input! : action === 'cut' || action === 'auto' ? this.state.preview : this.state.program,
          preview: action === 'preview' ? input! : action === 'cut' || action === 'auto' ? this.state.program : this.state.preview })
      } else {
        await this.request('command', { action, input })
        if (generation !== this.generation) return
        const state = await this.request('state')
        if (generation === this.generation) this.emit(state)
      }
    } catch (error) {
      if (generation === this.generation) this.emit({ ...EMPTY_ATEM })
      throw error
    } finally {
      if (generation === this.generation) this.pending = false
    }
  }
}
