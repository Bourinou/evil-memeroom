const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, session, dialog, shell } = require('electron');

if (
  process.platform === 'linux' &&
  !process.env.MEMEROOM_USER_DATA &&
  (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland') &&
  !process.argv.some(arg => arg.startsWith('--ozone-platform='))
) {
  const { spawn } = require('node:child_process');
  const args = process.defaultApp
    ? ['--ozone-platform=x11', process.argv[1] || '.', ...process.argv.slice(2)]
    : ['--ozone-platform=x11', ...process.argv.slice(1)];
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_OZONE_PLATFORM_HINT: 'x11' }
  });
  child.on('close', code => process.exit(code || 0));
  return;
}

const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { CONTROL_URL, installControlPage } = require('./control-page.cjs');
const { downloadAsset, uploadAsset } = require('./media-files.cjs');
const { createSavedMemes } = require('./saved-memes.cjs');
const { createMediaTools, createPathAllowlist } = require('./media-tools.cjs');
const { createOverlayLayer } = require('./overlay-layer.cjs');
const {
  migrateMemesDir,
  migrateUserData,
  migrateUserDataHashes,
  cleanupLegacyFolders
} = require('./migration.cjs');

migrateMemesDir();
const MEMEROOM_DIR = path.join(os.homedir(), 'evil-memeroom');
fs.mkdir(MEMEROOM_DIR, { recursive: true }).catch(() => {});

const savedMemes = createSavedMemes({ memesDir: MEMEROOM_DIR, hashCachePath: () => path.join(app.getPath('userData'), 'hashes.json') });
const pickedFiles = createPathAllowlist();
const mediaTools = createMediaTools({ isPackaged: app.isPackaged, downloadAsset, uploadAsset, savedMemePath: savedMemes.pathFor, isAllowedPath: pickedFiles.has });

// Overlay placement and always-on-top windows require X11, including through XWayland.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11');
app.name = 'evil-memeroom';

