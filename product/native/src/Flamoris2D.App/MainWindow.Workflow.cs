using System.Windows;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private double _timelineHeight = 190;

    private void UpdateWorkflowPresentation()
    {
        var ready = _client?.HasAuthoritativeProjection == true;
        var hasParts = ready && _targets.Targets.Any(target => target.Kind == "part");
        var selectedPart = _targets.Selected?.Kind == "part";
        TargetPropertiesPanel.Visibility = hasParts && _targets.Selected is not null &&
            _editingContext is EditingContext.Source or EditingContext.Mesh or EditingContext.Rig or EditingContext.Deform
            ? Visibility.Visible : Visibility.Collapsed;
        MeshPropertiesPanel.Visibility = hasParts && selectedPart && _editingContext == EditingContext.Mesh
            && MeshCanvas.KeyformId is not null ? Visibility.Visible : Visibility.Collapsed;
        // Empty documents still allow advanced setup (groups, rigs, empty sequences).
        KeyStatePanel.Visibility = ready && (_editingContext is EditingContext.Source or EditingContext.Mesh or EditingContext.Deform)
            ? Visibility.Visible : Visibility.Collapsed;
        AuthoringPanel.Visibility = ready && (_editingContext is EditingContext.Rig or EditingContext.Deform or EditingContext.Animation or EditingContext.Export)
            ? Visibility.Visible : Visibility.Collapsed;
        if (!ready)
        {
            WorkflowHintText.Text = "編集エンジンに接続すると制作を始められます。接続が切れた場合は再起動してください。";
            return;
        }
        if (!hasParts)
        {
            WorkflowHintText.Text = "まず「素材を読み込む…」でPSD / Cutwork素材を読み込むか、「開く…」で制作を再開します。";
            return;
        }
        WorkflowHintText.Text = _editingContext switch
        {
            EditingContext.Source => "パーツの表示・重なり・配置を確認したら、右のパーツを選んで「メッシュ」へ進みます。",
            EditingContext.Mesh when !selectedPart => "右の一覧から画像のパーツを選びます。メッシュはパーツごとに作成・編集します。",
            EditingContext.Mesh when MeshCanvas.GeneratedPreview is not null => "生成結果はまだ保存されていません。形を確認して「プレビューを適用」で確定します。",
            EditingContext.Mesh when MeshCanvas.KeyformId is null => "「構造」→「生成」で格子または輪郭を試し、「プレビューを適用」でメッシュを作成します。",
            EditingContext.Mesh => "「構造」で点・辺・面を編集し、「位置決め」で画像上の頂点を動かします。ポーズの補正は「変形」で行います。",
            EditingContext.Rig => "骨・格子・ウェイトで動かす仕組みを作ります。必要な方法を上から選びます。",
            EditingContext.Deform => "パーツと原画を選び、頂点を動かして形を補正します。別のポーズや原画間の変化は右の「原画の状態」「遷移・パーツ対応」で編集します。",
            EditingContext.Animation => "シーケンスでカットの長さを決め、トラックに動きのキーを追加します。繰り返す動きは「クリップを作成・配置」を開きます。",
            EditingContext.Preview => "上の「表示する状態」でシーケンスまたは遷移を選び、「再生」で動きを確認します。",
            EditingContext.Export => "出力サイズ・FPS・空の保存先フォルダーを指定します。MP4も必要ならチェックを付けて書き出します。",
            _ => "制作する作業を上から選びます。",
        };
    }

    private void ResetLayout_Click(object sender, RoutedEventArgs e)
    {
        InspectorColumn.Width = new GridLength(320);
        TargetsRow.Height = new GridLength(1.05, GridUnitType.Star);
        PropertiesRow.Height = new GridLength(.95, GridUnitType.Star);
        _timelineHeight = 190;
        if (_editingContext == EditingContext.Animation) TimeSurfaceRow.Height = new GridLength(_timelineHeight);
        StatusText.Text = "パネルの幅と高さを初期状態に戻しました。";
    }
}
