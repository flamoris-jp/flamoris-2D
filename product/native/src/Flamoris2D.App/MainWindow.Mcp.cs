using System.IO;
using Flamoris.Flamoris2D.ProductHost;
using Flamoris.Mcp.Wpf;
using CorePermission = Flamoris.Mcp.Core.McpPermission;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private McpConnection? _mcpConnection;
    private McpDesktopUi? _mcpUi;
    private void InitializeMcpUi()
    {
        _mcpUi = new(this, McpMenu, "flamoris-2d",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FLAMORIS", "2D", "mcp-connection.json"),
            "FLAMORIS.2D", Path.Combine(AppContext.BaseDirectory, "mcp", "Flamoris.Mcp.Bridge.exe"),
            AttachMcp, () => _client?.HasAuthoritativeProjection == true && !_documentBusy && !_disposed);
        McpStatusPanel.Content = _mcpUi.StatusIndicator;
    }
    private async Task<McpDesktopAttachment> AttachMcp(CorePermission permission)
    {
        var client = _client ?? throw new InvalidOperationException("Product Host unavailable.");
        _mcpConnection = await client.EnableMcpAsync(permission == CorePermission.Edit ? McpPermission.Edit : McpPermission.ReadOnly,
            startLocalEndpoint: false);
        return new(client.LiveMcpBoundary!, client.LiveMcpGrant!, async () => { await client.DisableMcpAsync(); });
    }
    private void Client_McpStatusChanged() => Dispatcher.BeginInvoke(new Action(() =>
    {
        if (_disposed) return;
        if (_mcpUi?.Attachment is { Grant.IsActive: false }) _mcpUi.Invalidate();
        _mcpUi?.Refresh();
    }));
    private void ClearMcpStatus()
    {
        _mcpConnection = null;
        _mcpUi?.Invalidate();
        _mcpUi?.Refresh();
    }
    private Task RefreshMcpStatusAsync(ProductHostClient client)
    {
        if (ReferenceEquals(client, _client)) { _mcpUi?.Refresh(); _mcpUi?.NotifyHostReady(); }
        return Task.CompletedTask;
    }
}
