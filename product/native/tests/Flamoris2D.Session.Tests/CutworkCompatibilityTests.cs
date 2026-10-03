using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Flamoris.Flamoris2D.Session;
using Flamoris.Flamoris2D.Source;

internal static class CutworkCompatibilityTests
{
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("Cutwork compatibility: " + message);
    }

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    public static async Task RunAsync(string? fixtureDirectory = null)
    {
        fixtureDirectory ??= Path.Combine(AppContext.BaseDirectory, "fixtures", "cutwork");
        var archive = File.ReadAllBytes(Path.Combine(fixtureDirectory, "cutwork-current-v2.flimg"));
        using var oracle = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(fixtureDirectory, "cutwork-current-v2.expectation.json")));
        using var provenance = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(fixtureDirectory, "cutwork-current-v2.provenance.json")));
        Check(Convert.ToHexStringLower(SHA256.HashData(archive)) == provenance.RootElement.GetProperty("archiveSha256").GetString(),
            "archive differs from its recorded producer output.");
        var expected = oracle.RootElement;
        var decoded = FlimgCodec.Decode(archive);
        Check(decoded.Description.GetProperty("schemaVersion").GetInt32() == provenance.RootElement.GetProperty("schemaVersion").GetInt32(),
            "recorded producer schema differs from the archive.");
        Check(decoded.Images.Count == expected.GetProperty("layers").GetArrayLength(), "decoded artwork count changed.");
        foreach (var layer in expected.GetProperty("layers").EnumerateArray())
        {
            var image = decoded.Images[layer.GetProperty("id").GetString()!];
            Check(image.Width == layer.GetProperty("imageWidth").GetInt32() && image.Height == layer.GetProperty("imageHeight").GetInt32(),
                "decoded dimensions changed for " + layer.GetProperty("name").GetString());
            Check(image.Rgba.Span.SequenceEqual(Convert.FromHexString(layer.GetProperty("rgbaHex").GetString()!)),
                "graded masks, alpha or raster bytes changed for " + layer.GetProperty("name").GetString());
        }

        var directory = Path.Combine(Path.GetTempPath(), "flamoris-cutwork-compatibility-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "portrait.flimg");
            var savedPath = Path.Combine(directory, "portrait.fl2d");
            await File.WriteAllBytesAsync(sourcePath, archive);
            JsonElement savedProject;
            Dictionary<string, ArtworkIdentity> savedArtwork;
            await using (var workspace = new NativeWorkspace())
            {
                await workspace.ImportAsync(await File.ReadAllBytesAsync(sourcePath), "flimg", "portrait.flimg");
                var first = await workspace.InvokeAsync(w => { ValidateProject(w, expected); return w.Project; });
                await workspace.ImportAsync(archive, "flimg", "portrait.flimg");
                await workspace.InvokeAsync(w =>
                {
                    ValidateProject(w, expected);
                    Check(Identities(first).SequenceEqual(Identities(w.Project)), "same source acquired different native/source/semantic IDs.");
                    return true;
                });

                // Keep authored state and a redo branch alive while invalid candidates are decoded.
                string root = await workspace.InvokeAsync(w => w.Project.GetProperty("scene").GetProperty("rootId").GetString()!);
                await workspace.InvokeAsync(w => w.Execute(Rename(root, "authored root"), "authored root"));
                await workspace.InvokeAsync(w => w.Execute(Rename(root, "redo root"), "redo root"));
                await workspace.InvokeAsync(w => w.Undo());
                var pendingSave = await workspace.InvokeAsync(w => w.PrepareSave("save"));
                await RejectWithoutReplacement(workspace, Rewrite(archive, entries =>
                {
                    var manifest = JsonNode.Parse(entries["manifest.json"])!.AsObject();
                    manifest["schemaVersion"] = 3;
                    entries["manifest.json"] = JsonSerializer.SerializeToUtf8Bytes(manifest);
                }), "flimg.schema_unsupported", diagnostic =>
                    diagnostic.Contains("version 3", StringComparison.Ordinal) &&
                    diagnostic.Contains("1 and 2", StringComparison.Ordinal) &&
                    diagnostic.Contains("Update FLAMORIS 2D", StringComparison.Ordinal));
                await RejectWithoutReplacement(workspace, Rewrite(archive, entries => entries["assets/original.png"][^1] ^= 1),
                    "flimg.checksum_mismatch");
                await workspace.InvokeAsync(w =>
                {
                    Check(w.GetSave(pendingSave.Id, pendingSave.Identity.DocumentToken).Bytes.Span.SequenceEqual(pendingSave.Bytes.Span),
                        "failed import invalidated an existing save receipt.");
                    w.ReleaseSave(pendingSave.Id);
                    w.Redo();
                    Check(w.Project.GetProperty("scene").GetProperty("nodes").GetProperty(root).GetProperty("displayName").GetString() == "redo root",
                        "failed import damaged redo history.");
                    w.Undo();
                    return true;
                });
                savedProject = await workspace.InvokeAsync(w => { ValidateProject(w, expected); return w.Project; });
                savedArtwork = await workspace.InvokeAsync(CaptureArtwork);
                var save = await workspace.InvokeAsync(w => w.PrepareSave("save"));
                await File.WriteAllBytesAsync(savedPath, save.Bytes.ToArray());
                await workspace.InvokeAsync(w => w.AcknowledgeSave(save.ReceiptId!));
            }
            File.Delete(sourcePath);
            await using var reopened = new NativeWorkspace();
            await reopened.OpenAsync(await File.ReadAllBytesAsync(savedPath));
            await reopened.InvokeAsync(w =>
            {
                Check(JsonElement.DeepEquals(savedProject, w.Project), "native .fl2d round trip changed source/semantic/scene identities or authored state.");
                ValidateProject(w, expected);
                CompareArtwork(savedArtwork, CaptureArtwork(w), compareHandles: false);
                Check(w.Snapshot.State.Dirty == 0, "reopened .fl2d is dirty.");
                return true;
            });
            Console.WriteLine("Cutwork current writer: native identities/order/ownership/visibility/rasters, failure atomicity and source-independent .fl2d round trip passed.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    private static JsonElement Rename(string id, string name) => Json(new[] { new { type = "scene.rename_node", payload = new { nodeId = id, displayName = name } } });

    private static void ValidateProject(NativeWorkspace workspace, JsonElement expected)
    {
        var project = workspace.Project;
        Check(JsonElement.DeepEquals(project.GetProperty("canvas"), expected.GetProperty("canvas")), "canvas changed.");
        var source = project.GetProperty("sourceAssets").EnumerateArray().Single();
        Check(source.GetProperty("kind").GetString() == "cutwork-flimg", "wrong source kind.");
        var metadata = source.GetProperty("metadata");
        Check(metadata.GetProperty("documentId").GetString() == expected.GetProperty("documentId").GetString(), "document UUID changed.");
        Check(metadata.GetProperty("schemaVersion").GetInt32() == expected.GetProperty("schemaVersion").GetInt32(), "source schema provenance changed.");
        Check(metadata.GetProperty("original").GetProperty("sourceName").GetString() == expected.GetProperty("sourceName").GetString(), "original source name changed.");
        var nodes = project.GetProperty("scene").GetProperty("nodes");
        var children = nodes.GetProperty(project.GetProperty("scene").GetProperty("rootId").GetString()!).GetProperty("children");
        var art = project.GetProperty("keyArts").EnumerateArray().Single();
        var members = art.GetProperty("members");
        var layers = expected.GetProperty("layers");
        Check(children.GetArrayLength() == layers.GetArrayLength() && members.GetArrayLength() == layers.GetArrayLength(), "layer/member count changed.");
        Check(workspace.Artwork.Count == layers.GetArrayLength(), "hidden layer artwork was discarded.");
        var slots = project.GetProperty("semanticSlots").EnumerateArray().ToArray();
        for (int index = 0; index < layers.GetArrayLength(); index++)
        {
            var layer = layers[index];
            var id = layer.GetProperty("id").GetString()!;
            var nodeId = children[index].GetString()!;
            var node = nodes.GetProperty(nodeId);
            var sourceRef = node.GetProperty("sourceRef");
            Check(sourceRef.GetProperty("sourceKey").GetString() == "layer:" + id && sourceRef.GetProperty("sourceAssetId").GetString() == source.GetProperty("id").GetString(),
                "source UUID or manifest stack changed at index " + index);
            Check(sourceRef.GetProperty("identityKind").GetString() == "native" && !sourceRef.GetProperty("orderDependent").GetBoolean(), "stable UUID became order-dependent.");
            var cutwork = sourceRef.GetProperty("cutwork");
            foreach (string key in new[] { "id", "kind", "semanticName", "partOrder", "ownerPartId", "bounds", "transform", "sourcePolygon" })
            {
                if (!layer.TryGetProperty(key, out var value)) continue;
                var mapped = key switch { "id" => "layerId", "kind" => "layerKind", "bounds" => "authoredBounds", _ => key };
                Check(cutwork.TryGetProperty(mapped, out var actual) && JsonElement.DeepEquals(actual, value), "lost provenance " + key + " on " + id);
            }
            foreach (string key in new[] { "partOrder", "ownerPartId", "transform", "sourcePolygon" })
                if (!layer.TryGetProperty(key, out _)) Check(!cutwork.TryGetProperty(key, out _), "invented provenance " + key + " on " + id);
            Check(cutwork.GetProperty("documentId").GetString() == expected.GetProperty("documentId").GetString() && cutwork.GetProperty("manifestIndex").GetInt32() == index,
                "source document/stack provenance changed.");
            bool visible = layer.GetProperty("visible").GetBoolean();
            Check(node.GetProperty("displayName").GetString() == layer.GetProperty("name").GetString() && node.GetProperty("visible").GetBoolean() == visible,
                "layer name/visibility changed.");
            var member = members[index];
            Check(member.GetProperty("nodeId").GetString() == nodeId && member.GetProperty("drawOrder").GetInt32() == layers.GetArrayLength() - index - 1 &&
                member.GetProperty("presence").GetString() == (visible ? "present" : "absent"), "compositor order/presence changed.");
            Check(member.GetProperty("appearanceId").GetString() == source.GetProperty("id").GetString() + ":layer:" + id, "appearance source identity changed.");
            string? semantic = layer.GetProperty("semanticName").GetString();
            if (semantic is not null)
            {
                var slot = slots.Single(s => s.GetProperty("role").GetString() == semantic);
                var mapping = slot.GetProperty("mappings").EnumerateArray().Single();
                Check(mapping.GetProperty("nodeId").GetString() == nodeId && mapping.GetProperty("keyArtId").GetString() == art.GetProperty("id").GetString(), "semantic slot targets another layer.");
                Check(slot.GetProperty("metadata").GetProperty("cutworkLayerId").GetString() == id, "semantic source UUID changed.");
            }
            var bounds = layer.GetProperty("bounds");
            var image = workspace.Artwork[nodeId];
            Check(image.Width == layer.GetProperty("imageWidth").GetInt32() && image.Height == layer.GetProperty("imageHeight").GetInt32() &&
                image.Rgba.Span.SequenceEqual(Convert.FromHexString(layer.GetProperty("rgbaHex").GetString()!)), "native artwork bytes changed on " + id);
            bool patch = layer.GetProperty("kind").GetString() == "patch";
            Check(image.Left == (patch ? 0 : bounds.GetProperty("x").GetDouble()) && image.Top == (patch ? 0 : bounds.GetProperty("y").GetDouble()), "raster placement changed.");
            var nodeBounds = node.GetProperty("bounds");
            Near(nodeBounds.GetProperty("left").GetDouble(), image.Left);
            Near(nodeBounds.GetProperty("top").GetDouble(), image.Top);
            Near(nodeBounds.GetProperty("right").GetDouble(), image.Left + image.Width);
            Near(nodeBounds.GetProperty("bottom").GetDouble(), image.Top + image.Height);
            var transform = node.GetProperty("transform");
            if (patch)
            {
                var authored = layer.GetProperty("transform");
                Near(transform.GetProperty("position").GetProperty("x").GetDouble(), authored.GetProperty("centerX").GetDouble() - image.Width / 2.0);
                Near(transform.GetProperty("position").GetProperty("y").GetDouble(), authored.GetProperty("centerY").GetDouble() - image.Height / 2.0);
                Near(transform.GetProperty("rotation").GetDouble(), authored.GetProperty("rotationDegrees").GetDouble() * Math.PI / 180);
                Near(transform.GetProperty("scale").GetProperty("x").GetDouble(), authored.GetProperty("scale").GetDouble());
                Near(transform.GetProperty("scale").GetProperty("y").GetDouble(), authored.GetProperty("scale").GetDouble());
                Near(transform.GetProperty("pivot").GetProperty("x").GetDouble(), image.Width / 2.0);
                Near(transform.GetProperty("pivot").GetProperty("y").GetDouble(), image.Height / 2.0);
            }
            else
            {
                Near(transform.GetProperty("rotation").GetDouble(), 0);
                Near(transform.GetProperty("position").GetProperty("x").GetDouble(), 0);
                Near(transform.GetProperty("position").GetProperty("y").GetDouble(), 0);
                Near(transform.GetProperty("scale").GetProperty("x").GetDouble(), 1);
                Near(transform.GetProperty("scale").GetProperty("y").GetDouble(), 1);
                Near(transform.GetProperty("pivot").GetProperty("x").GetDouble(), 0);
                Near(transform.GetProperty("pivot").GetProperty("y").GetDouble(), 0);
            }
        }
        Check(slots.Count(s => s.GetProperty("role").ValueKind == JsonValueKind.String) == layers.EnumerateArray().Count(l => l.GetProperty("semanticName").ValueKind == JsonValueKind.String),
            "semantic roles were added or dropped.");
    }

    private static void Near(double actual, double expected) => Check(Math.Abs(actual - expected) < 1e-12, "transform conversion changed.");
    private static IEnumerable<string> Identities(JsonElement project) =>
        new[] { project.GetProperty("id").GetString()! }
            .Concat(project.GetProperty("scene").GetProperty("nodes").EnumerateObject().Select(n => n.Name).Order(StringComparer.Ordinal))
            .Concat(new[] { "sourceAssets", "keyArts", "semanticSlots" }.SelectMany(key => project.GetProperty(key).EnumerateArray().Select(item => item.GetProperty("id").GetString()!)));

    private sealed record ArtworkIdentity(string Handle, int Width, int Height, double Left, double Top, string Rgba);
    private static Dictionary<string, ArtworkIdentity> CaptureArtwork(NativeWorkspace workspace) => workspace.Artwork.ToDictionary(pair => pair.Key,
        pair => new ArtworkIdentity(pair.Value.Id, pair.Value.Width, pair.Value.Height, pair.Value.Left, pair.Value.Top, Convert.ToHexString(pair.Value.Rgba.Span)));

    private static void CompareArtwork(Dictionary<string, ArtworkIdentity> before, Dictionary<string, ArtworkIdentity> after, bool compareHandles)
    {
        Check(before.Keys.Order(StringComparer.Ordinal).SequenceEqual(after.Keys.Order(StringComparer.Ordinal)), "artwork source/node identities changed.");
        foreach (var pair in before)
            Check(compareHandles ? pair.Value == after[pair.Key] : pair.Value with { Handle = "" } == after[pair.Key] with { Handle = "" },
                "artwork content/placement or live handles changed.");
    }

    private static async Task RejectWithoutReplacement(NativeWorkspace workspace, byte[] candidate, string code, Func<string, bool>? diagnostic = null)
    {
        var before = await workspace.InvokeAsync(w => (Project: w.Project, Snapshot: w.Snapshot, History: w.History, Artwork: CaptureArtwork(w)));
        int changes = 0;
        void Changed(WorkspaceChanged _) => changes++;
        workspace.Changed += Changed;
        try
        {
            try { await workspace.ImportAsync(candidate, "flimg", "unsupported.flimg"); throw new InvalidOperationException("Invalid producer archive was accepted."); }
            catch (SourceDecodeException error)
            {
                Check(error.Code == code, "wrong import diagnostic: " + error.Code);
                Check(diagnostic?.Invoke(error.Message) != false, "unsupported schema diagnostic is not actionable.");
            }
            await workspace.InvokeAsync(w =>
            {
                Check(JsonElement.DeepEquals(before.Project, w.Project) && JsonElement.DeepEquals(before.History, w.History) && before.Snapshot == w.Snapshot,
                    "failed import replaced Project, revision, save state or history.");
                CompareArtwork(before.Artwork, CaptureArtwork(w), compareHandles: true);
                Check(changes == 0, "failed import published a document change.");
                return true;
            });
        }
        finally { workspace.Changed -= Changed; }
    }

    private static byte[] Rewrite(byte[] archive, Action<Dictionary<string, byte[]>> mutate)
    {
        var entries = FlimgCodec.ReadZip(archive);
        mutate(entries);
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var pair in entries)
            {
                var entry = zip.CreateEntry(pair.Key, CompressionLevel.Optimal);
                entry.LastWriteTime = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
                using var stream = entry.Open();
                stream.Write(pair.Value);
            }
        return output.ToArray();
    }
}
