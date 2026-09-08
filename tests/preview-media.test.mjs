import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewMedia } from '../desktop/preview-media.cjs';

test('une URL privée ne sert que le fichier lié à un aperçu actif', async () => {
  let released = 0;
  const preview = createPreviewMedia(
    { acquire: async () => ({ file: '/checked/image', release: () => released++ }) },
    async (file) => new Response(file),
  );
  await preview.prepare('valid-token-0001', {}, 'http://localhost:3210');
  assert.equal(
    await (await preview.respond(new Request('http://localhost/playback/valid-token-0001'))).text(),
    '/checked/image',
  );
  assert.equal(
    (await preview.respond(new Request('http://localhost/playback/unknown'))).status,
    404,
  );
  assert.equal(
    (
      await preview.respond(
        new Request('http://localhost/playback/valid-token-0001', { method: 'POST' }),
      )
    ).status,
    404,
  );
  preview.release('valid-token-0001');
  assert.equal(released, 1);
  assert.equal(
    (await preview.respond(new Request('http://localhost/playback/valid-token-0001'))).status,
    404,
  );
});
test('fermer un aperçu pendant sa préparation libère sa copie tardive', async () => {
  let finish,
    released = 0;
  const preview = createPreviewMedia(
    {
      acquire: () =>
        new Promise((resolve) => {
          finish = () => resolve({ release: () => released++ });
        }),
    },
    () => {},
  );
  const pending = preview.prepare('valid-token-0002', {}, 'http://localhost:3210');
  preview.release('valid-token-0002');
  finish();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(released, 1);
  await assert.rejects(preview.prepare('../private-file', {}, ''), /invalide/);
});
