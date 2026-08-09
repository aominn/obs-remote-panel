import { useEffect, useRef, useState } from 'react'
import {
  isInputAudioMonitoringOn,
  type ObsController
} from '../services/obs-controller'
import type { ConnectionProfile, ObsState } from '../types'
import { EmptyState, Section } from './ui'

export function AudioTab({
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
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [monitoringInput, setMonitoringInput] = useState<string | null>(null)
  const timers = useRef<Record<string, number>>({})

  useEffect(
    () => () => Object.values(timers.current).forEach((timer) => window.clearTimeout(timer)),
    []
  )

  const setVolume = (name: string, value: number) => {
    setVolumes((current) => ({ ...current, [name]: value }))
    window.clearTimeout(timers.current[name])
    timers.current[name] = window.setTimeout(() => {
      void controller
        .setInputVolume(name, value)
        .then(() => {
          setVolumes((current) => {
            const next = { ...current }
            delete next[name]
            return next
          })
        })
        .catch(reportError)
    }, 160)
  }

  const audioInputs = obsState.inputs.filter((input) => input.isAudio)
  const savedInput = profile.selectedAudioInput ?? ''
  const selectedInput =
    audioInputs.find((input) => input.name === savedInput) ?? audioInputs[0]
  const monitoringOn = isInputAudioMonitoringOn(selectedInput?.monitorType)

  const toggleMonitoring = async () => {
    if (!selectedInput || monitoringInput === selectedInput.name) return
    setMonitoringInput(selectedInput.name)
    try {
      await controller.setInputAudioMonitoring(selectedInput.name, !monitoringOn)
    } catch (error) {
      reportError(error)
    } finally {
      setMonitoringInput(null)
    }
  }

  return (
    <Section
      title="音声"
      description="操作する音声入力を選び、ミュートと音量を調整します。OBSの現在値へ自動で同期します。"
      actions={
        <button
          className="button secondary"
          disabled={!connected}
          onClick={() => void controller.refreshInputs().catch(reportError)}
        >
          再取得
        </button>
      }
    >
      <div className="target-selector">
        <label>
          操作する音声入力
          <select
            aria-label="操作する音声入力"
            value={selectedInput?.name ?? ''}
            disabled={!connected || audioInputs.length === 0}
            onChange={(event) => {
              const inputName = event.target.value
              updateProfile((current) => ({ ...current, selectedAudioInput: inputName }))
            }}
          >
            {audioInputs.map((input) => (
              <option key={input.name} value={input.name}>{input.name}</option>
            ))}
          </select>
        </label>
        <small>選択中: {selectedInput?.name ?? '未選択'}</small>
      </div>
      <div className="stack-list selected-audio-control">
        {selectedInput && (
          <article className="audio-card" key={selectedInput.name}>
            <div className="audio-heading">
              <div>
                <strong>{selectedInput.name}</strong>
                <small>{(volumes[selectedInput.name] ?? selectedInput.volumeDb).toFixed(1)} dB</small>
              </div>
              <button
                className={selectedInput.muted ? 'button danger' : 'button secondary'}
                disabled={!connected}
                onClick={() => void controller.setInputMuted(selectedInput.name, !selectedInput.muted).catch(reportError)}
              >
                {selectedInput.muted ? 'ミュート解除' : 'ミュート'}
              </button>
            </div>
            <input
              className="volume-slider"
              aria-label={`${selectedInput.name}の音量`}
              type="range"
              min="-60"
              max="0"
              step="0.5"
              disabled={!connected}
              value={volumes[selectedInput.name] ?? selectedInput.volumeDb}
              onInput={(event) => setVolume(selectedInput.name, Number(event.currentTarget.value))}
            />
            <button
              className={`button monitoring-toggle${monitoringOn ? ' active' : ''}`}
              aria-pressed={monitoringOn}
              aria-busy={monitoringInput === selectedInput.name}
              disabled={!connected || monitoringInput === selectedInput.name}
              onClick={() => void toggleMonitoring()}
            >
              {monitoringOn ? 'モニタリング ON' : 'モニタリング OFF'}
            </button>
            <button
              className="favorite-button"
              onClick={() => updateProfile((current) => ({
                ...current,
                favoriteAudioInputs: current.favoriteAudioInputs.includes(selectedInput.name)
                  ? current.favoriteAudioInputs.filter((name) => name !== selectedInput.name)
                  : [...current.favoriteAudioInputs, selectedInput.name]
              }))}
            >
              {profile.favoriteAudioInputs.includes(selectedInput.name) ? '★ お気に入り解除' : '☆ お気に入り'}
            </button>
          </article>
        )}
      </div>
      {audioInputs.length === 0 && <EmptyState>音声入力がありません。OBSへ接続してください。</EmptyState>}
    </Section>
  )
}
