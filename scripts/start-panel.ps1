#Requires -Version 5.1
[CmdletBinding()]
param([switch]$Reconfigure)
. (Join-Path $PSScriptRoot 'start-atem.ps1')

function Get-PanelServePlan($Config, [string]$Dns) {
    if ($null -eq $Config -or $Config -isnot [pscustomobject] -or $Dns -notmatch '^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+\.ts\.net$') { throw 'Serveの設定形式またはDNS名が不正です。' }
    foreach ($entry in $Config.PSObject.Properties) {
        if ($entry.Name -notin @('TCP', 'Web', 'AllowFunnel') -and $entry.Value) { throw '追加のServe設定があります。変更せず停止します。' }
    }
    foreach ($entry in $Config.AllowFunnel.PSObject.Properties) {
        if ($entry.Value -eq $true) { throw 'Funnelが有効なため停止します。一般公開は行いません。' }
    }
    $tcp = $Config.TCP.'443'
    if ($tcp -and ($tcp.HTTPS -ne $true -or $tcp.TCPForward -or $tcp.HTTP)) { throw '443番が別の用途で使用中です。' }
    $exists = $false
    foreach ($hostEntry in $Config.Web.PSObject.Properties) {
        if ($hostEntry.Name -notlike '*:443') { continue }
        if ($hostEntry.Name -ne "${Dns}:443") { throw '443番に別ホストの設定があります。' }
        foreach ($handler in $hostEntry.Value.Handlers.PSObject.Properties) {
            if ($handler.Name -eq '/panel') {
                if ($handler.Value.Proxy -ne 'http://127.0.0.1:8789' -or @($handler.Value.PSObject.Properties).Count -ne 1) { throw '/panel は使用済みです。上書きしません。' }
                $exists = $true
            } elseif ($handler.Name.StartsWith('/panel/')) { throw '/panel 配下に既存設定があります。' }
        }
    }
    if ($exists -and -not $tcp.HTTPS) { throw 'HTTPSの設定が不整合です。' }
    return [pscustomobject]@{ Exists = $exists; Url = "https://$Dns/panel" }
}

function Save-PanelConfig([string]$Path, $Config) {
    Assert-RegularPath $Path
    $temp = "$Path.$PID.tmp"
    Assert-RegularPath $temp
    try {
        $Config | Export-Clixml -LiteralPath $temp -Encoding UTF8
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temp, $Path) }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
}

function Read-PanelConfig([string]$Path) {
    Assert-RegularPath $Path
    try {
        $config = Import-Clixml -LiteralPath $Path
        if ($config.Version -ne 1 -or $config.Name -isnot [string] -or -not $config.Name.Trim() -or $config.Name.Length -gt 60 -or $config.ObsEnabled -isnot [bool] -or
            (-not $config.ObsEnabled -and -not $config.Address) -or
            ($config.Address -and -not (Test-AtemAddress $config.Address)) -or
            ($config.ObsEnabled -and ($config.ObsCredential -isnot [PSCredential] -or $config.ObsCredential.Password.Length -eq 0 -or
                $config.ObsPort -lt 1024 -or $config.ObsPort -gt 65535))) { throw 'Invalid configuration' }
        return $config
    } catch { throw '機材PC設定を読み取れません。同じWindowsユーザーで実行してください。保存済み設定は上書きしません。' }
}

function Invoke-PanelAdmin([string]$Token, [string]$Path, $Data = $null) {
    $options = @{ Uri = "http://127.0.0.1:8790$Path"; Headers = @{ Authorization = "Bearer $Token" }; TimeoutSec = 2; ErrorAction = 'Stop' }
    if ($null -ne $Data) { $options.Method = 'Post'; $options.ContentType = 'application/json'; $options.Body = [Text.Encoding]::UTF8.GetBytes(($Data | ConvertTo-Json -Compress)) }
    return Invoke-RestMethod @options
}

