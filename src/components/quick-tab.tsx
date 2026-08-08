import { useMemo, useState } from 'react'
import type { ObsController } from '../services/obs-controller'
import type {
  AppSettings,
  ConnectionProfile,
  ObsState,
  QuickAction,
  QuickActionKind
} from '../types'
import { EmptyState, Section } from './ui'

const ACTION_TYPES: { value: QuickActionKind; label: string; needsTarget?: boolean }[] = [
  { value: 'scene', label: '指定シーンへ切り替え', needsTarget: true },
  { value: 'slide-previous', label: 'スライドショーの前へ' },
  { value: 'slide-next', label: 'スライドショーの次へ' },
  { value: 'mute', label: '音声ミュート切り替え', needsTarget: true },
  { value: 'source-visibility', label: 'ソース表示切り替え', needsTarget: true },
  { value: 'record', label: '録画開始・停止' },
  { value: 'stream', label: '配信開始・停止' },
  { value: 'virtual-camera', label: '仮想カメラ開始・停止' },
  { value: 'replay-buffer', label: 'リプレイバッファ開始・停止' },
  { value: 'replay-save', label: 'リプレイバッファ保存' },
  { value: 'studio-transition', label: 'スタジオトランジション' }
]

function defaultLabel(kind: QuickActionKind) {
  return ACTION_TYPES.find((item) => item.value === kind)?.label ?? '操作'
}

function actionTargetOptions(kind: QuickActionKind, state: ObsState) {
  if (kind === 'scene') return state.scenes.map((scene) => scene.name)
  if (kind === 'mute') return state.inputs.filter((input) => input.isAudio).map((input) => input.name)
  if (kind === 'source-visibility') return state.sources.map((source) => source.sourceName)
  return []
}

interface Props {
  profile: ConnectionProfile
  settings: AppSettings
  obsState: ObsState
  controller: ObsController
  updateProfile: (updater: (profile: ConnectionProfile) => ConnectionProfile) => void
  reportError: (error: unknown) => void
}

