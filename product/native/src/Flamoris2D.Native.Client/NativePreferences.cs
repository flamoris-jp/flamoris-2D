using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace Flamoris.Flamoris2D.Native.Client;

public sealed partial class NativeSessionClient
{
    private static JsonElement Preferences(JsonElement input)
    {
        bool Flag(string key) => Field(input, key).ValueKind == JsonValueKind.False ? false : true;
        double Numeric(string key) => Field(input, key).ValueKind == JsonValueKind.Number ? Field(input, key).GetDouble() : Field(input, key).ValueKind == JsonValueKind.String && double.TryParse(Field(input, key).GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : double.NaN;
        int interval = new double[] { 30, 60, 180, 300, 600 }.Contains(Numeric("autosaveIntervalSeconds")) ? (int)Numeric("autosaveIntervalSeconds") : 180;
        int versions = new double[] { 1, 3, 5, 10 }.Contains(Numeric("recoveryVersions")) ? (int)Numeric("recoveryVersions") : 3;
        double width = Numeric("incrementalSaveWidth"); int digits = width >= 1 && width <= 8 && Math.Truncate(width) == width ? (int)width : 3;
        return Json(new { autosaveEnabled = Flag("autosaveEnabled"), autosaveIntervalSeconds = interval, recoveryVersions = versions, saveAfterMajorOperations = Flag("saveAfterMajorOperations"), showRecoveryNotification = Flag("showRecoveryNotification"), incrementalSaveWidth = digits });
    }
    private static string IncrementalName(JsonElement input)
    {
        var file = (Text(input, "fileName") ?? "").Trim(); if (file.Length == 0) throw new NativeSessionException("A project filename is required.", "file.name_required", Json(new { }), false);
        if (!file.EndsWith(".fl2d", StringComparison.OrdinalIgnoreCase)) file += ".fl2d";
        var stem = file[..^5]; var suffix = Regex.Match(stem, "^(.*)_([0-9]+)$", RegexOptions.CultureInvariant); var name = suffix.Success ? suffix.Groups[1].Value : stem;
        double max = suffix.Success ? double.Parse(suffix.Groups[2].Value, CultureInfo.InvariantCulture) : 0;
        var files = Field(input, "existingFileNames"); if (files.ValueKind != JsonValueKind.Array || files.GetArrayLength() > 10000) throw new ArgumentException("Invalid incremental filename list.");
        var matcher = new Regex("^" + Regex.Escape(name) + "_([0-9]+)\\.fl2d$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        foreach (var item in files.EnumerateArray()) { if (item.ValueKind != JsonValueKind.String || item.GetString()!.Length > 260) throw new ArgumentException("Invalid incremental filename list."); var found = matcher.Match(item.GetString()!); if (found.Success) max = Math.Max(max, double.Parse(found.Groups[1].Value, CultureInfo.InvariantCulture)); }
        int width = Preferences(Object(Field(input, "preferences"))).GetProperty("incrementalSaveWidth").GetInt32(); return name + "_" + (max + 1).ToString("0", CultureInfo.InvariantCulture).PadLeft(width, '0') + ".fl2d";
    }
}
