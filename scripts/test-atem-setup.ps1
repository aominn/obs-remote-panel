# Offline regression tests. No real ATEM, Tailscale, clipboard or saved user config.
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$scriptPath = Join-Path $PSScriptRoot 'start-atem.ps1'
$null = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Setup script has syntax errors.' }
. $scriptPath
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert $rejected 'Expected rejection.'
}
foreach ($ip in @('192.168.10.240', '10.0.0.1', '172.16.0.1', '172.31.255.254')) {
    Assert (Test-AtemAddress $ip) 'Private IP rejected.'
}
foreach ($ip in @('127.0.0.1', '8.8.8.8', '172.32.0.1', '192.168.1.999', '10.1', '10.01.1.2', '::1', '10.1.1.1;echo')) {
    Assert (-not (Test-AtemAddress $ip)) 'Invalid IP accepted.'
}
$dns = 'test.example.ts.net'
$existing = '{"TCP":{"443":{"HTTPS":true}},"Web":{"test.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4455"},"/atem":{"Proxy":"http://127.0.0.1:8788"}}}}}' | ConvertFrom-Json
$original = $existing | ConvertTo-Json -Depth 10 -Compress
$plan = Get-AtemServePlan $existing $dns
Assert $plan.Exists 'Existing setup not detected.'
Assert ($plan.Url -eq 'https://test.example.ts.net/atem') 'Wrong URL.'
Assert ($plan.ObsUrl -eq 'wss://test.example.ts.net/') 'Existing OBS URL not detected.'
Assert (($existing | ConvertTo-Json -Depth 10 -Compress) -eq $original) 'OBS settings mutated.'
$empty = '{}' | ConvertFrom-Json
Assert (-not (Get-AtemServePlan $empty $dns).Exists) 'Empty configuration should permit an addition.'
$existing.Web.'test.example.ts.net:443'.Handlers.'/atem'.Proxy = 'http://127.0.0.1:9999'
Assert-Rejected { Get-AtemServePlan $existing $dns }
foreach ($json in @(
    '{"AllowFunnel":{"test.example.ts.net:443":true}}',
    '{"TCP":{"443":{"TCPForward":"127.0.0.1:4455"}}}',
    '{"Web":{"other.example.ts.net:443":{"Handlers":{}}}}',
    '{"Foreground":{"session":{}}}',
    '{"Web":{"test.example.ts.net:443":{"Handlers":{"/atem/nested":{"Proxy":"http://127.0.0.1:9999"}}}}}'
)) { Assert-Rejected { Get-AtemServePlan ($json | ConvertFrom-Json) $dns } }
Assert-Rejected { Get-AtemServePlan $null $dns }
Assert-Rejected { Get-AtemServePlan $empty 'https://invalid/' }

$directory = Join-Path ([IO.Path]::GetTempPath()) ('atem-setup-test-' + [guid]::NewGuid().ToString('N'))
$path = Join-Path $directory 'config.clixml'
try {
    Initialize-AtemStorage $directory
    $key = New-AtemCredential
    $second = New-AtemCredential
    Assert ($key.Password.Length -ge 32) 'Generated key too short.'
    Assert ($key.GetNetworkCredential().Password -cne $second.GetNetworkCredential().Password) 'Generated keys reused.'
    Save-AtemConfig $path '192.168.10.240' $key
    $raw = Get-Content -LiteralPath $path -Raw
    Assert (-not $raw.Contains($key.GetNetworkCredential().Password)) 'Plaintext secret on disk.'
    $restored = Read-AtemConfig $path
    Assert ($restored.Credential.GetNetworkCredential().Password -ceq $key.GetNetworkCredential().Password) 'DPAPI roundtrip failed.'
    Save-AtemConfig $path '192.168.10.241' $key
    Assert ((Read-AtemConfig $path).Address -eq '192.168.10.241') 'Address update failed.'
    Assert-Rejected { Save-AtemConfig $path '8.8.8.8' $key }
    Assert ((Read-AtemConfig $path).Address -eq '192.168.10.241') 'Invalid update changed config.'
    [IO.File]::WriteAllText($path, 'invalid')
    Assert-Rejected { Read-AtemConfig $path }
    Assert ((Get-Content -LiteralPath $path -Raw) -eq 'invalid') 'Corrupt config overwritten.'
} finally {
    # Only files created by this test, never recursively remove any directory.
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory }
}
Write-Host 'ATEM setup: parser, IP validation, Serve conflicts and DPAPI tests passed.'
