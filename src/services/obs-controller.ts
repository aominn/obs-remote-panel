import { OBSWebSocket } from 'obs-websocket-js'
import type {
  ConnectionProfile,
  InputAudioMonitorType,
  InputInfo,
  ObsState,
  OutputState,
  SourceInfo
} from '../types'
import { EMPTY_OBS_STATE } from '../types'

type Listener = (state: ObsState) => void
type SlideDirection = 'previous' | 'next'

export const AUDIO_MONITOR_OFF: InputAudioMonitorType = 'OBS_MONITORING_TYPE_NONE'
export const AUDIO_MONITOR_ON: InputAudioMonitorType =
  'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'
export const AUDIO_MONITOR_ONLY: InputAudioMonitorType = 'OBS_MONITORING_TYPE_MONITOR_ONLY'

export interface ObsController {
  getState(): ObsState
  subscribe(listener: Listener): () => void
  connect(profile: ConnectionProfile): Promise<void>
  disconnect(): Promise<void>
  refreshAll(): Promise<void>
  refreshScenes(): Promise<void>
  refreshSources(sceneName?: string): Promise<void>
  refreshInputs(): Promise<void>
  setCurrentScene(sceneName: string): Promise<void>
  setPreviewScene(sceneName: string): Promise<void>
  setSourceEnabled(source: SourceInfo, enabled: boolean): Promise<void>
  setInputMuted(inputName: string, muted: boolean): Promise<void>
  setInputVolume(inputName: string, volumeDb: number): Promise<void>
  setInputAudioMonitoring(inputName: string, enabled: boolean): Promise<void>
  triggerSlide(inputName: string, direction: SlideDirection): Promise<void>
  toggleStream(): Promise<void>
  toggleRecord(): Promise<void>
  toggleRecordPause(): Promise<void>
  toggleVirtualCamera(): Promise<void>
  toggleReplayBuffer(): Promise<void>
  saveReplayBuffer(): Promise<void>
  setStudioMode(enabled: boolean): Promise<void>
  setTransition(name: string): Promise<void>
  setTransitionDuration(duration: number): Promise<void>
  triggerStudioTransition(): Promise<void>
  simulateDisconnect?(): void
  failNextConnection?(): void
}

export function mediaActionRequest(inputName: string, direction: SlideDirection) {
  return {
    inputName,
    mediaAction:
      direction === 'previous'
        ? 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS'
        : 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT'
  } as const
}

export function sceneItemEnabledRequest(source: SourceInfo, enabled: boolean) {
  return {
    sceneName: source.sceneName,
    sceneItemId: source.sceneItemId,
    sceneItemEnabled: enabled
  }
}

export function inputVolumeRequest(inputName: string, inputVolumeDb: number) {
  return { inputName, inputVolumeDb }
}

export function inputAudioMonitorRequest(inputName: string, enabled: boolean) {
  return {
    inputName,
    monitorType: enabled ? AUDIO_MONITOR_ON : AUDIO_MONITOR_OFF
  } as const
}

export function isInputAudioMonitoringOn(monitorType?: string) {
  return monitorType === AUDIO_MONITOR_ON || monitorType === AUDIO_MONITOR_ONLY
}

function inputAudioMonitorType(value: unknown): InputAudioMonitorType | undefined {
  if (value === AUDIO_MONITOR_OFF) return AUDIO_MONITOR_OFF
  if (value === AUDIO_MONITOR_ONLY) return AUDIO_MONITOR_ONLY
  if (value === AUDIO_MONITOR_ON) return AUDIO_MONITOR_ON
  return undefined
}

function errorCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'number' ? code : undefined
  }
  return undefined
}

function connectionErrorMessage(error: unknown): string {
  const code = errorCode(error)
  if (code === 4009) return 'OBS WebSocketの認証に失敗しました。パスワードを確認してください。'
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'OBSへの接続がタイムアウトしました。'
  }
  return 'OBSへ接続できませんでした。接続先とtailnetの状態を確認してください。'
}

