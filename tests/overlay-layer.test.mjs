import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const { createOverlayLayer } = createRequire(import.meta.url)('../desktop/overlay-layer.cjs');

function fakeWindow() {
  const window = new EventEmitter();
  Object.assign(window, {
    isDestroyed: () => false, isVisible: () => true, getTitle: () => 'overlay',
    setIgnoreMouseEvents() {}, setFocusable() {}, setVisibleOnAllWorkspaces() {},
    setAlwaysOnTop() { window.order++; }, moveTop() {}, showInactive() {}, hide() {}, order: 0
  });
  return window;
}

async function ticks(platform, count, exec) {
  const window = fakeWindow();
  const layer = createOverlayLayer(window, platform, exec);
  layer.show();
  await new Promise((resolve) => setTimeout(resolve, 500 * count + 100));
  layer.hide();
  return window;
}

test('linux: click-through runs once at show, not on timer ticks', async () => {
  let launches = 0;
  const window = await ticks('linux', 5, () => { launches++; });
  assert.equal(launches, 1);
  assert.ok(window.order >= 5);
});

test('linux: explicit refresh re-applies click-through', () => {
  let launches = 0;
  const layer = createOverlayLayer(fakeWindow(), 'linux', () => { launches++; });
  layer.show();
  layer.refresh();
  layer.hide();
  assert.equal(launches, 2);
});

test('win32: never launches an external process', async () => {
  let launches = 0;
  const window = await ticks('win32', 2, () => { launches++; });
  assert.equal(launches, 0);
  assert.ok(window.order >= 2);
});

test('linux: warns only once when a tool is missing', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const layer = createOverlayLayer(fakeWindow(), 'linux', (_f, _a, _o, callback) => callback(Object.assign(new Error('x'), { code: 'ENOENT' })));
    layer.show();
    layer.refresh();
    layer.hide();
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
});
