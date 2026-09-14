namespace Flamoris.Flamoris2D.ProductHost;

public sealed class StaleProjectionGate
{
    private readonly object _sync = new();
    private string? _documentToken;
    private long _revision = -1;
    private bool _isAuthoritative;

    public string? DocumentToken
    {
        get { lock (_sync) return _documentToken; }
    }

    public long Revision
    {
        get { lock (_sync) return _revision; }
    }

    public bool IsAuthoritative
    {
        get { lock (_sync) return _isAuthoritative; }
    }

    public void Attach(string documentToken, long revision)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(documentToken);
        if (revision < 0) throw new ArgumentOutOfRangeException(nameof(revision));
        lock (_sync)
        {
            _documentToken = documentToken;
            _revision = revision;
            _isAuthoritative = true;
        }
    }

    public void Accept(string documentToken, long revision)
    {
        lock (_sync)
        {
            if (!_isAuthoritative ||
                !string.Equals(_documentToken, documentToken, StringComparison.Ordinal))
                throw new StaleProjectionException(revision, _revision);
            if (revision < _revision) throw new StaleProjectionException(revision, _revision);
            _revision = revision;
        }
    }

    public void Invalidate()
    {
        lock (_sync)
        {
            _documentToken = null;
            _revision = -1;
            _isAuthoritative = false;
        }
    }
}
