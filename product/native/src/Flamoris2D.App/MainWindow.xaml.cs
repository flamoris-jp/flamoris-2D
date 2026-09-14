using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow : IAsyncDisposable
{
    private readonly Dictionary<EditingContext, string> _activeTools = [];
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly bool _autoConnect;
    private ProductHostClient? _client;
    private EditingContext _editingContext = EditingContext.Source;
    private bool _closingAfterShutdown;

    public MainWindow(bool autoConnect = true)
    {
        InitializeComponent();
        _autoConnect = autoConnect;
        foreach (var definition in EditingContextCatalog.All)
            _activeTools[definition.Context] = definition.Tools[0];
        Loaded += MainWindow_Loaded;
        PreviewKeyDown += MainWindow_PreviewKeyDown;
        SwitchContext(EditingContext.Source, returnFocus: false);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (_autoConnect) await ConnectHostAsync(createDocument: true);
    }

    private async Task ConnectHostAsync(bool createDocument)
    {
        SetBusy("Product Hostを起動しています…");
        RecoveryBanner.Visibility = Visibility.Collapsed;
        if (_client is not null) await _client.DisposeAsync();
        _client = new ProductHostClient();
        _client.AuthorityLost += Client_AuthorityLost;
        _client.DocumentChanged += Client_DocumentChanged;
        _client.DiagnosticReceived += (_, message) =>
            Dispatcher.InvokeAsync(() => StatusText.Text = message);
        try
        {
            var hostPath = Path.Combine(AppContext.BaseDirectory, "ProductHost", "main.mjs");
            var nodePath = Environment.GetEnvironmentVariable("FLAMORIS_NODE_PATH");
            var handshake = await _client.StartAsync(hostPath, nodePath);
            HostStatusIndicator.Fill = Brushes.SeaGreen;
            HostStatusText.Text =
                $"接続済み · protocol {handshake.ProtocolVersion} · schema {handshake.ProductSchemaVersion}";
            if (createDocument) await _client.CreateSessionAsync("名称未設定", 1920, 1080);
            await RefreshProjectionAsync();
            StatusText.Text = "Product HostのEditorSessionに接続しました。";
        }
        catch (Exception error)
        {
            ShowAuthorityLost($"Product Hostを起動できませんでした: {error.Message}");
        }
    }

    private async Task RefreshProjectionAsync()
    {
        var client = _client;
        if (client?.DocumentToken is null) return;
        await _refreshGate.WaitAsync();
        try
        {
            var selectedId = (TargetList.SelectedItem as TargetProjection)?.Id;
            var summary = await client.GetProjectSummaryAsync();
            var tree = await client.GetSceneTreeAsync();
            var targets = FlattenTree(tree.Payload).ToArray();
            TargetList.ItemsSource = targets;
            TargetList.SelectedItem = targets.FirstOrDefault(item => item.Id == selectedId)
                ?? targets.FirstOrDefault();
            var history = await client.GetHistoryAsync();
            var canUndo = history.Payload.GetProperty("canUndo").GetBoolean();
            var canRedo = history.Payload.GetProperty("canRedo").GetBoolean();
            UndoMenuItem.IsEnabled = UndoButton.IsEnabled = canUndo;
            RedoMenuItem.IsEnabled = RedoButton.IsEnabled = canRedo;
            RefreshButton.IsEnabled = true;
            var projectName = summary.Payload.GetProperty("displayName").GetString() ?? "名称未設定";
            Title = $"FLAMORIS 2D — {projectName}";
            RevisionText.Text = $"revision {client.Revision}";
            UpdateSelectionEditor();
        }
        catch (StaleProjectionException)
        {
            StatusText.Text = "古いQuery応答を破棄しました。最新revisionを再取得します。";
        }
        catch (ProductHostException error) when (error.Code == "revision.conflict")
        {
            ClearProjection();
            StatusText.Text = "revision競合を検出しました。authoritative projectionを再取得してください。";
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    private static IEnumerable<TargetProjection> FlattenTree(JsonElement node, int depth = 0)
    {
        yield return new TargetProjection(
            node.GetProperty("id").GetString() ?? "",
            node.GetProperty("displayName").GetString() ?? "",
            node.GetProperty("kind").GetString() ?? "",
            depth);
        if (!node.TryGetProperty("children", out var children)) yield break;
        foreach (var child in children.EnumerateArray())
            foreach (var descendant in FlattenTree(child, depth + 1))
                yield return descendant;
    }

    private async void NewDocument_Click(object sender, RoutedEventArgs e)
    {
        if (_client?.IsRunning != true)
        {
            await ConnectHostAsync(createDocument: true);
            return;
        }
        await _client.CreateSessionAsync("名称未設定", 1920, 1080);
        await RefreshProjectionAsync();
        StatusText.Text = "新しいProduct Host documentを作成しました。";
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) =>
        await RefreshProjectionAsync();

    private async void ApplyName_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null || TargetList.SelectedItem is not TargetProjection target) return;
        var name = DisplayNameEditor.Text.Trim();
        if (name.Length == 0) return;
        try
        {
            await _client.RenameNodeAsync(target.Id, name, "WPF: rename target");
            await RefreshProjectionAsync();
            ViewportHost.Focus();
        }
        catch (ProductHostException error) when (error.Code == "revision.conflict")
        {
            ClearProjection();
            StatusText.Text = "別clientの変更を検出しました。最新状態を取得します。";
            await RefreshProjectionAsync();
        }
        catch (Exception error)
        {
            StatusText.Text = $"Commandに失敗しました: {error.Message}";
        }
    }

    private async void Undo_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null) return;
        try
        {
            await _client.UndoAsync();
            await RefreshProjectionAsync();
            ViewportHost.Focus();
        }
        catch (Exception error)
        {
            StatusText.Text = $"Undoに失敗しました: {error.Message}";
        }
    }

    private async void Redo_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null) return;
        try
        {
            await _client.RedoAsync();
            await RefreshProjectionAsync();
            ViewportHost.Focus();
        }
        catch (Exception error)
        {
            StatusText.Text = $"Redoに失敗しました: {error.Message}";
        }
    }

    private void Client_DocumentChanged(object? sender, DocumentChangedEventArgs e) =>
        Dispatcher.InvokeAsync(async () =>
        {
            RevisionText.Text = $"revision {e.Revision}";
            await RefreshProjectionAsync();
        });

    private void Client_AuthorityLost(object? sender, AuthorityLostEventArgs e) =>
        Dispatcher.InvokeAsync(() => ShowAuthorityLost(
            "Product Hostとの接続を失いました。staleな表示を破棄し、保存と編集を停止しました。"));

    private void ShowAuthorityLost(string message)
    {
        ClearProjection();
        RecoveryMessage.Text = message;
        RecoveryBanner.Visibility = Visibility.Visible;
        HostStatusIndicator.Fill = Brushes.IndianRed;
        HostStatusText.Text = "切断";
        StatusText.Text = "authoritative stateはProduct Hostとともに失われました。";
        RevisionText.Text = "revision —";
    }

    private void ClearProjection()
    {
        TargetList.ItemsSource = null;
        SelectedTargetText.Text = "—";
        DisplayNameEditor.Text = "";
        DisplayNameEditor.IsEnabled = false;
        ApplyNameButton.IsEnabled = false;
        RefreshButton.IsEnabled = false;
        UndoMenuItem.IsEnabled = UndoButton.IsEnabled = false;
        RedoMenuItem.IsEnabled = RedoButton.IsEnabled = false;
        SaveMenuItem.IsEnabled = false;
    }

    private async void Reconnect_Click(object sender, RoutedEventArgs e) =>
        await ConnectHostAsync(createDocument: true);

    private void WorkflowContext_Click(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleButton { Tag: string value } &&
            Enum.TryParse<EditingContext>(value, out var context))
            SwitchContext(context, returnFocus: true);
    }

    private void SwitchContext(EditingContext context, bool returnFocus)
    {
        _editingContext = context;
        var definition = EditingContextCatalog.Get(context);
        foreach (var button in WorkflowButtons())
            button.IsChecked = string.Equals(button.Tag?.ToString(), context.ToString(),
                StringComparison.Ordinal);
        ActiveContextBadge.Text = $"{definition.JapaneseName} / {definition.EnglishName}";
        ViewportContextText.Text = ActiveContextBadge.Text;
        ClickMeaningText.Text = $"click: {definition.ClickMeaning}";
        ToolList.ItemsSource = definition.Tools;
        ToolList.SelectedItem = _activeTools[context];
        TimeSurface.Visibility = definition.ShowTimeSurface
            ? Visibility.Visible : Visibility.Collapsed;
        TimeSurfaceRow.Height = definition.ShowTimeSurface
            ? new GridLength(190) : new GridLength(0);
        UpdateToolSettings();
        if (returnFocus) ViewportHost.Focus();
    }

    private IEnumerable<ToggleButton> WorkflowButtons()
    {
        yield return SourceContextButton;
        yield return MeshContextButton;
        yield return RigContextButton;
        yield return DeformContextButton;
        yield return AnimationContextButton;
        yield return PreviewContextButton;
        yield return ExportContextButton;
    }

    private void ToolList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ToolList.SelectedItem is string tool)
        {
            _activeTools[_editingContext] = tool;
            UpdateToolSettings();
            ViewportHost.Focus();
        }
    }

    private void UpdateToolSettings()
    {
        var definition = EditingContextCatalog.Get(_editingContext);
        var tool = _activeTools.GetValueOrDefault(_editingContext) ?? definition.Tools[0];
        ActiveToolSettingsText.Text = $"{tool} — {definition.ClickMeaning}";
    }

    private void TargetList_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        UpdateSelectionEditor();

    private void UpdateSelectionEditor()
    {
        if (TargetList.SelectedItem is not TargetProjection target ||
            _client?.HasAuthoritativeProjection != true)
        {
            SelectedTargetText.Text = "—";
            DisplayNameEditor.IsEnabled = ApplyNameButton.IsEnabled = false;
            return;
        }
        SelectedTargetText.Text = $"{new string('　', target.Depth)}{target.DisplayName} · {target.Kind}";
        DisplayNameEditor.Text = target.DisplayName;
        DisplayNameEditor.IsEnabled = ApplyNameButton.IsEnabled = true;
    }

    private void MainWindow_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.Modifiers == ModifierKeys.Control &&
            e.Key >= Key.D1 && e.Key <= Key.D7)
        {
            SwitchContext((EditingContext)((int)e.Key - (int)Key.D1), returnFocus: true);
            e.Handled = true;
            return;
        }
        if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.Z)
        {
            Undo_Click(sender, e);
            e.Handled = true;
        }
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.Y)
        {
            Redo_Click(sender, e);
            e.Handled = true;
        }
        else if (e.Key == Key.Escape)
        {
            ViewportHost.Focus();
            e.Handled = true;
        }
    }

    private void FocusViewport_Click(object sender, RoutedEventArgs e) => ViewportHost.Focus();
    private void Exit_Click(object sender, RoutedEventArgs e) => Close();

    private void About_Click(object sender, RoutedEventArgs e) =>
        MessageBox.Show(this,
            "FLAMORIS 2D native shell foundation\nProduct authority: JavaScript Product Host / EditorSession",
            "FLAMORIS 2D", MessageBoxButton.OK, MessageBoxImage.Information);

    private void SetBusy(string message)
    {
        StatusText.Text = message;
        HostStatusIndicator.Fill = Brushes.Goldenrod;
        HostStatusText.Text = "接続中…";
        ClearProjection();
    }

    private async void MainWindow_Closing(object? sender, CancelEventArgs e)
    {
        if (_closingAfterShutdown) return;
        e.Cancel = true;
        _closingAfterShutdown = true;
        await DisposeAsync();
        Close();
    }

    public async Task RunSmokeProofAsync()
    {
        await ConnectHostAsync(createDocument: true);
        if (_client?.HasAuthoritativeProjection != true)
            throw new InvalidOperationException("Smoke proof did not attach Product authority.");
        var tree = await _client.GetSceneTreeAsync();
        var rootId = tree.Payload.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("Scene root projection is missing.");
        await _client.ExecuteTransactionAsync(
            [
                ProductCommand.RenameNode(rootId, "Smoke A"),
                ProductCommand.RenameNode(rootId, "Smoke B"),
            ],
            "WPF smoke transaction");
        await _client.UndoAsync();
        await _client.RedoAsync();
        foreach (var definition in EditingContextCatalog.All)
        {
            SwitchContext(definition.Context, returnFocus: false);
            if ((TimeSurface.Visibility == Visibility.Visible) != definition.ShowTimeSurface)
                throw new InvalidOperationException("Contextual time surface visibility is incorrect.");
        }
        await _client.ShutdownAsync();
    }

    public async ValueTask DisposeAsync()
    {
        if (_client is not null)
        {
            await _client.DisposeAsync();
            _client = null;
        }
        _refreshGate.Dispose();
    }

    private sealed record TargetProjection(string Id, string DisplayName, string Kind, int Depth);
}
