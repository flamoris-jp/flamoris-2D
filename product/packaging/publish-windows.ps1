# Run from any directory on Windows x64 with PowerShell, .NET 10 SDK and CMake.
[CmdletBinding()]
param(
    [string]$OutputDirectory = "artifacts/windows",
    [string]$FfmpegArchivePath = '',
    [string]$FfmpegCacheDirectory = 'artifacts/downloads/ffmpeg'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'portable-package.ps1')
. (Join-Path $PSScriptRoot 'ffmpeg-runtime.ps1')
# Month-end builds have a two-year upstream retention window. Keep a verified
# local copy as well; neither a floating latest URL nor network access is required
# once this input has been cached (or supplied explicitly for an offline build).
$ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-N-127021-ge0c94b2d1c-win64-lgpl-shared.zip'
$ffmpegHash = '2CC3DD0BAF74EBD68A3FCEAF771DF8351A7A6D69694D05F43B16BB0C966EC909'
$cache = if ([IO.Path]::IsPathRooted($FfmpegCacheDirectory)) { $FfmpegCacheDirectory }
    else { Join-Path $repo $FfmpegCacheDirectory }
$providedArchive = $FfmpegArchivePath
if ($providedArchive -and -not [IO.Path]::IsPathRooted($providedArchive)) { $providedArchive = Join-Path $repo $providedArchive }
$archive = Get-VerifiedFfmpegArchive -Uri $ffmpegUrl -ExpectedSha256 $ffmpegHash `
    -CacheDirectory $cache -ArchivePath $providedArchive
$destination = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
    [IO.Path]::GetFullPath($OutputDirectory)
} else { [IO.Path]::GetFullPath((Join-Path $repo $OutputDirectory)) }
$package = Join-Path $destination 'FLAMORIS-2D-win-x64'
foreach ($path in @($package, "$package.zip", "$package.inventory.json")) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
$null = Get-Command dotnet -ErrorAction Stop

# Restore the reviewed Capture source dependency before evaluating project references.
& git -C $repo submodule update --init --recursive -- dependencies/flamoris-capture
if ($LASTEXITCODE -ne 0) { throw 'Capture submodule initialization failed.' }

$temp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $extracted = Join-Path $temp 'extracted'
    Expand-Archive $archive $extracted
    $encoder = Get-ChildItem $extracted -Filter ffmpeg.exe -Recurse | Select-Object -First 1
    if (-not $encoder -or (Split-Path $encoder.DirectoryName -Leaf) -ne 'bin') { throw 'Expected ffmpeg/bin/ffmpeg.exe in pinned archive' }
    $ffmpegRoot = Split-Path $encoder.DirectoryName

    New-Item -ItemType Directory -Path (Join-Path $package 'mcp') -Force | Out-Null
    Push-Location $repo
    try {
        & dotnet publish product/native/src/Flamoris2D.Bridge/Flamoris2D.Bridge.csproj -c Release -r win-x64 --self-contained true -o (Join-Path $package 'mcp') /p:DebugType=None /p:DebugSymbols=false
        if ($LASTEXITCODE -ne 0) { throw 'Bridge publish failed' }
        & dotnet publish product/native/src/Flamoris2D.App/Flamoris2D.App.csproj -c Release -r win-x64 --self-contained true -o $package /p:DebugType=None /p:DebugSymbols=false
        if ($LASTEXITCODE -ne 0) { throw 'App publish failed' }
    } finally { Pop-Location }

    # Retain the encoder, smoke probe, all shared libraries and notices. ffplay,
    # HTML manuals, SDK files and unrelated presets are not export dependencies.
    $ffmpegDestination = Join-Path $package 'ffmpeg'
    Copy-FfmpegRuntime -ArchiveRoot $ffmpegRoot -Destination $ffmpegDestination `
        -NoticeDirectory (Join-Path $PSScriptRoot 'ffmpeg-notices')
    Get-ChildItem -LiteralPath $package -Filter '*.pdb' -File -Recurse |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    foreach ($required in @('Flamoris2D.exe', 'Flamoris2D.Renderer.Native.dll', 'LICENSE-picojson.txt', 'Flamoris2D.Core.Native.dll', 'icuuc78.dll', 'icuin78.dll', 'icudt78.dll', 'ICU-LICENSE.txt', 'ffmpeg/bin/ffmpeg.exe', 'mcp/Flamoris.Mcp.Bridge.exe', 'mcp/Flamoris.Mcp.Core.dll', 'mcp/coreclr.dll', 'mcp/hostfxr.dll', 'Flamoris.Mcp.Core.dll', 'Flamoris.Mcp.Wpf.dll', 'Flamoris.Capture.Wpf.dll', 'Flamoris.Capture.Core.dll', 'Flamoris.Capture.Windows.dll', 'Flamoris.Capture.Mcp.dll', 'coreclr.dll', 'hostfxr.dll', 'hostpolicy.dll', 'PresentationFramework.dll')) {
        if (-not (Test-Path (Join-Path $package $required))) { throw "Missing runtime: $required" }
    }
    # MSBuild project inputs are explicit; audit the final artifact as well.
    foreach ($forbidden in @('ProductHost', 'product-host', 'runtime', 'node_modules', 'resources/app.asar', 'package.json')) {
        if (Test-Path (Join-Path $package $forbidden)) { throw "Obsolete editing runtime packaged: $forbidden" }
    }
    foreach ($file in Get-ChildItem $package -File -Recurse) {
        if ($file.Name -match '(?i)^(node|electron)\.exe$|\.(mjs|cjs|js|asar)$|ProductHost') {
            throw "Obsolete editing content packaged: $($file.FullName)"
        }
    }
    Copy-Item (Join-Path $repo 'LICENSE') (Join-Path $package 'LICENSE-FLAMORIS.txt')
    Copy-Item (Join-Path $repo 'product/native/THIRD-PARTY-NOTICES.md') $package
    $dotnetRoot = Split-Path -Parent (Get-Command dotnet -ErrorAction Stop).Source
    foreach ($notice in @('LICENSE.txt', 'ThirdPartyNotices.txt')) {
        $source = Join-Path $dotnetRoot $notice
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing .NET notice: $source" }
        Copy-Item -LiteralPath $source -Destination (Join-Path $package "DOTNET-$notice")
    }
    Copy-Item (Join-Path $repo 'docs/native-production-workflow.md') (Join-Path $package 'README.md')
    foreach ($required in @('LICENSE-FLAMORIS.txt', 'THIRD-PARTY-NOTICES.md', 'README.md')) {
        if (-not (Test-Path -LiteralPath (Join-Path $package $required) -PathType Leaf)) { throw "Missing notice: $required" }
    }
    Complete-PortablePackage -PackageRoot $package -RepositoryRoot $repo
} finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
