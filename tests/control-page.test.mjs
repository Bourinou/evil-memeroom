import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { CONTROL_URL, installControlPage } from '../desktop/control-page.cjs';

test('the remote control and its dependencies load from the bundle without an HTTP server', async () => {
  let handler;
  installControlPage({ protocol: { handle(scheme, callback) { assert.equal(scheme, 'http'); handler = callback; } }, fetch() { throw new Error('The interface must not use the network.'); } });
  const page = await handler(new Request(CONTROL_URL));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="send-form"/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const file of ['/app.mjs', '/app/state.mjs', '/app/rooms.mjs', '/app/composer.mjs', '/app/upload.mjs', '/app/history.mjs', '/app/saved-memes.mjs', '/app/trim.mjs', '/app/settings.mjs', '/styles.css', '/connection.mjs', '/media-view.mjs', '/shared/protocol.mjs', '/shared/history.mjs', '/favicon.svg', '/icon.png']) {
    const response = await handler(new Request(new URL(file, CONTROL_URL)));
    assert.equal(response.status, 200, file); assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  for (const file of ['/package.json', '/app/missing.mjs', '/desktop/preload.cjs', '/server/index.mjs', '/%2e%2e/package.json']) {
    assert.equal((await handler(new Request(new URL(file, CONTROL_URL)))).status, 404, file);
  }
  assert.equal((await handler(new Request(CONTROL_URL, { method: 'POST' }))).status, 404);
});

test('room HTTP requests keep their authorization and binary body when forwarded', async () => {
  let handler, received;
  const upstream = new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
  installControlPage({ protocol: { handle(_scheme, callback) { handler = callback; } }, async fetch(request, options) { received = { request, options }; return upstream; } });
  const request = new Request('http://127.0.0.1:3210/api/media', { method: 'POST', headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([0, 1, 255]) });
  assert.equal(await handler(request), upstream);
  assert.equal(received.request, request);
  assert.deepEqual(received.options, { bypassCustomProtocolHandlers: true });
  assert.equal(received.request.headers.get('authorization'), 'Bearer test-session');
  assert.deepEqual(new Uint8Array(await received.request.arrayBuffer()), new Uint8Array([0, 1, 255]));
});

async function savedMemesHandler(t, files) {
  const memesDir = await mkdtemp(path.join(os.tmpdir(), 'memes-'));
  t.after(() => rm(memesDir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(memesDir, name), content);
  let handler;
  installControlPage({ protocol: { handle(_scheme, callback) { handler = callback; } }, fetch() {} }, { memesDir });
  return (name, init) => handler(new Request(new URL('/saved-memes/' + name, CONTROL_URL), init));
}

test('saved memes with spaces in filenames decode and serve correctly', async t => {
  const get = await savedMemesHandler(t, { 'test space meme.png': 'test-image-bytes' });
  const response = await get(encodeURIComponent('test space meme.png'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('content-length'), '16');
  assert.equal(await response.text(), 'test-image-bytes');
});

test('saved memes honour byte ranges', async t => {
  const get = await savedMemesHandler(t, { 'clip.mp4': '0123456789' });
  const partial = await get('clip.mp4', { headers: { Range: 'bytes=2-5' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(partial.headers.get('content-length'), '4');
  assert.equal(await partial.text(), '2345');
  const suffix = await get('clip.mp4', { headers: { Range: 'bytes=-3' } });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), '789');
  const unsatisfiable = await get('clip.mp4', { headers: { Range: 'bytes=10-20' } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get('content-range'), 'bytes */10');
});

test('saved memes answer HEAD without a body and reject bad names', async t => {
  const get = await savedMemesHandler(t, { 'clip.mp4': '0123456789', '.hidden.png': 'x' });
  const head = await get('clip.mp4', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(await head.text(), '');
  for (const name of ['%E0%A4%A', 'missing.png', '.hidden.png', '..%2F..%2Fpackage.json']) {
    assert.equal((await get(name)).status, 404, name);
  }
});
