import { useState, useSyncExternalStore } from 'react'
import { AtemController, type AtemAction } from '../services/atem-controller'
import { Section } from './ui'
import type { ConnectionProfile } from '../types'

export function AtemTab({ controller, mockMode, profile, updateProfile }: {
  controller: AtemController; mockMode: boolean
  profile?: ConnectionProfile
  updateProfile?: (updater: (profile: ConnectionProfile) => ConnectionProfile) => void
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  const [fallbackUrl, setFallbackUrl] = useState('')
  const url = profile?.atem?.url ?? fallbackUrl
  const setUrl = (value: string) => {
    setFallbackUrl(value.trim())
    setToken('')
    updateProfile?.((current) => ({ ...current, atem: { url: value.trim() } }))
  }
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(Boolean(profile?.atem?.token))
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const disabled = !state.connected || state.busy || state.transitioning || connecting
  const connect = async () => {
    setConnecting(true)
    setError('')
    try {
      const effectiveToken = token || profile?.atem?.token || ''
      await controller.connect(url.trim(), effectiveToken)
      if (!mockMode) {
        updateProfile?.((current) => ({ ...current, atem: { url: url.trim(), ...(remember ? { token: effectiveToken } : {}) } }))
      }
      setToken('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ATEM接続に失敗しました。')
    } finally { setConnecting(false) }
  }
  const execute = async (action: AtemAction, input?: number) => {
    setError('')
    try { await controller.command(action, input) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ATEM操作に失敗しました。') }
  }
  const inputName = (id: number | null) => state.inputs.find((input) => input.id === id)?.name ?? (id === null ? '未取得' : `入力 ${id}`)
  return (
    <Section title="ATEM" description="本番とプレビューを選択し、CUT／AUTOで切り替えます。">
      <p role="status">{mockMode ? 'モック · ' : ''}{state.connected ? `${state.model} · 接続済み` : 'ATEM未接続（再接続待ち／本体を確認）'}</p>
      {error && <p className="inline-warning" role="alert">{error}</p>}
      <details open={!state.connected}>
        <summary>ATEM接続</summary>
        {!mockMode && <>
          <p>ATEMはOBSと同じPCからLANで制御します。PC側の仲介サービスを起動してください。</p>
          <label>仲介サービスのHTTPS URL
            <input type="url" value={url} placeholder="https://your-pc.your-tailnet.ts.net/atem" onChange={(event) => setUrl(event.target.value)} disabled={connecting} />
          </label>
          <p>環境：{profile?.name ?? 'ATEM'}。接続先は「接続・同期」のプロファイルと一緒に引き継げます。</p>
          <label>接続キー
            <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={connecting} />
          </label>
          {profile?.atem?.token && <p>この端末に保存したキーを使用できます。変更する場合だけ入力してください。</p>}
          <label><input type="checkbox" checked={remember} onChange={(event) => {
            setRemember(event.target.checked)
            if (!event.target.checked) updateProfile?.((current) => ({ ...current, atem: { url: current.atem?.url ?? '' } }))
          }} />この端末にキーを記憶する（自分専用の端末のみ）</label>
          <small>ブラウザ内には暗号化せず保存します。端末ロックを使用し、共用端末では選ばないでください。Windowsの暗号化保存とは異なります。解除すると保存キーを削除します。</small>
        </>}
        <div className="button-row">
          <button className="button accent" disabled={connecting || state.connected} onClick={() => void connect()}>{connecting ? '接続中…' : 'ATEMに接続'}</button>
          <button className="button secondary" disabled={connecting} onClick={() => { controller.disconnect(); setToken(''); setError('') }}>ATEMを切断</button>
        </div>
      </details>
      <div className="atem-status">
        <div className="atem-program"><small>本番（PROGRAM）</small><strong>{inputName(state.program)}</strong></div>
        <div className="atem-preview"><small>プレビュー（PREVIEW）</small><strong>{inputName(state.preview)}</strong></div>
      </div>
      {(['program', 'preview'] as const).map((bus) => (
        <div key={bus}>
          <h3>{bus === 'program' ? '本番へ直接切り替え' : '次に出す入力を選択'}</h3>
          <div className={`atem-inputs atem-${bus}`}>
            {state.inputs.map((input) => (
              <button key={input.id} className="button secondary" disabled={disabled}
                aria-label={`${bus === 'program' ? '本番' : 'プレビュー'} ${input.name}`}
                aria-pressed={state[bus] === input.id}
                onClick={() => void execute(bus, input.id)}>
                <span>{input.name}</span>
                {state[bus] === input.id && <small>{bus === 'program' ? '本番中' : '選択中'}</small>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="atem-transitions">
        <button className="button secondary" disabled={disabled} onClick={() => void execute('cut')}>CUT</button>
        <button className="button accent" disabled={disabled} onClick={() => void execute('auto')}>AUTO</button>
      </div>
      <small>{state.transitioning ? 'トランジション中' : 'AUTOはATEM本体で設定したトランジションを使用します。'}</small>
    </Section>
  )
}