if (process.env.MEMEROOM_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.MEMEROOM_USER_DATA));
} else {
  migrateUserData(app.getPath('appData'), app.name);
  cleanupLegacyFolders();
}
migrateUserDataHashes(app.getPath('userData'));
const singleInstance = process.env.MEMEROOM_ALLOW_MULTIPLE === '1' || app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
  return;
}
let control, overlay, tray, localServer, baseUrl, settings, clientState, protocol, quitting = false, hideTimer, lastShown = 0, generation = 0;
const seen = new Set();
let dismissShortcut = '', shortcutError = '', shortcutCaptureTimer;
let playbackAbort, playbackDirectory, overlayLayer;
let playbackAutomatic = false, playbackDuration = 0;
function finishShortcutCapture() { clearTimeout(shortcutCaptureTimer); globalShortcut.setSuspended(false); }
function bindDismissShortcut(value) {
  if (value === dismissShortcut) { shortcutError = ''; return; }
  // Register the replacement before releasing the previous working shortcut.
  if (value && !globalShortcut.register(value, clearOverlay)) throw new Error('Ce raccourci est déjà utilisé ou indisponible. Choisissez une autre combinaison.');
  if (dismissShortcut) globalShortcut.unregister(dismissShortcut);
  dismissShortcut = value; shortcutError = '';
}
const settingsPath = () => path.join(app.getPath('userData'), 'preferences.json');
async function removeStaleTempDirs() {
  const prefixes = ['evil-memeroom-playback-', 'evil-audio-', 'evil-trim-'];
  const tmp = os.tmpdir();
  try {
    for (const name of await fs.readdir(tmp)) {
      if (!prefixes.some(prefix => name.startsWith(prefix))) continue;
      const target = path.join(tmp, name);
      const stat = await fs.stat(target).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 24 * 3600 * 1000) await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    }
  } catch {}
}
const clientPath = () => path.join(app.getPath('userData'), 'saved-rooms.json');
const historyPath = () => path.join(app.getPath('userData'), 'history.json');
const trustedControl = event => control && event.sender === control.webContents && event.senderFrame === control.webContents.mainFrame && event.senderFrame.url === CONTROL_URL;
const trustedOverlay = event => overlay && event.sender === overlay.webContents && event.senderFrame === overlay.webContents.mainFrame;
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
function clearOverlay() {
  generation++; clearTimeout(hideTimer); currentOverlayContentSize = null;
  playbackAbort?.abort(); playbackAbort = null;
  if (playbackDirectory) { const directory = playbackDirectory; playbackDirectory = null; void fs.rm(directory, { recursive:true, force:true, maxRetries:3, retryDelay:100 }).catch(() => {}); }
  if (overlay && !overlay.isDestroyed()) { overlay.webContents.send('overlay:clear'); overlayLayer?.hide(); }
}
function sendSettings() { if (control && !control.isDestroyed()) control.webContents.send('settings:changed', settings); }
let saving = Promise.resolve();
let clientSaving = Promise.resolve();
let historySaving = Promise.resolve();
async function saveClient(value) {
  clientState = protocol.cleanClientState(value);
  const snapshot = JSON.stringify(clientState, null, 2);
  clientSaving = clientSaving.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(clientPath()), { recursive: true });
    await fs.writeFile(clientPath() + '.tmp', snapshot, { mode: 0o600 });
    await fs.rename(clientPath() + '.tmp', clientPath());
  });
  await clientSaving;
  return clientState;
}
async function loadHistoryFile() {
  try {
    const raw = await fs.readFile(historyPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function saveHistoryFile(list) {
  const clean = Array.isArray(list) ? list.slice(0, 200) : [];
  const snapshot = JSON.stringify(clean, null, 2);
  historySaving = historySaving.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(historyPath()), { recursive: true });
    await fs.writeFile(historyPath() + '.tmp', snapshot, { mode: 0o600 });
    await fs.rename(historyPath() + '.tmp', historyPath());
  });
  await historySaving;
  return clean;
}
async function applyAutoStart(enabled) {
  if (!app.isPackaged) return;
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true,
        args: ['--hidden']
      });
    } else if (process.platform === 'linux') {
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true,
          args: ['--hidden']
        });
      } catch {}
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopFilePath = path.join(autostartDir, 'evil-memeroom.desktop');
      if (enabled) {
        const execPath = process.env.APPIMAGE || process.execPath;
        const desktopContent = [
          '[Desktop Entry]',
          'Type=Application',
          'Version=1.0',
          'Name=evil memeroom',
          'Comment=Des réactions en direct, par-dessus votre écran.',
          `Exec="${execPath}" --ozone-platform=x11 --hidden`,
          'StartupNotify=false',
          'Terminal=false',
          'Icon=evil-memeroom'
        ].join('\n') + '\n';
        await fs.mkdir(autostartDir, { recursive: true });
        await fs.writeFile(desktopFilePath, desktopContent, 'utf8');
        await fs.rm(path.join(autostartDir, 'memeroom.desktop'), { force: true }).catch(() => {});
      } else {
        await fs.rm(desktopFilePath, { force: true });
        await fs.rm(path.join(autostartDir, 'memeroom.desktop'), { force: true }).catch(() => {});
      }
    }
  } catch (error) {
    console.warn('Configuration du démarrage automatique impossible :', error.message);
  }
}

