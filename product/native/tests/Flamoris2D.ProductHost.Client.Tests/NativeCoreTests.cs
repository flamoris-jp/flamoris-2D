using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;

internal static class NativeCoreTests
{
    public static void Run(string hostPath)
    {
        if (!OperatingSystem.IsWindows()) return;
        if (NativeEngine.Version() != (1, 0)) throw new Exception("Unexpected native ABI version.");
        var path = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(hostPath)!,
            "../native/tests/temporal-conformance.json"));
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        using var engine = NativeEngine.Create();
        foreach (var fixture in document.RootElement.EnumerateArray())
        {
            var numerator = fixture.GetProperty("numerator").GetInt64();
            var denominator = fixture.GetProperty("denominator").GetInt64();
            var status = engine.NormalizeFrameRate(numerator, denominator, out var actual);
            if (fixture.TryGetProperty("error", out _))
            {
                if (status != NativeStatus.InvalidArgument) throw new Exception("Native rate accepted invalid JS input.");
                continue;
            }
            var expected = fixture.GetProperty("expected");
            if (status != NativeStatus.Ok ||
                actual.Numerator != expected.GetProperty("numerator").GetInt64() ||
                actual.Denominator != expected.GetProperty("denominator").GetInt64())
                throw new Exception($"Native frame rate differs from Product JS: {numerator}/{denominator}");
        }
        engine.Dispose();
        try
        {
            engine.NormalizeFrameRate(24, 1, out _);
            throw new Exception("Disposed native handle was accepted.");
        }
        catch (ObjectDisposedException) { }
    }
}
