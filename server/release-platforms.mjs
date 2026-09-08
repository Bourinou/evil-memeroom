export const downloadFilenames = (version) => ({
  windows: `MemeRoom-Setup-${version}.exe`,
  linux: `MemeRoom-${version}-Linux-x86_64.AppImage`,
  macArm64: `MemeRoom-${version}-Mac-arm64.zip`,
  macIntel: `MemeRoom-${version}-Mac-x64.zip`,
});
