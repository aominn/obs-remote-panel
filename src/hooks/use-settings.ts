import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, ConnectionProfile } from '../types'
import {
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  touchSettings,
  validateSettings
} from '../lib/settings'

type SettingsUpdater = (current: AppSettings) => AppSettings

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(() => loadSettings())
  const storageError: string | null = null

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_STORAGE_KEY || !event.newValue) return
      try {
        const incoming: unknown = JSON.parse(event.newValue)
        if (validateSettings(incoming) && incoming.revision > settings.revision) {
          setSettingsState(incoming)
        }
      } catch {
        // A broken value in another tab must not replace the valid in-memory settings.
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [settings.revision])

  const updateSettings = useCallback((updater: SettingsUpdater) => {
    setSettingsState((current) => {
      const next = touchSettings(updater(current))
      saveSettings(next)
      return next
    })
  }, [])

  const replaceSettings = useCallback((next: AppSettings) => {
    saveSettings(next)
    setSettingsState(next)
  }, [])

  const activeProfile = useMemo(
    () => settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0],
    [settings]
  )

  const updateProfile = useCallback(
    (profileId: string, updater: (profile: ConnectionProfile) => ConnectionProfile) => {
      updateSettings((current) => ({
        ...current,
        profiles: current.profiles.map((profile) =>
          profile.id === profileId
            ? { ...updater(profile), updatedAt: new Date().toISOString() }
            : profile
        )
      }))
    },
    [updateSettings]
  )

  return {
    settings,
    activeProfile,
    updateSettings,
    updateProfile,
    replaceSettings,
    storageError
  }
}
