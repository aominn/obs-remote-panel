import type { ObsController } from '../services/obs-controller'
import type { AppSettings, ConnectionProfile, ObsState } from '../types'
import { Section, StatePill, Toggle } from './ui'

function Stat({ label, value, unit = '' }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="stat-card">
      <small>{label}</small>
      <strong>{value === null ? '取得非対応' : `${value.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}${unit}`}</strong>
    </div>
  )
}

export function DetailsTab({
  settings,
  profile,
  obsState,
  controller,
  reportError
}: {
  settings: AppSettings
  profile: ConnectionProfile
  obsState: ObsState
  controller: ObsController
  reportError: (error: unknown) => void
}) {
  const connected = obsState.connectionStatus === 'connected'
  const shows = (name: string) => profile.visibleDetailActions.includes(name)
  const run = (label: string, action: () => Promise<void>) => {
    if (
      settings.ui.confirmDangerousActions &&
      !window.confirm(`${label}を実行します。接続中のOBS出力へ影響します。よろしいですか？`)
    ) {
      return
    }
    void action().catch(reportError)
  }

  return (
    <div className="tab-sections">
      <Section title="出力操作" description="開始・停止は確認後に実行します。">
        <div className="output-grid">
          {shows('stream') && <article className="output-card">
            <StatePill active={obsState.outputs.streamActive}>{obsState.outputs.streamActive ? '配信中' : '停止中'}</StatePill>
            <strong>配信</strong>
            <button
              className={obsState.outputs.streamActive ? 'button danger' : 'button accent'}
              disabled={!connected}
              onClick={() => run('配信の開始・停止', () => controller.toggleStream())}
            >
              {obsState.outputs.streamActive ? '配信を停止' : '配信を開始'}
            </button>
          </article>}
          {shows('record') && <article className="output-card">
            <StatePill active={obsState.outputs.recordActive}>{obsState.outputs.recordActive ? '録画中' : '停止中'}</StatePill>
            <strong>録画</strong>
            <button
              className={obsState.outputs.recordActive ? 'button danger' : 'button accent'}
              disabled={!connected}
              onClick={() => run('録画の開始・停止', () => controller.toggleRecord())}
            >
              {obsState.outputs.recordActive ? '録画を停止' : '録画を開始'}
            </button>
            {obsState.outputs.recordActive && (
              <button
                className="button secondary"
                onClick={() => void controller.toggleRecordPause().catch(reportError)}
              >
                {obsState.outputs.recordPaused ? '録画を再開' : '録画を一時停止'}
              </button>
            )}
          </article>}
          {shows('virtual-camera') && <article className="output-card">
            <StatePill active={obsState.outputs.virtualCameraActive}>{obsState.outputs.virtualCameraActive ? '稼働中' : '停止中'}</StatePill>
            <strong>仮想カメラ</strong>
            <button
              className={obsState.outputs.virtualCameraActive ? 'button danger' : 'button accent'}
              disabled={!connected}
              onClick={() => run('仮想カメラの開始・停止', () => controller.toggleVirtualCamera())}
            >
              {obsState.outputs.virtualCameraActive ? '停止' : '開始'}
            </button>
          </article>}
          {shows('replay-buffer') && <article className="output-card">
            <StatePill active={obsState.outputs.replayBufferActive}>{obsState.outputs.replayBufferActive ? '稼働中' : '停止中'}</StatePill>
            <strong>リプレイバッファ</strong>
            <button
              className={obsState.outputs.replayBufferActive ? 'button danger' : 'button accent'}
              disabled={!connected}
              onClick={() => run('リプレイバッファの開始・停止', () => controller.toggleReplayBuffer())}
            >
              {obsState.outputs.replayBufferActive ? '停止' : '開始'}
            </button>
            <button
              className="button secondary"
              disabled={!connected || !obsState.outputs.replayBufferActive}
              onClick={() => void controller.saveReplayBuffer().catch(reportError)}
            >
              リプレイを保存
            </button>
          </article>}
        </div>
      </Section>

      {shows('studio-mode') && <Section title="スタジオモードとトランジション">
        <Toggle
          label="スタジオモード"
          checked={obsState.studioMode}
          disabled={!connected}
          onChange={(enabled) => run('スタジオモード切り替え', () => controller.setStudioMode(enabled))}
        />
        <label>
          プレビューシーン
          <select
            disabled={!connected || !obsState.studioMode}
            value={obsState.currentPreviewScene}
            onChange={(event) => void controller.setPreviewScene(event.target.value).catch(reportError)}
          >
            {obsState.scenes.map((scene) => <option value={scene.name} key={scene.name}>{scene.name}</option>)}
          </select>
        </label>
        <div className="form-grid">
          <label>
            トランジション
            <select
              disabled={!connected}
              value={obsState.currentTransition}
              onChange={(event) => void controller.setTransition(event.target.value).catch(reportError)}
            >
              {obsState.transitions.map((transition) => (
                <option value={transition.name} key={transition.name}>{transition.name}</option>
              ))}
            </select>
          </label>
          <label>
            時間 (ms)
            <input
              type="number"
              min="50"
              max="20000"
              step="50"
              disabled={!connected}
              value={obsState.transitionDuration}
              onChange={(event) => void controller.setTransitionDuration(Number(event.target.value)).catch(reportError)}
            />
          </label>
        </div>
        <button
          className="button primary-action"
          disabled={!connected || !obsState.studioMode}
          onClick={() => void controller.triggerStudioTransition().catch(reportError)}
        >
          プレビューをプログラムへ送る
        </button>
      </Section>}

      {shows('stats') && <Section title="OBS統計" description="OBS WebSocketが返した値のみを表示します。">
        <div className="stats-grid">
          <Stat label="FPS" value={obsState.stats.activeFps} />
          <Stat label="CPU" value={obsState.stats.cpuUsage} unit="%" />
          <Stat label="メモリ" value={obsState.stats.memoryUsage} unit=" MB" />
          <Stat label="描画スキップ" value={obsState.stats.renderSkippedFrames} />
          <Stat label="出力スキップ" value={obsState.stats.outputSkippedFrames} />
        </div>
        <button
          className="button secondary"
          disabled={!connected}
          onClick={() => void controller.refreshAll().catch(reportError)}
        >
          状態を再取得
        </button>
      </Section>}
    </div>
  )
}
