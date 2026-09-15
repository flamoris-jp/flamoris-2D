using System.Globalization;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace Flamoris.Flamoris2D.App;

public sealed class TimelineViewport : FrameworkElement
{
    private sealed record Hit(string Kind,string Id,string? Track,string? Channel,Rect Bounds,long Start,long End);
    private readonly List<Hit> _hits=[];
    private JsonElement _state;
    private Hit? _drag;
    private double _dragStartX,_dragX;
    private long _duration,_revision;
    private const double LabelWidth=160,Row=29;
    public long Playhead {get;set;}
    public event Action<long>? Scrubbed;
    public event Action<string,string,string>? KeyPicked;
    public event Action<string>? ViewPicked;
    public event Action<string>? ClipPicked;
    public event Action<string,string,string,long,long>? KeyMoved;
    public event Action<string,long,long,long>? ClipMoved;
    public event Action<string>? TrackPicked;
    private static JsonElement[] Items(JsonElement e,string field)=>e.ValueKind==JsonValueKind.Object&&e.TryGetProperty(field,out var a)&&a.ValueKind==JsonValueKind.Array?a.EnumerateArray().ToArray():[];
    private static string Text(JsonElement e,string field)=>e.TryGetProperty(field,out var p)?p.GetString()??"":"";
    public TimelineViewport(){Focusable=true;LostMouseCapture+=(_,_)=>{_drag=null;InvalidateVisual();};}
    public void Apply(JsonElement state,long revision)
    {
        if(_revision!=revision){_drag=null;if(IsMouseCaptured)ReleaseMouseCapture();}
        _state=state;_revision=revision;
        var program=state.GetProperty("program");_duration=program.ValueKind==JsonValueKind.Object?program.GetProperty("durationTicks").GetInt64():0;
        var rows=3+Items(state,"tracks").Sum(t=>t.GetProperty("channels").EnumerateObject().Count());
        Height=Math.Max(110,rows*Row);InvalidateVisual();
    }
    private double X(long tick)=>LabelWidth+(_duration>0?(double)tick/_duration:0)*Math.Max(1,ActualWidth-LabelWidth-12);
    private long Tick(double x)=>_duration<=0?0:Math.Clamp((long)Math.Round((x-LabelWidth)/Math.Max(1,ActualWidth-LabelWidth-12)*_duration),0,_duration);
    private void Label(DrawingContext dc,string value,double x,double y,Brush? brush=null)
    {
        var text=new FormattedText(value,CultureInfo.CurrentCulture,FlowDirection.LeftToRight,new Typeface("Yu Gothic UI"),11,
            brush??Brushes.LightGray,VisualTreeHelper.GetDpi(this).PixelsPerDip){MaxTextWidth=LabelWidth-12};
        dc.DrawText(text,new Point(x,y));
    }
    protected override void OnRender(DrawingContext dc)
    {
        dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(29,31,34)),null,new Rect(RenderSize));_hits.Clear();
        if(_state.ValueKind!=JsonValueKind.Object)return;
        Label(dc,"時刻 / ticks",6,5);
        for(var i=0;i<=8;i++){var tick=(long)((decimal)_duration*i/8);var x=X(tick);dc.DrawLine(new Pen(Brushes.DimGray,.5),new Point(x,20),new Point(x,ActualHeight));Label(dc,tick.ToString(),x+2,4);}
        double y=Row;
        void Lane(string field,string label,string kind,Brush brush)
        {
            Label(dc,label,6,y+5);
            foreach(var item in Items(_state,field))
            {
                var start=item.GetProperty("startTicks").GetInt64();var end=item.GetProperty("endTicks").GetInt64();var id=Text(item,"id");
                var x=X(start);var width=Math.Max(3,X(end)-x);
                if(_drag?.Id==id&&kind=="clip")x+=_dragX-_dragStartX;
                var bounds=new Rect(x,y+3,width,Row-6);dc.DrawRectangle(brush,new Pen(Brushes.LightGray,.5),bounds);
                Label(dc,field=="viewItems"?Text(item,"referenceName"):Text(item,"clipName"),x+4,y+6,Brushes.White);
                _hits.Add(new(kind,id,null,null,bounds,start,end));
            }
            y+=Row;
        }
        if(_state.GetProperty("selectedClipId").ValueKind==JsonValueKind.Null&&!_state.TryGetProperty("transitionId",out _))
        {
            Lane("viewItems","原画・遷移 / ViewLane","view",Brushes.DarkSlateBlue);
            Lane("clipInstances","クリップ配置","clip",Brushes.DarkCyan);
        }
        foreach(var track in Items(_state,"tracks"))
        {
            var trackId=Text(track,"trackId");
            foreach(var channel in track.GetProperty("channels").EnumerateObject())
            {
                Label(dc,Text(track,"kind").Replace("Track","")+" · "+channel.Name,6,y+5);
                _hits.Add(new("track",trackId,trackId,channel.Name,new Rect(0,y,LabelWidth,Row),0,0));
                dc.DrawLine(new Pen(Brushes.DimGray,.6),new Point(LabelWidth,y+Row/2),new Point(ActualWidth,y+Row/2));
                foreach(var frame in Items(channel.Value,"keyframes"))
                {
                    var id=Text(frame,"id");var tick=frame.GetProperty("timeTicks").GetInt64();var x=X(tick);
                    if(_drag?.Id==id)x=_dragX;
                    var center=new Point(x,y+Row/2);dc.DrawEllipse(Brushes.Gold,new Pen(Brushes.Black,1),center,5,5);
                    _hits.Add(new("key",id,trackId,channel.Name,new Rect(x-8,y+Row/2-9,16,18),tick,tick));
                }
                y+=Row;
            }
        }
        dc.DrawLine(new Pen(Brushes.OrangeRed,1.5),new Point(X(Playhead),18),new Point(X(Playhead),ActualHeight));
    }
    protected override void OnMouseDown(MouseButtonEventArgs e)
    {
        if(e.ChangedButton!=MouseButton.Left)return;Focus();var point=e.GetPosition(this);
        var hit=_hits.LastOrDefault(h=>h.Bounds.Contains(point));
        if(hit is null){Scrubbed?.Invoke(Tick(point.X));e.Handled=true;return;}
        if(hit.Kind=="track"){TrackPicked?.Invoke(hit.Id);return;}
        if(hit.Kind=="view"){ViewPicked?.Invoke(hit.Id);return;}
        if(hit.Kind is "key" or "clip")
        {
            _drag=hit;_dragStartX=_dragX=point.X;CaptureMouse();
        }
        e.Handled=true;
    }
    protected override void OnMouseMove(MouseEventArgs e){if(_drag is null)return;_dragX=Math.Clamp(e.GetPosition(this).X,LabelWidth,ActualWidth-12);InvalidateVisual();}
    protected override void OnMouseUp(MouseButtonEventArgs e)
    {
        if(_drag is not { } hit)return;var x=_dragX;var difference=x-_dragStartX;_drag=null;ReleaseMouseCapture();
        if(Math.Abs(difference)<3)
        {if(hit.Kind=="key")KeyPicked?.Invoke(hit.Track!,hit.Channel!,hit.Id);else ClipPicked?.Invoke(hit.Id);}
        else if(hit.Kind=="key")KeyMoved?.Invoke(hit.Track!,hit.Channel!,hit.Id,Tick(x),_revision);
        else{var delta=Tick(X(hit.Start)+difference)-hit.Start;delta=Math.Clamp(delta,-hit.Start,_duration-hit.End);ClipMoved?.Invoke(hit.Id,hit.Start+delta,hit.End+delta,_revision);}
        InvalidateVisual();e.Handled=true;
    }
    protected override void OnKeyDown(KeyEventArgs e){if(e.Key==Key.Escape){_drag=null;if(IsMouseCaptured)ReleaseMouseCapture();InvalidateVisual();e.Handled=true;}}
}
