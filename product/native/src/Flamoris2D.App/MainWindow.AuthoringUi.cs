using System.Globalization;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private sealed record EntityChoice(string Id,string Label);
    private bool _contextDraft;
    private static string? String(JsonElement element,string field) => element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(field,out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static double Number(JsonElement element,string field,double fallback = 0) => element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(field,out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : fallback;
    private static JsonElement Property(JsonElement element,string field) => element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(field,out var value) ? value : default;
    private static JsonElement[] ArrayOf(JsonElement element,string field) => Property(element,field) is { ValueKind: JsonValueKind.Array } a ? a.EnumerateArray().ToArray() : [];
    private static void Note(Panel panel,string text)
    { panel.Children.Add(new TextBlock {Text=text,TextWrapping=TextWrapping.Wrap,Foreground=Brushes.LightGray,Margin=new Thickness(0,7,0,4)}); }
    private TextBox Field(Panel panel,string label,object? value)
    {
        Note(panel,label);var box=new TextBox {Text=Convert.ToString(value,CultureInfo.InvariantCulture) ?? "",Margin=new Thickness(0,0,0,3)};
        box.TextChanged+=(_,_)=>_contextDraft=true;panel.Children.Add(box);return box;
    }
    private static double ReadNumber(TextBox box)
    {
        if(!double.TryParse(box.Text,NumberStyles.Float,CultureInfo.InvariantCulture,out var value)||!double.IsFinite(value))
            throw new ArgumentException("有限の数値を入力してください。");
        return value;
    }
    private static string Chosen(ComboBox box) => (box.SelectedItem as EntityChoice)?.Id ?? throw new ArgumentException("対象を選択してください。");
    private ComboBox Choices(Panel panel,string label,IEnumerable<EntityChoice> items,string? selected = null)
    {
        Note(panel,label);var box=new ComboBox {ItemsSource=items.ToArray(),DisplayMemberPath="Label",Margin=new Thickness(0,0,0,5)};
        box.SelectedItem=((EntityChoice[])box.ItemsSource).FirstOrDefault(i=>i.Id==selected);
        box.SelectionChanged+=(_,_)=>_contextDraft=true;
        panel.Children.Add(box);return box;
    }
    private CheckBox Check(Panel panel,string label,bool value)
    {var box=new CheckBox {Content=label,IsChecked=value,Foreground=Brushes.White,Margin=new Thickness(0,5,0,3)};box.Click+=(_,_)=>_contextDraft=true;panel.Children.Add(box);return box;}
    private static void ActionButton(Panel panel,string label,Func<Task> action)
    {
        var button=new Button {Content=label,Padding=new Thickness(6,4,6,4),Margin=new Thickness(0,3,0,3),HorizontalAlignment=HorizontalAlignment.Stretch};
        button.Click+=async(_,_)=>{button.IsEnabled=false;try{await action();}finally{button.IsEnabled=true;}};panel.Children.Add(button);
    }
}
