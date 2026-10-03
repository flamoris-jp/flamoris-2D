# Build-time selection for the hash-pinned BtbN Windows archive. No DLL is trimmed.
function Copy-FfmpegRuntime {
    param(
        [Parameter(Mandatory)][string]$ArchiveRoot,
        [Parameter(Mandatory)][string]$Destination,
        [Parameter(Mandatory)][string]$NoticeDirectory
    )
    # Both executables import all seven FFmpeg DLLs in the audited archive.
    # Keep every upstream DLL, including dependencies not called by the app.
    $required = @('ffmpeg.exe', 'ffprobe.exe', 'avcodec-63.dll', 'avdevice-63.dll',
        'avfilter-12.dll', 'avformat-63.dll', 'avutil-61.dll', 'swresample-7.dll', 'swscale-10.dll')
    $bin = Join-Path $ArchiveRoot 'bin'
    foreach ($name in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $bin $name) -PathType Leaf)) {
            throw "Missing pinned FFmpeg runtime: $name"
        }
    }
    $upstreamLicense = Join-Path $ArchiveRoot 'LICENSE.txt'
    if (-not (Test-Path -LiteralPath $upstreamLicense -PathType Leaf)) { throw 'Missing upstream FFmpeg license' }
    $notices = @('COPYING.GPLv3.txt', 'COPYING.GPLv2.txt', 'FFMPEG-LICENSE.md',
        'FFTW-NOTICE.md', 'SOURCE-ACCESS.md', 'BUILD-CONFIG.txt')
    foreach ($name in $notices) {
        if (-not (Test-Path -LiteralPath (Join-Path $NoticeDirectory $name) -PathType Leaf)) {
            throw "Missing FFmpeg notice: $name"
        }
    }
    $outputBin = Join-Path $Destination 'bin'
    New-Item -ItemType Directory -Path $outputBin -Force | Out-Null
    foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
        Copy-Item -LiteralPath (Join-Path $bin $name) -Destination $outputBin
    }
    Get-ChildItem -LiteralPath $bin -Filter '*.dll' -File |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $outputBin }
    Copy-Item -LiteralPath $upstreamLicense -Destination $Destination
    foreach ($name in $notices) {
        Copy-Item -LiteralPath (Join-Path $NoticeDirectory $name) -Destination $Destination
    }
}
