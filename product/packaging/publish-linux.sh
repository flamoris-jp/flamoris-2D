#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
output=${1:-"$repo/artifacts/linux/FLAMORIS-2D-linux-x64"}
if [[ -e "$output" ]]; then
  echo 'Publish output must be a new directory.' >&2
  exit 1
fi
icu_root=${FLAMORIS2D_ICU_ROOT:-$(bash "$repo/product/packaging/prepare-linux-icu.sh")}
DOTNET_CLI_USE_MSBUILD_SERVER=0 MSBUILDDISABLENODEREUSE=1 dotnet publish "$repo/product/native/src/Flamoris2D.Cli" -c Release -r linux-x64 --self-contained true -m:1 -nr:false \
  -p:NativeIcuRoot="$icu_root" -p:NativeCoreBuildDir="$repo/out/linux-core" -p:NuGetAudit=false -p:UseSharedCompilation=false -o "$output"
for name in icuuc icui18n icudata; do cp -L -- "$icu_root/lib/lib${name}.so.78" "$output/"; done
cp -- "$icu_root/share/icu/78.3/LICENSE" "$output/ICU-LICENSE.txt"
cp -- "$repo/LICENSE" "$output/LICENSE"
cp -- "$repo/product/native/core/third_party/picojson/LICENSE" "$output/LICENSE-picojson.txt"
cp -- "$repo/product/native/THIRD-PARTY-NOTICES.md" "$output/THIRD-PARTY-NOTICES.md"
runtime_root=$(dirname -- "$(readlink -f -- "$(command -v dotnet)")")
cp -- "$runtime_root/LICENSE.txt" "$output/DOTNET-LICENSE.txt"
cp -- "$runtime_root/ThirdPartyNotices.txt" "$output/DOTNET-ThirdPartyNotices.txt"
"$output/flamoris2d" mcp-catalog > "$output/flamoris2d-lime.json"
python3 - "$output" <<'PY'
import hashlib,pathlib,sys
root=pathlib.Path(sys.argv[1])
required=['flamoris2d','libFlamoris2D.Core.Native.so','libicuuc.so.78','libicui18n.so.78','libicudata.so.78','ICU-LICENSE.txt','LICENSE-picojson.txt']
for name in required:
    if not (root/name).is_file(): raise SystemExit('Missing runtime file: '+name)
for p in root.rglob('*'):
    if p.is_file() and any(x in p.name for x in ('Wpf','Capture','Renderer.Native','Tests')): raise SystemExit('Unexpected desktop/test runtime: '+p.name)
paths=sorted(p for p in root.rglob('*') if p.is_file())
(root/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(root).as_posix()+'\n' for p in paths),encoding='utf-8')
PY
tar -czf "${output}.tar.gz" -C "$(dirname -- "$output")" "$(basename -- "$output")"
printf '%s\n' "$output"
