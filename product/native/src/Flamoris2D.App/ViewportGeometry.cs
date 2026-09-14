namespace Flamoris.Flamoris2D.App;

public readonly record struct Point2(double X, double Y);

// All values are DIPs except explicitly named device pixels. No Project coordinates are stored here.
public sealed class ViewportCamera
{
    public double Scale { get; private set; } = 1;
    public Point2 Origin { get; private set; }
    public Point2 ToView(Point2 point) => new(point.X * Scale + Origin.X, point.Y * Scale + Origin.Y);
    public Point2 ToDocument(Point2 point) => new((point.X - Origin.X) / Scale, (point.Y - Origin.Y) / Scale);
    public Point2 DeviceToDocument(Point2 device, double dpiX, double dpiY) =>
        ToDocument(new Point2(device.X / dpiX, device.Y / dpiY));
    public void Fit(double viewWidth, double viewHeight, double width, double height)
    {
        if (width <= 0 || height <= 0 || viewWidth <= 0 || viewHeight <= 0) return;
        Scale = Math.Clamp(Math.Min(Math.Max(1, viewWidth - 48) / width, Math.Max(1, viewHeight - 48) / height), .01, 64);
        Origin = new((viewWidth - width * Scale) / 2, (viewHeight - height * Scale) / 2);
    }
    public void Zoom(Point2 anchor, double factor)
    {
        var point = ToDocument(anchor);
        Scale = Math.Clamp(Scale * factor, .01, 64);
        Origin = new(anchor.X - point.X * Scale, anchor.Y - point.Y * Scale);
    }
    public void Pan(double x, double y) => Origin = new(Origin.X + x, Origin.Y + y);
}

public readonly record struct Affine2(double A, double B, double C, double D, double X, double Y)
{
    public static Affine2 Identity => new(1, 0, 0, 1, 0, 0);
    public Point2 Apply(Point2 p) => new(A * p.X + C * p.Y + X, B * p.X + D * p.Y + Y);
    public Point2 Inverse(Point2 p)
    {
        var det = A * D - B * C;
        if (Math.Abs(det) < 1e-12) throw new InvalidOperationException("対象の座標変換が反転できません。");
        return new((D * (p.X - X) - C * (p.Y - Y)) / det, (-B * (p.X - X) + A * (p.Y - Y)) / det);
    }
}

public static class VertexPicking
{
    public static int Hit(double[] positions, Point2 pointer, ViewportCamera camera, Affine2 world, double radius = 8)
    {
        var best = -1;
        var distance = radius * radius;
        for (var index = 0; index < positions.Length / 2; index++)
        {
            var p = camera.ToView(world.Apply(new(positions[index * 2], positions[index * 2 + 1])));
            var squared = Math.Pow(p.X - pointer.X, 2) + Math.Pow(p.Y - pointer.Y, 2);
            if (squared <= distance) { best = index; distance = squared; }
        }
        return best;
    }
}

// A disposable drag snapshot, never a persistent mesh or undo stack.
public sealed class LayoutGesture
{
    private readonly double[] _start;
    private readonly int[] _indices;
    private readonly Point2 _anchor;
    public LayoutGesture(string token, long revision, double[] positions, int[] indices, Point2 anchor)
    { Token = token; Revision = revision; _start = (double[])positions.Clone(); _indices = (int[])indices.Clone(); _anchor = anchor; }
    public string Token { get; }
    public long Revision { get; }
    public double[]? Preview { get; private set; }
    public void Move(Point2 current, bool snap)
    {
        var dx = current.X - _anchor.X;
        var dy = current.Y - _anchor.Y;
        if (snap) { dx = Math.Round(dx); dy = Math.Round(dy); }
        Preview = (double[])_start.Clone();
        foreach (var i in _indices) { Preview[i * 2] += dx; Preview[i * 2 + 1] += dy; }
    }
    public double[]? Finish(string token, long revision) => token == Token && revision == Revision &&
        Preview is { } p && !_start.SequenceEqual(p) ? (double[])p.Clone() : null;
}
