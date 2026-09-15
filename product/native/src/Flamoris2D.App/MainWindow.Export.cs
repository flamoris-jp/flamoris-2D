using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Flamoris.Flamoris2D.ProductHost;
using Flamoris.Flamoris2D.Rendering;
using Microsoft.Win32;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private CancellationTokenSource? _exportWork;
    private string _encoderPath=File.Exists(Path.Combine(AppContext.BaseDirectory,"ffmpeg","bin","ffmpeg.exe"))?Path.Combine(AppContext.BaseDirectory,"ffmpeg","bin","ffmpeg.exe"):"ffmpeg";
    private string? _exportDirectory;
    private bool _exportBusy;
    private TextBlock? _exportProgressText;
    private ProgressBar? _exportProgressBar;
    private string? _exportPanelKey;
    private void ConfigureExportContext()
    {if(_editingContext==EditingContext.Export){AuthoringPanel.Visibility=Visibility.Visible;_=RefreshRigSurfaceAsync();}}
    private async Task RefreshExportAsync(ProductHostClient client)
    {
        if(_editingContext!=EditingContext.Export||_exportBusy)return;
        var key=$"{client.DocumentToken}/{_renderChoice?.Id}";
        if(_exportPanelKey==key&&_contextDraft)return;
        var response=await client.GetExportSettingsAsync();client.AssertCurrent(response.DocumentToken!,response.Revision!.Value);
        _exportPanelKey=key;AuthoringPanel.Children.Clear();var panel=AuthoringPanel;
        var settings=response.Payload;var canvas=Property(settings,"canvas");var rate=Property(Property(settings,"renderSettings"),"frameRate");
        Note(panel,"選択したシーケンス／遷移を、Previewと同じ描画で書き出します。");
        var width=Field(panel,"幅",Number(canvas,"width"));var height=Field(panel,"高さ",Number(canvas,"height"));
        var numerator=Field(panel,"FPS 分子",Number(rate,"numerator",30));var denominator=Field(panel,"FPS 分母",Number(rate,"denominator",1));
        var video=Check(panel,"MP4 / H.264も作成（PNG連番も保持）",false);
        Note(panel,"解像度は原画と同じ縦横比。PNGは透明、MP4は黒背景に合成します。");
        var destination=Field(panel,"書き出し先フォルダー",_exportDirectory??"");
        ActionButton(panel,"書き出し先を選ぶ",()=>
        {
            var dialog=new OpenFolderDialog{Title="書き出し先の親フォルダーを選択"};
            if(dialog.ShowDialog(this)==true){_exportDirectory=Path.Combine(dialog.FolderName,"FLAMORIS-"+DateTime.Now.ToString("yyyyMMdd-HHmmss"));destination.Text=_exportDirectory;}
            return Task.CompletedTask;
        });
        var encoder=Field(panel,"FFmpeg（MP4用）",_encoderPath);
        ActionButton(panel,"FFmpegを選択",()=>{var dialog=new OpenFileDialog{Filter="FFmpeg (*.exe)|*.exe",Title="FFmpeg実行ファイルを選択"};if(dialog.ShowDialog(this)==true)encoder.Text=_encoderPath=dialog.FileName;return Task.CompletedTask;});
        ActionButton(panel,"MP4エンコーダーを確認",async()=>
        {
            try{await NativeVideoEncoder.ProbeAsync(client,encoder.Text,CancellationToken.None);StatusText.Text="H.264 Media Foundationエンコーダーを確認しました。";}
            catch(Exception error){StatusText.Text=$"エンコーダーを利用できません: {error.Message}";}
        });
        _exportProgressText=new TextBlock{Text="待機中",TextWrapping=TextWrapping.Wrap,Foreground=System.Windows.Media.Brushes.White,Margin=new Thickness(0,10,0,4)};panel.Children.Add(_exportProgressText);
        _exportProgressBar=new ProgressBar{Minimum=0,Maximum=1,Height=8};panel.Children.Add(_exportProgressBar);
        ActionButton(panel,"書き出しを開始",async()=>
        {
            try
            {
                if(_renderChoice?.Kind is not ("sequence" or "transition"))throw new ArgumentException("書き出すシーケンスか遷移を選んでください。");
                var spec=new ExportSettings(_renderChoice.Kind=="sequence"?_renderChoice.Id:null,_renderChoice.Kind=="transition"?_renderChoice.Id:null,
                    checked((int)ReadTicks(width)),checked((int)ReadTicks(height)),checked((int)ReadTicks(numerator)),checked((int)ReadTicks(denominator)),video.IsChecked==true);
                await ExportAsync(spec,destination.Text,encoder.Text);
            }
            catch(Exception error){StatusText.Text=$"書き出しできませんでした: {error.Message}";}
        });
        ActionButton(panel,"書き出しを中止",()=>{_exportWork?.Cancel();return Task.CompletedTask;});
        Note(panel,"中止・失敗した場合も、書き込み済みのPNGは残します。既存の出力は上書きしません。");
    }
    private async Task ExportAsync(ExportSettings settings,string directory,string encoder)
    {
        if(_client?.HasAuthoritativeProjection!=true||_meshBusy||_documentBusy||_exportBusy)return;
        if(string.IsNullOrWhiteSpace(directory))throw new ArgumentException("書き出し先フォルダーを選択してください。");
        directory=Path.GetFullPath(directory);
        if(Directory.Exists(directory)&&Directory.EnumerateFileSystemEntries(directory).Any())throw new IOException("空のフォルダーか、新しいフォルダーを指定してください。");
        var client=_client;var token=client.DocumentToken!;var revision=client.Revision;
        using var cancellation=new CancellationTokenSource();_exportWork=cancellation;_exportBusy=true;_documentBusy=true;
        StopPlayback();SetMeshBusy(true);string? videoTemporary=null;var written=0;
        try
        {
            var plan=await client.PlanExportAsync(settings,revision,cancellation.Token);var count=plan.Payload.GetProperty("frameCount").GetInt32();
            if(settings.Video)await NativeVideoEncoder.ProbeAsync(client,encoder,cancellation.Token);
            client.AssertCurrent(token,revision);Directory.CreateDirectory(directory);
            _exportDirectory=directory;_encoderPath=encoder;
            var exportTextures=new Dictionary<string,RenderTexture>();
            for(var index=0;index<count;index++)
            {
                cancellation.Token.ThrowIfCancellationRequested();client.AssertCurrent(token,revision);
                var frame=await client.ProjectExportFrameAsync(settings,index,revision,cancellation.Token);
                var textures=new Dictionary<string,RenderTexture>();
                foreach(var asset in frame.Payload.GetProperty("artwork").EnumerateArray())
                {
                    var id=asset.GetProperty("id").GetString()!;
                    if(!exportTextures.TryGetValue(id,out var texture))
                    {
                        var bytes=await client.DownloadRasterAsync(id,asset.GetProperty("byteLength").GetInt32(),token,revision,cancellation.Token);
                        texture=new(asset.GetProperty("width").GetInt32(),asset.GetProperty("height").GetInt32(),bytes);exportTextures[id]=texture;
                    }
                    textures[asset.GetProperty("nodeId").GetString()!]=texture;
                }
                var scale=frame.Payload.GetProperty("target").GetProperty("scale").GetDouble();
                var mapped=RenderView.Map(frame.Payload,scale,scale);
                var pixels=await Task.Run(()=>
                {
                    lock(_rendererGate)
                    {
                        if(_renderer is null){try{_renderer=new Direct3DRenderer();}catch{_renderer=new Direct3DRenderer(software:true);}}
                    }
                    return _renderer.Render(mapped,textures,settings.Width,settings.Height,cancellation.Token);
                },cancellation.Token);
                client.AssertCurrent(token,revision);
                var name=frame.Payload.GetProperty("fileName").GetString()!;
                if(Path.GetFileName(name)!=name||!name.EndsWith(".png",StringComparison.Ordinal))throw new InvalidDataException("Invalid Product frame filename.");
                await AtomicDocumentFile.WriteAsync(Path.Combine(directory,name),(stream,ct)=>PngFrameWriter.WriteAsync(stream,settings.Width,settings.Height,pixels,ct),false,cancellation.Token);
                written++;_exportProgressText!.Text=$"PNG {written}/{count}";_exportProgressBar!.Value=(double)written/count;
            }
            if(settings.Video)
            {
                cancellation.Token.ThrowIfCancellationRequested();client.AssertCurrent(token,revision);
                _exportProgressText!.Text="PNGをH.264へ変換中…";_exportProgressBar!.IsIndeterminate=true;
                var output=Path.Combine(directory,"shot.mp4");videoTemporary=Path.Combine(directory,$".video-{Guid.NewGuid():N}.mp4");
                var arguments=await client.GetEncoderArgumentsAsync(directory,videoTemporary,count,settings.FpsNumerator,settings.FpsDenominator,cancellation.Token);
                var result=await NativeVideoEncoder.RunAsync(encoder,arguments.Payload.GetProperty("args").EnumerateArray().Select(a=>a.GetString()!),cancellation.Token);
                if(result.ExitCode!=0)throw new InvalidOperationException(result.StandardError);
                if(!File.Exists(videoTemporary)||new FileInfo(videoTemporary).Length==0)throw new InvalidDataException("エンコーダーが動画を作成しませんでした。");
                cancellation.Token.ThrowIfCancellationRequested();File.Move(videoTemporary,output,overwrite:false);videoTemporary=null;
            }
            _exportProgressText!.Text=$"完了: {written}フレーム\n{directory}";StatusText.Text=$"書き出しました: {directory}";
        }
        catch(OperationCanceledException){_exportProgressText!.Text=$"中止しました。{written}枚のPNGを保持しています。";}
        catch(Exception error){_exportProgressText!.Text=$"失敗: {error.Message}\n書き込み済みPNG {written}枚を保持しています。";StatusText.Text=error.Message;}
        finally
        {
            if(videoTemporary is not null)try{File.Delete(videoTemporary);}catch(IOException){}
            _exportWork=null;_exportBusy=false;_documentBusy=false;_exportProgressBar!.IsIndeterminate=false;SetMeshBusy(false);
        }
    }
}
