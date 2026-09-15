using System.Diagnostics;
using System.Text;

namespace Flamoris.Flamoris2D.ProductHost;

public sealed record EncoderResult(int ExitCode,string StandardOutput,string StandardError);

public static class NativeVideoEncoder
{
    private static async Task<string> ReadBoundedAsync(StreamReader reader)
    {
        var text=new StringBuilder();var buffer=new char[4096];int length;
        while((length=await reader.ReadAsync(buffer))>0){text.Append(buffer,0,length);if(text.Length>1024*1024)text.Remove(0,text.Length-1024*1024);}
        return text.ToString();
    }
    public static async Task<EncoderResult> RunAsync(string executable,IEnumerable<string> arguments,CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var start=new ProcessStartInfo(executable){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true};
        foreach(var argument in arguments)start.ArgumentList.Add(argument);
        using var process=new Process{StartInfo=start};if(!process.Start())throw new InvalidOperationException("FFmpegを起動できません。");
        process.StandardInput.Close();
        using var registration=cancellationToken.Register(()=>{try{if(!process.HasExited)process.Kill(entireProcessTree:true);}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}});
        var stdout=ReadBoundedAsync(process.StandardOutput);var stderr=ReadBoundedAsync(process.StandardError);
        await process.WaitForExitAsync(CancellationToken.None);var result=new EncoderResult(process.ExitCode,await stdout,await stderr);
        cancellationToken.ThrowIfCancellationRequested();return result;
    }
    public static async Task ProbeAsync(ProductHostClient client,string executable,CancellationToken cancellationToken)
    {
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var values=new List<string>();
        foreach(var option in new[]{"-version","-buildconf","-encoders","-filters"})
        {
            var result=await RunAsync(executable,["-hide_banner",option],timeout.Token);
            if(result.ExitCode!=0)throw new InvalidOperationException(result.StandardError);
            values.Add(result.StandardOutput+"\n"+result.StandardError);
        }
        await client.CheckEncoderAsync(values[0],values[1],values[2],values[3],cancellationToken);
    }
}
