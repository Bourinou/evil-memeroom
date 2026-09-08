const { forkDistribution } = require('./distribution-config.cjs');
module.exports = forkDistribution({
  appId: process.env.MEMEROOM_FORK_APP_ID,
  name: process.env.MEMEROOM_FORK_NAME,
  productName: process.env.MEMEROOM_FORK_PRODUCT,
  updateUrl: process.env.MEMEROOM_FORK_UPDATE_URL,
});
