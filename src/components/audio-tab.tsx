import { useEffect, useRef, useState } from 'react'
import type { ObsController } from '../services/obs-controller'
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
  return (
    <Section title="音声" description="音量送信は160msに抑制し、OBSイベントで最終値を同期します。">
      <div className="stack-list">
        {audioInputs.map((input) => (
          <article className="audio-card" key={input.name}>
            <div className="audio-heading">
              <div>
                <strong>{input.name}</strong>
                <small>{(volumes[input.name] ?? input.volumeDb).toFixed(1)} dB</small>
              </div>
              <button
                className={input.muted ? 'button danger' : 'button secondary'}
                disabled={!connected}
                onClick={() => void controller.setInputMuted(input.name, !input.muted).catch(reportError)}
              >
                {input.muted ? 'ミュート解除' : 'ミュート'}
              </button>
            </div>
            <input
              className="volume-slider"
              aria-label={`${input.name}の音量`}
              type="range"
              min="-60"
              max="0"
              step="0.5"
              disabled={!connected}
              value={volumes[input.name] ?? input.volumeDb}
              onInput={(event) => setVolume(input.name, Number(event.currentTarget.value))}
            />
            <button
              className="favorite-button"
              onClick={() => updateProfile((current) => ({
                ...current,
                favoriteAudioInputs: current.favoriteAudioInputs.includes(input.name)
                  ? current.favoriteAudioInputs.filter((name) => name !== input.name)
                  : [...current.favoriteAudioInputs, input.name]
              }))}
            >
              {profile.favoriteAudioInputs.includes(input.name) ? '★ お気に入り解除' : '☆ お気に入り'}
            </button>
          </article>
        ))}
      </div>
      {audioInputs.length === 0 && <EmptyState>音声入力がありません。OBSへ接続してください。</EmptyState>}
    </Section>
  )
}
