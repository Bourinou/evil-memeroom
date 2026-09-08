import { _electron as electron } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

// One focused check: rebinding, persistence, current audio dismissal and conflicts.
const profile = path.resolve('.test-artifacts', `shortcut-${Date.now()}`);
const env = { ...process.env, MEMEROOM_DISABLE_UPDATES:'1', MEMEROOM_PORT:'0', HOST:'127.0.0.1', MEMEROOM_ALLOW_MULTIPLE:'1', MEMEROOM_USER_DATA:profile };
delete env.ELECTRON_RUN_AS_NODE;
const wav = Buffer.alloc(44 + 16000 * 2 * 12);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const media = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type':'audio/wav', 'Content-Length':wav.length }); res.end(wav); });
await new Promise(resolve => media.listen(0, '127.0.0.1', resolve));
let app;
try {
  app = await electron.launch({ args:['.'], env, chromiumSandbox:true });
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100; i++) { page = app.windows().find(p => p.url() === 'http://localhost/remote'); if (page) break; await new Promise(r => setTimeout(r, 50)); }
  assert.ok(page); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await app.evaluate(({globalShortcut}) => {
    const register = globalShortcut.register.bind(globalShortcut);
    globalThis.shortcutCallbacks = new Map();
    globalShortcut.register = (value, callback) => { const result = register(value, callback); if (result) globalThis.shortcutCallbacks.set(value, callback); return result; };
  });
  await page.bringToFront(); await page.click('#open-settings'); await page.click('#dismiss-shortcut');
  await page.getByText('Appuyez sur les touches…', {exact:true}).waitFor();
  await page.keyboard.press('Control+Alt+F10');
  await page.waitForFunction(() => document.querySelector('#shortcut-hint').textContent.startsWith('Raccourci enregistré'));
  assert.equal(await app.evaluate(({globalShortcut}) => globalShortcut.isRegistered('Control+Alt+F10')), true);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'preferences.json'), 'utf8')).dismissShortcut, 'Control+Alt+F10');
  await page.evaluate(async server => {
    const id = 'A'.repeat(32);
    await window.memeroom.show({ server, id:'shortcut-test', caption:'À couper', duration:15, audio:{ id, kind:'audio', mime:'audio/wav', name:'test.wav', url:'/media/' + id }, sender:{ name:'Test' } });
  }, `http://127.0.0.1:${media.address().port}`);
  const overlay = app.windows().find(p => p.url().endsWith('/overlay.html'));
  await overlay.waitForFunction(() => document.querySelector('audio')?.currentTime > 0);
  await page.evaluate(() => window.memeroom.minimize());
  await app.evaluate(() => globalThis.shortcutCallbacks.get('Control+Alt+F10')());
  await overlay.waitForFunction(() => !document.querySelector('audio'));
  assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'MemeRoom Overlay').isVisible()), false);
  assert.equal(await page.evaluate(async () => (await window.memeroom.info()).settings.paused), false);
  assert.equal((await page.evaluate(() => window.memeroom.test())).shown, true);
  await app.evaluate(({globalShortcut}) => globalShortcut.register('Control+Alt+F11', () => {}));
  await assert.rejects(page.evaluate(() => window.memeroom.saveDismissShortcut('Control+Alt+F11')), /utilisé|indisponible/);
  assert.equal(await page.evaluate(async () => (await window.memeroom.info()).settings.dismissShortcut), 'Control+Alt+F10');
  await page.evaluate(() => window.memeroom.saveDismissShortcut(''));
  assert.equal(await app.evaluate(({globalShortcut}) => globalShortcut.isRegistered('Control+Alt+F10')), false);
  console.log('OK · Raccourci personnalisé enregistré ; image et audio interrompus sans pause ; conflits et désactivation pris en charge.');
} finally { await app?.close(); await new Promise(resolve => media.close(resolve)); }
