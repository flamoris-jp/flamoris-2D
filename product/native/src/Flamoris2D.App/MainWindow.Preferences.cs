using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Flamoris.Flamoris2D.ProductHost;
namespace Flamoris.Flamoris2D.App;
public partial class MainWindow
{
    private JsonElement _nativePreferences=JsonSerializer.SerializeToElement(new {});
    private readonly List<string> _recentFiles=[];
    private static string SettingsPath=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FLAMORIS","2D","native-settings.json");
    private bool PreferenceFlag(string key,bool fallback=false)=>Property(_nativePreferences,key).ValueKind is JsonValueKind.True or JsonValueKind.False?Property(_nativePreferences,key).GetBoolean():fallback;
    private async Task LoadNativeSettingsAsync()
    {
        if(_client?.HasAuthoritativeProjection!=true)return;
        try
        {
            if(File.Exists(SettingsPath)&&new FileInfo(SettingsPath).Length<=65536)
            {
                using var document=JsonDocument.Parse(await File.ReadAllTextAsync(SettingsPath));var root=document.RootElement;
                if(Property(root,"preferences").ValueKind==JsonValueKind.Object)_nativePreferences=Property(root,"preferences").Clone();
                foreach(var path in ArrayOf(root,"recentFiles").Where(v=>v.ValueKind==JsonValueKind.String).Select(v=>v.GetString()!).Where(File.Exists).Take(10))_recentFiles.Add(path);
                if(String(root,"encoderPath") is {Length:>0} encoder&&File.Exists(encoder))_encoderPath=encoder;
            }
            _nativePreferences=(await _client.NormalizePreferencesAsync(_nativePreferences)).Payload;ApplyNativePreferences();RefreshRecentMenu();
        }
        catch(Exception error){StatusText.Text=$"設定を読み込めませんでした: {error.Message}";}
    }
    private void ApplyNativePreferences()
    {
        _recoveryTimer.Stop();_recoveryTimer.Interval=TimeSpan.FromSeconds(Number(_nativePreferences,"autosaveIntervalSeconds",180));
        _recovery.RetainedVersions=(int)Number(_nativePreferences,"recoveryVersions",3);
        if(_autoConnect&&PreferenceFlag("autosaveEnabled",true))_recoveryTimer.Start();
    }
    private async Task SaveNativeSettingsAsync()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        var bytes=JsonSerializer.SerializeToUtf8Bytes(new {preferences=_nativePreferences,recentFiles=_recentFiles,encoderPath=_encoderPath});
        await AtomicDocumentFile.WriteAsync(SettingsPath,(stream,ct)=>stream.WriteAsync(bytes,ct).AsTask());
    }
    private async Task RememberRecentAsync(string path)
    {
        if(!_autoConnect)return;var full=Path.GetFullPath(path);_recentFiles.RemoveAll(p=>string.Equals(p,full,StringComparison.OrdinalIgnoreCase)||!File.Exists(p));_recentFiles.Insert(0,full);
        if(_recentFiles.Count>10)_recentFiles.RemoveRange(10,_recentFiles.Count-10);RefreshRecentMenu();
        try{await SaveNativeSettingsAsync();}catch(Exception error){StatusText.Text=$"ファイルは保存済みです。最近使ったファイル一覧の保存に失敗しました: {error.Message}";}
    }
    private void RefreshRecentMenu()
    {
        RecentFilesMenu.Items.Clear();
        foreach(var path in _recentFiles)
        {
            var item=new MenuItem {Header=Path.GetFileName(path).Replace("_","__"),ToolTip=path};
            item.Click+=async(_,_)=>{try{if(await ConfirmReplaceDocumentAsync())await OpenDocumentPathAsync(path);}catch(Exception error){StatusText.Text=error.Message;}};RecentFilesMenu.Items.Add(item);
        }
        RecentFilesMenu.IsEnabled=_recentFiles.Count>0;
    }
    private void Preferences_Click(object sender,RoutedEventArgs e)
    {
        if(_client?.HasAuthoritativeProjection!=true)return;
        var dialog=new Window {Owner=this,Title="保存・復元の設定",Width=420,Height=490,WindowStartupLocation=WindowStartupLocation.CenterOwner,Background=new SolidColorBrush(Color.FromRgb(30,32,38))};
        var panel=new StackPanel {Margin=new Thickness(16)};dialog.Content=panel;
        var autosave=Check(panel,"復元用の自動保存",PreferenceFlag("autosaveEnabled",true));
        var interval=Choices(panel,"保存間隔",new[]{30,60,180,300,600}.Select(n=>new EntityChoice(n.ToString(),$"{n}秒")),Number(_nativePreferences,"autosaveIntervalSeconds",180).ToString());
        var versions=Choices(panel,"プロジェクトごとに残す復元データ",new[]{1,3,5,10}.Select(n=>new EntityChoice(n.ToString(),$"{n}件")),Number(_nativePreferences,"recoveryVersions",3).ToString());
        var major=Check(panel,"素材読込・再取込の後にも復元用保存",PreferenceFlag("saveAfterMajorOperations",true));
        var notify=Check(panel,"起動時に復元候補を知らせる",PreferenceFlag("showRecoveryNotification",true));
        var width=Field(panel,"連番保存の桁数（1〜8）",Number(_nativePreferences,"incrementalSaveWidth",3));
        ActionButton(panel,"設定を保存",async()=>
        {
            try
            {
                var requested=JsonSerializer.SerializeToElement(new {autosaveEnabled=autosave.IsChecked==true,autosaveIntervalSeconds=int.Parse(Chosen(interval)),recoveryVersions=int.Parse(Chosen(versions)),
                    saveAfterMajorOperations=major.IsChecked==true,showRecoveryNotification=notify.IsChecked==true,incrementalSaveWidth=checked((int)ReadTicks(width))});
                var previous=_nativePreferences;_nativePreferences=(await _client.NormalizePreferencesAsync(requested)).Payload;
                try{await SaveNativeSettingsAsync();}catch{_nativePreferences=previous;throw;}
                ApplyNativePreferences();dialog.Close();StatusText.Text="保存・復元の設定を更新しました。";
            }
            catch(Exception error){MessageBox.Show(dialog,error.Message,"設定を保存できませんでした");}
        });
        dialog.ShowDialog();
    }
}
