using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Flamoris.Flamoris2D.ProductHost;
using Flamoris.Flamoris2D.Rendering;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private sealed record RenderChoice(string Id, string Kind, string Label);
    private readonly Dictionary<string, RenderTexture> _renderTextures = [];
    private Direct3DRenderer? _renderer;
    private RenderChoice? _renderChoice;
    private bool _updatingRenderChoices;
    private long _renderGeneration, _layoutInputGeneration;
    private readonly object _rendererGate = new();
    private string? _lastRenderKey;
    private long _timeTicks;
    private CancellationTokenSource? _renderWork;
    private LayoutRenderPreview? _pendingLayoutPreview;
    private RigRenderPreview? _pendingRigPreview;
    private bool _layoutRenderRunning;

    private void InitializeRenderUi()
    {
        MeshCanvas.FormPreviewChanged += delta =>
        {
            _pendingRigPreview = delta is { } d ? new(CurrentRigContext(),RigEdit.FormMove(MeshCanvas.Selected.ToArray(),d.X,d.Y)) : null;
            Interlocked.Increment(ref _layoutInputGeneration);Interlocked.Increment(ref _renderGeneration);_renderWork?.Cancel();
            if(!_layoutRenderRunning)_=DrainLayoutPreviewAsync();
        };
        MeshCanvas.LayoutPreviewChanged += positions =>
        {
            _pendingLayoutPreview = positions is null || MeshCanvas.KeyformId is null ? null : new(MeshCanvas.KeyformId, positions);
            Interlocked.Increment(ref _layoutInputGeneration);
            Interlocked.Increment(ref _renderGeneration);
            _renderWork?.Cancel();
            if (!_layoutRenderRunning) _ = DrainLayoutPreviewAsync();
        };
    }
    private async Task DrainLayoutPreviewAsync()
    {
        _layoutRenderRunning = true;
        try
        {
            while (!_disposed)
            {
                var generation = _layoutInputGeneration;
                if (_client?.HasAuthoritativeProjection == true)
                    await RefreshEvaluatedFrameAsync(_client, _pendingLayoutPreview, _pendingRigPreview);
                if (generation == _layoutInputGeneration) break;
            }
        }
        catch (Exception error) { StatusText.Text = $"描画できませんでした: {error.Message}"; }
        finally { _layoutRenderRunning = false; }
    }
    private void UpdateRenderChoices(JsonElement workspace)
    {
        var choices = new List<RenderChoice>();
        foreach (var (field, kind, label) in new[] { ("keyArts","keyArt","原画"), ("transitions","transition","遷移"), ("sequences","sequence","シーケンス") })
            foreach (var item in workspace.GetProperty(field).EnumerateArray())
                choices.Add(new(item.GetProperty("id").GetString()!, kind,
                    $"{label} · {item.GetProperty("displayName").GetString()}"));
        var selected = choices.FirstOrDefault(c => c.Id == _renderChoice?.Id && c.Kind == _renderChoice.Kind) ?? choices.FirstOrDefault();
        _updatingRenderChoices = true;
        try { RenderOwnerList.ItemsSource = choices; RenderOwnerList.SelectedItem = selected; _renderChoice = selected; }
        finally { _updatingRenderChoices = false; }
    }
    private async void RenderOwner_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (_updatingRenderChoices) return;
        StopPlayback();
        _renderChoice = RenderOwnerList.SelectedItem as RenderChoice; _timeTicks = 0;
        _timelineContext = new(); _contextDraft = false;
        _meshChoices.Clear();
        MeshCanvas.Cancel(); _lastRenderKey = null;
        try { await RefreshProjectionAsync(); } catch (Exception error) { StatusText.Text = error.Message; }
    }
    private void ClearRenderProjection()
    {
        Interlocked.Increment(ref _renderGeneration); _renderWork?.Cancel();
        _pendingLayoutPreview = null; _pendingRigPreview=null; _renderTextures.Clear(); _lastRenderKey = null; _renderChoice = null;
        MeshCanvas.ClearEvaluatedFrame();
    }
    private async Task RefreshEvaluatedFrameAsync(ProductHostClient client, LayoutRenderPreview? preview = null, RigRenderPreview? rigPreview = null)
    {
        if (_renderChoice is not { } choice || !client.HasAuthoritativeProjection) { MeshCanvas.ClearEvaluatedFrame(); return; }
        if ((preview is not null || rigPreview is not null) && choice.Kind != "keyArt") return;
        var token = client.DocumentToken!; var revision = client.Revision;
        var key = $"{token}/{revision}/{choice.Kind}/{choice.Id}/{_timeTicks}/{_editingContext}";
        if (preview is null && rigPreview is null && _lastRenderKey == key && _pendingLayoutPreview is null && _pendingRigPreview is null) return;
        var generation = Interlocked.Increment(ref _renderGeneration);
        _renderWork?.Cancel(); var work = new CancellationTokenSource(); _renderWork = work;
        try
        {
            var frame = await client.ProjectRenderAsync(choice.Kind == "keyArt" ? choice.Id : null,
                choice.Kind == "transition" ? choice.Id : null, choice.Kind == "sequence" ? choice.Id : null,
                _timeTicks, work.Token, preview, revision, preview is null && rigPreview is null ? _playbackSample : null, rigPreview);
            var artwork = new Dictionary<string, RenderTexture>();
            foreach (var a in frame.Payload.GetProperty("artwork").EnumerateArray())
            {
                var id = a.GetProperty("id").GetString()!;
                if (!_renderTextures.TryGetValue(id, out var texture))
                {
                    var bytes = await client.DownloadRasterAsync(id, a.GetProperty("byteLength").GetInt32(), token, revision, work.Token);
                    texture = new(a.GetProperty("width").GetInt32(), a.GetProperty("height").GetInt32(), bytes);
                    _renderTextures[id] = texture;
                }
                artwork.Add(a.GetProperty("nodeId").GetString()!, texture);
            }
            var canvas = frame.Payload.GetProperty("canvas");
            var width = canvas.GetProperty("width").GetInt32(); var height = canvas.GetProperty("height").GetInt32();
            var documentWidth=width;var documentHeight=height;
            var scale=Math.Min(1,2048d/Math.Max(width,height));width=Math.Max(1,(int)Math.Ceiling(width*scale));height=Math.Max(1,(int)Math.Ceiling(height*scale));
            var mapped=scale==1?frame.Payload:RenderView.Map(frame.Payload,(double)width/documentWidth,(double)height/documentHeight);
            var clock = Stopwatch.StartNew();
            var pixels = await Task.Run(() =>
            {
                lock (_rendererGate)
                {
                    work.Token.ThrowIfCancellationRequested();
                    if (_renderer is null)
                    {
                    try { _renderer = new Direct3DRenderer(); }
                    catch { _renderer = new Direct3DRenderer(software: true); }
                    }
                }
                return _renderer.Render(mapped, artwork, width, height, work.Token);
            }, work.Token);
            client.AssertCurrent(token, revision);
            if (generation != _renderGeneration || !ReferenceEquals(client, _client) || choice != _renderChoice) return;
            _timeTicks = frame.Payload.GetProperty("timeTicks").GetInt64();
            _updatingTime=true;
            try { TimeSlider.Maximum=Math.Max(1,Number(frame.Payload,"durationTicks",1)); }
            finally { _updatingTime=false; }
            UpdateTimeDisplay();
            _timeLabel=String(frame.Payload,"timeLabel")??$"{_timeTicks} ticks";PlayheadText.Text=_timeLabel;
            if(frame.Payload.TryGetProperty("playing",out var playing)&&!playing.GetBoolean())StopPlayback();
            var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Pbgra32, null, pixels, width * 4); bitmap.Freeze();
            var represented = artwork.Keys.ToHashSet();
            var currentIds=frame.Payload.GetProperty("artwork").EnumerateArray().Select(a=>a.GetProperty("id").GetString()!).ToHashSet();
            foreach(var id in _renderTextures.Keys.Where(id=>!currentIds.Contains(id)).ToArray())_renderTextures.Remove(id);
            MeshCanvas.ApplyEvaluatedFrame(bitmap, represented, choice.Kind == "keyArt" && _editingContext is EditingContext.Source or EditingContext.Mesh,documentWidth,documentHeight,Property(frame.Payload,"authoringMeshes"));
            RenderStatusText.Text = $"{width} × {height} · {clock.Elapsed.TotalMilliseconds:0} ms · {_renderer!.Driver}";
            if (preview is null && rigPreview is null) _lastRenderKey = key;
            else _lastRenderKey = null;
        }
        catch (OperationCanceledException) { }
        catch (StaleProjectionException) { }
        catch (Exception error)
        {
            if (generation == _renderGeneration) { StopPlayback(); MeshCanvas.ClearEvaluatedFrame(); RenderStatusText.Text = $"描画停止: {error.Message}"; }
        }
        finally { if (ReferenceEquals(_renderWork, work)) _renderWork = null; work.Dispose(); }
    }
}
