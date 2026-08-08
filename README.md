# OBS Remote Panel

Androidスマートフォン、タブレット、PCブラウザから、同じtailnet内のOBS Studioを操作する日本語PWAです。GitHub Pagesは画面だけを公開し、ブラウザがTailscale ServeのWSSエンドポイントへ直接接続します。OBS WebSocketを一般インターネットへ公開せず、Supabaseはログインと永続設定の同期だけに使います。

GitHub Pages、Tailscale、Supabaseの無料枠を使って試作できます（各サービスの最新の利用条件は確認してください）。Supabaseなしのローカル専用モードでも利用できます。

## 主な機能

- 複数のOBS接続プロファイル、接続タイムアウト、自動再接続（指数バックオフ、最大30秒）
- クイック操作の追加、削除、名前/色変更、スマートフォン対応の並べ替え
- シーン切り替え、お気に入り、並べ替え、非表示、プログラム/プレビューの区別
- シーンソースとグループ内ソースの表示切り替え
- 音声ミュート、dB音量、送信抑制、お気に入り
- `TriggerMediaInputAction` による画像スライドショーの前/次操作
- 配信、録画/一時停止、仮想カメラ、リプレイバッファ、スタジオモード、トランジション、OBS統計
- ローカル設定の安全な復旧、パスワードを除外したJSON入出力
- Supabase Magic Link/OTP、RLS、revision競合検出、Realtime更新通知
- PBKDF2-SHA-256 + AES-GCMによるOBSパスワードの任意暗号化同期
- PWA、静的アセットのオフライン起動、アプリ更新通知、GitHub Pagesサブパス対応
- `?mock=1` の実OBS不要デモ（通信断、接続失敗、自動再接続も再現）

## 1. ローカルまたはモックで起動

Node.js 20.19以上を用意します。

```bash
npm ci
npm run dev
```

Viteが表示したURLの `/obs-remote-panel/?mock=1` を開きます。例:

```text
http://localhost:5173/obs-remote-panel/?mock=1
```

モックモードで「接続」を押すと、6つのタブと主要操作を実OBSなしで確認できます。「接続・同期」→「モック診断」では通信断と次回接続失敗も試せます。実接続する場合は `?mock=1` を外してください。

## 2. GitHub Pagesを有効化

[GitHub Pages設定手順](docs/SETUP_GITHUB_PAGES.md)に従い、`Settings → Pages → Source: GitHub Actions` を選びます。`main`へのpushまたは手動実行で、テスト後に`dist`がPages artifactとして配備されます。`dist`をブランチへコミットする必要はありません。

公開予定URL: <https://aominn.github.io/obs-remote-panel/>

## 3. Supabaseを作成・設定

同期が必要な場合だけ[Supabase設定手順](docs/SETUP_SUPABASE.md)を実施します。`supabase/migrations/001_initial.sql`を適用し、公開URLとpublishable keyを環境変数へ設定します。`service_role` keyは使用しません。未設定ならアプリはローカル専用モードで起動します。

## 4. OBS WebSocketを設定

OBS Studio 32.2.1を想定しています。`ツール → WebSocketサーバー設定`でサーバーを有効化し、ポート`4455`と強いパスワードを設定します。認証は無効化しないでください。

## 5. Tailscale Serveを設定

OBS側Windows PCでTailscaleにログインし、[OBS/Tailscale設定手順](docs/SETUP_OBS_TAILSCALE.md)に従います。支援スクリプトはOBSの待受と既存Serve設定を確認し、競合がない場合だけ`127.0.0.1:4455`へのHTTPS reverse proxyを追加します。Funnelや無条件の`serve reset`は使いません。

## 6. スマートフォンから接続

スマートフォンをOBS側PCと同じtailnetへ参加させ、Pagesを開きます。「接続・同期設定」にスクリプトが表示した`wss://<端末名>.<tailnet>.ts.net/`とOBSパスワードを入力し、「接続」を押します。

GitHub PagesとSupabaseへ到達できても、操作端末が同じtailnetに参加していなければOBSには接続できません。

## 7. PWAとしてホーム画面へ追加

Android Chromeならブラウザメニューの「ホーム画面に追加」または「アプリをインストール」を選びます。静的画面とローカル設定はオフラインでも開けますが、オフライン中はOBS接続とSupabase同期はできません。

## npm scripts

```bash
npm run dev        # 開発サーバー
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm run test       # Vitest + Testing Library
npm run build      # 型チェック + 本番ビルド
npm run preview    # distのローカル確認
npm run check      # 型・lint・test・buildを一括実行
```

## 設計とセキュリティ

```text
GitHub Pages ──静的画面──> 操作端末のブラウザ
Supabase    <──認証/設定──> 操作端末のブラウザ
OBS :4455  <──Tailscale Serve (WSS)── 操作端末のブラウザ
```

- OBS状態、配信状態、WebSocketセッションはSupabaseへ保存しません。
- OBSパスワードはローカル保存です。同期を明示的に有効化した場合だけ、端末内で暗号化した暗号文を保存します。
- 同期用パスフレーズと暗号鍵は保存・送信しません。
- Service Workerはビルド済み静的アセットだけをprecacheし、OBS/Supabaseの実行時レスポンスをキャッシュしません。
- 詳細は[セキュリティ文書](docs/SECURITY.md)を参照してください。

## 現在の制限

- スライド番号はOBS WebSocketから正確に得られないため「番号取得非対応」とし、推測値を表示しません。
- OBSのグループ内ソースは`GetGroupSceneItemList`でbest-effort対応です。OBS/source構成によって取得できない場合でも最上位ソースの操作は継続します。OBS公式仕様もネストしたシーンの利用を推奨しています。
- 実OBS、実Tailscale、実Supabaseによる疎通は各利用者の認証情報とtailnetが必要です。モックと自動テストの成功は実機疎通の成功を保証しません。
