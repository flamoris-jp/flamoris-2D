using Flamoris.Mcp.Core;

using var output = Console.OpenStandardOutput();
Console.SetOut(Console.Error);
var capability = Environment.GetEnvironmentVariable(StdioBridge.CredentialEnvironmentVariable);
Environment.SetEnvironmentVariable(StdioBridge.CredentialEnvironmentVariable, null);
if (args.Length != 2 || args[0] != "--pipe" || !McpOptions.ValidPipeName(args[1]))
{
    Console.Error.WriteLine("{\"error\":\"invalid_request\"}");
    return 2;
}
using var lifetime = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; lifetime.Cancel(); };
try
{
    await StdioBridge.RunAsync(args[1], capability, Console.OpenStandardInput(), output, cancellationToken: lifetime.Token);
    return 0;
}
catch (McpFault e) { Console.Error.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { error = e.Code })); }
catch (OperationCanceledException) { Console.Error.WriteLine("{\"error\":\"cancelled\"}"); }
catch { Console.Error.WriteLine("{\"error\":\"transport_unavailable\"}"); }
return 1;
