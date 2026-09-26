using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private McpConnection? _mcpConnection;
    private bool _mcpBusy;
    private bool _mcpActivity;
    private void SetMcpActivity(bool active)
    {
        if (active == _mcpActivity) return;
        _mcpActivity = active;
        if (active && McpChipsy.Source is null)
        {
            var cache = System.IO.Path.Combine(AppContext.BaseDirectory, "mcp-assets", "chipsy-decoded.png");
            if (System.IO.File.Exists(cache))
            {
                try
                {
                    var sheet = new BitmapImage(new Uri(cache));
                    var frame = new CroppedBitmap(sheet, new Int32Rect(0, 7 * 208, 192, 208));
                    frame.Freeze(); McpChipsy.Source = frame;
                }
                catch { /* Activity text/cursor still works if an asset cannot be decoded. */ }
            }
        }
        McpChipsy.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
        if (active) Mouse.OverrideCursor = Cursors.Wait;
        else if (Mouse.OverrideCursor == Cursors.Wait) Mouse.OverrideCursor = null;
    }
    private void Client_McpStatusChanged() => Dispatcher.BeginInvoke(new Action(() =>
    {
        if (_disposed || _client is not { } client) return;
        var status = client.McpStatus;
        McpStatus.Foreground = status?.Connected == true ? Brushes.LimeGreen : Brushes.IndianRed;
        McpStatus.Text = status?.Enabled != true ? "MCP: 無効" : status.Connected ? "MCP: 接続中" : "MCP: 接続待ち";
        McpActivity.Header = status?.ActivityVisible == true ? "AI: 作業中" : "AI: 待機";
        // Override only our own wait cursor; clearing restores the current canvas/tool cursor.
        SetMcpActivity(status?.ActivityVisible == true);
    }));

    private void ClearMcpStatus()
    {
        _mcpConnection = null;
        McpStatus.Text = "MCP: 無効";
        McpStatus.Foreground = Brushes.IndianRed;
        SetMcpActivity(false);
        McpEndpoint.Header = "接続先: —";
        McpActivity.Header = "要求: —";
        McpCopy.IsEnabled = McpDisable.IsEnabled = McpRotate.IsEnabled = false;
    }
    private async Task RefreshMcpStatusAsync(ProductHostClient client)
    {
        if (!client.IsRunning || client.DocumentToken is null) { ClearMcpStatus(); return; }
        var response = await client.GetMcpStatusAsync();
        if (!ReferenceEquals(client, _client) || response.DocumentToken != client.DocumentToken) return;
        var status = response.Payload;
        if (!status.GetProperty("enabled").GetBoolean()) { ClearMcpStatus(); return; }
        if (_mcpConnection?.DocumentToken != response.DocumentToken) _mcpConnection = null;
        var permission = status.GetProperty("permission").GetString() == "edit" ? "編集可" : "読み取り専用";
        McpStatus.Text = $"MCP: {permission} / {(status.GetProperty("connected").GetBoolean() ? "接続中" : "接続待ち")}";
        McpStatus.Foreground = status.GetProperty("connected").GetBoolean() ? Brushes.LimeGreen : Brushes.IndianRed;
        McpEndpoint.Header = $"接続先: {status.GetProperty("endpoint").GetString()}";
        McpActivity.Header = $"AI: 処理中 {status.GetProperty("active").GetInt32()}";
        McpCopy.IsEnabled = _mcpConnection is not null;
        McpDisable.IsEnabled = McpRotate.IsEnabled = true;
    }
    private async void McpMenu_Opened(object sender, RoutedEventArgs e)
    {
        if (!ReferenceEquals(e.Source, sender)) return;
        var available = _client?.HasAuthoritativeProjection == true && !_documentBusy && !_mcpBusy;
        McpReadOnly.IsEnabled = McpEdit.IsEnabled = available;
        if (_client is not { IsRunning: true } client) { ClearMcpStatus(); return; }
        try { await RefreshMcpStatusAsync(client); }
        catch { ClearMcpStatus(); }
    }
    private async void McpEnable_Click(object sender, RoutedEventArgs e)
    {
        if (_mcpBusy || _documentBusy || _client is not { HasAuthoritativeProjection: true } client) return;
        _mcpBusy = true;
        try
        {
            var permission = ReferenceEquals(sender, McpEdit) ? McpPermission.Edit :
                ReferenceEquals(sender, McpRotate) ? _mcpConnection?.Permission ?? McpPermission.ReadOnly : McpPermission.ReadOnly;
            _mcpConnection = await client.EnableMcpAsync(permission);
            await RefreshMcpStatusAsync(client);
            StatusText.Text = "MCP接続を有効にしました。「接続情報をコピー」でクライアントへ登録できます。";
        }
        catch (Exception error)
        {
            try { await RefreshMcpStatusAsync(client); } catch { ClearMcpStatus(); }
            StatusText.Text = $"MCPを有効にできませんでした: {error.Message}";
        }
        finally { _mcpBusy = false; }
    }
    private async void McpDisable_Click(object sender, RoutedEventArgs e)
    {
        if (_client is not { IsRunning: true } client) { ClearMcpStatus(); return; }
        try { await client.DisableMcpAsync(); ClearMcpStatus(); StatusText.Text = "MCP接続を無効にしました。以前の接続情報は使えません。"; }
        catch (Exception error) { StatusText.Text = $"MCPの無効化を確認できませんでした: {error.Message}"; }
    }
    private async void McpCopy_Click(object sender, RoutedEventArgs e)
    {
        if (_client is not { IsRunning: true } client) return;
        try
        {
            await RefreshMcpStatusAsync(client);
            if (_mcpConnection is null) return;
            Clipboard.SetText(_mcpConnection.CopyConfiguration());
            StatusText.Text = "MCP接続情報をコピーしました。接続キーを含むため、共有せず接続先の設定へ貼り付けてください。";
        }
        catch (Exception error) { StatusText.Text = $"接続情報をコピーできませんでした: {error.Message}"; }
    }
}
