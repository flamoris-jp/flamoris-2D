using System.IO;
using System.Text.Json;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private static byte[] FramePixels(System.Windows.Media.Imaging.BitmapSource? frame)
    {
        if(frame is null)throw new InvalidOperationException("Production viewport has no evaluated frame.");
        var pixels=new byte[frame.PixelWidth*frame.PixelHeight*4];frame.CopyPixels(pixels,frame.PixelWidth*4,0);
        if(!pixels.Where((_,i)=>i%4==3).Any(a=>a>0))throw new InvalidOperationException("Production viewport is empty.");
        return pixels;
    }
    private async Task RunProductionSmokeAsync()
    {
        var fixtureDirectory=Environment.GetEnvironmentVariable("FLAMORIS_RENDER_FIXTURE_DIR");
        if(fixtureDirectory is null)return;
        var client=_client!;
        await using(var input=File.OpenRead(Path.Combine(fixtureDirectory,"native-production-source.psd")))
            await client.ImportSourceAsync(input,input.Length,NativeSourceKind.Psd,"native-production-source.psd");
        _hasHandsOn=false;AttachDocumentWorkspace(client.DocumentToken!);await RefreshProjectionAsync();
        TargetList.SelectedItem=_targets.Targets.First(t=>t.Kind=="part");await RefreshProjectionAsync();
        var nodeId=_targets.SelectedId!;var keyArtId=_renderChoice!.Id;
        SwitchContext(EditingContext.Mesh,false);await RefreshProjectionAsync();
        var grid=await client.GenerateMeshAsync(nodeId,false,4,4,.1,.45,.65,.3,client.Revision);
        await CommitMeshAsync(MeshEdit.Generated(grid.Payload.GetProperty("candidate"),true),client.Revision);
        MeshCanvas.Fit();
        var initial=FramePixels(MeshCanvas.EvaluatedFrame);var positions=(double[])MeshCanvas.Positions.Clone();positions[0]+=9;positions[1]+=7;
        MeshCanvas.Structure=false;ConfigureMeshContext();await CommitMeshAsync(MeshEdit.Move(positions),client.Revision);
        var moved=FramePixels(MeshCanvas.EvaluatedFrame);if(initial.SequenceEqual(moved))throw new Exception("Layout moved overlay without deforming artwork.");
        await client.UndoAsync();await RefreshProjectionAsync();if(!initial.SequenceEqual(FramePixels(MeshCanvas.EvaluatedFrame)))throw new Exception("Rendered Mesh Undo differs.");
        await client.RedoAsync();await RefreshProjectionAsync();
        SwitchContext(EditingContext.Rig,false);await RefreshProjectionAsync();
        await client.EditRigAsync(new(nodeId,keyArtId),RigEdit.BoneAt(15,30,40,30),client.Revision);await RefreshProjectionAsync();
        _selectedBoneId=ArrayOf(_rigSnapshot,"bones").Single().GetProperty("id").GetString();await RefreshProjectionAsync();
        var context=CurrentRigContext();var topology=Property(Property(_rigSnapshot,"part"),"topology");
        await client.EditRigAsync(context,RigEdit.CreateSkin(String(topology,"id")!),client.Revision);await RefreshProjectionAsync();context=CurrentRigContext();
        await client.EditRigAsync(context,RigEdit.BonePose(0,0,.18),client.Revision);await RefreshProjectionAsync();
        var root=String(_rigSnapshot,"rootId")!;
        await client.EditRigAsync(context,RigEdit.CreateWarp("Production warp",root,3,0,0,64,64,[nodeId]),client.Revision);await RefreshProjectionAsync();
        _selectedWarpId=ArrayOf(_rigSnapshot,"warps").Single().GetProperty("id").GetString();context=CurrentRigContext();
        var control=String(ArrayOf(ArrayOf(_rigSnapshot,"warps").Single(),"positions")[0],"controlPointId")!;
        await client.EditRigAsync(context,RigEdit.MoveWarp([control],3,2),client.Revision);await RefreshProjectionAsync();
        SwitchContext(EditingContext.Deform,false);await RefreshProjectionAsync();MeshCanvas.Selected.Add(MeshCanvas.VertexIds[0]);
        await client.EditRigAsync(CurrentRigContext(),RigEdit.FormMove([MeshCanvas.VertexIds[0]],1,-1),client.Revision);await RefreshProjectionAsync();
        SwitchContext(EditingContext.Animation,false);await RefreshProjectionAsync();
        var sequence=await client.EditTimelineAsync(new(),TimelineEdit.CreateSequence("Native eight-second shot",8,keyArtId),client.Revision);
        var sequenceId=String(sequence.Payload,"sequenceId")!;_renderChoice=new(sequenceId,"sequence","Native shot");await RefreshProjectionAsync();
        var target=JsonSerializer.SerializeToElement(new {boneId=_selectedBoneId});
        var clip=await client.EditTimelineAsync(new(sequenceId),TimelineEdit.CreateClip("Bone motion",8,false),client.Revision);
        var clipId=String(clip.Payload,"clipId")!;
        var track=await client.EditTimelineAsync(new(sequenceId,clipId),TimelineEdit.AddTrack(AnimationTrackKind.BoneTrack,target),client.Revision);
        var trackId=String(track.Payload,"trackId")!;
        await client.EditTimelineAsync(new(sequenceId,clipId),TimelineEdit.AddKey(trackId,"rotation",0,AnimationValue.Scalar(0)),client.Revision);
        await client.EditTimelineAsync(new(sequenceId,clipId),TimelineEdit.AddKey(trackId,"rotation",960000,AnimationValue.Scalar(.5)),client.Revision);
        await client.EditTimelineAsync(new(sequenceId),TimelineEdit.PlaceClip(clipId,new(0,960000,0,1,1,false,1,0,true)),client.Revision);
        await RefreshProjectionAsync();await ScrubAsync(480000);var evaluated=FramePixels(MeshCanvas.EvaluatedFrame);
        SwitchContext(EditingContext.Preview,false);await RefreshProjectionAsync();if(!evaluated.SequenceEqual(FramePixels(MeshCanvas.EvaluatedFrame)))throw new Exception("Animation/Preview frame mismatch.");
        var directory=Path.Combine(fixtureDirectory,"native-eight-second-frames");if(Directory.Exists(directory))Directory.Delete(directory,true);
        SwitchContext(EditingContext.Export,false);await RefreshProjectionAsync();
        await ExportAsync(new(sequenceId,null,64,64,30,1,false),directory,"ffmpeg");
        if(!Directory.Exists(directory)||Directory.GetFiles(directory,"frame_*.png").Length!=240)throw new Exception("Eight-second native PNG export incomplete.");
        var projectPath=Path.Combine(fixtureDirectory,"native-eight-second.fl2d");var saved=await client.PrepareDocumentAsync("saveAs");
        await AtomicDocumentFile.WriteAsync(projectPath,(stream,ct)=>client.DownloadDocumentAsync(saved,stream,ct));await client.AcknowledgeDocumentAsync(saved);
        if((await client.GetWorkspaceAsync()).Payload.GetProperty("isDirty").GetBoolean())throw new Exception("Durable save remained dirty.");
        await client.CreateSessionAsync();await using(var input=File.OpenRead(projectPath))await client.OpenDocumentAsync(input,input.Length);
        AttachDocumentWorkspace(client.DocumentToken!);_renderChoice=new(sequenceId,"sequence","Native shot");_timeTicks=480000;
        SwitchContext(EditingContext.Preview,false);await RefreshProjectionAsync();if(!evaluated.SequenceEqual(FramePixels(MeshCanvas.EvaluatedFrame)))throw new Exception("Saved production frame changed after reopen.");
        Console.WriteLine("Native WPF production path passed: PSD > Mesh/image deformation > Bone/Skin > Warp > form correction > eight-second Sequence > Preview > 240 PNGs > atomic Save > New > Open; evaluated frame retained.");
    }
}
