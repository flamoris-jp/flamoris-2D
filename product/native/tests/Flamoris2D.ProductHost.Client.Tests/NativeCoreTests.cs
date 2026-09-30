using System.Text.Json;
using Flamoris.Flamoris2D.Core.Interop;

internal static class NativeCoreTests
{
    public static void Run(string hostPath)
    {
        if (!OperatingSystem.IsWindows()) return;
        if (NativeEngine.Version() != (1, 4)) throw new Exception("Unexpected native ABI version.");
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
        TestSessions(path);
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
                var sceneNodes = fixture.GetProperty("project").GetProperty("scene").GetProperty("nodes");
                foreach (var keyedNode in sceneNodes.EnumerateObject())
                {
                    var node = keyedNode.Value;
                    var id = node.GetProperty("id").GetString()!;
                    if (snapshot.NodeField(id, "id") != id) throw new Exception("Stable node lookup changed.");
                    var state = snapshot.NodeState(id);
                    var transform = node.GetProperty("transform");
                    var position = transform.GetProperty("position");
                    var scale = transform.GetProperty("scale");
                    var pivot = transform.GetProperty("pivot");
                    if (state.PositionX != position.GetProperty("x").GetDouble() ||
                        (position.TryGetProperty("y", out var y) && state.PositionY != y.GetDouble()) ||
                        state.Rotation != transform.GetProperty("rotation").GetDouble() ||
                        state.ScaleX != scale.GetProperty("x").GetDouble() || state.ScaleY != scale.GetProperty("y").GetDouble() ||
                        state.PivotX != pivot.GetProperty("x").GetDouble() || state.PivotY != pivot.GetProperty("y").GetDouble() ||
                        state.Visible != (node.GetProperty("visible").GetBoolean() ? 1 : 0) ||
                        state.Opacity != node.GetProperty("opacity").GetDouble())
                        throw new Exception($"Native node state changed: {id}");
                    if (keyedNode.Name != id)
                    {
                        var keyResolved = true;
                        try { snapshot.NodeField(keyedNode.Name, "id"); }
                        catch (InvalidOperationException) { keyResolved = false; }
                        if (keyResolved) throw new Exception("Object key resolved as stable ID.");
                    }
                }
                var actual = Enumerable.Range(0, checked((int)summary.IssueCount)).Select(i => snapshot.Issue((uint)i))
                    .Select(x => (x.Code, x.Path, x.EntityId, x.Severity)).Order().ToArray();
                var expected = fixture.GetProperty("expected").EnumerateArray()
                    .Select(x => (x.GetProperty("code").GetString()!, x.GetProperty("path").GetString()!, x.GetProperty("entityId").GetString()!, x.GetProperty("severity").GetString()!))
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
    private static void TestSessions(string temporalFixturePath)
    {
        var path = Path.Combine(Path.GetDirectoryName(temporalFixturePath)!, "session-conformance.json");
        using var fixtures = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = fixtures.RootElement;
        var initial = System.Text.Encoding.UTF8.GetBytes(root.GetProperty("initial").GetRawText());
        if (NativeSession.TryCreate(initial, out var session) != NativeStatus.Ok || session is null)
            throw new Exception("Native session rejected JS fixture.");
        using (session)
        {
            if (session.NodeField("part_1", "displayName") != "前髪") throw new Exception("Session node query failed.");
            var edit = root.GetProperty("steps")[0];
            var bytes = System.Text.Encoding.UTF8.GetBytes(edit.GetProperty("commands").GetRawText());
            if (session.TryPrepare(bytes, edit.GetProperty("label").GetString()!, out var prepared) != NativeStatus.Ok || prepared is null)
                throw new Exception("Native prepare failed.");
            using (prepared)
            {
                if (prepared.Commit() != NativeStatus.Ok || prepared.Commit() != NativeStatus.RevisionConflict)
                    throw new Exception("Prepared commit was not one-shot.");
            }
            var state = session.State();
            if (state.CurrentRevision != 1 || state.UndoDepth != 1 || state.Dirty != 1)
                throw new Exception("Session revision changed.");
            if (session.NodeField("part_1", "displayName") != "夕暮れ") throw new Exception("Session edit failed.");
            if (session.TryPrepareUndo(out var undo) != NativeStatus.Ok || undo is null)
                throw new Exception("Undo prepare failed.");
            using (undo) if (undo.Commit() != NativeStatus.Ok) throw new Exception("Undo failed.");
            if (session.NodeField("part_1", "displayName") != "前髪" || session.State().RedoDepth != 1)
                throw new Exception("Undo did not restore state.");
            if (session.TryPrepareRedo(out var redo) != NativeStatus.Ok || redo is null)
                throw new Exception("Redo prepare failed.");
            using (redo) if (redo.Commit() != NativeStatus.Ok) throw new Exception("Redo failed.");
            if (session.NodeField("part_1", "displayName") != "夕暮れ") throw new Exception("Redo did not restore state.");
            TestQueries(session);
        }
        try { session.State(); throw new Exception("Disposed session was accepted."); }
        catch (ObjectDisposedException) { }
        try { session.Query("project.get_summary"); throw new Exception("Disposed query was accepted."); }
        catch (ObjectDisposedException) { }
    }

    private static void TestQueries(NativeSession session)
    {
        var beforeProject = session.ProjectJson(); var beforeHistory = session.HistoryJson();
        if (session.MarkSaved(-1) != NativeStatus.SavedRevisionInvalid) throw new Exception("Query setup error missing.");
        var beforeError = session.ErrorCode(); var beforeState = session.State();
        var summary = session.Query("project.get_summary");
        if (summary.GetProperty("id").GetString() != "project_あ") throw new Exception("Managed Product Query failed.");
        var node = session.Query("scene.get_node", JsonSerializer.SerializeToElement(new { nodeId = "part_1" }));
        if (node.GetProperty("displayName").GetString() != "夕暮れ" || node.GetProperty("worldTransform").GetArrayLength() != 6)
            throw new Exception("Managed scene projection changed.");
        var nullable = session.Query("bone.get_keyform", JsonSerializer.SerializeToElement(new { boneId = "missing", keyArtId = "missing" }));
        if (nullable.ValueKind != JsonValueKind.Null) throw new Exception("Managed nullable Query changed.");
        try { session.Query("bone.get"); throw new Exception("Missing selector was accepted."); }
        catch (NativeQueryException error) when (error.ProductName == "Error" && error.Message == "Unknown Bone undefined.") { }
        try { session.Query("unknown.query"); throw new Exception("Unknown Query was accepted."); }
        catch (NativeQueryException error) when (error.ProductName == "Error" && error.Message == "Unknown query unknown.query.") { }
        try { session.Query("transition.evaluate"); throw new Exception("Missing Transition time was accepted."); }
        catch (NativeQueryException error) when (error.ProductName == "RangeError" && error.Message == "Transition timeTicks must be a safe integer.") { }
        try { session.Query("sequence.evaluate"); throw new Exception("Missing Sequence selector was accepted."); }
        catch (NativeQueryException error) when (error.ProductName == "Error" && error.Message == "Unknown Sequence undefined.") { }
        try { session.Query("export.evaluate_frame"); throw new Exception("Missing export owner was accepted."); }
        catch (NativeQueryException error) when (error.ProductName == "Error" && error.Message == "Unknown Transition null.") { }
        try { session.Query("skin.evaluate"); throw new Exception("Missing Skin selector was accepted."); }
        catch (NativeQueryException error) when (error.ProductName == "Error" && error.Message == "Unknown SkinBinding undefined.") { }
        if (beforeProject != session.ProjectJson() || beforeHistory != session.HistoryJson() ||
            beforeError != session.ErrorCode() || !beforeState.Equals(session.State()))
            throw new Exception("Managed Query mutated session state.");
    }

}
