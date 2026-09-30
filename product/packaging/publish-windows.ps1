# Run from any directory on Windows x64 with PowerShell, .NET 10 SDK and Node 24.21.0.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$package = Join-Path $repo 'artifacts/package/Flamoris2D-win-x64'
$node = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.21.0') { throw "Node 24.21.0 is required (found $nodeVersion)" }
$null = Get-Command dotnet -ErrorAction Stop
if (-not (Test-Path (Join-Path $repo 'product/node_modules/ag-psd'))) {
    & npm ci --prefix (Join-Path $repo 'product') --workspaces=false --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
}

$ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-28-13-06/ffmpeg-N-126947-g45f3fecca9-win64-lgpl-shared.zip'
$ffmpegHash = '7F82D0E4ED9C20E9CA96573F5AB82B85F1B44A5D62F195E5CF09FFC28DA70A4E'
$temp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $archive = Join-Path $temp 'ffmpeg.zip'
    Invoke-WebRequest $ffmpegUrl -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $ffmpegHash) { throw 'Encoder archive checksum mismatch' }
    $extracted = Join-Path $temp 'extracted'
    Expand-Archive $archive $extracted
    $encoder = Get-ChildItem $extracted -Filter ffmpeg.exe -Recurse | Select-Object -First 1
    if (-not $encoder -or (Split-Path $encoder.DirectoryName -Leaf) -ne 'bin') { throw 'Expected ffmpeg/bin/ffmpeg.exe in pinned archive' }
    $ffmpegRoot = Split-Path $encoder.DirectoryName

    if (Test-Path $package) { Remove-Item $package -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $package 'mcp') -Force | Out-Null
    Push-Location $repo
    try {
        & dotnet publish product/native/src/Flamoris2D.Bridge -c Release -r win-x64 --self-contained true -o (Join-Path $package 'mcp')
        if ($LASTEXITCODE -ne 0) { throw 'Bridge publish failed' }
        & dotnet publish product/native/src/Flamoris2D.App -c Release -r win-x64 --self-contained true -o $package
        if ($LASTEXITCODE -ne 0) { throw 'App publish failed' }
    } finally { Pop-Location }

    $runtime = New-Item -ItemType Directory -Path (Join-Path $package 'runtime') -Force
    Copy-Item $node (Join-Path $runtime 'node.exe')
    Invoke-WebRequest 'https://raw.githubusercontent.com/nodejs/node/v24.21.0/LICENSE' -OutFile (Join-Path $runtime 'LICENSE.txt')
    Copy-Item $ffmpegRoot (Join-Path $package 'ffmpeg') -Recurse
    foreach ($required in @('Flamoris2D.exe', 'Flamoris2D.Renderer.Native.dll', 'LICENSE-picojson.txt', 'runtime/node.exe', 'ffmpeg/bin/ffmpeg.exe', 'mcp/Flamoris.Mcp.Bridge.exe', 'mcp/Flamoris.Mcp.Core.dll', 'Flamoris.Mcp.Core.dll', 'Flamoris.Mcp.Wpf.dll')) {
        if (-not (Test-Path (Join-Path $package $required))) { throw "Missing runtime: $required" }
    }
    if (Test-Path (Join-Path $package 'node_modules/@modelcontextprotocol')) { throw 'Obsolete Node MCP runtime packaged' }
    Copy-Item (Join-Path $repo 'LICENSE') (Join-Path $package 'LICENSE-FLAMORIS.txt')
    Copy-Item (Join-Path $repo 'product/native/THIRD-PARTY-NOTICES.md') $package
    Copy-Item (Join-Path $repo 'docs/native-production-workflow.md') (Join-Path $package 'README.md')
    $lines = Get-ChildItem $package -File -Recurse | Sort-Object FullName | ForEach-Object {
        '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.FullName.Substring($package.Length + 1).Replace('\', '/')
    }
    $lines | Set-Content (Join-Path $package 'SHA256SUMS.txt')
    Write-Output "Portable package: $package"
} finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
