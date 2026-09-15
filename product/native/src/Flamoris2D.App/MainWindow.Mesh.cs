using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private bool _meshReady, _loadingArtwork, _meshBusy, _hasHandsOn, _updatingMeshChoices;
    private string? _textureToken;
    private readonly Dictionary<string, BitmapSource> _textures = [];
    private readonly Dictionary<string, string> _meshChoices = [];
    private string _structureTool = "選択", _layoutTool = "移動";
    private CancellationTokenSource? _meshWork;
    private long _generatedRevision = -1;
    private long _vertexLabelRevision = -1;
    private string? _labelVertexId;
    private string _labelProjectionText = "";
    private sealed record MeshChoice(string Id, string Label);

    private void InitializeMeshUi()
    {
        _meshReady = true;
        MeshCanvas.CommitRequested += async (edit, revision) => await CommitMeshAsync(edit, revision);
        MeshCanvas.SelectionChanged += UpdateMeshProperties;
        MeshCanvas.TargetPicked += id => {
            if (_loadingArtwork || _meshBusy) return;
            TargetList.SelectedItem = _targets.Targets.FirstOrDefault(t => t.Id == id);
        };
    }
    private bool ConfirmDiscardHandsOn() => !_hasHandsOn || !_autoConnect ||
        MessageBox.Show(this, "Mesh体験の編集内容は保存されません。破棄して続けますか？",
            "保存不可の体験セッション", MessageBoxButton.OKCancel, MessageBoxImage.Warning) == MessageBoxResult.OK;

    private async void LoadArtwork_Click(object sender, RoutedEventArgs e)
    {
        if (!await ConfirmReplaceDocumentAsync()) return;
        var dialog = new OpenFileDialog { Filter = "PNG artwork (*.png)|*.png", Multiselect = true,
            Title = "Mesh体験用PNGを選択 — 保存されません（複数可）" };
        if (dialog.ShowDialog(this) != true) return;
        if (_client?.HasAuthoritativeProjection != true) await ConnectHostAsync(true);
        if (_client?.HasAuthoritativeProjection != true) return;
        var client = _client;
        var token = client.DocumentToken!;
        var revision = client.Revision;
        var handles = new List<string>();
        _loadingArtwork = true;
        _meshWork = new CancellationTokenSource();
        var cancellation = _meshWork.Token;
        CancelArtworkButton.Visibility = Visibility.Visible;
        CancelArtworkButton.IsEnabled = true;
        SetMeshBusy(true);
        try
        {
            var paths = dialog.FileNames;
            if (paths.Length > 16) throw new InvalidDataException("一度に選べるPNGは16枚までです。");
            var sizes = paths.Select(ArtworkLoader.InspectPng).ToArray();
            if (sizes.Sum(s => (long)s.Width * s.Height * 4) > 64 * 1024 * 1024)
                throw new InvalidDataException("PNG展開後の合計は64 MiB以下にしてください。");
            for (var i = 0; i < paths.Length; i++)
            {
                StatusText.Text = $"PNGを読み込み中 {i + 1}/{paths.Length} — 中止できます";
                var path = paths[i]; var size = sizes[i];
                var bytes = await Task.Run(() => ArtworkLoader.DecodePng(path, size.Width, size.Height, cancellation), cancellation);
                handles.Add(await client.UploadRasterAsync(size.Width, size.Height,
                    Path.GetFileNameWithoutExtension(path), bytes, cancellation));
            }
            client.AssertCurrent(token, revision);
            cancellation.ThrowIfCancellationRequested();
            // Once replacement is submitted, await its acknowledgement (do not leave an ambiguous live token).
            CancelArtworkButton.IsEnabled = false;
            await client.OpenHandsOnAsync(handles.ToArray());
            _hasHandsOn = true;
            AttachDocumentWorkspace(client.DocumentToken!);
            await RefreshProjectionAsync();
            var part = _targets.Targets.FirstOrDefault(t => t.Kind == "part");
            TargetList.SelectedItem = part;
            await RefreshProjectionAsync();
            SwitchContext(EditingContext.Mesh, returnFocus: false);
            MeshCanvas.Fit();
            StatusText.Text = "Mesh体験（保存不可）— パーツと構造／位置決めを選択。ホイール拡縮・右ドラッグ移動。";
        }
        catch (OperationCanceledException) { StatusText.Text = "読み込みを中止しました。元のセッションは維持しています。"; }
        catch (Exception error) { StatusText.Text = $"素材を読み込めませんでした: {error.Message}"; }
        finally
        {
            foreach (var id in handles) await client.ReleaseRasterAsync(id, token, revision);
            _meshWork?.Dispose(); _meshWork = null;
            _loadingArtwork = false; CancelArtworkButton.Visibility = Visibility.Collapsed;
            SetMeshBusy(false);
        }
    }

    private async Task RefreshMeshAsync(ProductHostClient client)
    {
        if (!_meshReady || !client.HasAuthoritativeProjection) return;
        var token = client.DocumentToken!;
        var nodeId = _targets.SelectedId;
        _meshChoices.TryGetValue(nodeId ?? "", out var keyformId);
        var response = await client.GetMeshAsync(nodeId, keyformId);
        client.AssertCurrent(token, response.Revision!.Value);
        if (!ReferenceEquals(client, _client) || _targets.SelectedId != nodeId || _targets.Revision != response.Revision) return;
        if (_textureToken != token) { _textures.Clear(); _meshChoices.Clear(); _textureToken = token; }
        var artwork = new List<ArtworkProjection>();
        foreach (var a in response.Payload.GetProperty("artwork").EnumerateArray())
        {
            var id = a.GetProperty("id").GetString()!;
            if (!_textures.TryGetValue(id, out var bitmap))
            {
                var width = a.GetProperty("width").GetInt32(); var height = a.GetProperty("height").GetInt32();
                var bytes = await client.DownloadRasterAsync(id, a.GetProperty("byteLength").GetInt32(), token, response.Revision.Value);
                bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgra32, null, bytes, width * 4);
                bitmap.Freeze(); _textures[id] = bitmap;
            }
            artwork.Add(new(id, a.GetProperty("nodeId").GetString()!, bitmap,
                MeshViewport.Transform(a.GetProperty("worldTransform")), a.GetProperty("visible").GetBoolean(),
                a.GetProperty("locked").GetBoolean(),
                a.TryGetProperty("left", out var left) ? left.GetDouble() : 0, a.TryGetProperty("top", out var top) ? top.GetDouble() : 0));
        }
        client.AssertCurrent(token, response.Revision.Value);
        if (!ReferenceEquals(client, _client) || _targets.SelectedId != nodeId) return;
        MeshCanvas.Apply(response, artwork, nodeId);
        if (MeshCanvas.GeneratedPreview is null) ApplyGeneratedButton.IsEnabled = false;
        _updatingMeshChoices = true;
        try
        {
            var state = response.Payload.GetProperty("state");
            var choices = new List<MeshChoice>();
            if (state.ValueKind == JsonValueKind.Object)
            {
                var keyArt = state.GetProperty("keyArt");
                var label = keyArt.ValueKind == JsonValueKind.Object ? keyArt.GetProperty("displayName").GetString() : "素材状態";
                foreach (var k in state.GetProperty("keyforms").EnumerateArray())
                    choices.Add(new(k.GetProperty("id").GetString()!, $"{label} · メッシュ {choices.Count + 1}"));
            }
            MeshKeyformList.ItemsSource = choices;
            MeshKeyformList.SelectedItem = choices.FirstOrDefault(c => c.Id == MeshCanvas.KeyformId);
        }
        finally { _updatingMeshChoices = false; }
        UpdateMeshProperties();
    }
    private void ClearMeshProjection()
    {
        if (!_meshReady) return;
        MeshCanvas.Clear(); _textures.Clear(); _textureToken = null; _meshChoices.Clear();
        _labelVertexId = null; _vertexLabelRevision = -1; _labelProjectionText = ""; VertexLabelEditor.Text = "";
        ApplyGeneratedButton.IsEnabled = false; _generatedRevision = -1;
    }
    private void AttachDocumentWorkspace(string token)
    {
        ClearProjection();
        _targets.Attach(token);
    }
    private void ConfigureMeshContext()
    {
        if (!_meshReady) return;
        MeshCanvas.Cancel(); CancelGenerated();
        var mesh = _editingContext == EditingContext.Mesh;
        MeshCanvas.MeshEnabled = mesh;
        MeshOptions.Visibility = MeshPropertiesPanel.Visibility = mesh ? Visibility.Visible : Visibility.Collapsed;
        if (mesh)
        {
            string[] tools = MeshCanvas.Structure
                ? ["選択", "頂点を追加", "頂点を削除", "面を作成", "辺を分割", "生成"] : ["選択", "移動"];
            ToolList.ItemsSource = tools;
            ToolList.SelectedItem = MeshCanvas.Structure ? _structureTool : _layoutTool;
        }
        SetMeshTool(); MeshCanvas.InvalidateVisual();
    }
    private void SetMeshTool()
    {
        if (!_meshReady) return;
        MeshCanvas.Cancel();
        var mesh = _editingContext == EditingContext.Mesh;
        if (mesh && ToolList.SelectedItem is string tool)
        {
            if (MeshCanvas.Tool != tool) { CancelGenerated(); if (!_loadingArtwork) _meshWork?.Cancel(); }
            MeshCanvas.Tool = tool;
            if (MeshCanvas.Structure) _structureTool = tool; else _layoutTool = tool;
            var mode = MeshCanvas.Structure ? "構造" : "位置決め";
            ActiveContextBadge.Text = $"メッシュ / {mode}";
            ViewportContextText.Text = $"メッシュ / {mode} — {tool}（参照Artwork）";
            var hint = tool switch { "移動" => "頂点をドラッグ。Shiftで複数選択、Escで取消",
                "頂点を追加" => "Artwork上をクリックして頂点を追加", "頂点を削除" => "頂点をクリックして削除",
                "面を作成" => "3頂点を選択して上の作成ボタン", "辺を分割" => "辺の両端2頂点を選択して上の分割ボタン",
                "生成" => "上でGrid／輪郭を試して、プレビューを明示的に適用", _ => "頂点を選択。Shiftで追加／解除" };
            ActiveToolSettingsText.Text = $"{tool} — {hint}";
            ClickMeaningText.Text = hint + " · ホイール拡縮 / 右ドラッグ移動";
        }
        GenerateOptions.Visibility = mesh && MeshCanvas.Structure && MeshCanvas.Tool == "生成" ? Visibility.Visible : Visibility.Collapsed;
        MeshActionButton.Visibility = mesh && MeshCanvas.Structure && MeshCanvas.Tool is "面を作成" or "辺を分割"
            ? Visibility.Visible : Visibility.Collapsed;
        MeshActionButton.Content = MeshCanvas.Tool == "辺を分割" ? "選択した辺を分割" : "選択した3頂点で面を作成";
        UpdateMeshProperties();
    }
    private void MeshContext_Click(object sender, RoutedEventArgs e)
    {
        MeshCanvas.Structure = (sender as FrameworkElement)?.Tag?.ToString() == "structure";
        StructureButton.IsChecked = MeshCanvas.Structure; LayoutButton.IsChecked = !MeshCanvas.Structure;
        ConfigureMeshContext(); MeshCanvas.Focus();
    }
    private async void MeshKeyform_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (_updatingMeshChoices || MeshKeyformList.SelectedItem is not MeshChoice choice || _targets.SelectedId is not { } nodeId) return;
        _meshChoices[nodeId] = choice.Id; MeshCanvas.Cancel(); CancelGenerated();
        try { await RefreshProjectionAsync(); } catch (Exception error) { StatusText.Text = error.Message; }
    }
    private void MeshDisplay_Changed(object sender, RoutedEventArgs e)
    {
        MeshCanvas.Cancel(); MeshCanvas.OverlayVisible = MeshOverlayCheck.IsChecked == true;
        MeshCanvas.HighContrast = MeshContrastCheck.IsChecked == true;
        MeshCanvas.ShowIds = MeshIdsCheck.IsChecked == true; MeshCanvas.Snap = MeshSnapCheck.IsChecked == true;
        MeshCanvas.InvalidateVisual();
    }
    private void UpdateMeshProperties()
    {
        if (!_meshReady) return;
        MeshPropertiesText.Text = $"{MeshCanvas.VertexIds.Length} 頂点 / {MeshCanvas.Triangles.Length / 3} 面\n選択: {string.Join(", ", MeshCanvas.Selected)}";
        if (MeshCanvas.Selected.Count == 1)
        {
            var id = MeshCanvas.Selected.Single();
            var index = Array.IndexOf(MeshCanvas.VertexIds, id);
            if (index >= 0) MeshPropertiesText.Text += $"\n位置: {MeshCanvas.Positions[index * 2]:0.##}, {MeshCanvas.Positions[index * 2 + 1]:0.##}";
            if (_labelVertexId != id || VertexLabelEditor.Text == _labelProjectionText)
            {
                _labelVertexId = id; _vertexLabelRevision = MeshCanvas.Revision;
                _labelProjectionText = MeshCanvas.VertexLabels.GetValueOrDefault(id) ?? "";
                VertexLabelEditor.Text = _labelProjectionText;
            }
        }
        else { _labelVertexId = null; _vertexLabelRevision = -1; VertexLabelEditor.Text = _labelProjectionText = ""; }
        var labelEnabled = MeshCanvas.MeshEnabled && MeshCanvas.Structure && MeshCanvas.Selected.Count == 1 && !_meshBusy;
        VertexLabelButton.IsEnabled = ClearVertexLabelButton.IsEnabled = labelEnabled;
        MeshActionButton.IsEnabled = !_meshBusy && MeshCanvas.Selected.Count == (MeshCanvas.Tool == "辺を分割" ? 2 : 3);
    }
    private void SetMeshBusy(bool busy)
    {
        _meshBusy = busy; MeshCanvas.Busy = busy;
        TargetList.IsEnabled = !busy && _client?.HasAuthoritativeProjection == true;
        MeshOptions.IsEnabled = !busy;
        UpdateMeshProperties();
    }
    private async Task CommitMeshAsync(MeshEdit edit, long revision)
    {
        if (_meshBusy || _client is null || MeshCanvas.NodeId is not { } nodeId) return;
        var client = _client; var token = MeshCanvas.DocumentToken!; var keyformId = MeshCanvas.KeyformId;
        var previousIds = MeshCanvas.VertexIds.ToHashSet();
        SetMeshBusy(true); CancelGenerated();
        try
        {
            client.AssertCurrent(token, revision);
            await client.EditMeshAsync(nodeId, keyformId, edit, revision);
            await RefreshProjectionAsync();
            var added = MeshCanvas.VertexIds.Where(id => !previousIds.Contains(id)).ToArray();
            if (MeshCanvas.NodeId == nodeId && added.Length == 1 && MeshCanvas.VertexIds.Length == previousIds.Count + 1)
            {
                MeshCanvas.Selected.Clear(); MeshCanvas.Selected.Add(added[0]);
                UpdateMeshProperties(); MeshCanvas.InvalidateVisual();
            }
            StatusText.Text = "メッシュ操作を確定しました。Ctrl+Zでこの操作を戻せます（保存不可）。";
        }
        catch (Exception error)
        {
            StatusText.Text = $"メッシュを変更できませんでした: {error.Message}";
            try { await RefreshProjectionAsync(); } catch { /* Authority-loss surface owns failures. */ }
        }
        finally { SetMeshBusy(false); MeshCanvas.Focus(); }
    }
    private async void MeshAction_Click(object sender, RoutedEventArgs e) =>
        await CommitMeshAsync(MeshCanvas.Tool == "辺を分割" ? MeshEdit.Subdivide(MeshCanvas.Selected.ToArray()) :
            MeshEdit.Triangle(MeshCanvas.Selected.ToArray()), MeshCanvas.Revision);
    private async void SetVertexLabel_Click(object sender, RoutedEventArgs e)
    {
        if (_labelVertexId is not { } id) return;
        await CommitMeshAsync(MeshEdit.Label(id, VertexLabelEditor.Text.Trim()), _vertexLabelRevision);
        _labelVertexId = null; UpdateMeshProperties();
    }
    private async void ClearVertexLabel_Click(object sender, RoutedEventArgs e)
    {
        if (_labelVertexId is not { } id) return;
        await CommitMeshAsync(MeshEdit.ClearLabel(id), _vertexLabelRevision);
        _labelVertexId = null; UpdateMeshProperties();
    }
    private void FitArtwork_Click(object sender, RoutedEventArgs e) => MeshCanvas.Fit();
    private void SelectAllVertices_Click(object sender, RoutedEventArgs e) => MeshCanvas.SelectAll();
    private void CancelMeshWork_Click(object sender, RoutedEventArgs e) { _meshWork?.Cancel(); MeshCanvas.Cancel(); CancelGenerated(); }
    private void CancelGenerated() { if (!_meshReady) return; MeshCanvas.GeneratedPreview = null; _generatedRevision = -1; ApplyGeneratedButton.IsEnabled = false; MeshCanvas.InvalidateVisual(); }
    private void CancelGenerated_Click(object sender, RoutedEventArgs e) => CancelGenerated();
    private void MeshGenerationSettings_Changed(object sender, TextChangedEventArgs e) => CancelGenerated();
    private async void GridPreview_Click(object sender, RoutedEventArgs e) => await GeneratePreviewAsync(false);
    private async void ContourPreview_Click(object sender, RoutedEventArgs e) => await GeneratePreviewAsync(true);
    private static double Fraction(TextBox box) => double.TryParse(box.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var x) && x >= 0 && x <= 1
        ? x : throw new ArgumentException("輪郭の設定は0〜1の数値にしてください。");
    private static int GridSize(TextBox box) => int.TryParse(box.Text, out var x) && x >= 1 && x <= 32
        ? x : throw new ArgumentException("Gridの分割数は1〜32にしてください。");
    private async Task GeneratePreviewAsync(bool contour)
    {
        if (_meshBusy || _client is null || MeshCanvas.NodeId is not { } nodeId) return;
        var client = _client; var token = MeshCanvas.DocumentToken!; var revision = MeshCanvas.Revision;
        _meshWork = new CancellationTokenSource(); SetMeshBusy(true); CancelGenerated();
        CancelArtworkButton.Visibility = Visibility.Visible;
        CancelArtworkButton.IsEnabled = true;
        try
        {
            client.AssertCurrent(token, revision);
            var result = await client.GenerateMeshAsync(nodeId, contour, GridSize(GridColumns), GridSize(GridRows),
                Fraction(ContourAlpha), Fraction(ContourDensity), Fraction(ContourCorner), Fraction(ContourInterior), revision, _meshWork.Token);
            client.AssertCurrent(token, revision);
            if (_targets.SelectedId != nodeId || !MeshCanvas.Structure || _editingContext != EditingContext.Mesh) return;
            var candidate = result.Payload.GetProperty("candidate");
            if (candidate.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("輪郭を作成できません: " + result.Payload.GetProperty("diagnostics"));
            MeshCanvas.GeneratedPreview = candidate.Clone(); _generatedRevision = revision;
            ApplyGeneratedButton.IsEnabled = true; MeshCanvas.InvalidateVisual();
            StatusText.Text = "橙色は生成プレビューです。まだ履歴には入りません。適用または取消を選択してください。";
        }
        catch (OperationCanceledException) { StatusText.Text = "生成プレビューを中止しました。メッシュは変更していません。"; }
        catch (Exception error) { StatusText.Text = $"生成できませんでした: {error.Message}"; }
        finally { _meshWork?.Dispose(); _meshWork = null; CancelArtworkButton.Visibility = Visibility.Collapsed; SetMeshBusy(false); }
    }
    private async void ApplyGenerated_Click(object sender, RoutedEventArgs e)
    {
        if (MeshCanvas.GeneratedPreview is not { } candidate) return;
        if (MessageBox.Show(this, "現在のメッシュを生成結果で置き換えます。適用しますか？（元に戻せます）",
            "メッシュ生成", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
        await CommitMeshAsync(MeshEdit.Generated(candidate, true), _generatedRevision);
    }
}
