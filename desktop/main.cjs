const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  session,
  dialog,
  net,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { CONTROL_URL, installControlPage } = require('./control-page.cjs');
const { MediaCache } = require('./media-cache.cjs');
const { createPlayback } = require('./playback.cjs');
const { createPreviewMedia } = require('./preview-media.cjs');
const { createAtomicWriter } = require('../shared/node/atomic-writer.cjs');
const { Presets } = require('./presets.cjs');
const { createOverlayLayer } = require('./overlay-layer.cjs');

// Overlay placement and always-on-top windows require X11, including through XWayland.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11');

if (process.env.MEMEROOM_USER_DATA)
  app.setPath('userData', path.resolve(process.env.MEMEROOM_USER_DATA));
const singleInstance =
  process.env.MEMEROOM_ALLOW_MULTIPLE === '1' || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let control,
  overlay,
  tray,
  localServer,
  baseUrl,
  settings,
  clientState,
  protocol,
  quitting = false;
let dismissShortcut = '',
  shortcutError = '',
  shortcutCaptureTimer;
let playback, mediaCache, previewMedia, presets, overlayLayer;
function finishShortcutCapture() {
  clearTimeout(shortcutCaptureTimer);
  globalShortcut.setSuspended(false);
}
function bindDismissShortcut(value) {
  if (value === dismissShortcut) {
    shortcutError = '';
    return;
  }
  // Register the replacement before releasing the previous working shortcut.
  if (value && !globalShortcut.register(value, clearOverlay))
    throw new Error(
      'Ce raccourci est déjà utilisé ou indisponible. Choisissez une autre combinaison.',
    );
  if (dismissShortcut) globalShortcut.unregister(dismissShortcut);
  dismissShortcut = value;
  shortcutError = '';
}
const settingsPath = () => path.join(app.getPath('userData'), 'preferences.json');
const clientPath = () => path.join(app.getPath('userData'), 'saved-rooms.json');
const trustedControl = (event) =>
  control &&
  event.sender === control.webContents &&
  event.senderFrame === control.webContents.mainFrame &&
  event.senderFrame.url === CONTROL_URL;
