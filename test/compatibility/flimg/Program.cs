using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Flamoris.Cutwork.Core;
using Flamoris.Cutwork.Imaging.Persistence;

internal static class Program
{
    private const int Width = 8;
    private const int Height = 6;
    private const string FixtureName = "cutwork-current-v2";
    private const string SourceName = "synthetic-cutwork-compatibility.png";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: dotnet run --project test/compatibility/flimg -p:CutworkRoot=<checkout> -- <output-directory>");
            return 2;
        }
        var cutworkRoot = Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>()
            .Single(value => value.Key == "CutworkRoot").Value!;
        var destination = Path.GetFullPath(args[0]);
        Directory.CreateDirectory(destination);
        var originalRgba = CreateOriginalRgba();
        var partSpecs = new[]
        {
            new PartSpec(Id(3), "Front cut", "face.front", true, 9, new(1, 1, 4, 3),
                [255, 128, 0, 64, 32, 200, 255, 96, 0, 64, 128, 255]),
            new PartSpec(Id(4), "Back cut", "hair.back", true, 2, new(3, 2, 3, 3),
                [96, 255, 32, 0, 128, 224, 255, 64, 0]),
            new PartSpec(Id(5), "Hidden cut", "eye.closed", false, 5, new(0, 4, 2, 2),
                [255, 0, 128, 64]),
        };
        var states = new List<LayerRestoreState>();
        var expectedLayers = new List<LayerExpectation>();
        foreach (var part in partSpecs)
        {
            states.Add(new PartLayerRestoreState(part.Id, part.Name, part.SemanticName,
                part.Visible, part.Bounds, part.Mask, part.Order));
            expectedLayers.Add(new(part.Id.ToString("D"), "part", part.Name, part.SemanticName,
                part.Visible, Rect(part.Bounds), part.Bounds.Width, part.Bounds.Height,
                Hex(ExpectedPartRgba(originalRgba, part)), PartOrder: part.Order));
        }

        states.Add(new BaseLayerRestoreState(Id(2), "Base", "body.base", true));
        expectedLayers.Add(new(Id(2).ToString("D"), "base", "Base", "body.base", true,
            new(0, 0, Width, Height), Width, Height, Hex(ExpectedBaseRgba(originalRgba, partSpecs))));

        byte[] patchRgba = [220, 60, 20, 255, 10, 200, 70, 128, 30, 90, 240, 0, 150, 80, 210, 96];
        var patchBounds = new DocumentRect(0, 0, 2, 2);
        var patchTransform = new PatchTransform(6, 2, 1.25, 30);
        DocumentPoint[] polygon = [new(0, 0), new(2, 0), new(2, 2), new(0, 2)];
        states.Add(new PatchLayerRestoreState(Id(6), "Transformed patch", "patch.edge", true,
            patchBounds, Bgra(patchRgba), patchTransform, polygon));
        expectedLayers.Add(new(Id(6).ToString("D"), "patch", "Transformed patch", "patch.edge",
            true, Rect(patchBounds), 2, 2, Hex(patchRgba),
            Transform: new(6, 2, 1.25, 30),
            SourcePolygon: polygon.Select(point => new PointExpectation(point.X, point.Y)).ToArray()));

        AddRepair(7, "Owned repair", "repair.face", true, new(1, 1, 2, 2),
            [40, 210, 70, 255, 40, 210, 70, 64, 15, 30, 50, 0, 210, 70, 140, 128], Id(3));
        AddRepair(8, "Global repair", "repair.global", true, new(5, 3, 2, 2),
            [100, 20, 230, 192, 70, 80, 90, 255, 20, 220, 60, 0, 240, 40, 80, 32], null);
        AddRepair(9, "Hidden owned repair", "repair.hidden", false, new(3, 2, 2, 2),
            [255, 10, 40, 255, 5, 90, 120, 96, 90, 40, 210, 128, 60, 250, 10, 0], Id(4));

        var document = CutworkDocument.Restore(Id(1),
            new OriginalAsset(SourceName, new(Width, Height), Width * 4, Bgra(originalRgba)), states);
        var writer = new FlimgArchiveCodec();
        var archivePath = Path.Combine(destination, FixtureName + ".flimg");
        using (var output = File.Create(archivePath)) writer.Write(output, document);

        // Windows also exercises the genuine PNG reader. Linux deliberately only
        // generates archives; FLAMORIS 2D then independently decodes their pixels.
#if CUTWORK_WPF_PNG
        using (var input = File.OpenRead(archivePath))
        {
            var restored = writer.Read(input);
            if (restored.Id != document.Id || restored.Layers.Count != states.Count)
                throw new InvalidDataException("Current Cutwork writer/reader did not preserve the synthetic document.");
        }
        const string encoderMode = "cutwork-wpf";
#else
        const string encoderMode = "portable-test-png-rgba8-gray8";
