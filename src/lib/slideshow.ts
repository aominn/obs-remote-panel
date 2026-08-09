import type { ConnectionProfile, InputInfo, QuickActionKind } from '../types'

export const SLIDESHOW_INPUT_KIND = 'slideshow_v2'

export function isSlideshowInput(input: InputInfo) {
  return input.kind === SLIDESHOW_INPUT_KIND
}

export function slideshowInputs(inputs: InputInfo[]) {
  return inputs.filter(isSlideshowInput)
}

export function isSlideshowAction(kind: QuickActionKind) {
  return kind === 'slide-previous' || kind === 'slide-next'
}

export function backfillSlideshowActionTargets(
  profile: ConnectionProfile,
  inputs: InputInfo[]
): ConnectionProfile {
  const candidates = slideshowInputs(inputs)
  const legacyTarget = candidates.some((input) => input.name === profile.selectedSlideshowInput)
    ? profile.selectedSlideshowInput
    : candidates[0]?.name
  if (!legacyTarget) return profile

  let changed = false
  const quickActions = profile.quickActions.map((action) => {
    if (!isSlideshowAction(action.kind) || action.target) return action
    changed = true
    return { ...action, target: legacyTarget }
  })
  return changed ? { ...profile, quickActions } : profile
}
