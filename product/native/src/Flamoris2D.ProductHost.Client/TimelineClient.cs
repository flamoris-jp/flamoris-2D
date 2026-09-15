using System.Text.Json;

namespace Flamoris.Flamoris2D.ProductHost;

public sealed record TimelineContext(string? SequenceId = null,string? ClipId = null,string? TrackId = null,
    string? Channel = null,string? KeyframeId = null,string? TrackKind = null,long TimeTicks = 0)
{
    internal object Wire => new {sequenceId=SequenceId,clipId=ClipId,trackId=TrackId,channel=Channel,keyframeId=KeyframeId,trackKind=TrackKind,timeTicks=TimeTicks};
}
public enum AnimationTrackKind {TransformTrack,BoneTrack,DeformerTrack,MeshDeformationTrack,OpacityTrack,PresenceTrack,DrawOrderTrack,ClippingTrack,CameraTrack}
public sealed class AnimationValue
{
    private AnimationValue(object value)=>Wire=value;
    internal object Wire {get;}
    public static AnimationValue Scalar(double value)=>new(value);
    public static AnimationValue Presence(string presence)=>presence is "present" or "absent" or "occluded"?new(presence):throw new ArgumentException("Invalid presence.");
    public static AnimationValue Clipping(string? sourceNodeId)=>new(new {sourceNodeId});
    public static AnimationValue Deformation(string deformationSampleId,double weight)=>new(new {deformationSampleId,weight});
}
public sealed record ClipPlacement(long StartTicks,long EndTicks,long SourceOffsetTicks,int RateNumerator,int RateDenominator,bool Loop,double Weight,int Layer,bool Enabled)
{
    internal object Wire=>new {startTicks=StartTicks,endTicks=EndTicks,sourceOffsetTicks=SourceOffsetTicks,
        playbackRate=new {numerator=RateNumerator,denominator=RateDenominator},loopMode=Loop?"loop":"once",weight=Weight,layer=Layer,enabled=Enabled};
}
public sealed class TimelineEdit
{
    private TimelineEdit(string tool,object input)=>(Tool,Input)=(tool,input);
    internal string Tool {get;}
    internal object Input {get;}
    public static TimelineEdit CreateSequence(string displayName,double durationSeconds,string keyArtId)=>new("sequence.create",new {displayName,durationSeconds,keyArtId});
    public static TimelineEdit RenameSequence(string displayName)=>new("sequence.rename",new {displayName});
    public static TimelineEdit SequenceDuration(double durationSeconds)=>new("sequence.duration",new {durationSeconds});
    public static TimelineEdit RemoveSequence()=>new("sequence.remove",new {});
    public static TimelineEdit InsertHold(string keyArtId,long startTicks,long endTicks)=>new("view.hold",new {keyArtId,startTicks,endTicks});
    public static TimelineEdit InsertTransition(string transitionId,long startTicks,long endTicks)=>new("view.transition",new {transitionId,startTicks,endTicks});
    public static TimelineEdit UpdateView(string itemId,string referenceId,long startTicks,long endTicks)=>new("view.update",new {itemId,referenceId,startTicks,endTicks});
    public static TimelineEdit RemoveView(string itemId,bool absorbPrevious)=>new("view.remove",new {itemId,absorb=absorbPrevious?"previous":"next"});
    public static TimelineEdit ReorderView(string itemId,string direction)=>new("view.reorder",new {itemId,direction});
    public static TimelineEdit CreateClip(string displayName,double durationSeconds,bool loop)=>new("clip.create",new {displayName,durationSeconds,defaultLoopMode=loop?"loop":"once"});
    public static TimelineEdit UpdateClip(string displayName,double durationSeconds,bool loop)=>new("clip.update",new {durationSeconds,patch=new {displayName,defaultLoopMode=loop?"loop":"once"}});
    public static TimelineEdit RemoveClip()=>new("clip.remove",new {});
    public static TimelineEdit PlaceClip(string clipId,ClipPlacement p)=>new("instance.add",new {clipId,startTicks=p.StartTicks,endTicks=p.EndTicks,sourceOffsetTicks=p.SourceOffsetTicks,
        playbackRate=new {numerator=p.RateNumerator,denominator=p.RateDenominator},loopMode=p.Loop?"loop":"once",weight=p.Weight,layer=p.Layer,enabled=p.Enabled});
    public static TimelineEdit UpdatePlacement(string clipInstanceId,ClipPlacement placement)=>new("instance.update",new {clipInstanceId,patch=placement.Wire});
    public static TimelineEdit RemovePlacement(string clipInstanceId)=>new("instance.remove",new {clipInstanceId});
    public static TimelineEdit AddTrack(AnimationTrackKind kind,JsonElement target)=>new("track.add",new {kind=kind.ToString(),target});
    public static TimelineEdit RemoveTrack(string trackId)=>new("track.remove",new {trackId});
    public static TimelineEdit AddKey(string trackId,string channel,long timeTicks,AnimationValue value)=>new("key.add",new {trackId,channel,timeTicks,value=value.Wire});
    public static TimelineEdit UpdateKey(string trackId,string channel,string keyframeId,long timeTicks,AnimationValue value)=>new("key.update",new {trackId,channel,keyframeId,patch=new {timeTicks,value=value.Wire}});
    public static TimelineEdit MoveKey(string trackId,string channel,string keyframeId,long timeTicks)=>new("key.update",new {trackId,channel,keyframeId,patch=new {timeTicks}});
    public static TimelineEdit RemoveKey(string trackId,string channel,string keyframeId)=>new("key.remove",new {trackId,channel,keyframeId});
    public static TimelineEdit EaseKey(string trackId,string channel,string keyframeId,string presetId)=>new("key.ease",new {trackId,channel,keyframeId,presetId});
    public static TimelineEdit InterpolateKey(string trackId,string channel,string keyframeId,string kind,double x1=0,double y1=0,double x2=1,double y2=1)=>new("key.interpolation",new {trackId,channel,keyframeId,kind,controls=new {x1,y1,x2,y2}});
}
public sealed record PlaybackSample(long StartTicks,double ElapsedMilliseconds,bool Loop);
public sealed partial class ProductHostClient
{
    public Task<ProductHostResponse> GetTimelineAsync(TimelineContext context,CancellationToken cancellationToken=default)=>
        SendAsync("timeline.projection",context.Wire,false,true,cancellationToken);
    public Task<ProductHostResponse> EditTimelineAsync(TimelineContext context,TimelineEdit edit,long revision,CancellationToken cancellationToken=default)=>
        SendAsync("timeline.tool",new {context=context.Wire,tool=edit.Tool,input=edit.Input},true,true,cancellationToken,revision);
}
