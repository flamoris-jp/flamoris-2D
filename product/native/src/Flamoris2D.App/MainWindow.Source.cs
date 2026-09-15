using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private async void ReimportSource_Click(object sender,RoutedEventArgs e)
    {
        if(_documentBusy||_meshBusy||_client?.HasAuthoritativeProjection!=true)return;
        var dialog=new OpenFileDialog {Filter="Photoshop (*.psd)|*.psd",Title="更新したPSDを照合"};
        if(dialog.ShowDialog(this)!=true)return;
        string? candidateId=null;
        try
        {
            _documentBusy=true;SetMeshBusy(true);_meshWork=new CancellationTokenSource();
            CancelArtworkButton.Visibility=Visibility.Visible;CancelArtworkButton.IsEnabled=true;
            StatusText.Text="PSDの変更を照合しています…";
            await using var input=File.OpenRead(dialog.FileName);
            var response=await _client.AnalyzeReimportAsync(input,input.Length,Path.GetFileName(dialog.FileName),_meshWork.Token);
            candidateId=String(response.Payload,"id")!;
            CancelArtworkButton.Visibility=Visibility.Collapsed;
            ShowSourceReview(response.Payload,_client.Revision);
            await RefreshProjectionAsync();
        }
        catch(Exception error){StatusText.Text=$"再取込できませんでした: {error.Message}";}
        finally
        {
            if(candidateId is not null&&_client is not null)
                try{await _client.DiscardSourceReviewAsync(candidateId);}catch(Exception error){StatusText.Text=error.Message;}
            _meshWork?.Dispose();_meshWork=null;_documentBusy=false;SetMeshBusy(false);CancelArtworkButton.Visibility=Visibility.Collapsed;
        }
    }
    private void ShowSourceReview(JsonElement projection,long revision)
    {
        var id=String(projection,"id")!;
        var dialog=new Window {Owner=this,Title="PSD再取込レビュー",Width=740,Height=700,Background=new SolidColorBrush(Color.FromRgb(30,32,38)),WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var root=new DockPanel {Margin=new Thickness(14)};var footer=new StackPanel();DockPanel.SetDock(footer,Dock.Bottom);root.Children.Add(footer);
        var rows=new StackPanel();root.Children.Add(new ScrollViewer {Content=rows,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});dialog.Content=root;
        var status=new TextBlock {Foreground=Brushes.White,TextWrapping=TextWrapping.Wrap};footer.Children.Add(status);
        var apply=new Button {Content="確認した変更を適用",Padding=new Thickness(10),Margin=new Thickness(0,10,0,0)};footer.Children.Add(apply);
        var busy=false;
        dialog.Closing+=(_,e)=>{if(busy)e.Cancel=true;};
        async Task Change(string rowId,string action,string? imported=null)
        {
            if(busy)return;busy=true;rows.IsEnabled=false;apply.IsEnabled=false;
            try{projection=(await _client!.ChangeSourceReviewAsync(id,rowId,action,imported,revision)).Payload;Build();status.Text="";}
            catch(Exception error){status.Text=error.Message;}
            finally{busy=false;rows.IsEnabled=true;apply.IsEnabled=Property(projection,"canApply").GetBoolean();}
        }
        void Build()
        {
            rows.Children.Clear();Note(rows,"更新・追加・保持・削除を確認してください。対応が曖昧なレイヤーは手動で照合します。Rigやアニメーションを壊す削除は適用時に拒否されます。");
            foreach(var row in ArrayOf(projection,"rows"))
            {
                var rowId=String(row,"id")!;var panel=new StackPanel {Margin=new Thickness(0,8,0,10)};rows.Children.Add(panel);
                var action=String(row,"action") switch {"update"=>"更新","add"=>"追加","keep"=>"保持","remove"=>"削除","ignore"=>"無視",_=>"要確認"};
                Note(panel,$"{String(row,"displayName")} — {action}");Note(panel,String(row,"explanation")??"");
                var choices=Choices(panel,"対応する更新後のレイヤー",ArrayOf(row,"choices").Select(n=>new EntityChoice(String(n,"id")!,String(n,"displayName")!)),String(row,"importedNodeId"));
                ActionButton(panel,"選択したレイヤーと対応付け",()=>Change(rowId,"match",(choices.SelectedItem as EntityChoice)?.Id));
                if(String(row,"currentNodeId") is not null){ActionButton(panel,"現在のレイヤーを保持",()=>Change(rowId,"keep"));ActionButton(panel,"現在のレイヤーを削除",()=>Change(rowId,"remove"));}
                else{ActionButton(panel,"新しいレイヤーとして追加",()=>Change(rowId,"add"));ActionButton(panel,"この追加を無視",()=>Change(rowId,"ignore"));}
                ActionButton(panel,"自動判定へ戻す",()=>Change(rowId,"auto"));
            }
            apply.IsEnabled=Property(projection,"canApply").GetBoolean();
        }
        apply.Click+=async(_,_)=>
        {
            if(busy)return;busy=true;apply.IsEnabled=false;rows.IsEnabled=false;
            try{await _client!.ApplySourceReviewAsync(id,revision);busy=false;dialog.DialogResult=true;StatusText.Text="PSDを更新しました。元に戻す操作で画像と編集状態を一緒に戻せます。";}
            catch(Exception error){status.Text=error.Message;}
            finally{busy=false;rows.IsEnabled=true;apply.IsEnabled=Property(projection,"canApply").GetBoolean();}
        };
        Build();dialog.ShowDialog();
    }
}
