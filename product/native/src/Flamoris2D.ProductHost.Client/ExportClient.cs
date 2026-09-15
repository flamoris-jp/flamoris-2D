namespace Flamoris.Flamoris2D.ProductHost;

public sealed record ExportSettings(string? SequenceId,string? TransitionId,int Width,int Height,int FpsNumerator,int FpsDenominator,bool Video)
{
    internal object Wire => new {sequenceId=SequenceId,transitionId=TransitionId,width=Width,height=Height,
        frameRate=new {numerator=FpsNumerator,denominator=FpsDenominator},video=Video};
}
public sealed partial class ProductHostClient
{
    public Task<ProductHostResponse> GetExportSettingsAsync(CancellationToken cancellationToken=default)=>SendAsync("export.settings",new {},false,true,cancellationToken);
    public Task<ProductHostResponse> PlanExportAsync(ExportSettings settings,long revision,CancellationToken cancellationToken=default)=>SendAsync("export.plan",settings.Wire,true,true,cancellationToken,revision);
    public Task<ProductHostResponse> ProjectExportFrameAsync(ExportSettings settings,int frameIndex,long revision,CancellationToken cancellationToken=default)=>SendAsync("export.frame",new {
        sequenceId=settings.SequenceId,transitionId=settings.TransitionId,width=settings.Width,height=settings.Height,
        frameRate=new {numerator=settings.FpsNumerator,denominator=settings.FpsDenominator},video=settings.Video,frameIndex},true,true,cancellationToken,revision);
    public Task<ProductHostResponse> CheckEncoderAsync(string versionText,string buildConfText,string encodersText,string filtersText,CancellationToken cancellationToken=default)=>
        SendAsync("export.encoder",new {probe=new {versionText,buildConfText,encodersText,filtersText}},false,true,cancellationToken);
    public Task<ProductHostResponse> GetEncoderArgumentsAsync(string frameDirectory,string outputPath,int frameCount,int numerator,int denominator,CancellationToken cancellationToken=default)=>
        SendAsync("export.encoder",new {frameDirectory,outputPath,frameCount,frameRate=new {numerator,denominator}},false,true,cancellationToken);
}
