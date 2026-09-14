using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

// Disposable UI projection and stable-ID selection only. Never serialized as a Project.
public sealed record TargetProjection(
    string Id, string DisplayName, string Kind, int Depth,
    bool Visible, bool EffectiveVisible, bool Locked)
{
    public string IndentedName => new string('　', Depth) + DisplayName;
    public string VisibilityText => Visible ? "表示" : "非表示";
    public string LockText => Locked ? "固定" : "編集可";
    public string KindText => Kind switch
    {
        "group" => "グループ", "part" => "パーツ", "bone" => "ボーン",
        "deformer" => "変形器", _ => Kind,
    };
    public string StateText => KindText + (EffectiveVisible ? "" : " · 画面では非表示") +
        (Locked ? " · ロック中" : "");
}

public sealed class TargetWorkspace
{
    public string? DocumentToken { get; private set; }
    public long Revision { get; private set; } = -1;
    public IReadOnlyList<TargetProjection> Targets { get; private set; } = Array.Empty<TargetProjection>();
    public string? SelectedId { get; private set; }
    public TargetProjection? Selected => Targets.FirstOrDefault(target => target.Id == SelectedId);

    public void Attach(string documentToken)
    {
        Invalidate();
        DocumentToken = documentToken;
    }

    public void Apply(string documentToken, long revision, JsonElement tree)
    {
        if (documentToken != DocumentToken || revision < Revision)
            throw new StaleProjectionException(revision, Revision);
        var targets = Flatten(tree).ToArray();
        Targets = Array.AsReadOnly(targets);
        Revision = revision;
        // A hidden/locked target is still a selected editing target.
        if (!targets.Any(target => target.Id == SelectedId)) SelectedId = targets.FirstOrDefault()?.Id;
    }

    public void Select(string? nodeId)
    {
        if (nodeId is not null && !Targets.Any(target => target.Id == nodeId))
            throw new ArgumentException("Target is not part of the current projection.", nameof(nodeId));
        SelectedId = nodeId;
    }

    public void Invalidate()
    {
        DocumentToken = null;
        Revision = -1;
        Targets = Array.Empty<TargetProjection>();
        SelectedId = null;
    }

    private static IEnumerable<TargetProjection> Flatten(JsonElement node, int depth = 0)
    {
        yield return new TargetProjection(
            node.GetProperty("id").GetString()!, node.GetProperty("displayName").GetString()!,
            node.GetProperty("kind").GetString()!, depth,
            node.GetProperty("visible").GetBoolean(), node.GetProperty("effectiveVisible").GetBoolean(),
            node.GetProperty("locked").GetBoolean());
        foreach (var child in node.GetProperty("children").EnumerateArray())
            foreach (var target in Flatten(child, depth + 1)) yield return target;
    }
}
