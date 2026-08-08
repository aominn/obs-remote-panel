import type { ObsController } from '../services/obs-controller'
import type { ConnectionProfile, ObsState } from '../types'
import { EmptyState, Section, Toggle } from './ui'

export function SourcesTab({
  profile,
  obsState,
  controller,
  updateProfile,
  reportError
}: {
  profile: ConnectionProfile
  obsState: ObsState
  controller: ObsController
  updateProfile: (updater: (profile: ConnectionProfile) => ConnectionProfile) => void
  reportError: (error: unknown) => void
}) {
  const connected = obsState.connectionStatus === 'connected'
  const savedScene = profile.selectedSourceScene ?? ''
  const selectedScene = obsState.scenes.some((scene) => scene.name === savedScene)
    ? savedScene
    : obsState.sourceSceneName || obsState.currentProgramScene || obsState.scenes[0]?.name || ''
  const visibleSources =
    obsState.sourceSceneName === selectedScene ? obsState.sources : []

  const selectScene = (sceneName: string) => {
    updateProfile((current) => ({ ...current, selectedSourceScene: sceneName }))
    void controller.refreshSources(sceneName).catch(reportError)
  }

  return (
    <Section
      title="ソース"
      description={`操作対象を選んでも、プログラムシーン（${obsState.currentProgramScene || '—'}）は切り替わりません。`}
      actions={
        <button
          className="button secondary"
          disabled={!connected}
          onClick={() => void controller.refreshSources(selectedScene).catch(reportError)}
        >
          再取得
        </button>
      }
    >
      <div className="target-selector">
        <label>
          操作するシーン
          <select
            aria-label="ソースを操作するシーン"
            value={selectedScene}
            disabled={!connected || obsState.scenes.length === 0}
            onChange={(event) => selectScene(event.target.value)}
          >
            {obsState.scenes.map((scene) => (
              <option key={scene.name} value={scene.name}>{scene.name}</option>
            ))}
          </select>
        </label>
        <small>選択中: {selectedScene || '未選択'}</small>
      </div>
      <div className="stack-list">
        {visibleSources.map((source) => (
          <article className="list-card source-card" key={`${source.sceneName}:${source.sceneItemId}`}>
            <div>
              <strong>{source.parentGroupName ? `↳ ${source.sourceName}` : source.sourceName}</strong>
              <small>
                {source.isGroup ? 'グループ' : source.parentGroupName ? `${source.parentGroupName} 内` : 'ソース'} · ID {source.sceneItemId}
              </small>
            </div>
            <Toggle
              label={source.enabled ? '表示中' : '非表示'}
              checked={source.enabled}
              disabled={!connected}
              onChange={(enabled) => void controller.setSourceEnabled(source, enabled).catch(reportError)}
            />
          </article>
        ))}
      </div>
      {visibleSources.length === 0 && (
        <EmptyState>
          {!connected || !selectedScene
            ? 'OBSへ接続してください。'
            : '選択したシーンに表示できるソースがありません。'}
        </EmptyState>
      )}
    </Section>
  )
}
