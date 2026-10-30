using System.IO;
using Flamoris.Capture.Wpf;
using Flamoris.Flamoris2D.Native.Client;
using Flamoris.Mcp.Wpf;
using CorePermission = Flamoris.Mcp.Core.McpPermission;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private EmbeddedWindowCapture? _capture;
    private McpConnection? _mcpConnection;
    private McpDesktopUi? _mcpUi;
    private void InitializeMcpUi()
    {
        _mcpUi = new(this, McpMenu, "flamoris-2d",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FLAMORIS", "2D", "mcp-connection.json"),
            "FLAMORIS.2D", Path.Combine(AppContext.BaseDirectory, "mcp", "Flamoris.Mcp.Bridge.exe"),
            AttachMcp, () => _client?.IsRunning == true && !_disposed);
        McpStatusPanel.Content = _mcpUi.StatusIndicator;
        _capture = new EmbeddedWindowCapture(this);
        CaptureStatusPanel.Content = _capture.Control;
    }
    private async Task<McpDesktopAttachment> AttachMcp(CorePermission permission)
    {
        var client = _client ?? throw new InvalidOperationException("Native editing authority unavailable.");
        var captureLease = _capture!.BeginConnection();
        try
        {
            _mcpConnection = await client.EnableMcpAsync(permission == CorePermission.Edit ? McpPermission.Edit : McpPermission.ReadOnly,
                startLocalEndpoint: false, additionalTools: _capture.Tools(), applicationLifetime: true);
            return new(client.LiveMcpBoundary!, client.LiveMcpGrant!, async () =>
            {
                captureLease.Dispose();
                await client.DisableMcpAsync();
            });
        }
        catch { captureLease.Dispose(); throw; }
    }
    private void Client_McpStatusChanged() => Dispatcher.BeginInvoke(new Action(() =>
    {
        if (_disposed) return;
        if (_mcpUi?.Attachment is { Grant.IsActive: false }) _mcpUi.Invalidate();
        _mcpUi?.Refresh();
    }));
    private void ClearMcpStatus()
    {
        _capture?.Stop();
        if (_disposed || _client?.IsRunning != true)
        {
            _mcpConnection = null;
            _mcpUi?.Invalidate();
        }
        _mcpUi?.Refresh();
    }
    private Task RefreshMcpStatusAsync(NativeSessionClient client)
    {
        if (ReferenceEquals(client, _client)) { _mcpUi?.Refresh(); _mcpUi?.NotifyHostReady(); }
        return Task.CompletedTask;
    }
}
