#!/usr/bin/env bash
set -euo pipefail
# Linux/WSL can package unsigned ZIPs while preserving .app symlinks and modes.
# Developer ID signing, notarization and runtime validation require a Mac.
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$(mktemp -d /tmp/memeroom-mac.XXXXXX)"
trap 'if [[ "${MEMEROOM_KEEP_BUILD:-0}" != 1 ]]; then rm -rf -- "$build_dir"; fi' EXIT
echo "Dossier de compilation Mac : $build_dir"
mkdir -p "$source_dir/release/mac"
node "$source_dir/scripts/prepare-build.mjs" "$build_dir"
cd -- "$build_dir"
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run check:types
npm run lint
npm run format:check
npm test
if [[ "${1:-}" == --signed ]]; then
  [[ "$(uname -s)" == Darwin ]] || { echo 'La signature Apple nécessite macOS.' >&2; exit 1; }
  npm exec -- electron-builder --config scripts/mac-release.cjs --mac zip --arm64 --x64 --publish never --config.directories.output=release/mac
  for bundle in release/mac/mac/MemeRoom.app release/mac/mac-arm64/MemeRoom.app; do
    codesign --verify --deep --strict "$bundle"
    spctl --assess --type execute --verbose "$bundle"
    xcrun stapler validate "$bundle"
  done
else
  npm exec -- electron-builder --mac dir --arm64 --x64 --publish never --config.directories.output=release/mac
  node scripts/pack-mac.mjs release/mac
fi
node scripts/mac-metadata.mjs release/mac
cp -- release/mac/MemeRoom-*-Mac-*.zip release/mac/mac-downloads.json "$source_dir/release/mac/"
echo "Archives Mac disponibles dans $source_dir/release/mac/"