export function QuickTab({
  profile,
  settings,
  obsState,
  controller,
  updateProfile,
  reportError
}: Props) {
  const [editing, setEditing] = useState(false)
  const [newKind, setNewKind] = useState<QuickActionKind>('scene')
  const [newTarget, setNewTarget] = useState('')
  const connected = obsState.connectionStatus === 'connected'
  const targets = useMemo(() => actionTargetOptions(newKind, obsState), [newKind, obsState])

  const safeOutput = async (label: string, action: () => Promise<void>) => {
    if (
      settings.ui.confirmDangerousActions &&
      !window.confirm(`${label}を実行します。接続中のOBS出力へ影響します。よろしいですか？`)
    ) {
      return
    }
    await action()
  }

  const execute = async (action: QuickAction) => {
    try {
      switch (action.kind) {
        case 'scene':
          if (action.target) await controller.setCurrentScene(action.target)
          break
        case 'slide-previous':
          if (profile.selectedSlideshowInput) {
            await controller.triggerSlide(profile.selectedSlideshowInput, 'previous')
          }
          break
        case 'slide-next':
          if (profile.selectedSlideshowInput) {
            await controller.triggerSlide(profile.selectedSlideshowInput, 'next')
          }
          break
        case 'mute': {
          const input = obsState.inputs.find((item) => item.name === action.target)
          if (input) await controller.setInputMuted(input.name, !input.muted)
          break
        }
        case 'source-visibility': {
          const source = obsState.sources.find((item) => item.sourceName === action.target)
          if (source) await controller.setSourceEnabled(source, !source.enabled)
          break
        }
        case 'record':
          await safeOutput('録画の開始・停止', () => controller.toggleRecord())
          break
        case 'stream':
          await safeOutput('配信の開始・停止', () => controller.toggleStream())
          break
        case 'virtual-camera':
          await safeOutput('仮想カメラの開始・停止', () => controller.toggleVirtualCamera())
          break
        case 'replay-buffer':
          await safeOutput('リプレイバッファの開始・停止', () => controller.toggleReplayBuffer())
          break
        case 'replay-save':
          await controller.saveReplayBuffer()
          break
        case 'studio-transition':
          await controller.triggerStudioTransition()
          break
      }
    } catch (error) {
      reportError(error)
    }
  }

  const move = (index: number, offset: number) => {
    const actions = [...profile.quickActions]
    const target = index + offset
    if (target < 0 || target >= actions.length) return
    ;[actions[index], actions[target]] = [actions[target], actions[index]]
    updateProfile((current) => ({ ...current, quickActions: actions }))
  }

  const add = () => {
    const descriptor = ACTION_TYPES.find((item) => item.value === newKind)
    if (descriptor?.needsTarget && !(newTarget || targets[0])) return
    updateProfile((current) => ({
      ...current,
      quickActions: [
        ...current.quickActions,
        {
          id: crypto.randomUUID(),
          kind: newKind,
          label: defaultLabel(newKind),
          color: '#397e78',
          target: descriptor?.needsTarget ? newTarget || targets[0] : undefined
        }
      ]
    }))
  }

  return (
    <Section
      title="クイック操作"
      description={editing ? '編集モードでは操作は実行されません。' : 'よく使う操作を大きなボタンにまとめます。'}
      actions={
        <button className={editing ? 'button accent' : 'button secondary'} onClick={() => setEditing(!editing)}>
          {editing ? '編集を完了' : '配置を編集'}
        </button>
      }
    >
      {!connected && !editing && (
        <div className="inline-warning">OBS未接続のため操作ボタンは無効です。</div>
      )}
      {!profile.selectedSlideshowInput && !editing && (
        <div className="inline-warning">スライド操作を使うには「接続・同期設定」で入力を選択してください。</div>
      )}
      <div className="quick-grid">
        {profile.quickActions.map((action, index) => (
          <div className="quick-item" key={action.id}>
            <button
              className="quick-button"
              style={{ '--action-color': action.color } as React.CSSProperties}
              disabled={!connected || editing}
              onClick={() => void execute(action)}
            >
              <span>{action.label}</span>
              {action.target && <small>{action.target}</small>}
            </button>
            {editing && (
              <div className="quick-editor">
                <input
                  aria-label={`${action.label}の名前`}
                  value={action.label}
                  onChange={(event) =>
                    updateProfile((current) => ({
                      ...current,
                      quickActions: current.quickActions.map((item) =>
                        item.id === action.id ? { ...item, label: event.target.value } : item
                      )
                    }))
                  }
                />
                <input
                  aria-label={`${action.label}の色`}
                  type="color"
                  value={action.color}
                  onChange={(event) =>
                    updateProfile((current) => ({
                      ...current,
                      quickActions: current.quickActions.map((item) =>
                        item.id === action.id ? { ...item, color: event.target.value } : item
                      )
                    }))
                  }
                />
                <button aria-label="前へ移動" onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
                <button
                  aria-label="後ろへ移動"
                  onClick={() => move(index, 1)}
                  disabled={index === profile.quickActions.length - 1}
                >
                  ↓
                </button>
                <button
                  className="danger-text"
                  onClick={() =>
                    updateProfile((current) => ({
                      ...current,
                      quickActions: current.quickActions.filter((item) => item.id !== action.id)
                    }))
                  }
                >
                  削除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {obsState.lastAction && <p className="status-message" role="status">実行: {obsState.lastAction}</p>}
      {profile.quickActions.length === 0 && <EmptyState>操作ボタンがありません。</EmptyState>}
      {editing && (
        <div className="editor-card">
          <h3>操作ボタンを追加</h3>
          <label>
            操作
            <select
              value={newKind}
              onChange={(event) => {
                setNewKind(event.target.value as QuickActionKind)
                setNewTarget('')
              }}
            >
              {ACTION_TYPES.map((item) => (
                <option value={item.value} key={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          {targets.length > 0 && (
            <label>
              対象
              <select value={newTarget} onChange={(event) => setNewTarget(event.target.value)}>
                {targets.map((target) => <option key={target}>{target}</option>)}
              </select>
            </label>
          )}
          <button className="button accent" onClick={add}>追加</button>
        </div>
      )}
    </Section>
  )
}
