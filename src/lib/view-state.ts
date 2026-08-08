export type MainTabId = 'quick' | 'scenes' | 'sources' | 'audio' | 'details' | 'settings'

export const ACTIVE_TAB_STORAGE_KEY = 'obs-remote-panel.active-tab.v1'

const MAIN_TABS = new Set<MainTabId>([
  'quick',
  'scenes',
  'sources',
  'audio',
  'details',
  'settings'
])

export function loadActiveTab(
  storage: Pick<Storage, 'getItem'> = localStorage
): MainTabId {
  try {
    const value = storage.getItem(ACTIVE_TAB_STORAGE_KEY)
    return MAIN_TABS.has(value as MainTabId) ? (value as MainTabId) : 'quick'
  } catch {
    return 'quick'
  }
}

export function saveActiveTab(
  tab: MainTabId,
  storage: Pick<Storage, 'setItem'> = localStorage
): boolean {
  try {
    storage.setItem(ACTIVE_TAB_STORAGE_KEY, tab)
    return true
  } catch {
    return false
  }
}
