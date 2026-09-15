using System.Globalization;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public sealed record ArtworkProjection(string Id, string NodeId, BitmapSource Bitmap,
    Affine2 World, bool Visible, bool Locked, double Left = 0, double Top = 0);

// WPF camera/input/overlay presentation. Evaluated pixels arrive from the shared native renderer.
public sealed partial class MeshViewport : FrameworkElement
{
    public ViewportCamera Camera { get; } = new();
    public IReadOnlyList<ArtworkProjection> Artwork { get; private set; } = Array.Empty<ArtworkProjection>();
    public string? DocumentToken { get; private set; }
    public long Revision { get; private set; } = -1;
    public string? NodeId { get; private set; }
    public string? KeyformId { get; private set; }
    public string[] VertexIds { get; private set; } = [];
    public double[] Positions { get; private set; } = [];
    public int[] Triangles { get; private set; } = [];
    public IReadOnlyDictionary<string, string> VertexLabels { get; private set; } = new Dictionary<string, string>();
    public HashSet<string> Selected { get; } = [];
    public bool MeshEnabled { get; set; }
    public bool DeformEnabled { get; set; }
    private double[]? _evaluatedPositions;
    private Affine2? _evaluatedWorld;
    private double[]? _formStartPositions;
    private double _frameWidth,_frameHeight;
    private JsonElement _authoringMeshes;
    private void UpdateEvaluatedMesh()
    {
        var mesh=_authoringMeshes.ValueKind==JsonValueKind.Array?_authoringMeshes.EnumerateArray().FirstOrDefault(m=>m.GetProperty("keyformId").GetString()==KeyformId&&m.GetProperty("nodeId").GetString()==NodeId):default;
        _evaluatedPositions=mesh.ValueKind==JsonValueKind.Object?Doubles(mesh.GetProperty("positions")):null;
        _evaluatedWorld=mesh.ValueKind==JsonValueKind.Object?Transform(mesh.GetProperty("worldTransform")):null;
    }
    public double[] DisplayedPositions => (DeformEnabled || RigEnabled && RigSubcontext=="Weight") && _evaluatedPositions is not null ? _evaluatedPositions : Positions;
    public event Action<Point2?>? FormPreviewChanged;
    public event Action<Point2,long>? FormMoveRequested;
    public bool Structure { get; set; } = true;
    public bool OverlayVisible { get; set; } = true;
    public bool ShowIds { get; set; }
    public bool HighContrast { get; set; } = true;
    public bool Snap { get; set; }
    public bool Busy { get; set; }
    public string Tool { get; set; } = "選択";
    public JsonElement? GeneratedPreview { get; set; }
    public BitmapSource? EvaluatedFrame { get; private set; }
    private HashSet<string> _representedNodes = [];
    private bool _showUnpreparedArtwork;
    public event Action<double[]?>? LayoutPreviewChanged;
    public void ApplyEvaluatedFrame(BitmapSource frame, HashSet<string> representedNodes, bool showUnpreparedArtwork,double documentWidth,double documentHeight,JsonElement meshes)
    {
        EvaluatedFrame = frame;_frameWidth=documentWidth;_frameHeight=documentHeight;_representedNodes = representedNodes;_showUnpreparedArtwork = showUnpreparedArtwork;
        _authoringMeshes=meshes;UpdateEvaluatedMesh();
        InvalidateVisual();
    }
    public void ClearEvaluatedFrame()
    { EvaluatedFrame = null;_authoringMeshes=default;_evaluatedPositions=null;_evaluatedWorld=null;_frameWidth=_frameHeight=0;_representedNodes.Clear(); InvalidateVisual(); }
    private LayoutGesture? _drag;
    private Point2? _pan;
    private (Point2 Point, int Vertex)? _click;
    private Affine2 World => (DeformEnabled || RigEnabled && RigSubcontext=="Weight") && _evaluatedWorld is { } evaluated ? evaluated : Artwork.FirstOrDefault(a => a.NodeId == NodeId)?.World ?? Affine2.Identity;
    private bool Pickable => World.IsInvertible && Artwork.Any(a => a.NodeId == NodeId && a.Visible && !a.Locked);
    public event Action<MeshEdit, long>? CommitRequested;
    public event Action<string>? TargetPicked;
    public event Action? SelectionChanged;

