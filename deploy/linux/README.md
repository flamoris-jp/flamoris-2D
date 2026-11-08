# CLI 0.1.2への更新

既存の0.1.1からはUpdaterで0.1.2へ更新します。stateと接続設定を保持し、
旧実行環境をUpdaterのロールバック用に残します。先にMCPの`cli.project_save`で保存し、
描画JOBと並行編集がないことを確認してください。

0.1.2のcatalog URLは
`https://github.com/flamoris-jp/flamoris-2D/releases/download/cli-v0.1.2/catalog.json`。
固定0.1.1 catalogを登録している場合は0.1.2 catalogを追加してから更新します。

アプリの更新後、DECO PONで同じリリースの`refresh-2d-lime-hub.py`を取得し、
`sudo python3 refresh-2d-lime-hub.py --apply`を実行します。リリースのSHA256SUMSで
検証した188ツールのdescriptorを、既存184ツールのスキーマを維持したまま登録し、
Hubを再起動します。接続キーやNginx経路は変更しません。
既存descriptorを退避し、実MCPのページング・スキーマ・mcp.contextが確認できない場合は
以前のdescriptorへ戻します。Hub再起動中は他のHubクライアントも一時的に再接続します。

成功後は188ツールと新しいruntimeIdを確認し、実素材の取り込み・描画・保存を確認します。
以下の0.1.1手順は初回移行の履歴です。更新時に再インストールやcleanupを行いません。

# LIME resident migration (CLI 0.1.1)

Docker・Updater管理へ移行し、Kachinco CLIと同じ常駐・再接続方式に揃えます。
Hubの入口・認証は別途照合します。旧setupのlime再導入は行いません。

## 旧native配置からの移行

Updaterの初回導入は既存ディレクトリを置換しません。
prepareはバックアップ・旧サービス停止・接続キーの引き継ぎ準備です。
**prepare直後にcleanupを実行しないでください。**
cleanupは新コンテナの稼働とHub接続が確認できてからの最終処理です。

2026-11-07の移行で0.1.1導入がinstall/not_emptyになった場合は、
この版のrecover-resident.pyとsetup-2d-lime.pyを同じ作業フォルダーへ取得し、
LIMEで次を実行します。

```bash
sudo python3 -I recover-resident.py --job <Updater JOB ID>
sudo python3 -I recover-resident.py --job <Updater JOB ID> --apply
```

復旧対象はmanaged_appなし、初期installer記録なし、同じ0.1.1 recipe/image、
準備済みnative状態に限定。Updater 1.0.15のruntimeとサービス設定も照合します。
別JOB、配置開始後の失敗、変更された配置は再実行しません。

applyは排他ロックとUpdaterサービス停止で並行実行を防ぎ、
旧フォルダーを隣のflamoris-2d-cli-native-retired-日時へ丸ごと退避します。
同じJOBの失敗履歴を残し、既存artifactを再検証して公式Installerでコンテナを作成。
空の新stateへデータをコピーし、全ファイルのSHA-256を照合、UID10001/0600へ設定します。
公式初期セットアップ開始・完了後、Updaterサービスを再開します。
旧state、checkpoint、receipt、秘密キー、バックアップは退避側にも残ります。
履歴削除、SQL reset、git clone、pip導入、公開済みimageの作り直しは行いません。

途中で止まった場合は自動再試行せず、表示段階とUpdater JOBを確認します。
HTTP healthはプロセス生存確認です。Hub接続の検証は別途必要です。

## 新規導入とHub接続

旧配置のないホストでは公開済みreleases/download/cli-v0.1.1/catalog.jsonをUpdaterに登録し、
flamoris-2d-cli 0.1.1を導入。HUB_ENDPOINT/HUB_TOKENへ専用URLと接続キーを指定します。
旧配置移行では600のstate/connection.jsonを保持するため、これらの設定は空にします。

DECO PONのHub登録はsetup-2d-lime.pyのhub phaseを使用し、
全184ツールとmcp.contextを確認。失敗時はHub設定が戻ります。
hub phaseは、既存の2D用Nginx snippetが読み込まれていることを確認し、
稼働中Kachinco LIMEと同じWebSocket転送を/desktop/flamoris2d-limeへ追加します。
nginx -t成功後にreloadし、失敗時はsnippetを復元します。
元snippetはHub setup backup内のnginx-2d.confへ保存します。
追加済みの一致する経路は変更しません。後段のHub確認に失敗しても、正常な転送設定は保持します。

## 接続確認後のお掃除

LIMEで同じ版のmigrate-resident.pyを使用します。

```bash
sudo python3 migrate-resident.py cleanup
sudo python3 migrate-resident.py cleanup --apply
```

稼働コンテナのstate mount、Hub接続、旧サービス停止、全削除候補を先に検証。
旧unit・検証済みrelease・配布tarだけを削除します。
退避された旧stateとprivate rollback backup、現在のstate、秘密設定は保持します。

DECO PONでは同じフォルダーのsetup-2d-lime.pyと一緒に実行します。

```bash
sudo python3 migrate-resident.py cleanup --hub
sudo python3 migrate-resident.py cleanup --hub --apply
```

稼働Hubと同じimage/mount、2D専用swap名の停止コンテナだけが対象。
実mcp.context応答を先に確認します。Docker全体のpruneは行いません。

未保存編集は通常仕様どおりプロセス内です。移行前にproject_saveで保存してください。
