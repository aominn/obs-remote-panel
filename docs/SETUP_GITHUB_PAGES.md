# GitHub Pages設定

## 1. Pagesの配備元を選ぶ

GitHubの`aominn/obs-remote-panel`で次を開きます。

1. `Settings`
2. 左メニューの`Pages`
3. `Build and deployment`の`Source`
4. `GitHub Actions`を選択

Viteの`base`は`/obs-remote-panel/`、PWAのscope/start URLも同じサブパスに設定済みです。

## 2. Supabase環境変数（任意）

同期を使う場合は`Settings → Secrets and variables → Actions → Variables`に次を登録します。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Repository Variablesを推奨しますが、同名のActions Secretsもworkflowがフォールバックとして読み取れます。publishable keyは公開クライアント用ですが、`supabase/migrations/001_initial.sql`のRLS適用が前提です。`service_role` keyは登録しないでください。

## 3. 配備する

`.github/workflows/deploy-pages.yml`は次の場合に実行されます。

- `main`へのpush
- Actions画面から`workflow_dispatch`を実行

workflowは`npm ci`、型チェック、lint、テスト、本番ビルドを行い、成功した`dist`だけをPages artifactへアップロードします。Actionsは検証可能なcommit SHAへ固定しています。

成功後に次を開きます。

<https://aominn.github.io/obs-remote-panel/>

モック確認URL:

<https://aominn.github.io/obs-remote-panel/?mock=1>

## 4. 問題がある場合

- 404: PagesのSourceが`GitHub Actions`か確認する
- JS/CSSだけ404: `vite.config.ts`のbaseが`/obs-remote-panel/`のままか確認する
- workflow未起動: ファイルが`main`の`.github/workflows/deploy-pages.yml`にあるか確認する
- Supabaseだけ未設定: workflowのRepository Variables名を確認する。アプリ自体はローカル専用モードで起動する
- Magic Link後に戻れない: SupabaseのRedirect URLsへPages URLを追加する

参考: [Vite GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages)、[GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