function Show-PanelWindow([string]$AdminToken, [Diagnostics.Process]$Process, [string]$PanelName) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object Windows.Forms.Form
    $form.Text = "Remote Panel 機材PC - $PanelName"
    $form.ClientSize = New-Object Drawing.Size(850, 620)
    $form.StartPosition = 'CenterScreen'
    $form.AutoScaleMode = 'Dpi'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $intro = New-Object Windows.Forms.Label
    $intro.SetBounds(20, 15, 810, 55)
    $intro.Text = "このPCではRemote Panelを開きません。別PC・スマホを登録して操作します。`r`n1.「端末を追加」 → 2. 操作端末でQR/リンクを開く → 3. 確認番号を照合して許可`r`n双方のTailscaleを有効にしてください。この画面の×は最小化、停止は「終了」です。"
    $form.Controls.Add($intro)
    $qr = New-Object Windows.Forms.PictureBox
    $qr.SetBounds(20, 115, 320, 320)
    $qr.SizeMode = 'Zoom'
    $form.Controls.Add($qr)
    $linkBox = New-Object Windows.Forms.TextBox
    $linkBox.SetBounds(20, 450, 810, 50)
    $linkBox.ReadOnly = $true
    $linkBox.Multiline = $true
    $form.Controls.Add($linkBox)
    $status = New-Object Windows.Forms.Label
    $status.SetBounds(20, 540, 810, 50)
    $status.Text = '機材接続を確認中です。'
    $form.Controls.Add($status)
    $pending = New-Object Windows.Forms.ListBox
    $pending.SetBounds(365, 130, 465, 100)
    $pending.DisplayMember = 'Text'
    $form.Controls.Add($pending)
    $devices = New-Object Windows.Forms.ListBox
    $devices.SetBounds(365, 310, 465, 100)
    $devices.DisplayMember = 'Text'
    $form.Controls.Add($devices)
    foreach ($labelInfo in @(@('承認待ち（確認番号・端末名）', 105), @('登録済みの操作端末', 285))) {
        $label = New-Object Windows.Forms.Label
        $label.SetBounds(365, [int]$labelInfo[1], 465, 25)
        $label.Text = $labelInfo[0]
        $form.Controls.Add($label)
    }
    $add = New-Object Windows.Forms.Button
    $add.SetBounds(20, 75, 155, 35)
    $add.Text = '端末を追加（2分間）'
    $add.Add_Click({
        try {
            $invite = Invoke-PanelAdmin $AdminToken '/invite' @{}
            $linkBox.Text = $invite.link
            $bytes = [Convert]::FromBase64String($invite.qr.Split(',')[1])
            $stream = New-Object IO.MemoryStream(,$bytes)
            try {
                $sourceImage = [Drawing.Image]::FromStream($stream)
                try { $nextImage = New-Object Drawing.Bitmap($sourceImage) } finally { $sourceImage.Dispose() }
            } finally { $stream.Dispose() }
            if ($qr.Image) { $qr.Image.Dispose() }
            $qr.Image = $nextImage
        } catch { $status.Text = '登録情報を発行できません。機材ツールの起動状態を確認してください。' }
    })
    $form.Controls.Add($add)
    $copy = New-Object Windows.Forms.Button
    $copy.SetBounds(185, 75, 155, 35)
    $copy.Text = '登録リンクをコピー'
    $copy.Add_Click({ if ($linkBox.Text) { [Windows.Forms.Clipboard]::SetText($linkBox.Text) } })
    $form.Controls.Add($copy)
    $approve = New-Object Windows.Forms.Button
    $approve.SetBounds(365, 235, 225, 35)
    $approve.Text = '確認番号を照合して許可'
    $approve.Add_Click({
        $selected = $pending.SelectedItem
        if ($selected -and [Windows.Forms.MessageBox]::Show("操作端末にも同じ確認番号が表示されていますか？`r`n$($selected.Text)`r`nこの端末にOBS・ATEMの操作を許可します。", '操作端末の承認', 'YesNo', 'Warning') -eq 'Yes') {
            try { $null = Invoke-PanelAdmin $AdminToken '/approve' @{ id = $selected.Id } }
            catch { $status.Text = '承認できません。有効期限が切れた場合は再登録してください。' }
        }
    })
    $form.Controls.Add($approve)
    $revoke = New-Object Windows.Forms.Button
    $revoke.SetBounds(365, 415, 225, 30)
    $revoke.Text = '選択した端末を登録解除'
    $revoke.Add_Click({
        $selected = $devices.SelectedItem
        if ($selected -and [Windows.Forms.MessageBox]::Show("$($selected.Text) の操作許可を解除しますか？", '登録解除', 'YesNo', 'Warning') -eq 'Yes') {
            try { $null = Invoke-PanelAdmin $AdminToken '/revoke' @{ id = $selected.Id } }
            catch { $status.Text = '登録解除に失敗しました。停止して確認してください。' }
        }
    })
    $form.Controls.Add($revoke)
    $form.Tag = $false
    $exitButton = New-Object Windows.Forms.Button
    $exitButton.SetBounds(650, 500, 180, 35)
    $exitButton.Text = '機材への仲介を終了'
    $exitButton.Add_Click({
        if ([Windows.Forms.MessageBox]::Show('操作端末からのOBS・ATEM操作が停止します。終了しますか？', '終了', 'YesNo', 'Warning') -eq 'Yes') { $form.Tag = $true; $form.Close() }
    })
    $form.Controls.Add($exitButton)
    $form.Add_FormClosing({
        if (-not $form.Tag -and $_.CloseReason -eq [Windows.Forms.CloseReason]::UserClosing) { $_.Cancel = $true; $form.WindowState = 'Minimized' }
    })
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 1500
    $timer.Add_Tick({
        if ($Process.HasExited) { $status.Text = '仲介が停止しました。終了ボタンで閉じ、再起動してください。'; $timer.Stop(); return }
        try {
            $state = Invoke-PanelAdmin $AdminToken '/status'
            $status.Text = if ($state.obsReady) { '仲介：起動中 / OBS：接続済み' } else { '仲介：起動中 / OBS：未接続または使用しない設定' }
            $status.Text += if ($null -eq $state.atemReady) { ' / ATEM：使用しない設定' } elseif ($state.atemReady) { ' / ATEM：接続済み' } else { ' / ATEM：未接続または対象外' }
            if ($state.fault) { $status.Text += ' / OBS操作は安全停止中。本体を確認後に再起動してください。' }
            foreach ($listInfo in @(@($pending, $state.pending), @($devices, $state.devices))) {
                $list = $listInfo[0]
                $items = @($listInfo[1])
                $selectedId = $list.SelectedItem.Id
                $list.Items.Clear()
                foreach ($item in $items) {
                    if (-not $item.id) { continue }
                    $text = if ($item.code) { "[$($item.code)] $($item.name)" } else { $item.name }
                    $index = $list.Items.Add([pscustomobject]@{ Id = $item.id; Text = $text })
                    if ($item.id -eq $selectedId) { $list.SelectedIndex = $index }
                }
            }
        } catch { $status.Text = '仲介へ接続できません。起動状態を確認してください。' }
    })
    try { $timer.Start(); $null = $form.ShowDialog() }
    finally { $timer.Stop(); $timer.Dispose(); if ($qr.Image) { $qr.Image.Dispose() }; $form.Dispose() }
}

