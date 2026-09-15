using System.ComponentModel;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow : Window, IAsyncDisposable
{
    private readonly Dictionary<EditingContext, string> _activeTools = [];
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly bool _autoConnect;
    private ProductHostClient? _client;
    private EditingContext _editingContext = EditingContext.Source;
    private bool _closingAfterShutdown;
    private bool _disposed;
    private readonly TargetWorkspace _targets = new();
    private bool _updatingTargets;
    private bool _targetMutationPending;
    private long _propertyRevision = -1;
    private TargetProjection? _propertySnapshot;

    private bool HasPropertyDraft => _propertySnapshot is { } original &&
        (DisplayNameEditor.Text != original.DisplayName ||
         TargetVisibleEditor.IsChecked != original.Visible ||
         TargetLockedEditor.IsChecked != original.Locked);

    public MainWindow(bool autoConnect = true)
    {
        InitializeComponent();
        _autoConnect = autoConnect;
        foreach (var definition in EditingContextCatalog.All)
            _activeTools[definition.Context] = definition.Tools[0];
        InitializeMeshUi();
        InitializeDocumentUi();
        InitializeRenderUi();
        InitializeRigUi();
        InitializeAnimationUi();
        Loaded += MainWindow_Loaded;
        PreviewKeyDown += MainWindow_PreviewKeyDown;
        SwitchContext(EditingContext.Source, returnFocus: false);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (_autoConnect) { await ConnectHostAsync(createDocument: true);await LoadNativeSettingsAsync();await ShowRecoveryCardAsync(); }
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
            if (createDocument)
            {
                await _client.CreateSessionAsync("名称未設定", 1920, 1080);
                _hasHandsOn = false;
            }
            if (_client.DocumentToken is { } token) AttachDocumentWorkspace(token);
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
        if (_disposed || client?.DocumentToken is null) return;
        await _refreshGate.WaitAsync();
        try
        {
            if (_disposed || !ReferenceEquals(client, _client)) return;
            var snapshot = await client.GetWorkspaceAsync();
            if (!ReferenceEquals(client, _client) || !client.HasAuthoritativeProjection ||
                snapshot.DocumentToken != client.DocumentToken || snapshot.Revision != client.Revision)
                throw new StaleProjectionException(snapshot.Revision ?? -1, client.Revision);
            _targets.Apply(snapshot.DocumentToken!, snapshot.Revision!.Value,
                snapshot.Payload.GetProperty("tree"));
            _updatingTargets = true;
            try
            {
                TargetList.ItemsSource = _targets.Targets;
                TargetList.SelectedItem = _targets.Selected;
            }
            finally { _updatingTargets = false; }
            var canUndo = snapshot.Payload.GetProperty("canUndo").GetBoolean();
            var canRedo = snapshot.Payload.GetProperty("canRedo").GetBoolean();
            UndoMenuItem.IsEnabled = UndoButton.IsEnabled = canUndo;
            RedoMenuItem.IsEnabled = RedoButton.IsEnabled = canRedo;
            RefreshButton.IsEnabled = true;
            var projectName = snapshot.Payload.GetProperty("summary").GetProperty("displayName").GetString() ?? "名称未設定";
            Title = $"FLAMORIS 2D — {projectName}{(snapshot.Payload.GetProperty("isDirty").GetBoolean() ? " *" : "")}";
            SaveMenuItem.IsEnabled = !_hasHandsOn && !_documentBusy;
            RevisionText.Text = $"revision {client.Revision}";
            TargetList.IsEnabled = !_targetMutationPending && !_meshBusy;
            // A draft outlives keyboard focus and retains its starting revision.
            if (_propertySnapshot?.Id != _targets.SelectedId || !HasPropertyDraft)
                UpdateSelectionEditor();
            UpdateRenderChoices(snapshot.Payload);
            await RefreshMeshAsync(client);
            await RefreshEvaluatedFrameAsync(client);
            await RefreshRigAsync(client);
            await RefreshTimelineAsync(client);
            await RefreshExportAsync(client);
            await RefreshKeyStateAsync(client);
        }
        catch (StaleProjectionException)
        {
            StatusText.Text = "古いQuery応答を破棄しました。最新revisionを再取得します。";
        }
        catch (ProductHostException error) when (error.Code == "revision.conflict")
        {
            StatusText.Text = "revision競合を検出しました。authoritative projectionを再取得してください。";
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    private async void NewDocument_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!await ConfirmReplaceDocumentAsync()) return;
            if (_client?.IsRunning != true) { await ConnectHostAsync(createDocument: true); return; }
            AssertReplacementApproval();
            await _client.CreateSessionAsync("名称未設定", 1920, 1080);
            _hasHandsOn = false; _currentPath = null; _lastRecovery = null;
            AttachDocumentWorkspace(_client.DocumentToken!);
            await RefreshProjectionAsync();
            StatusText.Text = "新しいプロジェクトを作成しました。";
        }
        catch (Exception error) { StatusText.Text = $"新規プロジェクトを作成できませんでした: {error.Message}"; }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        try { await RefreshProjectionAsync(); }
        catch (Exception error) { StatusText.Text = $"状態を更新できませんでした: {error.Message}"; }
    }

    private async void ApplyName_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null || _targets.Selected is not TargetProjection target || _targetMutationPending || _meshBusy) return;
        var name = DisplayNameEditor.Text.Trim();
        if (name.Length == 0) return;
        var visible = TargetVisibleEditor.IsChecked == true;
        var locked = TargetLockedEditor.IsChecked == true;
        if (name == target.DisplayName && visible == target.Visible && locked == target.Locked) return;
        await MutateTargetAsync(() => _client.ApplyTargetPropertiesAsync(
            target.Id, name, visible, locked, _propertyRevision));
    }

    private async void Undo_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null || _meshBusy || _loadingArtwork) return;
        MeshCanvas.Cancel(); CancelGenerated();
        try
        {
            await _client.UndoAsync();
            await RefreshProjectionAsync();
            MeshCanvas.Focus();
        }
        catch (Exception error)
        {
            StatusText.Text = $"Undoに失敗しました: {error.Message}";
        }
    }

    private async void Redo_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null || _meshBusy || _loadingArtwork) return;
        MeshCanvas.Cancel(); CancelGenerated();
        try
        {
            await _client.RedoAsync();
            await RefreshProjectionAsync();
            MeshCanvas.Focus();
        }
        catch (Exception error)
        {
            StatusText.Text = $"Redoに失敗しました: {error.Message}";
        }
    }

    private void Client_DocumentChanged(object? sender, DocumentChangedEventArgs e) =>
        Dispatcher.InvokeAsync(() => { if (!_disposed && ReferenceEquals(sender, _client)) _ = RefreshAfterChangeAsync(e); });

    private async Task RefreshAfterChangeAsync(DocumentChangedEventArgs e)
    {
        RevisionText.Text = $"revision {e.Revision}";
        try
        {
            if (_client?.IsRunning == true) await RefreshProjectionAsync();
        }
        catch (Exception error)
        {
            StatusText.Text = $"projection更新に失敗しました: {error.Message}";
        }
    }

    private void Client_AuthorityLost(object? sender, AuthorityLostEventArgs e) =>
        Dispatcher.InvokeAsync(() => {
            if (!_disposed && ReferenceEquals(sender, _client)) ShowAuthorityLost(
                "Product Hostとの接続を失いました。staleな表示を破棄し、保存と編集を停止しました。");
        });

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
        ClearRenderProjection();
        ClearMeshProjection();
        _propertySnapshot = null;
        _propertyRevision = -1;
        _targets.Invalidate();
        TargetList.ItemsSource = null;
        TargetList.IsEnabled = false;
        SelectedTargetText.Text = "—";
        DisplayNameEditor.Text = "";
        DisplayNameEditor.IsEnabled = false;
        ApplyNameButton.IsEnabled = false;
        TargetVisibleEditor.IsEnabled = TargetLockedEditor.IsEnabled = false;
        TargetVisibleEditor.IsChecked = TargetLockedEditor.IsChecked = false;
        RefreshButton.IsEnabled = false;
        UndoMenuItem.IsEnabled = UndoButton.IsEnabled = false;
        RedoMenuItem.IsEnabled = RedoButton.IsEnabled = false;
        SaveMenuItem.IsEnabled = false;
    }

    private async void Reconnect_Click(object sender, RoutedEventArgs e) =>
        await ConnectHostAsync(createDocument: true);

    private void WorkflowContext_Click(object sender, RoutedEventArgs e)
    {
        if (_loadingArtwork || _meshBusy)
        {
            foreach (var button in WorkflowButtons()) button.IsChecked = button.Tag?.ToString() == _editingContext.ToString();
            return;
        }
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
        ConfigureMeshContext();
        ConfigureRigContext();
        ConfigureAnimationContext();
        ConfigureExportContext();
        if (_client?.HasAuthoritativeProjection == true) _ = RefreshRigSurfaceAsync();
        if (returnFocus) MeshCanvas.Focus();
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
            SetMeshTool();
            if(_editingContext==EditingContext.Rig){_rigTool=tool;MeshCanvas.RigTool=tool;}
            MeshCanvas.Focus();
        }
    }

    private void UpdateToolSettings()
    {
        var definition = EditingContextCatalog.Get(_editingContext);
        var tool = _activeTools.GetValueOrDefault(_editingContext) ?? definition.Tools[0];
        ActiveToolSettingsText.Text = $"{tool} — {definition.ClickMeaning}";
    }

    private async void TargetList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_updatingTargets) return;
        _targets.Select((TargetList.SelectedItem as TargetProjection)?.Id);
        UpdateSelectionEditor();
        MeshCanvas.Cancel(); CancelGenerated();
        try { await RefreshProjectionAsync(); }
        catch (Exception error) { StatusText.Text = error.Message; }
    }

    private void UpdateSelectionEditor()
    {
        if (_targets.Selected is not TargetProjection target ||
            _client?.HasAuthoritativeProjection != true)
        {
            SelectedTargetText.Text = "—";
            DisplayNameEditor.IsEnabled = ApplyNameButton.IsEnabled = false;
            TargetVisibleEditor.IsEnabled = TargetLockedEditor.IsEnabled = false;
            _propertySnapshot = null;
            return;
        }
        SelectedTargetText.Text = $"{target.DisplayName} · {target.StateText}";
        DisplayNameEditor.Text = target.DisplayName;
        TargetVisibleEditor.IsChecked = target.Visible;
        TargetLockedEditor.IsChecked = target.Locked;
        _propertyRevision = _targets.Revision;
        _propertySnapshot = target;
        DisplayNameEditor.IsEnabled = ApplyNameButton.IsEnabled = !_targetMutationPending;
        TargetVisibleEditor.IsEnabled = TargetLockedEditor.IsEnabled = !_targetMutationPending;
    }

    private async void TargetVisibility_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (_client is null || sender is not FrameworkElement { DataContext: TargetProjection target }) return;
        var revision = _targets.Revision;
        await MutateTargetAsync(() => _client.SetTargetVisibilityAsync(target.Id, !target.Visible, revision));
    }

    private async void TargetLocked_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (_client is null || sender is not FrameworkElement { DataContext: TargetProjection target }) return;
        var revision = _targets.Revision;
        await MutateTargetAsync(() => _client.SetTargetLockedAsync(target.Id, !target.Locked, revision));
    }

    private async Task MutateTargetAsync(Func<Task<ProductHostResponse>> mutate)
    {
        if (_targetMutationPending || _meshBusy || _client?.HasAuthoritativeProjection != true) return;
        _targetMutationPending = true;
        TargetList.IsEnabled = ApplyNameButton.IsEnabled = false;
        DisplayNameEditor.IsEnabled = TargetVisibleEditor.IsEnabled = TargetLockedEditor.IsEnabled = false;
        try
        {
            await mutate();
            await RefreshProjectionAsync();
            MeshCanvas.Focus();
            StatusText.Text = "対象の変更を確定しました。選択対象は維持しています。";
        }
        catch (ProductHostException error) when (error.Code == "revision.conflict")
        {
            MeshCanvas.Focus();
            await RefreshProjectionAsync();
            StatusText.Text = "編集開始後に状態が変わりました。未確定の入力を破棄して最新状態を表示しました。";
        }
        catch (Exception error) { StatusText.Text = $"変更できませんでした: {error.Message}"; }
        finally
        {
            _targetMutationPending = false;
            TargetList.IsEnabled = _client?.HasAuthoritativeProjection == true;
            UpdateSelectionEditor();
        }
    }

    private void MainWindow_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        // Text editing owns its Undo/Redo and navigation. Never undo the Project from a textbox.
        if (e.OriginalSource is TextBoxBase && e.Key != Key.Escape) return;
        if (e.Key == Key.Escape)
        {
            _meshWork?.Cancel(); MeshCanvas.Cancel(); CancelGenerated(); MeshCanvas.Focus();
            e.Handled = true; return;
        }
        if (_meshBusy || _loadingArtwork || _documentBusy) return;
        if (Keyboard.Modifiers == ModifierKeys.Control && e.Key is Key.S or Key.O or Key.N)
        {
            if (e.Key == Key.S) SaveDocument_Click(sender, e);
            else if (e.Key == Key.O) OpenDocument_Click(sender, e);
            else NewDocument_Click(sender, e);
            e.Handled = true; return;
        }
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
            MeshCanvas.Focus();
            e.Handled = true;
        }
    }

    private void FocusViewport_Click(object sender, RoutedEventArgs e) => MeshCanvas.Focus();
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
        if (_closePromptActive) return;
        _closePromptActive = true;
        try { if (!await ConfirmReplaceDocumentAsync()) return; AssertReplacementApproval(); }
        catch (Exception error) { StatusText.Text = error.Message; return; }
        finally { _closePromptActive = false; }
        _meshWork?.Cancel();
        MeshCanvas.Cancel();
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
        await RefreshProjectionAsync();
        var draftRevision = _propertyRevision;
        DisplayNameEditor.Text = "Uncommitted draft";
        TargetVisibleEditor.IsChecked = false;
        MeshCanvas.Focus();
        await _client.RenameNodeAsync(rootId, "External update");
        await RefreshProjectionAsync();
        if (DisplayNameEditor.Text != "Uncommitted draft" || TargetVisibleEditor.IsChecked != false ||
            _propertyRevision != draftRevision)
            throw new InvalidOperationException("Refresh replaced an unfocused property draft or its revision.");
        await MutateTargetAsync(() => _client.ApplyTargetPropertiesAsync(
            rootId, DisplayNameEditor.Text, false, false, draftRevision));
        if (_targets.Selected?.DisplayName != "External update" ||
            DisplayNameEditor.Text != "External update" || _targets.Selected?.Visible != true)
            throw new InvalidOperationException("Stale property draft overwrote a newer Product edit.");
        var selectedBefore = _targets.SelectedId;
        var revision = _targets.Revision;
        await MutateTargetAsync(() => _client.SetTargetVisibilityAsync(rootId, false, revision));
        if (_targets.SelectedId != selectedBefore || _targets.Selected?.Visible != false)
            throw new InvalidOperationException("Visibility must not change target selection.");
        revision = _targets.Revision;
        await MutateTargetAsync(() => _client.SetTargetLockedAsync(rootId, true, revision));
        if (_targets.Selected?.Locked != true)
            throw new InvalidOperationException("Lock projection did not refresh.");
        foreach (var definition in EditingContextCatalog.All)
        {
            SwitchContext(definition.Context, returnFocus: false);
            if ((TimeSurface.Visibility == Visibility.Visible) != definition.ShowTimeSurface)
                throw new InvalidOperationException("Contextual time surface visibility is incorrect.");
            if (_targets.SelectedId != selectedBefore)
                throw new InvalidOperationException("Context switching changed object selection.");
        }
        await RunMeshSmokeAsync();
        await RunProductionSmokeAsync();
        await _client.ShutdownAsync();
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _recoveryTimer.Stop();
        StopPlayback();
        _exportWork?.Cancel();
        _disposed = true;
        _meshWork?.Cancel();
        var client = _client; _client = null;
        _renderWork?.Cancel();
        if (client is not null) await client.DisposeAsync();
        await Task.Run(() => _renderer?.Dispose());
        // Pending refresh continuations still release this managed semaphore; no WaitHandle is allocated.
    }

}
