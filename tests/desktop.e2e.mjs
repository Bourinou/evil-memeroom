import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const scenario = process.argv[2] || 'all';
if (!['all', 'appearance', 'playback', 'rooms'].includes(scenario))
  throw new Error('Scénario inconnu.');
const output = path.resolve('.test-artifacts');
await mkdir(output, { recursive: true });
const run = String(Date.now()),
  apps = new Set(),
  errors = [],
  results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (name) => {
  results.push(name);
  console.log(`OK · ${name}`);
};
const capture = async (page, name, options = {}) => {
  // Visual QA runs against source. Packaged checks focus on behavior, including hidden web windows.
  if (!process.env.MEMEROOM_TEST_EXE)
    await page.screenshot({ path: path.join(output, name), ...options });
};
async function launch(name, port = '0') {
  const profile = path.join(output, `${run}-${name}`);
  const env = {
    ...process.env,
    MEMEROOM_DISABLE_UPDATES: '1',
    MEMEROOM_PORT: String(port),
    HOST: '127.0.0.1',
    MEMEROOM_ALLOW_MULTIPLE: '1',
    MEMEROOM_USER_DATA: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.MEMEROOM_TEST_EXE;
  const app = await electron.launch({
    args: packaged ? [] : ['.'],
    ...(packaged ? { executablePath: path.resolve(packaged) } : {}),
    cwd: process.cwd(),
    env,
    chromiumSandbox: true,
  });
  apps.add(app);
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((value) => value.url().startsWith('http:'));
    if (page) break;
    await sleep(100);
  }
  assert.ok(page, 'The control window opens.');
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const overlay = app.windows().find((value) => value.url().endsWith('/overlay.html'));
  await page.evaluate(async () => {
    const info = await window.memeroom.info();
    await window.memeroom.saveSettings({ ...info.settings, cooldown: 3, volume: 27 });
  });
  const server = await page.evaluate(async () => (await window.memeroom.info()).server);
  assert.equal(page.url(), 'http://localhost/remote');
  return { app, page, overlay, profile, server };
}
async function close(instance) {
  await instance.app.close();
  apps.delete(instance.app);
}
async function overlayState(instance) {
  return instance.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (value) => value.getTitle() === 'MemeRoom Overlay',
    );
    return {
      visible: window.isVisible(),
      focused: window.isFocused(),
      focusable: typeof window.isFocusable === 'function' ? window.isFocusable() : null,
      top: window.isAlwaysOnTop(),
    };
  });
}
async function waitOverlay(instance, visible) {
  for (let i = 0; i < 60; i++) {
    if ((await overlayState(instance)).visible === visible) return;
    await sleep(70);
  }
  throw new Error(`Overlay did not become ${visible ? 'visible' : 'hidden'}.`);
}
async function assertCentered(instance) {
  const geometry = await instance.overlay.evaluate(() => {
    const boxes = [];
    const sender = document.querySelector('.reaction-sender');
    if (sender) boxes.push(sender.getBoundingClientRect());
    const caption = document.querySelector('.reaction-caption:not([hidden])');
    if (caption) boxes.push(caption.getBoundingClientRect());
    const media = document.querySelector('.reaction-media');
    if (media) {
      const rect = media.getBoundingClientRect();
      const naturalWidth = media.naturalWidth || media.videoWidth;
      const naturalHeight = media.naturalHeight || media.videoHeight;
      const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
      const width = naturalWidth * scale,
        height = naturalHeight * scale;
      const left = rect.x + (rect.width - width) / 2,
        top = rect.y + (rect.height - height) / 2;
      boxes.push({ left, top, right: left + width, bottom: top + height });
    }
    const left = Math.min(...boxes.map((b) => b.left)),
      right = Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top)),
      bottom = Math.max(...boxes.map((b) => b.bottom));
    return {
      dx: (left + right - innerWidth) / 2,
      dy: (top + bottom - innerHeight) / 2,
      inside: left >= 7 && top >= 7 && right <= innerWidth - 7 && bottom <= innerHeight - 7,
    };
  });
  assert.ok(
    Math.abs(geometry.dx) <= 1 && Math.abs(geometry.dy) <= 1 && geometry.inside,
    `Visible media and text centered together: ${JSON.stringify(geometry)}`,
  );
  const position = await instance.app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()
      .find((w) => w.getTitle() === 'MemeRoom Overlay')
      .getBounds();
    const screenBounds = screen.getPrimaryDisplay().bounds;
    return {
      dx: bounds.x + bounds.width / 2 - screenBounds.x - screenBounds.width / 2,
      dy: bounds.y + bounds.height / 2 - screenBounds.y - screenBounds.height / 2,
    };
  });
  assert.ok(
    Math.abs(position.dx) <= 1 && Math.abs(position.dy) <= 1,
    `Overlay centered on screen: ${JSON.stringify(position)}`,
  );
}
async function connected(page) {
  await page.waitForFunction(() =>
    document.querySelector('#connection-status').textContent.startsWith('Connecté'),
  );
}
async function send(page) {
  await sleep(3100);
  if (await page.locator('#duration').isVisible()) await page.selectOption('#duration', '2');
  await page.click('#broadcast');
}
async function upload(page, file, name) {
  await page
    .locator(/\.(wav|mp3|ogg)$/i.test(name) ? '#audio-input' : '#file-input')
    .setInputFiles(file);
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('.attachment strong')].some((el) => el.textContent === name) &&
      !document.querySelector('#attach-file').disabled,
    name,
  );
}
try {
  let alice = await launch('alice');
  // The controller must reload even when HTTP requests cannot reach a server.
  await alice.page.context().setOffline(true);
  await alice.page.reload();
  await alice.page.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal(await alice.page.locator('#send-form').isVisible(), true);
  await alice.page.context().setOffline(false);
  for (const route of ['/remote', '/desktop', '/index.html', '/app.mjs'])
    assert.equal((await fetch(alice.server + route)).status, 404);
  record(
    'Télécommande chargée et rechargée hors ligne dans l’application ; aucune route de contrôle exposée sur le serveur',
  );
  assert.equal(await alice.page.locator('.preset-art,.media-card').count(), 0);
  assert.equal(await alice.page.locator('#broadcast').isDisabled(), true);
  await capture(alice.page, 'simple-welcome.png', { fullPage: true });
  await alice.page.click('#add-room');
  await alice.page.fill('#nickname', 'Alice');
  await alice.page.fill('#new-room-name', 'Entre amis');
  await alice.page.selectOption('#room-visibility', 'public');
  await alice.page.fill('#room-password', 'first room password');
  await alice.page.click('#room-submit');
  await connected(alice.page);
  const disk = JSON.parse(await readFile(path.join(alice.profile, 'saved-rooms.json'), 'utf8'));
  const code = disk.active.code;
  assert.equal(disk.active.server, 'local');
  assert.equal(disk.rooms.length, 1);
  assert.ok(disk.rooms[0].ownerToken);
  assert.ok(disk.rooms[0].joinToken);
  assert.ok(!JSON.stringify(disk).includes('first room password'));
  record('Création d’une room publique protégée ; accès mémorisé sans mot de passe en clair');

  let bob = await launch('bob');
  await bob.page.click('#add-room');
  await bob.page.fill('#nickname', 'Bob');
  await bob.page.fill('#server-url', alice.server);
  await bob.page.click('#mode-browse');
  await bob.page.getByRole('button', { name: 'Rejoindre Entre amis', exact: true }).waitFor();
  await capture(bob.page, 'room-directory.png', { fullPage: true });
  await bob.page.getByRole('button', { name: 'Rejoindre Entre amis', exact: true }).click();
  await bob.page.fill('#room-password', 'wrong');
  await bob.page.click('#room-submit');
  await bob.page.waitForFunction(() =>
    document.querySelector('#room-error').textContent.includes('incorrect'),
  );
  await bob.page.fill('#room-password', 'first room password');
  await bob.page.click('#room-submit');
  await connected(bob.page);
  assert.equal(await bob.page.locator('#room-access').isHidden(), true);
  record('Liste des rooms, mauvais mot de passe refusé, puis connexion du participant');
  await alice.page.waitForFunction(() =>
    document.querySelector('#members').textContent.includes('Bob'),
  );

  const webEvent = alice.app.waitForEvent('window');
  await alice.app.evaluate(({ BrowserWindow }, url) => {
    const window = new BrowserWindow({
      width: 900,
      height: 780,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    window.loadURL(url);
  }, alice.server);
  const web = await webEvent;
  await web.waitForURL(/^http/);
  await web.locator('#windows-download').waitFor();
  web.on('pageerror', (error) => errors.push(error.message));
  assert.equal(await web.locator('#send-form').count(), 0);
  await alice.page.bringToFront();
  if (scenario === 'all' || scenario === 'appearance') {
    await alice.page.fill('#caption', 'Salut les amis');
    await send(alice.page);
    await waitOverlay(alice, true);
    await waitOverlay(bob, true);
    assert.equal(await bob.overlay.locator('.reaction-caption').textContent(), 'Salut les amis');
    assert.equal(await bob.overlay.locator('.reaction-sender').textContent(), 'Alice');
    assert.equal(
      await bob.overlay
        .locator('.reaction-sender')
        .evaluate(
          (el) =>
            el.getBoundingClientRect().bottom <=
            document.querySelector('.reaction-caption').getBoundingClientRect().top,
        ),
      true,
    );
    assert.equal(await bob.overlay.locator('.reaction-art').count(), 0);
    const captionStyle = await bob.overlay.locator('.reaction-caption').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        size: parseFloat(style.fontSize),
        expected: Math.min(54, Math.max(26, innerWidth * 0.04)),
        background: style.backgroundColor,
        color: style.color,
      };
    });
    assert.ok(
      Math.abs(captionStyle.size - captionStyle.expected) < 0.02,
      'La taille du texte reste adaptée à la largeur de l’overlay.',
    );
    assert.equal(captionStyle.background, 'rgba(0, 0, 0, 0)');
    assert.equal(captionStyle.color, 'rgb(255, 255, 255)');
    await assertCentered(bob);
    const state = await overlayState(bob);
    if (state.focusable !== null) assert.equal(state.focusable, false);
    if (process.platform === 'linux') {
      const windowId = await bob.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === 'MemeRoom Overlay')
          .getNativeWindowHandle()
          .readUInt32LE(),
      );
      // Electron implements focusable:false on X11 as an unmanaged window (WM_HINTS is absent).
      const attributes = execFileSync('xwininfo', ['-id', String(windowId)], { encoding: 'utf8' });
      assert.match(attributes, /Override Redirect State: yes/);
    }
    assert.equal(state.focused, false);
    assert.equal(state.top, true);
    await capture(bob.overlay, 'simple-overlay.png', { omitBackground: true });
    await waitOverlay(alice, false);
    await waitOverlay(bob, false);
    record(
      'Pseudo au-dessus du texte ; contenu centré et overlay passif ; site limité aux téléchargements',
    );

    await upload(alice.page, path.resolve('public/icon.png'), 'icon.png');
    await alice.page.fill('#caption', '<img src=x onerror=alert(1)>');
    await send(alice.page);
    await waitOverlay(bob, true);
    assert.equal(
      await bob.overlay.locator('.reaction-caption').textContent(),
      '<img src=x onerror=alert(1)>',
    );
    assert.equal(await bob.overlay.locator('.reaction-caption img').count(), 0);
    await bob.overlay.waitForFunction(
      () => document.querySelector('img.reaction-media')?.naturalWidth > 0,
    );
    await assertCentered(bob);
    await waitOverlay(bob, false);
    record('Image avec texte et protection contre le HTML injecté');

    await alice.page.fill('#caption', 'À tout de suite');
    await capture(alice.page, 'simple-room.png', { fullPage: true });
    await web.reload();
    await web.locator('#windows-download').waitFor();
    assert.equal(await web.locator('#send-form').count(), 0);
    await web.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await web.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await capture(web, 'simple-mobile.png', { fullPage: true });
    record('Page de téléchargement utilisable sur mobile, sans télécommande');
  }
  if (scenario === 'all' || scenario === 'playback') {
    const wav = Buffer.alloc(44 + 16000 * 2 * 3);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    const audioFile = path.join(output, 'test-audio.wav');
    await writeFile(audioFile, wav);
    if (await alice.page.getByRole('button', { name: 'Retirer icon.png', exact: true }).count())
      await alice.page.getByRole('button', { name: 'Retirer icon.png', exact: true }).click();
    await alice.page.fill('#caption', '');
    await upload(alice.page, audioFile, 'test-audio.wav');
    await send(alice.page);
    await waitOverlay(bob, true);
    assert.equal(await alice.page.locator('#duration').isHidden(), true);
    assert.equal(await alice.page.locator('#automatic-duration').isVisible(), true);
    await bob.overlay.waitForFunction(() => document.querySelector('audio')?.currentTime > 2.2);
    assert.equal((await overlayState(bob)).visible, true);
    await waitOverlay(bob, false);
    record('Audio seul : lecture au-delà de la durée manuelle, puis disparition à sa fin');
    await send(alice.page);
    await waitOverlay(bob, true);
    await bob.overlay.waitForFunction(() => document.querySelector('audio')?.currentTime > 0);
    assert.equal(await bob.overlay.locator('.reaction-sender').textContent(), 'Alice');
    assert.equal(await bob.overlay.locator('.reaction-art').count(), 0);
    assert.equal(await bob.overlay.locator('.reaction-caption').isHidden(), true);
    await bob.page.click('#pause-reception');
    await waitOverlay(bob, false);
    assert.equal(await bob.overlay.locator('audio').count(), 0);
    await bob.page.click('#pause-reception');
    record('Audio seul sans image imposée ; la pause interrompt immédiatement le son');

    const videoFile = path.join(output, 'test-video.webm');
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x180:rate=15',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=16000:cl=mono',
        '-t',
        '2',
        '-c:v',
        'libvpx',
        '-b:v',
        '200k',
        '-c:a',
        'libopus',
        videoFile,
      ],
      { windowsHide: true },
    );
    await upload(alice.page, videoFile, 'test-video.webm');
    await alice.page
      .locator('#subtitle-input')
      .setInputFiles({
        name: 'test.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nSous-titre de test'),
      });
    await alice.page.waitForFunction(() =>
      document.querySelector('#subtitle-label').textContent.startsWith('1'),
    );
    await send(alice.page);
    await waitOverlay(bob, true);
    await bob.overlay.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.videoWidth === 320 && video.currentTime > 0;
    });
    assert.equal(
      await bob.overlay.locator('.reaction-caption').textContent(),
      'Sous-titre de test',
    );
    assert.equal(await bob.overlay.locator('audio').evaluate((value) => value.volume), 0.27);
    assert.equal(await bob.overlay.locator('video').evaluate((value) => value.muted), true);
    assert.equal(await alice.page.locator('#audio-replacement').isVisible(), true);
    await bob.page.evaluate(async () => {
      const info = await window.memeroom.info();
      await window.memeroom.saveSettings({ ...info.settings, volume: 43 });
    });
    await bob.overlay.waitForFunction(
      () =>
        document.querySelector('audio')?.volume === 0.43 &&
        document.querySelector('video')?.muted === true,
    );
    await assertCentered(bob);
    await capture(bob.overlay, 'centered-video.png', { omitBackground: true });
    await bob.overlay.waitForFunction(
      () => document.querySelector('video')?.ended && !document.querySelector('audio')?.ended,
    );
    assert.equal((await overlayState(bob)).visible, true);
    await waitOverlay(bob, false);
    record('Vidéo, piste audio supplémentaire, sous-titres et volume conservés');
    await bob.page.evaluate(async () => {
      const info = await window.memeroom.info();
      await window.memeroom.saveSettings({ ...info.settings, volume: 27 });
    });

    await alice.page.click('#preview-play');
    await alice.page.waitForFunction(
      () =>
        document.querySelector('#large-preview video')?.muted === true &&
        document.querySelector('#large-preview audio')?.muted === false,
    );
    await alice.page.waitForFunction(
      () =>
        document.querySelector('#large-preview video')?.ended &&
        !document.querySelector('#large-preview audio')?.ended,
    );
    assert.equal(await alice.page.locator('#preview-dialog').isVisible(), true);
    await alice.page.locator('#preview-dialog').waitFor({ state: 'hidden' });
    record('Aperçu : l’audio plus long conserve la vidéo et le texte jusqu’à sa fin');

    const longVideo = path.join(output, 'long-video.webm');
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:size=160x90:rate=5',
        '-t',
        '32',
        '-an',
        '-c:v',
        'libvpx',
        '-b:v',
        '40k',
        longVideo,
      ],
      { windowsHide: true },
    );
    await upload(alice.page, longVideo, 'long-video.webm');
    await alice.page
      .locator('#subtitle-input')
      .setInputFiles({
        name: 'long.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('1\n00:00:16,000 --> 00:00:19,000\nAprès quinze secondes'),
      });
    await send(alice.page);
    await waitOverlay(bob, true);
    await bob.overlay.waitForFunction(
      () =>
        document.querySelector('audio')?.ended && document.querySelector('video')?.currentTime > 3,
    );
    assert.equal((await overlayState(bob)).visible, true);
    await bob.overlay.waitForFunction(
      () => document.querySelector('.reaction-caption')?.textContent === 'Après quinze secondes',
    );
    await bob.overlay.waitForFunction(
      () => document.querySelector('video')?.currentTime > 30.5,
      {},
      { timeout: 40000 },
    );
    assert.equal((await overlayState(bob)).visible, true);
    await waitOverlay(bob, false);
    record(
      'Vidéo de 32 secondes : aucun arrêt à 15 ou 30 secondes, sous-titres tardifs, attente du média le plus long',
    );

    await alice.page.getByRole('button', { name: 'Retirer test-audio.wav', exact: true }).click();
    const shortVideo = path.join(output, 'short-video.webm');
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=green:size=160x90:rate=10',
        '-t',
        '0.6',
        '-an',
        '-c:v',
        'libvpx',
        '-b:v',
        '40k',
        shortVideo,
      ],
      { windowsHide: true },
    );
    await upload(alice.page, shortVideo, 'short-video.webm');
    await send(alice.page);
    await waitOverlay(bob, true);
    assert.equal(await bob.overlay.locator('video').evaluate((value) => value.muted), false);
    const shortStarted = Date.now();
    await waitOverlay(bob, false);
    assert.ok(
      Date.now() - shortStarted < 1800,
      'A subsecond video must not wait for the two-second manual minimum.',
    );
    await alice.page.getByRole('button', { name: 'Retirer short-video.webm', exact: true }).click();
    assert.equal(await alice.page.locator('#duration').isVisible(), true);
    if (!(await alice.page.locator('#existing-media').isVisible()))
      await alice.page.locator('summary').click();
    await alice.page.selectOption(
      '#existing-media',
      await alice.page
        .locator('#existing-media option')
        .filter({ hasText: 'short-video.webm' })
        .getAttribute('value'),
    );
    assert.equal(await alice.page.locator('#automatic-duration').isVisible(), true);
    record(
      'Vidéo de moins d’une seconde et bibliothèque : durée automatique ; retrait du média : durée manuelle restaurée',
    );
  }
  if (scenario === 'all' || scenario === 'rooms') {
    await alice.page.click('#room-access');
    await alice.page.selectOption('#access-visibility', 'private');
    await alice.page.click('#access-submit');
    await alice.page.locator('#access-dialog').waitFor({ state: 'hidden' });
    const directory = await (await fetch(new URL('/api/rooms', alice.server))).json();
    assert.ok(!directory.rooms.some((room) => room.code === code));
    await alice.page.click('#room-access');
    await alice.page.selectOption('#access-password-action', 'set');
    await alice.page.fill('#access-password', 'changed room password');
    await alice.page.click('#access-submit');
    await alice.page.locator('#access-dialog').waitFor({ state: 'hidden' });
    await bob.page.locator('#password-dialog').waitFor({ state: 'visible' });
    await bob.page.fill('#saved-room-password', 'changed room password');
    await bob.page.click('#password-submit');
    await connected(bob.page);
    await bob.page.locator('#password-dialog').waitFor({ state: 'hidden' });
    const protectedProfile = await readFile(path.join(bob.profile, 'saved-rooms.json'), 'utf8');
    assert.ok(!protectedProfile.includes('changed room password'));
    record('Gestionnaire : room rendue privée, mot de passe changé, participant réauthentifié');

    await close(bob);
    bob = await launch('bob');
    await connected(bob.page);
    assert.ok((await bob.page.locator('#copy-code').textContent()).includes(code));
    assert.ok((await bob.page.locator('#members').textContent()).includes('Bob'));
    record(
      'Fermeture et relance du participant : room, serveur et pseudo retrouvés automatiquement',
    );
    const hostPort = new URL(alice.server).port;
    await close(alice);
    await bob.page.waitForFunction(() =>
      document.querySelector('#connection-status').textContent.includes('Reconnexion'),
    );
    alice = await launch('alice', hostPort);
    await connected(alice.page);
    await connected(bob.page);
    assert.ok((await bob.page.locator('#copy-code').textContent()).includes(code));
    record(
      'Serveur arrêté puis redémarré : le participant resté ouvert rejoint automatiquement la même room',
    );
    await close(bob);
    await close(alice);
    alice = await launch('alice');
    await connected(alice.page);
    assert.ok((await alice.page.locator('#copy-code').textContent()).includes(code));
    assert.equal(await alice.page.locator('#saved-room option').count(), 2);
    record(
      'Redémarrage complet du PC hôte simulé : même room, même code, reconnexion automatique même sur un autre port local',
    );

    await alice.page.click('#leave-room');
    await alice.page.waitForFunction(
      async () => (await window.memeroom.info()).clientState.active === null,
    );
    await close(alice);
    alice = await launch('alice');
    assert.equal(
      await alice.page.locator('#connection-status').textContent(),
      'Aucune room sélectionnée.',
    );
    await alice.page.selectOption('#saved-room', `local|${code}`);
    await connected(alice.page);
    record('Quitter suspend la reconnexion ; la room reste disponible en un clic');
  }
  assert.deepEqual(errors, []);
  const { version } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  await writeFile(
    path.join(output, `desktop-${scenario}-results.json`),
    JSON.stringify({ version, passed: results, date: new Date().toISOString() }, null, 2),
  );
} catch (error) {
  console.error(error);
  let failureIndex = 0;
  for (const app of apps)
    try {
      const page = app.windows().find((value) => value.url() === 'http://localhost/remote');
      console.log(
        'UI:',
        await page.evaluate(() => ({
          caption: document.querySelector('#caption').value,
          connection: document.querySelector('#connection-status').textContent,
          send: document.querySelector('#send-status').textContent,
          disabled: document.querySelector('#broadcast').disabled,
          toast: document.querySelector('#toast').textContent,
        })),
      );
      await page.screenshot({ path: path.join(output, `failure-${failureIndex++}.png`) });
    } catch {}
  process.exitCode = 1;
} finally {
  for (const app of apps) await app.close().catch(() => {});
}
