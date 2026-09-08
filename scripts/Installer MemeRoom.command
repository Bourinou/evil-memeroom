#!/bin/bash
set -euo pipefail
# Local installation for the unsigned community build. Never disables Gatekeeper globally.
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
source_app="$source_dir/MemeRoom.app"
if [[ ! -d "$source_app" || "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist")" != fr.memeroom.desktop ]]; then
  echo 'MemeRoom.app doit se trouver à côté de cet installateur.'; read -r -p 'Entrée pour fermer.'; exit 1
fi
echo 'Installation de MemeRoom dans votre dossier Applications personnel.'
echo 'Cette version ne possède pas de certificat Apple. Une signature locale sera créée.'
echo 'Utilisez uniquement une archive obtenue sur votre serveur MemeRoom de confiance.'
read -r -p 'Continuer ? [o/N] ' answer
[[ "$answer" == o || "$answer" == O ]] || exit 0
destination="$HOME/Applications"
mkdir -p "$destination"
stage="$(mktemp -d "$destination/.memeroom-install.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
/usr/bin/ditto "$source_app" "$stage/MemeRoom.app"
cat > "$stage/entitlements.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/></dict></plist>
PLIST
/usr/bin/codesign --force --deep --sign - --entitlements "$stage/entitlements.plist" "$stage/MemeRoom.app"
/usr/bin/codesign --verify --deep --strict "$stage/MemeRoom.app"
# Only the application just copied and verified is exempted from download quarantine.
/usr/bin/xattr -dr com.apple.quarantine "$stage/MemeRoom.app"
if [[ -e "$destination/MemeRoom.app" ]]; then
  echo 'L’ancienne installation sera conservée dans un dossier de sauvegarde.'
  backup="$(mktemp -d "$destination/MemeRoom-ancienne.XXXXXX")"
  mv -- "$destination/MemeRoom.app" "$backup/MemeRoom.app"
fi
mv -- "$stage/MemeRoom.app" "$destination/MemeRoom.app"
/usr/bin/open "$destination/MemeRoom.app"
echo 'MemeRoom est installé. Les rooms et réglages ont été conservés.'
