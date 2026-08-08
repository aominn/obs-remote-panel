# セキュリティ設計

## 境界

- GitHub Pagesは静的HTML/CSS/JavaScript/PWAだけを公開します。
- OBS接続は操作端末のブラウザからtailnet内のTailscale Serveへ直接WSS接続します。
- Supabaseは認証と永続設定だけに使用し、OBS実行状態やWebSocketセッションを保存しません。
- Tailscale Funnelは使用せず、OBS WebSocketを一般インターネットへ公開しません。

## 秘密情報

- OBSパスワードは各端末のlocalStorageへ保存されます。その端末のブラウザプロファイルへアクセスできるユーザー/拡張機能/スクリプトから完全には保護できません。共有端末では使用後にプロファイルを削除してください。
- JSONエクスポートとSupabaseの公開設定からOBSパスワードを除外します。
- パスワード同期を明示的に有効化した場合、同期用パスフレーズからPBKDF2-SHA-256（310,000回、ランダム16 byte salt）で鍵を導出し、AES-256-GCM（ランダム12 byte IV）で暗号化します。形式/KDF/反復回数を暗号データへ含めます。
- 同期用パスフレーズと導出鍵はSupabaseへ送信せず、永続保存しません。ログにも出しません。
- パスフレーズ違い/暗号データ破損は復号エラーとして扱い、Supabase認証エラーとは区別します。
- Supabaseの`service_role` keyは一切使用しません。フロントエンドにはProject URLとpublishable keyだけを含め、RLSを必須とします。

クライアント側暗号化はSupabase上の平文漏えいを避けるためのものです。パスフレーズ入力後の端末、ブラウザ、悪意ある拡張機能、XSS、端末乗っ取りから実行中の平文を保護するものではありません。

## データベース

`public.user_settings.user_id`は`auth.users.id`を参照する主キーです。RLS policyは`authenticated` roleかつ`(select auth.uid()) = user_id`だけにSELECT/INSERT/UPDATE/DELETEを許可します。`anon`権限は取り消します。

revisionとupdated_atで他端末更新を検出し、ローカル変更と競合した場合は自動上書きを停止します。ユーザーが「クラウドを取り込む」または「ローカルで上書き」を選ぶまで無限同期しません。

## PWAキャッシュ

Service Workerはビルド時に生成され、HTML/JS/CSS/SVG/fontなどの静的アセットだけをprecacheします。runtime cachingは設定しないため、次をキャッシュしません。

- OBS WebSocket通信
- OBSパスワード、同期用パスフレーズ、暗号鍵
- Supabaseセッションや設定APIのレスポンス
- OBS実行状態や統計

## 出力操作

配信、録画、仮想カメラ、リプレイバッファ、スタジオモードの切り替えは既定で確認ダイアログを表示します。未接続中とオフライン中の操作は無効です。確認設定はユーザーが無効化できます。

## 運用チェック

- OBS WebSocket認証を常に有効にする
- Serveの転送先を`127.0.0.1:4455`に限定する
- Funnel、ルーターのポート転送、全インターネット向けファイアウォール許可を使わない
- 操作端末とOBS側PCを同じ管理されたtailnetに置く
- RLS適用後に別ユーザー間の読み書き拒否を確認する
- `.env.local`、OBSパスワード、service_role keyをcommitしない
- `npm audit`とGitHub Dependabot/依存関係レビューを定期実行する
- Tailscale Serve CLIは更新されるため、再設定前に公式資料を確認する

脆弱性を公開Issueへ秘密情報付きで投稿しないでください。漏えいが疑われる場合は、OBSパスワードと該当Supabase資格情報を直ちにローテーションしてください。
