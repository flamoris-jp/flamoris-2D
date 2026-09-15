using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private JsonElement _timelineSnapshot;
    private TimelineContext _timelineContext = new();
    private long _timelineRevision=-1;
    private string? _timelinePanelKey,_selectedViewId,_selectedClipInstanceId;
    private readonly DispatcherTimer _playTimer=new(){Interval=TimeSpan.FromMilliseconds(16)};
    private readonly Stopwatch _playClock=new();
    private long _playStartTick;
    private bool _playing,_playBusy,_updatingTime;
    private PlaybackSample? _playbackSample;
    private static long ReadTicks(TextBox box)=>long.TryParse(box.Text,out var value)&&value>=0&&value<=9_007_199_254_740_991?value:throw new ArgumentException("0以上の整数ticksを入力してください。");
    private TimelineContext CurrentTimelineContext()=>_timelineContext with {SequenceId=_renderChoice?.Kind=="sequence"?_renderChoice.Id:null,TimeTicks=_timeTicks};
    private void InitializeAnimationUi()
    {
        _playTimer.Tick+=async(_,_)=>await PlaybackFrameAsync();
        TimelineCanvas.Scrubbed+=async tick=>await ScrubAsync(tick);
        TimelineCanvas.KeyPicked+=(track,channel,id)=>{_timelineContext=_timelineContext with {TrackId=track,Channel=channel,KeyframeId=id};_contextDraft=false;_=RefreshRigSurfaceAsync();};
        TimelineCanvas.TrackPicked+=track=>{_timelineContext=_timelineContext with {TrackId=track,KeyframeId=null,Channel=null};_contextDraft=false;_=RefreshRigSurfaceAsync();};
        TimelineCanvas.ViewPicked+=id=>{_selectedViewId=id;_selectedClipInstanceId=null;_contextDraft=false;_=RefreshRigSurfaceAsync();};
        TimelineCanvas.ClipPicked+=id=>{_selectedClipInstanceId=id;_selectedViewId=null;_contextDraft=false;_=RefreshRigSurfaceAsync();};
        TimelineCanvas.KeyMoved+=async(track,channel,id,tick,revision)=>await RunTimelineEditAsync(()=>TimelineEdit.MoveKey(track,channel,id,tick),CurrentTimelineContext(),revision);
        TimelineCanvas.ClipMoved+=async(id,start,end,revision)=>await RunTimelineEditAsync(()=>
        {
            var item=ArrayOf(_timelineSnapshot,"clipInstances").First(i=>String(i,"id")==id);
            var rate=Property(item,"playbackRate");
            return TimelineEdit.UpdatePlacement(id,new(start,end,(long)Number(item,"sourceOffsetTicks"),(int)Number(rate,"numerator",1),(int)Number(rate,"denominator",1),
                String(item,"loopMode")=="loop",Number(item,"weight",1),(int)Number(item,"layer"),Property(item,"enabled").ValueKind==JsonValueKind.True));
        },CurrentTimelineContext(),revision);
    }
    private void StopPlayback()
    {_playing=false;_playTimer.Stop();_playClock.Stop();_playbackSample=null;if(PlayButton is not null)PlayButton.Content="▶ 再生";}
    private async void Play_Click(object sender,RoutedEventArgs e)
    {
        if(_playing){StopPlayback();return;}
        if(_renderChoice?.Kind is not ("sequence" or "transition")){StatusText.Text="再生するシーケンスまたは遷移を選択してください。";return;}
        _playing=true;_playStartTick=_timeTicks;_playClock.Restart();PlayButton.Content="❚❚ 停止";_playTimer.Start();await PlaybackFrameAsync();
    }
    private async Task PlaybackFrameAsync()
    {
        if(!_playing||_playBusy||_client?.HasAuthoritativeProjection!=true)return;
        _playBusy=true;
        try
        {
            _playbackSample=new(_playStartTick,_playClock.Elapsed.TotalMilliseconds,LoopPlayback.IsChecked==true);
            _lastRenderKey=null;await RefreshEvaluatedFrameAsync(_client);
            TimelineCanvas.Playhead=_timeTicks;TimelineCanvas.InvalidateVisual();
        }
        catch(Exception error){StopPlayback();StatusText.Text=$"再生を停止しました: {error.Message}";}
        finally{_playBusy=false;}
    }
    private async Task ScrubAsync(long tick)
    {
        StopPlayback();_timeTicks=tick;_lastRenderKey=null;
        try{if(_client?.HasAuthoritativeProjection==true)await RefreshEvaluatedFrameAsync(_client);UpdateTimeDisplay();}
        catch(Exception error){StatusText.Text=error.Message;}
    }
    private async void TimeSlider_Changed(object sender,RoutedPropertyChangedEventArgs<double> e)
    {if(!_updatingTime)await ScrubAsync((long)Math.Round(e.NewValue));}
    private async void StartTime_Click(object sender,RoutedEventArgs e)=>await ScrubAsync(0);
    private void TimelineZoom_Changed(object sender,RoutedPropertyChangedEventArgs<double> e)
    {if(TimelineCanvas is not null)TimelineCanvas.Width=Math.Max(900,TimelineScroll.ActualWidth)*e.NewValue;}
    private void UpdateTimeDisplay()
    {
        _updatingTime=true;try{TimeSlider.Value=_timeTicks;PlayheadText.Text=_timeLabel;TimelineCanvas.Playhead=_timeTicks;TimelineCanvas.InvalidateVisual();}finally{_updatingTime=false;}
    }
    private string _timeLabel="0 ticks";
    private void ConfigureAnimationContext()
    {
        var animated=_editingContext is EditingContext.Animation or EditingContext.Preview;
        PlaybackControls.Visibility=animated?Visibility.Visible:Visibility.Collapsed;
        if(!animated)StopPlayback();
        if(_editingContext==EditingContext.Animation){AuthoringPanel.Visibility=Visibility.Visible;_=RefreshRigSurfaceAsync();}
    }
    private async Task RefreshTimelineAsync(ProductHostClient client)
    {
        if(_editingContext!=EditingContext.Animation)return;
        var context=CurrentTimelineContext();var response=await client.GetTimelineAsync(context);
        client.AssertCurrent(response.DocumentToken!,response.Revision!.Value);_timelineSnapshot=response.Payload;_timelineRevision=response.Revision.Value;
        _timelineContext=_timelineContext with {TrackId=String(response.Payload,"selectedTrackId")};
        TimelineCanvas.Apply(_timelineSnapshot,_timelineRevision);TimelineCanvas.Width=Math.Max(900,TimelineScroll.ActualWidth)*TimelineZoom.Value;
        var program=Property(_timelineSnapshot,"program");_updatingTime=true;
        try{TimeSlider.Maximum=Math.Max(1,Number(program,"durationTicks",1));}finally{_updatingTime=false;}
        UpdateTimeDisplay();
        var key=$"{response.DocumentToken}/{context.SequenceId}/{context.ClipId}/{context.TrackId}/{context.Channel}/{context.KeyframeId}/{context.TrackKind}/{_selectedViewId}/{_selectedClipInstanceId}";
        if(_contextDraft&&_timelinePanelKey==key)return;
        _timelinePanelKey=key;AuthoringPanel.Children.Clear();BuildTimelinePanel(context,_timelineRevision);
    }
    private async Task RunTimelineEditAsync(Func<TimelineEdit> make,TimelineContext context,long revision)
    {
        if(_client?.HasAuthoritativeProjection!=true||_meshBusy||_documentBusy)return;
        StopPlayback();SetMeshBusy(true);
        try
        {
            var result=await _client.EditTimelineAsync(context,make(),revision);
            if(String(result.Payload,"sequenceId") is { } sequenceId)_renderChoice=new(sequenceId,"sequence","");
            if(String(result.Payload,"clipId") is { } clipId)_timelineContext=_timelineContext with {ClipId=clipId,TrackId=null,KeyframeId=null,Channel=null};
            if(String(result.Payload,"trackId") is { } trackId)_timelineContext=_timelineContext with {TrackId=trackId,KeyframeId=null,Channel=null};
            _contextDraft=false;_timelinePanelKey=null;_lastRenderKey=null;
            await RefreshProjectionAsync();StatusText.Text="時間編集を確定しました。Ctrl+Zで戻せます。";
        }
        catch(Exception error){StatusText.Text=$"時間編集できませんでした: {error.Message}";}
        finally{SetMeshBusy(false);}
    }
    private void BuildTimelinePanel(TimelineContext context,long revision)
    {
        var panel=AuthoringPanel;var sequence=Property(_timelineSnapshot,"sequence");
        var name=Field(panel,"シーケンス名",String(sequence,"displayName")??"新しいシーケンス");var seconds=Field(panel,"長さ（秒）",Number(_timelineSnapshot,"durationSeconds",8));
        var arts=Choices(panel,"最初の原画",ArrayOf(_timelineSnapshot,"keyArts").Select(k=>new EntityChoice(String(k,"id")!,String(k,"displayName")??"原画")));
        ActionButton(panel,"シーケンスを作成",()=>RunTimelineEditAsync(()=>TimelineEdit.CreateSequence(name.Text,ReadNumber(seconds),Chosen(arts)),context,revision));
        if(context.SequenceId is null){Note(panel,"上の「表示する状態」でシーケンスを選ぶと、配置とトラックを編集できます。");return;}
        ActionButton(panel,"シーケンス名を変更",()=>RunTimelineEditAsync(()=>TimelineEdit.RenameSequence(name.Text),context,revision));
        ActionButton(panel,"シーケンスの長さを変更",()=>RunTimelineEditAsync(()=>TimelineEdit.SequenceDuration(ReadNumber(seconds)),context,revision));
        var clipChoices=ArrayOf(_timelineSnapshot,"clips").Select(c=>new EntityChoice(String(c,"id")!,String(c,"displayName")??"Clip")).Prepend(new EntityChoice("","シーケンス全体のトラック"));
        var clipSelect=Choices(panel,"編集するトラックの所属",clipChoices,context.ClipId??"");
        clipSelect.SelectionChanged+=(_,_)=>{_timelineContext=_timelineContext with {ClipId=(clipSelect.SelectedItem as EntityChoice)?.Id is {Length:>0} id?id:null,TrackId=null,KeyframeId=null,Channel=null};_contextDraft=false;_=RefreshRigSurfaceAsync();};
        BuildTrackPanel(panel,context,revision);
        BuildClipPanel(panel,context,revision);
        BuildViewPanel(panel,context,revision);
        ActionButton(panel,"このシーケンスを削除",()=>RunTimelineEditAsync(TimelineEdit.RemoveSequence,context,revision));
    }
    private void BuildTrackPanel(Panel panel,TimelineContext context,long revision)
    {
        var tracks=ArrayOf(_timelineSnapshot,"tracks");var select=Choices(panel,"トラック",tracks.Select(t=>new EntityChoice(String(t,"trackId")!,
            $"{String(t,"kind")?.Replace("Track","")} · {String(t,"targetLabel")}")),context.TrackId);
        select.SelectionChanged+=(_,_)=>{_timelineContext=_timelineContext with {TrackId=(select.SelectedItem as EntityChoice)?.Id,KeyframeId=null,Channel=null};_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var kinds=ArrayOf(_timelineSnapshot,"allowedTrackKinds").Select(k=>new EntityChoice(k.GetString()!,k.GetString()!.Replace("Track","")));
        var kind=Choices(panel,"追加するトラックの種類",kinds,context.TrackKind);
        kind.SelectionChanged+=(_,_)=>{_timelineContext=_timelineContext with {TrackKind=(kind.SelectedItem as EntityChoice)?.Id};_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var options=ArrayOf(_timelineSnapshot,"targetOptions");var target=Choices(panel,"トラックの対象",options.Select((o,i)=>new EntityChoice(i.ToString(),String(o,"label")??"対象")));
        ActionButton(panel,"トラックを追加",()=>RunTimelineEditAsync(()=>TimelineEdit.AddTrack(Enum.Parse<AnimationTrackKind>(Chosen(kind)),options[int.Parse(Chosen(target))].GetProperty("target")),context,revision));
        var track=tracks.FirstOrDefault(t=>String(t,"trackId")==context.TrackId);if(track.ValueKind!=JsonValueKind.Object)return;
        var channels=track.GetProperty("channels").EnumerateObject().Select(c=>new EntityChoice(c.Name,c.Name));
        var channel=Choices(panel,"編集するチャンネル",channels,context.Channel??channels.First().Id);
        channel.SelectionChanged+=(_,_)=>{_timelineContext=_timelineContext with {Channel=(channel.SelectedItem as EntityChoice)?.Id,KeyframeId=null};_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var selectedChannel=Chosen(channel);var frames=track.GetProperty("channels").GetProperty(selectedChannel).GetProperty("keyframes").EnumerateArray().ToArray();
        var keyList=Choices(panel,"キーフレーム",frames.Select(k=>new EntityChoice(String(k,"id")!,$"{Number(k,"timeTicks")} ticks")),context.KeyframeId);
        keyList.SelectionChanged+=(_,_)=>{_timelineContext=_timelineContext with {Channel=selectedChannel,KeyframeId=(keyList.SelectedItem as EntityChoice)?.Id};_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var frame=frames.FirstOrDefault(f=>String(f,"id")==context.KeyframeId);var tick=Field(panel,"キーフレーム時刻（ticks）",Number(frame,"timeTicks",_timeTicks));
        var value=Property(frame,"value");var definition=Property(Property(_timelineSnapshot,"channels"),selectedChannel);var valueKind=String(definition,"value");
        Func<AnimationValue> read;
        if(valueKind=="presence")
        {var presence=Choices(panel,"出現状態",new[]{"present","absent","occluded"}.Select(p=>new EntityChoice(p,p)),value.ValueKind==JsonValueKind.String?value.GetString():"present");read=()=>AnimationValue.Presence(Chosen(presence));}
        else if(valueKind=="clipping")
        {var clipping=Choices(panel,"クリッピング元",_targets.Targets.Where(t=>t.Kind=="part").Select(t=>new EntityChoice(t.Id,t.DisplayName)).Prepend(new EntityChoice("","なし")),String(value,"sourceNodeId")??"");read=()=>AnimationValue.Clipping(Chosen(clipping) is {Length:>0} id?id:null);}
        else if(valueKind=="deformation")
        {var sample=Choices(panel,"変形サンプル",ArrayOf(_timelineSnapshot,"deformationSamples").Select(s=>new EntityChoice(String(s,"id")!,String(s,"displayName")??"変形")),String(value,"deformationSampleId"));var weight=Field(panel,"変形の強さ",Number(value,"weight",1));read=()=>AnimationValue.Deformation(Chosen(sample),ReadNumber(weight));}
        else{var scalar=Field(panel,selectedChannel=="rotation"?"値（ラジアン）":"値",value.ValueKind==JsonValueKind.Number?value.GetDouble():valueKind is "unit-number" or "positive-number"?1:0);read=()=>AnimationValue.Scalar(ReadNumber(scalar));}
        ActionButton(panel,"キーフレームを追加",()=>RunTimelineEditAsync(()=>TimelineEdit.AddKey(context.TrackId!,selectedChannel,ReadTicks(tick),read()),context,revision));
        if(context.KeyframeId is { } keyId)
        {
            ActionButton(panel,"キーフレームを更新",()=>RunTimelineEditAsync(()=>TimelineEdit.UpdateKey(context.TrackId!,selectedChannel,keyId,ReadTicks(tick),read()),context,revision));
            var easing=Choices(panel,"補間",new[]{"step","linear","ease-in","ease-out","ease-in-out","bezier"}.Select(i=>new EntityChoice(i,i)),"linear");
            var x1=Field(panel,"Bezier x1",.42);var y1=Field(panel,"Bezier y1",0);var x2=Field(panel,"Bezier x2",.58);var y2=Field(panel,"Bezier y2",1);
            ActionButton(panel,"補間を設定",()=>RunTimelineEditAsync(()=>Chosen(easing).StartsWith("ease")?TimelineEdit.EaseKey(context.TrackId!,selectedChannel,keyId,Chosen(easing)):
                TimelineEdit.InterpolateKey(context.TrackId!,selectedChannel,keyId,Chosen(easing),ReadNumber(x1),ReadNumber(y1),ReadNumber(x2),ReadNumber(y2)),context,revision));
            ActionButton(panel,"キーフレームを削除",()=>RunTimelineEditAsync(()=>TimelineEdit.RemoveKey(context.TrackId!,selectedChannel,keyId),context,revision));
        }
        ActionButton(panel,"トラックを削除",()=>RunTimelineEditAsync(()=>TimelineEdit.RemoveTrack(context.TrackId!),context,revision));
    }
    private void BuildClipPanel(Panel panel,TimelineContext context,long revision)
    {
        var clip=Property(_timelineSnapshot,"selectedClip");var name=Field(panel,"クリップ名",String(clip,"displayName")??"新しいクリップ");var seconds=Field(panel,"クリップの長さ（秒）",Number(_timelineSnapshot,"clipDurationSeconds",1));
        var loop=Check(panel,"クリップをループ",String(clip,"defaultLoopMode")=="loop");
        ActionButton(panel,"クリップを作成",()=>RunTimelineEditAsync(()=>TimelineEdit.CreateClip(name.Text,ReadNumber(seconds),loop.IsChecked==true),context,revision));
        if(context.ClipId is not null)
        {
            ActionButton(panel,"クリップを更新",()=>RunTimelineEditAsync(()=>TimelineEdit.UpdateClip(name.Text,ReadNumber(seconds),loop.IsChecked==true),context,revision));
            ActionButton(panel,"クリップを削除",()=>RunTimelineEditAsync(TimelineEdit.RemoveClip,context,revision));
        }
        var place=Choices(panel,"配置するクリップ",ArrayOf(_timelineSnapshot,"clips").Select(c=>new EntityChoice(String(c,"id")!,String(c,"displayName")??"Clip")),context.ClipId);
        var item=ArrayOf(_timelineSnapshot,"clipInstances").FirstOrDefault(i=>String(i,"id")==_selectedClipInstanceId);
        var placementLoop=Check(panel,"この配置をループ",String(item,"loopMode")=="loop");
        var start=Field(panel,"配置 開始ticks",Number(item,"startTicks",_timeTicks));var end=Field(panel,"配置 終了ticks",Number(item,"endTicks",Number(Property(_timelineSnapshot,"sequence"),"durationTicks",1)));
        var offset=Field(panel,"クリップ内の開始ticks",Number(item,"sourceOffsetTicks"));var rate=Property(item,"playbackRate");
        var numerator=Field(panel,"速度 分子",Number(rate,"numerator",1));var denominator=Field(panel,"速度 分母",Number(rate,"denominator",1));
        var weight=Field(panel,"配置のウェイト",Number(item,"weight",1));var layer=Field(panel,"重ね順",Number(item,"layer"));var enabled=Check(panel,"配置を有効にする",Property(item,"enabled").ValueKind!=JsonValueKind.False);
        ClipPlacement Placement()=>new(ReadTicks(start),ReadTicks(end),ReadTicks(offset),checked((int)ReadTicks(numerator)),checked((int)ReadTicks(denominator)),placementLoop.IsChecked==true,ReadNumber(weight),checked((int)ReadNumber(layer)),enabled.IsChecked==true);
        ActionButton(panel,"クリップを配置",()=>RunTimelineEditAsync(()=>TimelineEdit.PlaceClip(Chosen(place),Placement()),context,revision));
        if(_selectedClipInstanceId is { } id)
        {
            ActionButton(panel,"選択した配置を更新",()=>RunTimelineEditAsync(()=>TimelineEdit.UpdatePlacement(id,Placement()),context,revision));
            ActionButton(panel,"選択した配置を削除",()=>RunTimelineEditAsync(()=>TimelineEdit.RemovePlacement(id),context,revision));
        }
    }
    private void BuildViewPanel(Panel panel,TimelineContext context,long revision)
    {
        var item=ArrayOf(_timelineSnapshot,"viewItems").FirstOrDefault(i=>String(i,"id")==_selectedViewId);
        var art=Choices(panel,"原画を配置",ArrayOf(_timelineSnapshot,"keyArts").Select(k=>new EntityChoice(String(k,"id")!,String(k,"displayName")??"原画")),String(item,"referenceId"));
        var transition=Choices(panel,"遷移を配置",ArrayOf(_timelineSnapshot,"transitions").Select(k=>new EntityChoice(String(k,"id")!,String(k,"displayName")??"遷移")),String(item,"referenceId"));
        var start=Field(panel,"表示区間 開始ticks",Number(item,"startTicks",_timeTicks));var end=Field(panel,"表示区間 終了ticks",Number(item,"endTicks",Number(Property(_timelineSnapshot,"sequence"),"durationTicks",1)));
        ActionButton(panel,"区間に原画を挿入",()=>RunTimelineEditAsync(()=>TimelineEdit.InsertHold(Chosen(art),ReadTicks(start),ReadTicks(end)),context,revision));
        ActionButton(panel,"区間に遷移を挿入",()=>RunTimelineEditAsync(()=>TimelineEdit.InsertTransition(Chosen(transition),ReadTicks(start),ReadTicks(end)),context,revision));
        if(_selectedViewId is { } id)
        {
            ActionButton(panel,"選択区間を更新",()=>RunTimelineEditAsync(()=>TimelineEdit.UpdateView(id,String(item,"kind")=="KeyArtHold"?Chosen(art):Chosen(transition),ReadTicks(start),ReadTicks(end)),context,revision));
            ActionButton(panel,"選択区間を削除（前へ統合）",()=>RunTimelineEditAsync(()=>TimelineEdit.RemoveView(id,true),context,revision));
            ActionButton(panel,"選択区間を前へ",()=>RunTimelineEditAsync(()=>TimelineEdit.ReorderView(id,"earlier"),context,revision));
            ActionButton(panel,"選択区間を後へ",()=>RunTimelineEditAsync(()=>TimelineEdit.ReorderView(id,"later"),context,revision));
        }
    }
}
