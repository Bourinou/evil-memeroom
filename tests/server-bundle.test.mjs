import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packServer } from '../scripts/server-bundle.mjs';

// Read central-directory names; the fixture is deliberately below ZIP64 limits.
function names(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'archive ZIP terminée');
  let offset = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const length = buffer.readUInt16LE(offset + 28);
    entries.push(buffer.toString('utf8', offset + 46, offset + 46 + length));
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return entries;
}
test('le serveur se distribue sans compiler ni inclure Electron', async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'memeroom-bundle-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const file = await packServer({ root: process.cwd(), output: path.join(output, 'server.zip') });
  const entries = names(await readFile(file));
  assert.ok(entries.includes('server/index.mjs'));
  assert.ok(entries.includes('shared/base.css'));
  assert.ok(entries.includes('docs/ADMINISTRATION.md'));
  assert.ok(entries.includes('LICENSE'));
  assert.equal(
    entries.some((name) => /^(desktop|releases|node_modules|data)\//.test(name)),
    false,
  );
});
test('inclure les téléchargements reste facultatif et accepte une seule plateforme', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memeroom-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releases = path.join(root, 'releases');
  await mkdir(releases);
  await writeFile(path.join(releases, 'MemeRoom-0.6.0-Mac-arm64.zip'), 'fixture');
  await writeFile(
    path.join(releases, 'downloads.json'),
    JSON.stringify({
      macArm64: { version: '0.6.0', filename: 'MemeRoom-0.6.0-Mac-arm64.zip' },
    }),
  );
  const file = await packServer({
    root: process.cwd(),
    releasesDir: releases,
    includeReleases: true,
    output: path.join(root, 'server.zip'),
  });
  const entries = names(await readFile(file));
  assert.ok(entries.includes('releases/downloads.json'));
  assert.ok(entries.includes('releases/MemeRoom-0.6.0-Mac-arm64.zip'));
  assert.equal(
    entries.some((name) => name.endsWith('.exe')),
    false,
  );
});