#endif
        WriteJson(destination, FixtureName + ".expectation.json", new
        {
            schemaVersion = FlimgArchiveCodec.SchemaVersion,
            canvas = new { width = Width, height = Height },
            documentId = document.Id.ToString("D"),
            sourceName = SourceName,
            originalRgbaHex = Hex(originalRgba),
            layers = expectedLayers,
        });
        string[] writerPaths = [
            "src/Cutwork.Imaging/Persistence/FlimgArchiveCodec.cs",
            "src/Cutwork.Imaging/Persistence/FlimgModels.cs",
            "src/Cutwork.Imaging/Persistence/PngAssetCodec.cs",
        ];
        var paths = writerPaths.Concat(Directory.EnumerateFiles(Path.Combine(cutworkRoot, "src/Cutwork.Core"), "*.cs")
                .Select(path => Path.GetRelativePath(cutworkRoot, path).Replace('\\', '/')))
            .Order(StringComparer.Ordinal).ToArray();
        var sourceHashes = paths.ToDictionary(path => path,
            path => Hash(File.ReadAllBytes(Path.Combine(cutworkRoot, path))), StringComparer.Ordinal);
        WriteJson(destination, FixtureName + ".provenance.json", new
        {
            cutworkRepository = "flamoris-jp/flamoris-cutwork",
            cutworkCommit = Git(cutworkRoot, "rev-parse", "HEAD"),
            sourceWorktreeDirty = Git(cutworkRoot, ["status", "--porcelain", "--", ..paths]).Length != 0,
            schemaVersion = FlimgArchiveCodec.SchemaVersion,
            pngEncoderMode = encoderMode,
            archiveSha256 = Hash(File.ReadAllBytes(archivePath)),
            sourceSha256 = sourceHashes,
        });
        Console.WriteLine($"Generated {Path.GetFileName(archivePath)} ({encoderMode}, schema {FlimgArchiveCodec.SchemaVersion}).");
        return 0;

        void AddRepair(int number, string name, string semanticName, bool visible,
            DocumentRect bounds, byte[] rgba, Guid? owner)
        {
            states.Add(new RepairLayerRestoreState(Id(number), name, semanticName, visible, bounds, Bgra(rgba), owner));
            expectedLayers.Add(new(Id(number).ToString("D"), "repair", name, semanticName, visible,
                Rect(bounds), bounds.Width, bounds.Height, Hex(rgba), OwnerPartId: owner?.ToString("D")));
        }
    }

    private static Guid Id(int number) => Guid.Parse($"15000000-0000-0000-0000-{number:x12}");
    private static string Hex(byte[] pixels) => Convert.ToHexStringLower(pixels);
    private static string Hash(byte[] bytes) => Hex(SHA256.HashData(bytes));
    private static RectExpectation Rect(DocumentRect bounds) => new(bounds.X, bounds.Y, bounds.Width, bounds.Height);

    private static byte[] Bgra(byte[] rgba)
    {
        var bytes = rgba.ToArray();
        for (var offset = 0; offset < bytes.Length; offset += 4)
            (bytes[offset], bytes[offset + 2]) = (bytes[offset + 2], bytes[offset]);
        return bytes;
    }

    private static byte[] CreateOriginalRgba()
    {
        var pixels = new byte[Width * Height * 4];
        byte[] alpha = [255, 128, 64, 0];
        for (var y = 0; y < Height; y++)
            for (var x = 0; x < Width; x++)
            {
                var offset = (y * Width + x) * 4;
                pixels[offset] = (byte)((17 + 23 * x + 7 * y) % 256);
                pixels[offset + 1] = (byte)((31 + 11 * x + 29 * y) % 256);
                pixels[offset + 2] = (byte)((47 + 13 * x + 5 * y) % 256);
                pixels[offset + 3] = alpha[(x + 2 * y) % 4];
            }
        return pixels;
    }

    // Independent oracle: mathematical alpha coverage over synthetic RGBA input.
    // It does not call either Cutwork's compositor or FLAMORIS 2D's importer.
    private static byte[] ExpectedPartRgba(byte[] original, PartSpec part)
    {
        var result = new byte[part.Bounds.Width * part.Bounds.Height * 4];
        for (var y = 0; y < part.Bounds.Height; y++)
            for (var x = 0; x < part.Bounds.Width; x++)
            {
                var local = y * part.Bounds.Width + x;
                var source = ((part.Bounds.Y + y) * Width + part.Bounds.X + x) * 4;
                Array.Copy(original, source, result, local * 4, 4);
                result[local * 4 + 3] = Coverage(original[source + 3], part.Mask[local]);
            }
        return result;
    }

    private static byte[] ExpectedBaseRgba(byte[] original, PartSpec[] parts)
    {
        var result = original.ToArray();
        for (var y = 0; y < Height; y++)
            for (var x = 0; x < Width; x++)
            {
                var excluded = parts.Where(part => part.Bounds.Contains(new DocumentRect(x, y, 1, 1)))
                    .Select(part => (int)part.Mask[(y - part.Bounds.Y) * part.Bounds.Width + x - part.Bounds.X])
                    .DefaultIfEmpty(0).Max();
                var offset = (y * Width + x) * 4 + 3;
                result[offset] = Coverage(original[offset], 255 - excluded);
            }
        return result;
    }

    private static byte Coverage(byte originalAlpha, int mask) =>
        (byte)Math.Floor((originalAlpha * mask + 127) / 255.0);

    private static void WriteJson<T>(string destination, string name, T value) =>
        File.WriteAllText(Path.Combine(destination, name), JsonSerializer.Serialize(value, JsonOptions) + "\n");

    private static string Git(string root, params string[] args)
    {
        var start = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("-C");
        start.ArgumentList.Add(root);
        foreach (var argument in args) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new IOException("Could not start git for writer provenance.");
        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new IOException("Could not resolve Cutwork writer provenance: " + error);
        return output.Trim();
    }

    private sealed record PartSpec(Guid Id, string Name, string SemanticName, bool Visible,
        int Order, DocumentRect Bounds, byte[] Mask);
    private sealed record RectExpectation(int X, int Y, int Width, int Height);
    private sealed record TransformExpectation(double CenterX, double CenterY, double Scale, double RotationDegrees);
    private sealed record PointExpectation(double X, double Y);
    private sealed record LayerExpectation(string Id, string Kind, string Name, string SemanticName,
        bool Visible, RectExpectation Bounds, int ImageWidth, int ImageHeight, string RgbaHex,
        int? PartOrder = null, string? OwnerPartId = null, TransformExpectation? Transform = null,
        PointExpectation[]? SourcePolygon = null);
}
