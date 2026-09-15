using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Win32;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private string? _currentPath;
    private bool _documentBusy, _closePromptActive, _recoveryDismissed;
    private (string Token, long Revision)? _lastRecovery, _replacementApproval;
    private void AssertReplacementApproval()
    {
        if (_replacementApproval is { } approval) _client!.AssertCurrent(approval.Token, approval.Revision);
    }
    private readonly NativeRecoveryStore _recovery = new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FLAMORIS", "2D", "Recovery"));
    private readonly DispatcherTimer _recoveryTimer = new() { Interval = TimeSpan.FromSeconds(30) };
    private ListBox? _recoveryList;
    private void InitializeDocumentUi()
    {
        _recoveryTimer.Tick += async (_, _) => await CaptureRecoveryAsync();
        if (_autoConnect) _recoveryTimer.Start();
    }
    private async Task<bool> ConfirmReplaceDocumentAsync()
    {
        _replacementApproval = null;
        if (_documentBusy || _loadingArtwork || _meshBusy) return false;
        if (!_autoConnect) return true;
        if (_client?.HasAuthoritativeProjection != true) return true;
        var state = await _client.GetWorkspaceAsync();
        _replacementApproval = (state.DocumentToken!, state.Revision!.Value);
        if (_hasHandsOn) return ConfirmDiscardHandsOn();
        if (!state.Payload.GetProperty("isDirty").GetBoolean()) return true;
        var choice = MessageBox.Show(this, "変更を保存してから続けますか？\n「いいえ」は現在の編集を破棄します。復元データは残ります。",
            "未保存の変更", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        if (choice == MessageBoxResult.Cancel) return false;
        if (choice == MessageBoxResult.No) return true;
        if (!await SaveDocumentAsync("save")) return false;
        state = await _client.GetWorkspaceAsync();
        _replacementApproval = (state.DocumentToken!, state.Revision!.Value);
        return !state.Payload.GetProperty("isDirty").GetBoolean();
    }
    private async void ImportSource_Click(object sender, RoutedEventArgs e)
    {
        if (_documentBusy || _meshBusy || _loadingArtwork) return;
        var started = false;var imported=false;
        try
        {
            if (!await ConfirmReplaceDocumentAsync()) return;
            var dialog = new OpenFileDialog { Filter = "制作素材 (*.psd;*.flimg)|*.psd;*.flimg", Title = "制作素材を読み込む" };
            if (dialog.ShowDialog(this) != true) return;
            if (_client?.HasAuthoritativeProjection != true) await ConnectHostAsync(true);
            if (_client?.HasAuthoritativeProjection != true) return;
            AssertReplacementApproval();
            started = true; _documentBusy = true; SetMeshBusy(true); _meshWork = new CancellationTokenSource();
            CancelArtworkButton.Visibility = Visibility.Visible; CancelArtworkButton.IsEnabled = true;
            StatusText.Text = "素材を検証・読み込み中…";
            await using var input = new FileStream(dialog.FileName, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous);
            var kind = Path.GetExtension(dialog.FileName).Equals(".psd", StringComparison.OrdinalIgnoreCase) ? NativeSourceKind.Psd : NativeSourceKind.Cutwork;
            await _client.ImportSourceAsync(input, input.Length, kind, Path.GetFileName(dialog.FileName), _meshWork.Token);
            _currentPath = null; _hasHandsOn = false; _lastRecovery = null;
            AttachDocumentWorkspace(_client.DocumentToken!); await RefreshProjectionAsync();
            TargetList.SelectedItem = _targets.Targets.FirstOrDefault(t => t.Kind == "part");
            await RefreshProjectionAsync(); MeshCanvas.Fit(); StatusText.Text = "素材を読み込みました。パーツを選んでメッシュを生成できます。";
            imported=true;
        }
        catch (Exception error) { StatusText.Text = $"素材を読み込めませんでした: {error.Message}"; }
        finally
        {
            if (started)
            {
                _meshWork?.Dispose(); _meshWork = null; _documentBusy = false;
                CancelArtworkButton.Visibility = Visibility.Collapsed; SetMeshBusy(false);
                SaveMenuItem.IsEnabled = !_hasHandsOn && _client?.HasAuthoritativeProjection == true;
                if(imported&&PreferenceFlag("saveAfterMajorOperations",true))await CaptureRecoveryAsync();
            }
        }
    }
    private async void OpenDocument_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!await ConfirmReplaceDocumentAsync()) return;
            var dialog = new OpenFileDialog { Filter = "FLAMORIS 2D (*.fl2d)|*.fl2d", Title = "プロジェクトを開く" };
            if (dialog.ShowDialog(this) != true) return;
            await OpenDocumentPathAsync(dialog.FileName);
        }
        catch (Exception error) { StatusText.Text = $"開けませんでした: {error.Message}"; }
    }
    private async Task OpenDocumentPathAsync(string path)
    {
        if (_client?.HasAuthoritativeProjection != true) await ConnectHostAsync(true);
        if (_client?.HasAuthoritativeProjection != true) return;
        _documentBusy = true; SetMeshBusy(true);
        try
        {
            await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous);
            AssertReplacementApproval();
            await _client.OpenDocumentAsync(input, input.Length);
            _currentPath = Path.GetFullPath(path); _hasHandsOn = false; _lastRecovery = null;
            AttachDocumentWorkspace(_client.DocumentToken!); await RefreshProjectionAsync();
            MeshCanvas.Fit(); StatusText.Text = $"開きました: {Path.GetFileName(path)}";
            await RememberRecentAsync(path);
        }
        finally { _documentBusy = false; SetMeshBusy(false); SaveMenuItem.IsEnabled = !_hasHandsOn && _client?.HasAuthoritativeProjection == true; }
    }
    private async void SaveDocument_Click(object sender, RoutedEventArgs e) => await SaveDocumentAsync("save");
    private async void SaveAsDocument_Click(object sender, RoutedEventArgs e) => await SaveDocumentAsync("saveAs");
    private async void SaveCopyDocument_Click(object sender, RoutedEventArgs e) => await SaveDocumentAsync("copy");
    private async void SaveIncrementalDocument_Click(object sender, RoutedEventArgs e) => await SaveDocumentAsync("incremental");
    private async Task<bool> SaveDocumentAsync(string operation)
    {
        if (_documentBusy || _loadingArtwork || _meshBusy || _hasHandsOn || _client?.HasAuthoritativeProjection != true) return false;
        var path = _currentPath;
        if (operation is "saveAs" or "copy" || path is null)
        {
            var dialog = new SaveFileDialog { Filter = "FLAMORIS 2D (*.fl2d)|*.fl2d", DefaultExt = ".fl2d",
                AddExtension = true, FileName = path is null ? "名称未設定.fl2d" : Path.GetFileName(path),
                Title = operation == "copy" ? "コピーを保存" : operation == "incremental" ? "別バージョンを保存（上書き不可）" : "名前を付けて保存" };
            if (dialog.ShowDialog(this) != true) return false;
            path = dialog.FileName;
        }
        if(operation=="incremental")
        {
            try
            {
                var directory=Path.GetDirectoryName(Path.GetFullPath(path))!;
                var next=await _client.IncrementalNameAsync(Path.GetFileName(path),Directory.EnumerateFiles(directory,"*.fl2d").Select(p=>Path.GetFileName(p)!).Take(10001).ToArray(),_nativePreferences);
                var fileName=String(next.Payload,"fileName")!;if(Path.GetFileName(fileName)!=fileName)throw new InvalidDataException("Invalid incremental name.");path=Path.Combine(directory,fileName);
            }
            catch(Exception error){StatusText.Text=error.Message;return false;}
        }
        _documentBusy = true; PreparedDocument? prepared = null;
        var client = _client;
        string? cleanupWarning = null;
        try
        {
            MeshCanvas.Cancel(); CancelGenerated();
            prepared = await client.PrepareDocumentAsync(operation);
            await AtomicDocumentFile.WriteAsync(path, (stream, ct) => client.DownloadDocumentAsync(prepared, stream, ct),
                overwrite: operation != "incremental");
            if (operation != "copy")
            {
                var ack = await client.AcknowledgeDocumentAsync(prepared);
                if (client.DocumentToken != prepared.Identity.DocumentToken) throw new InvalidOperationException("保存中にプロジェクトが切り替わりました。");
                _currentPath = Path.GetFullPath(path);
                var cleanup = ack.Payload.GetProperty("cleanup").Deserialize<RecoveryCleanup>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
                try { await Task.Run(() => _recovery.CleanupAsync(cleanup)); }
                catch (Exception error) { cleanupWarning = $"保存済み。復元データの整理は保留: {error.Message}"; }
            }
            await RefreshProjectionAsync();
            await RememberRecentAsync(path);
            StatusText.Text = cleanupWarning ?? $"保存しました: {Path.GetFileName(path)}";
            return true;
        }
        catch (Exception error) { StatusText.Text = $"保存できませんでした: {error.Message}"; return false; }
        finally
        {
            if (prepared is not null) await client.ReleaseDocumentAsync(prepared.Id, prepared.Identity.DocumentToken, prepared.Identity.Revision);
            _documentBusy = false;
            SaveMenuItem.IsEnabled = !_hasHandsOn && client.HasAuthoritativeProjection;
        }
    }
    private async Task CaptureRecoveryAsync()
    {
        if (_documentBusy || _loadingArtwork || _meshBusy || _hasHandsOn || _client?.HasAuthoritativeProjection != true) return;
        var client = _client; PreparedDocument? prepared = null; _documentBusy = true;
        try
        {
            var state = await client.GetWorkspaceAsync();
            if (!state.Payload.GetProperty("isDirty").GetBoolean() || _lastRecovery == (client.DocumentToken!, client.Revision)) return;
            prepared = await client.PrepareDocumentAsync("recovery");
            await _recovery.SaveAsync(prepared, _currentPath, (stream, ct) => client.DownloadDocumentAsync(prepared, stream, ct));
            _lastRecovery = (prepared.Identity.DocumentToken, prepared.Identity.Revision);
        }
        catch (Exception error) { StatusText.Text = $"最新状態の復元用保存に失敗しました（以前のデータは保持）: {error.Message}"; }
        finally
        {
            if (prepared is not null) await client.ReleaseDocumentAsync(prepared.Id, prepared.Identity.DocumentToken, prepared.Identity.Revision);
            _documentBusy = false;
            SaveMenuItem.IsEnabled = !_hasHandsOn && client.HasAuthoritativeProjection;
        }
    }
    private async void Recovery_Click(object sender, RoutedEventArgs e) => await ShowRecoveryCardAsync(explicitOpen: true);
    private async Task ShowRecoveryCardAsync(bool explicitOpen = false)
    {
        if (!_autoConnect || ((_recoveryDismissed || !PreferenceFlag("showRecoveryNotification",true)) && !explicitOpen)) return;
        IReadOnlyList<RecoveryEntry> entries;
        try { entries = await Task.Run(_recovery.List); }
        catch (Exception error) { StatusText.Text = $"復元候補を読み取れませんでした: {error.Message}"; return; }
        if (entries.Count == 0) { RecoveryCard.Visibility = Visibility.Collapsed; return; }
        var panel = new StackPanel { Margin = new Thickness(12) };
        panel.Children.Add(new TextBlock { Text = "復元できる編集データ", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0,0,0,6) });
        _recoveryList = new ListBox { ItemsSource = entries, DisplayMemberPath = "Label", MaxHeight = 130, SelectedIndex = 0 };
        panel.Children.Add(_recoveryList);
        var buttons = new WrapPanel();
        var restore = new Button { Content = "選択したデータを復元", Margin = new Thickness(3) };
        restore.Click += async (_, _) =>
        {
            var started=false;
            try
            {
                if (_recoveryList.SelectedItem is not RecoveryEntry entry || entry.Metadata is null || !await ConfirmReplaceDocumentAsync()) return;
                _documentBusy = true;started=true;SetMeshBusy(true);
                var (bytes, metadata) = await _recovery.ReadAsync(entry);
                AssertReplacementApproval();
                await using (bytes)
                    await _client!.OpenDocumentAsync(bytes, bytes.Length, new RecoveryOrigin(metadata.Identity.LineageId, metadata.Identity.SnapshotId));
                _currentPath = null; _hasHandsOn = false; _lastRecovery = null; _recoveryDismissed = true;
                AttachDocumentWorkspace(_client.DocumentToken!); await RefreshProjectionAsync(); MeshCanvas.Fit();
                RecoveryCard.Visibility = Visibility.Collapsed; StatusText.Text = "復元しました。名前を付けて保存してください。";
            }
            catch (Exception error) { StatusText.Text = $"復元できませんでした: {error.Message}"; }
            finally { if(started){_documentBusy = false;SetMeshBusy(false);} }
        };
        var dismiss = new Button { Content = "今回は復元しない", Margin = new Thickness(3) };
        dismiss.Click += (_, _) => { _recoveryDismissed = true; RecoveryCard.Visibility = Visibility.Collapsed; };
        var discard = new Button { Content = "選択した復元データを破棄", Margin = new Thickness(3) };
        discard.Click += async (_, _) =>
        {
            if (_recoveryList.SelectedItem is not RecoveryEntry entry || MessageBox.Show(this,
                $"この復元データだけを削除しますか？\n{entry.Label}", "復元データを破棄", MessageBoxButton.OKCancel,
                MessageBoxImage.Warning) != MessageBoxResult.OK) return;
            try { await _recovery.DiscardAsync(entry); await ShowRecoveryCardAsync(true); }
            catch (Exception error) { StatusText.Text = error.Message; }
        };
        buttons.Children.Add(restore); buttons.Children.Add(dismiss); buttons.Children.Add(discard);
        panel.Children.Add(buttons); RecoveryCard.Content = panel; RecoveryCard.Visibility = Visibility.Visible;
    }
}
