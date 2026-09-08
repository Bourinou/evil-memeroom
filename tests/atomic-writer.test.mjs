import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtomicWriter } from '../shared/node/atomic-writer.cjs';

test('une rafale de réglages écrit seulement le dernier état et attend sa persistance', async () => {
  const written = [];
  const writer = createAtomicWriter('unused', {
    write: async (value) => written.push(value),
    delayMs: 20,
  });
  const pending = Array.from({ length: 50 }, (_, volume) => writer.save({ volume }));
  await writer.flush();
  await Promise.all(pending);
  assert.deepEqual(written, [JSON.stringify({ volume: 49 }, null, 2)]);
});
test('une écriture en cours ne perd pas la suivante et une erreur remonte aux appelants', async () => {
  let finish,
    attempt = 0;
  const written = [];
  const writer = createAtomicWriter('unused', {
    delayMs: 0,
    write: async (value) => {
      written.push(value);
      if (++attempt === 1)
        await new Promise((resolve) => {
          finish = resolve;
        });
      if (attempt === 2) throw new Error('disque plein');
    },
  });
  const first = writer.save({ value: 1 });
  const flush = writer.flush();
  const second = writer.save({ value: 2 });
  const failed = assert.rejects(second, /disque plein/);
  finish();
  await first;
  await assert.rejects(flush, /disque plein/);
  await failed;
  const third = writer.save({ value: 3 });
  await writer.flush();
  await third;
  assert.equal(written.length, 3);
});

test(
  'une sauvegarde déclenchée par la résolution précédente ne reste pas en attente',
  { timeout: 1000 },
  async () => {
    const written = [];
    const writer = createAtomicWriter('unused', {
      delayMs: 1,
      write: async (value) => written.push(value),
    });
    await writer.save(1).then(() => writer.save(2));
    assert.deepEqual(written, ['1', '2']);
  },
);
