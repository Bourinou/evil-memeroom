import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { safeBaseName, validateRange, extractArgs, trimArgs, runFfmpeg, FFMPEG_TIMEOUT_MS } = require('../desktop/media-tools.cjs');

test('validateRange accepts 0 <= start < end and rejects the rest', () => {
  assert.doesNotThrow(() => validateRange(0, 1.5));
  for (const [s, e] of [[-1, 2], [3, 3], [4, 2], [NaN, 2], [0, Infinity], ['1', 2], [undefined, 2]]) {
    assert.throws(() => validateRange(s, e), /invalide/);
  }
});

test('safeBaseName strips path, extension and leading dashes', () => {
  assert.equal(safeBaseName('a/b/clip.mp4'), 'clip');
  assert.equal(safeBaseName('--version.mp4'), 'version');
  assert.equal(safeBaseName('-.mp4'), 'media');
  assert.equal(safeBaseName(''), 'media');
});

test('argument builders keep the expected options', () => {
  assert.deepEqual(extractArgs('i', 'o', 'wav'), ['-y', '-i', 'i', '-vn', '-f', 'wav', 'o']);
  assert.ok(extractArgs('i', 'o', 'mp3').includes('libmp3lame'));
  const copy = trimArgs('i', 'o', 1, 2, 'copy');
  assert.deepEqual(copy.slice(0, 6), ['-y', '-ss', '1', '-i', 'i', '-t']);
  assert.ok(copy.includes('copy') && copy.at(-1) === 'o');
  assert.ok(trimArgs('i', 'o', 1, 2, 'preset').includes('veryfast'));
  assert.ok(!trimArgs('i', 'o', 1, 2, 'reencode').includes('-c'));
});

test('runFfmpeg passes timeout and windowsHide', async () => {
  let seen;
  await runFfmpeg('ff', ['x'], async (bin, args, opts) => { seen = { bin, args, opts }; });
  assert.deepEqual(seen, { bin: 'ff', args: ['x'], opts: { windowsHide: true, timeout: FFMPEG_TIMEOUT_MS } });
});

test('uploadWithRetry retries 429 up to 3 attempts, not other errors', async () => {
  const { uploadWithRetry } = require('../desktop/media-tools.cjs');
  let calls = 0;
  const busy = Object.assign(new Error('busy'), { status: 429 });
  const ok = await uploadWithRetry(async () => { if (++calls < 3) throw busy; return 'ok'; }, async () => {});
  assert.equal(ok, 'ok');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(uploadWithRetry(async () => { calls++; throw busy; }, async () => {}), /busy/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(uploadWithRetry(async () => { calls++; throw new Error('x'); }, async () => {}), /x/);
  assert.equal(calls, 1);
});

test('path allowlist only accepts absolute paths it was given', () => {
  const { createPathAllowlist } = require('../desktop/media-tools.cjs');
  const list = createPathAllowlist(2);
  const a = path.resolve('/v/a.webm');
  const b = path.resolve('/v/b.webm');
  const c = path.resolve('/v/c.webm');
  assert.equal(list.has(a), false);
  assert.equal(list.allow('relative.webm'), false);
  assert.equal(list.allow(a), true);
  assert.equal(list.has(a), true);
  assert.equal(list.has(b), false);
  assert.equal(list.has(undefined), false);
  list.allow(b); list.allow(c);
  assert.equal(list.has(a), false, 'oldest entry evicted past the limit');
  assert.equal(list.has(c), true);
});
