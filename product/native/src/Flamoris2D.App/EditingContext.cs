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

public static class AuthoringLabels
{
    public static string Track(string? kind)=>kind switch
    {
        "TransformTrack"=>"配置","BoneTrack"=>"骨のポーズ","DeformerTrack"=>"格子の制御点","MeshDeformationTrack"=>"メッシュ変形",
        "OpacityTrack"=>"不透明度","PresenceTrack"=>"表示状態","DrawOrderTrack"=>"重ね順","ClippingTrack"=>"クリッピング",
        "CameraTrack"=>"カメラ","GeometryBlendTrack"=>"形状の補間","AppearanceTrack"=>"画像の混合",_=>kind??"トラック",
    };
    public static string Rig(string kind) => kind switch
    {
        "Bone" => "骨", "Warp" => "格子", "Weight" => "ウェイト", _ => kind,
    };
    public static string Interpolation(string kind) => kind switch
    {
        "step" => "段階的に切り替え", "linear" => "一定の速さ",
        "ease-in" => "ゆっくり始める", "ease-out" => "ゆっくり止める",
        "ease-in-out" => "始めと終わりを滑らかに", "bezier" => "曲線を指定（Bezier）", _ => kind,
    };
    public static string Channel(string kind)=>kind switch
    {
        "x" or "positionX"=>"位置 X","y" or "positionY"=>"位置 Y","rotation"=>"回転","scaleX"=>"拡大率 X","scaleY"=>"拡大率 Y","scale"=>"拡大率",
        "deltaX"=>"変位 X","deltaY"=>"変位 Y","deformation"=>"変形","geometryWeight"=>"形状の混ざり方","appearance"=>"画像の混ざり方",
        "opacity"=>"不透明度","presence"=>"表示状態","drawOrder"=>"重ね順","clipping"=>"クリッピング元",_=>kind,
    };
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
            ["選択"], false),
        new(EditingContext.Mesh, "メッシュ", "Mesh", "構造／位置決めと操作ツールを選択",
            ["選択", "頂点を追加", "頂点を削除", "面を作成", "辺を分割", "生成"], false),
        new(EditingContext.Rig, "リグ", "Rig", "骨・格子・ウェイトを選んで動かす仕組みを作成",
            ["選択", "移動", "追加", "削除"], false),
        new(EditingContext.Deform, "変形", "Deform", "骨や格子で動かした後の形を補正",
            ["選択・変形"], false),
        new(EditingContext.Animation, "動き", "Animation", "キーやクリップを選んで動きのタイミングを編集",
            ["キー・クリップを選択して移動"], true),
        new(EditingContext.Preview, "プレビュー", "Preview", "完成する画面を確認して再生",
            ["表示"], false),
        new(EditingContext.Export, "書き出し", "Export", "出力サイズ・形式・保存先を指定",
            ["出力設定"], false),
    ];

    public static EditingContextDefinition Get(EditingContext context) =>
        All.Single(definition => definition.Context == context);
}
