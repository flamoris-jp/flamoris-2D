namespace Flamoris.Flamoris2D.App;

public enum EditingContext
{
    Source,
    Mesh,
    Rig,
    Deform,
    Animation,
    Preview,
    Export,
}

public sealed record EditingContextDefinition(
    EditingContext Context,
    string JapaneseName,
    string EnglishName,
    string ClickMeaning,
    IReadOnlyList<string> Tools,
    bool ShowTimeSurface);

public static class EditingContextCatalog
{
    public static IReadOnlyList<EditingContextDefinition> All { get; } =
    [
        new(EditingContext.Source, "素材", "Source", "素材または配置対象を選択",
            ["選択", "素材配置"], false),
        new(EditingContext.Mesh, "メッシュ", "Mesh", "構造／位置決めと操作ツールを選択",
            ["選択", "頂点を追加", "頂点を削除", "面を作成", "辺を分割", "生成"], false),
        new(EditingContext.Rig, "リグ", "Rig", "Bone / Warp / Weight対象を選択",
            ["選択", "Bone", "Warp", "Weight"], false),
        new(EditingContext.Deform, "変形", "Deform", "既存topologyの変形対象を選択",
            ["選択", "変形", "補正"], false),
        new(EditingContext.Animation, "動き", "Animation", "keyまたは時間位置を選択",
            ["選択", "Key", "カーブ"], true),
        new(EditingContext.Preview, "プレビュー", "Preview", "camera viewの確認と再生",
            ["カメラ", "再生"], false),
        new(EditingContext.Export, "書き出し", "Export", "出力範囲とpresetを選択",
            ["範囲", "出力設定"], false),
    ];

    public static EditingContextDefinition Get(EditingContext context) =>
        All.Single(definition => definition.Context == context);
}
