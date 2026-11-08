# LIME / Linux headless 2D

FLAMORIS 2Dの通常の編集コアを、Windowsの画面を起動せずに使うCLIです。
Cutwork `.flimg` v1/v2/v3、PSD/PSB、既存 `.fl2d`を読み込み、MCPで編集し、
透過PNGを確認・書き出せます。初期版は明示的なCPUオフライン描画です。
Windows版のDirect3D描画、デスクトップ画面共有、MP4エンコーダーは使いません。

編集コアの設計は[ADR 0013](decisions/0013-headless-linux-host.md)、現行の常駐方式は
[ADR 0014](decisions/0014-updater-resident-linux.md)。
[2026-11-07の実機接続・移行完了記録](reviews/lime-resident-acceptance-20261107.md)も参照してください。
自動テストの合格と、実作品の見た目・LIME実機の性能・Hub本番接続は別々に確認します。

## ビルドと配布候補

Linux x86_64向けで、CIの配布候補はUbuntu 24.04をビルド基準とします。
実行先のglibc/libstdc++はビルド環境に対応する版が必要です。
ビルドには.NET 10 SDK、CMake 3.21以降、
C++17コンパイラー、Python 3、curl、tarが必要です。WPF/Captureのsubmoduleは不要です。
組織のGitHub認証を使う場合は、通常ユーザーで取得します。

```bash
gh auth status
gh repo clone flamoris-jp/flamoris-2D
cd flamoris-2D
bash product/packaging/publish-linux.sh
```

出力は`artifacts/linux/FLAMORIS-2D-linux-x64/`と`.tar.gz`です。
新しい出力フォルダーを指定できます。自己完結.NETランタイム、C++コア、ICU 78.3、
ライセンス、チェックサム、Hub登録用JSONを含みます。実行先にSDKは不要です。
フォルダー全体を保持してください。実行先のglibc/libstdc++はOS側が提供します。

ICUはUnicode公式のUbuntu 22.04 x64アーカイブをSHA-256で固定しています。
Windows版と同じ78.3です。`FLAMORIS2D_ICU_ROOT`で同バージョンのprefixを指定する場合は、
`include/`、`lib/`、`share/icu/78.3/LICENSE`が必要です。

開発用のビルド・実プロセスMCPテスト:

```bash
fl2d_icu_root=$(bash product/packaging/prepare-linux-icu.sh)
dotnet build product/native/tests/Flamoris2D.Cli.Tests -c Release -p:NativeIcuRoot="$fl2d_icu_root"
dotnet product/native/tests/Flamoris2D.Cli.Tests/bin/Release/net10.0/Flamoris2D.Cli.Tests.dll \
  product/native/src/Flamoris2D.Cli/bin/Release/net10.0/flamoris2d.dll \
  product/native/tests/fixtures/cutwork/cutwork-current-v3.flimg
```

## 一回ずつ使う

以下の`flamoris2d`は配布候補の実行ファイルです。

```bash
flamoris2d new --output blank.fl2d
flamoris2d import character.flimg --output character.fl2d
flamoris2d inspect character.fl2d
flamoris2d preview character.fl2d --output preview.png --width 640
flamoris2d preview character.fl2d --sequence SEQUENCE_ID --time-ticks 120000 --output second.png
flamoris2d render character.fl2d --sequence SEQUENCE_ID --width 1920 --height 1080 --fps 30 --output-dir frames
```

- `new`は通常のNativeWorkspaceで空のプロジェクトを作ります。既存出力は上書きしません。
- `import`は新しい`.fl2d`を作ります。入力と既存出力は上書きしません。
- `inspect`はScene、Key Art、Sequence等をJSONで返します。
- `preview`はKey Art、Sequence、Transitionを一つ指定します。省略時は最初のKey Artです。
  時間は120000 ticks/秒。出力は各辺最大960pxの透過PNGです。
  MCP画像が1MiBを超えた場合は、`width`を下げて取得し直してください。
- `render`はSequenceまたはTransitionの全区間を、既存と同じフレーム計画で書き出します。
  縦横比はプロジェクトと一致させます。有理数fpsは`--fps 30000 --fps-denominator 1001`。
  指定出力フォルダーの下に、JOB IDのサブフォルダーと`job.json`を作ります。
- 連番は`frame_000001.png`から始まります。初期版ではPNGまでを2Dが担当します。
  動画化や背景との最終合成は後段へ渡します。

## MCPから制作する

stdio設定の例:

```json
{
  "mcpServers": {
    "flamoris2d-lime": {
      "command": "/path/to/flamoris2d",
      "args": ["mcp", "/path/to/character.flimg", "--workspace", "/path/to/shot", "--permission", "edit"]
    }
  }
}
```

