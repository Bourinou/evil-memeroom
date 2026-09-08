// Dedicated identity: install tests must never replace the user's MemeRoom installation.
const { forkDistribution } = require('./distribution-config.cjs');
const config = forkDistribution({
  appId: 'fr.memeroom.validation',
  name: 'memeroom-validation',
  productName: 'MemeRoom Validation',
});
config.directories.output = '.test-artifacts/installer';
Object.assign(config.nsis, {
  createDesktopShortcut: false,
  createStartMenuShortcut: false,
  runAfterFinish: false,
});
module.exports = config;
