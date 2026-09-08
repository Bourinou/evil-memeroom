const { build } = require('../package.json');
function forkDistribution({ appId, name, productName, updateUrl }) {
  if (
    !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(appId || '') ||
    appId === 'fr.memeroom.desktop' ||
    !/^[a-z][a-z0-9-]{2,60}$/.test(name || '') ||
    name === 'memeroom' ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{2,59}$/u.test(productName || '') ||
    productName.toLowerCase() === 'memeroom'
  )
    throw new Error(
      'Identité du fork invalide : préciser un identifiant, un nom de paquet et un nom de produit distincts.',
    );
  if (updateUrl) {
    const url = new URL(updateUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith('/')
    )
      throw new Error('URL de mise à jour invalide.');
    if (url.hostname === 'memeroom.tonamielarose.fr')
      throw new Error('Un fork ne doit pas utiliser le flux officiel.');
  }
  return {
    ...build,
    appId,
    productName,
    directories: { output: 'release/fork' },
    extraMetadata: { name, productName, memeroomUpdatesEnabled: !!updateUrl },
    publish: updateUrl
      ? [{ provider: 'generic', url: updateUrl, useMultipleRangeRequest: false }]
      : null,
    artifactName: `${name}-\${version}-\${os}-\${arch}.\${ext}`,
    win: { ...build.win, artifactName: `${name}-\${version}-Windows-\${arch}.\${ext}` },
    nsis: {
      ...build.nsis,
      artifactName: `${name}-Setup-\${version}.exe`,
      shortcutName: productName,
    },
    linux: {
      ...build.linux,
      executableName: name,
      artifactName: `${name}-\${version}-Linux-\${arch}.\${ext}`,
    },
    mac: { ...build.mac, artifactName: `${name}-\${version}-Mac-\${arch}.\${ext}` },
  };
}
module.exports = { forkDistribution };
