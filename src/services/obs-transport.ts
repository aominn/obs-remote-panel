import { OBSWebSocket } from 'obs-websocket-js'
import { panelFetch, readRegistration } from '../lib/device-registration'
import type { ConnectionProfile } from '../types'

// Retain the OBS client contract so the controller and UI use the same tested
// operations for direct connections and the paired, restricted HTTP broker.
export class RoutedObsTransport {
  private direct = new OBSWebSocket()
  private url?: string
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private abort?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private generation = 0
  private sequence = 0
  configure(profile: ConnectionProfile) { this.url = profile.hub?.url }
  on = ((event: string, listener: (data: unknown) => void) => {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(listener)
    this.direct.on(event as never, listener as never)
    return this
  }) as unknown as OBSWebSocket['on']
  private emit(event: string, data?: unknown) { this.listeners.get(event)?.forEach((listener) => listener(data)) }
  private async request(path: string, data?: unknown) {
    if (!this.url) throw new Error('Missing hub')
    const registration = readRegistration(this.url)
    if (!registration) throw new Error('この端末の登録が必要です。「接続・同期」から登録してください。')
    return panelFetch(this.url, path, registration.token, data, this.abort?.signal)
  }
  connect: OBSWebSocket['connect'] = async (...args) => {
    await this.disconnect()
    if (!this.url) return this.direct.connect(...args)
    this.abort = new AbortController()
    const generation = this.generation
    const status = await this.request('/status')
    if (!status.obsReady) throw new Error('機材PCのOBSが未接続です。')
    if (generation !== this.generation) throw new Error('接続をキャンセルしました。')
    this.sequence = status.sequence
    this.poll(generation)
    return { obsWebSocketVersion: '5', rpcVersion: 1, negotiatedRpcVersion: 1 }
  }
  private poll(generation: number) {
    this.timer = setTimeout(async () => {
      if (generation !== this.generation) return
      try {
        const update = await this.request(`/obs/events?since=${this.sequence}`)
        if (generation !== this.generation) return
        if (!update.ready || update.gap || !Array.isArray(update.events) || update.events.some((event: { type: string }) => event.type === 'ConnectionClosed')) throw new Error('OBS state changed')
        this.sequence = update.sequence
        for (const event of update.events) this.emit(event.type, event.data)
        if (generation === this.generation) this.poll(generation)
      } catch {
        if (generation === this.generation) { this.abort?.abort(); this.emit('ConnectionClosed', {}) }
      }
    }, 750)
  }
  call: OBSWebSocket['call'] = ((...args: Parameters<OBSWebSocket['call']>) => this.url
    ? this.request('/obs/call', { type: args[0], data: args[1] ?? {} }) : this.direct.call(...args)) as OBSWebSocket['call']
  disconnect = async () => {
    this.generation++
    clearTimeout(this.timer)
    this.abort?.abort()
    await this.direct.disconnect()
  }
}
