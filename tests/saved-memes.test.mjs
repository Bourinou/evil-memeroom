import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createSavedMemes } = require('../desktop/saved-memes.cjs');

const gif = (tail = '') => Buffer.concat([Buffer.from('GIF89a'), Buffer.from('\0\0\0\0\0\0'), Buffer.from(tail)]);
const png = (tail = '') => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('\0\0\0\0'), Buffer.from(tail)]);

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'saved-memes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const memesDir = path.join(root, 'memes');
  const memes = createSavedMemes({ memesDir, hashCachePath: path.join(root, 'hashes.json') });
  const source = async bytes => {
    const file = path.join(root, `src-${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(file, bytes);
    return file;
  };
  return { memes, memesDir, source };
}

test('extension comes from the detected format, not the sender name', async t => {
  const { memes, memesDir, source } = await setup(t);
  assert.deepEqual(await memes.save(await source(gif()), 'x.bat'), { saved: true, name: 'x.gif' });
  assert.deepEqual(await fs.readdir(memesDir), ['x.gif']);
  assert.equal((await memes.save(await source(png('a')), 'noext')).name, 'noext.png');
  assert.equal((await memes.save(await source(png('b')), 'pic.jpg')).name, 'pic.png');
});

test('reserved Windows names, trailing dots and long names are neutralised', async t => {
  const { memes, source } = await setup(t);
  assert.equal((await memes.save(await source(png('1')), 'CON.png')).name, '_CON.png');
  assert.equal((await memes.save(await source(png('2')), 'nul')).name, '_nul.png');
  assert.equal((await memes.save(await source(png('3')), 'com1.txt')).name, '_com1.png');
  assert.equal((await memes.save(await source(png('4')), 'name. . .')).name, 'name.png');
  assert.equal((await memes.save(await source(png('5')), '...')).name.endsWith('.png'), true);
  const long = (await memes.save(await source(png('6')), `${'a'.repeat(300)}.png`)).name;
  assert.ok(long.length <= 120 && long.endsWith('.png'));
});

test('unknown formats are refused and duplicates detected by hash', async t => {
  const { memes, memesDir, source } = await setup(t);
  assert.deepEqual(await memes.save(await source(Buffer.from('echo hello, not media')), 'a.bat'), { saved: false, reason: 'unsupported' });
  assert.deepEqual(await fs.readdir(memesDir).catch(() => []), []);
  await memes.save(await source(gif()), 'first');
  assert.deepEqual(await memes.save(await source(gif()), 'second'), { saved: false, reason: 'duplicate', name: 'first.gif' });
  assert.equal((await memes.save(await source(gif('x')), 'first')).name, 'first 1.gif');
});

test('rename keeps the extension and applies the same name rules', async t => {
  const { memes, memesDir, source } = await setup(t);
  await memes.save(await source(gif()), 'a');
  assert.equal(await memes.rename('a.gif', 'b.bat'), 'b.gif');
  assert.equal(await memes.rename('b.gif', 'CON'), '_CON.gif');
  assert.equal(await memes.rename('_CON.gif', 'c. '), 'c.gif');
  assert.deepEqual(await fs.readdir(memesDir), ['c.gif']);
  await assert.rejects(memes.rename('c.gif', ' . '), /invalide/);
});

test('receiving a reaction does not rescan the folder after the first sync', async t => {
  const { memes, source } = await setup(t);
  await memes.save(await source(png('0')), 'one');
  const original = fs.readdir;
  let calls = 0;
  fs.readdir = (...args) => { calls++; return original(...args); };
  t.after(() => { fs.readdir = original; });
  await memes.save(await source(png('1')), 'two');
  await memes.save(await source(png('1')), 'dup');
  await memes.remove('two.png');
  assert.equal(calls, 0);
  await memes.list();
  assert.equal(calls, 1);
});
