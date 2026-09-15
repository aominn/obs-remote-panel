const string = (v) => typeof v === 'string' && v.length <= 512
const strings = (v) => Array.isArray(v) && v.length <= 128 && v.every(string)
export const operationFields = ['name', 'quickActions', 'favoriteScenes', 'favoriteAudioInputs', 'sceneOrder', 'hiddenScenes',
  'visibleDetailActions', 'selectedSlideshowInput', 'selectedSourceScene', 'selectedAudioInput']
const kinds = new Set(['scene', 'slide-previous', 'slide-next', 'mute', 'source-visibility', 'record', 'stream', 'virtual-camera', 'replay-buffer', 'replay-save', 'studio-transition'])
export function sanitizeOperations(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid profile')
  const result = Object.fromEntries(operationFields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))
  for (const key of ['name', 'selectedSlideshowInput', 'selectedSourceScene', 'selectedAudioInput']) {
    if (result[key] !== undefined && !string(result[key])) throw new Error('Invalid profile field')
  }
  for (const key of ['favoriteScenes', 'favoriteAudioInputs', 'sceneOrder', 'hiddenScenes', 'visibleDetailActions']) {
    if (result[key] !== undefined && !strings(result[key])) throw new Error('Invalid profile field')
  }
  if (!Array.isArray(result.quickActions) || result.quickActions.length > 64) throw new Error('Invalid actions')
  result.quickActions = result.quickActions.map((action) => {
    if (!action || !string(action.id) || !kinds.has(action.kind) || !string(action.label) || !string(action.color) ||
      (action.target !== undefined && !string(action.target))) throw new Error('Invalid action')
    return { id: action.id, kind: action.kind, label: action.label, color: action.color,
      ...(action.target !== undefined ? { target: action.target } : {}) }
  })
  return result
}
