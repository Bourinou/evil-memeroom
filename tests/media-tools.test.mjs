import test from 'node:test';
import assert from 'node:assert/strict';
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
