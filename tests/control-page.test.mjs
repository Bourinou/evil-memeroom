import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_URL, installControlPage } from '../desktop/control-page.cjs';

test('the remote control and its dependencies load from the bundle without an HTTP server', async () => {
  let handler;
  installControlPage({
    protocol: {
      handle(scheme, callback) {
        assert.equal(scheme, 'http');
        handler = callback;
      },
    },
    fetch() {
      throw new Error('The interface must not use the network.');
    },
  });
  const page = await handler(new Request(CONTROL_URL));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="send-form"/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const file of [
    '/app.mjs',
    '/styles.css',
    '/connection.mjs',
    '/media-view.mjs',
    '/shared/protocol.mjs',
    '/favicon.svg',
  ]) {
    const response = await handler(new Request(new URL(file, CONTROL_URL)));
    assert.equal(response.status, 200, file);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  for (const file of [
    '/package.json',
    '/desktop/preload.cjs',
    '/server/index.mjs',
    '/%2e%2e/package.json',
  ]) {
    assert.equal((await handler(new Request(new URL(file, CONTROL_URL)))).status, 404, file);
  }
  assert.equal((await handler(new Request(CONTROL_URL, { method: 'POST' }))).status, 404);
});

test('room HTTP requests keep their authorization and binary body when forwarded', async () => {
  let handler, received;
  const upstream = new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
  installControlPage({
    protocol: {
      handle(_scheme, callback) {
        handler = callback;
      },
    },
    async fetch(request, options) {
      received = { request, options };
      return upstream;
    },
  });
  const request = new Request('http://127.0.0.1:3210/api/media', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array([0, 1, 255]),
  });
  assert.equal(await handler(request), upstream);
  assert.equal(received.request, request);
  assert.deepEqual(received.options, { bypassCustomProtocolHandlers: true });
  assert.equal(received.request.headers.get('authorization'), 'Bearer test-session');
  assert.deepEqual(
    new Uint8Array(await received.request.arrayBuffer()),
    new Uint8Array([0, 1, 255]),
  );
});
