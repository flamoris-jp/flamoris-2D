using System.Globalization;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public sealed partial class MeshViewport
{
    public bool RigEnabled { get; set; }
    public string RigSubcontext { get; set; } = "Bone";
    public string RigTool { get; set; } = "選択";
    public double WeightStrength { get; set; } = .1;
    private JsonElement _rig;
    private string? _boneId, _warpId;
    private bool _poseMode;
    private HashSet<string> _controlPoints = [];
    private Point2? _rigStart, _rigCurrent;
    private readonly HashSet<string> _paintVertices = [];
    public event Action<string>? BonePicked;
    public event Action<string,bool>? ControlPointPicked;
    public event Action<Point2,Point2,bool>? BoneMoveRequested;
    public event Action<Point2,Point2>? BoneCreateRequested;
    public event Action? BoneDeleteRequested;
    public event Action<Point2,Point2>? WarpMoveRequested;
    public event Action<string[],double,bool>? WeightPaintRequested;
    public void ApplyRig(JsonElement rig,string? boneId,string? warpId,bool poseMode,HashSet<string> controlPoints)
    { _rig=rig;_boneId=boneId;_warpId=warpId;_poseMode=poseMode;_controlPoints=new(controlPoints);InvalidateVisual(); }
    private static JsonElement[] Items(JsonElement e,string key) => e.ValueKind==JsonValueKind.Object&&e.TryGetProperty(key,out var a)&&a.ValueKind==JsonValueKind.Array?a.EnumerateArray().ToArray():[];
    private static string? Id(JsonElement e,string key) => e.ValueKind==JsonValueKind.Object&&e.TryGetProperty(key,out var s)&&s.ValueKind==JsonValueKind.String?s.GetString():null;
    private Point RigScreen(Point2 point){var p=Camera.ToView(point);return new(p.X,p.Y);}
    private (Point2 Head,Point2 Tip) BonePoints(JsonElement pose)
    {
        if(_poseMode)return(new(pose.GetProperty("head").GetProperty("x").GetDouble(),pose.GetProperty("head").GetProperty("y").GetDouble()),
            new(pose.GetProperty("tip").GetProperty("x").GetDouble(),pose.GetProperty("tip").GetProperty("y").GetDouble()));
        var matrix=Transform(pose.GetProperty("bindMatrix"));
        var bone=Items(_rig,"bones").First(b=>Id(b,"id")==Id(pose,"boneId"));
        return(matrix.Apply(new(0,0)),matrix.Apply(new(bone.GetProperty("length").GetDouble(),0)));
    }
    private JsonElement SelectedWarp => Items(_rig,"warps").FirstOrDefault(w=>Id(w,"id")==_warpId);
    private void DrawRig(DrawingContext dc)
    {
        if(!RigEnabled||_rig.ValueKind!=JsonValueKind.Object)return;
        if(RigSubcontext=="Bone")foreach(var pose in Items(_rig.GetProperty("fk"),"poses"))
        {
            var (head,tip)=BonePoints(pose);var selected=Id(pose,"boneId")==_boneId;
            if(selected&&_rigStart is { } start&&_rigCurrent is { } current&&RigTool=="移動")
            {head=new(head.X+current.X-start.X,head.Y+current.Y-start.Y);tip=new(tip.X+current.X-start.X,tip.Y+current.Y-start.Y);}
            dc.DrawLine(new Pen(Brushes.Black,7),RigScreen(head),RigScreen(tip));
            dc.DrawLine(new Pen(selected?Brushes.Gold:Brushes.LightGreen,4),RigScreen(head),RigScreen(tip));
            dc.DrawEllipse(selected?Brushes.Gold:Brushes.LightGreen,new Pen(Brushes.Black,1),RigScreen(head),5,5);
        }
        else if(RigSubcontext=="Warp"&&SelectedWarp is {ValueKind:JsonValueKind.Object} warp)
        {
            var points=Items(warp,"positions");var columns=warp.GetProperty("columns").GetInt32();var world=Transform(warp.GetProperty("worldTransform"));
            Point At(int i){var p=world.Apply(new(points[i].GetProperty("x").GetDouble(),points[i].GetProperty("y").GetDouble()));
                if(_controlPoints.Contains(Id(points[i],"controlPointId")!)&&_rigStart is { } a&&_rigCurrent is { } b)p=new(p.X+b.X-a.X,p.Y+b.Y-a.Y);return RigScreen(p);}
            for(var i=0;i<points.Length;i++)
            {
                if(i%columns+1<columns)dc.DrawLine(new Pen(Brushes.Violet,1.5),At(i),At(i+1));
                if(i+columns<points.Length)dc.DrawLine(new Pen(Brushes.Violet,1.5),At(i),At(i+columns));
                dc.DrawEllipse(_controlPoints.Contains(Id(points[i],"controlPointId")!)?Brushes.Gold:Brushes.Violet,new Pen(Brushes.Black,1),At(i),5,5);
            }
        }
        else if(RigSubcontext=="Weight")
        {
            var binding=Items(_rig,"skinBindings").FirstOrDefault(b=>Id(b,"targetNodeId")==NodeId);
            for(var i=0;i<VertexIds.Length;i++)
            {
                var entry=Items(binding,"vertexWeights").FirstOrDefault(v=>Id(v,"vertexId")==VertexIds[i]);
                var influence=Items(entry,"influences").FirstOrDefault(v=>Id(v,"boneId")==_boneId);
                var weight=influence.ValueKind==JsonValueKind.Object?influence.GetProperty("weight").GetDouble():0;
                var colour=new SolidColorBrush(Color.FromRgb((byte)(255*weight),50,(byte)(255*(1-weight))));
                dc.DrawEllipse(colour,new Pen(Selected.Contains(VertexIds[i])||_paintVertices.Contains(VertexIds[i])?Brushes.White:Brushes.Black,2),Screen(Positions[i*2],Positions[i*2+1]),5,5);
            }
        }
        if(RigTool=="追加"&&_rigStart is { } from&&_rigCurrent is { } to)dc.DrawLine(new Pen(Brushes.Gold,3),RigScreen(from),RigScreen(to));
    }
    private bool RigDown(Point2 pointer)
    {
        if(!RigEnabled||Busy)return false;
        var document=Camera.ToDocument(pointer);
        if(RigSubcontext=="Bone")
        {
            if(RigTool=="追加"){_rigStart=_rigCurrent=document;CaptureMouse();return true;}
            var candidates=Items(_rig.ValueKind==JsonValueKind.Object?_rig.GetProperty("fk"):default,"poses");
            var nearest=candidates.Select(p=>(Pose:p,Point:Camera.ToView(BonePoints(p).Head))).OrderBy(p=>Math.Pow(p.Point.X-pointer.X,2)+Math.Pow(p.Point.Y-pointer.Y,2)).FirstOrDefault();
            if(nearest.Pose.ValueKind==JsonValueKind.Object&&Math.Pow(nearest.Point.X-pointer.X,2)+Math.Pow(nearest.Point.Y-pointer.Y,2)<=144)
            {
                var id=Id(nearest.Pose,"boneId")!;
                if(id!=_boneId){BonePicked?.Invoke(id);return true;}
                if(RigTool=="削除"){BoneDeleteRequested?.Invoke();return true;}
                if(RigTool=="移動"){_rigStart=_rigCurrent=document;CaptureMouse();}
            }
        }
        else if(RigSubcontext=="Warp"&&SelectedWarp is {ValueKind:JsonValueKind.Object} warp)
        {
            var world=Transform(warp.GetProperty("worldTransform"));
            var hit=Items(warp,"positions").Select(p=>(Item:p,Point:Camera.ToView(world.Apply(new(p.GetProperty("x").GetDouble(),p.GetProperty("y").GetDouble())))))
                .OrderBy(p=>Math.Pow(p.Point.X-pointer.X,2)+Math.Pow(p.Point.Y-pointer.Y,2)).FirstOrDefault();
            if(hit.Item.ValueKind==JsonValueKind.Object&&Math.Pow(hit.Point.X-pointer.X,2)+Math.Pow(hit.Point.Y-pointer.Y,2)<=100)
            {
                var id=Id(hit.Item,"controlPointId")!;var additive=Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
                if(!_controlPoints.Contains(id)||additive){ControlPointPicked?.Invoke(id,additive);return true;}
                if(RigTool=="移動"){_rigStart=_rigCurrent=document;CaptureMouse();}
            }
        }
        else if(RigSubcontext=="Weight")
        {
            var hit=VertexPicking.Hit(Positions,pointer,Camera,World,12);
            if(hit>=0)
            {
                if(RigTool=="選択"){if(!Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))Selected.Clear();Selected.Add(VertexIds[hit]);SelectionChanged?.Invoke();}
                else {_rigStart=_rigCurrent=document;_paintVertices.Clear();_paintVertices.Add(VertexIds[hit]);CaptureMouse();}
            }
        }
        InvalidateVisual();return true;
    }
    private bool RigMove(Point2 pointer)
    {
        if(_rigStart is null)return false;_rigCurrent=Camera.ToDocument(pointer);
        if(RigSubcontext=="Weight")
            for(var i=0;i<VertexIds.Length;i++){var p=Screen(Positions[i*2],Positions[i*2+1]);if(Math.Pow(p.X-pointer.X,2)+Math.Pow(p.Y-pointer.Y,2)<=144)_paintVertices.Add(VertexIds[i]);}
        InvalidateVisual();return true;
    }
    private bool RigUp(Point2 pointer)
    {
        if(_rigStart is not { } start)return false;
        var end=Camera.ToDocument(pointer);var vertices=_paintVertices.ToArray();_rigStart=_rigCurrent=null;_paintVertices.Clear();ReleaseMouseCapture();
        if(RigSubcontext=="Bone")
        {
            if(RigTool=="追加")BoneCreateRequested?.Invoke(start,end);
            else if(RigTool=="移動"&&start!=end)BoneMoveRequested?.Invoke(start,end,_poseMode);
        }
        else if(RigSubcontext=="Warp"&&start!=end)WarpMoveRequested?.Invoke(start,end);
        else if(RigSubcontext=="Weight"&&vertices.Length>0)WeightPaintRequested?.Invoke(vertices,WeightStrength,RigTool=="消す");
        InvalidateVisual();return true;
    }
    private void CancelRig(){_rigStart=_rigCurrent=null;_paintVertices.Clear();}
}
