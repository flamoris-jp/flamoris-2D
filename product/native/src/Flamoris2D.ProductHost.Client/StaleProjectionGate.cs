namespace Flamoris.Flamoris2D.ProductHost;

public sealed class StaleProjectionGate
{
    public string? DocumentToken { get; private set; }
    public long Revision { get; private set; } = -1;
    public bool IsAuthoritative { get; private set; }

    public void Attach(string documentToken, long revision)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(documentToken);
        if (revision < 0) throw new ArgumentOutOfRangeException(nameof(revision));
        DocumentToken = documentToken;
        Revision = revision;
        IsAuthoritative = true;
    }

    public void Accept(string documentToken, long revision)
    {
        if (!IsAuthoritative || !string.Equals(DocumentToken, documentToken, StringComparison.Ordinal))
            throw new StaleProjectionException(revision, Revision);
        if (revision < Revision) throw new StaleProjectionException(revision, Revision);
        Revision = revision;
    }

    public void Invalidate()
    {
        DocumentToken = null;
        Revision = -1;
        IsAuthoritative = false;
    }
}
