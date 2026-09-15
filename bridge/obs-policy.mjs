// Only operations used by Remote Panel. Never forward arbitrary OBS requests,
// vendor requests, batch operations, input settings or stream-service secrets.
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512
const bool = (v) => typeof v === 'boolean'
const integer = (v) => Number.isInteger(v) && v >= 0 && v <= 2147483647
const fields = (schema) => (data) => data && typeof data === 'object' && !Array.isArray(data) &&
  Object.keys(data).length === Object.keys(schema).length && Object.entries(schema).every(([key, check]) => check(data[key]))
const empty = fields({})
const policies = Object.fromEntries([
  'GetSceneList', 'GetInputList', 'GetStreamStatus', 'GetRecordStatus', 'GetVirtualCamStatus',
  'GetReplayBufferStatus', 'GetStudioModeEnabled', 'GetSceneTransitionList', 'GetCurrentSceneTransition', 'GetStats',
  'StartStream', 'StopStream', 'StartRecord', 'StopRecord', 'PauseRecord', 'ResumeRecord',
  'StartVirtualCam', 'StopVirtualCam', 'StartReplayBuffer', 'StopReplayBuffer', 'SaveReplayBuffer', 'TriggerStudioModeTransition'
].map((name) => [name, empty]))
for (const name of ['GetSceneItemList', 'GetGroupSceneItemList', 'SetCurrentProgramScene', 'SetCurrentPreviewScene']) {
  policies[name] = fields({ sceneName: text })
}
for (const name of ['GetInputMute', 'GetInputVolume', 'GetInputAudioMonitorType']) policies[name] = fields({ inputName: text })
Object.assign(policies, {
  SetInputMute: fields({ inputName: text, inputMuted: bool }),
  SetInputVolume: fields({ inputName: text, inputVolumeDb: (v) => Number.isFinite(v) && v >= -100 && v <= 26 }),
  SetInputAudioMonitorType: fields({ inputName: text, monitorType: (v) => ['OBS_MONITORING_TYPE_NONE', 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'].includes(v) }),
  SetSceneItemEnabled: fields({ sceneName: text, sceneItemId: integer, sceneItemEnabled: bool }),
  SetStudioModeEnabled: fields({ studioModeEnabled: bool }),
  SetCurrentSceneTransition: fields({ transitionName: text }),
  SetCurrentSceneTransitionDuration: fields({ transitionDuration: (v) => integer(v) && v <= 120000 }),
  TriggerMediaInputAction: fields({ inputName: text, mediaAction: (v) => ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT'].includes(v) })
})
export function allowedRequest(type, data) { return Object.hasOwn(policies, type) && policies[type](data) }
export const isMutation = (type) => !type.startsWith('Get')
// Strip unused event fields: InputCreated, for example, can include input settings.
export const eventFields = {
  ConnectionClosed: [],
  CurrentProgramSceneChanged: ['sceneName'], CurrentPreviewSceneChanged: ['sceneName'],
  SceneListChanged: [], SceneNameChanged: [], SceneItemCreated: ['sceneName'], SceneItemRemoved: ['sceneName'],
  SceneItemListReindexed: ['sceneName'], SceneItemEnableStateChanged: ['sceneName', 'sceneItemId', 'sceneItemEnabled'],
  InputMuteStateChanged: ['inputName', 'inputMuted'], InputVolumeChanged: ['inputName', 'inputVolumeDb'],
  InputAudioMonitorTypeChanged: ['inputName', 'monitorType'], InputCreated: [], InputRemoved: [], InputNameChanged: [],
  StreamStateChanged: ['outputActive'], RecordStateChanged: ['outputActive', 'outputState'],
  VirtualcamStateChanged: ['outputActive'], ReplayBufferStateChanged: ['outputActive'],
  StudioModeStateChanged: ['studioModeEnabled'], CurrentSceneTransitionChanged: ['transitionName'],
  CurrentSceneTransitionDurationChanged: ['transitionDuration'], ExitStarted: []
}
