using System.Windows;

namespace Flamoris.Flamoris2D.App;

public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Contains("--smoke-test", StringComparer.Ordinal))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            try
            {
                var window = new MainWindow(autoConnect: false);
                await window.RunSmokeProofAsync();
                await window.DisposeAsync();
                Shutdown(0);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                Shutdown(1);
            }
            return;
        }

        var mainWindow = new MainWindow();
        MainWindow = mainWindow;
        mainWindow.Show();
    }
}
