using System.Windows;
using System.Windows.Controls;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private McpConnection? _mcpConnection;
    private bool _mcpBusy;

    private void ClearMcpStatus()
    {
        _mcpConnection = null;
        McpStatus.Text = "MCP: 無効";
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
        McpStatus.Text = $"MCP: {permission}";
        McpEndpoint.Header = $"接続先: {status.GetProperty("endpoint").GetString()}";
        McpActivity.Header = $"要求: {status.GetProperty("requests").GetInt32()} / 処理中: {status.GetProperty("active").GetInt32()}";
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
        catch (Exception error) { ClearMcpStatus(); StatusText.Text = $"MCPを有効にできませんでした: {error.Message}"; }
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
