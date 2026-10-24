namespace Flamoris.Flamoris2D.Native.Client;

public sealed record ExportSettings(string? SequenceId,string? TransitionId,int Width,int Height,int FpsNumerator,int FpsDenominator,bool Video,long VideoBitRate=20_000_000)
{
    internal object Wire => new {sequenceId=SequenceId,transitionId=TransitionId,width=Width,height=Height,
        frameRate=new {numerator=FpsNumerator,denominator=FpsDenominator},video=Video,videoBitRate=VideoBitRate};
}
public sealed partial class NativeSessionClient
{
    public Task<NativeSessionResponse> GetExportSettingsAsync(CancellationToken cancellationToken=default)=>SendAsync("export.settings",new {},false,true,cancellationToken);
    public Task<NativeSessionResponse> PlanExportAsync(ExportSettings settings,long revision,CancellationToken cancellationToken=default)=>SendAsync("export.plan",settings.Wire,true,true,cancellationToken,revision);
    public Task<NativeSessionResponse> ProjectExportFrameAsync(ExportSettings settings,int frameIndex,long revision,CancellationToken cancellationToken=default)=>SendAsync("export.frame",new {
        sequenceId=settings.SequenceId,transitionId=settings.TransitionId,width=settings.Width,height=settings.Height,
        frameRate=new {numerator=settings.FpsNumerator,denominator=settings.FpsDenominator},video=settings.Video,videoBitRate=settings.VideoBitRate,frameIndex},true,true,cancellationToken,revision);
    public Task<NativeSessionResponse> CheckEncoderAsync(string versionText,string buildConfText,string encodersText,string filtersText,CancellationToken cancellationToken=default)=>
        SendAsync("export.encoder",new {probe=new {versionText,buildConfText,encodersText,filtersText}},false,true,cancellationToken);
    public Task<NativeSessionResponse> GetEncoderArgumentsAsync(string frameDirectory,string outputPath,int frameCount,int numerator,int denominator,CancellationToken cancellationToken=default,long videoBitRate=20_000_000)=>
        SendAsync("export.encoder",new {frameDirectory,outputPath,frameCount,frameRate=new {numerator,denominator},videoBitRate},false,true,cancellationToken);
}
