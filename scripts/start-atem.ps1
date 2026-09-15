#Requires -Version 5.1
[CmdletBinding()]
param([switch]$NewKey, [switch]$ChangeAddress)

# UTF-8 BOM is intentional: Windows PowerShell 5.1 must read the Japanese UI.
function Test-AtemAddress([string]$Address) {
    if ($Address -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { return $false }
    $parts = $Address.Split('.')
    if ($parts.Count -ne 4) { return $false }
    foreach ($part in $parts) {
        if ($part -notmatch '^(0|[1-9][0-9]{0,2})$' -or [int]$part -gt 255) { return $false }
    }
    return $true
}

function New-AtemCredential {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secure = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
    return New-Object System.Management.Automation.PSCredential('ATEM', $secure)
}

function Assert-RegularPath([string]$Path) {
    $itemPath = [IO.Path]::GetFullPath($Path)
    while ($itemPath) {
        if (Test-Path -LiteralPath $itemPath) {
            $item = Get-Item -LiteralPath $itemPath -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw '保存先にリンクがあります。リンクを使用しないローカルフォルダーが必要です。'
            }
        }
        $itemPath = Split-Path -Parent $itemPath
    }
}

function Initialize-AtemStorage([string]$Directory) {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop
    Assert-RegularPath $Directory
    if (-not (Test-Path -LiteralPath $Directory)) {
        $null = New-Item -ItemType Directory -Path $Directory -Force
    }
    # Only this Windows user and SYSTEM can access the saved configuration.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($user, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Directory -AclObject $acl
}