function jsonString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function jsonNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function jsonBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const error = new Error('connection timeout')
      error.name = 'TimeoutError'
      reject(error)
    }, milliseconds)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export class RealObsController implements ObsController {
  private readonly obs: OBSWebSocket
  private readonly listeners = new Set<Listener>()
  private state: ObsState = structuredClone(EMPTY_OBS_STATE)
  private profile: ConnectionProfile | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private manualDisconnect = false
  private connectionGeneration = 0
  private sourceRefreshGeneration = 0
  private readonly monitoringUpdates = new Set<string>()

  constructor(obs = new OBSWebSocket()) {
    this.obs = obs
    this.bindEventsOnce()
  }

  getState() {
    return this.state
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private emit(patch: Partial<ObsState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  private bindEventsOnce() {
    this.obs.on('ConnectionClosed', () => {
      if (this.manualDisconnect) return
      this.emit({
        connectionStatus: this.profile?.autoReconnect ? 'reconnecting' : 'disconnected',
        connectionError: 'OBSとの接続が切断されました。'
      })
      this.scheduleReconnect()
    })
    this.obs.on('CurrentProgramSceneChanged', ({ sceneName }) => {
      this.emit({ currentProgramScene: sceneName })
    })
    this.obs.on('CurrentPreviewSceneChanged', ({ sceneName }) => {
      this.emit({ currentPreviewScene: sceneName })
    })
    const refreshSceneState = () => void this.refreshScenes().catch(() => undefined)
    this.obs.on('SceneListChanged', refreshSceneState)
    this.obs.on('SceneNameChanged', refreshSceneState)
    const refreshTrackedSources = ({ sceneName }: { sceneName: string }) => {
      if (this.isTrackedSourceScene(sceneName)) {
        void this.refreshSources(this.state.sourceSceneName).catch(() => undefined)
      }
    }
    this.obs.on('SceneItemCreated', refreshTrackedSources)
    this.obs.on('SceneItemRemoved', refreshTrackedSources)
    this.obs.on('SceneItemListReindexed', refreshTrackedSources)
    this.obs.on('SceneItemEnableStateChanged', ({ sceneName, sceneItemId, sceneItemEnabled }) => {
      this.emit({
        sources: this.state.sources.map((source) =>
          source.sceneName === sceneName && source.sceneItemId === sceneItemId
            ? { ...source, enabled: sceneItemEnabled }
            : source
        )
      })
    })
    this.obs.on('InputMuteStateChanged', ({ inputName, inputMuted }) => {
      this.updateInput(inputName, { muted: inputMuted })
    })
    this.obs.on('InputVolumeChanged', ({ inputName, inputVolumeDb }) => {
      this.updateInput(inputName, { volumeDb: inputVolumeDb })
    })
    this.obs.on('InputAudioMonitorTypeChanged', ({ inputName, monitorType }) => {
      this.updateInput(inputName, { monitorType: inputAudioMonitorType(monitorType) })
    })
    const refreshInputState = () => void this.refreshInputs().catch(() => undefined)
    this.obs.on('InputCreated', refreshInputState)
    this.obs.on('InputRemoved', refreshInputState)
    this.obs.on('InputNameChanged', () => {
      refreshInputState()
      void this.refreshSources(this.state.sourceSceneName).catch(() => undefined)
    })
    this.obs.on('StreamStateChanged', ({ outputActive }) => {
      this.updateOutputs({ streamActive: outputActive })
    })
    this.obs.on('RecordStateChanged', ({ outputActive, outputState }) => {
      this.updateOutputs({
        recordActive: outputActive,
        recordPaused:
          outputState === 'OBS_WEBSOCKET_OUTPUT_PAUSED'
            ? true
            : outputState === 'OBS_WEBSOCKET_OUTPUT_RESUMED' || !outputActive
              ? false
              : this.state.outputs.recordPaused
      })
    })
    this.obs.on('VirtualcamStateChanged', ({ outputActive }) => {
      this.updateOutputs({ virtualCameraActive: outputActive })
    })
    this.obs.on('ReplayBufferStateChanged', ({ outputActive }) => {
      this.updateOutputs({ replayBufferActive: outputActive })
    })
    this.obs.on('StudioModeStateChanged', ({ studioModeEnabled }) => {
      this.emit({ studioMode: studioModeEnabled })
    })
    this.obs.on('CurrentSceneTransitionChanged', ({ transitionName }) => {
      this.emit({ currentTransition: transitionName })
    })
    this.obs.on('CurrentSceneTransitionDurationChanged', ({ transitionDuration }) => {
      this.emit({ transitionDuration })
    })
    this.obs.on('ExitStarted', () => {
      this.emit({ connectionError: 'OBSが終了しました。' })
    })
  }

  private updateInput(inputName: string, patch: Partial<InputInfo>) {
    this.emit({
      inputs: this.state.inputs.map((input) =>
        input.name === inputName ? { ...input, ...patch } : input
      )
    })
  }

  private isTrackedSourceScene(sceneName: string) {
    return (
      sceneName === this.state.sourceSceneName ||
      this.state.sources.some((source) => source.isGroup && source.sourceName === sceneName)
    )
  }

  private updateOutputs(patch: Partial<OutputState>) {
    this.emit({ outputs: { ...this.state.outputs, ...patch } })
  }

  async connect(profile: ConnectionProfile) {
    const generation = ++this.connectionGeneration
    this.clearReconnect()
    this.manualDisconnect = false
    this.profile = profile
    this.emit({
      connectionStatus: this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      connectionError: null
    })
    try {
      await withTimeout(this.obs.connect(profile.url, profile.password, { rpcVersion: 1 }), 10_000)
      if (generation !== this.connectionGeneration) return
      this.reconnectAttempt = 0
      this.emit({
        connectionStatus: 'connected',
        connectedProfileId: profile.id,
        connectionError: null
      })
      try {
        await this.refreshAll()
      } catch {
        this.emit({
          connectionError: 'OBSへ接続しましたが、一部の状態を取得できませんでした。手動再取得を試してください。'
        })
      }
    } catch (error) {
      if (generation !== this.connectionGeneration) return
      if (error instanceof Error && error.name === 'TimeoutError') {
        this.manualDisconnect = true
        await this.obs.disconnect().catch(() => undefined)
        this.manualDisconnect = false
      }
      this.emit({ connectionStatus: 'error', connectionError: connectionErrorMessage(error) })
      this.scheduleReconnect()
      throw new Error(connectionErrorMessage(error), { cause: error })
    }
  }

  async disconnect() {
    this.manualDisconnect = true
    this.connectionGeneration += 1
    this.sourceRefreshGeneration += 1
    this.clearReconnect()
    try {
      await this.obs.disconnect()
    } finally {
      this.emit({
        ...structuredClone(EMPTY_OBS_STATE),
        connectionStatus: 'disconnected'
      })
    }
  }

  private scheduleReconnect() {
    if (!this.profile?.autoReconnect || this.manualDisconnect || this.reconnectTimer !== null) return
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 30_000)
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.profile) void this.connect(this.profile).catch(() => undefined)
    }, delay)
  }

  private clearReconnect() {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  async refreshAll() {
    await this.refreshScenes()
    await Promise.allSettled([
      this.refreshInputs(),
      this.refreshOutputs(),
      this.refreshStudio(),
      this.refreshTransitions(),
      this.refreshStats()
    ])
  }

  async refreshScenes() {
    const response = await this.obs.call('GetSceneList')
    const scenes = response.scenes
      .map((scene) => ({
        name: jsonString(scene.sceneName),
        uuid: jsonString(scene.sceneUuid) || undefined
      }))
      .filter((scene) => scene.name.length > 0)
    const sceneNames = new Set(scenes.map((scene) => scene.name))
    const selectedScene = sceneNames.has(this.state.sourceSceneName)
      ? this.state.sourceSceneName
      : sceneNames.has(this.profile?.selectedSourceScene ?? '')
        ? (this.profile?.selectedSourceScene ?? '')
        : sceneNames.has(response.currentProgramSceneName)
          ? response.currentProgramSceneName
          : (scenes[0]?.name ?? '')
    this.emit({
      scenes,
      currentProgramScene: response.currentProgramSceneName,
      currentPreviewScene: response.currentPreviewSceneName ?? this.state.currentPreviewScene
    })
    await this.refreshSources(selectedScene)
  }

  async refreshSources(sceneName = this.state.sourceSceneName || this.state.currentProgramScene) {
    const generation = ++this.sourceRefreshGeneration
    if (!sceneName) {
      this.emit({ sourceSceneName: '', sources: [] })
      return
    }
    if (sceneName !== this.state.sourceSceneName) {
      this.emit({ sourceSceneName: sceneName, sources: [] })
    }
    const response = await this.obs.call('GetSceneItemList', { sceneName })
    const sources: SourceInfo[] = response.sceneItems.map((item) => ({
      sceneName,
      sceneItemId: jsonNumber(item.sceneItemId),
      sourceName: jsonString(item.sourceName),
      sourceUuid: jsonString(item.sourceUuid) || undefined,
      enabled: jsonBoolean(item.sceneItemEnabled),
      isGroup: jsonBoolean(item.isGroup)
    }))
    const groups = sources.filter((source) => source.isGroup)
    for (const group of groups) {
      try {
        const groupResponse = await this.obs.call('GetGroupSceneItemList', {
          sceneName: group.sourceName
        })
        sources.push(
          ...groupResponse.sceneItems.map((item) => ({
            sceneName: group.sourceName,
            sceneItemId: jsonNumber(item.sceneItemId),
            sourceName: jsonString(item.sourceName),
            sourceUuid: jsonString(item.sourceUuid) || undefined,
            enabled: jsonBoolean(item.sceneItemEnabled),
            isGroup: jsonBoolean(item.isGroup),
            parentGroupName: group.sourceName
          }))
        )
      } catch {
        // Group support differs across OBS/source combinations; top-level items stay usable.
      }
    }
    if (generation === this.sourceRefreshGeneration) {
      this.emit({ sourceSceneName: sceneName, sources })
    }
  }

  async refreshInputs() {
    const response = await this.obs.call('GetInputList')
    const inputs: InputInfo[] = []
    for (const item of response.inputs) {
      const inputName = jsonString(item.inputName)
      if (!inputName) continue
      let muted = false
      let volumeDb = 0
      let isAudio = false
      let monitorType: InputAudioMonitorType | undefined
      try {
        const [mute, volume] = await Promise.all([
          this.obs.call('GetInputMute', { inputName }),
          this.obs.call('GetInputVolume', { inputName })
        ])
        muted = mute.inputMuted
        volumeDb = volume.inputVolumeDb
        isAudio = true
        try {
          const monitor = await this.obs.call('GetInputAudioMonitorType', { inputName })
          monitorType = inputAudioMonitorType(monitor.monitorType)
        } catch {
          // Monitoring may be unavailable even when mute and volume requests are supported.
        }
      } catch {
        // Inputs without audio do not implement the audio requests.
      }
      inputs.push({
        name: inputName,
        uuid: jsonString(item.inputUuid) || undefined,
        kind: jsonString(item.inputKind),
        muted,
        volumeDb,
        isAudio,
        monitorType
      })
    }
    this.emit({ inputs })
  }

  private async refreshOutputs() {
    const [stream, record, virtualCamera, replay] = await Promise.all([
      this.obs.call('GetStreamStatus'),
      this.obs.call('GetRecordStatus'),
      this.obs.call('GetVirtualCamStatus'),
      this.obs.call('GetReplayBufferStatus')
    ])
    this.emit({
      outputs: {
        streamActive: stream.outputActive,
        recordActive: record.outputActive,
        recordPaused: record.outputPaused,
        virtualCameraActive: virtualCamera.outputActive,
        replayBufferActive: replay.outputActive
      }
    })
  }

  private async refreshStudio() {
    const response = await this.obs.call('GetStudioModeEnabled')
    this.emit({ studioMode: response.studioModeEnabled })
  }

  private async refreshTransitions() {
    const [response, current] = await Promise.all([
      this.obs.call('GetSceneTransitionList'),
      this.obs.call('GetCurrentSceneTransition')
    ])
    this.emit({
      transitions: response.transitions.map((transition) => ({
        name: jsonString(transition.transitionName),
        configurable: jsonBoolean(transition.transitionConfigurable),
        fixed: jsonBoolean(transition.transitionFixed)
      })),
      currentTransition: response.currentSceneTransitionName,
      transitionDuration: current.transitionDuration
    })
  }

  private async refreshStats() {
    const stats = await this.obs.call('GetStats')
    this.emit({
      stats: {
        activeFps: stats.activeFps,
        cpuUsage: stats.cpuUsage,
        memoryUsage: stats.memoryUsage,
        renderSkippedFrames: stats.renderSkippedFrames,
        outputSkippedFrames: stats.outputSkippedFrames
      }
    })
  }

  async setCurrentScene(sceneName: string) {
    await this.obs.call('SetCurrentProgramScene', { sceneName })
  }

  async setPreviewScene(sceneName: string) {
    await this.obs.call('SetCurrentPreviewScene', { sceneName })
  }

  async setSourceEnabled(source: SourceInfo, enabled: boolean) {
    await this.obs.call('SetSceneItemEnabled', sceneItemEnabledRequest(source, enabled))
  }

  async setInputMuted(inputName: string, muted: boolean) {
    await this.obs.call('SetInputMute', { inputName, inputMuted: muted })
    this.updateInput(inputName, { muted })
  }

  async setInputVolume(inputName: string, volumeDb: number) {
    this.updateInput(inputName, { volumeDb })
    await this.obs.call('SetInputVolume', inputVolumeRequest(inputName, volumeDb))
  }

  async setInputAudioMonitoring(inputName: string, enabled: boolean) {
    if (this.monitoringUpdates.has(inputName)) return
    this.monitoringUpdates.add(inputName)
    const request = inputAudioMonitorRequest(inputName, enabled)
    try {
      await this.obs.call('SetInputAudioMonitorType', request)
      this.updateInput(inputName, { monitorType: request.monitorType })
    } finally {
      this.monitoringUpdates.delete(inputName)
    }
  }

  async triggerSlide(inputName: string, direction: SlideDirection) {
    await this.obs.call('TriggerMediaInputAction', mediaActionRequest(inputName, direction))
  }

  async toggleStream() {
    await this.obs.call(this.state.outputs.streamActive ? 'StopStream' : 'StartStream')
  }

  async toggleRecord() {
    await this.obs.call(this.state.outputs.recordActive ? 'StopRecord' : 'StartRecord')
  }

  async toggleRecordPause() {
    await this.obs.call(this.state.outputs.recordPaused ? 'ResumeRecord' : 'PauseRecord')
  }

  async toggleVirtualCamera() {
    await this.obs.call(
      this.state.outputs.virtualCameraActive ? 'StopVirtualCam' : 'StartVirtualCam'
    )
  }

  async toggleReplayBuffer() {
    await this.obs.call(
      this.state.outputs.replayBufferActive ? 'StopReplayBuffer' : 'StartReplayBuffer'
    )
  }

  async saveReplayBuffer() {
    await this.obs.call('SaveReplayBuffer')
  }

  async setStudioMode(enabled: boolean) {
    await this.obs.call('SetStudioModeEnabled', { studioModeEnabled: enabled })
  }

  async setTransition(name: string) {
    await this.obs.call('SetCurrentSceneTransition', { transitionName: name })
  }

  async setTransitionDuration(duration: number) {
    await this.obs.call('SetCurrentSceneTransitionDuration', { transitionDuration: duration })
  }

  async triggerStudioTransition() {
    await this.obs.call('TriggerStudioModeTransition')
  }
}
