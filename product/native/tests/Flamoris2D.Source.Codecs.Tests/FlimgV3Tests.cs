using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Flamoris.Flamoris2D.Source;

internal static class FlimgV3Tests
{
    public static void Run()
    {
        var archive=File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,"fixtures/cutwork/cutwork-current-v3.flimg"));
        var entries=FlimgCodec.ReadZip(archive);
        var decoded=FlimgCodec.Decode(archive);
        string originalLog=Encoding.UTF8.GetString(entries["work-log.jsonl"]);
        if(decoded.Description.GetProperty("workLogJsonl").GetString()!=originalLog || !originalLog.Contains("9007199254740993"))
            throw new Exception("Work log text/Int64 provenance changed.");
        var legacy=FlimgCodec.Decode(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,"fixtures/cutwork/cutwork-current-v2.flimg")));
        foreach(var pair in legacy.Images)
            if(!pair.Value.Rgba.Span.SequenceEqual(decoded.Images[pair.Key].Rgba.Span)) throw new Exception("v3 changed v2 raster semantics.");

        Reject(e=>e.Remove("work-log.jsonl"),"asset_missing");
        Reject(e=>e["work-log.jsonl"][0]^=1,"checksum_mismatch");
        Manifest(m=>m["workLog"]!["asset"]="other.jsonl");
        Manifest(m=>m["workLog"]!["count"]=0);
        Manifest(m=>m["workLog"]!["count"]=4097);
        Manifest(m=>m["workLog"]!["count"]=1);
        Manifest(m=>m["workLog"]!["unknown"]=true);
        Manifest(m=>m.Remove("workLog"));
        Manifest(m=>m["schemaVersion"]=2);
        Manifest(m=>m["schemaVersion"]=1);
        Manifest(m=>m["schemaVersion"]=4,"schema_unsupported");
        Log(_=>[]);
        Log(b=>b[..^1]);
        Log(b=>[..b,(byte)'\n']);
        Log(_=>[0xff,(byte)'\n']);
        Log(b=>Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(b).Replace("\"sequence\":1","\"sequence\":1,\"sequence\":1")));
        Record(r=>r[0]["sequence"]=2);
        Record(r=>r[0]["unknown"]=true);
        Record(r=>r[0].Remove("observation"));
        Record(r=>r[0]["id"]=Guid.Empty.ToString());
        Record(r=>r[1]["id"]=r[0]["id"]!.DeepClone());
        Record(r=>r[1]["requestId"]=r[0]["requestId"]!.DeepClone());
        Record(r=>r[0]["documentToken"]="bad");
        Record(r=>r[0]["documentToken"]=new string('0',32));
        Record(r=>r[0]["documentRevision"]=-1);
        Record(r=>r[0]["documentRevision"]=1.5);
        Record(r=>r[0]["recordedUtc"]="2026-10-24T06:00:00+09:00");
        Record(r=>r[0]["recordedUtc"]="0001-01-01T00:00:00Z");
        Record(r=>{r[0]["decision"]=" ";r[0]["observation"]="\t";});
        Record(r=>r[0]["decision"]=new string('あ',12000),"size_limit_exceeded");
        Log(_=>new byte[4*1024*1024+1],"size_limit_exceeded");
        Console.WriteLine("Cutwork v3: exact log/Int64/raster preservation and malformed/checksum/quota rejection passed.");

        void Manifest(Action<JsonObject> mutate,string? code=null)=>Reject(e=>
        {
            var manifest=JsonNode.Parse(e["manifest.json"])!.AsObject();mutate(manifest);
            e["manifest.json"]=JsonSerializer.SerializeToUtf8Bytes(manifest);
        },code);
        void Record(Action<JsonObject[]> mutate,string? code=null)=>Log(bytes=>
        {
            var records=Encoding.UTF8.GetString(bytes).TrimEnd('\n').Split('\n').Select(l=>JsonNode.Parse(l)!.AsObject()).ToArray();
            mutate(records);
            return Encoding.UTF8.GetBytes(string.Concat(records.Select(r=>r.ToJsonString()+"\n")));
        },code);
        void Log(Func<byte[],byte[]> mutate,string? code=null)=>Reject(e=>
        {
            e["work-log.jsonl"]=mutate(e["work-log.jsonl"]);
            var m=JsonNode.Parse(e["manifest.json"])!;
            m["workLog"]!["sha256"]=Convert.ToHexStringLower(SHA256.HashData(e["work-log.jsonl"]));
            e["manifest.json"]=JsonSerializer.SerializeToUtf8Bytes(m);
        },code);
        void Reject(Action<Dictionary<string,byte[]>> mutate,string? code)
        {
            var candidate=entries.ToDictionary(p=>p.Key,p=>p.Value.ToArray());mutate(candidate);
            using var output=new MemoryStream();
            using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))
                foreach(var pair in candidate)
                {
                    using var stream=zip.CreateEntry(pair.Key).Open();stream.Write(pair.Value);
                }
            try {FlimgCodec.Decode(output.ToArray());}
            catch(SourceDecodeException error)
            {
                if(code is not null && error.Code!="flimg."+code) throw new Exception("Unexpected diagnostic: "+error.Code);
                return;
            }
            throw new Exception("Invalid v3 archive was accepted.");
        }
    }
}
