import { describe, expect, it } from 'vitest'
import { decryptSecrets, encryptSecrets, SecretDecryptionError } from './crypto'

describe('暗号化同期', () => {
  it('PBKDF2とAES-GCMで暗号化・復号でき、平文を含めない', async () => {
    const secrets = { profileA: 'obs-password', profileB: '別の秘密' }
    const encrypted = await encryptSecrets(secrets, '十分に長い同期パスフレーズ')

    expect(encrypted.algorithm).toBe('AES-GCM')
    expect(encrypted.kdf).toBe('PBKDF2-SHA-256')
    expect(encrypted.iterations).toBeGreaterThanOrEqual(100_000)
    expect(JSON.stringify(encrypted)).not.toContain('obs-password')
    await expect(decryptSecrets(encrypted, '十分に長い同期パスフレーズ')).resolves.toEqual(secrets)
  })

  it('誤ったパスフレーズを認証エラーとは別の復号エラーにする', async () => {
    const encrypted = await encryptSecrets({ profileA: 'secret' }, 'correct-passphrase')
    await expect(decryptSecrets(encrypted, 'wrong-passphrase')).rejects.toBeInstanceOf(
      SecretDecryptionError
    )
  })

  it('改ざんされた暗号文を拒否する', async () => {
    const encrypted = await encryptSecrets({ profileA: 'secret' }, 'correct-passphrase')
    const corrupted = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`
    }
    await expect(decryptSecrets(corrupted, 'correct-passphrase')).rejects.toBeInstanceOf(
      SecretDecryptionError
    )
  })
})
