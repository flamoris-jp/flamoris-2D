# LIME / Linux headless 2D

FLAMORIS 2Dの通常の編集コアを、Windowsの画面を起動せずに使うCLIです。
Cutwork `.flimg` v1/v2/v3、PSD/PSB、既存 `.fl2d`を読み込み、MCPで編集し、
透過PNGを確認・書き出せます。初期版は明示的なCPUオフライン描画です。
Windows版のDirect3D描画、デスクトップ画面共有、MP4エンコーダーは使いません。

設計・受け入れ条件は[ADR 0013](decisions/0013-headless-linux-host.md)。
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
flamoris2d import character.flimg --output character.fl2d
flamoris2d inspect character.fl2d
flamoris2d preview character.fl2d --output preview.png --width 640
flamoris2d preview character.fl2d --sequence SEQUENCE_ID --time-ticks 120000 --output second.png
flamoris2d render character.fl2d --sequence SEQUENCE_ID --width 1920 --height 1080 --fps 30 --output-dir frames
```

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

## HubとLIMEの常駐サービス

`flamoris2d mcp-catalog`は、別ID`flamoris2d-lime`の登録用JSONを出します。
JSONはYAMLとしても読めるので、Hubのruntime catalogに`.yaml`名で配置できます。
既存Windows版の接続・カタログは置き換えません。

Hub側は生成した定義の`FLAMORIS2D_LIME_CONNECTOR_TOKEN`、LIME側は
`FLAMORIS_HUB_CREDENTIAL`へ、同じ専用接続キーを設定します。接続キーはコマンド引数、
リポジトリ、プロジェクトへ入れません。実行時に環境から取り込み、環境変数を消します。

```bash
flamoris2d mcp character.flimg --workspace /path/to/shot --permission edit \
  --hub wss://YOUR-HUB/desktop/flamoris2d-lime
```

systemdの例は[`flamoris2d-lime.service.example`](../product/packaging/flamoris2d-lime.service.example)。
配置先と実行ユーザーを実環境に合わせ、権限600の`hub.env`に以下を設定します。

```text
FLAMORIS2D_INPUT=/path/to/character.flimg
FLAMORIS2D_HUB_ENDPOINT=wss://YOUR-HUB/desktop/flamoris2d-lime
FLAMORIS_HUB_CREDENTIAL=YOUR_DEDICATED_CONNECTOR_CREDENTIAL
```

Hubカタログ・専用キー・サービスの設定はデプロイ時の作業です。ソースのビルドやPRだけで
本番接続が切り替わることはありません。接続が失敗した場合は終了コードを返し、
systemdの再起動方針へ戻します。SIGTERM/stdio EOFで終了処理し、実行中JOBを止めます。
