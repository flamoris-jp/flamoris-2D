using System.Windows;
using System.Windows.Controls;

namespace Flamoris.Flamoris2D.App;

public partial class MainWindow
{
    private static Expander FindWorkflowSection(Panel panel, string header) =>
        panel.Children.OfType<Expander>().Single(section => Equals(section.Header, header));

    private async Task RunWorkflowUiSmokeAsync(bool hasParts)
    {
        var client = _client!;
        var revision = client.Revision;
        var selectedId = _targets.SelectedId;
        SwitchContext(EditingContext.Source, false);
        await RefreshProjectionAsync();
        if ((TargetPropertiesPanel.Visibility == Visibility.Visible) != hasParts)
            throw new InvalidOperationException("Selection controls must not dominate the empty Source screen.");
        if (!WorkflowHintText.Text.Contains(hasParts ? "メッシュ" : "素材を読み込む"))
            throw new InvalidOperationException("Source does not explain the next production action.");
        var detail = FindWorkflowSection(KeyStatePanel,"詳細設定：原画・パーツ対応");
        if (detail.IsExpanded)
            throw new InvalidOperationException("Source advanced authoring must start collapsed.");
        detail.IsExpanded = true;
        var transition = FindWorkflowSection((Panel)detail.Content,"遷移・パーツ対応");
        transition.IsExpanded = true;
        if (!((Panel)transition.Content).Children.OfType<Button>().Any(button => Equals(button.Content,"遷移を作成")))
            throw new InvalidOperationException("Transition authoring became unreachable.");
        await RefreshProjectionAsync();
        detail = FindWorkflowSection(KeyStatePanel,"詳細設定：原画・パーツ対応");
        if (!detail.IsExpanded || !FindWorkflowSection((Panel)detail.Content,"遷移・パーツ対応").IsExpanded)
            throw new InvalidOperationException("Refreshing projection lost the user's expanded sections.");
        detail.IsExpanded = false;

        foreach (var definition in EditingContextCatalog.All)
        {
            SwitchContext(definition.Context, false);
            await RefreshProjectionAsync();
            var showProperties = hasParts && definition.Context is EditingContext.Source or EditingContext.Mesh or EditingContext.Rig or EditingContext.Deform;
            if ((TargetPropertiesPanel.Visibility == Visibility.Visible) != showProperties)
                throw new InvalidOperationException("Unrelated selection controls leaked into the workflow.");
            if ((TimeSplitter.Visibility == Visibility.Visible) != definition.ShowTimeSurface)
                throw new InvalidOperationException("Timeline resize handle does not follow Animation visibility.");
        }
        SwitchContext(EditingContext.Animation, false);
        TimeSurfaceRow.Height = new GridLength(230);
        InspectorColumn.Width = new GridLength(400);
        UpdateLayout();
        SwitchContext(EditingContext.Preview, false);
        if (TimeSurfaceRow.Height.Value != 0 || TimeSplitterRow.Height.Value != 0)
            throw new InvalidOperationException("Hidden timeline still consumes canvas space.");
        SwitchContext(EditingContext.Animation, false);
        if (Math.Abs(TimeSurfaceRow.Height.Value - 230) > 1)
            throw new InvalidOperationException("Timeline size did not survive a context change.");
        ResetLayout_Click(this, new RoutedEventArgs());
        if (InspectorColumn.Width.Value != 320 || TimeSurfaceRow.Height.Value != 190 ||
            !TargetsRow.Height.IsStar || !PropertiesRow.Height.IsStar)
            throw new InvalidOperationException("Reset layout did not restore the default pane sizes.");
        SwitchContext(EditingContext.Source, false);
        await RefreshProjectionAsync();
        if (client.Revision != revision || _targets.SelectedId != selectedId)
            throw new InvalidOperationException("Presentation changes mutated Product history or selection.");
        Console.WriteLine($"Native workflow UI smoke passed (artwork={hasParts}).");
    }
}
