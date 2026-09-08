import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MediaCache } from '../desktop/media-cache.cjs';

const asset = (id) => ({
  id: id.repeat(32),
  url: `/media/${id.repeat(32)}`,
  kind: 'image',
  bytes: 4,
});
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memeroom-cache-test-'));
  let transfers = 0;
  const cache = new MediaCache({
    root,
    maxBytes: 8,
    ttlMs: 100,
    ...options,
    download:
      options.download ||
      (async (_asset, _server, file) => {
        transfers++;
        await writeFile(file, 'data');
        return { bytes: 4, mime: 'image/png' };
      }),
  });
  t.after(async () => {
    await cache.close();
    await rm(root, { recursive: true, force: true });
  });
  return { cache, transfers: () => transfers };
}
test('aperçu et overlay partagent un seul transfert et une copie disque', async (t) => {
  const { cache, transfers } = await fixture(t);
  const [preview, overlay] = await Promise.all([
    cache.acquire(asset('a'), 'http://localhost:3210'),
    cache.acquire(asset('a'), 'http://localhost:3210'),
  ]);
  assert.equal(transfers(), 1);
  assert.equal(preview.file, overlay.file);
  preview.release();
  await access(overlay.file);
  overlay.release();
  const again = await cache.acquire(asset('a'), 'http://localhost:3210');
  assert.equal(transfers(), 1);
  again.release();
});
test('le quota évince les copies libres et protège une lecture en cours', async (t) => {
  const { cache, transfers } = await fixture(t);
  const active = await cache.acquire(asset('a'), 'http://localhost:3210');
  const free = await cache.acquire(asset('b'), 'http://localhost:3210');
  free.release();
  const next = await cache.acquire(asset('c'), 'http://localhost:3210');
  await access(active.file);
  await assert.rejects(access(free.file), { code: 'ENOENT' });
  await assert.rejects(cache.acquire(asset('d'), 'http://localhost:3210'), /occupé/);
  assert.equal(transfers(), 3);
  active.release();
  next.release();
});
test('une entrée expirée ou un autre serveur exige un nouveau transfert', async (t) => {
  let now = 0;
  const { cache, transfers } = await fixture(t, { now: () => now });
  (await cache.acquire(asset('a'), 'http://localhost:3210')).release();
  now = 101;
  (await cache.acquire(asset('a'), 'http://localhost:3210')).release();
  (await cache.acquire(asset('a'), 'http://localhost:3211')).release();
  assert.equal(transfers(), 3);
});
test('annuler un consommateur conserve le transfert de l’autre', async (t) => {
  let complete;
  const { cache } = await fixture(t, {
    download: async (_asset, _server, file, signal) => {
      await new Promise((resolve) => {
        complete = resolve;
      });
      assert.equal(signal.aborted, false);
      await writeFile(file, 'data');
      return { bytes: 4 };
    },
  });
  const controller = new AbortController();
  const first = cache.acquire(asset('a'), 'http://localhost:3210', controller.signal);
  const second = cache.acquire(asset('a'), 'http://localhost:3210');
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  complete();
  (await second).release();
});
test('un échec est retentable et les métadonnées invalides sont refusées', async (t) => {
  let attempts = 0;
  const { cache } = await fixture(t, {
    download: async (_asset, _server, file) => {
      if (++attempts === 1) throw new Error('hors ligne');
      await writeFile(file, 'data');
      return { bytes: 4 };
    },
  });
  await assert.rejects(cache.acquire(asset('a'), 'http://localhost:3210'), /hors ligne/);
  (await cache.acquire(asset('a'), 'http://localhost:3210')).release();
  await assert.rejects(
    cache.acquire({ ...asset('b'), url: '/secret' }, 'http://localhost:3210'),
    /invalide/,
  );
});
test('fermer annule et attend les téléchargements avant de supprimer le cache', async (t) => {
  const { cache } = await fixture(t, {
    download: async (_asset, _server, _file, signal) => {
      signal.throwIfAborted();
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  const pending = cache.acquire(asset('a'), 'http://localhost:3210');
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await cache.close();
  await rejected;
  await assert.rejects(cache.acquire(asset('b'), 'http://localhost:3210'), /fermé/);
});
