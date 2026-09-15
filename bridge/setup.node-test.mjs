import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('Windows PowerShell 5.1 setup offline regression tests', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('../scripts/test-atem-setup.ps1', import.meta.url))], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
test('Windows PowerShell 5.1 paired panel setup offline tests', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('../scripts/test-panel-setup.ps1', import.meta.url))], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
