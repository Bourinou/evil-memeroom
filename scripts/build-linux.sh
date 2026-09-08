#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'Cette compilation AppImage nécessite Linux x86_64 (ou WSL Ubuntu x86_64).' >&2
  exit 1
fi

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$(mktemp -d /tmp/memeroom-linux.XXXXXX)"
trap 'if [[ "${MEMEROOM_KEEP_BUILD:-0}" != 1 ]]; then rm -rf -- "$build_dir"; fi' EXIT
echo "Dossier de compilation : $build_dir"
mkdir -p "$source_dir/.test-artifacts" "$source_dir/release"
printf '%s\n' "$build_dir" > "$source_dir/.test-artifacts/linux-build-path.txt"
node "$source_dir/scripts/prepare-build.mjs" "$build_dir"

cd -- "$build_dir"
# Keep Linux dependencies separate from any Windows node_modules in the source tree.
npm ci --ignore-scripts --no-audit --no-fund
if [[ "${1:-}" != --skip-checks ]]; then
  npm run check
  npm run check:types
  npm run lint
  npm run format:check
  npm test
fi
npm run dist:linux
cp -- release/*.AppImage "$source_dir/release/"
cp -- release/latest-linux.yml "$source_dir/release/"
echo "AppImage disponible dans $source_dir/release/"
