# Offline only: no real registry, OBS, ATEM, Tailscale or approval screen.
$ErrorActionPreference = 'Stop'
$parseErrors = $null
$tokens = $null
$scriptPath = Join-Path $PSScriptRoot 'start-panel.ps1'
$null = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Panel setup has syntax errors.' }
. $scriptPath
function Assert($Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Reject([scriptblock]$Action) { $failed = $false; try { & $Action | Out-Null } catch { $failed = $true }; Assert $failed 'Expected rejection.' }
$dns = 'pc.example.ts.net'
$config = '{"TCP":{"443":{"HTTPS":true}},"Web":{"pc.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4455"},"/atem":{"Proxy":"http://127.0.0.1:8788"}}}}}' | ConvertFrom-Json
$before = $config | ConvertTo-Json -Depth 10 -Compress
Assert (-not (Get-PanelServePlan $config $dns).Exists) 'Expected new path.'
Assert (($config | ConvertTo-Json -Depth 10 -Compress) -eq $before) 'Existing OBS/ATEM configuration changed.'
Add-Member -InputObject $config.Web.'pc.example.ts.net:443'.Handlers -NotePropertyName '/panel' -NotePropertyValue ([pscustomobject]@{ Proxy = 'http://127.0.0.1:8789' })
Assert (Get-PanelServePlan $config $dns).Exists 'Existing path not detected.'
$config.Web.'pc.example.ts.net:443'.Handlers.'/panel'.Proxy = 'http://127.0.0.1:9999'
Reject { Get-PanelServePlan $config $dns }
foreach ($json in @('{"AllowFunnel":{"pc.example.ts.net:443":true}}', '{"TCP":{"443":{"TCPForward":"localhost:4455"}}}',
    '{"Foreground":{"session":{}}}', '{"Web":{"pc.example.ts.net:443":{"Handlers":{"/panel/nested":{"Proxy":"localhost:9999"}}}}}')) {
    Reject { Get-PanelServePlan ($json | ConvertFrom-Json) $dns }
}
$directory = Join-Path ([IO.Path]::GetTempPath()) ('panel-setup-test-' + [guid]::NewGuid().ToString('N'))
$path = Join-Path $directory 'config.clixml'
try {
    Initialize-AtemStorage $directory
    $credential = New-AtemCredential
    $value = [pscustomobject]@{ Version = 1; Name = 'Test'; ObsEnabled = $true; ObsPort = 4455; ObsCredential = $credential; Address = '' }
    Save-PanelConfig $path $value
    Assert (-not (Get-Content -LiteralPath $path -Raw).Contains($credential.GetNetworkCredential().Password)) 'OBS credential saved in plaintext.'
    Assert ((Read-PanelConfig $path).ObsCredential.GetNetworkCredential().Password -ceq $credential.GetNetworkCredential().Password) 'DPAPI restore failed.'
    $value.Name = 'Updated'
    Save-PanelConfig $path $value
    Assert ((Read-PanelConfig $path).Name -eq 'Updated') 'Atomic update failed.'
    [IO.File]::WriteAllText($path, 'invalid')
    Reject { Read-PanelConfig $path }
    Assert ((Get-Content -LiteralPath $path -Raw) -eq 'invalid') 'Corrupt file overwritten.'
} finally {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory }
}
Write-Host 'Panel setup: syntax, Serve isolation and DPAPI tests passed.'
