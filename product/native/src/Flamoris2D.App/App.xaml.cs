using System.Windows;
using System.Windows.Threading;
using Flamoris.Flamoris2D.ProductHost;
using Flamoris.Logging;

namespace Flamoris.Flamoris2D.App;

public partial class App : Application
{
    private FlamorisLogger? _logger;
    private LoggingOptions? _loggingOptions;

    public App()
    {
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            _loggingOptions = NativeLoggingConfiguration.Load(out var configurationWarning);
            _logger = NativeLoggingConfiguration.CreateLogger(_loggingOptions);
            if (configurationWarning is not null)
            {
                _logger.Warn("app.startup", "Logging configuration could not be loaded; defaults are active.",
                    new Dictionary<string, object?> { ["reason"] = configurationWarning });
            }
            _logger.Info("app.startup", "FLAMORIS 2D starting",
                new Dictionary<string, object?> { ["smokeTest"] = e.Args.Contains("--smoke-test", StringComparer.Ordinal) });

            if (e.Args.Contains("--smoke-test", StringComparer.Ordinal))
            {
                ShutdownMode = ShutdownMode.OnExplicitShutdown;
                var window = new MainWindow(autoConnect: false, logger: _logger, loggingOptions: _loggingOptions);
                window.Show();
                await window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ApplicationIdle);
                await window.RunSmokeProofAsync();
                await window.DisposeAsync();
                Shutdown(0);
                return;
            }

            var mainWindow = new MainWindow(logger: _logger, loggingOptions: _loggingOptions);
            MainWindow = mainWindow;
            mainWindow.Show();
        }
        catch (Exception error)
        {
            _logger?.Error("app.startup", "FLAMORIS 2D startup failed", error);
            Console.Error.WriteLine(error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _logger?.Info("app.shutdown", "FLAMORIS 2D stopped",
            new Dictionary<string, object?> { ["exitCode"] = e.ApplicationExitCode });
        base.OnExit(e);
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e) =>
        _logger?.Error("app", "Unhandled UI exception", e.Exception);

    private void OnUnhandledException(object? sender, UnhandledExceptionEventArgs e) =>
        _logger?.Error("app", "Unhandled application exception", e.ExceptionObject as Exception,
            new Dictionary<string, object?> { ["terminating"] = e.IsTerminating });

    private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e) =>
        _logger?.Error("app", "Unobserved task exception", e.Exception);
}
