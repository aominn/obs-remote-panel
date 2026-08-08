import type { ConnectionProfile, ObsState, SourceInfo } from '../types'
import { EMPTY_OBS_STATE } from '../types'
import type { ObsController } from './obs-controller'

type Listener = (state: ObsState) => void

const initialMockSources = (): Record<string, SourceInfo[]> => ({
  オープニング: [
    {
      sceneName: 'オープニング',
      sceneItemId: 101,
      sourceName: 'タイトルロゴ',
      enabled: true,
      isGroup: false
    },
    {
      sceneName: 'オープニング',
      sceneItemId: 102,
      sourceName: 'オープニング動画',
      enabled: true,
      isGroup: false
    }
  ],
  メインカメラ: [
    {
      sceneName: 'メインカメラ',
      sceneItemId: 1,
      sourceName: 'カメラ',
      enabled: true,
      isGroup: false
    },
    {
      sceneName: 'メインカメラ',
      sceneItemId: 2,
      sourceName: '画像スライドショー',
      enabled: true,
      isGroup: false
    },
    {
      sceneName: 'メインカメラ',
      sceneItemId: 3,
      sourceName: 'テロップグループ',
      enabled: true,
      isGroup: true
    },
    {
      sceneName: 'テロップグループ',
      sceneItemId: 31,
      sourceName: '名前テロップ',
      enabled: true,
      isGroup: false,
      parentGroupName: 'テロップグループ'
    }
  ],
  資料共有: [
    {
      sceneName: '資料共有',
      sceneItemId: 201,
      sourceName: 'スライド資料',
      enabled: true,
      isGroup: false
    },
    {
      sceneName: '資料共有',
      sceneItemId: 202,
      sourceName: 'レーザーポインター',
      enabled: false,
      isGroup: false
    }
  ],
  休憩中: [
    {
      sceneName: '休憩中',
      sceneItemId: 301,
      sourceName: '休憩背景',
      enabled: true,
      isGroup: false
    },
    {
      sceneName: '休憩中',
      sceneItemId: 302,
      sourceName: '休憩BGM',
      enabled: true,
      isGroup: false
    }
  ]
})

const cloneSources = (sources: SourceInfo[]) => sources.map((source) => ({ ...source }))

const initialMockState = (sourcesByScene: Record<string, SourceInfo[]>): ObsState => ({
  ...structuredClone(EMPTY_OBS_STATE),
  scenes: [
    { name: 'オープニング' },
    { name: 'メインカメラ' },
    { name: '資料共有' },
    { name: '休憩中' }
  ],
  currentProgramScene: 'メインカメラ',
  currentPreviewScene: '資料共有',
  sourceSceneName: 'メインカメラ',
  sources: cloneSources(sourcesByScene['メインカメラ']),
  inputs: [
    {
      name: '画像スライドショー',
      kind: 'slideshow_v2',
      muted: false,
      volumeDb: -12,
      isAudio: false
    },
    { name: 'マイク', kind: 'wasapi_input_capture', muted: false, volumeDb: -8, isAudio: true },
    { name: 'デスクトップ音声', kind: 'wasapi_output_capture', muted: false, volumeDb: -15, isAudio: true },
    { name: 'BGM', kind: 'ffmpeg_source', muted: true, volumeDb: -21, isAudio: true }
  ],
  transitions: [
    { name: 'フェード', configurable: false, fixed: false },
    { name: 'カット', configurable: false, fixed: true }
  ],
  currentTransition: 'フェード',
  transitionDuration: 300,
  stats: {
    activeFps: 60,
    cpuUsage: 4.7,
    memoryUsage: 386.2,
    renderSkippedFrames: 0,
    outputSkippedFrames: 2
  }
})

export class MockObsController implements ObsController {
  private readonly sourcesByScene = initialMockSources()
  private state = initialMockState(this.sourcesByScene)
  private readonly listeners = new Set<Listener>()
  private profile: ConnectionProfile | null = null
  private shouldFailNext = false

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

  private outputs(patch: Partial<ObsState['outputs']>) {
    this.emit({ outputs: { ...this.state.outputs, ...patch } })
  }

