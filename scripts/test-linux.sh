#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$source_dir/.test-artifacts/linux-qa-$(date +%s)"
mkdir -p "$test_dir"
printf '%s\n' "$test_dir" > "$source_dir/.test-artifacts/linux-test-path.txt"
for entry in public tests package.json package-lock.json; do
  cp -R -- "$source_dir/$entry" "$test_dir/"
done
cd -- "$test_dir"
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/ffmpeg-static/install.js

# WSL's minimal Ubuntu image may lack audio/NSS libraries. Extract copies locally.
# No system packages, kernel settings or sandbox flags are modified.
mkdir -p test-libs/packages test-libs/root
cd test-libs/packages
apt download libnspr4 libnss3 libasound2t64
for package in *.deb; do dpkg-deb -x "$package" ../root; done
cd ../..
export LD_LIBRARY_PATH="$test_dir/test-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export APPIMAGE_EXTRACT_AND_RUN=1
app_version="$(node -p 'require("./package.json").version')"
export MEMEROOM_TEST_EXE="$source_dir/release/MemeRoom-$app_version-Linux-x86_64.AppImage"
node tests/desktop.e2e.mjs
cp -- .test-artifacts/packaged-results.json "$source_dir/.test-artifacts/linux-results.json"