function Start-PanelSetup {
    $ErrorActionPreference = 'Stop'
    $utf8 = New-Object Text.UTF8Encoding($false)
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    $repository = Split-Path -Parent $PSScriptRoot
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js 20.19以上を用意してください。' }
    $versionText = & $node.Source --version
    if ($versionText -notmatch '^v(\d+\.\d+\.\d+)' -or [version]$Matches[1] -lt [version]'20.19.0') { throw 'Node.js 20.19以上が必要です。' }
    if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) { throw 'Tailscaleを用意してログインしてください。' }
    foreach ($port in @(8789, 8790)) {
        if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count) { throw "$port 番が使用中です。二重起動せず停止します。" }
    }
    $ts = Read-TailscaleJson @('status', '--json')
    if ($ts.BackendState -ne 'Running') { throw 'Tailscaleへログインしてください。' }
    $dns = ([string]$ts.Self.DNSName).TrimEnd('.')
    $plan = Get-PanelServePlan (Read-TailscaleJson @('serve', 'status', '--json')) $dns
    $storage = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'OBSRemotePanel\Panel'
    Initialize-AtemStorage $storage
    $path = Join-Path $storage 'config.clixml'
    $config = if (Test-Path -LiteralPath $path) { Read-PanelConfig $path } else { $null }
    if (-not $config -or $Reconfigure) {
        $panelName = Read-Host 'この機材PCの名前（例：配信PC）'
        if (-not $panelName.Trim() -or $panelName.Length -gt 60) { throw '機材PC名は1～60文字で入力してください。' }
        $useObs = (Read-Host 'このPCのOBSを使いますか？ [y/N]') -eq 'y'
        $credential = $null
        $obsPort = 4455
        if ($useObs) {
            $enteredPort = Read-Host 'OBS WebSocketのポート（通常はEnterで4455）'
            if ($enteredPort) { $obsPort = [int]$enteredPort }
            if ($obsPort -lt 1024 -or $obsPort -gt 65535) { throw 'ポート番号が不正です。' }
            $password = Read-Host 'OBS WebSocketパスワード（このPCに暗号化保存）' -AsSecureString
            if (-not $password.Length) { throw 'OBS認証を有効にし、パスワードを入力してください。' }
            $credential = New-Object Management.Automation.PSCredential('OBS', $password)
        }
        $address = Read-Host 'ATEMのLAN IPv4（ATEMを使わないならEnter）'
        if ($address -and -not (Test-AtemAddress $address)) { throw 'ATEMのプライベートIPv4を指定してください。' }
        if (-not $useObs -and -not $address) { throw 'OBSまたはATEMを選択してください。' }
        $config = [pscustomobject]@{ Version = 1; Name = $panelName; ObsEnabled = $useObs; ObsPort = $obsPort; ObsCredential = $credential; Address = $address }
        Save-PanelConfig $path $config
    }
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $repository 'bridge\package-lock.json')).Hash
    $stamp = Join-Path $storage 'dependencies.sha256'
    Assert-RegularPath $stamp
    if (-not (Test-Path (Join-Path $repository 'bridge\node_modules\qrcode\package.json')) -or -not (Test-Path -LiteralPath $stamp) -or (Get-Content -LiteralPath $stamp -Raw).Trim() -ne $lockHash) {
        & npm.cmd ci --prefix (Join-Path $repository 'bridge') --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw '必要なプログラムを準備できません。' }
        [IO.File]::WriteAllText($stamp, $lockHash)
    }
    if (-not $plan.Exists) {
        Write-Host '新方式の /panel → 127.0.0.1:8789 をTailscale内だけへ公開します。既存 / と /atem は維持します。'
        if ((Read-Host '追加してよいですか？ [y/N]') -ne 'y') { throw '追加をキャンセルしました。' }
        $plan = Get-PanelServePlan (Read-TailscaleJson @('serve', 'status', '--json')) $dns
        if (-not $plan.Exists) {
            & tailscale serve --bg --https=443 --set-path=/panel http://127.0.0.1:8789
            if ($LASTEXITCODE -ne 0) { throw 'Serve設定に失敗しました。' }
        }
        $plan = Get-PanelServePlan (Read-TailscaleJson @('serve', 'status', '--json')) $dns
        if (-not $plan.Exists) { throw 'Serveの追加を確認できません。' }
    }
    Write-Host '新方式だけを解除する場合: tailscale serve --https=443 --set-path=/panel off'
    $registry = Join-Path $storage 'devices.json'
    Assert-RegularPath $registry
    $adminToken = (New-AtemCredential).GetNetworkCredential().Password
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $node.Source
    $info.Arguments = 'panel-server.mjs'
    $info.WorkingDirectory = Join-Path $repository 'bridge'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.EnvironmentVariables['PANEL_ADMIN_TOKEN'] = $adminToken
    $info.EnvironmentVariables['PANEL_NAME'] = $config.Name
    $info.EnvironmentVariables['PANEL_PUBLIC_URL'] = $plan.Url
    $info.EnvironmentVariables['PANEL_REGISTRY_PATH'] = $registry
    $info.EnvironmentVariables['PANEL_OBS_ENABLED'] = if ($config.ObsEnabled) { '1' } else { '0' }
    $info.EnvironmentVariables['PANEL_OBS_PORT'] = [string]$config.ObsPort
    $info.EnvironmentVariables['ATEM_ADDRESS'] = [string]$config.Address
    $info.EnvironmentVariables['PANEL_OBS_PASSWORD'] = if ($config.ObsEnabled) { $config.ObsCredential.GetNetworkCredential().Password } else { '' }
    $process = $null
    try {
        $process = [Diagnostics.Process]::Start($info)
        $info.EnvironmentVariables.Remove('PANEL_OBS_PASSWORD')
        $info.EnvironmentVariables.Remove('PANEL_ADMIN_TOKEN')
        Show-PanelWindow $adminToken $process $config.Name
    } finally {
        $info.EnvironmentVariables.Remove('PANEL_OBS_PASSWORD')
        $info.EnvironmentVariables.Remove('PANEL_ADMIN_TOKEN')
        if ($process) { if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }; $process.Dispose() }
    }
}
if ($MyInvocation.InvocationName -ne '.') {
    try { Start-PanelSetup }
    catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
}
