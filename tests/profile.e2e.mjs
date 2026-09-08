import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const profile = path.resolve('.test-artifacts', `profile-upgrade-${Date.now()}`);
await mkdir(profile, { recursive: true });
const env = {
  ...process.env,
  MEMEROOM_USER_DATA: profile,
  MEMEROOM_PORT: '0',
  HOST: '127.0.0.1',
  MEMEROOM_ALLOW_MULTIPLE: '1',
  MEMEROOM_DISABLE_UPDATES: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
async function launch(executablePath) {
  const app = await electron.launch({
    args: executablePath ? [] : ['.'],
    ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}),
    env,
    chromiumSandbox: true,
  });
  await app.firstWindow();
  let page;
  for (let index = 0; index < 100; index++) {
    page = app.windows().find((window) => window.url().startsWith('http:'));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(page);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  return { app, page, version: await app.evaluate(({ app }) => app.getVersion()) };
}
let instance;
try {
  instance = await launch(process.env.MEMEROOM_PREVIOUS_EXE);
  const previous = instance.version;
  await instance.page.click('#add-room');
  await instance.page.fill('#nickname', 'Profil conservé');
  await instance.page.fill('#new-room-name', 'Avant refonte');
  await instance.page.click('#room-submit');
  await instance.page.waitForFunction(() =>
    document.querySelector('#connection-status').textContent.includes('Connecté'),
  );
  await instance.page.setInputFiles('#file-input', 'public/icon.png');
  await instance.page.waitForFunction(
    () => document.querySelector('#attachments').children.length === 1,
  );
  await instance.page.fill('#caption', 'Message conservé');
  await instance.page.click('#save-preset');
  await instance.page.fill('#preset-name', 'Avant mise à jour');
  await instance.page.click('#preset-submit');
  await instance.page.waitForFunction(() => !document.querySelector('#preset-dialog').open);
  await instance.page.evaluate(async () => {
    const info = await window.memeroom.info();
    await window.memeroom.saveSettings({ ...info.settings, volume: 31, size: 42, cooldown: 7 });
  });
  const before = await instance.page.evaluate(() => window.memeroom.info());
  await instance.app.close();
  instance = null;
  const roomsBefore = await readFile(path.join(profile, 'saved-rooms.json'), 'utf8');
  instance = await launch(process.env.MEMEROOM_TEST_EXE);
  await instance.page.waitForFunction(() =>
    document.querySelector('#connection-status').textContent.includes('Connecté'),
  );
  const after = await instance.page.evaluate(() => window.memeroom.info());
  assert.equal(after.settings.volume, 31);
  assert.equal(after.settings.size, 42);
  assert.equal(after.settings.cooldown, 7);
  const stableClient = (value) => {
    const result = structuredClone(value);
    for (const room of result.rooms) delete room.joinToken;
    return result;
  };
  assert.deepEqual(stableClient(after.clientState), stableClient(before.clientState));
  assert.equal(await instance.page.locator('#room-access').isVisible(), true);
  await instance.page.click('#show-presets');
  await instance.page.getByRole('button', { name: 'Charger', exact: true }).click();
  await instance.page.waitForFunction(
    () =>
      !document.querySelector('#send-form').hidden &&
      document.querySelector('#attachments').children.length === 1,
  );
  assert.equal(await instance.page.inputValue('#caption'), 'Message conservé');
  await instance.page.click('#broadcast');
  await instance.page.waitForFunction(
    () => document.querySelector('#toast').textContent === 'Envoyé.',
  );
  assert.deepEqual(errors, []);
  const report = {
    previous,
    current: instance.version,
    roomCount: after.clientState.rooms.length,
    passed: [
      'réglages',
      'pseudo',
      'room persistante',
      'code et droits du gestionnaire',
      'reconnexion',
      'message enregistré avec image',
      'réimport et diffusion',
    ],
    previousRoomStateBytes: Buffer.byteLength(roomsBefore),
  };
  await writeFile(path.join(profile, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await instance?.app.close();
}
