import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from '../desktop/playback.cjs';
import * as protocol from '../shared/protocol.mjs';

function setup(
  t,
  cache = {
    acquire: async () => {
      throw new Error('unexpected media');
    },
  },
) {
  const shown = [],
    hidden = [],
    settings = { ...protocol.DEFAULT_SETTINGS, cooldown: 0 };
  const playback = createPlayback({
    protocol,
    cache,
    getSettings: () => settings,
    show: (value) => shown.push(value),
    hide: () => hidden.push(true),
    reveal: () => {},
  });
  t.after(() => playback.clear());
  return { playback, settings, shown, hidden };
}
test('une lecture annulée pendant le téléchargement ne peut pas réafficher le média', async (t) => {
  let finish,
    released = 0;
  const { playback, shown } = setup(t, {
    acquire: () =>
      new Promise((resolve) => {
        finish = () => resolve({ file: '/media.png', release: () => released++ });
      }),
  });
  const promise = playback.display({
    server: 'http://localhost:3210',
    duration: 4,
    media: { id: 'a'.repeat(32), url: `/media/${'a'.repeat(32)}`, kind: 'image' },
  });
  playback.clear();
  finish();
  assert.equal((await promise).reason, 'cancelled');
  assert.equal(shown.length, 0);
  assert.equal(released, 1);
});
test('le compteur commence au signal prêt et ignore les anciennes générations', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { playback, shown, hidden } = setup(t);
  await playback.display({ server: 'http://localhost:3210', caption: 'Bonjour', duration: 4 });
  const id = shown[0].playbackId;
  const before = hidden.length;
  t.mock.timers.tick(6000);
  assert.equal(hidden.length, before);
  assert.equal(playback.ready(id - 1), false);
  assert.equal(playback.ready(id), true);
  t.mock.timers.tick(4250);
  assert.equal(hidden.length, before + 1);
  assert.equal(playback.ready(id), false);
});
test('pause et déduplication restent appliquées avant la lecture', async (t) => {
  const { playback, shown, settings } = setup(t);
  const reaction = { server: 'http://localhost:3210', caption: 'Test', duration: 4, id: 'unique' };
  settings.paused = true;
  assert.equal((await playback.display(reaction)).reason, 'paused');
  settings.paused = false;
  assert.equal((await playback.display(reaction)).shown, true);
  assert.equal((await playback.display(reaction)).shown, false);
  assert.equal(shown.length, 1);
});
