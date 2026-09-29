using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;

internal static class NativeCoreTests
{
    public static void Run(string hostPath)
    {
        if (!OperatingSystem.IsWindows()) return;
        if (NativeEngine.Version() != (1, 1)) throw new Exception("Unexpected native ABI version.");
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
        TestSnapshots(path);
        engine.Dispose();
        try
        {
            engine.NormalizeFrameRate(24, 1, out _);
            throw new Exception("Disposed native handle was accepted.");
        }
        catch (ObjectDisposedException) { }
    }

    private static void TestSnapshots(string temporalFixturePath)
    {
        var fixturePath = Path.Combine(Path.GetDirectoryName(temporalFixturePath)!, "project-conformance.json");
        using var fixtures = JsonDocument.Parse(File.ReadAllBytes(fixturePath));
        foreach (var fixture in fixtures.RootElement.EnumerateArray())
        {
            var json = System.Text.Encoding.UTF8.GetBytes(fixture.GetProperty("project").GetRawText());
            if (NativeSnapshot.TryLoad(json, out var snapshot) != NativeStatus.Ok || snapshot is null)
                throw new Exception("Native snapshot rejected Product fixture.");
            using (snapshot)
            {
                var summary = snapshot.Summary();
                if (summary.Schema != fixture.GetProperty("project").GetProperty("schemaVersion").GetInt32())
                    throw new Exception("Snapshot schema changed.");
                if (snapshot.Field("id") != fixture.GetProperty("project").GetProperty("id").GetString())
                    throw new Exception("Snapshot identity changed.");
                var root = snapshot.Field("rootId");
                if (snapshot.NodeField(root, "id") != root)
                    throw new Exception("Root lookup changed.");
                var actual = Enumerable.Range(0, checked((int)summary.IssueCount)).Select(i => snapshot.Issue((uint)i))
                    .Select(x => (x.Code, x.Path, x.EntityId)).Order().ToArray();
                var expected = fixture.GetProperty("expected").EnumerateArray()
                    .Select(x => (x.GetProperty("code").GetString()!, x.GetProperty("path").GetString()!, x.GetProperty("entityId").GetString()!))
                    .Order().ToArray();
                if (!actual.SequenceEqual(expected)) throw new Exception($"Snapshot validation differs: {fixture.GetProperty("name")}");
            }
            try { snapshot.Summary(); throw new Exception("Disposed snapshot was accepted."); }
            catch (ObjectDisposedException) { }
        }
        if (NativeSnapshot.TryLoad([0xC0, 0xAF], out var invalid) != NativeStatus.InvalidUtf8 || invalid is not null)
            throw new Exception("Invalid UTF-8 was accepted.");
        if (NativeSnapshot.TryLoad([(byte)'{'], out invalid) != NativeStatus.MalformedJson || invalid is not null)
            throw new Exception("Malformed JSON was accepted.");
        if (NativeSnapshot.TryLoad(new byte[NativeSnapshot.MaxBytes + 1], out invalid) != NativeStatus.InputTooLarge || invalid is not null)
            throw new Exception("Oversized snapshot was accepted.");
    }
}