    public MeshViewport()
    {
        Focusable = true;
        ClipToBounds = true;
        LostMouseCapture += (_, _) => Cancel();
    }
    public void Apply(ProductHostResponse response, IReadOnlyList<ArtworkProjection> artwork, string? nodeId)
    {
        if (DocumentToken == response.DocumentToken && response.Revision < Revision)
            throw new StaleProjectionException(response.Revision ?? -1, Revision);
        var state = response.Payload.GetProperty("state");
        var keyform = state.ValueKind == JsonValueKind.Object ? state.GetProperty("activeKeyform") : default;
        var keyformId = keyform.ValueKind == JsonValueKind.Object ? keyform.GetProperty("id").GetString() : null;
        if (DocumentToken != response.DocumentToken || Revision != response.Revision || NodeId != nodeId || KeyformId != keyformId)
        { Cancel(); GeneratedPreview = null; }
        if (DocumentToken != response.DocumentToken || NodeId != nodeId || KeyformId != keyformId) Selected.Clear();
        DocumentToken = response.DocumentToken; Revision = response.Revision ?? -1;
        NodeId = nodeId; KeyformId = keyformId; Artwork = artwork;
        Positions = keyform.ValueKind == JsonValueKind.Object ? Doubles(keyform.GetProperty("positions")) : [];
        var topology = state.ValueKind == JsonValueKind.Object ? state.GetProperty("topology") : default;
        VertexIds = topology.ValueKind == JsonValueKind.Object
            ? topology.GetProperty("vertexIds").EnumerateArray().Select(v => v.GetString()!).ToArray() : [];
        Triangles = topology.ValueKind == JsonValueKind.Object
            ? topology.GetProperty("indices").EnumerateArray().Select(v => v.GetInt32()).ToArray() : [];
        VertexLabels = topology.ValueKind == JsonValueKind.Object && topology.TryGetProperty("vertexMetadata", out var metadata)
            ? metadata.EnumerateObject().ToDictionary(v => v.Name,
                v => v.Value.TryGetProperty("semanticLabel", out var label) ? label.GetString() ?? "" : "")
            : new Dictionary<string, string>();
        Selected.IntersectWith(VertexIds);
        UpdateEvaluatedMesh();
        SelectionChanged?.Invoke();
        InvalidateVisual();
    }
    public static double[] Doubles(JsonElement array) => array.EnumerateArray().Select(v => v.GetDouble()).ToArray();
    public static Affine2 Transform(JsonElement array)
    { var m = Doubles(array); return new(m[0], m[1], m[2], m[3], m[4], m[5]); }
    public void Clear()
    {
        Cancel(); DocumentToken = null; Revision = -1; NodeId = KeyformId = null;
        Artwork = Array.Empty<ArtworkProjection>(); Positions = []; VertexIds = []; Triangles = [];
        Selected.Clear(); VertexLabels = new Dictionary<string, string>(); GeneratedPreview = null; InvalidateVisual();
    }
    public void Fit()
    {
        var corners = Artwork.SelectMany(a => new[] { a.World.Apply(new(a.Left, a.Top)),
            a.World.Apply(new(a.Left+a.Bitmap.PixelWidth,a.Top)), a.World.Apply(new(a.Left,a.Top+a.Bitmap.PixelHeight)),
            a.World.Apply(new(a.Left+a.Bitmap.PixelWidth,a.Top+a.Bitmap.PixelHeight)) }).ToArray();
        var left = corners.Length > 0 ? Math.Min(0,corners.Min(p=>p.X)) : 0;
        var top = corners.Length > 0 ? Math.Min(0,corners.Min(p=>p.Y)) : 0;
        var width = Math.Max(_frameWidth, corners.Length > 0 ? corners.Max(p=>p.X) : 1920) - left;
        var height = Math.Max(_frameHeight, corners.Length > 0 ? corners.Max(p=>p.Y) : 1080) - top;
        Camera.Fit(ActualWidth, ActualHeight, width, height); Camera.Pan(-left*Camera.Scale,-top*Camera.Scale); InvalidateVisual();
    }
    public void Cancel()
    {
        CancelRig();
        var hadDrag = _drag is not null;
        _drag?.Cancel();
        _drag = null; _click = null; _pan = null;
        if (IsMouseCaptured) ReleaseMouseCapture();
        if (hadDrag) { LayoutPreviewChanged?.Invoke(null);FormPreviewChanged?.Invoke(null); }
        _formStartPositions=null;
        InvalidateVisual();
    }
    public void SelectAll()
    { Selected.UnionWith(VertexIds); SelectionChanged?.Invoke(); InvalidateVisual(); }
    private static Point2 PointOf(Point p) => new(p.X, p.Y);
    private Point2 Local(Point2 pointer) => World.Inverse(Camera.ToDocument(pointer));
    private Point Screen(double x, double y)
    { var p = Camera.ToView(World.Apply(new(x, y))); return new(p.X, p.Y); }

