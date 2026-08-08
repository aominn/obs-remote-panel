import { useRef, useState } from 'react'
import type { useCloudSync } from '../hooks/use-cloud-sync'
import { createProfile, exportSettings, importSettings, validateObsUrl } from '../lib/settings'
import type { AppSettings, ConnectionProfile, InputInfo, ObsState } from '../types'
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

function slideshowCandidates(inputs: InputInfo[]) {
  const likely = inputs.filter((input) => /slide|slideshow|image/i.test(`${input.kind} ${input.name}`))
  const other = inputs.filter((input) => !likely.includes(input))
  return { likely, other }
}

export function SettingsTab({
  settings,
  profile,
  obsState,
  cloud,
  updateSettings,
  updateProfile,
  replaceSettings,
  mockMode,
  controller
}: {
  settings: AppSettings
  profile: ConnectionProfile
  obsState: ObsState
  cloud: CloudSync
  updateSettings: (updater: (settings: AppSettings) => AppSettings) => void
  updateProfile: (updater: (profile: ConnectionProfile) => ConnectionProfile) => void
  replaceSettings: (settings: AppSettings) => void
  mockMode: boolean
  controller: { simulateDisconnect?: () => void; failNextConnection?: () => void }
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const candidates = slideshowCandidates(obsState.inputs)
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

  const downloadExport = () => {
    const blob = new Blob([exportSettings(settings)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `obs-remote-panel-settings-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  const readImport = async (file: File) => {
    try {
      replaceSettings(importSettings(await file.text()))
      setImportMessage('設定を読み込みました。パスワードはインポートされません。')
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : '設定を読み込めませんでした。')
    }
  }

  return (
    <div className="tab-sections">
      <Section
        title="OBS接続プロファイル"
        description="本番ではTailscale Serveが発行したtailnet内のWSS URLだけを使用してください。"
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
        <button className="button danger-outline" disabled={settings.profiles.length === 1} onClick={removeProfile}>
          このプロファイルを削除
        </button>
      </Section>

      <Section
        title="画像スライドショー"
        description="番号はOBS WebSocketから正確に取得できないため表示しません（番号取得非対応）。"
      >
        <label>
          操作対象の入力
          <select
            value={profile.selectedSlideshowInput}
            onChange={(event) => updateProfile((current) => ({ ...current, selectedSlideshowInput: event.target.value }))}
          >
            <option value="">選択してください</option>
            {candidates.likely.length > 0 && <optgroup label="候補（種類・名前から判定）">
              {candidates.likely.map((input) => <option value={input.name} key={input.name}>{input.name} — {input.kind}</option>)}
            </optgroup>}
            {candidates.other.length > 0 && <optgroup label="すべての入力">
              {candidates.other.map((input) => <option value={input.name} key={input.name}>{input.name} — {input.kind}</option>)}
            </optgroup>}
          </select>
        </label>
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

      <Section title="ローカル設定" description="JSONにはOBSパスワードと暗号鍵を含めません。">
        <Toggle
          label="危険な出力操作を確認する"
          checked={settings.ui.confirmDangerousActions}
          onChange={(confirmDangerousActions) => updateSettings((current) => ({
            ...current,
            ui: { ...current.ui, confirmDangerousActions }
          }))}
        />
        <div className="button-row">
          <button className="button secondary" onClick={downloadExport}>JSONエクスポート</button>
          <button className="button secondary" onClick={() => importRef.current?.click()}>JSONインポート</button>
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
