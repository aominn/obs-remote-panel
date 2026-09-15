import { useState, useSyncExternalStore } from 'react'
import { AtemController, type AtemAction } from '../services/atem-controller'
import { Section } from './ui'

export function AtemTab({ controller, mockMode }: { controller: AtemController; mockMode: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem('obs-remote-panel.atem-url') || '' } catch { return '' }
  })
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const disabled = !state.connected || state.busy || state.transitioning || connecting
  const connect = async () => {
    setConnecting(true)
    setError('')
    try {
      await controller.connect(url.trim(), token)
      if (!mockMode) {
        try { localStorage.setItem('obs-remote-panel.atem-url', url.trim()) } catch { /* Optional URL persistence. */ }
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
          <label>接続キー（保存しません）
            <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={connecting} />
          </label>
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
