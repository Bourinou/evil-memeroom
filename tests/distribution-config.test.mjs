import test from 'node:test';
import assert from 'node:assert/strict';
import { forkDistribution } from '../scripts/distribution-config.cjs';

const identity = {
  appId: 'org.example.reactions',
  name: 'example-reactions',
  productName: 'Example Reactions',
};
test('un fork utilise un profil distinct et désactive les mises à jour par défaut', () => {
  const config = forkDistribution(identity);
  assert.equal(config.appId, identity.appId);
  assert.equal(config.extraMetadata.name, identity.name);
  assert.equal(config.extraMetadata.productName, identity.productName);
  assert.equal(config.extraMetadata.memeroomUpdatesEnabled, false);
  assert.equal(config.publish, null);
});
test('les mises à jour du fork exigent une URL HTTPS distincte et une identité explicite', () => {
  const config = forkDistribution({ ...identity, updateUrl: 'https://example.org/releases/' });
  assert.equal(config.publish[0].url, 'https://example.org/releases/');
  assert.equal(config.extraMetadata.memeroomUpdatesEnabled, true);
  for (const updateUrl of [
    'http://example.org/',
    'https://user:secret@example.org/',
    'https://memeroom.tonamielarose.fr/releases/',
  ])
    assert.throws(() => forkDistribution({ ...identity, updateUrl }), /invalide|officiel/);
  assert.throws(() => forkDistribution({ ...identity, appId: 'fr.memeroom.desktop' }), /identité/i);
  assert.throws(() => forkDistribution({ ...identity, name: 'memeroom' }), /identité/i);
  assert.throws(() => forkDistribution({ ...identity, productName: '../Profile' }), /identité/i);
});
