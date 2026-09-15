import { decryptSecrets, encryptSecrets, type EncryptedSecrets } from './crypto'
import { importSettings, touchSettings, validateSettings } from './settings'
import type { AppSettings } from '../types'

const FORMAT = 'obs-remote-panel-encrypted-settings'
const MAX_SIZE = 4 * 1024 * 1024

// Encrypt the entire document: URLs and profile names need not be public either.
export async function exportProtectedSettings(settings: AppSettings, passphrase: string) {
  if (passphrase.length < 12) throw new Error('引き継ぎ用パスフレーズは12文字以上にしてください。')
  return JSON.stringify({ format: FORMAT, version: 1,
    payload: await encryptSecrets({ settings: JSON.stringify(settings) }, passphrase) })
}

export async function readTransferredSettings(json: string, passphrase: string): Promise<{ settings: AppSettings; protected: boolean }> {
  if (json.length > MAX_SIZE) throw new Error('設定ファイルが大きすぎます（最大4MB）。')
  const data = JSON.parse(json)
  if (data?.format !== FORMAT) return { settings: importSettings(json), protected: false }
  const payload = data.payload as EncryptedSecrets | undefined
  if (data.version !== 1 || !payload || !Number.isInteger(payload.iterations) ||
      payload.iterations < 100_000 || payload.iterations > 1_000_000) throw new Error('暗号化ファイルの形式が不正です。')
  if (!passphrase) throw new Error('このファイルの引き継ぎ用パスフレーズを入力してください。')
  const content = await decryptSecrets(payload, passphrase)
  const settings: unknown = JSON.parse(content.settings)
  if (!validateSettings(settings)) throw new Error('復号した設定の形式が不正です。')
  return { settings: touchSettings(settings), protected: true }
}
