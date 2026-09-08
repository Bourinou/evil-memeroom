const { build } = require('../package.json');
module.exports = {
  ...build,
  forceCodeSigning: true,
  mac: {
    ...build.mac,
    identity: process.env.CSC_NAME || undefined,
    hardenedRuntime: true,
    notarize: true,
    entitlements: 'scripts/mac-entitlements.plist',
    entitlementsInherit: 'scripts/mac-entitlements.plist',
  },
};
