#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
directory="$repo/artifacts/dependencies/icu-78.3-linux-x64"
archive="$repo/artifacts/downloads/icu4c-78.3-Ubuntu22.04-x64.tgz"
checksum=9c8abe58a20cf82ea22341d8125272094f7fca2414173cbc2d8742feb84566a2
if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo 'ICU package supports Linux x86_64 only.' >&2
  exit 1
fi
mkdir -p -- "$(dirname -- "$archive")" "$directory"
if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 \
    https://github.com/unicode-org/icu/releases/download/release-78.3/icu4c-78.3-Ubuntu22.04-x64.tgz \
    --output "${archive}.partial"
  mv -- "${archive}.partial" "$archive"
fi
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$directory"
root="$directory/icu/usr/local"
for file in include/unicode/uvernum.h lib/libicuuc.so.78 lib/libicui18n.so.78 lib/libicudata.so.78 share/icu/78.3/LICENSE; do
  test -f "$root/$file"
done
printf '%s\n' "$root"