  async connect(profile: ConnectionProfile) {
    this.profile = profile
    this.emit({ connectionStatus: 'connecting', connectionError: null })
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    if (this.shouldFailNext) {
      this.shouldFailNext = false
      this.emit({ connectionStatus: 'error', connectionError: 'モック接続エラーを再現しました。' })
      if (profile.autoReconnect) {
        window.setTimeout(() => {
          this.emit({
            connectionStatus: 'connected',
            connectedProfileId: profile.id,
            connectionError: null
          })
        }, 1_000)
      }
      throw new Error('モック接続エラーを再現しました。')
    }
    this.emit({
      connectionStatus: 'connected',
      connectedProfileId: profile.id,
      connectionError: null
    })
  }

  async disconnect() {
    this.emit({ connectionStatus: 'disconnected', connectedProfileId: null })
  }

  simulateDisconnect() {
    this.emit({ connectionStatus: 'reconnecting', connectionError: 'モック通信断を再現中です。' })
    if (this.profile?.autoReconnect) {
      window.setTimeout(() => {
        this.emit({ connectionStatus: 'connected', connectionError: null })
      }, 1_000)
    }
  }

  failNextConnection() {
    this.shouldFailNext = true
  }

  async refreshAll() {
    await this.refreshSources()
  }
  async refreshScenes() {}
  async refreshSources(sceneName = this.state.sourceSceneName || this.state.currentProgramScene) {
    this.emit({
      sourceSceneName: sceneName,
      sources: cloneSources(this.sourcesByScene[sceneName] ?? [])
    })
  }
  async refreshInputs() {}

  async setCurrentScene(sceneName: string) {
    this.emit({ currentProgramScene: sceneName })
  }

  async setPreviewScene(sceneName: string) {
    this.emit({ currentPreviewScene: sceneName })
  }

  async setSourceEnabled(source: SourceInfo, enabled: boolean) {
    for (const sources of Object.values(this.sourcesByScene)) {
      const item = sources.find(
        (candidate) =>
          candidate.sceneName === source.sceneName &&
          candidate.sceneItemId === source.sceneItemId
      )
      if (item) item.enabled = enabled
    }
    this.emit({
      sources: this.state.sources.map((item) =>
        item.sceneName === source.sceneName && item.sceneItemId === source.sceneItemId
          ? { ...item, enabled }
          : item
      )
    })
  }

  async setInputMuted(inputName: string, muted: boolean) {
    this.emit({
      inputs: this.state.inputs.map((input) =>
        input.name === inputName ? { ...input, muted } : input
      )
    })
  }

  async setInputVolume(inputName: string, volumeDb: number) {
    this.emit({
      inputs: this.state.inputs.map((input) =>
        input.name === inputName ? { ...input, volumeDb } : input
      )
    })
  }

  async triggerSlide(inputName: string, direction: 'previous' | 'next') {
    this.emit({ lastAction: `${inputName}: ${direction === 'previous' ? '前へ' : '次へ'}（モック）` })
  }

  async toggleStream() {
    this.outputs({ streamActive: !this.state.outputs.streamActive })
  }

  async toggleRecord() {
    this.outputs({ recordActive: !this.state.outputs.recordActive, recordPaused: false })
  }

  async toggleRecordPause() {
    this.outputs({ recordPaused: !this.state.outputs.recordPaused })
  }

  async toggleVirtualCamera() {
    this.outputs({ virtualCameraActive: !this.state.outputs.virtualCameraActive })
  }

  async toggleReplayBuffer() {
    this.outputs({ replayBufferActive: !this.state.outputs.replayBufferActive })
  }

  async saveReplayBuffer() {}

  async setStudioMode(enabled: boolean) {
    this.emit({ studioMode: enabled })
  }

  async setTransition(name: string) {
    this.emit({ currentTransition: name })
  }

  async setTransitionDuration(duration: number) {
    this.emit({ transitionDuration: duration })
  }

  async triggerStudioTransition() {
    const program = this.state.currentProgramScene
    this.emit({
      currentProgramScene: this.state.currentPreviewScene,
      currentPreviewScene: program
    })
  }
}
