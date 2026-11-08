using System.Text.Json;

namespace Flamoris.Flamoris2D.Session;

// Immutable, fully validated source replacement. No native handles escape its
// preparation workspace; ordinary source conversion remains the sole importer.
public sealed class SourceImportCandidate
{
    internal JsonElement Project { get; }
    internal IReadOnlyDictionary<string, WorkspaceArtwork> Artwork { get; }
    internal SourceImportCandidate(JsonElement project, IReadOnlyDictionary<string, WorkspaceArtwork> artwork)
    { Project = project; Artwork = artwork; }
}

public sealed partial class NativeWorkspace
{
    public static async Task<SourceImportCandidate> PrepareSourceImportAsync(byte[] bytes, string kind, string fileName, CancellationToken token = default)
    {
        await using var candidate = new NativeWorkspace();
        await candidate.ImportAsync(bytes, kind, fileName, token: token).ConfigureAwait(false);
        return await candidate.InvokeAsync(w => new SourceImportCandidate(w.Project, w.Artwork), token).ConfigureAwait(false);
    }

    // Called on the same serialized lane as UI/MCP edits. All fallible source
    // preparation, including source-part inclusion, happened before this commit.
    public WorkspaceSnapshot CommitSourceImport(SourceImportCandidate candidate, string expectedToken, long expectedRevision, CancellationToken token = default)
    {
        AssertCurrent(expectedToken, expectedRevision);
        CheckArtworkBudget(candidate.Artwork);
        Replace(candidate.Project, candidate.Artwork, null, true, null, null, token);
        return Snapshot;
    }
}
