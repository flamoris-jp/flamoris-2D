$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repo 'product/packaging/ffmpeg-runtime.ps1')
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ffmpeg-input-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    try { & $Action | Out-Null }
    catch { if ($_.Exception.Message -match $Pattern) { return }; throw }
    throw "Expected failure matching $Pattern"
}
try {
    $source = Join-Path $temp 'verified source.zip'
    Set-Content -LiteralPath $source -Value 'synthetic pinned archive'
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $cache = Join-Path $temp 'cache'
    $uri = 'https://example.invalid/retained-build.zip'
    $script:downloads = 0
    $download = { param($url, $target) $script:downloads++; Copy-Item -LiteralPath $source -Destination $target }
    $first = Get-VerifiedFfmpegArchive -Uri $uri -ExpectedSha256 $hash -CacheDirectory $cache -Download $download
    if ($script:downloads -ne 1 -or (Get-FileHash $first).Hash -ne $hash) { throw 'Fresh input not verified and cached' }
    $offline = { throw 'network must not be called' }
    $second = Get-VerifiedFfmpegArchive -Uri $uri -ExpectedSha256 $hash -CacheDirectory $cache -Download $offline
    if ($first -cne $second) { throw 'Cache not reused offline' }
    $explicit = Get-VerifiedFfmpegArchive -Uri $uri -ExpectedSha256 $hash -CacheDirectory $cache -ArchivePath $source -Download $offline
    if ($explicit -cne $source) { throw 'Explicit offline archive not retained' }
    Set-Content -LiteralPath $first -Value 'corrupt cache'
    Assert-Throws { Get-VerifiedFfmpegArchive -Uri $uri -ExpectedSha256 $hash -CacheDirectory $cache -Download $offline } 'Cached FFmpeg archive checksum mismatch'
    Assert-Throws { Get-VerifiedFfmpegArchive -Uri $uri -ExpectedSha256 $hash -CacheDirectory $cache -ArchivePath $first -Download $offline } 'Provided FFmpeg archive checksum mismatch'
    foreach ($failure in @('hash', 'partial', 'missing')) {
        $isolated = Join-Path $temp $failure
        $bad = switch ($failure) {
            'hash' { { param($url, $target) Set-Content -LiteralPath $target -Value 'wrong bytes' } }
            'partial' { { param($url, $target) Set-Content -LiteralPath $target -Value 'partial'; throw '404 Not Found' } }
            'missing' { { throw '404 Not Found' } }
        }
        Assert-Throws { Get-VerifiedFfmpegArchive -Uri $uri -ExpectedSha256 $hash -CacheDirectory $isolated -Download $bad } 'checksum mismatch|Pinned FFmpeg download failed'
        if (@(Get-ChildItem -LiteralPath $isolated -Force -File).Count -ne 0) { throw 'Failed download left cached/partial bytes' }
    }
    # The download function must remain before package cleanup so a missing input
    # cannot remove a previously usable portable package.
    $publisher = Get-Content -LiteralPath (Join-Path $repo 'product/packaging/publish-windows.ps1') -Raw
    if ($publisher.IndexOf('$archive = Get-VerifiedFfmpegArchive') -ge $publisher.IndexOf('foreach ($path in @($package')) {
        throw 'Package cleanup happens before input verification'
    }
    Write-Host 'PASS: verified cold download, warm/offline cache, explicit offline ZIP, corrupt input rejection and partial cleanup'
} finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