function Save-AtemConfig([string]$Path, [string]$Address, [PSCredential]$Credential) {
    if (-not (Test-AtemAddress $Address)) { throw 'ATEMのプライベートIPv4アドレスが不正です。' }
    Assert-RegularPath $Path
    # Export-Clixml encrypts PSCredential using CurrentUser DPAPI on Windows.
    $temp = "$Path.$PID.tmp"
    Assert-RegularPath $temp
    try {
        [pscustomobject]@{ Version = 1; Address = $Address; Credential = $Credential } |
            Export-Clixml -LiteralPath $temp -Encoding UTF8
        if (Test-Path -LiteralPath $Path) {
            [IO.File]::Replace($temp, $Path, [NullString]::Value)
        } else {
            [IO.File]::Move($temp, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
    }
}

function Read-AtemConfig([string]$Path) {
    Assert-RegularPath $Path
    try {
        $config = Import-Clixml -LiteralPath $Path
        if ($config.Version -ne 1 -or -not (Test-AtemAddress $config.Address) -or
            $config.Credential -isnot [PSCredential] -or $config.Credential.Password.Length -lt 32) { throw 'Invalid configuration' }
        return $config
    } catch {
        throw '保存設定を読めません。同じPC・同じWindowsユーザーで起動してください。設定を自動で上書きすることはありません。'
    }
}

function Get-AtemServePlan($Config, [string]$DnsName) {
    if ($null -eq $Config -or $Config -isnot [pscustomobject]) { throw 'Serveの設定形式を認識できません。変更せず停止します。' }
    if ($DnsName -notmatch '^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+\.ts\.net$') { throw 'TailscaleのDNS名を取得できません。' }
    # Fail closed for unsupported foreground/service configurations.
    foreach ($property in $Config.PSObject.Properties) {
        if ($property.Name -notin @('TCP', 'Web', 'AllowFunnel') -and $property.Value) {
            throw '追加のServe設定があります。自動変更せず停止します。tailscale serve status で確認してください。'
        }
    }
    foreach ($entry in $Config.AllowFunnel.PSObject.Properties) {
        if ($entry.Value -eq $true) { throw 'Funnelが有効です。一般公開を避けるため停止しました。' }
    }
    $tcp = $Config.TCP.'443'
    if ($tcp -and ($tcp.HTTPS -ne $true -or $tcp.TCPForward -or $tcp.HTTP)) {
        throw '443番に別のサービスがあります。上書きせず停止しました。'
    }
    $exists = $false
    foreach ($hostEntry in $Config.Web.PSObject.Properties) {
        if ($hostEntry.Name -notlike '*:443') { continue }
        if ($hostEntry.Name -ne "${DnsName}:443") { throw '443番に別ホストの設定があります。上書きせず停止しました。' }
        foreach ($handler in $hostEntry.Value.Handlers.PSObject.Properties) {
            if ($handler.Name -eq '/atem') {
                if ($handler.Value.Proxy -ne 'http://127.0.0.1:8788' -or @($handler.Value.PSObject.Properties).Count -ne 1) {
                    throw '/atem は別の用途で使用中です。上書きせず停止しました。'
                }
                $exists = $true
            } elseif ($handler.Name.StartsWith('/atem/')) {
                throw '/atem 配下に別の設定があります。上書きせず停止しました。'
            }
        }
    }
    if ($exists -and -not $tcp.HTTPS) { throw 'ServeのHTTPS設定が不整合です。変更せず停止します。' }
    $obsUrl = ''
    if ($tcp.HTTPS -and $Config.Web."${DnsName}:443".Handlers.'/'.Proxy -eq 'http://127.0.0.1:4455') {
        $obsUrl = "wss://$DnsName/"
    }
    return [pscustomobject]@{ Exists = $exists; Url = "https://$DnsName/atem"; ObsUrl = $obsUrl }
}

function Read-TailscaleJson([string[]]$Arguments) {
    $result = & tailscale @Arguments 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $result) { throw 'Tailscaleの状態を取得できません。起動・ログインを確認してください。' }
    try { return ($result -join "`n" | ConvertFrom-Json) }
    catch { throw 'TailscaleのJSONを解析できません。設定は変更していません。' }
}

function Show-AtemWindow([string]$Url, [PSCredential]$Credential, [Diagnostics.Process]$BridgeProcess, [string]$ObsUrl) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object Windows.Forms.Form
    $form.Text = 'ATEM 接続ガイド（閉じると仲介プログラムを停止）'
    $form.ClientSize = New-Object Drawing.Size(640, 450)
    $form.StartPosition = 'CenterScreen'
    $form.AutoScaleMode = 'Dpi'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false

    $guide = New-Object Windows.Forms.Label
    $guide.SetBounds(20, 15, 600, 100)
    $guide.Text = "PC・スマホ共通：`r`n1. Tailscaleに同じネットワークでログイン`r`n2. 公開ページを開き「ATEM」タブを選択`r`n3. 下の接続URLと専用キーを入力して接続`r`nスマホだけでは動きません。このPCとLAN接続を維持してください。"
    if ($ObsUrl) { $guide.Text += "`r`n既存OBSの接続URL: $ObsUrl" }
    $form.Controls.Add($guide)
    $urlBox = New-Object Windows.Forms.TextBox
    $urlBox.SetBounds(20, 125, 600, 25)
    $urlBox.ReadOnly = $true
    $urlBox.Text = $Url
    $form.Controls.Add($urlBox)
    $keyBox = New-Object Windows.Forms.TextBox
    $keyBox.SetBounds(20, 170, 600, 25)
    $keyBox.ReadOnly = $true
    $keyBox.UseSystemPasswordChar = $true
    $keyBox.Text = $Credential.GetNetworkCredential().Password
    $form.Controls.Add($keyBox)
    $reveal = New-Object Windows.Forms.CheckBox
    $reveal.SetBounds(20, 205, 600, 25)
    $reveal.Text = '専用キーを表示（画面共有・スクリーンショットに注意）'
    $reveal.Add_CheckedChanged({ $keyBox.UseSystemPasswordChar = -not $reveal.Checked })
    $form.Controls.Add($reveal)
    $copyUrl = New-Object Windows.Forms.Button
    $copyUrl.SetBounds(20, 240, 170, 35)
    $copyUrl.Text = '接続URLをコピー'
    $copyUrl.Add_Click({ [Windows.Forms.Clipboard]::SetText($Url) })
    $form.Controls.Add($copyUrl)
    $copyKey = New-Object Windows.Forms.Button
    $copyKey.SetBounds(205, 240, 200, 35)
    $copyKey.Text = '専用キーをコピー'
    $copyKey.Add_Click({
        $answer = [Windows.Forms.MessageBox]::Show('専用キーをクリップボードに入れます。履歴や端末間同期に残る可能性があります。コピーしますか？', '確認', 'YesNo', 'Warning')
        if ($answer -eq 'Yes') { [Windows.Forms.Clipboard]::SetText($keyBox.Text) }
    })
    $form.Controls.Add($copyKey)
    $open = New-Object Windows.Forms.Button
    $open.SetBounds(420, 240, 200, 35)
    $open.Text = '操作ページを開く'
    $open.Add_Click({ Start-Process 'https://aominn.github.io/obs-remote-panel/' })
    $form.Controls.Add($open)
    $status = New-Object Windows.Forms.Label
    $status.SetBounds(20, 300, 600, 45)
    $status.Text = '仲介プログラム起動中。ATEMの接続状態は操作ページで確認してください。'
    $form.Controls.Add($status)
    $note = New-Object Windows.Forms.Label
    $note.SetBounds(20, 350, 600, 80)
    $note.Text = "スマホへの転送：接続URLと専用キーを別々に入力してください。`r`nキーを含むURLやQRコードは生成しません。キーをチャットへ送らないでください。`r`n次回も start-atem.cmd を開くだけで同じキーを使えます。`r`nこの画面を閉じると、このツールで起動した仲介プログラムだけを停止します。"
    $form.Controls.Add($note)
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 1000
    $timer.Add_Tick({
        if ($BridgeProcess.HasExited) {
            $status.Text = '仲介プログラムが終了しました。画面を閉じて再起動してください。8788番の使用状況も確認してください。'
            $status.ForeColor = [Drawing.Color]::Red
            $timer.Stop()
        } else {
            try {
                $request = [Net.HttpWebRequest]::Create('http://127.0.0.1:8788/state')
                $request.Timeout = 800
                $request.ReadWriteTimeout = 800
                $request.Proxy = $null
                $request.Headers['Origin'] = 'https://aominn.github.io'
                $request.Headers['Authorization'] = 'Bearer ' + $keyBox.Text
                $response = $request.GetResponse()
                try {
                    $reader = New-Object IO.StreamReader($response.GetResponseStream())
                    try { $state = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
                } finally { $response.Dispose() }
                if ($state.connected) {
                    $status.Text = "仲介：起動中 / ATEM：接続済み ($($state.model))"
                    $status.ForeColor = [Drawing.Color]::DarkGreen
                } else {
                    $status.Text = '仲介：起動中 / ATEM：未接続または対象外。LAN・IP・本体を確認してください。'
                    $status.ForeColor = [Drawing.Color]::DarkOrange
                }
            } catch {
                $status.Text = '仲介：応答待ち。ATEM接続済みとはまだ確認できていません。'
                $status.ForeColor = [Drawing.Color]::DarkOrange
            }
        }
    })
    try {
        $timer.Start()
        $null = $form.ShowDialog()
    } finally {
        $timer.Stop()
        $timer.Dispose()
        # Clear only our own current clipboard value; never clear unrelated data.
        try {
            if ([Windows.Forms.Clipboard]::ContainsText() -and [Windows.Forms.Clipboard]::GetText() -ceq $keyBox.Text) {
                [Windows.Forms.Clipboard]::Clear()
            }
        } catch { }
        $keyBox.Clear()
        $form.Dispose()
    }
}

function Start-AtemSetup {
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Windows専用の起動ツールです。' }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    $repository = Split-Path -Parent $PSScriptRoot
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js 20.19以上をインストールしてから再実行してください。 https://nodejs.org/' }
    $versionText = & $node.Source --version
    if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(\d+\.\d+\.\d+)' -or [version]$Matches[1] -lt [version]'20.19.0') { throw 'Node.js 20.19以上が必要です。' }
    if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) { throw 'Tailscaleをインストールしてログインしてください。 https://tailscale.com/download' }
    if (@(Get-NetTCPConnection -State Listen -LocalPort 8788 -ErrorAction SilentlyContinue).Count -gt 0) {
        throw '8788番は使用中です。手動起動した仲介プログラムなら、そのPowerShellでCtrl+Cを押してから再実行してください。他のプロセスは自動停止しません。'
    }
    $ts = Read-TailscaleJson @('status', '--json')
    if ($ts.BackendState -ne 'Running') { throw 'Tailscaleへログインしてから再実行してください。' }
    $dns = ([string]$ts.Self.DNSName).TrimEnd('.')
    $serve = Read-TailscaleJson @('serve', 'status', '--json')
    $plan = Get-AtemServePlan $serve $dns
    if (-not $plan.Exists) {
        Write-Host 'TailscaleにATEM用 /atem → 127.0.0.1:8788 を追加します。既存OBS用 / は維持します。'
        if ((Read-Host 'このネットワーク内への公開を許可しますか？ [y/N]') -ne 'y') { throw '追加をキャンセルしました。' }
        # Re-read after confirmation to avoid overwriting a newly added handler.
        $plan = Get-AtemServePlan (Read-TailscaleJson @('serve', 'status', '--json')) $dns
        if (-not $plan.Exists) {
            & tailscale serve --bg --https=443 --set-path=/atem http://127.0.0.1:8788
            if ($LASTEXITCODE -ne 0) { throw 'Serveを設定できませんでした。Tailscaleの表示を確認してください。' }
        }
        $plan = Get-AtemServePlan (Read-TailscaleJson @('serve', 'status', '--json')) $dns
        if (-not $plan.Exists) { throw 'Serveの追加を確認できません。' }
    }
    Write-Host "ATEM用接続URL: $($plan.Url)"
    Write-Host '追加したATEM用パスだけを解除する場合: tailscale serve --https=443 --set-path=/atem off'
    $storage = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'OBSRemotePanel\ATEM'
    Initialize-AtemStorage $storage
    $configPath = Join-Path $storage 'config.clixml'
    $config = $null
    if (Test-Path -LiteralPath $configPath) { $config = Read-AtemConfig $configPath }
    $address = if ($config) { $config.Address } else { '' }
    if (-not $config -or $ChangeAddress) {
        $entered = Read-Host "ATEMのLAN IPv4アドレス（現在: $address、変更しない場合はEnter）"
        if ($entered) { $address = $entered }
    }
    if (-not (Test-AtemAddress $address)) { throw 'ATEM Setupで確認したプライベートIPv4アドレスを入力してください。PC自身のIPではありません。' }
    $credential = if ($config) { $config.Credential } else { New-AtemCredential }
    if ($NewKey -and $config) {
        if ((Read-Host 'キーを再生成すると全操作端末の再入力が必要です。続行しますか？ [y/N]') -ne 'y') { throw 'キー変更をキャンセルしました。' }
        $credential = New-AtemCredential
    }
    Save-AtemConfig $configPath $address $credential
    $lock = Join-Path $repository 'bridge\package-lock.json'
    $hash = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
    $stamp = Join-Path $storage 'dependencies.sha256'
    Assert-RegularPath $stamp
    $installed = Join-Path $repository 'bridge\node_modules\atem-connection\package.json'
    if (-not (Test-Path -LiteralPath $installed) -or -not (Test-Path -LiteralPath $stamp) -or (Get-Content -LiteralPath $stamp -Raw).Trim() -ne $hash) {
        Write-Host '初回・更新時の準備中です（インターネット接続が必要です）...'
        & npm.cmd ci --prefix (Join-Path $repository 'bridge') --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw '依存関係の準備に失敗しました。ネットワークを確認して再実行してください。' }
        [IO.File]::WriteAllText($stamp, $hash)
    }
    # Pass secrets to this child only, never to CLI arguments or the parent env.
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $node.Source
    $info.Arguments = 'server.mjs'
    $info.WorkingDirectory = Join-Path $repository 'bridge'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.EnvironmentVariables['ATEM_ADDRESS'] = $address
    $info.EnvironmentVariables['ATEM_BRIDGE_TOKEN'] = $credential.GetNetworkCredential().Password
    $info.EnvironmentVariables['ATEM_BRIDGE_ORIGINS'] = 'https://aominn.github.io'
    $info.EnvironmentVariables['ATEM_BRIDGE_PORT'] = '8788'
    $process = $null
    try {
        $process = [Diagnostics.Process]::Start($info)
        $info.EnvironmentVariables.Remove('ATEM_BRIDGE_TOKEN')
        Show-AtemWindow $plan.Url $credential $process $plan.ObsUrl
    } finally {
        $info.EnvironmentVariables.Remove('ATEM_BRIDGE_TOKEN')
        if ($process) {
            if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
            $process.Dispose()
        }
    }
}

# Dot-sourcing loads pure helpers for offline tests; it never starts setup.
if ($MyInvocation.InvocationName -ne '.') {
    try { Start-AtemSetup }
    catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
}
