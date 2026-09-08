import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('temporary storage reclaims a dead instance and preserves active or unowned directories', async (t) => {
  const { createTempDirectory } = await import('../shared/node/temp-directory.cjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'memeroom-temp-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const active = await createTempDirectory('memeroom-media-', { root });
  await writeFile(path.join(active, 'media'), 'active');
  const dead = await createTempDirectory('memeroom-media-', { root });
  await writeFile(
    path.join(dead, '.owner.json'),
    JSON.stringify({ version: 1, prefix: 'memeroom-media-', pid: 987654 }),
  );
  await writeFile(path.join(dead, 'media'), 'orphan');
  const unknown = path.join(root, 'memeroom-media-ABCDEF');
  await mkdir(unknown);
  await writeFile(path.join(unknown, 'personal'), 'preserve');
  const current = await createTempDirectory('memeroom-media-', {
    root,
    isAlive: (pid) => pid === process.pid,
  });
  await assert.rejects(access(dead), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(active, 'media'), 'utf8'), 'active');
  assert.equal(await readFile(path.join(unknown, 'personal'), 'utf8'), 'preserve');
  assert.equal(
    JSON.parse(await readFile(path.join(current, '.owner.json'), 'utf8')).pid,
    process.pid,
  );
});

test('a temporary directory prefix cannot escape its root', async () => {
  const { createTempDirectory } = await import('../shared/node/temp-directory.cjs');
  await assert.rejects(createTempDirectory('../outside-'), /préfixe/);
});