async function saveSettings(value, applyShortcut = false) {
  if (value.dismissShortcut !== undefined && !protocol.validDismissShortcut(value.dismissShortcut)) throw new Error('Raccourci invalide. Ctrl + Maj + F8 est réservé à la pause.');
  const next = protocol.cleanSettings(value);
  if (applyShortcut || next.dismissShortcut !== settings.dismissShortcut) { finishShortcutCapture(); bindDismissShortcut(next.dismissShortcut); }
  settings = next;
  if (settings.paused) clearOverlay();
  else if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:volume', settings.volume);
  const snapshot = JSON.stringify(settings, null, 2);
  saving = saving.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(settingsPath()), { recursive: true }); await fs.writeFile(settingsPath() + '.tmp', snapshot); await fs.rename(settingsPath() + '.tmp', settingsPath()); });
  sendSettings(); updateTray(); await saving;
  return settings;
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(settings.paused ? 'evil memeroom · réception en pause' : 'evil memeroom · réception active');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir evil memeroom', click: () => { control.show(); control.focus(); } },
    { label: settings.paused ? 'Reprendre la réception' : 'Mettre en pause', click: () => saveSettings({ ...settings, paused: !settings.paused }).catch(() => {}) },
    { type: 'separator' }, { label: 'Quitter evil memeroom', click: () => { quitting = true; app.quit(); } }
  ]));
}
let currentOverlayContentSize = null;
function positionOverlay(contentSize) {
  if (contentSize !== undefined) currentOverlayContentSize = contentSize;
  const display = screen.getAllDisplays().find(d => String(d.id) === settings.display) || screen.getPrimaryDisplay();
  const area = settings.position === 'center' ? display.bounds : display.workArea;
  const maxWidth = Math.round(area.width * settings.size / 100);
  const maxHeight = area.height - 48;
  let width = maxWidth, height = maxHeight;
  if (currentOverlayContentSize && Number.isFinite(currentOverlayContentSize.width) && Number.isFinite(currentOverlayContentSize.height) && currentOverlayContentSize.width > 0 && currentOverlayContentSize.height > 0) {
    width = Math.min(maxWidth, Math.max(80, Math.ceil(currentOverlayContentSize.width) + 16));
    height = Math.min(maxHeight, Math.max(40, Math.ceil(currentOverlayContentSize.height) + 16));
  }
  let x = area.x + area.width - width - 24, y = area.y + area.height - height - 24;
  if (settings.position === 'bottom-left') x = area.x + 24;
  if (settings.position === 'top-right') y = area.y + 24;
  if (settings.position === 'center') { x = area.x + Math.round((area.width - width) / 2); y = area.y + Math.round((area.height - height) / 2); }
  overlay.setBounds({ x, y, width, height });
}
async function displayReaction(payload, test = false) {
  if (settings.paused) return { shown: false, reason: 'paused' };
  const now = Date.now();
  if (!test && (now - lastShown < settings.cooldown * 1000 || seen.has(payload?.id))) return { shown: false, reason: 'cooldown' };
  if (!payload || typeof payload !== 'object') throw new Error('Réaction invalide.');
  const server = protocol.normalizeServer(payload.server);
  const media = new Map();
  for (const item of [payload.media, payload.audio].filter(Boolean)) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(item.id) || item.url !== `/media/${item.id}` || !['image','video','audio'].includes(item.kind)) throw new Error('Média invalide.');
    media.set(item.id, { ...item, name: protocol.cleanText(item.name, 80) });
  }
  protocol.applyReactionMeta(payload);
  const reaction = protocol.validateReaction({ ...payload, mediaId: payload.media?.id, audioId: payload.audio?.id }, media);
  const automatic = protocol.hasTimedMedia(reaction) && !reaction.customDuration && reaction.durationMode !== 'fixed';
  const delay = Number.isFinite(payload.delay) ? Math.max(0, Math.min(payload.delay, 1000)) : 0;
  lastShown = now;
  if (typeof payload.id === 'string') { seen.add(payload.id.slice(0,80)); if (seen.size > 100) seen.delete(seen.values().next().value); }
  clearOverlay(); const currentGeneration = generation;
  const abort = new AbortController(); playbackAbort = abort;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  if (generation !== currentGeneration || settings.paused) return { shown: false, reason: 'cancelled' };
  let directory;
  try {
    if (reaction.media || reaction.audio) {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evil-memeroom-playback-'));
      if (generation !== currentGeneration || abort.signal.aborted) throw new Error('cancelled');
      playbackDirectory = directory;
      for (const key of ['media','audio']) if (reaction[key]) {
        const file = path.join(directory, key);
        await downloadAsset(reaction[key], server, file, abort.signal);
        reaction[key].playbackURL = pathToFileURL(file).href;
        const assetName = reaction[key].name || `${key}_${reaction[key].id}`;
        const isSilentAudio = key === 'audio' && (assetName === 'silent_audio.wav' || assetName.startsWith('silent_'));
        if (settings.saveReceived !== false && !isSilentAudio) {
          try {
            const saveRes = await savedMemes.save(file, assetName);
            // Tell the control page which asset became which saved file (also for a duplicate).
            if (saveRes?.name && control && !control.isDestroyed()) {
              control.webContents.send('savedMemes:updated', { id: reaction[key].id, name: saveRes.name });
            }
          } catch (e) {
            console.error('Erreur sauvegarde mème:', e);
          }
        }
      }
    }
    if (generation !== currentGeneration || settings.paused) return { shown:false, reason:'cancelled' };
    positionOverlay(); playbackAutomatic = automatic; playbackDuration = reaction.duration;
    overlay.webContents.send('overlay:show', { ...reaction, server, playbackId:currentGeneration, volume:settings.volume, sender:protocol.cleanText(payload.sender?.name,24) });
    hideTimer = setTimeout(clearOverlay, 65000);
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive:true, force:true, maxRetries:3, retryDelay:100 }).catch(() => {});
    if (abort.signal.aborted || generation !== currentGeneration) return { shown:false, reason:'cancelled' };
    clearOverlay(); throw error;
  }
  return { shown: true };
}

