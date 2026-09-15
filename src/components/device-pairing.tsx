import { useEffect, useRef, useState } from 'react'
import { newDeviceSecret, panelFetch, parseInvitation, readRegistration, saveRegistration } from '../lib/device-registration'
import type { ConnectionProfile } from '../types'
import { Section } from './ui'
import { applySharedOperations, sharedOperations } from '../lib/shared-operations'

export function DevicePairing({ initialLink, profile, onRegistered, mockMode, updateProfile, onForget }: {
  initialLink: string; profile: ConnectionProfile; mockMode: boolean
  onRegistered: (url: string, name: string) => void
  updateProfile: (updater: (current: ConnectionProfile) => ConnectionProfile) => void
  onForget: () => void
}) {
  const [link, setLink] = useState(initialLink)
  const [name, setName] = useState('自分の操作端末')
  const [message, setMessage] = useState('')
  const [request, setRequest] = useState<{ url: string; id: string; code: string; expires: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const secret = useRef('')
  const registered = profile.hub ? readRegistration(profile.hub.url) : null
  const share = async (save: boolean) => {
    if (!profile.hub || !registered) return
    setBusy(true)
    try {
      const remote = await panelFetch(profile.hub.url, '/profile', registered.token)
      if (save) {
        if (!window.confirm('この環境の操作設定を機材PCへ保存します。既存の共有設定があれば置き換えます。接続情報・パスワード・端末の操作許可は共有しません。')) return
        await panelFetch(profile.hub.url, '/profile', registered.token, { revision: remote.revision, profile: sharedOperations(profile) })
        setMessage('機材PCへ保存しました。登録済みの別端末で「操作設定を取り込む」を押すと引き継げます。')
      } else {
        if (!remote.profile) throw new Error('共有された操作設定はまだありません。設定済みの操作PCから保存してください。')
        const next = applySharedOperations(profile, remote.profile)
        if (!window.confirm('この環境のボタン配置・お気に入り等を共有設定で置き換えます。接続先は変わりません。よろしいですか？')) return
        updateProfile(() => next)
        setMessage('操作設定を取り込みました。機器の操作は実行していません。')
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '設定共有に失敗しました。') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!request) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const abort = new AbortController()
    const poll = async () => {
      try {
        if (Date.now() >= request.expires) throw new Error('登録の有効期限が切れました。機材PCで再発行してください。')
        const result = await panelFetch(request.url, '/pair/claim', undefined, { id: request.id, secret: secret.current }, abort.signal)
        if (cancelled) return
        if (result.approved) {
          saveRegistration(request.url, { id: request.id, name, token: secret.current })
          secret.current = ''
          onRegistered(request.url, result.hubName || '機材PC')
          setRequest(null)
          setMessage('登録しました。OBSは上部の「接続」、ATEMはATEMタブから接続できます。機材のパスワード入力は不要です。')
        } else timer = setTimeout(poll, 2000)
      } catch (error) {
        if (!cancelled) { setMessage(error instanceof Error ? error.message : '登録できませんでした。'); setRequest(null); secret.current = '' }
      }
    }
    void poll()
    return () => { cancelled = true; abort.abort(); clearTimeout(timer) }
  }, [request, name, onRegistered])
  const start = async () => {
    setBusy(true)
    setMessage('')
    try {
      const invitation = parseInvitation(link.trim())
      secret.current = newDeviceSecret()
      const result = await panelFetch(invitation.url, '/pair/request', undefined, { invite: invitation.invite, name, secret: secret.current })
      setRequest({ url: invitation.url, ...result })
      setLink('')
    } catch (error) { secret.current = ''; setMessage(error instanceof Error ? error.message : '登録できませんでした。') }
    finally { setBusy(false) }
  }
  return <Section title="機材PCへ端末を登録" description="機材PCでは start-panel.cmd を起動するだけ。Remote Panelを開く必要はありません。操作端末もTailscaleへ接続してください。">
    {profile.hub && <p style={{ overflowWrap: 'anywhere' }}>接続先：{profile.hub.url} — {registered ? 'この端末は登録済み' : 'この端末では登録が必要'}</p>}
    {mockMode ? <p>モック中は実機への端末登録を行いません。</p> : <>
      {!request && <>
        <label>機材PCで発行した登録リンク<input type="text" autoComplete="off" value={link} onChange={(e) => setLink(e.target.value)} disabled={busy} /></label>
        <label>この操作端末の名前<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
        <p>機材PCの「端末を追加」でQRを読むか、登録リンクをコピーしてください。登録情報をこのブラウザに保存します。自分専用の端末でのみ使用してください。</p>
        <button className="button accent" disabled={busy || !link || !name.trim()} onClick={() => void start()}>{busy ? '申請中…' : 'この端末の登録を申請'}</button>
      </>}
      {request && <div role="status"><p>機材PCで、端末名と次の確認番号が一致することを確認して「許可」してください。</p>
        <strong>{request.code}</strong><p>有効期限：{new Date(request.expires).toLocaleTimeString()}</p>
        <button className="button secondary" onClick={() => { setRequest(null); secret.current = '' }}>キャンセル</button>
      </div>}
      {registered && <button className="button secondary" onClick={() => {
        if (window.confirm('このブラウザの接続を切断して登録情報を削除します。機材PCの端末一覧からも解除できます。')) {
          saveRegistration(profile.hub!.url, null)
          onForget()
          setMessage('このブラウザの登録情報を削除しました。')
        }
      }}>この端末の登録情報を忘れる</button>}
      {registered && <div className="button-row">
        <button className="button secondary" disabled={busy} onClick={() => void share(true)}>操作設定を機材PCへ保存</button>
        <button className="button secondary" disabled={busy} onClick={() => void share(false)}>操作設定を取り込む</button>
      </div>}
    </>}
    {message && <p role="status">{message}</p>}
    <p><small>OBS・ATEMの機材用パスワードは受け取りません。端末専用の認証情報は、設定ファイルやクラウド同期には含まれません。</small></p>
  </Section>
}
