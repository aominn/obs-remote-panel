export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export type QuickActionKind =
  | 'scene'
  | 'slide-previous'
  | 'slide-next'
  | 'mute'
  | 'source-visibility'
  | 'record'
  | 'stream'
  | 'virtual-camera'
  | 'replay-buffer'
  | 'replay-save'
  | 'studio-transition'

export interface QuickAction {
  id: string
  kind: QuickActionKind
  label: string
  color: string
  target?: string
}

export interface ConnectionProfile {
  id: string
  name: string
  url: string
  password: string
  autoReconnect: boolean
  selectedSlideshowInput: string
  selectedSourceScene?: string
  selectedAudioInput?: string
  favoriteScenes: string[]
  favoriteAudioInputs: string[]
  sceneOrder: string[]
  hiddenScenes: string[]
  quickActions: QuickAction[]
  visibleDetailActions: string[]
  updatedAt: string
}

export interface UiSettings {
  confirmDangerousActions: boolean
  syncPasswords: boolean
}

export interface AppSettings {
  schemaVersion: 1
  profiles: ConnectionProfile[]
  activeProfileId: string
  ui: UiSettings
  revision: number
  updatedAt: string
}

export interface SceneInfo {
  name: string
  uuid?: string
}

export interface SourceInfo {
  sceneName: string
  sceneItemId: number
  sourceName: string
  sourceUuid?: string
  enabled: boolean
  isGroup: boolean
  parentGroupName?: string
}

export interface InputInfo {
  name: string
  uuid?: string
  kind: string
  muted: boolean
  volumeDb: number
  isAudio: boolean
}

export interface OutputState {
  streamActive: boolean
  recordActive: boolean
  recordPaused: boolean
  virtualCameraActive: boolean
  replayBufferActive: boolean
}

export interface ObsStats {
  activeFps: number | null
  cpuUsage: number | null
  memoryUsage: number | null
  renderSkippedFrames: number | null
  outputSkippedFrames: number | null
}

export interface TransitionInfo {
  name: string
  configurable: boolean
  fixed: boolean
}

export interface ObsState {
  connectionStatus: ConnectionStatus
  connectionError: string | null
  connectedProfileId: string | null
  scenes: SceneInfo[]
  currentProgramScene: string
  currentPreviewScene: string
  sourceSceneName: string
  sources: SourceInfo[]
  inputs: InputInfo[]
  studioMode: boolean
  outputs: OutputState
  stats: ObsStats
  transitions: TransitionInfo[]
  currentTransition: string
  transitionDuration: number
  lastAction: string | null
}

export const EMPTY_OBS_STATE: ObsState = {
  connectionStatus: 'disconnected',
  connectionError: null,
  connectedProfileId: null,
  scenes: [],
  currentProgramScene: '',
  currentPreviewScene: '',
  sourceSceneName: '',
  sources: [],
  inputs: [],
  studioMode: false,
  outputs: {
    streamActive: false,
    recordActive: false,
    recordPaused: false,
    virtualCameraActive: false,
    replayBufferActive: false
  },
  stats: {
    activeFps: null,
    cpuUsage: null,
    memoryUsage: null,
    renderSkippedFrames: null,
    outputSkippedFrames: null
  },
  transitions: [],
  currentTransition: '',
  transitionDuration: 300,
  lastAction: null
}
