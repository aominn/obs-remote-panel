import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyPasswordSecrets,
  getPasswordSecrets,
  mergeCloudSettings,
  validateSettings,
  withoutSecrets
} from '../lib/settings'
import {
  decryptSecrets,
  encryptSecrets,
  type EncryptedSecrets
} from '../lib/crypto'
import type { AppSettings } from '../types'

export type SyncStatus =
  | 'local-only'
  | 'signed-out'
  | 'dirty'
  | 'syncing'
  | 'synced'
  | 'remote-update'
  | 'conflict'
  | 'error'

interface SettingsRow {
  user_id: string
  settings: unknown
  encrypted_secrets: unknown | null
  revision: number
  updated_at: string
}

function configuredClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) return null
  try {
    return createClient(url, key, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
    })
  } catch {
    return null
  }
}

export function useCloudSync(
  settings: AppSettings,
  replaceSettings: (settings: AppSettings) => void
) {
  const client = useMemo(() => configuredClient(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SyncStatus>(client ? 'signed-out' : 'local-only')
  const [message, setMessage] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const lastCloudRevision = useRef(0)
  const lastLocalRevision = useRef(settings.revision)
  const syncInFlight = useRef(false)

  useEffect(() => {
    if (!client) return
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setStatus(data.session ? 'dirty' : 'signed-out')
    })
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setStatus(nextSession ? 'dirty' : 'signed-out')
      if (!nextSession) {
        lastCloudRevision.current = 0
        setLastSyncedAt(null)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [client])

  useEffect(() => {
    if (!session || !client) return
    const channel = client
      .channel(`settings:${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_settings',
          filter: `user_id=eq.${session.user.id}`
        },
        (payload) => {
          const next = payload.new as Partial<SettingsRow>
          if (
            !syncInFlight.current &&
            typeof next.revision === 'number' &&
            next.revision > lastCloudRevision.current
          ) {
            setStatus('remote-update')
            setMessage('他端末で設定が更新されました。内容を取り込むか確認してください。')
          }
        }
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [client, session])

  useEffect(() => {
    if (session && settings.revision !== lastLocalRevision.current && status === 'synced') {
      setStatus('dirty')
      setMessage('未同期の変更があります。')
    }
  }, [session, settings.revision, status])

  const signIn = useCallback(async () => {
    if (!client) return
    if (!email.trim()) {
      setStatus('error')
      setMessage('メールアドレスを入力してください。')
      return
    }
    setStatus('syncing')
    const redirect = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect }
    })
    if (error) {
      setStatus('error')
      setMessage('ログインメールを送信できませんでした。Supabase設定を確認してください。')
      return
    }
    setStatus('signed-out')
    setMessage('ログイン用メールを送信しました。同じブラウザでリンクを開いてください。')
  }, [client, email])

  const signOut = useCallback(async () => {
    if (!client) return
    await client.auth.signOut()
    setPassphrase('')
  }, [client])

  const fetchRemote = useCallback(async (): Promise<SettingsRow | null> => {
    if (!client || !session) return null
    const { data, error } = await client
      .from('user_settings')
      .select('user_id,settings,encrypted_secrets,revision,updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (error) throw new Error('クラウド設定を取得できませんでした。')
    return data as SettingsRow | null
  }, [client, session])

  const pull = useCallback(async () => {
    if (!session) return
    setStatus('syncing')
    setMessage('')
    syncInFlight.current = true
    try {
      const remote = await fetchRemote()
      if (!remote) {
        setStatus('dirty')
        setMessage('クラウド設定はまだありません。現在の設定を同期してください。')
        return
      }
      if (!validateSettings(remote.settings)) throw new Error('クラウド設定の形式が不正です。')
      let next = mergeCloudSettings(settings, remote.settings)
      if (remote.encrypted_secrets) {
        if (!passphrase) {
          throw new Error('暗号化されたOBSパスワードを復元するには同期用パスフレーズが必要です。')
        }
        const secrets = await decryptSecrets(remote.encrypted_secrets as EncryptedSecrets, passphrase)
        next = applyPasswordSecrets(next, secrets)
      }
      replaceSettings(next)
      lastCloudRevision.current = remote.revision
      lastLocalRevision.current = next.revision
      setLastSyncedAt(remote.updated_at)
      setStatus('synced')
      setMessage('クラウド設定を取り込みました。')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : '同期に失敗しました。')
    } finally {
      syncInFlight.current = false
    }
  }, [fetchRemote, passphrase, replaceSettings, session, settings])

  const push = useCallback(
    async (force = false) => {
      if (!client || !session) return
      setStatus('syncing')
      setMessage('')
      syncInFlight.current = true
      try {
        const remote = await fetchRemote()
        if (!force && remote && remote.revision > lastCloudRevision.current) {
          const hasLocalChanges = settings.revision !== lastLocalRevision.current
          setStatus(hasLocalChanges ? 'conflict' : 'remote-update')
          setMessage(
            hasLocalChanges
              ? '他端末の変更とローカル変更が競合しています。取り込むか、上書きを選んでください。'
              : 'クラウドに既存の設定があります。先に内容を取り込んでください。'
          )
          return
        }

        let encryptedSecrets: EncryptedSecrets | null = null
        if (settings.ui.syncPasswords) {
          if (!passphrase) throw new Error('パスワード同期には同期用パスフレーズが必要です。')
          encryptedSecrets = await encryptSecrets(getPasswordSecrets(settings), passphrase)
        }

        const nextRevision = (remote?.revision ?? 0) + 1
        const values = {
          user_id: session.user.id,
          settings: withoutSecrets(settings),
          encrypted_secrets: encryptedSecrets,
          revision: nextRevision
        }
        if (!remote) {
          const { error } = await client.from('user_settings').insert(values)
          if (error) throw error
        } else {
          let query = client.from('user_settings').update(values).eq('user_id', session.user.id)
          if (!force) query = query.eq('revision', remote.revision)
          const { data, error } = await query.select('revision,updated_at')
          if (error) throw error
          if (!force && (!data || data.length === 0)) {
            setStatus('conflict')
            setMessage('同期直前に他端末が更新しました。もう一度内容を確認してください。')
            return
          }
        }
        lastCloudRevision.current = nextRevision
        lastLocalRevision.current = settings.revision
        const syncedAt = new Date().toISOString()
        setLastSyncedAt(syncedAt)
        setStatus('synced')
        setMessage('設定を同期しました。')
      } catch (error) {
        setStatus('error')
        setMessage(
          error instanceof Error && error.message
            ? error.message
            : '設定を同期できませんでした。RLSとネットワークを確認してください。'
        )
      } finally {
        syncInFlight.current = false
      }
    },
    [client, fetchRemote, passphrase, session, settings]
  )

  return {
    available: Boolean(client),
    session,
    status,
    message,
    lastSyncedAt,
    email,
    setEmail,
    passphrase,
    setPassphrase,
    signIn,
    signOut,
    pull,
    push
  }
}
