$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repo 'product/packaging/ffmpeg-runtime.ps1')
. (Join-Path $repo 'product/packaging/portable-package.ps1')
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ffmpeg-contract-' + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $temp 'upstream'
$package = Join-Path $temp 'package'
$noticeDirectory = Join-Path $repo 'product/packaging/ffmpeg-notices'
New-Item -ItemType Directory -Path (Join-Path $archive 'bin'), (Join-Path $archive 'doc') -Force | Out-Null
try {
    foreach ($name in @('ffmpeg.exe', 'ffprobe.exe', 'avcodec-63.dll', 'avdevice-63.dll',
        'avfilter-12.dll', 'avformat-63.dll', 'avutil-61.dll', 'swresample-7.dll', 'swscale-10.dll',
        'additional-dependency.dll', 'ffplay.exe')) {
        Set-Content -LiteralPath (Join-Path $archive "bin/$name") -Value "synthetic $name"
    }
    Set-Content -LiteralPath (Join-Path $archive 'LICENSE.txt') -Value 'upstream license retained verbatim'
    Set-Content -LiteralPath (Join-Path $archive 'doc/ffmpeg.html') -Value 'manual'
    Copy-FfmpegRuntime -ArchiveRoot $archive -Destination (Join-Path $package 'ffmpeg') -NoticeDirectory $noticeDirectory
    foreach ($source in Get-ChildItem -LiteralPath (Join-Path $archive 'bin') -File | Where-Object Name -ne 'ffplay.exe') {
        $destination = Join-Path $package "ffmpeg/bin/$($source.Name)"
        if (-not (Test-Path -LiteralPath $destination) -or
            (Get-FileHash -LiteralPath $source.FullName).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
            throw "FFmpeg dependency not preserved: $($source.Name)"
        }
    }
    if ((Get-FileHash (Join-Path $archive 'LICENSE.txt')).Hash -ne
        (Get-FileHash (Join-Path $package 'ffmpeg/LICENSE.txt')).Hash) { throw 'Upstream license changed' }
    foreach ($name in @('COPYING.GPLv3.txt', 'FFMPEG-LICENSE.md', 'SOURCE-ACCESS.md', 'BUILD-CONFIG.txt')) {
        if (-not (Test-Path -LiteralPath (Join-Path $package "ffmpeg/$name"))) { throw "Missing notice: $name" }
    }
    foreach ($excluded in @('ffplay.exe', 'doc', 'include', 'lib', 'presets')) {
        if (Test-Path -LiteralPath (Join-Path $package "ffmpeg/$excluded")) { throw "Unused content copied: $excluded" }
    }
    if (Test-Path -LiteralPath (Join-Path $package 'ffmpeg/bin/ffplay.exe')) { throw 'Unused ffplay copied' }
    Assert-PortableContent -PackageRoot $package
    foreach ($missing in @('bin/ffprobe.exe', 'bin/avcodec-63.dll', 'LICENSE.txt')) {
        $source = Join-Path $archive $missing
        Move-Item -LiteralPath $source -Destination "$source.removed"
        $caught = $false
        try {
            Copy-FfmpegRuntime -ArchiveRoot $archive -Destination (Join-Path $temp 'invalid') -NoticeDirectory $noticeDirectory
        } catch { $caught = $true }
        if (-not $caught) { throw "Missing runtime/notice accepted: $missing" }
        Move-Item -LiteralPath "$source.removed" -Destination $source
    }
    Write-Host 'PASS: FFmpeg runtime and every DLL retained, notices retained, unused files excluded, missing dependencies rejected'
} finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
