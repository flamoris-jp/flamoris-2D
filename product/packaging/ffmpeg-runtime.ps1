# Build-time acquisition and selection for the hash-pinned BtbN Windows archive.
function Get-VerifiedFfmpegArchive {
    param(
        [Parameter(Mandatory)][uri]$Uri,
        [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedSha256,
        [Parameter(Mandatory)][string]$CacheDirectory,
        [string]$ArchivePath = '',
        [scriptblock]$Download = { param($Source, $Target) Invoke-WebRequest -Uri $Source -OutFile $Target -TimeoutSec 180 }
    )
    # An explicit archive is an offline input, never an unchecked override.
    if ($ArchivePath) {
        $inputPath = (Resolve-Path -LiteralPath $ArchivePath -ErrorAction Stop).Path
        if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf) -or
            (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash -ine $ExpectedSha256) {
            throw 'Provided FFmpeg archive checksum mismatch.'
        }
        return $inputPath
    }
    $cache = [IO.Path]::GetFullPath($CacheDirectory)
    $cachedPath = Join-Path $cache ($ExpectedSha256.ToLowerInvariant() + '.zip')
    if (Test-Path -LiteralPath $cachedPath) {
        if (-not (Test-Path -LiteralPath $cachedPath -PathType Leaf) -or
            (Get-FileHash -LiteralPath $cachedPath -Algorithm SHA256).Hash -ine $ExpectedSha256) {
            throw "Cached FFmpeg archive checksum mismatch. Remove the invalid cache entry and retry: $cachedPath"
        }
        return $cachedPath
    }
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $partial = Join-Path $cache ('.download-' + [guid]::NewGuid().ToString('N'))
    try {
        try { & $Download $Uri $partial | Out-Null }
        catch {
            throw "Pinned FFmpeg download failed. Restore the verified ZIP to '$cachedPath' or pass -FfmpegArchivePath. Source: $Uri. $($_.Exception.Message)"
        }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $ExpectedSha256) {
            throw 'Downloaded FFmpeg archive checksum mismatch; it was not cached.'
        }
        Move-Item -LiteralPath $partial -Destination $cachedPath -Force
        return $cachedPath
    } finally {
        if (Test-Path -LiteralPath $partial -PathType Leaf) { Remove-Item -LiteralPath $partial -Force }
    }
}

# No DLL is trimmed.
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
