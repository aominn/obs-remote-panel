import { useMemo } from 'react'
import type { ObsController } from '../services/obs-controller'
import type { ConnectionProfile, ObsState } from '../types'
import { EmptyState, Section, StatePill } from './ui'

export function ScenesTab({
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
  const scenes = useMemo(() => {
    const order = new Map(profile.sceneOrder.map((name, index) => [name, index]))
    return [...obsState.scenes]
      .filter((scene) => !profile.hiddenScenes.includes(scene.name))
      .sort((a, b) => (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999))
  }, [obsState.scenes, profile.hiddenScenes, profile.sceneOrder])

  const toggleFavorite = (name: string) => {
    updateProfile((current) => ({
      ...current,
      favoriteScenes: current.favoriteScenes.includes(name)
        ? current.favoriteScenes.filter((item) => item !== name)
        : [...current.favoriteScenes, name]
    }))
  }

  const move = (name: string, offset: number) => {
    const order = scenes.map((scene) => scene.name)
    const index = order.indexOf(name)
    const target = index + offset
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    updateProfile((current) => ({ ...current, sceneOrder: order }))
  }

  return (
    <Section
      title="シーン"
      description="プログラム出力とスタジオモードのプレビューを区別して表示します。"
      actions={
        <button
          className="button secondary"
          disabled={!connected}
          onClick={() => void controller.refreshScenes().catch(reportError)}
        >
          再取得
        </button>
      }
    >
      <div className="scene-status-row">
        <div><small>プログラム</small><strong>{obsState.currentProgramScene || '—'}</strong></div>
        <div><small>プレビュー</small><strong>{obsState.studioMode ? obsState.currentPreviewScene || '—' : 'スタジオモードOFF'}</strong></div>
      </div>
      <div className="stack-list">
        {scenes.map((scene, index) => {
          const current = scene.name === obsState.currentProgramScene
          const preview = scene.name === obsState.currentPreviewScene && obsState.studioMode
          return (
            <article className={`list-card ${current ? 'current' : ''}`} key={scene.name}>
              <button
                className="list-card-main"
                disabled={!connected || current}
                onClick={() => void controller.setCurrentScene(scene.name).catch(reportError)}
              >
                <span>{scene.name}</span>
                <span className="pill-row">
                  {current && <StatePill active>プログラム</StatePill>}
                  {preview && <StatePill active>プレビュー</StatePill>}
                </span>
              </button>
              <div className="list-actions">
                <button aria-label={`${scene.name}のお気に入り`} onClick={() => toggleFavorite(scene.name)}>
                  {profile.favoriteScenes.includes(scene.name) ? '★' : '☆'}
                </button>
                <button aria-label="上へ" disabled={index === 0} onClick={() => move(scene.name, -1)}>↑</button>
                <button aria-label="下へ" disabled={index === scenes.length - 1} onClick={() => move(scene.name, 1)}>↓</button>
                <button
                  aria-label={`${scene.name}を隠す`}
                  onClick={() => updateProfile((currentProfile) => ({
                    ...currentProfile,
                    hiddenScenes: [...currentProfile.hiddenScenes, scene.name]
                  }))}
                >
                  隠す
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {scenes.length === 0 && <EmptyState>表示できるシーンがありません。OBSへ接続してください。</EmptyState>}
      {profile.hiddenScenes.length > 0 && (
        <details className="details-box">
          <summary>非表示シーン ({profile.hiddenScenes.length})</summary>
          {profile.hiddenScenes.map((name) => (
            <button
              className="button secondary"
              key={name}
              onClick={() => updateProfile((current) => ({
                ...current,
                hiddenScenes: current.hiddenScenes.filter((item) => item !== name)
              }))}
            >
              {name}を再表示
            </button>
          ))}
        </details>
      )}
    </Section>
  )
}
