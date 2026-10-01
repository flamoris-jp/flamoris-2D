using System.Text.Json;
using System.Text.RegularExpressions;
using Flamoris.Mcp.Core;

namespace Flamoris.Flamoris2D.Session;

// Shared MCP infrastructure supplies transport, credentials and commit guards.
// Product only supplies its audited typed tools over the SAME WPF workspace.
public sealed class NativeMcpHost : IMcpHost, IDisposable
{
    private readonly NativeWorkspace workspace;
    private readonly string? expectedDocumentToken;
    private readonly McpPermission permission;
    private readonly CancellationTokenSource lease=new();
    private readonly JsonElement catalog;
    private volatile bool invalidated;
    public HostSnapshot Snapshot {get;private set;}=new("flamoris.2d","0.4.0","","",0,false);
    public event Action? Invalidating;
    public NativeMcpHost(NativeWorkspace workspace,string? expectedDocumentToken=null,McpPermission permission=McpPermission.Edit)
    {
        this.workspace=workspace;this.expectedDocumentToken=expectedDocumentToken;this.permission=permission;
        using var stream=typeof(NativeMcpHost).Assembly.GetManifestResourceStream("Flamoris2D.LiveCatalog")!;
        using var json=JsonDocument.Parse(stream);catalog=json.RootElement.Clone();
        workspace.Changed+=WorkspaceChanged;
    }
    private void WorkspaceChanged(WorkspaceChanged change) {if(change.Operation=="replace") Invalidate();else {var s=change.Snapshot;Snapshot=new("flamoris.2d","0.4.0",s.RuntimeId,s.DocumentToken,s.Revision);}}
    public void Invalidate()
    {
        if(invalidated) return;invalidated=true;lease.Cancel();Invalidating?.Invoke();
    }
    public Task<T> InvokeAsync<T>(Func<T> action,CancellationToken token)=>workspace.InvokeAsync(w=>
    {
        if(invalidated) throw new McpFault(McpErrors.HostUnavailable);
        var s=w.Snapshot;if(expectedDocumentToken is not null && s.DocumentToken!=expectedDocumentToken)throw new McpFault(McpErrors.HostUnavailable); Snapshot=new("flamoris.2d","0.4.0",s.RuntimeId,s.DocumentToken,s.Revision);
        token.ThrowIfCancellationRequested();return action();
    },token);
    public IEnumerable<HostTool> Tools()
    {
        foreach(var definition in catalog.GetProperty("tools").EnumerateArray())
        {
            string name=definition.GetProperty("name").GetString()!;bool readOnly=definition.GetProperty("readOnly").GetBoolean();var schema=definition.GetProperty("inputSchema").Clone();
            yield return new HostTool<JsonElement>(name,definition.GetProperty("description").GetString()!,schema,readOnly?OperationKind.Query:OperationKind.Mutation,
                input=>{Validate(input,schema);return input.Clone();},(context,input,token)=>
                {
                    JsonElement Execute()
                    {
                        using var cancellation=CancellationTokenSource.CreateLinkedTokenSource(token,lease.Token);
                        cancellation.Token.ThrowIfCancellationRequested();
                        if(invalidated) throw new McpFault(McpErrors.HostUnavailable);
                        try
                        {
                            workspace.AssertCurrent(Snapshot.DocumentToken,Snapshot.Revision);
                            if(name=="live.dispositions") return catalog.GetProperty("dispositions");
                            JsonElement result;
                            if(name=="live.context") result=WorkspaceProjection(workspace);
                            else if(name.StartsWith("query.",StringComparison.Ordinal)) result=workspace.Query(name[6..],input.GetProperty("input"));
                            else if(name=="live.undo") result=workspace.Undo(cancellation.Token);
                            else if(name=="live.redo") result=workspace.Redo(cancellation.Token);
                            else if(name=="live.transaction") result=workspace.Execute(input.GetProperty("commands"),input.GetProperty("label").GetString()!,cancellation.Token);
                            else if(name.StartsWith("command.",StringComparison.Ordinal)) result=workspace.Execute(JsonSerializer.SerializeToElement(new[]{new {type=name[8..],payload=input.GetProperty("payload")}}),"MCP: "+name[8..],cancellation.Token);
                            else throw new McpFault(McpErrors.InvalidRequest);
                            if(readOnly && System.Text.Encoding.UTF8.GetByteCount(result.GetRawText())>1024*1024)throw new McpFault("mcp.result_too_large");
                            var current=workspace.Snapshot;
                            return JsonSerializer.SerializeToElement(new {documentToken=current.DocumentToken,revision=current.Revision,permission=permission==McpPermission.Edit?"edit":"read-only",result});
                        }
                        catch(WorkspaceException e) {throw new McpFault(e.Code);}
                        catch(Flamoris.Flamoris2D.Core.Interop.NativeQueryException) {throw new McpFault(McpErrors.InvalidRequest);}
                    }
                    return readOnly?context.ReadAsync(Execute):context.CommitAsync(Execute);
                },foreground:name!="live.context" && name!="live.dispositions");
        }
    }
    public static JsonElement WorkspaceProjection(NativeWorkspace workspace)
    {
        var state=workspace.Snapshot.State;
        return JsonSerializer.SerializeToElement(new {summary=workspace.Query("project.get_summary"),tree=workspace.Query("scene.get_tree",JsonSerializer.SerializeToElement(new {includeHidden=true})),canUndo=state.UndoDepth>0,canRedo=state.RedoDepth>0,isDirty=state.Dirty!=0,editorRevision=state.CurrentRevision,savedRevision=state.SavedRevision,lineageId=workspace.LineageId,
            keyArts=workspace.Query("keyart.list"),transitions=workspace.Query("transition.list"),sequences=workspace.Query("sequence.list")});
    }
    private static void Reject()=>throw new McpFault(McpErrors.InvalidRequest);
    private static void Validate(JsonElement value,JsonElement schema)
    {
        if(schema.TryGetProperty("oneOf",out var alternatives))
        {
            int matched=0;foreach(var alternative in alternatives.EnumerateArray()) try {Validate(value,alternative);matched++;}catch(McpFault) {}
            if(matched!=1)Reject();return;
        }
        if(schema.TryGetProperty("const",out var constant) && !JsonElement.DeepEquals(value,constant))Reject();
        if(schema.TryGetProperty("enum",out var enumeration) && !enumeration.EnumerateArray().Any(v=>JsonElement.DeepEquals(value,v)))Reject();
        if(!schema.TryGetProperty("type",out var type))return;
        switch(type.GetString())
        {
            case "object":
                if(value.ValueKind!=JsonValueKind.Object)Reject();var names=new HashSet<string>(StringComparer.Ordinal);
                foreach(var property in value.EnumerateObject())
                {
                    if(!names.Add(property.Name))Reject();
                    if(schema.TryGetProperty("properties",out var fields) && fields.TryGetProperty(property.Name,out var field)) Validate(property.Value,field);
                    else if(schema.TryGetProperty("additionalProperties",out var additional) && additional.ValueKind==JsonValueKind.False)Reject();
                }
                if(schema.TryGetProperty("required",out var required))foreach(var key in required.EnumerateArray())if(!value.TryGetProperty(key.GetString()!,out _))Reject();break;
            case "array":
                if(value.ValueKind!=JsonValueKind.Array)Reject();int count=value.GetArrayLength();if(schema.TryGetProperty("minItems",out var min) && count<min.GetInt32() || schema.TryGetProperty("maxItems",out var max) && count>max.GetInt32())Reject();
                if(schema.TryGetProperty("items",out var item))foreach(var element in value.EnumerateArray())Validate(element,item);break;
            case "string":
                if(value.ValueKind!=JsonValueKind.String)Reject();string text=value.GetString()!;
                if(schema.TryGetProperty("nonBlank",out var nonBlank) && nonBlank.ValueKind==JsonValueKind.True && text.All(c=>c is >= '\u0009' and <= '\u000d' or ' ' or '\u00a0' or '\u1680' or >= '\u2000' and <= '\u200a' or '\u2028' or '\u2029' or '\u202f' or '\u205f' or '\u3000' or '\ufeff'))Reject();
                if(schema.TryGetProperty("minLength",out var minimum) && text.Length<minimum.GetInt32() || schema.TryGetProperty("maxLength",out var maximum) && text.Length>maximum.GetInt32())Reject();
                if(schema.TryGetProperty("pattern",out var pattern) && !Regex.IsMatch(text,pattern.GetString()!,RegexOptions.CultureInvariant,TimeSpan.FromMilliseconds(100)))Reject();break;
            case "number":case "integer":
                if(value.ValueKind!=JsonValueKind.Number || !value.TryGetDouble(out double number) || !double.IsFinite(number)) {Reject();return;}
                if(type.GetString()=="integer" && number!=Math.Truncate(number))Reject();
                if(schema.TryGetProperty("minimum",out var lower) && number<lower.GetDouble() || schema.TryGetProperty("maximum",out var upper) && number>upper.GetDouble())Reject();break;
            case "boolean":if(value.ValueKind!=JsonValueKind.True && value.ValueKind!=JsonValueKind.False)Reject();break;
            case "null":if(value.ValueKind!=JsonValueKind.Null)Reject();break;
        }
    }
    public void Dispose() {Invalidate();workspace.Changed-=WorkspaceChanged;lease.Dispose();}
}