const trustedOverlay = (event) =>
  overlay &&
  event.sender === overlay.webContents &&
  event.senderFrame === overlay.webContents.mainFrame;
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}
function clearOverlay() {
  playback?.clear();
}
function sendSettings() {
  if (control && !control.isDestroyed()) control.webContents.send('settings:changed', settings);
}
const settingsWriter = createAtomicWriter(settingsPath());
const clientWriter = createAtomicWriter(clientPath());
async function saveClient(value) {
  clientState = protocol.cleanClientState(value);
  await clientWriter.save(clientState);
  return clientState;
}
async function saveSettings(value, applyShortcut = false) {
  if (value.dismissShortcut !== undefined && !protocol.validDismissShortcut(value.dismissShortcut))
    throw new Error('Raccourci invalide. Ctrl + Maj + F8 est réservé à la pause.');
  const next = protocol.cleanSettings(value);
  if (applyShortcut || next.dismissShortcut !== settings.dismissShortcut) {
    finishShortcutCapture();
    bindDismissShortcut(next.dismissShortcut);
  }
  settings = next;
  if (settings.paused) clearOverlay();
  else if (overlay && !overlay.isDestroyed())
    overlay.webContents.send('overlay:volume', settings.volume);
  const persisted = settingsWriter.save(settings);
  sendSettings();
  updateTray();
  await persisted;
  return settings;
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(
    settings.paused ? 'MemeRoom · réception en pause' : 'MemeRoom · réception active',
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Ouvrir MemeRoom',
        click: () => {
          control.show();
          control.focus();
        },
      },
      {
        label: settings.paused ? 'Reprendre la réception' : 'Mettre en pause',
        click: () => saveSettings({ ...settings, paused: !settings.paused }).catch(() => {}),
      },
      { type: 'separator' },
      {
        label: 'Quitter MemeRoom',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
function positionOverlay() {
  const display =
    screen.getAllDisplays().find((d) => String(d.id) === settings.display) ||
    screen.getPrimaryDisplay();
  const area = settings.position === 'center' ? display.bounds : display.workArea;
  const width = Math.round((area.width * settings.size) / 100);
  const height = Math.min(Math.round(width * 0.78), area.height - 48);
  let x = area.x + area.width - width - 24,
    y = area.y + area.height - height - 24;
  if (settings.position === 'bottom-left') x = area.x + 24;
  if (settings.position === 'top-right') y = area.y + 24;
  if (settings.position === 'center') {
    x = area.x + Math.round((area.width - width) / 2);
    y = area.y + Math.round((area.height - height) / 2);
  }
  overlay.setBounds({ x, y, width, height });
}

if (singleInstance)
  app
    .whenReady()
    .then(async () => {
      const { checkStartupUpdate } = require('./update-window.cjs');
      const startupUpdate = await checkStartupUpdate({ app, BrowserWindow, ipcMain });
      if (startupUpdate.installed) return;
      protocol = await import(pathToFileURL(path.join(__dirname, '../shared/protocol.mjs')).href);
      presets = new Presets(path.join(app.getPath('userData'), 'saved-messages'), protocol);
      try {
        settings = protocol.cleanSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf8')));
      } catch {
        settings = { ...protocol.DEFAULT_SETTINGS };
      }
      try {
        clientState = protocol.cleanClientState(
          JSON.parse(await fs.readFile(clientPath(), 'utf8')),
        );
      } catch (error) {
        if (error.code !== 'ENOENT')
          throw new Error('Impossible de lire les rooms enregistrées : ' + error.message);
        clientState = null;
      }
      const { createRoomServer } = await import(
        pathToFileURL(path.join(__dirname, '../server/index.mjs')).href
      );
      const dataDir = path.join(app.getPath('userData'), 'server');
      localServer = createRoomServer({
        host: process.env.HOST || '0.0.0.0',
        port: Number(process.env.MEMEROOM_PORT || 3210),
        dataDir,
      });
      let address;
      try {
        address = await localServer.start();
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        await localServer.stop();
        localServer = createRoomServer({ host: process.env.HOST || '0.0.0.0', port: 0, dataDir });
        address = await localServer.start();
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      const controlSession = session.fromPartition('memeroom-control');
      mediaCache = new MediaCache({ root: process.env.MEMEROOM_TEMP_DIR });
      previewMedia = createPreviewMedia(mediaCache, async (file, request, mime) => {
        const response = await net.fetch(pathToFileURL(file).href, { headers: request.headers });
        const headers = new Headers(response.headers);
        headers.set('Content-Type', mime || 'application/octet-stream');
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        if (request.method === 'HEAD') await response.body?.cancel();
        return new Response(request.method === 'HEAD' ? null : response.body, {
          status: response.status,
          headers,
        });
      });
      installControlPage(controlSession, previewMedia);
      for (const currentSession of [session.defaultSession, controlSession]) {
        currentSession.setPermissionRequestHandler((_contents, _permission, callback) =>
          callback(false),
        );
        currentSession.setPermissionCheckHandler(() => false);
        currentSession.on('will-download', (event) => event.preventDefault());
      }
      const icon = nativeImage.createFromPath(path.join(__dirname, '../public/icon.png'));
      control = new BrowserWindow({
        title: 'MemeRoom',
        width: 860,
        height: 780,
        minWidth: 540,
        minHeight: 620,
        backgroundColor: '#f7f7f8',
        autoHideMenuBar: true,
        icon,
        webPreferences: {
          session: controlSession,
          preload: path.join(__dirname, 'preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      overlay = new BrowserWindow({
        title: 'MemeRoom Overlay',
        width: 520,
        height: 420,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          preload: path.join(__dirname, 'overlay-preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required',
        },
      });
      overlayLayer = createOverlayLayer(overlay);
      playback = createPlayback({
        protocol,
        cache: mediaCache,
        getSettings: () => settings,
        show(value) {
          positionOverlay();
          overlay.webContents.send('overlay:show', value);
        },
        hide() {
          if (!overlay.isDestroyed()) {
            overlay.webContents.send('overlay:clear');
            overlayLayer.hide();
          }
        },
        reveal: () => overlayLayer.show(),
      });
      secureWindow(control);
      secureWindow(overlay);
      ipcMain.handle('app:info', (event) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        const addresses = Object.values(os.networkInterfaces())
          .flat()
          .filter((n) => n && n.family === 'IPv4' && !n.internal)
          .map((n) => `http://${n.address}:${address.port}`);
        return {
          settings,
          clientState,
          shortcutError,
          platform: process.platform,
          server: baseUrl,
          addresses,
          displays: screen.getAllDisplays().map((d, i) => ({
            id: String(d.id),
            label: d.label || `Écran ${i + 1} · ${d.size.width} × ${d.size.height}`,
          })),
        };
      });
      ipcMain.handle('preview:prepare', (event, id, asset, server) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return previewMedia.prepare(id, asset, server);
      });
      ipcMain.on('preview:release', (event, id) => {
        if (trustedControl(event)) previewMedia.release(id);
      });
      ipcMain.handle('client:save', (event, value) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return saveClient(value);
      });
      ipcMain.handle('presets:list', (event) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return presets.list();
      });
      ipcMain.handle('presets:save', (event, value) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return presets.save(value);
      });
      ipcMain.handle('presets:rename', (event, id, name) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return presets.rename(id, name);
      });
      ipcMain.handle('presets:remove', (event, id) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return presets.remove(id);
      });
      ipcMain.handle('presets:load', (event, id, server, token) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return presets.load(id, server, token);
      });
      ipcMain.handle('settings:save', (event, value) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return saveSettings(value);
      });
      ipcMain.handle('shortcut:save', (event, value) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return saveSettings({ ...settings, dismissShortcut: value }, true);
      });
      ipcMain.handle('shortcut:record', (event, active) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        finishShortcutCapture();
        if (active === true && control.isFocused()) {
          globalShortcut.setSuspended(true);
          shortcutCaptureTimer = setTimeout(finishShortcutCapture, 30000);
        }
      });
      ipcMain.handle('overlay:show', (event, value) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return playback.display(value);
      });
      ipcMain.handle('overlay:test', (event) => {
        if (!trustedControl(event)) throw new Error('Accès refusé.');
        return playback.display(
          {
            server: baseUrl,
            duration: 4,
            caption: 'Test de l’overlay',
            sender: { name: clientState?.nickname || 'MemeRoom' },
          },
          true,
        );
      });
      ipcMain.on('overlay:clear', (event) => {
        if (trustedControl(event)) clearOverlay();
      });
      ipcMain.on('overlay:done', (event, id) => {
        if (trustedOverlay(event)) playback.done(id);
      });
      ipcMain.on('overlay:ready', (event, id) => {
        if (trustedOverlay(event)) playback.ready(id);
      });
      ipcMain.on('overlay:progress', (event, id) => {
        if (trustedOverlay(event)) playback.progress(id);
      });
      ipcMain.on('overlay:error', (event, message, id) => {
        if (trustedOverlay(event) && playback.done(id))
          control.webContents.send('overlay:error', protocol.cleanText(message, 160));
      });
      ipcMain.handle('app:minimize', (event) => {
        if (trustedControl(event)) {
          if (process.platform === 'linux') control.minimize();
          else control.hide();
        }
      });
      tray = new Tray(icon);
      tray.on('double-click', () => {
        control.show();
        control.focus();
      });
      updateTray();
      control.on('close', (event) => {
        if (!quitting) {
          event.preventDefault();
          if (process.platform === 'linux') control.minimize();
          else control.hide();
        }
      });
      control.on('blur', finishShortcutCapture);
      control.webContents.on('render-process-gone', () => {
        previewMedia.clear();
        finishShortcutCapture();
        clearOverlay();
        control.reload();
      });
      overlay.webContents.on('render-process-gone', () => {
        clearOverlay();
        overlay.reload();
      });
      globalShortcut.register('CommandOrControl+Shift+F8', () =>
        saveSettings({ ...settings, paused: !settings.paused }).catch(() => {}),
      );
      try {
        bindDismissShortcut(settings.dismissShortcut);
      } catch (error) {
        shortcutError = error.message;
      }
      screen.on('display-removed', clearOverlay);
      screen.on('display-metrics-changed', () => {
        if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
          positionOverlay();
          overlayLayer.refresh();
        }
      });
      await overlay.loadFile(path.join(__dirname, 'overlay.html'));
      await control.loadURL(CONTROL_URL);
      startupUpdate.close();
    })
    .catch((error) => {
      dialog.showErrorBox('MemeRoom', `Impossible de démarrer : ${error.message}`);
      quitting = true;
      app.quit();
    });
app.on('second-instance', () => {
  if (control) {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
  }
});
app.on('activate', () => {
  if (control && !control.isDestroyed()) {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
  }
});
let shutdown,
  shutdownComplete = false;
app.on('before-quit', (event) => {
  quitting = true;
  if (shutdownComplete || !playback) return;
  event.preventDefault();
  if (shutdown) return;
  clearOverlay();
  previewMedia?.clear();
  globalShortcut.unregisterAll();
  shutdown = Promise.allSettled([
    settingsWriter.flush(),
    clientWriter.flush(),
    mediaCache?.close(),
    localServer?.stop(),
  ]).then((results) => {
    for (const result of results)
      if (result.status === 'rejected')
        console.error('Arrêt incomplet :', result.reason?.code || 'IO_ERROR');
    shutdownComplete = true;
    app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
