# OBS WebSocket / Tailscale Serve設定（Windows）

この構成はTailscale Serveだけを使い、Funnelは使いません。OBS WebSocketを一般インターネットへ公開しないでください。

## 1. OBS WebSocketを有効にする

OBS Studio 32.2.1を起動し、`ツール → WebSocketサーバー設定`を開きます。

1. WebSocketサーバーを有効にする
2. サーバーポートを`4455`にする
3. 認証を有効にする
4. 強いパスワードを設定する
5. 設定を適用し、OBSを起動したままにする

パスワードを空にしたり認証を無効にしたりしないでください。Windowsファイアウォールを全開放する必要もありません。Serveの転送先は`127.0.0.1:4455`です。

## 2. Tailscaleを確認する

OBS側PCと操作端末を同じtailnetへ参加させます。OBS側PowerShellで確認します。

```powershell
tailscale status
```

`tailscale`が見つからない、ログアウト中、または停止中なら先にTailscaleを修復します。tailnetでHTTPS証明書を初めて使う場合、Tailscale管理画面でHTTPSの有効化を求められることがあります。

## 3. 支援スクリプトを実行する

リポジトリのルートをPowerShellで開きます。変更内容だけを先に確認する場合:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-tailscale-serve.ps1 -WhatIf
```

設定する場合:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-tailscale-serve.ps1
```

`-ExecutionPolicy Bypass`はこの一回のPowerShellプロセスだけに適用され、システム全体の実行ポリシーは変更しません。

スクリプトは次を順に確認します。

- Tailscale CLIと接続状態
- `127.0.0.1:4455`の接続可否
- 現在の`tailscale serve status --json`
- HTTPS 443の既存Serve設定との競合
- 競合がない場合だけ`tailscale serve --https=443 --bg --yes http://127.0.0.1:4455`

既存HTTPS設定があれば上書きせず停止します。`tailscale serve reset`、Funnel、OBS認証変更、ファイアウォール全開放は行いません。

## 4. 表示されたURLをアプリへ設定する

成功時は次の形式が表示されます。

```text
Browser HTTPS URL: https://obs-pc.example-tailnet.ts.net/
WSS URL for OBS Remote Panel: wss://obs-pc.example-tailnet.ts.net/
```

スマートフォンでGitHub Pagesを開き、「接続・同期設定」へWSS URLとOBS WebSocketパスワードを入力します。操作端末のTailscaleをオンにして「接続」を押します。

## 5. 接続確認

1. `tailscale serve status`に`127.0.0.1:4455`へのHTTPS proxyがある
2. スマートフォンが同じtailnetにいる
3. アプリの接続状態が「接続済み」になる
4. シーン一覧を再取得できる
5. モックではなく実OBSで安全なシーン切り替えを一度確認する

## 6. よくあるエラー

- タイムアウト: どちらかのTailscaleがオフ、別tailnet、Serve停止、OBS停止
- 認証失敗: OBS WebSocketパスワードが違う
- URLエラー: `https://`ではなく`wss://`として入力したか、ホスト名や末尾パスを確認
- 接続拒否: OBS WebSocketが無効、ポートが4455ではない
- 証明書/HTTPSエラー: MagicDNS/HTTPS設定とTailscaleクライアントを確認
- スクリプトが競合で停止: 既存Serve設定の所有者/用途を確認し、共存方法を手動で設計する。スクリプトで上書きしない

GitHub PagesやSupabaseを開けることはtailnet疎通の証明にはなりません。

## 7. この設定だけを停止する

スクリプトが追加したHTTPS 443のServeリスナーだけを停止します。

```powershell
tailscale serve --https=443 off
```

実行前後に`tailscale serve status`を確認してください。ほかのServe設定も消す`tailscale serve reset`は使用しません。

この構文は2026年8月時点の現行資料（CLI変更後の1.52以降）に基づきます。実行前に[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)と[Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)も確認してください。
