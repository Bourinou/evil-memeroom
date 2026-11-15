// Single source of release file names; must match the artifactName entries in package.json.
const PREFIX = 'evil-memeroom';
// Files published before the rename stay downloadable.
const LEGACY_PREFIX = 'MemeRoom';
const VERSION_PATTERN = '\\d+\\.\\d+\\.\\d+';

export const downloadFilenames = (version, prefix = PREFIX) => ({
  windows: `${prefix}-Setup-${version}.exe`,
  linux: `${prefix}-${version}-Linux-x86_64.AppImage`,
  macArm64: `${prefix}-${version}-Mac-arm64.zip`,
  macIntel: `${prefix}-${version}-Mac-x64.zip`
});

export const legacyDownloadFilenames = version => downloadFilenames(version, LEGACY_PREFIX);

// Matches every servable binary name, current and legacy (the Windows blockmap included).
export const releaseBinaryPattern = new RegExp(`^(?:${PREFIX}|${LEGACY_PREFIX})-(?:Setup-${VERSION_PATTERN}\\.exe(?:\\.blockmap)?|${VERSION_PATTERN}-Linux-x86_64\\.AppImage|${VERSION_PATTERN}-Mac-(?:arm64|x64)\\.zip)$`);
