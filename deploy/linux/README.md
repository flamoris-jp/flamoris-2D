# LIME resident migration (CLI 0.1.1)

Docker・Updater管理へ移行し、Kachinco CLIと同じ常駐・再接続方式に揃えます。
Hubの入口・認証は別途照合します。旧setupのlime再導入は行いません。

1. この版の `migrate-resident.py` と `setup-2d-lime.py` を同じ一時フォルダーに取得。
2. LIMEで `sudo python3 migrate-resident.py prepare --apply`。旧サービスを停止・無効化し、
   state全体と秘密設定をprivate backupに保存。同じstateフォルダーをUID10001へ引き継ぎます。
   接続キーはstate/connection.jsonに600で保持し、チャットへコピーしません。
3. Updaterにリポジトリの `releases/download/cli-v0.1.1/catalog.json` を登録。
   `flamoris-2d-cli` 0.1.1を導入。既存移行ではHUB_ENDPOINT/HUB_TOKENを空にして
   retained connection.jsonを使用。新規導入では専用URL/キーを設定します。
4. Updaterの初期セットアップ開始・完了を実行。HTTP healthはプロセス生存確認です。
5. DECO PONのHub登録は既存setupのhub phaseを使用。全184ツールとmcp.contextを確認。
   失敗時はHub設定が戻ります。Docker化のみで外部WSSが直ったとは判断しません。
6. LIMEの `sudo python3 migrate-resident.py cleanup` で計画を表示。
   接続確認後 `sudo python3 migrate-resident.py cleanup --apply` で旧unit・検証済みreleaseと
   tarだけを除去。state、秘密設定、private rollback backupは保持します。
7. DECO PONの `sudo python3 migrate-resident.py cleanup --hub` で停止中の候補を確認し、
   `sudo python3 migrate-resident.py cleanup --hub --apply` で除去します。
   稼働Hubと同じimage/mountかつ2D用swap名の停止コンテナだけが対象。先に実context応答を確認します。
   Docker全体のpruneや他製品・画像の削除はしません。

prepare完了後に移行を中断する場合は、新コンテナを止めた後、現在のstateを別名で保全し、
記録 `config/native-migration.json` のbackup/stateをstateへ戻して旧unitを再開します。
新コンテナで作業した場合の現在stateを上書きせず、必ず別名で保持してください。

未保存の編集はCLIの通常仕様どおりプロセス内です。作業中ならproject_saveでチェックポイントしてから移行します。