if (singleInstance) app.whenReady().then(async () => {
  const isHiddenLaunch = process.argv.includes('--hidden') || process.argv.includes('--silent') || (app.isPackaged && Boolean(app.getLoginItemSettings?.().wasOpenedAsHidden));
  const { checkStartupUpdate } = require('./update-window.cjs');
  const startupUpdate = await checkStartupUpdate({ app, BrowserWindow, ipcMain, hidden: isHiddenLaunch });
  if (startupUpdate.installed) return;
  protocol = await import(pathToFileURL(path.join(__dirname, '../shared/protocol.mjs')).href);
  try {
    settings = protocol.cleanSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf8')));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Fichier preferences.json corrompu ou illisible, réinitialisation à zéro :', error?.message);
      await fs.rm(settingsPath(), { force: true }).catch(() => {});
    }
    settings = { ...protocol.DEFAULT_SETTINGS };
  }
  void applyAutoStart(settings.autoStart !== false);
  try {
    clientState = protocol.cleanClientState(JSON.parse(await fs.readFile(clientPath(), 'utf8')));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Fichier saved-rooms.json corrompu ou illisible, réinitialisation à zéro :', error?.message);
      await fs.rm(clientPath(), { force: true }).catch(() => {});
    }
    clientState = null;
  }
  void removeStaleTempDirs();
  const { createRoomServer } = await import(pathToFileURL(path.join(__dirname, '../server/index.mjs')).href);
  const dataDir = path.join(app.getPath('userData'), 'server');
  localServer = createRoomServer({ host: process.env.HOST || '0.0.0.0', port: Number(process.env.MEMEROOM_PORT || 3210), dataDir });
  let address;
  try {
    address = await localServer.start();
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      await localServer.stop();
      localServer = createRoomServer({ host: process.env.HOST || '0.0.0.0', port: 0, dataDir });
      address = await localServer.start();
    } else {
      const serverRoomsPath = path.join(dataDir, 'rooms.json');
      // Invalid syntax (unreadable) or invalid content (server throws a plain Error without a system code).
      let corrupt = false;
      try {
        JSON.parse(await fs.readFile(serverRoomsPath, 'utf8'));
        corrupt = !error.code;
      } catch (err) {
        if (err.code !== 'ENOENT') corrupt = true;
      }
      if (corrupt) {
        console.warn('Fichier server/rooms.json corrompu ou invalide, mis de côté :', error.message);
        await fs.rename(serverRoomsPath, `${serverRoomsPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        localServer = createRoomServer({ host: process.env.HOST || '0.0.0.0', port: Number(process.env.MEMEROOM_PORT || 3210), dataDir });
        address = await localServer.start();
      } else {
        throw error;
      }
    }
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  const controlSession = session.fromPartition('persist:evil-memeroom-control');
  installControlPage(controlSession);
  for (const currentSession of [session.defaultSession, controlSession]) {
    currentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    currentSession.setPermissionCheckHandler(() => false);
    currentSession.on('will-download', event => event.preventDefault());
  }
  const icon = nativeImage.createFromPath(path.join(__dirname, '../public/icon-linux.png'));
  const windowIcon = icon;
  Menu.setApplicationMenu(null);
  control = new BrowserWindow({ title: 'evil memeroom', width: 860, height: 780, minWidth: 540, minHeight: 620, show: !isHiddenLaunch, backgroundColor: '#0b0d10', autoHideMenuBar: true, icon: windowIcon, webPreferences: { session: controlSession, preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  control.removeMenu();
  overlay = new BrowserWindow({ title: 'evil memeroom Overlay', width: 520, height: 420, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, webPreferences: { preload: path.join(__dirname, 'overlay-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  overlayLayer = createOverlayLayer(overlay);
  secureWindow(control); secureWindow(overlay);
  ipcMain.handle('app:info', async event => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const addresses = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${address.port}`);
    const history = await loadHistoryFile();
    return { settings, clientState, history, shortcutError, platform: process.platform, server: baseUrl, addresses, displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || `Écran ${i + 1} · ${d.size.width} × ${d.size.height}` })) };
  });
  ipcMain.handle('client:save', (event, value) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return saveClient(value); });
  ipcMain.handle('savedMemes:list', event => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return savedMemes.list(); });
  ipcMain.handle('savedMemes:openFolder', async event => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    await fs.mkdir(MEMEROOM_DIR, { recursive: true });
    return shell.openPath(MEMEROOM_DIR);
  });
  ipcMain.handle('savedMemes:rename', async (event, oldName, newName) => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const name = await savedMemes.rename(oldName, newName);
    if (control && !control.isDestroyed()) control.webContents.send('savedMemes:updated');
    return name;
  });
  ipcMain.handle('savedMemes:delete', async (event, name) => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    await savedMemes.remove(name);
    if (control && !control.isDestroyed()) control.webContents.send('savedMemes:updated');
    return true;
  });
  ipcMain.handle('savedMemes:read', (event, name) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return savedMemes.read(name); });
  ipcMain.on('media:allowPath', (event, file) => { if (trustedControl(event)) pickedFiles.allow(file); });
  ipcMain.handle('media:extractAudio', (event, options) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return mediaTools.extractAudio(options); });
  // Media never crosses IPC: the renderer names a source (server asset, saved meme or dropped file path); the main process downloads, runs ffmpeg and imports the result.
  ipcMain.handle('media:trim', (event, options) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return mediaTools.trim(options); });
  ipcMain.handle('savedMemes:upload', (event, options) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return mediaTools.uploadSavedMeme(options); });
  ipcMain.handle('settings:save', (event, value) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return saveSettings(value); });
  ipcMain.handle('shortcut:save', (event, value) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return saveSettings({ ...settings, dismissShortcut: value }, true); });
  ipcMain.handle('shortcut:record', (event, active) => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    finishShortcutCapture();
    if (active === true && control.isFocused()) { globalShortcut.setSuspended(true); shortcutCaptureTimer = setTimeout(finishShortcutCapture, 30000); }
  });
  ipcMain.handle('overlay:show', (event, value) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return displayReaction(value); });
  ipcMain.handle('overlay:test', event => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return displayReaction({ server: baseUrl, duration: 4, caption: 'Test de l’overlay', sender: { name: clientState?.nickname || 'evil memeroom' } }, true); });
  ipcMain.on('overlay:clear', event => { if (trustedControl(event)) clearOverlay(); });
  ipcMain.on('overlay:done', (event, id) => { if (trustedOverlay(event) && id === generation) clearOverlay(); });
  ipcMain.on('overlay:ready', (event, id, contentSize) => {
    if (trustedOverlay(event) && id === generation && !settings.paused) {
      if (contentSize && typeof contentSize.width === 'number' && typeof contentSize.height === 'number') {
        positionOverlay(contentSize);
      }
      clearTimeout(hideTimer); overlayLayer.show();
      hideTimer = setTimeout(clearOverlay, playbackAutomatic ? protocol.LIMITS.playbackStallMs : playbackDuration * 1000 + 250);
    }
  });
  ipcMain.on('overlay:progress', (event, id) => {
    if (trustedOverlay(event) && id === generation && playbackAutomatic) { clearTimeout(hideTimer); hideTimer = setTimeout(clearOverlay, protocol.LIMITS.playbackStallMs); }
  });
  ipcMain.on('overlay:error', (event, message, id) => { if (trustedOverlay(event) && id === generation) { clearOverlay(); control.webContents.send('overlay:error', protocol.cleanText(message, 160)); } });
  ipcMain.handle('app:minimize', event => { if (trustedControl(event)) { if (process.platform === 'linux') control.minimize(); else control.hide(); } });
  ipcMain.handle('app:restart', event => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const args = process.argv.slice(1).filter(a => a !== '--hidden' && a !== '--silent');
    // The relaunched process would otherwise lose the single-instance race against this one.
    app.releaseSingleInstanceLock();
    if (process.platform === 'linux' && process.env.APPIMAGE) {
      // This process cannot gain privileges (no_new_privs), so a child AppImage cannot FUSE-mount itself: extract instead.
      app.relaunch({ execPath: '/bin/sh', args: ['-c', 'sleep 1; APPIMAGE_EXTRACT_AND_RUN=1 exec "$0" "$@"', process.env.APPIMAGE, ...args] });
    } else app.relaunch({ args });
    quitting = true;
    app.exit(0);
  });
  let trayIcon = icon;
  if (process.platform === 'darwin') {
    trayIcon = nativeImage.createEmpty();
    trayIcon.addRepresentation({ scaleFactor: 1.0, buffer: icon.resize({ width: 16, height: 16, quality: 'best' }).toPNG() });
    trayIcon.addRepresentation({ scaleFactor: 2.0, buffer: icon.resize({ width: 32, height: 32, quality: 'best' }).toPNG() });
  }
  tray = new Tray(trayIcon); tray.on('click', () => { control.show(); control.focus(); }); tray.on('double-click', () => { control.show(); control.focus(); }); updateTray();
  control.on('close', event => { if (!quitting) { event.preventDefault(); if (process.platform === 'linux') control.minimize(); else control.hide(); } });
  control.on('blur', finishShortcutCapture);
  const reloadStamps = new Map();
  const reloadLimited = target => {
    const now = Date.now();
    const recent = (reloadStamps.get(target) || []).filter(stamp => now - stamp < 60000);
    if (recent.length >= 3) { reloadStamps.set(target, recent); return; }
    reloadStamps.set(target, [...recent, now]);
    if (!target.isDestroyed()) target.reload();
  };
  control.webContents.on('render-process-gone', () => { finishShortcutCapture(); clearOverlay(); reloadLimited(control); });
  overlay.webContents.on('render-process-gone', () => { clearOverlay(); reloadLimited(overlay); });
  globalShortcut.register('CommandOrControl+Shift+F8', () => saveSettings({ ...settings, paused: !settings.paused }).catch(() => {}));
  try { bindDismissShortcut(settings.dismissShortcut); } catch (error) { shortcutError = error.message; }
  screen.on('display-removed', clearOverlay);
  screen.on('display-metrics-changed', () => {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) { positionOverlay(); overlayLayer.refresh(); }
  });
  await overlay.loadFile(path.join(__dirname, 'overlay.html'));
  await control.loadURL(CONTROL_URL);
  startupUpdate.close();
  if (!isHiddenLaunch && control && !control.isDestroyed()) {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
  }
}).catch(error => { dialog.showErrorBox('evil memeroom', `Impossible de démarrer : ${error.message}`); quitting = true; app.quit(); });
app.on('second-instance', () => {
  if (control && !control.isDestroyed()) {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
  }
});
app.on('activate', () => { if (control && !control.isDestroyed()) { if (control.isMinimized()) control.restore(); control.show(); control.focus(); } });
let serverStopped = false;
app.on('before-quit', event => {
  quitting = true; clearOverlay(); globalShortcut.unregisterAll();
  if (!localServer || serverStopped) return;
  // Wait (2 s max) so the server removes its temp media directories before the process exits.
  event.preventDefault();
  serverStopped = true;
  Promise.race([localServer.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
