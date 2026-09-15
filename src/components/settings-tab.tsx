import { useRef, useState } from 'react'
import type { useCloudSync } from '../hooks/use-cloud-sync'
import { createProfile, exportSettings, validateObsUrl } from '../lib/settings'
import { exportProtectedSettings, readTransferredSettings } from '../lib/settings-transfer'
import { bridgeUrl } from '../services/atem-controller'
import type { AppSettings, ConnectionProfile } from '../types'
import { Section, Toggle } from './ui'

type CloudSync = ReturnType<typeof useCloudSync>

const syncLabels: Record<CloudSync['status'], string> = {
  'local-only': 'ローカル専用',
  'signed-out': '未ログイン',
  dirty: '未同期の変更あり',
  syncing: '同期中',
  synced: '同期済み',
  'remote-update': '他端末で更新あり',
  conflict: '同期競合',
  error: '同期失敗'
}

const DETAIL_ACTIONS = [
  ['stream', '配信'],
  ['record', '録画'],
  ['virtual-camera', '仮想カメラ'],
  ['replay-buffer', 'リプレイバッファ'],
  ['studio-mode', 'スタジオモードとトランジション'],
  ['stats', 'OBS統計']
] as const

export function SettingsTab({
  settings,
  profile,
  cloud,
  updateSettings,
  updateProfile,
  replaceSettings,
  mockMode,
  controller
}: {
  settings: AppSettings
  profile: ConnectionProfile
  cloud: CloudSync
  updateSettings: (updater: (settings: AppSettings) => AppSettings) => void
  updateProfile: (updater: (profile: ConnectionProfile) => ConnectionProfile) => void
  replaceSettings: (settings: AppSettings) => void
  mockMode: boolean
  controller: { simulateDisconnect?: () => void; failNextConnection?: () => void }
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [transferPassphrase, setTransferPassphrase] = useState('')
  const [transferring, setTransferring] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const urlError = profile.url ? validateObsUrl(profile.url) : null

  const addProfile = () => {
    const next = createProfile(`OBS ${settings.profiles.length + 1}`)
    updateSettings((current) => ({
      ...current,
      profiles: [...current.profiles, next],
      activeProfileId: next.id
    }))
  }

  const removeProfile = () => {
    if (settings.profiles.length === 1) return
    if (!window.confirm(`「${profile.name}」を削除しますか？`)) return
    updateSettings((current) => {
      const profiles = current.profiles.filter((item) => item.id !== profile.id)
      return { ...current, profiles, activeProfileId: profiles[0].id }
    })
  }

  const download = (json: string, protectedFile = false) => {
    const blob = new Blob([json], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `obs-remote-panel-${protectedFile ? 'encrypted-' : ''}settings-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  const downloadProtected = async () => {
    if (!window.confirm('保存済みのOBSパスワード・ATEMキーを含めて暗号化します。ファイルとパスフレーズは別々に、安全な方法で渡してください。続行しますか？')) return
    setTransferring(true)
    try {
      download(await exportProtectedSettings(settings, transferPassphrase), true)
      setTransferPassphrase('')
      setImportMessage('暗号化ファイルを書き出しました。別端末では同じパスフレーズを入力して取り込んでください。')
    } catch (error) { setImportMessage(error instanceof Error ? error.message : '書き出せませんでした。') }
    finally { setTransferring(false) }
  }

  const readImport = async (file: File) => {
    setTransferring(true)
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('設定ファイルが大きすぎます（最大4MB）。')
      const result = await readTransferredSettings(await file.text(), transferPassphrase)
      if (!window.confirm(`${result.settings.profiles.length}件の環境プロファイルで現在の設定を置き換えます。必要なら先に書き出してください。${result.protected ? 'パスワード・キーもこのブラウザに保存されます。共用端末には取り込まないでください。' : 'パスワード・キーは含まれません。'} 続行しますか？`)) return
      replaceSettings(result.settings)
      setTransferPassphrase('')
      setImportMessage('設定を取り込みました。Tailscale接続を確認し、各タブから接続してください。自動接続は行いません。')
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : '設定を読み込めませんでした。')
    } finally { setTransferring(false) }
  }

  return (
    <div className="tab-sections">
      <Section
        title="環境プロファイル（OBS・ATEM）"
        description="同じ環境のOBS・ATEM接続先と操作設定をまとめます。接続・操作は各タブで明示的に行います。"
        actions={<button className="button secondary" onClick={addProfile}>追加</button>}
      >
        <label>
          プロファイル
          <select
            value={settings.activeProfileId}
            onChange={(event) => updateSettings((current) => ({ ...current, activeProfileId: event.target.value }))}
          >
            {settings.profiles.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          プロファイル名
          <input value={profile.name} onChange={(event) => updateProfile((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          WSS接続先
          <input
            inputMode="url"
            placeholder="wss://obs-pc.example-tailnet.ts.net/"
            value={profile.url}
            onChange={(event) => updateProfile((current) => ({ ...current, url: event.target.value.trim() }))}
            aria-invalid={Boolean(urlError)}
          />
          {urlError && <small className="field-error">{urlError}</small>}
        </label>
        <label>
          OBS WebSocketパスワード
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={profile.password}
              onChange={(event) => updateProfile((current) => ({ ...current, password: event.target.value }))}
            />
            <button className="button secondary" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? '隠す' : '表示'}
            </button>
          </div>
        </label>
        <Toggle
          label="切断時に自動再接続する"
          checked={profile.autoReconnect}
          onChange={(autoReconnect) => updateProfile((current) => ({ ...current, autoReconnect }))}
        />
        <label>ATEM仲介サービスのHTTPS URL（ATEMを使う場合）
          <input type="url" value={profile.atem?.url ?? ''} placeholder="https://your-pc.your-tailnet.ts.net/atem"
            onChange={(event) => updateProfile((current) => ({ ...current, atem: { url: event.target.value.trim() } }))} />
          <small>URL変更時は保存したATEMキーを解除します。キーの入力・保存はATEMタブで行います。</small>
        </label>
        <button className="button secondary" disabled={!profile.url} onClick={() => {
          try {
            const obs = new URL(profile.url)
            if (obs.protocol !== 'wss:') throw new Error('WSS URLを設定してください。')
            const proposed = bridgeUrl(`https://${obs.host}/atem`)
            if (window.confirm(`OBSと同じPCを使う場合の候補です。${proposed} を設定しますか？保存したATEMキーは解除されます。`)) {
              updateProfile((current) => ({ ...current, atem: { url: proposed } }))
            }
          } catch { setImportMessage('OBSのWSS URLを確認してください。') }
        }}>OBSと同じPCのATEM URLを入力</button>
        <button className="button danger-outline" disabled={settings.profiles.length === 1} onClick={removeProfile}>
          このプロファイルを削除
        </button>
      </Section>

      <Section title="詳細操作の表示" description="プロファイルごとに表示する操作を選べます。">
        {DETAIL_ACTIONS.map(([id, label]) => (
          <Toggle
            key={id}
            label={label}
            checked={profile.visibleDetailActions.includes(id)}
            onChange={(checked) => updateProfile((current) => ({
              ...current,
              visibleDetailActions: checked
                ? [...new Set([...current.visibleDetailActions, id])]
                : current.visibleDetailActions.filter((item) => item !== id)
            }))}
          />
        ))}
      </Section>

      <Section title="別端末への引き継ぎ・バックアップ" description="通常のJSONにはOBSパスワード・ATEMキーを含めません。設定の取り込みだけではネットワーク設定や接続は行いません。">
        <ol>
          <li>新しい端末を同じTailscaleネットワークへ接続します。</li>
          <li>この公開ページを開き、設定ファイルを取り込むか、下のクラウド同期を使います。</li>
          <li>環境プロファイルを選び、OBS・ATEMへそれぞれ接続します。仲介PCは起動したままにします。</li>
        </ol>
        <Toggle
          label="危険な出力操作を確認する"
          checked={settings.ui.confirmDangerousActions}
          onChange={(confirmDangerousActions) => updateSettings((current) => ({
            ...current,
            ui: { ...current.ui, confirmDangerousActions }
          }))}
        />
        <div className="button-row">
          <button className="button secondary" disabled={transferring} onClick={() => download(exportSettings(settings))}>JSONエクスポート（キーなし）</button>
          <button className="button secondary" disabled={transferring} onClick={() => importRef.current?.click()}>設定ファイルを取り込む</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void readImport(file)
              event.target.value = ''
            }}
          />
        </div>
        <label>引き継ぎ用パスフレーズ（暗号化ファイル用・12文字以上）
          <input type="password" autoComplete="off" value={transferPassphrase} onChange={(event) => setTransferPassphrase(event.target.value)} />
        </label>
        <button className="button secondary" disabled={transferring} onClick={() => void downloadProtected()}>暗号化ファイルで渡す（保存済みキーを含む）</button>
        <small>パスフレーズは保存しません。十分に長く推測されにくいものを使ってください。ファイルと同じメッセージでは送らないでください。未保存のATEMキーは含まれません。</small>
        {importMessage && <p className="status-message">{importMessage}</p>}
      </Section>

      <Section title="Supabase設定同期" description="Supabase未設定・未ログインでもローカル専用モードで利用できます。">
        <div className={`sync-status sync-${cloud.status}`}>
          <strong>{syncLabels[cloud.status]}</strong>
          {cloud.lastSyncedAt && <small>最終同期: {new Date(cloud.lastSyncedAt).toLocaleString('ja-JP')}</small>}
        </div>
        {!cloud.available ? (
          <p className="status-message">環境変数が未設定です。ローカル専用モードで動作しています。</p>
        ) : !cloud.session ? (
          <>
            <label>
              メールアドレス
              <input type="email" autoComplete="email" value={cloud.email} onChange={(event) => cloud.setEmail(event.target.value)} />
            </label>
            <button className="button accent" onClick={() => void cloud.signIn()}>Magic Link / OTPを送信</button>
          </>
        ) : (
          <>
            <p>同期アカウント: <strong>{cloud.session.user.email ?? cloud.session.user.id}</strong></p>
            <Toggle
              label="OBSパスワードを暗号化して同期する"
              checked={settings.ui.syncPasswords}
              onChange={(syncPasswords) => updateSettings((current) => ({
                ...current,
                ui: { ...current.ui, syncPasswords }
              }))}
            />
            <Toggle label="保存したATEMキーも暗号化して同期・復元する"
              checked={Boolean(settings.ui.syncAtemKeys)}
              onChange={(syncAtemKeys) => updateSettings((current) => ({ ...current, ui: { ...current.ui, syncAtemKeys } }))} />
            <small>ATEMキーの復元はこの項目を有効にしてから取り込んでください。復元するとこのブラウザにも保存されます。共用端末では有効にしないでください。</small>
            <label>
              同期用パスフレーズ（一時保持のみ）
              <input
                type="password"
                autoComplete="new-password"
                value={cloud.passphrase}
                onChange={(event) => cloud.setPassphrase(event.target.value)}
              />
              <small>Supabaseへ送信・保存しません。忘れると暗号化済みパスワードは復元できません。</small>
            </label>
            <div className="button-row">
              <button className="button accent" disabled={cloud.status === 'syncing'} onClick={() => void cloud.push(false)}>同期する</button>
              <button className="button secondary" disabled={cloud.status === 'syncing'} onClick={() => void cloud.pull()}>クラウドを取り込む</button>
              {cloud.status === 'conflict' && (
                <button className="button danger" onClick={() => void cloud.push(true)}>ローカルで上書き</button>
              )}
              <button className="button secondary" onClick={() => void cloud.signOut()}>ログアウト</button>
            </div>
          </>
        )}
        {cloud.message && <p className="status-message" role="status">{cloud.message}</p>}
      </Section>

      {mockMode && (
        <Section title="モック診断" description="実OBSには影響しません。接続障害と再接続表示を確認できます。">
          <div className="button-row">
            <button className="button secondary" onClick={() => controller.simulateDisconnect?.()}>通信断を再現</button>
            <button className="button secondary" onClick={() => {
              controller.failNextConnection?.()
              setImportMessage('次の接続だけ失敗します。切断後、もう一度接続してください。')
            }}>
              次回接続を失敗させる
            </button>
          </div>
        </Section>
      )}

      <details className="troubleshooting">
        <summary>接続できないとき</summary>
        <ul>
          <li>操作端末とOBS側PCのTailscaleがオンか</li>
          <li>両方が同じtailnetへ参加しているか</li>
          <li>OBSとOBS WebSocket（4455・認証あり）が起動しているか</li>
          <li>パスワードとWSS URLが正しいか</li>
          <li>Tailscale Serveが停止していないか</li>
        </ul>
        <p>GitHub PagesとSupabaseへ接続できても、同じtailnetに参加していない端末からOBSは操作できません。</p>
      </details>
    </div>
  )
}
