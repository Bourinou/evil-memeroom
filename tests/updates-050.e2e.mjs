import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const png = await readFile('public/icon.png');
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
  res.write(png.subarray(0, 12));
  setTimeout(() => res.end(png.subarray(12)), 2500);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const profile = path.resolve('.test-artifacts', `updates-050-${Date.now()}`);
const env = {
  ...process.env,
  MEMEROOM_USER_DATA: profile,
  MEMEROOM_ALLOW_MULTIPLE: '1',
  MEMEROOM_PORT: '0',
  HOST: '127.0.0.1',
  MEMEROOM_DISABLE_UPDATES: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({ args: ['.'], env, chromiumSandbox: true });
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((p) => p.url() === 'http://localhost/remote');
    if (page) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(page);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.bringToFront();
  assert.equal(await page.locator('#setting-own').count(), 0);
  await page.click('#open-settings');
  assert.equal(await page.inputValue('#setting-size'), '60');
  await page.screenshot({ path: '.test-artifacts/settings-050.png' });
  await page.mouse.click(8, 8);
  await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
  await page.fill('#caption', 'QUAND ÇA MARCHE');
  await page.click('#save-preset');
  await page.fill('#preset-name', 'Victoire');
  await page.click('#preset-submit');
  await page.waitForFunction(() => !document.querySelector('#preset-dialog').open);
  await page.click('#show-presets');
  await page.getByText('Victoire', { exact: true }).waitFor();
  await page.screenshot({ path: '.test-artifacts/presets-050.png' });
  const overlay = app.windows().find((p) => p.url().endsWith('/overlay.html'));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.evaluate(
    ({ url, bytes }) => {
      const id = 'A'.repeat(32);
      window.testShow = window.memeroom
        .show({
          id: 'slow-image',
          server: url,
          caption: 'ÇA VALAIT LE COUP D’ATTENDRE',
          sender: { name: 'Rose' },
          duration: 2,
          age: 8000,
          media: {
            id,
            url: '/media/' + id,
            name: 'test.png',
            bytes,
            kind: 'image',
            mime: 'image/png',
          },
        })
        .then((result) => (window.testResult = result));
    },
    { url, bytes: png.length },
  );
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'MemeRoom Overlay')
        .isVisible(),
    ),
    false,
  );
  await overlay.waitForFunction(() => document.querySelector('.reaction-view')?.hidden === false);
  assert.equal(await overlay.locator('.reaction-sender').textContent(), 'Rose');
  assert.equal(
    await overlay
      .locator('.reaction-caption')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await overlay.screenshot({ path: '.test-artifacts/overlay-050.png' });
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await overlay.locator('.reaction-view').count(), 1);
  await overlay.waitForFunction(() => !document.querySelector('.reaction-view'));
  assert.deepEqual(errors, []);
  console.log(
    'OK · Réglages fermés par clic extérieur, taille maximale, messages enregistrés, texte mème et compteur après téléchargement lent.',
  );
} finally {
  await app?.close();
  await new Promise((r) => server.close(r));
}
