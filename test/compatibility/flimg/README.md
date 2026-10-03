# Current Cutwork writer fixture generator

This test-only console program compiles the external Cutwork checkout's **unchanged**
`FlimgArchiveCodec.cs`, `FlimgModels.cs`, and `Cutwork.Core` project. No Cutwork source
is copied into FLAMORIS 2D, and Product assemblies do not reference this generator.
`CutworkRoot` is a required build property pointing to the producer checkout.

Run from the FLAMORIS 2D repository root with .NET 10:

```powershell
dotnet run --project test/compatibility/flimg/CutworkFixtureGenerator.csproj -c Release -p:CutworkRoot=C:/FLAMORIS/flamoris-cutwork -- product/native/tests/fixtures/cutwork
```

On Windows this also compiles Cutwork's actual `PngAssetCodec.cs` and uses the WPF
PNG writer and reader. Windows CI must use this path to verify the production PNG
encoder. A Linux/macOS run uses the explicitly labeled, write-only
`PortablePngAssetCodec.cs` adapter for RGBA8/Gray8 seed images. That path verifies
the current archive writer and Core models, but does **not** certify WPF behavior.

The generator writes the archive, independent pixel/metadata expectations, and
producer provenance beside it. The provenance contains the producer Git commit,
SHA-256 hashes of its writer/model/PNG/Core source files, dirty-source status, PNG
encoder mode, schema version, and archive SHA-256. It contains no local paths or
timestamps. Identical producer source, generator, runtime, and PNG encoder produce
identical output; cross-platform PNG encoders may produce different archive bytes.

The current scenario deliberately uses schema v2. If Cutwork changes its writer
schema, the consumer's compatibility test must fail until that version is reviewed
and supported. Regeneration alone must never make an unsupported schema pass.

The input is synthetic 8 × 6 artwork with fixed IDs. Expectations are calculated
from that input and the mathematical alpha-coverage rules, without invoking either
Cutwork's compositor or FLAMORIS 2D's importer. Keep this fixture small and public;
do not replace it with private acceptance artwork.
