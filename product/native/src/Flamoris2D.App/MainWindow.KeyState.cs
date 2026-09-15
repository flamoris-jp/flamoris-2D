using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Flamoris.Flamoris2D.ProductHost;
namespace Flamoris.Flamoris2D.App;
public partial class MainWindow
{
    private string? _keyTransitionId,_keySlotId,_keyPanelKey;
    private readonly Dictionary<string,CorrespondencePin> _correspondencePins=[];
    private long _pinRevision=-1;
    private string? _selectedSampleId;
    private readonly Dictionary<string,VertexOffset> _sampleOffsets=[];
    private static StackPanel Section(Panel parent,string label,bool open=false)
    {
        var content=new StackPanel {Margin=new Thickness(5)};
        parent.Children.Add(new Expander {Header=label,Content=content,IsExpanded=open,Foreground=Brushes.White,Margin=new Thickness(0,6,0,0)});return content;
    }
    private KeyStateContext CurrentKeyState()=>new(_renderChoice?.Kind=="keyArt"?_renderChoice.Id:null,_keyTransitionId,_keySlotId,_targets.SelectedId);
    private async Task RunKeyStateAsync(Func<KeyStateEdit> make,KeyStateContext context,long revision)
    {
        if(_client?.HasAuthoritativeProjection!=true||_meshBusy||_documentBusy)return;
        SetMeshBusy(true);MeshCanvas.Cancel();
        try
        {
            var r=await _client.EditKeyStateAsync(context,make(),revision);
            if(String(r.Payload,"keyArtId") is { } art){_renderChoice=new(art,"keyArt","原画");_meshChoices.Clear();}
            if(String(r.Payload,"transitionId") is { } transition)_keyTransitionId=transition;
            if(String(r.Payload,"sampleId") is { } sample)_selectedSampleId=sample;
            _contextDraft=false;_keyPanelKey=null;_correspondencePins.Clear();await RefreshProjectionAsync();StatusText.Text="原画・遷移の編集を確定しました。";
        }
        catch(Exception error){StatusText.Text=$"編集できませんでした: {error.Message}";}
        finally{SetMeshBusy(false);}
    }
    private async Task RefreshKeyStateAsync(ProductHostClient client)
    {
        var active=_editingContext is EditingContext.Source or EditingContext.Mesh or EditingContext.Deform;
        KeyStatePanel.Visibility=active?Visibility.Visible:Visibility.Collapsed;if(!active)return;
        // Deleted selections are cleared before requesting the authoritative projection.
        var empty=await client.GetKeyStateAsync(new());
        if(!ArrayOf(empty.Payload,"transitions").Any(t=>String(t,"id")==_keyTransitionId))_keyTransitionId=null;
        if(!ArrayOf(empty.Payload,"slots").Any(t=>String(t,"id")==_keySlotId))_keySlotId=null;
        var context=CurrentKeyState();var response=await client.GetKeyStateAsync(context);var state=response.Payload;var revision=response.Revision!.Value;
        client.AssertCurrent(response.DocumentToken!,revision);
        if(_pinRevision!=revision){_correspondencePins.Clear();_pinRevision=revision;}
        var key=$"{response.DocumentToken}/{context}/{_editingContext}/{_targets.SelectedId}/{MeshCanvas.KeyformId}";
        if(_contextDraft&&_keyPanelKey==key)return;_keyPanelKey=key;KeyStatePanel.Children.Clear();
        if(_editingContext==EditingContext.Source)BuildObjectPanel(state,context,revision);
        var artPanel=Section(KeyStatePanel,"原画・Key State",context.KeyArtId is null);
        var selected=Property(state,"selectedKeyArt");var name=Field(artPanel,"原画名",String(selected,"displayName")??"新しい原画");
        ActionButton(artPanel,"全パーツを表示対象へ含める",()=>RunKeyStateAsync(KeyStateEdit.IncludeSource,context,revision));
        if(context.KeyArtId is not null)
        {
            ActionButton(artPanel,"この状態を複製して次の原画を作る",()=>RunKeyStateAsync(()=>KeyStateEdit.DuplicateArt(name.Text),context,revision));
            ActionButton(artPanel,"原画名を更新",()=>RunKeyStateAsync(()=>KeyStateEdit.RenameArt(name.Text),context,revision));
            ActionButton(artPanel,"原画を削除（参照中は不可）",()=>RunKeyStateAsync(KeyStateEdit.RemoveArt,context,revision));
            var member=ArrayOf(selected,"members").FirstOrDefault(m=>String(m,"nodeId")==_targets.SelectedId);
            if(member.ValueKind==JsonValueKind.Object)
            {
                var opacity=Field(artPanel,"選択パーツの不透明度 0〜1",Number(member,"opacity",1));var order=Field(artPanel,"原画内の重ね順",Number(member,"drawOrder"));
                var presence=Choices(artPanel,"表示状態",new[]{new EntityChoice("present","表示"),new("absent","非表示"),new("occluded","遮蔽")},String(member,"presence"));
                var node=String(member,"nodeId")!;ActionButton(artPanel,"パーツの表示状態を更新",()=>RunKeyStateAsync(()=>KeyStateEdit.Member(node,ReadNumber(opacity),Chosen(presence),checked((int)ReadNumber(order))),context,revision));
            }
        }
        if(_editingContext==EditingContext.Mesh&&context.KeyArtId is not null&&MeshCanvas.KeyformId is { } keyformId&&!MeshCanvas.Structure)
        {
            var panel=Section(KeyStatePanel,"メッシュ全体の位置決め",true);Note(panel,"原画上の配置を変更します。ポーズ補正は「変形」で編集します。");
            var x=Field(panel,"移動 X",0);var y=Field(panel,"移動 Y",0);var r=Field(panel,"回転（度）",0);var sx=Field(panel,"拡大率 X",1);var sy=Field(panel,"拡大率 Y",1);
            var px=Field(panel,"基準点 X",0);var py=Field(panel,"基準点 Y",0);
            ActionButton(panel,"位置決めを適用",()=>RunKeyStateAsync(()=>KeyStateEdit.Alignment(keyformId,ReadNumber(x),ReadNumber(y),ReadNumber(r)*Math.PI/180,ReadNumber(sx),ReadNumber(sy),ReadNumber(px),ReadNumber(py)),context,revision));
        }
        BuildTransitionPanel(state,context,revision);
        if(_editingContext==EditingContext.Deform)BuildSamplePanel(state,context,revision);
        if(_editingContext==EditingContext.Mesh)BuildMeshResourcePanel(state,context,revision);
    }
    private void BuildMeshResourcePanel(JsonElement state,KeyStateContext context,long revision)
    {
        var panel=Section(KeyStatePanel,"画像の割当・メッシュの削除");
        if(MeshCanvas.KeyformId is { } keyformId)
        {
            var form=ArrayOf(state,"keyforms").First(k=>String(k,"id")==keyformId);var uvs=Property(form,"uvs").EnumerateArray().Select(v=>v.GetDouble()).ToArray();
            var vertex=Choices(panel,"画像の割当を編集する頂点",MeshCanvas.VertexIds.Select((v,i)=>new EntityChoice(v,$"頂点 {i+1} · {v}")),MeshCanvas.Selected.FirstOrDefault());
            var u=Field(panel,"U（画像の左0 → 右1）",0);var v=Field(panel,"V（画像の上0 → 下1）",0);
            void SetUv(){var i=Array.IndexOf(MeshCanvas.VertexIds,(vertex.SelectedItem as EntityChoice)?.Id);if(i>=0){u.Text=uvs[i*2].ToString(System.Globalization.CultureInfo.InvariantCulture);v.Text=uvs[i*2+1].ToString(System.Globalization.CultureInfo.InvariantCulture);}}
            SetUv();vertex.SelectionChanged+=(_,_)=>SetUv();
            ActionButton(panel,"選択頂点の画像割当を更新",()=>RunKeyStateAsync(()=>KeyStateEdit.VertexUv(keyformId,Chosen(vertex),ReadNumber(u),ReadNumber(v)),context,revision));
            ActionButton(panel,"この原画のメッシュ配置を削除",()=>RunKeyStateAsync(()=>KeyStateEdit.RemoveKeyform(keyformId),context,revision));
        }
        Note(panel,"他の原画・遷移・リグ・変形が参照するデータは削除できません。参照先を自動で消す操作ではありません。");
        var topology=Choices(panel,"削除する未使用のメッシュ構造",ArrayOf(state,"topologies").Select(t=>new EntityChoice(String(t,"id")!,String(t,"id")!)));
        ActionButton(panel,"未使用のメッシュ構造を削除",()=>RunKeyStateAsync(()=>KeyStateEdit.RemoveTopology(Chosen(topology)),context,revision));
    }
    private void BuildObjectPanel(JsonElement state,KeyStateContext context,long revision)
    {
        var node=Property(state,"node");var panel=Section(KeyStatePanel,"配置・グループ",true);
        var groups=Choices(panel,"親グループ",ArrayOf(state,"groups").Select(g=>new EntityChoice(String(g,"id")!,String(g,"displayName")!)),String(node,"parentId"));
        var groupName=Field(panel,"新しいグループ名","グループ");
        ActionButton(panel,"グループを作成",()=>RunKeyStateAsync(()=>KeyStateEdit.CreateGroup(Chosen(groups),groupName.Text),context,revision));
        if(node.ValueKind!=JsonValueKind.Object||String(node,"kind") is not ("part" or "group"))return;
        var transform=Property(node,"transform");var position=Property(transform,"position");var scale=Property(transform,"scale");var pivot=Property(transform,"pivot");
        var x=Field(panel,"位置 X",Number(position,"x"));var y=Field(panel,"位置 Y",Number(position,"y"));var rotation=Field(panel,"回転（度）",Number(transform,"rotation")*180/Math.PI);
        var sx=Field(panel,"拡大率 X",Number(scale,"x",1));var sy=Field(panel,"拡大率 Y",Number(scale,"y",1));var px=Field(panel,"中心 X",Number(pivot,"x"));var py=Field(panel,"中心 Y",Number(pivot,"y"));
        ActionButton(panel,"配置を適用",()=>RunKeyStateAsync(()=>KeyStateEdit.ObjectTransform(ReadNumber(x),ReadNumber(y),ReadNumber(rotation)*Math.PI/180,ReadNumber(sx),ReadNumber(sy),ReadNumber(px),ReadNumber(py)),context,revision));
        var index=Field(panel,"グループ内の位置（0から）",0);
        ActionButton(panel,"親グループ・並び順を変更",()=>RunKeyStateAsync(()=>KeyStateEdit.Reparent(Chosen(groups),checked((int)ReadTicks(index))),context,revision));
    }
    private void BuildTransitionPanel(JsonElement state,KeyStateContext context,long revision)
    {
        var panel=Section(KeyStatePanel,"遷移・パーツ対応",_editingContext==EditingContext.Deform);
        var transitions=Choices(panel,"編集する遷移",ArrayOf(state,"transitions").Select(t=>new EntityChoice(String(t,"id")!,String(t,"displayName")!)),_keyTransitionId);
        transitions.SelectionChanged+=async(_,_)=>{_keyTransitionId=(transitions.SelectedItem as EntityChoice)?.Id;_contextDraft=false;_keyPanelKey=null;_correspondencePins.Clear();await RefreshRigSurfaceAsync();};
        var transition=Property(state,"activeTransition");var name=Field(panel,"遷移名",String(transition,"displayName")??"新しい遷移");var seconds=Field(panel,"長さ（秒）",Number(state,"durationSeconds",1));
        var arts=ArrayOf(state,"keyArts").Select(k=>new EntityChoice(String(k,"id")!,String(k,"displayName")!)).ToArray();
        var from=Choices(panel,"開始原画 A",arts,String(transition,"fromKeyArtId")??context.KeyArtId);var to=Choices(panel,"終了原画 B",arts,String(transition,"toKeyArtId"));
        ActionButton(panel,"遷移を作成",()=>RunKeyStateAsync(()=>KeyStateEdit.CreateTransition(name.Text,Chosen(from),Chosen(to),ReadNumber(seconds)),context,revision));
        if(context.TransitionId is not null)
        {
            ActionButton(panel,"遷移名・長さを更新",()=>RunKeyStateAsync(()=>KeyStateEdit.UpdateTransition(name.Text,ReadNumber(seconds)),context,revision));
            ActionButton(panel,"開始原画を変更",()=>RunKeyStateAsync(()=>KeyStateEdit.Endpoint(true,Chosen(from)),context,revision));
            ActionButton(panel,"終了原画を変更",()=>RunKeyStateAsync(()=>KeyStateEdit.Endpoint(false,Chosen(to)),context,revision));
            ActionButton(panel,"遷移を削除",()=>RunKeyStateAsync(KeyStateEdit.RemoveTransition,context,revision));
            async Task SelectEndpoint(bool start){var art=start?Chosen(from):Chosen(to);_renderChoice=new(art,"keyArt","原画");_meshChoices.Clear();_contextDraft=false;await RefreshRigSurfaceAsync();}
            ActionButton(panel,"AのKey Stateを編集",()=>SelectEndpoint(true));ActionButton(panel,"BのKey Stateを編集",()=>SelectEndpoint(false));
            ActionButton(panel,"遷移をプレビュー",async()=>{_renderChoice=new(context.TransitionId,"transition","遷移");_timeTicks=0;SwitchContext(EditingContext.Preview,false);await RefreshRigSurfaceAsync();});
        }
        var slot=Choices(panel,"対応するパーツ（SemanticSlot）",ArrayOf(state,"slots").Select(s=>new EntityChoice(String(s,"id")!,String(s,"displayName")!)),context.SemanticSlotId);
        slot.SelectionChanged+=async(_,_)=>{_keySlotId=(slot.SelectedItem as EntityChoice)?.Id;_contextDraft=false;_correspondencePins.Clear();await RefreshRigSurfaceAsync();};
        var slotName=Field(panel,"パーツ対応名",ArrayOf(state,"slots").Where(s=>String(s,"id")==context.SemanticSlotId).Select(s=>String(s,"displayName")).FirstOrDefault()??"新しい対応");
        ActionButton(panel,"パーツ対応を作成",()=>RunKeyStateAsync(()=>KeyStateEdit.CreateSlot(slotName.Text),context,revision));
        if(context.SemanticSlotId is null)return;
        var mapArt=Choices(panel,"対応付ける原画",arts,context.KeyArtId);var node=Choices(panel,"対応付けるパーツ",ArrayOf(state,"nodes").Select(n=>new EntityChoice(String(n,"id")!,String(n,"displayName")!)),_targets.SelectedId);
        ActionButton(panel,"対応付けを適用",()=>RunKeyStateAsync(()=>KeyStateEdit.Map(Chosen(mapArt),Chosen(node)),context,revision));
        ActionButton(panel,"この原画の対応を解除",()=>RunKeyStateAsync(()=>KeyStateEdit.Unmap(Chosen(mapArt)),context,revision));
        ActionButton(panel,"パーツ対応名を更新",()=>RunKeyStateAsync(()=>KeyStateEdit.RenameSlot(slotName.Text),context,revision));
        ActionButton(panel,"パーツ対応を削除",()=>RunKeyStateAsync(KeyStateEdit.RemoveSlot,context,revision));
        if(context.TransitionId is null)return;
        var part=Property(Property(state,"selectedSemanticSlot"),"partTransition");
        var mode=Choices(panel,"遷移方法",new[]{new EntityChoice("morph","形状を補間"),new("hold","片側を保持"),new("replace","画像を切替"),new("appear","出現"),new("disappear","消失"),new("occlusion","遮蔽")},String(part,"mode")??"morph");
        var hold=Check(panel,"保持する原画はA",true);var group=Field(panel,"切替の合成グループ（任意）","");
        ActionButton(panel,"遷移方法を設定",()=>RunKeyStateAsync(()=>KeyStateEdit.Mode(Chosen(mode),hold.IsChecked==true,string.IsNullOrWhiteSpace(group.Text)?null:group.Text),context,revision));
        var forms=ArrayOf(state,"keyforms").Where(k=>String(k,"semanticSlotId")==context.SemanticSlotId).ToArray();
        var aForms=Choices(panel,"Aのメッシュ",forms.Where(k=>String(k,"keyArtId")==String(transition,"fromKeyArtId")).Select((k,i)=>new EntityChoice(String(k,"id")!,$"メッシュ {i+1}")),String(part,"fromKeyformId"));
        var bForms=Choices(panel,"Bのメッシュ",forms.Where(k=>String(k,"keyArtId")==String(transition,"toKeyArtId")).Select((k,i)=>new EntityChoice(String(k,"id")!,$"メッシュ {i+1}")),String(part,"toKeyformId"));
        ActionButton(panel,"共有Topologyと両端を接続",()=>RunKeyStateAsync(()=>KeyStateEdit.SharedTopology(String(forms.First(k=>String(k,"id")==Chosen(aForms)),"topologyId")!,Chosen(aForms),Chosen(bForms)),context,revision));
        foreach(var diagnostic in ArrayOf(state,"diagnostics"))
        {
            Note(panel,String(diagnostic,"message")??String(diagnostic,"code")??diagnostic.ToString());
            if(String(diagnostic,"key") is { } diagnosticKey)
            {
                var acknowledged=Property(diagnostic,"acknowledged").ValueKind==JsonValueKind.True;
                ActionButton(panel,acknowledged?"確認済みを取り消す":"この診断を確認済みにする",()=>RunKeyStateAsync(()=>acknowledged?KeyStateEdit.ClearDiagnosticAcknowledgement(diagnosticKey):KeyStateEdit.AcknowledgeDiagnostic(diagnosticKey),context,revision));
            }
        }
        BuildCorrespondencePanel(state,context,revision,part);
    }
    private void BuildCorrespondencePanel(JsonElement state,KeyStateContext context,long revision,JsonElement part)
    {
        var topology=ArrayOf(state,"topologies").FirstOrDefault(t=>String(t,"id")==String(part,"topologyId"));if(topology.ValueKind!=JsonValueKind.Object)return;
        var panel=Section(KeyStatePanel,"対応付けピン・位置の補助");
        var vertices=Property(topology,"vertexIds").EnumerateArray().Select((v,i)=>new EntityChoice(v.GetString()!,$"頂点 {i+1} · {v.GetString()}"));
        var vertex=Choices(panel,"固定する頂点",vertices,MeshCanvas.Selected.FirstOrDefault());var x=Field(panel,"対応先 X",0);var y=Field(panel,"対応先 Y",0);
        var preset=Choices(panel,"補助の強さ",new[]{new EntityChoice("soft","柔らかく"),new("normal","標準"),new("firm","強く")},"normal");var reverse=Check(panel,"B → Aへ対応付け",false);
        var count=new TextBlock {Text=$"ピン {_correspondencePins.Count}点",Foreground=Brushes.White};panel.Children.Add(count);
        ActionButton(panel,"ピンを追加・更新",()=>{try{var v=Chosen(vertex);_correspondencePins[v]=new(v,ReadNumber(x),ReadNumber(y));count.Text=$"ピン {_correspondencePins.Count}点";}catch(Exception error){StatusText.Text=error.Message;}return Task.CompletedTask;});
        ActionButton(panel,"選択ピンを削除",()=>{if(vertex.SelectedItem is EntityChoice v)_correspondencePins.Remove(v.Id);count.Text=$"ピン {_correspondencePins.Count}点";return Task.CompletedTask;});
        ActionButton(panel,"全ピンを解除",()=>{_correspondencePins.Clear();count.Text="ピン 0点";return Task.CompletedTask;});
        ActionButton(panel,"対応位置を試す",async()=>
        {
            try
            {
                var result=await _client!.SolveCorrespondenceAsync(context,_correspondencePins.Values.ToArray(),Chosen(preset),reverse.IsChecked==true,revision);
                var positions=Property(result.Payload,"candidatePositions");if(positions.ValueKind!=JsonValueKind.Array)throw new InvalidOperationException(Property(result.Payload,"diagnostics").ToString());
                var targetId=String(result.Payload,"targetKeyformId")!;var target=ArrayOf(state,"keyforms").First(k=>String(k,"id")==targetId);
                _renderChoice=new(String(target,"keyArtId")!,"keyArt","原画");await RefreshEvaluatedFrameAsync(_client,new(targetId,MeshViewport.Doubles(positions)));
                StatusText.Text="対応補助のプレビューです。「適用」で確定します。";
            }
            catch(Exception error){StatusText.Text=error.Message;}
        });
        ActionButton(panel,"対応補助を適用",()=>RunKeyStateAsync(()=>KeyStateEdit.ApplyCorrespondence(_correspondencePins.Values.ToArray(),Chosen(preset),reverse.IsChecked==true),context,revision));
        ActionButton(panel,"プレビューを取消",async()=>{_lastRenderKey=null;await RefreshRigSurfaceAsync();});
    }
    private void BuildSamplePanel(JsonElement state,KeyStateContext context,long revision)
    {
        var form=ArrayOf(state,"keyforms").FirstOrDefault(k=>String(k,"id")==MeshCanvas.KeyformId);if(form.ValueKind!=JsonValueKind.Object)return;
        var topologyId=String(form,"topologyId")!;
        var panel=Section(KeyStatePanel,"アニメーション用の形状・MeshDeformation",true);
        Note(panel,"骨・Warp・原画補正の後へ加える変位を作ります。AnimationのClipでMeshDeformationTrackに配置できます。");
        var samples=ArrayOf(state,"samples").Where(s=>String(s,"topologyId")==topologyId).ToArray();
        var select=Choices(panel,"編集する変形",samples.Select((s,i)=>new EntityChoice(String(s,"id")!,$"変形 {i+1}")),_selectedSampleId);
        var selected=samples.FirstOrDefault(s=>String(s,"id")==_selectedSampleId);_sampleOffsets.Clear();
        foreach(var offset in ArrayOf(selected,"offsets")){var v=String(offset,"vertexId")!;_sampleOffsets[v]=new(v,Number(offset,"dx"),Number(offset,"dy"));}
        select.SelectionChanged+=async(_,_)=>{_selectedSampleId=(select.SelectedItem as EntityChoice)?.Id;_contextDraft=false;await RefreshRigSurfaceAsync();};
        var x=Field(panel,"頂点の変位 X",0);var y=Field(panel,"頂点の変位 Y",0);
        var count=new TextBlock {Text=$"変位 {_sampleOffsets.Count}頂点",Foreground=Brushes.White};panel.Children.Add(count);
        ActionButton(panel,"選択頂点の変位を設定",()=>
        {
            try{foreach(var v in MeshCanvas.Selected)_sampleOffsets[v]=new(v,ReadNumber(x),ReadNumber(y));_contextDraft=true;count.Text=$"変位 {_sampleOffsets.Count}頂点";}
            catch(Exception error){StatusText.Text=error.Message;}return Task.CompletedTask;
        });
        ActionButton(panel,"選択頂点の変位を解除",()=>{foreach(var v in MeshCanvas.Selected)_sampleOffsets.Remove(v);_contextDraft=true;count.Text=$"変位 {_sampleOffsets.Count}頂点";return Task.CompletedTask;});
        ActionButton(panel,"新しいアニメーション変形を作成",()=>RunKeyStateAsync(()=>KeyStateEdit.CreateSample(null,topologyId,_sampleOffsets.Values.ToArray()),context,revision));
        if(selected.ValueKind==JsonValueKind.Object)
        {
            var sampleId=String(selected,"id")!;var meshId=String(selected,"meshId")!;
            ActionButton(panel,"選択した変形を更新",()=>RunKeyStateAsync(()=>KeyStateEdit.UpdateSample(sampleId,_sampleOffsets.Values.ToArray()),context,revision));
            ActionButton(panel,"同じターゲットへ別の変形を作成",()=>RunKeyStateAsync(()=>KeyStateEdit.CreateSample(meshId,topologyId,_sampleOffsets.Values.ToArray()),context,revision));
            ActionButton(panel,"選択した変形を削除",()=>RunKeyStateAsync(()=>KeyStateEdit.RemoveSample(sampleId),context,revision));
        }
        var target=Choices(panel,"使わなくなった変形ターゲット",ArrayOf(state,"meshes").Select((m,i)=>new EntityChoice(String(m,"id")!,$"ターゲット {i+1}")));
        ActionButton(panel,"未使用のターゲットを削除",()=>RunKeyStateAsync(()=>KeyStateEdit.RemoveMeshTarget(Chosen(target)),context,revision));
    }
}