権限の省略時は`read-only`です。`edit`では既存のtyped編集ツール、Transaction、
Undo/Redoに加え、固定された作業フォルダーへの保存・書き出しが使えます。
任意ファイルをリモート指定して開く・保存するツールはありません。
常駐中の素材取り込みには、後述のバイト転送用ツールを使います。

作業フォルダーに`project.fl2d`があれば、次の起動ではそのファイルを開きます。
初回の`edit`起動では入力から作業コピーを作ります。元の入力は変更しません。
同じフォルダーを二つのプロセスで開くことはできません。
入力・出力・作業フォルダーのシンボリックリンクは拒否します。実体のパスを指定してください。
別素材から始めるときは新しい作業フォルダーを指定してください。
保存は`cli.project_save`で明示的に行います。終了時の自動保存はありません。

| ツール | 動作 |
| --- | --- |
| `mcp.context` | 現在のruntimeId、documentToken、revision、権限 |
| `cli.preview_frame` | CPUで描いた実際のPNGをMCP画像として返す。最大1MiB |
| `cli.project_save` | `project.fl2d`へ原子的に保存。外部変更を検出したら拒否 |
| `cli.render_start` | 固定フォルダーへPNG連番JOBを開始し、すぐにIDを返す |
| `cli.render_status` | JOBの状態、進捗、fps、出力先、エラーを確認 |
| `cli.render_cancel` | 現在のJOBを中止。完成済みPNGを残す |

MCP Coreの通常の`input`ラッパーを使います。変更操作には最新guardも付けます。

```json
{
  "input": {"sequenceId": "SEQUENCE_ID", "width": 1920, "height": 1080, "fpsNumerator": 30},
  "guard": {"runtimeId": "FROM_CONTEXT", "documentToken": "FROM_CONTEXT", "expectedRevision": "FROM_CONTEXT"}
}
```

書き出しは同時に1件、1800フレーム・PNG合計512MiBまでです。
途中で編集された場合はrevision競合で失敗し、異なる版の絵を混ぜません。
中止・失敗時は完成済みPNGと受領記録を残します。プロセス再起動後、以前の未完了JOBは
`interrupted`として扱います。自動再開や成功扱いにはしません。
プレビューも描画後に版を再確認してから画像を返します。

## 常駐中の素材取り込み（CLI 0.1.2）

Cutworkで保存した`.flimg`、PSD/PSBを、接続を切らずに新しい編集対象として
取り込めます。これは現在のプロジェクトの**置き換え**です。既存のリグへ追加・再照合
する機能ではありません。設計と受入れ条件は[ADR 0015](decisions/0015-resident-source-import.md)。

1. 現在の編集を`cli.project_save`で保存し、描画JOBの終了を確認する。
2. `mcp.context`で最新guardを取得する。
3. `cli.source_upload_begin`へ`uploadId`（小文字・ハイフン付きUUID）、`fileName`、
   `sizeBytes`（10進文字列）、`sha256`（小文字16進64桁）を送る。最大64 MiB。
4. `cli.source_upload_write`へ`uploadId`、`offset`（10進文字列）、`dataBase64`、
   `chunkSha256`を送る。1チャンクの復号後上限は128 KiB。返された`receivedBytes`を
   次のoffsetに使う。同じ直前チャンクの再送は重複追加されない。
5. `cli.source_upload_finish`へ`uploadId`と`replaceCurrent: true`を送る。
   完全なファイルと素材を検証し、保存済みcheckpointを
   `workspace/import-backups/<uploadId>.fl2d`へ退避してから置き換える。
6. `mcp.context`を取り直し、新しいdocumentTokenのguardで編集・プレビューする。
   取り込み後に`cli.project_save`を行うと、再起動後も新しい素材から再開できる。

4ツールすべてedit権限と最新guardが必要です。転送中に編集するとfinishは競合になるため、
`cli.source_upload_cancel`でそのuploadIdを破棄し、新しく転送を始めます。
未完転送はプロセス内だけに保持し、再起動後の転送再開は行いません。
ファイル名にパスは指定できず、URLやサーバー上の任意ファイルは読みません。

`source.unsaved_changes`は現在の編集の保存が必要、`source.incomplete_upload`は転送不足、
`source.checksum_mismatch`は全体のハッシュ不一致、`save.external_conflict`はcheckpointの
外部変更です。失敗時は現在のプロジェクトを維持します。取り込み前のプロジェクトは
退避ファイルから戻せますが、ファイルをまたぐUndoはありません。

