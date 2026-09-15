using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Flamoris.Flamoris2D.ProductHost;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private string _rigContext = "Bone", _rigTool = "選択";
    private string? _selectedBoneId, _selectedWarpId;
    private bool _bonePoseMode;
    private JsonElement _rigSnapshot;
    private long _rigRevision = -1;
    private string? _rigPanelKey;
    private readonly HashSet<string> _selectedControlPoints = [];
    private void InitializeRigUi()
    {
        MeshCanvas.FormMoveRequested+=async(delta,revision)=>await RunRigEditAsync(()=>RigEdit.FormMove(MeshCanvas.Selected.ToArray(),delta.X,delta.Y),revision:revision);
        MeshCanvas.BonePicked+=id=>{_selectedBoneId=id;_contextDraft=false;_=RefreshRigSurfaceAsync();};
        MeshCanvas.ControlPointPicked+=(id,additive)=>
        {
            if(!additive)_selectedControlPoints.Clear();
            if(additive&&!_selectedControlPoints.Add(id))_selectedControlPoints.Remove(id);else _selectedControlPoints.Add(id);
            MeshCanvas.ApplyRig(_rigSnapshot,_selectedBoneId,_selectedWarpId,_bonePoseMode,_selectedControlPoints);
        };
        MeshCanvas.BoneMoveRequested+=async(a,b,pose)=>await RunRigEditAsync(()=>RigEdit.MoveBoneDocument(a.X,a.Y,b.X,b.Y,pose));
        MeshCanvas.BoneCreateRequested+=async(a,b)=>await RunRigEditAsync(()=>RigEdit.BoneAt(a.X,a.Y,b.X,b.Y));
        MeshCanvas.BoneDeleteRequested+=async()=>await RunRigEditAsync(RigEdit.RemoveBone);
        MeshCanvas.WeightPaintRequested+=async(vertices,strength,subtract)=>await RunRigEditAsync(()=>RigEdit.Paint(vertices,strength,subtract));
        MeshCanvas.WarpMoveRequested+=async(a,b)=>await RunRigEditAsync(()=>RigEdit.MoveWarpDocument(_selectedControlPoints.ToArray(),a.X,a.Y,b.X,b.Y));
    }
    private RigContext CurrentRigContext()
    {
        var binding=ArrayOf(_rigSnapshot,"skinBindings").FirstOrDefault(b=>String(b,"targetNodeId")==_targets.SelectedId);
        return new(_targets.SelectedId,_renderChoice?.Kind=="keyArt"?_renderChoice.Id:null,_selectedBoneId,_selectedWarpId,
            String(binding,"id"),MeshCanvas.KeyformId);
    }
    private async Task RunRigEditAsync(Func<RigEdit> make, RigContext? context = null, long? revision = null)
    {
        if(_client?.HasAuthoritativeProjection!=true||_meshBusy||_documentBusy)return;
        var client=_client;var capturedContext=context??CurrentRigContext();var capturedRevision=revision??_rigRevision;
        SetMeshBusy(true);MeshCanvas.Cancel();
        try
        {
            var response=await client.EditRigAsync(capturedContext,make(),capturedRevision);
            if(String(response.Payload,"deformerId") is { } created)_selectedWarpId=created;
            _contextDraft=false;_rigPanelKey=null;await RefreshProjectionAsync();StatusText.Text="編集を確定しました。Ctrl+Zで戻せます。";
        }
        catch(Exception error){StatusText.Text=$"編集できませんでした: {error.Message}";}
        finally{SetMeshBusy(false);}
    }
    private void ConfigureRigContext()
    {
        var active=_editingContext is EditingContext.Rig or EditingContext.Deform;
        RigContextOptions.Visibility=_editingContext==EditingContext.Rig?Visibility.Visible:Visibility.Collapsed;
        AuthoringPanel.Visibility=active?Visibility.Visible:Visibility.Collapsed;
        MeshCanvas.RigEnabled=_editingContext==EditingContext.Rig;
        MeshCanvas.RigSubcontext=_rigContext;MeshCanvas.RigTool=_rigTool;
        if(_editingContext==EditingContext.Rig)
        {
            ToolList.ItemsSource=_rigContext=="Weight"?new[]{"選択","塗る","消す"}:_rigContext=="Warp"?new[]{"選択","移動"}:new[]{"選択","移動","追加","削除"};
            ToolList.SelectedItem=_rigTool;
            ActiveContextBadge.Text=$"リグ / {_rigContext}";
            ActiveToolSettingsText.Text=$"{_rigTool} — {_rigContext}の編集";
        }
        if(active&&_client?.HasAuthoritativeProjection==true)_=RefreshRigSurfaceAsync();
    }
    private async Task RefreshRigSurfaceAsync()
    {try{await RefreshProjectionAsync();}catch(Exception error){StatusText.Text=error.Message;}}
    private void RigContext_Click(object sender,RoutedEventArgs e)
    {
        if(_meshBusy||_documentBusy)return;
        _rigContext=((FrameworkElement)sender).Tag!.ToString()!;_rigTool="選択";
        _rigPanelKey=null;_contextDraft=false;_selectedControlPoints.Clear();MeshCanvas.Cancel();ConfigureRigContext();
    }
    private async Task RefreshRigAsync(ProductHostClient client)
    {
        if(_editingContext is not (EditingContext.Rig or EditingContext.Deform))return;
        var context=CurrentRigContext();
        // Deleted selected IDs are invalidated from the authoritative tree, not guessed from display names.
        if(context.BoneId is not null&&!_targets.Targets.Any(t=>t.Id==context.BoneId))_selectedBoneId=null;
        if(context.DeformerId is not null&&!_targets.Targets.Any(t=>t.Id==context.DeformerId))_selectedWarpId=null;
        context=CurrentRigContext();var response=await client.GetRigAsync(context);
        client.AssertCurrent(response.DocumentToken!,response.Revision!.Value);
        _rigSnapshot=response.Payload;_rigRevision=response.Revision.Value;
        MeshCanvas.ApplyRig(_rigSnapshot,_selectedBoneId,_selectedWarpId,_bonePoseMode,_selectedControlPoints);
        var key=$"{response.DocumentToken}/{_editingContext}/{_rigContext}/{context.NodeId}/{context.KeyArtId}/{context.BoneId}/{context.DeformerId}/{_bonePoseMode}";
        if(_contextDraft&&_rigPanelKey==key)return;
        _rigPanelKey=key;AuthoringPanel.Children.Clear();
        if(_editingContext==EditingContext.Deform){BuildFormPanel(context,_rigRevision);return;}
        if(_rigContext=="Bone")BuildBonePanel(context,_rigRevision);
        else if(_rigContext=="Warp")BuildWarpPanel(context,_rigRevision);
        else BuildWeightPanel(context,_rigRevision);
    }
    private IEnumerable<EntityChoice> BoneChoices() => ArrayOf(_rigSnapshot,"bones").Select(b=>new EntityChoice(String(b,"id")!,String(b,"displayName")??"Bone"));
    private void BuildBonePanel(RigContext context,long revision)
    {
        var panel=AuthoringPanel;
        var select=Choices(panel,"編集するBone",BoneChoices(),_selectedBoneId);
        select.SelectionChanged+=(_,_)=>{_selectedBoneId=(select.SelectedItem as EntityChoice)?.Id;_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var poseMode=Check(panel,"原画のポーズを編集（オフで骨の初期形状）",_bonePoseMode);
        poseMode.Click+=(_,_)=>{_bonePoseMode=poseMode.IsChecked==true;_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var bone=Property(Property(_rigSnapshot,"bone"),"selectedBone");
        var pose=Property(Property(_rigSnapshot,"bone"),"keyform");
        var value=Property(_bonePoseMode?pose:bone,_bonePoseMode?"localDelta":"restLocalTransform");
        var name=Field(panel,"名前",String(bone,"displayName")??"Bone");
        var x=Field(panel,"X（親の座標）",Number(value,"x"));var y=Field(panel,"Y（親の座標）",Number(value,"y"));
        var rotation=Field(panel,"回転（度）",Number(value,"rotation")*180/Math.PI);
        var length=Field(panel,"長さ",Number(bone,"length",100));
        ActionButton(panel,"新しいBone／選択Boneの子を追加",()=>RunRigEditAsync(()=>RigEdit.CreateBone(name.Text,ReadNumber(length)),context,revision));
        if(context.BoneId is not null)
        {
            ActionButton(panel,_bonePoseMode?"この原画のポーズを確定":"初期形状を確定",()=>RunRigEditAsync(()=>_bonePoseMode?
                RigEdit.BonePose(ReadNumber(x),ReadNumber(y),ReadNumber(rotation)*Math.PI/180):RigEdit.BoneRest(ReadNumber(x),ReadNumber(y),ReadNumber(rotation)*Math.PI/180,ReadNumber(length)),context,revision));
            ActionButton(panel,"名前を変更",()=>RunRigEditAsync(()=>RigEdit.RenameBone(name.Text),context,revision));
            var boneEnabled=Check(panel,"Boneを有効にする",Property(bone,"enabled").ValueKind!=JsonValueKind.False);
            ActionButton(panel,"Boneの有効状態を確定",()=>RunRigEditAsync(()=>RigEdit.EnableBone(boneEnabled.IsChecked==true),context,revision));
            ActionButton(panel,"ポーズをリセット",()=>RunRigEditAsync(RigEdit.ResetBone,context,revision));
            ActionButton(panel,"選択パーツをこのBoneに固定",()=>RunRigEditAsync(RigEdit.BindBone,context,revision));
            ActionButton(panel,"選択パーツの固定を解除",()=>RunRigEditAsync(RigEdit.UnbindBone,context,revision));
            var rigid=ArrayOf(_rigSnapshot,"rigidBindings").FirstOrDefault(b=>String(b,"targetNodeId")==context.NodeId);
            if(rigid.ValueKind==JsonValueKind.Object)
            {
                var rigidEnabled=Check(panel,"Boneへの固定を有効にする",Property(rigid,"enabled").ValueKind==JsonValueKind.True);
                ActionButton(panel,"固定の有効状態を確定",()=>RunRigEditAsync(()=>RigEdit.EnableRigidBinding(rigidEnabled.IsChecked==true),context,revision));
            }
            var parents=BoneChoices().Where(b=>b.Id!=context.BoneId).Prepend(new EntityChoice(String(_rigSnapshot,"rootId")!,"ルート"));
            var parent=Choices(panel,"親Bone／ルート",parents,String(bone,"parentNodeId"));
            ActionButton(panel,"親を変更",()=>RunRigEditAsync(()=>RigEdit.ReparentBone(Chosen(parent)),context,revision));
            var limit=ArrayOf(_rigSnapshot,"rotationConstraints").FirstOrDefault(c=>String(c,"boneId")==context.BoneId);
            var minimum=Field(panel,"回転制限 最小（度）",Number(limit,"minRotation",-Math.PI)*180/Math.PI);
            var maximum=Field(panel,"回転制限 最大（度）",Number(limit,"maxRotation",Math.PI)*180/Math.PI);
            var enabled=Check(panel,"回転制限を有効にする",Property(limit,"enabled").ValueKind!=JsonValueKind.False);
            ActionButton(panel,"回転制限を確定",()=>RunRigEditAsync(()=>RigEdit.LimitBone(ReadNumber(minimum)*Math.PI/180,ReadNumber(maximum)*Math.PI/180,enabled.IsChecked==true),context,revision));
            if(String(limit,"id") is { } limitId)ActionButton(panel,"回転制限を削除",()=>RunRigEditAsync(()=>RigEdit.RemoveLimit(limitId),context,revision));
            var mirror=Choices(panel,"左右反転先のBone",BoneChoices().Where(b=>b.Id!=context.BoneId));var axis=Field(panel,"反転軸 X",0);
            ActionButton(panel,"選択先へ左右反転",()=>RunRigEditAsync(()=>RigEdit.MirrorBone(Chosen(mirror),ReadNumber(axis),_bonePoseMode),context,revision));
            ActionButton(panel,"Boneを削除",()=>RunRigEditAsync(RigEdit.RemoveBone,context,revision));
        }
        var mid=Choices(panel,"2ボーンIK 中間Bone",BoneChoices());var end=Choices(panel,"2ボーンIK 終端Bone",BoneChoices());
        var clockwise=Check(panel,"時計回りに曲げる",false);
        ActionButton(panel,"選択Boneを根にしてIKを作る",()=>RunRigEditAsync(()=>RigEdit.CreateIk(context.BoneId??throw new ArgumentException("根Boneを選択してください。"),Chosen(mid),Chosen(end),clockwise.IsChecked==true),context,revision));
        foreach(var ik in ArrayOf(_rigSnapshot,"ikConstraints"))
        {
            var id=String(ik,"id")!;Note(panel,$"IK: {BoneChoices().FirstOrDefault(b=>b.Id==String(ik,"rootBoneId"))?.Label}");
            var tx=Field(panel,"到達先 X（文書座標）",0);var ty=Field(panel,"到達先 Y（文書座標）",0);
            ActionButton(panel,"この原画へIKポーズを適用",()=>RunRigEditAsync(()=>RigEdit.IkTarget(id,ReadNumber(tx),ReadNumber(ty)),context,revision));
            var active=Check(panel,"IKを有効にする",Property(ik,"enabled").ValueKind==JsonValueKind.True);
            ActionButton(panel,"有効／曲げ方向を変更",async()=>{await RunRigEditAsync(()=>RigEdit.EnableIk(id,active.IsChecked==true),context,revision);});
            ActionButton(panel,"曲げ方向を変更",()=>RunRigEditAsync(()=>RigEdit.BendIk(id,clockwise.IsChecked==true),context,revision));
            ActionButton(panel,"IKを削除",()=>RunRigEditAsync(()=>RigEdit.RemoveIk(id),context,revision));
        }
    }
    private void BuildWarpPanel(RigContext context,long revision)
    {
        var panel=AuthoringPanel;var warps=ArrayOf(_rigSnapshot,"warps");
        var select=Choices(panel,"編集するWarp",warps.Select(w=>new EntityChoice(String(w,"id")!,String(w,"displayName")??"Warp")),context.DeformerId);
        select.SelectionChanged+=(_,_)=>{_selectedWarpId=(select.SelectedItem as EntityChoice)?.Id;_selectedControlPoints.Clear();_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var warp=warps.FirstOrDefault(w=>String(w,"id")==context.DeformerId);
        var name=Field(panel,"名前",String(warp,"displayName")??"Warp");var grid=Choices(panel,"格子",new[]{2,3,4}.Select(n=>new EntityChoice(n.ToString(),$"{n} × {n}")),Number(warp,"columns",3).ToString());
        var parent=Choices(panel,"親（ネスト先）",warps.Where(w=>String(w,"id")!=context.DeformerId).Select(w=>new EntityChoice(String(w,"id")!,String(w,"displayName")??"Warp"))
            .Prepend(new EntityChoice(String(_rigSnapshot,"rootId")!,"ルート")),String(_rigSnapshot,"rootId"));
        var bounds=Property(warp,"bounds");var left=Field(panel,"範囲 左",Number(bounds,"left"));var top=Field(panel,"範囲 上",Number(bounds,"top"));
        var right=Field(panel,"範囲 右",Number(bounds,"right",512));var bottom=Field(panel,"範囲 下",Number(bounds,"bottom",512));
        ActionButton(panel,"Warpを作成して選択パーツを入れる",()=>RunRigEditAsync(()=>RigEdit.CreateWarp(name.Text,Chosen(parent),int.Parse(Chosen(grid)),ReadNumber(left),ReadNumber(top),ReadNumber(right),ReadNumber(bottom),context.NodeId is { } n?[n]:[]),context,revision));
        if(context.DeformerId is null)return;
        ActionButton(panel,"名前を変更",()=>RunRigEditAsync(()=>RigEdit.RenameWarp(name.Text),context,revision));
        ActionButton(panel,"格子を変更",()=>RunRigEditAsync(()=>RigEdit.WarpGrid(int.Parse(Chosen(grid))),context,revision));
        ActionButton(panel,"選択対象をこのWarpへ移動",()=>RunRigEditAsync(()=>RigEdit.AttachWarp(context.DeformerId),context,revision));
        ActionButton(panel,"このWarpの親を変更",()=>RunRigEditAsync(()=>RigEdit.AttachWarp(Chosen(parent)),context with {NodeId=context.DeformerId},revision));
        Note(panel,"制御点を画面で選択・移動できます。Shiftで複数選択。");
        var dx=Field(panel,"制御点の移動 X",0);var dy=Field(panel,"制御点の移動 Y",0);
        ActionButton(panel,"選択した制御点を移動",()=>RunRigEditAsync(()=>RigEdit.MoveWarp(_selectedControlPoints.ToArray(),ReadNumber(dx),ReadNumber(dy)),context,revision));
        ActionButton(panel,"選択した制御点をリセット",()=>RunRigEditAsync(()=>RigEdit.ResetWarp(_selectedControlPoints.ToArray()),context,revision));
        ActionButton(panel,"全制御点をリセット",()=>RunRigEditAsync(()=>RigEdit.ResetWarp(ArrayOf(warp,"positions").Select(p=>String(p,"controlPointId")!).ToArray()),context,revision));
        ActionButton(panel,"Warpを削除（中の対象は保持）",()=>RunRigEditAsync(RigEdit.RemoveWarp,context,revision));
    }
    private void BuildWeightPanel(RigContext context,long revision)
    {
        var panel=AuthoringPanel;var bone=Choices(panel,"ウェイトを編集するBone",BoneChoices(),context.BoneId);
        bone.SelectionChanged+=(_,_)=>{_selectedBoneId=(bone.SelectedItem as EntityChoice)?.Id;_contextDraft=false;_=RefreshRigSurfaceAsync();};
        var part=Property(_rigSnapshot,"part");var topology=Property(part,"topology");
        Note(panel,"パーツとBoneを選び、頂点を塗って影響度を調整します。1ストロークで1回のUndoです。");
        ActionButton(panel,"全頂点をこのBoneへ割り当てて開始",()=>RunRigEditAsync(()=>RigEdit.CreateSkin(String(topology,"id")??throw new ArgumentException("先にメッシュを作成してください。")),context,revision));
        if(context.BindingId is not null)
        {
            var weight=Field(panel,"数値ウェイト（0〜1）",1);var strength=Field(panel,"ブラシ強度（0より大きく1以下）",MeshCanvas.WeightStrength);
            strength.TextChanged+=(_,_)=>{if(double.TryParse(strength.Text,out var n)&&n>0&&n<=1)MeshCanvas.WeightStrength=n;};
            ActionButton(panel,"選択頂点のウェイトを設定",()=>RunRigEditAsync(()=>RigEdit.SetWeight(MeshCanvas.Selected.Single(),ReadNumber(weight)),context,revision));
            ActionButton(panel,"選択頂点を正規化",()=>RunRigEditAsync(()=>RigEdit.NormalizeWeight(MeshCanvas.Selected.Single()),context,revision));
            var binding=ArrayOf(_rigSnapshot,"skinBindings").First(b=>String(b,"id")==context.BindingId);
            var replace=Section(panel,"影響するBoneを明示して置換");
            Note(replace,"頂点を1つ選択し、最大4本のBoneとウェイトを指定します。合計は1にしてください。空欄は使いません。");
            var influences=new List<(ComboBox Bone,TextBox Weight)>();
            for(var i=0;i<4;i++)influences.Add((Choices(replace,$"Bone {i+1}",BoneChoices().Prepend(new EntityChoice("","—")),i==0?context.BoneId:""),Field(replace,$"ウェイト {i+1}",i==0?1:0)));
            ActionButton(replace,"選択頂点の影響を置換",()=>RunRigEditAsync(()=>RigEdit.ReplaceWeights(MeshCanvas.Selected.Single(),influences.Where(v=>(v.Bone.SelectedItem as EntityChoice)?.Id is {Length:>0}).Select(v=>(Chosen(v.Bone),ReadNumber(v.Weight))).ToArray()),context,revision));
            ActionButton(replace,"選択頂点の全ウェイトを解除（Skin無効時）",()=>RunRigEditAsync(()=>RigEdit.ClearWeights(MeshCanvas.Selected.Single()),context,revision));
            var enabled=Check(panel,"スキニングを有効にする",Property(binding,"enabled").ValueKind==JsonValueKind.True);
            ActionButton(panel,"有効状態を確定",()=>RunRigEditAsync(()=>RigEdit.EnableSkin(enabled.IsChecked==true),context,revision));
            ActionButton(panel,"SkinBindingを削除",()=>RunRigEditAsync(RigEdit.RemoveSkin,context,revision));
        }
        var clip=Property(_rigSnapshot,"clipping");
        var sources=Choices(panel,"クリッピング元",ArrayOf(clip,"sourceCandidates").Select(c=>new EntityChoice(String(c,"id")!,String(c,"displayName")??"Part")),String(Property(clip,"binding"),"sourceNodeId"));
        ActionButton(panel,"クリッピング元を設定",()=>RunRigEditAsync(()=>RigEdit.ClipSource(Chosen(sources)),context,revision));
        if(Property(clip,"binding").ValueKind==JsonValueKind.Object)
        {
            var enabled=Check(panel,"クリッピングを有効にする",Property(Property(clip,"binding"),"enabled").ValueKind==JsonValueKind.True);
            ActionButton(panel,"クリッピングの有効状態を確定",()=>RunRigEditAsync(()=>RigEdit.EnableClipping(enabled.IsChecked==true),context,revision));
        }
        ActionButton(panel,"クリッピングを解除",()=>RunRigEditAsync(RigEdit.RemoveClipping,context,revision));
    }
    private void BuildFormPanel(RigContext context,long revision)
    {
        Note(AuthoringPanel,"形状補正：骨やWarpで動かした後の形を整えます。メッシュの構造・原画上の位置決めは変更しません。");
        Note(AuthoringPanel,"頂点を選択・ドラッグして補正します。Shiftで複数選択、Ctrl+Aで全選択、Escで取消。");
        var x=Field(AuthoringPanel,"補正 X",0);var y=Field(AuthoringPanel,"補正 Y",0);
        ActionButton(AuthoringPanel,"選択頂点へ補正を加える",()=>RunRigEditAsync(()=>RigEdit.FormMove(MeshCanvas.Selected.ToArray(),ReadNumber(x),ReadNumber(y)),context,revision));
        ActionButton(AuthoringPanel,"この原画の補正をリセット",()=>RunRigEditAsync(RigEdit.ResetForm,context,revision));
    }
}
