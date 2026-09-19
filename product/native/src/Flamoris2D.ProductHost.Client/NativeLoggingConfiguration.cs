using System.Text.Json;
using Flamoris.Logging;

namespace Flamoris.Flamoris2D.ProductHost;

public static class NativeLoggingConfiguration
{
    private static readonly JsonSerializerOptions ReaderOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static JsonSerializerOptions JsonOptions { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string ApplicationDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FLAMORIS",
        "2D");

    public static string SettingsPath => Path.Combine(ApplicationDataDirectory, "native-settings.json");

    public static LoggingOptions CreateDefaultOptions() => new()
    {
        Level = "debug",
        Categories = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["mcp"] = "info",
            ["mcp.transport"] = "debug",
            ["mcp.auth"] = "warn",
        },
        Outputs =
        [
            new LogOutputOptions { Type = "console" },
            new LogOutputOptions
            {
                Type = "file",
                Path = "logs/flamoris-2d.log",
                Format = "text",
                Rotation = new LogRotationOptions
                {
                    Enabled = true,
                    MaxFileSizeMb = 20,
                    MaxFiles = 10,
                },
            },
        ],
    };

    public static LoggingOptions Load(out string? warning, string? settingsPath = null)
    {
        warning = null;
        var path = settingsPath ?? SettingsPath;
        try
        {
            if (!File.Exists(path)) return CreateDefaultOptions();
            var info = new FileInfo(path);
            if (info.Length > 64 * 1024)
            {
                warning = "Settings file exceeds the 64 KiB limit.";
                return CreateDefaultOptions();
            }

            using var document = JsonDocument.Parse(File.ReadAllBytes(path));
            if (!document.RootElement.TryGetProperty("logging", out var logging) ||
                logging.ValueKind != JsonValueKind.Object)
                return CreateDefaultOptions();
            return logging.Deserialize<LoggingOptions>(ReaderOptions) ?? CreateDefaultOptions();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            warning = error.GetType().Name;
            return CreateDefaultOptions();
        }
    }

    public static FlamorisLogger CreateLogger(
        LoggingOptions options,
        string? basePath = null,
        Action<string>? diagnostic = null) =>
        FlamorisLogger.Create(options, basePath ?? ApplicationDataDirectory, diagnostic);
}
