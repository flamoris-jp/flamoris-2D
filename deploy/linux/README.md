# LIMEへの初回配置とHub接続

PR #167のCLIはmainへマージ済みです。このセットアップは、参照専用Server Managerと
既存アプリ向けUpdaterから実行できない、新しいネイティブサービスの配置をまとめます。
通常は計画表示のみで、`--apply`を指定した場合に変更します。
GitHubとSSHはsudoを実行した通常ユーザーの認証を使います。

## 実行順

レビュー済みコミットの`setup-2d-lime.py`を各サーバーへ取得し、以下を順に実行します。
Cutwork等のHubセットアップと同時には実行しないでください。

```bash
# LIME
sudo python3 setup-2d-lime.py lime --apply
# DECO PON：専用の接続ファイルが届いた後
sudo python3 setup-2d-lime.py hub --apply
```

初回に素材を入れる場合だけ、LIME側で`--input /path/to/character.flimg`を追加できます。
`.flimg`、PSD/PSB、`.fl2d`を、通常ユーザーの権限で読み込んで作業用`.fl2d`へ変換します。
省略時は既存のC++コアのNew/Serialize APIで空の1920×1080プロジェクトを作ります。
テスト素材を製品の初期データには使いません。
すでに初期データや作業コピーがあるときは、`--input`による差し替えを拒否します。

GitHub CLIの認証が必要なら、通常アカウントで`gh auth login`を実行します。
rootでのGitHub認証や、GitHubのアカウントパスワードを使うGit操作は不要です。

## 配置されるもの

Linux CI run `42356734679`、ソース`d14d450dec2498603aa85db9f65864236bd4cba2`の
レビュー済み配布物だけを使います。PR #167のsquash merge後も同じ実装です。
tar SHA-256は`e72b07e8095f5f711dea170ae0a3a22bea0889a4db4cb834777915a69b6a369d`。
展開前にtarを検証し、展開後は同梱の全ファイル一覧と各チェックサムも照合します。

- 実行ファイル：`/srv/flamoris/apps/flamoris-2d-cli/releases/<source>/`
- 保持する配布物：同じアプリフォルダーの`packages/`
- 通常の空プロジェクトまたは指定素材のコピー：`state/initial.fl2d`
- サービスの作業プロジェクト・PNG・JOB記録：`state/workspace/`
- systemd：`flamoris2d-lime.service`、専用ユーザー`flamoris-2d`
- 非公開設定：`/etc/flamoris/flamoris2d-lime.env`

既存の作業データを削除しません。保存はMCPの`cli.project_save`で明示的に行います。
サービスは固定の作業フォルダーだけを書き込める設定で起動します。
このネイティブ配置をUpdater管理のDockerアプリとして重ねて導入しないでください。

Actions配布物の保存期間は3日です。導入時に保持したtarは引き続き使えます。
期限切れ等の場合は、同じチェックサムの配布物を`--archive /path/to/bundle.tar.gz`で指定できます。
別のビルドへ自動で差し替えることはありません。

## 専用接続と検証

既存Kachinco LIMEのWSS接続先から、同じ入口の`desktop/flamoris2d-lime`を導出します。
必要な場合は`--hub-endpoint`で明示できます。Kachincoのキーはコピーしません。
2D専用の接続キーを作り、サービス設定に保管します。

通常ユーザー所有・権限600の`~/flamoris2d-lime-connect.json`を、同じユーザーのSSHで
DECO PONへ転送します。SSHキーによる自動転送ができなければ、必要な`scp`コマンドを表示します。
このファイルには接続キーがあるので、中身をチャットに貼り付けたり公開しないでください。

DECO PON側は、インストール済みHub自身のPyYAMLで設定を出力・再読込し、全184ツールの
スキーマと数値型が変わらないことを検証してから配置します。
JSONで有効な `5e-324` をYAMLが文字列として読む問題を避け、数値制約は変更しません。
その後、インストール済みHub自身のスキーマで定義を検証してから、
専用の`flamoris2d-lime`／namespace `flamoris2d_lime`を追加します。
Windows版`flamoris2d`等の定義は変更しません。既存環境設定を保持・バックアップし、
専用キーを加えます。起動環境にまだキーがない場合は、現在のイメージIDとConfig/HostConfigを
引き継いだHubコンテナを作成して切り替えます。ホストネットワークのホスト名はホスト側から導出します。
既存の全環境変数、コマンド、ラベル、読み取り専用設定、マウント、権限、再起動方針を保持します。
コンテナ内の読み取り専用 `/app/.env` へは書き込みません。
切替失敗時は元のコンテナと設定へ戻します。元コンテナは成功後も停止状態・自動起動なしで名前を変えて保持し、
秘密情報を含むinspect記録はconfig配下の管理者限定バックアップへ保存します。
既存キーが起動環境にある場合は通常の再起動だけです。この間、既存クライアントは一時的に再接続します。
対象はローカルDockerのhostネットワーク／bindマウント構成です。共有名前空間やボリュームを
持つ異なる構成は変更前に停止します。Updaterの記録を変更せず、次回の更新では保持したruntime.envを使います。
成否が不明な編集要求を自動再送することはありません。

最後に公式MCPクライアントで全184ツールのスキーマを照合し、読み取り操作の
`flamoris2d_lime.mcp.context`だけを呼びます。`connected:true`は実際の応答を確認した結果です。
接続の再試行を最大4分待ちます。確認に成功した場合だけ、DECO PONへ転送した非公開ファイルを削除します。
起動失敗・再起動ループを検知した場合、または4分以内に検証が完了しない場合は、
配置前の設定と元コンテナへ自動で戻します。非公開ファイルは保持します。
原因を確認してから `hub --apply` を再実行できます。

## 検証の範囲

```bash
python3 -m unittest discover -s tests/deployment -v
FLAMORIS2D_TEST_ARCHIVE=/path/to/FLAMORIS-2D-linux-x64.tar.gz \
  python3 -m unittest discover -s tests/deployment -v
```

通常のテストは、専用URL、秘密情報の保持、効果注釈、配布物の検証、失敗時の復元、
公式クライアントの読み取り専用検証を確認します。
配布物指定時は、実際のレビュー済みC++コアで空プロジェクトを作り、CLIで再読込する試験も行います。
本番2台での管理者操作や接続が実施済み、という意味ではありません。

Docker受入れ試験は `FLAMORIS2D_TEST_DOCKER=1` で明示的に有効化します。
CIでは実際の読み取り専用コンテナを使い、既存設定とbindマウントを保持した環境変数追加を検証します。