    protected override void OnRender(DrawingContext dc)
    {
        dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(39, 42, 48)), null, new Rect(RenderSize));
        dc.PushTransform(new MatrixTransform(Camera.Scale, 0, 0, Camera.Scale, Camera.Origin.X, Camera.Origin.Y));
        foreach (var art in Artwork.Where(a => a.Visible && (EvaluatedFrame is null || _showUnpreparedArtwork && !_representedNodes.Contains(a.NodeId))))
        {
            var w = art.World;
            dc.PushTransform(new MatrixTransform(w.A, w.B, w.C, w.D, w.X, w.Y));
            dc.DrawImage(art.Bitmap, new Rect(art.Left, art.Top, art.Bitmap.PixelWidth, art.Bitmap.PixelHeight));
            dc.Pop();
        }
        if (EvaluatedFrame is { } frame) dc.DrawImage(frame, new Rect(0,0,_frameWidth,_frameHeight));
        dc.Pop();
        if ((MeshEnabled || DeformEnabled) && OverlayVisible && Pickable)
        {
            var positions = _drag?.Preview ?? DisplayedPositions;
            DrawMesh(dc, positions, Triangles, Brushes.Cyan, VertexIds);
            if (GeneratedPreview is { } preview)
                DrawMesh(dc, Doubles(preview.GetProperty("positions")),
                    preview.GetProperty("indices").EnumerateArray().Select(v => v.GetInt32()).ToArray(), Brushes.Orange, []);
        }
        DrawRig(dc);
        if (Artwork.Count == 0)
        {
            var text = new FormattedText("「ファイル > 開く」からプロジェクトを選択",
                CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface("Yu Gothic UI"), 16,
                Brushes.LightGray, VisualTreeHelper.GetDpi(this).PixelsPerDip);
            dc.DrawText(text, new Point(24, 32));
        }
    }
    private void DrawMesh(DrawingContext dc, double[] positions, int[] triangles, Brush colour, string[] ids)
    {
        var edge = new Pen(colour, 1.25);
        var outline = new Pen(Brushes.Black, 3.5);
        for (var i = 0; i + 2 < triangles.Length; i += 3)
            for (var j = 0; j < 3; j++)
            {
                var a = triangles[i + j] * 2; var b = triangles[i + (j + 1) % 3] * 2;
                if (a + 1 >= positions.Length || b + 1 >= positions.Length) continue;
                var p = Screen(positions[a], positions[a + 1]); var q = Screen(positions[b], positions[b + 1]);
                if (HighContrast) dc.DrawLine(outline, p, q);
                dc.DrawLine(edge, p, q);
            }
        for (var i = 0; i < positions.Length / 2; i++)
        {
            var p = Screen(positions[i * 2], positions[i * 2 + 1]);
            var selected = i < ids.Length && Selected.Contains(ids[i]);
            dc.DrawEllipse(selected ? Brushes.Yellow : colour, new Pen(Brushes.Black, 1.5), p, selected ? 5.5 : 4, selected ? 5.5 : 4);
            if (ShowIds && i < ids.Length)
            {
                var label = new FormattedText(ids[i], CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
                    new Typeface("Consolas"), 11, Brushes.White, VisualTreeHelper.GetDpi(this).PixelsPerDip);
                dc.DrawRectangle(Brushes.Black, null, new Rect(p.X + 6, p.Y - 13, label.Width + 2, label.Height + 2));
                dc.DrawText(label, new Point(p.X + 7, p.Y - 12));
            }
        }
    }
    protected override void OnMouseWheel(MouseWheelEventArgs e)
    {
        if (_drag is not null || _click is not null) Cancel();
        Camera.Zoom(PointOf(e.GetPosition(this)), e.Delta > 0 ? 1.2 : 1 / 1.2);
        InvalidateVisual(); e.Handled = true;
    }
    protected override void OnMouseDown(MouseButtonEventArgs e)
    {
        Focus();
        var point = PointOf(e.GetPosition(this));
        if (e.ChangedButton == MouseButton.Middle || e.ChangedButton == MouseButton.Right ||
            (e.ChangedButton == MouseButton.Left && Keyboard.IsKeyDown(Key.Space)))
        { Cancel(); _pan = point; CaptureMouse(); e.Handled = true; return; }
        if (e.ChangedButton != MouseButton.Left || Busy) return;
        if (RigDown(point)) { e.Handled=true; return; }
        if (!MeshEnabled && !DeformEnabled)
        {
            foreach (var art in Artwork.Reverse().Where(a => a.Visible && !a.Locked && a.World.IsInvertible))
            {
                var p = art.World.Inverse(Camera.ToDocument(point));
                if (p.X >= art.Left && p.Y >= art.Top && p.X < art.Left + art.Bitmap.PixelWidth && p.Y < art.Top + art.Bitmap.PixelHeight)
                { TargetPicked?.Invoke(art.NodeId); break; }
            }
            return;
        }
        if (!Pickable || !OverlayVisible || DocumentToken is null) return;
        var hit = VertexPicking.Hit(DisplayedPositions, point, Camera, World);
        var additive = Keyboard.Modifiers.HasFlag(ModifierKeys.Shift) || Tool is "面を作成" or "辺を分割";
        if (hit >= 0)
        {
            if (!additive && !(Tool == "移動" && Selected.Contains(VertexIds[hit]))) Selected.Clear();
            if (additive && Selected.Contains(VertexIds[hit])) Selected.Remove(VertexIds[hit]);
            else Selected.Add(VertexIds[hit]);
        }
        else if (!additive && Tool != "頂点を追加") Selected.Clear();
        SelectionChanged?.Invoke();
        if ((!Structure || DeformEnabled) && Tool == "移動" && hit >= 0)
        {
            _formStartPositions=DeformEnabled?(double[])DisplayedPositions.Clone():null;
            _drag = new LayoutGesture(DocumentToken, Revision, DisplayedPositions,
                VertexIds.Select((id, index) => (id, index)).Where(p => Selected.Contains(p.id)).Select(p => p.index).ToArray(), Local(point));
        }
        else if (!DeformEnabled && Structure && (Tool == "頂点を追加" || Tool == "頂点を削除" && hit >= 0))
            _click = (Local(point), hit);
        if (_drag is not null || _click is not null) CaptureMouse();
        InvalidateVisual(); e.Handled = true;
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        var point = PointOf(e.GetPosition(this));
        if (_pan is { } start) { Camera.Pan(point.X - start.X, point.Y - start.Y); _pan = point; }
        else if (RigMove(point)) { e.Handled=true; return; }
        else if (_drag is not null) { _drag.Move(Local(point), Snap);if(DeformEnabled)FormPreviewChanged?.Invoke(FormDelta(_drag.Preview));else LayoutPreviewChanged?.Invoke(_drag.Preview); }
        else return;
        InvalidateVisual();
    }
    protected override void OnMouseUp(MouseButtonEventArgs e)
    {
        if (e.ChangedButton==MouseButton.Left && RigUp(PointOf(e.GetPosition(this)))) { e.Handled=true;return; }
        MeshEdit? edit = null;
        Point2? formDelta=null;
        var revision = Revision;
        if (_pan is null && e.ChangedButton == MouseButton.Left)
        {
            if (_drag is { } drag)
            {
                drag.Move(Local(PointOf(e.GetPosition(this))), Snap);
                if (drag.Finish(DocumentToken!, Revision) is { } positions) { if(DeformEnabled)formDelta=FormDelta(positions);else edit = MeshEdit.Move(positions); }
            }
            else if (_click is { } click)
            {
                var art = Artwork.First(a => a.NodeId == NodeId);
                if (Tool == "頂点を追加") edit = MeshEdit.Add(click.Point.X, click.Point.Y,
                    Math.Clamp((click.Point.X - art.Left) / art.Bitmap.PixelWidth, 0, 1), Math.Clamp((click.Point.Y - art.Top) / art.Bitmap.PixelHeight, 0, 1));
                else if (Tool == "頂点を削除" && click.Vertex >= 0) edit = MeshEdit.Remove(VertexIds[click.Vertex]);
            }
        }
        Cancel();
        if (edit is not null && Pickable && !Busy) CommitRequested?.Invoke(edit, revision);
        if (formDelta is { } delta && Pickable && !Busy) FormMoveRequested?.Invoke(delta,revision);
        e.Handled = true;
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Escape) { Cancel(); GeneratedPreview = null; InvalidateVisual(); e.Handled = true; }
        else if (e.Key == Key.A && Keyboard.Modifiers == ModifierKeys.Control && (MeshEnabled || DeformEnabled))
        { SelectAll(); e.Handled = true; }
    }
    private Point2? FormDelta(double[] positions)
    {
        var index=Array.FindIndex(VertexIds,id=>Selected.Contains(id));
        return index>=0&&_formStartPositions is { } start ? new(positions[index*2]-start[index*2],positions[index*2+1]-start[index*2+1]):null;
    }
}
