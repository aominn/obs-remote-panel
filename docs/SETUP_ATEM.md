# ATEMの最小操作

ATEM Mini／Mini Pro／Mini Pro ISO（HDMI最大4入力）とATEM Mini Extreme／Mini Extreme ISO（HDMI最大8入力）の、プレビュー選択・プログラム直接選択・CUT・AUTOを追加しています。操作するM/Eは1つ目（M/E 0）です。音声・ワイプ・マクロ・サイズ設定は操作しません。

接続先IPをPC側で指定すると機種IDを自動判定します。手動の機種選択は不要です。入力名・入力一覧は実機が返した物理HDMI入力から取得し、未取得の入力は補完しません。別のATEMを使う場合は仲介サービスを停止してATEM_ADDRESSを変更し、再起動してください。同時に複数台を操作する機能はありません。

対象外のSDI、Television Studio、Constellation、Mini Extreme ISO G2、未知の機種では操作を無効にします。ライブラリが認識できる機種すべてを動作保証するものではありません。

検証状況：Mini Extreme ISO（ソフトウェア9.5.1）はLAN接続と機種・本番・プレビューの状態取得を確認済みです。実機への切り替え命令、映像結果、他4機種は未検証です。5機種の自動判定・入力制限・命令の送信先はFakeによる自動テストで確認します。

## 接続構成

スマートフォンのRemote Panel → Tailscale ServeのHTTPS → OBSと同じWindows PC上のATEM仲介サービス → LAN上のATEM。

独自制御は **LANのみ** です。USBはATEMからOBSへの映像入力に引き続き使用できますが、USBだけでATEMを制御する機能はありません。仲介サービスにはNode.js 20.19以上が必要です。ATEM Software ControlでLAN接続できることを先に確認してください。

## 1. 仲介サービスを起動

Windowsでは `start-atem.cmd` の[簡単起動・端末引き継ぎ](SETUP_ENVIRONMENT.md)を利用できます。以下は手動起動の代替手順です。

リポジトリのルートで、初回またはbridge/package-lock.json更新時に依存関係を準備します。ルート側とは独立した依存関係です。

```powershell
npm.cmd ci --prefix bridge --ignore-scripts
```

同じPowerShellウィンドウで次を実行します。接続キーにはパスワード管理アプリなどで生成した32文字以上のランダムな文字列を使用してください。OBSパスワードやTailscaleの認証キーとは別のキーです。

```powershell
$env:ATEM_ADDRESS = Read-Host 'ATEMのLAN IPv4アドレス'
$atemSecureKey = Read-Host 'ATEM専用の接続キー（32文字以上）' -AsSecureString
$atemKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($atemSecureKey)
try {
    $env:ATEM_BRIDGE_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($atemKeyPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($atemKeyPointer)
    $atemSecureKey.Dispose()
}
$env:ATEM_BRIDGE_ORIGINS = 'https://aominn.github.io'
try {
    npm.cmd start --prefix bridge
} finally {
    Remove-Item Env:ATEM_BRIDGE_TOKEN -ErrorAction SilentlyContinue
}
```

- ATEM_ADDRESSは10.x.x.x、172.16–31.x.x、192.168.x.xのプライベートIPv4に限定しています。
- 既定の待受は127.0.0.1:8788。別のポートが必要な場合だけATEM_BRIDGE_PORTを指定します。
- 接続キーは実行中のプロセスメモリ／環境変数にだけ保持します。コンソールやファイルへ出力しないでください。
- 起動したウィンドウを開いたまま使用します。停止はCtrl+C。Windows起動時の自動起動は今回含めません。

## 2. Tailscale Serveへ専用パスを追加

この操作はアプリから自動実行されません。まず `tailscale serve status` で既存設定を確認してください。**443番でFunnelが有効な場合、または /atem が使用済みの場合は追加せず、設定を確認してください。** / は既存OBSの接続先のまま維持します。

未使用の /atem にだけ追加します。

```powershell
tailscale serve --bg --https=443 --set-path=/atem http://127.0.0.1:8788
tailscale serve status
```

表示された端末名・tailnet名を用い、ATEMタブには `https://<端末名>.<tailnet>.ts.net/atem` を登録します。OBS側の既存WSS URLは変更しません。スマートフォンも同じtailnetに接続します。

この追加分だけを解除する場合:

```powershell
tailscale serve --https=443 --set-path=/atem off
```

`serve reset`、Funnel、ルーターのポート開放は不要です。既存のWindows OBSセットアップスクリプトは変更していません。既存設定に追加パスがあると再セットアップが競合を報告する場合があります。その際に設定をリセットしないでください。

## 3. ATEMタブで操作

1. 「ATEM」タブを開く。
2. 仲介サービスのHTTPS URLと、PC側で入力した接続キーを入力して「ATEMに接続」。
3. 赤い本番表示と緑のプレビュー表示、ATEMで設定した入力名を確認する。
4. 「次に出す入力を選択」でプレビューを選び、CUT／AUTOで本番へ送る。「本番へ直接切り替え」は即時に本番を変更する。

本体の入力名・本番・プレビュー・トランジション状態を約1秒間隔で読み取ります。タブ移動では接続を保持します。接続URLは環境プロファイルに保存されます。キーは任意の端末保存・暗号化同期・暗号化ファイルで引き継げます。通常JSONと通常クラウド設定にはキーを含めません。詳細は[簡単起動・端末引き継ぎ](SETUP_ENVIRONMENT.md)を参照してください。ATEM状態はSupabase・Service Workerへ保存しません。

AUTOはATEMに設定されているトランジションと次トランジション対象を使用します。キーが対象になっている場合、ATEM側設定に従ってワイプ等も変化する可能性があるため、初期設定で背景のみを対象にしてください。AFV等の既存音声設定もATEM本体の設定に従います。

通信失敗時は本番表示を未取得にし、操作を無効化します。定期取得で回復した場合は実機の状態を再表示します。命令は自動再送しません。命令応答がタイムアウトした場合は安全のため仲介サービス側で操作を停止します。本体を確認し、仲介サービスを再起動して再接続してください。

## モックと検証

`?mock=1` のATEMタブで「ATEMに接続」を押すと、8入力のモックで4種類の操作を確認できます。実機や仲介サービスは不要です。モックAUTOは即時切り替えで、トランジション映像は再現しません。

```powershell
npm.cmd run check
npm.cmd test --prefix bridge
```

同じPCでローカル開発する場合は、ATEM_BRIDGE_ORIGINSにViteの正確なorigin（例: http://localhost:5173）を指定し、接続先を http://127.0.0.1:8788 にします。複数originはカンマ区切り。HTTPSのPagesからはTailscaleのHTTPSを使用してください。

実機では対象5機種それぞれで、入力数・入力名・本体操作の同期・プレビューが本番を変えないこと・CUT/AUTO・抜線復帰を確認してください。自動テストは実機映像やATEMファームウェアとの相性までは検証しません。

参考: [atem-connection](https://github.com/Sofie-Automation/sofie-atem-connection)、[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
