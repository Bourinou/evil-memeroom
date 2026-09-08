import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createRoomServer } from '../server/index.mjs';
import { sha512 } from '../scripts/stage-releases.mjs';

const output = path.resolve('.test-artifacts', `distribution-${Date.now()}`);
await mkdir(output, { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const server = createRoomServer({ host: '127.0.0.1', port: 0, dataDir: null });
const address = await server.start(),
  base = `http://127.0.0.1:${address.port}`;
let app, corruptServer;
try {
  const env = { ...process.env, MEMEROOM_USER_DATA: path.join(output, 'browser') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: ['tests/distribution-harness.cjs'],
    env,
    chromiumSandbox: true,
  });
  const page = await app.firstWindow(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  assert.equal(await page.locator('#send-form').count(), 0);
  await page.waitForFunction(() => document.querySelector('#linux-download')?.hasAttribute('href'));
  for (const platform of ['windows', 'linux']) {
    assert.match(
      await page.locator(`#${platform}-info`).textContent(),
      new RegExp(version.replaceAll('.', '\\.')),
    );
    const url = await page.locator(`#${platform}-download`).getAttribute('href');
    assert.equal((await fetch(base + url, { method: 'HEAD' })).status, 200);
  }
  await page.screenshot({
    path: path.resolve('.test-artifacts/downloads-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: path.resolve('.test-artifacts/downloads-mobile.png'),
    fullPage: true,
  });
  console.log('OK · Page de téléchargement Windows/Linux, liens actifs, affichage mobile');
  const downloads = await (await fetch(base + '/api/downloads')).json();
  for (const platform of ['windows', 'linux']) {
    const result = await app.evaluate(
      (_electron, options) => global.runDistributionCheck(options),
      { platform, url: base + '/releases/', directory: path.join(output, platform) },
    );
    assert.equal(result.available, true);
    assert.equal(result.version, version);
    assert.equal(
      await sha512(result.files[0]),
      await sha512(path.resolve('.' + downloads[platform].url)),
    );
    const current = await app.evaluate(
      (_electron, options) => global.runDistributionCheck(options),
      {
        platform,
        version,
        url: base + '/releases/',
        directory: path.join(output, platform + '-current'),
      },
    );
    assert.equal(current.available, false);
    console.log(
      `OK · electron-updater ${platform} : version détectée, vrai binaire téléchargé et vérifié, version courante ignorée`,
    );
  }
  const corrupt = path.join(output, 'corrupt');
  await mkdir(corrupt);
  await copyFile('releases/latest.yml', path.join(corrupt, 'latest.yml'));
  await writeFile(path.join(corrupt, `MemeRoom-Setup-${version}.exe`), 'incomplete installer');
  corruptServer = createRoomServer({
    host: '127.0.0.1',
    port: 0,
    dataDir: null,
    releasesDir: corrupt,
  });
  const badAddress = await corruptServer.start();
  await assert.rejects(
    app.evaluate((_electron, options) => global.runDistributionCheck(options), {
      platform: 'windows',
      url: `http://127.0.0.1:${badAddress.port}/releases/`,
      directory: path.join(output, 'rejected'),
    }),
    /checksum mismatch/i,
  );
  console.log('OK · electron-updater refuse un fichier téléchargé corrompu');
  const startupEvent = app.waitForEvent('window');
  await app.evaluate(() => global.beginStartupWindowCheck());
  const startup = await startupEvent;
  await startup.waitForURL(/update\.html$/);
  await startup.screenshot({ path: path.resolve('.test-artifacts/update-startup.png') });
  await startup.click('#skip');
  for (let i = 0; i < 100; i++) {
    if (await app.evaluate(() => global.startupOutcome !== null)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(await app.evaluate(() => global.startupOutcome), { installed: false });
  await app.evaluate(() => global.finishStartupCheck({ isUpdateAvailable: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await app.evaluate(() => global.startupDownloads), 0);
  console.log('OK · Fenêtre de démarrage : ouvrir sans attendre, sans téléchargement tardif');
  assert.deepEqual(errors, []);
} finally {
  await app?.close();
  await server.stop();
  await corruptServer?.stop();
}
