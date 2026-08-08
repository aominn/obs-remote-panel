# Supabase設定

Supabaseはログインと永続設定の同期だけに使用します。OBSの現在状態やWebSocketセッションは保存しません。

## 1. プロジェクトとテーブルを作成

1. Supabaseでプロジェクトを作成する
2. `SQL Editor`を開く
3. `supabase/migrations/001_initial.sql`の内容を実行する
4. `public.user_settings`が作成されたことを確認する

SQLは`user_id`を主キーとして`auth.users(id)`へ関連付け、一人一行を保証します。RLSを有効化し、`authenticated`ユーザー本人の行だけにSELECT/INSERT/UPDATE/DELETEを許可します。`anon`の権限は明示的に取り消します。

Realtime通知用に`user_settings`を`supabase_realtime` publicationへ追加します。同期処理はRealtimeで設定本文を自動上書きせず、「他端末で更新あり」と通知し、revisionを使って競合を検出します。

## 2. メール認証を設定

`Authentication → URL Configuration`で設定します。

- Site URL: `https://aominn.github.io/obs-remote-panel/`
- Redirect URLs: `https://aominn.github.io/obs-remote-panel/`
- ローカル確認用: `http://localhost:5173/obs-remote-panel/`

`Authentication → Providers → Email`でメール認証を有効にします。アプリは`signInWithOtp`を使うため、Supabase側のメールテンプレート設定に応じてMagic LinkまたはOTPとして動作します。

## 3. 公開クライアント値を設定

SupabaseのProject Settings/API画面から次だけを取得します。

- Project URL → `VITE_SUPABASE_URL`
- Publishable key → `VITE_SUPABASE_PUBLISHABLE_KEY`

ローカルでは`.env.example`を`.env.local`へコピーして値を設定します。`.env.local`はGit対象外です。

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

GitHub Pagesでは[GitHub Pages設定](SETUP_GITHUB_PAGES.md)のRepository Variablesへ登録します。

service_role key、database password、JWT secretはブラウザやGitHubへ保存しないでください。

## 4. 動作確認

1. アプリの「接続・同期設定」を開く
2. メールアドレスを入力し、ログインメールを送信する
3. 同じブラウザでリンクを開く
4. 同期アカウント表示を確認する
5. 「同期する」を押す
6. 別ブラウザで同じアカウントへログインし、「クラウドを取り込む」を押す

OBSパスワードを同期する場合だけ「OBSパスワードを暗号化して同期する」を有効にし、同期用パスフレーズを入力します。パスフレーズはメモリ上で一時保持するだけでSupabaseには送信されません。新端末で同じパスフレーズを入力すると復号できます。忘れた場合は復元できません。

パスワード同期を使わない場合は端末ごとにOBSパスワードを入力します。公開設定の同期やJSON出力に平文パスワードは含まれません。

## 5. RLS確認

最低限、次を確認します。

- ログアウト中は`user_settings`を読めない
- ユーザーAはユーザーBのUUIDを指定しても読めない/更新できない
- ログイン中は自分の`user_id`の一行だけを操作できる
- Table EditorでRLSがEnabledと表示される

参考: [Supabase Auth](https://supabase.com/docs/guides/auth)、[Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