CLI 0.1.2のLinuxカタログは188ツールです。CLI 0.1.1／184ツールと
区別してください。LIMEへの適用時は、保存・退避のうえで新CLIの`mcp-catalog`から
Hub descriptorを更新し、実際の素材取り込み・保存・再接続を別途確認します。
このPRの作成やCI実行だけでは本番への配置は行いません。

## HubとLinuxの常駐サービス

現行の配布は、Kachinco CLIと同じ**Docker・Updater管理**です。
公開済みCLI 0.1.1のカタログは[こちら](https://github.com/flamoris-jp/flamoris-2D/releases/download/cli-v0.1.1/catalog.json)。
アプリケーションID・コンテナ名は `flamoris-2d-cli`、対応platformは `linux/amd64` です。
配布imageをUpdaterが配置し、UID/GID 10001で実行します。実行先でソースをビルドする必要はありません。

| 境界 | 動作 |
| --- | --- |
| 永続state | 管理rootの `state/` をコンテナの `/data/state` へbind mount |
| 起動元 | `state/initial.fl2d`。初回のみ、作業コピーがない場合に通常の `new` で作成 |
| 編集用checkpoint | `state/workspace/project.fl2d`。既存なら再起動時に再読込 |
| PNG JOB | `state/workspace/renders/`。受領記録と完成済みPNGを保持 |
| HTTP health | loopbackの `/healthz`、既定port 8774。`status: ready` は子プロセス生存 |
| 接続確認 | healthの `hubConnected: true` とHub経由の `mcp.context` を別途確認 |

Updater設定の `PORT`、`HUB_ENDPOINT`、`HUB_TOKEN` は、コンテナ内では
`FLAMORIS2D_PORT`、`FLAMORIS2D_HUB_ENDPOINT`、`FLAMORIS2D_HUB_TOKEN` になります。
移行済みstateのprivateな `connection.json` に `endpoint` と `credential` を保持する場合、
HUB_ENDPOINT/HUB_TOKENは空にしてその値を使えます。ファイルは権限600、実行UIDが読める所有者にします。
接続キーの値をGit・チャット・ログへ出さないでください。

`flamoris2d mcp-catalog` は、別ID `flamoris2d-lime`、namespace `flamoris2d_lime` の
184ツールを出します。Windows版 `flamoris2d` の登録とは別です。
Hub側の `FLAMORIS2D_LIME_CONNECTOR_TOKEN` と、CLIへ渡す
`FLAMORIS_HUB_CREDENTIAL` には同じ専用キーを使います。
entrypointがprivate設定を読み、CLIは実行時にキーを取り込んで環境変数を消します。

### 接続に必要な三つの配置

1. Updater管理のCLIと永続stateを配置する。
2. Hubへ専用descriptorと専用connectorキーを登録する。
3. 公開WSSの `/desktop/flamoris2d-lime` をHubへ転送する。

Kachincoの別URLが接続できても、2D用のexact locationがある証明にはなりません。
[セットアップ](../deploy/linux/README.md)のhub phaseは既存Kachinco proxyを検証し、
2D用経路を追加、バックアップ、`nginx -t`、reloadを行ってから接続を検証します。
JSONをそのままYAMLとして保存すると `5e-324` 等が文字列になる場合があります。
セットアップはinstalled HubのYAML round tripとschema検証を通します。

### 障害時の動作と確認順

Hub接続が失敗しても常駐プロセスとNativeWorkspaceは保持します。
共通providerのretry後、エラーが残る場合は60秒ごとにrefreshします。
編集要求を再送することはありません。
保存済みcheckpointは再起動後に戻りますが、未保存編集はプロセス内なので、
停止・再配置の前に `cli.project_save` を実行します。

`hub_unavailable` は共通providerが通信・認証・登録時の失敗をまとめたコードです。
これだけで障害箇所を断定せず、プロセスhealth、外部proxy経路、Hub認証、
schemaの順に観測を分けます。
Hubのツール一覧と実際の `mcp.context` のproductId・permission・hasDocumentを確認し、
接続が成立してから旧配置を片付けます。

### native/systemd版からの移行

旧 `flamoris2d-lime.service` の例は手動運用・移行履歴の参照です。
現行のUpdater管理コンテナと同じworkspaceを同時に開かないでください。
Updaterの初回導入は既存配置を上書きしません。`prepare` は引き継ぎ準備であり、
直後に `cleanup` を行う手順ではありません。

既存配置による `install/not_empty` の復旧は[移行手順](../deploy/linux/README.md)へ。
配置前の失敗と確認できる場合だけ、旧rootを丸ごと退避し、
公式Installerで作った空のstateへコピーして全ファイルのSHA-256を照合します。
旧unit・検証済みrelease/archiveと停止中Hub swapコンテナの除去は接続確認後です。
現在のstate、退避したstate、秘密設定、private rollback backupは保持します。
