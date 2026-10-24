# FLAMORIS 2D AI guide

AIが実際の作品を観測し、通常のProduct Query / Commandで編集するときの制作メモ。

- [2026-10-24: Cutworkからの引き継ぎ、まばたきのメッシュ、二重の切り分け、呼吸](2026-10-24-blink-and-breath.md)
- [Nativeの通常制作手順](../native-production-workflow.md)
- [現在の機能と実装の所在](../native-capability-map.md)
- [CutworkのAI guide](https://github.com/flamoris-jp/flamoris-cutwork/blob/main/docs/ai-guide/README.md)

## 読み方

人間の意図、観測した事実、原因の推定、試した操作、結果、未確認事項を分けて記録する。
このguideは実作業の知識であり、Product契約は実装・設計文書・現在のツール宣言を確認する。

次の作業ではlive contextから文書、寸法、権限、revision、対象のstable IDを取り直す。
メモの値や点数を別作品へそのまま適用しない。画像座標と画面座標を混同しない。
作品画像・録画・注釈・個別の保存先・認証情報を公開メモへ添付しない。

コマンド成功、幾何学的な正常、見た目の改善、人間の再生評価、保存・再読込は別々に確認する。
AIが見ていない再生や、人間が確認していない箇所を合格扱いしない。
