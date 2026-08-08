[CmdletBinding(SupportsShouldProcess = $true)]
param()

# Keep native CLI JSON as UTF-8 in Windows PowerShell 5.1. These assignments are
# also supported by PowerShell 7 and avoid changing any Tailscale configuration.
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8

$ErrorActionPreference = 'Stop'
$ObsAddress = '127.0.0.1'
$ObsPort = 4455
$HttpsPort = 443
$ProxyTarget = "http://${ObsAddress}:$ObsPort"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$ConnectionMemoPath = Join-Path $RepositoryRoot 'obs-remote-panel-connection.txt'

function Stop-WithMessage([string]$Message) {
    Write-Error $Message
    exit 1
}

function Write-ConnectionMemo([string]$WssUrl) {
    $TempMemoPath = Join-Path $RepositoryRoot ".obs-remote-panel-connection.$PID.tmp"
    $UpdatedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
    [string[]]$MemoLines = @(
        'OBS Remote Panel connection'
        ''
        "PC name: $([Environment]::MachineName)"
        "WSS URL: $WssUrl"
        "Updated: $UpdatedAt"
        ''
        'How to check again:'
        '  tailscale serve status'
        '  Run setup-windows.cmd again to refresh this file.'
        ''
        'This setup does not need to run every time the PC starts.'
        'OBS WebSocket passwords and Tailscale credentials are not stored here.'
    )

    try {
        [System.IO.File]::WriteAllLines($TempMemoPath, $MemoLines, $Utf8)
        if ([System.IO.File]::Exists($ConnectionMemoPath)) {
            [System.IO.File]::Replace($TempMemoPath, $ConnectionMemoPath, $null)
        }
        else {
            [System.IO.File]::Move($TempMemoPath, $ConnectionMemoPath)
        }
        Write-Host "Connection memo saved: $ConnectionMemoPath" -ForegroundColor Green
    }
    catch {
        if ([System.IO.File]::Exists($TempMemoPath)) {
            [System.IO.File]::Delete($TempMemoPath)
        }
        Stop-WithMessage "The Serve setup completed, but the connection memo could not be saved: $($_.Exception.Message)"
    }
}

Write-Host '1/7 Checking the Tailscale CLI...'
$TailscaleCommand = Get-Command 'tailscale' -ErrorAction SilentlyContinue
if (-not $TailscaleCommand) {
    Stop-WithMessage 'Tailscale CLI was not found. Install and start Tailscale, then retry.'
}

Write-Host '2/7 Checking the Tailscale connection...'
$StatusJson = & tailscale status --json 2>$null
if ($LASTEXITCODE -ne 0 -or -not $StatusJson) {
    Stop-WithMessage 'Tailscale status is unavailable. Start Tailscale and sign in.'
}
$TailscaleStatus = $StatusJson | ConvertFrom-Json
if ($TailscaleStatus.BackendState -ne 'Running') {
    Stop-WithMessage "Tailscale is not connected (BackendState: $($TailscaleStatus.BackendState))."
}

Write-Host '3/7 Checking the OBS WebSocket listener...'
$ObsListening = Test-NetConnection -ComputerName $ObsAddress -Port $ObsPort -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $ObsListening) {
    Stop-WithMessage "Cannot connect to ${ObsAddress}:$ObsPort. Start OBS and enable the authenticated WebSocket server."
}

Write-Host '4/7 Reading the current Serve configuration...'
$ServeStatusJson = & tailscale serve status --json 2>$null
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage 'The current Tailscale Serve configuration could not be read.'
}
$ServeStatusText = [string]$ServeStatusJson
& tailscale serve status

$TargetAlreadyConfigured = $ServeStatusText -match [regex]::Escape($ProxyTarget)
$HttpsAlreadyUsed = ($ServeStatusText -match '443') -or ($ServeStatusText -match 'HTTPS')
$ServeReady = $TargetAlreadyConfigured

Write-Host '5/7 Checking for configuration conflicts...'
if ($TargetAlreadyConfigured) {
    Write-Host "The OBS proxy ($ProxyTarget) is already configured. No change is needed." -ForegroundColor Green
}
elseif ($HttpsAlreadyUsed) {
    Stop-WithMessage 'HTTPS port 443 already has a Serve configuration. Stopping without overwriting it; inspect tailscale serve status.'
}
else {
    Write-Host '6/7 Configuring the OBS HTTPS reverse proxy...'
    if ($PSCmdlet.ShouldProcess("Tailscale Serve HTTPS $HttpsPort", "reverse proxy to $ProxyTarget")) {
        & tailscale serve --https=$HttpsPort --bg --yes $ProxyTarget
        if ($LASTEXITCODE -ne 0) {
            Stop-WithMessage 'Tailscale Serve setup failed. Review the Tailscale error above.'
        }
        $ServeReady = $true
        Write-Host "Changed: HTTPS $HttpsPort now proxies to $ProxyTarget." -ForegroundColor Green
    }
}

Write-Host '7/7 Showing Serve status and connection URLs...'
& tailscale serve status

$DnsName = [string]$TailscaleStatus.Self.DNSName
$DnsName = $DnsName.TrimEnd('.')
if ($DnsName) {
    $WssUrl = "wss://$DnsName/"
    Write-Host "Browser HTTPS URL: https://$DnsName/" -ForegroundColor Cyan
    Write-Host "WSS URL for OBS Remote Panel: $WssUrl" -ForegroundColor Cyan
    if ($ServeReady) {
        Write-ConnectionMemo -WssUrl $WssUrl
    }
    else {
        Write-Warning 'The Serve change was not applied. The connection memo was not updated.'
    }
}
else {
    Write-Warning 'The MagicDNS name was unavailable. Use the HTTPS hostname from tailscale serve status with a wss:// scheme.'
}

Write-Host ''
Write-Host 'Targeted rollback command for the HTTPS 443 listener added by this script:'
Write-Host "  tailscale serve --https=$HttpsPort off" -ForegroundColor Yellow
Write-Host 'Do not use tailscale serve reset because it also removes unrelated Serve settings.'
