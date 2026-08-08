import { useCallback, useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AudioTab } from './components/audio-tab'
import { DetailsTab } from './components/details-tab'
import { QuickTab } from './components/quick-tab'
import { ScenesTab } from './components/scenes-tab'
import { SettingsTab } from './components/settings-tab'
import { SourcesTab } from './components/sources-tab'
import { useCloudSync } from './hooks/use-cloud-sync'
import { useObs } from './hooks/use-obs'
import { useSettings } from './hooks/use-settings'
import { validateObsUrl } from './lib/settings'
import type { ConnectionStatus } from './types'

type TabId = 'quick' | 'scenes' | 'sources' | 'audio' | 'details' | 'settings'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'quick', label: 'クイック', icon: '◆' },
  { id: 'scenes', label: 'シーン', icon: '▣' },
  { id: 'sources', label: 'ソース', icon: '◫' },
  { id: 'audio', label: '音声', icon: '◒' },
  { id: 'details', label: '詳細', icon: '⚙' },
  { id: 'settings', label: '接続・同期', icon: '⌁' }
]

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: '未接続',
  connecting: '接続中',
  connected: '接続済み',
  reconnecting: '再接続中',
  error: '接続エラー'
}

export default function App() {
  const mockMode = new URLSearchParams(window.location.search).get('mock') === '1'
  const [tab, setTab] = useState<TabId>('quick')
  const [notice, setNotice] = useState<string | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const {
    settings,
    activeProfile,
    updateSettings,
    updateProfile,
    replaceSettings,
    storageError
  } = useSettings()
  const { controller, obsState } = useObs(mockMode)
  const cloud = useCloudSync(settings, replaceSettings)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW()

  const reportError = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : '操作に失敗しました。OBSの状態を確認してください。')
  }, [])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (obsState.connectedProfileId && obsState.connectedProfileId !== activeProfile.id) {
      void controller.disconnect().catch(reportError)
    }
  }, [activeProfile.id, controller, obsState.connectedProfileId, reportError])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const connect = async () => {
    if (!online) {
      setNotice('オフライン中はOBSへ接続できません。')
      return
    }
    if (!mockMode) {
      if (!activeProfile.url) {
        setNotice('接続・同期設定でWSS接続先を入力してください。')
        setTab('settings')
        return
      }
      const validation = validateObsUrl(activeProfile.url)
      if (validation) {
        setNotice(validation)
        setTab('settings')
        return
      }
    }
    try {
      await controller.connect(activeProfile)
    } catch (error) {
      reportError(error)
    }
  }

  const connected = obsState.connectionStatus === 'connected'
  const busy = obsState.connectionStatus === 'connecting' || obsState.connectionStatus === 'reconnecting'
  const profileUpdater = (updater: Parameters<typeof updateProfile>[1]) =>
    updateProfile(activeProfile.id, updater)

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <header className="app-header">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">●</div>
          <div className="brand-copy">
            <span>OBS Remote Panel</span>
            <small>{mockMode ? `モック · ${activeProfile.name}` : activeProfile.name}</small>
          </div>
          <span className={`connection-badge status-${obsState.connectionStatus}`}>
            <span aria-hidden="true" />{STATUS_LABELS[obsState.connectionStatus]}
          </span>
        </div>
        <div className="now-row">
          <div>
            <small>プログラムシーン</small>
            <strong>{obsState.currentProgramScene || '未取得'}</strong>
          </div>
          {connected ? (
            <button className="button secondary compact" onClick={() => void controller.disconnect().catch(reportError)}>切断</button>
          ) : (
            <button className="button accent compact" disabled={busy || !online} onClick={() => void connect()}>
              {busy ? '接続中…' : '接続'}
            </button>
          )}
        </div>
      </header>

      {mockMode && <div className="global-banner mock-banner">モックモード — 実際のOBSには接続していません</div>}
      {!online && <div className="global-banner offline-banner">オフライン — ローカル設定は利用できますがOBS接続と同期はできません</div>}
      {obsState.connectionError && (
        <button className="global-banner error-banner" onClick={() => setTab('settings')}>
          {obsState.connectionError} <u>接続診断を開く</u>
        </button>
      )}
      {(storageError || notice) && <div className="toast" role="alert">{storageError ?? notice}</div>}
      {(needRefresh || offlineReady) && (
        <div className="update-banner" role="status">
          <span>{needRefresh ? '新しいバージョンを利用できます。' : 'オフラインでも画面を開ける準備ができました。'}</span>
          {needRefresh && <button className="button accent" onClick={() => void updateServiceWorker(true)}>更新</button>}
          <button
            className="button secondary"
            onClick={() => {
              setNeedRefresh(false)
              setOfflineReady(false)
            }}
          >
            閉じる
          </button>
        </div>
      )}

      <main id="main-content" className="main-content" tabIndex={-1}>
        {tab === 'quick' && (
          <QuickTab
            profile={activeProfile}
            settings={settings}
            obsState={obsState}
            controller={controller}
            updateProfile={profileUpdater}
            reportError={reportError}
          />
        )}
        {tab === 'scenes' && (
          <ScenesTab
            profile={activeProfile}
            obsState={obsState}
            controller={controller}
            updateProfile={profileUpdater}
            reportError={reportError}
          />
        )}
        {tab === 'sources' && <SourcesTab obsState={obsState} controller={controller} reportError={reportError} />}
        {tab === 'audio' && (
          <AudioTab
            profile={activeProfile}
            obsState={obsState}
            controller={controller}
            updateProfile={profileUpdater}
            reportError={reportError}
          />
        )}
        {tab === 'details' && (
          <DetailsTab
            settings={settings}
            profile={activeProfile}
            obsState={obsState}
            controller={controller}
            reportError={reportError}
          />
        )}
        {tab === 'settings' && (
          <SettingsTab
            settings={settings}
            profile={activeProfile}
            obsState={obsState}
            cloud={cloud}
            updateSettings={updateSettings}
            updateProfile={profileUpdater}
            replaceSettings={replaceSettings}
            mockMode={mockMode}
            controller={controller}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="メインメニュー">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  )
}
