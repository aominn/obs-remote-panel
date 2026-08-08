import type { ObsController } from '../services/obs-controller'
import type { ObsState } from '../types'
import { EmptyState, Section, Toggle } from './ui'

export function SourcesTab({
  obsState,
  controller,
  reportError
}: {
  obsState: ObsState
  controller: ObsController
  reportError: (error: unknown) => void
}) {
  const connected = obsState.connectionStatus === 'connected'
  return (
    <Section
      title="ソース"
      description={`現在のプログラムシーン: ${obsState.currentProgramScene || '—'}`}
      actions={
        <button
          className="button secondary"
          disabled={!connected}
          onClick={() => void controller.refreshSources().catch(reportError)}
        >
          再取得
        </button>
      }
    >
      <div className="stack-list">
        {obsState.sources.map((source) => (
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
      {obsState.sources.length === 0 && <EmptyState>現在のシーンに表示できるソースがありません。</EmptyState>}
    </Section>
  )
}
