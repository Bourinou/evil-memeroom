const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, session, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const crypto = require('node:crypto');
const { CONTROL_URL, installControlPage } = require('./control-page.cjs');
const { downloadAsset } = require('./media-files.cjs');
const { Presets } = require('./presets.cjs');
const { createOverlayLayer } = require('./overlay-layer.cjs');

const MEMEROOM_DIR = path.join(os.homedir(), 'memeroom');
fs.mkdir(MEMEROOM_DIR, { recursive: true }).catch(() => {});

const { createReadStream } = require('node:fs');

const hashCachePath = () => path.join(app.getPath('userData'), 'memeroom-hashes.json');
const memeHashCache = new Map(); // filename -> { size, mtime, hash }
const hashToFilename = new Map(); // hash -> filename
let hashCacheLoaded = false;

async function loadHashCache() {
  if (hashCacheLoaded) return;
  try {
    const raw = await fs.readFile(hashCachePath(), 'utf8');
    const data = JSON.parse(raw);
    for (const [filename, info] of Object.entries(data)) {
      if (info && info.hash) {
        memeHashCache.set(filename, info);
        hashToFilename.set(info.hash, filename);
      }
    }
  } catch {}
  hashCacheLoaded = true;
}

let savingHashCache = Promise.resolve();
function persistHashCache() {
  const data = {};
  for (const [filename, info] of memeHashCache) {
    data[filename] = info;
  }
  const snapshot = JSON.stringify(data, null, 2);
  savingHashCache = savingHashCache.catch(() => {}).then(async () => {
    try {
      await fs.mkdir(path.dirname(hashCachePath()), { recursive: true });
      await fs.writeFile(hashCachePath() + '.tmp', snapshot, 'utf8');
      await fs.rename(hashCachePath() + '.tmp', hashCachePath());
    } catch {}
  });
}

// Low-RAM streaming hash function (64 KB chunks, only 0.06 MB RAM)
async function hashFileStream(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// Sync in-memory hash cache with ~/memeroom directory:
// Only hashes new or modified files. Existing files are NEVER re-hashed!
async function syncHashCache() {
  await loadHashCache();
  await fs.mkdir(MEMEROOM_DIR, { recursive: true });
  const entries = await fs.readdir(MEMEROOM_DIR, { withFileTypes: true });
  const presentFiles = new Set();
  let modified = false;

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    presentFiles.add(entry.name);
    try {
      const fullPath = path.join(MEMEROOM_DIR, entry.name);
      const stat = await fs.stat(fullPath);
      const cached = memeHashCache.get(entry.name);
      if (!cached || cached.size !== stat.size || cached.mtime !== stat.mtimeMs) {
        const hash = await hashFileStream(fullPath);
        memeHashCache.set(entry.name, { size: stat.size, mtime: stat.mtimeMs, hash });
        hashToFilename.set(hash, entry.name);
        modified = true;
      }
    } catch {}
  }

  // Remove entries for deleted files
  for (const [filename, info] of memeHashCache) {
    if (!presentFiles.has(filename)) {
      memeHashCache.delete(filename);
      if (hashToFilename.get(info.hash) === filename) {
        hashToFilename.delete(info.hash);
      }
      modified = true;
    }
  }

  if (modified) persistHashCache();
}

async function saveMemeAsset(sourceFile, originalName, kind) {
  await syncHashCache();
  const sourceStat = await fs.stat(sourceFile);
  if (!sourceStat.isFile() || sourceStat.size === 0) return null;

  // Stream-hash incoming file in 64 KB chunks
  const sourceHash = await hashFileStream(sourceFile);

  // O(1) in-memory lookup without touching any existing files on disk!
  if (hashToFilename.has(sourceHash)) {
    const existingName = hashToFilename.get(sourceHash);
    try {
      await fs.access(path.join(MEMEROOM_DIR, existingName));
      return { saved: false, reason: 'duplicate', name: existingName };
    } catch {
      hashToFilename.delete(sourceHash);
      memeHashCache.delete(existingName);
    }
  }

  const cleanBase = path.basename(originalName).replace(/[^\w.-]/g, '_') || `meme_${Date.now()}`;
  const parsed = path.parse(cleanBase);
  let finalName = cleanBase;
  let counter = 1;
  const entries = await fs.readdir(MEMEROOM_DIR);
  while (entries.some(e => e.toLowerCase() === finalName.toLowerCase())) {
    finalName = `${parsed.name}_${counter}${parsed.ext}`;
    counter++;
  }

  const destPath = path.join(MEMEROOM_DIR, finalName);
  await fs.copyFile(sourceFile, destPath);
  const destStat = await fs.stat(destPath);

  memeHashCache.set(finalName, { size: destStat.size, mtime: destStat.mtimeMs, hash: sourceHash });
  hashToFilename.set(sourceHash, finalName);
  persistHashCache();

  return { saved: true, name: finalName };
}

// Overlay placement and always-on-top windows require X11, including through XWayland.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11');
app.name = 'evil-memeroom';

if (process.env.MEMEROOM_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.MEMEROOM_USER_DATA));
} else {
  try {
    const fsSync = require('node:fs');
    const legacyDir = path.join(app.getPath('appData'), 'memeroom');
    const newDir = path.join(app.getPath('appData'), app.name);
    if (fsSync.existsSync(legacyDir) && !fsSync.existsSync(newDir)) {
      app.setPath('userData', legacyDir);
    }
  } catch {}
}
const singleInstance = process.env.MEMEROOM_ALLOW_MULTIPLE === '1' || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let control, overlay, tray, localServer, baseUrl, settings, clientState, protocol, quitting = false, hideTimer, lastShown = 0, generation = 0;
const seen = new Set();
let dismissShortcut = '', shortcutError = '', shortcutCaptureTimer;
let playbackAbort, playbackDirectory, presets, overlayLayer;
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
const clientPath = () => path.join(app.getPath('userData'), 'saved-rooms.json');
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
  const maxHeight = Math.min(Math.round(maxWidth * 0.78), area.height - 48);
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
  const reaction = protocol.validateReaction({ ...payload, mediaId: payload.media?.id, audioId: payload.audio?.id }, media);
  const automatic = protocol.hasTimedMedia(reaction);
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
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'memeroom-playback-'));
      if (generation !== currentGeneration || abort.signal.aborted) throw new Error('cancelled');
      playbackDirectory = directory;
      for (const key of ['media','audio']) if (reaction[key]) {
        const file = path.join(directory, key);
        await downloadAsset(reaction[key], server, file, abort.signal);
        reaction[key].playbackURL = pathToFileURL(file).href;
        const assetName = reaction[key].name || `${key}_${reaction[key].id}`;
        const isSilentAudio = key === 'audio' && (assetName === 'silent_audio.wav' || assetName.startsWith('silent_'));
        if (!isSilentAudio) {
          try {
            const saveRes = await saveMemeAsset(file, assetName, reaction[key].kind);
            if (saveRes.saved && control && !control.isDestroyed()) {
              control.webContents.send('savedMemes:updated');
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
  const { checkStartupUpdate } = require('./update-window.cjs');
  const startupUpdate = await checkStartupUpdate({ app, BrowserWindow, ipcMain });
  if (startupUpdate.installed) return;
  protocol = await import(pathToFileURL(path.join(__dirname, '../shared/protocol.mjs')).href);
  presets = new Presets(path.join(app.getPath('userData'), 'saved-messages'), protocol);
  try { settings = protocol.cleanSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf8'))); } catch { settings = { ...protocol.DEFAULT_SETTINGS }; }
  try { clientState = protocol.cleanClientState(JSON.parse(await fs.readFile(clientPath(), 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Impossible de lire les rooms enregistrées : ' + error.message); clientState = null; }
  const { createRoomServer } = await import(pathToFileURL(path.join(__dirname, '../server/index.mjs')).href);
  const dataDir = path.join(app.getPath('userData'), 'server');
  localServer = createRoomServer({ host: process.env.HOST || '0.0.0.0', port: Number(process.env.MEMEROOM_PORT || 3210), dataDir });
  let address;
  try { address = await localServer.start(); } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    await localServer.stop();
    localServer = createRoomServer({ host: process.env.HOST || '0.0.0.0', port: 0, dataDir }); address = await localServer.start();
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  const controlSession = session.fromPartition('memeroom-control');
  installControlPage(controlSession);
  for (const currentSession of [session.defaultSession, controlSession]) {
    currentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    currentSession.setPermissionCheckHandler(() => false);
    currentSession.on('will-download', event => event.preventDefault());
  }
  const fsSync = require('node:fs');
  const icon = nativeImage.createFromBuffer(fsSync.readFileSync(path.join(__dirname, '../public/icon-linux.png')));
  const windowIcon = nativeImage.createFromBuffer(fsSync.readFileSync(path.join(__dirname, '../public/icon-linux.png')));
  control = new BrowserWindow({ title: 'evil memeroom', width: 860, height: 780, minWidth: 540, minHeight: 620, backgroundColor: '#0b0d10', autoHideMenuBar: true, icon: windowIcon, webPreferences: { session: controlSession, preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  overlay = new BrowserWindow({ title: 'evil memeroom Overlay', width: 520, height: 420, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, webPreferences: { preload: path.join(__dirname, 'overlay-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  overlayLayer = createOverlayLayer(overlay);
  secureWindow(control); secureWindow(overlay);
  ipcMain.handle('app:info', event => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const addresses = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${address.port}`);
    return { settings, clientState, shortcutError, platform: process.platform, server: baseUrl, addresses, displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || `Écran ${i + 1} · ${d.size.width} × ${d.size.height}` })) };
  });
  ipcMain.handle('client:save', (event, value) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return saveClient(value); });
  ipcMain.handle('presets:list', event => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return presets.list(); });
  ipcMain.handle('presets:save', (event, value) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return presets.save(value); });
  ipcMain.handle('presets:rename', (event, id, name) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return presets.rename(id, name); });
  ipcMain.handle('presets:remove', (event, id) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return presets.remove(id); });
  ipcMain.handle('presets:load', (event, id, server, token) => { if (!trustedControl(event)) throw new Error('Accès refusé.'); return presets.load(id, server, token); });
  ipcMain.handle('savedMemes:list', async event => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    await fs.mkdir(MEMEROOM_DIR, { recursive: true });
    const entries = await fs.readdir(MEMEROOM_DIR, { withFileTypes: true });
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    const videoExts = new Set(['.mp4', '.webm']);
    const audioExts = new Set(['.mp3', '.wav', '.ogg']);
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || entry.name.startsWith('silent_')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      let kind = 'other';
      if (imageExts.has(ext)) kind = 'image';
      else if (videoExts.has(ext)) kind = 'video';
      else if (audioExts.has(ext)) kind = 'audio';
      try {
        const stat = await fs.stat(path.join(MEMEROOM_DIR, entry.name));
        items.push({
          name: entry.name,
          size: stat.size,
          mtime: stat.mtimeMs,
          kind,
          url: `/saved-memes/${encodeURIComponent(entry.name)}`
        });
      } catch {}
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  });
  ipcMain.handle('savedMemes:openFolder', async event => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    await fs.mkdir(MEMEROOM_DIR, { recursive: true });
    return shell.openPath(MEMEROOM_DIR);
  });
  ipcMain.handle('savedMemes:openFile', async (event, name) => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const safeName = path.basename(name);
    return shell.openPath(path.join(MEMEROOM_DIR, safeName));
  });
  ipcMain.handle('savedMemes:rename', async (event, oldName, newName) => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const safeOld = path.basename(oldName);
    let safeNew = path.basename(newName).replace(/[^\w.-]/g, '_');
    if (!safeNew) throw new Error('Nom invalide.');
    const oldExt = path.extname(safeOld).toLowerCase();
    if (!path.extname(safeNew)) safeNew += oldExt;
    if (safeOld === safeNew) return safeNew;
    const oldPath = path.join(MEMEROOM_DIR, safeOld);
    const newPath = path.join(MEMEROOM_DIR, safeNew);
    try {
      await fs.access(newPath);
      throw new Error(`Un fichier nommé « ${safeNew} » existe déjà.`);
    } catch (e) {
      if (e.message.includes('existe déjà')) throw e;
    }
    await fs.rename(oldPath, newPath);
    if (memeHashCache.has(safeOld)) {
      const info = memeHashCache.get(safeOld);
      memeHashCache.delete(safeOld);
      memeHashCache.set(safeNew, info);
      hashToFilename.set(info.hash, safeNew);
      persistHashCache();
    }
    if (control && !control.isDestroyed()) control.webContents.send('savedMemes:updated');
    return safeNew;
  });
  ipcMain.handle('savedMemes:delete', async (event, name) => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const safeName = path.basename(name);
    await fs.rm(path.join(MEMEROOM_DIR, safeName), { force: true });
    if (memeHashCache.has(safeName)) {
      const info = memeHashCache.get(safeName);
      memeHashCache.delete(safeName);
      if (hashToFilename.get(info.hash) === safeName) {
        hashToFilename.delete(info.hash);
      }
      persistHashCache();
    }
    if (control && !control.isDestroyed()) control.webContents.send('savedMemes:updated');
    return true;
  });
  ipcMain.handle('savedMemes:read', async (event, name) => {
    if (!trustedControl(event)) throw new Error('Accès refusé.');
    const safeName = path.basename(name);
    const buf = await fs.readFile(path.join(MEMEROOM_DIR, safeName));
    return { name: safeName, bytes: buf.byteLength, buffer: buf };
  });
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
  tray = new Tray(icon); tray.on('double-click', () => { control.show(); control.focus(); }); updateTray();
  control.on('close', event => { if (!quitting) { event.preventDefault(); if (process.platform === 'linux') control.minimize(); else control.hide(); } });
  control.on('blur', finishShortcutCapture);
  control.webContents.on('render-process-gone', () => { finishShortcutCapture(); clearOverlay(); control.reload(); });
  overlay.webContents.on('render-process-gone', () => { clearOverlay(); overlay.reload(); });
  globalShortcut.register('CommandOrControl+Shift+F8', () => saveSettings({ ...settings, paused: !settings.paused }).catch(() => {}));
  try { bindDismissShortcut(settings.dismissShortcut); } catch (error) { shortcutError = error.message; }
  screen.on('display-removed', clearOverlay);
  screen.on('display-metrics-changed', () => {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) { positionOverlay(); overlayLayer.refresh(); }
  });
  await overlay.loadFile(path.join(__dirname, 'overlay.html'));
  await control.loadURL(CONTROL_URL);
  startupUpdate.close();
}).catch(error => { dialog.showErrorBox('evil memeroom', `Impossible de démarrer : ${error.message}`); quitting = true; app.quit(); });
app.on('second-instance', () => { if (control) { if (control.isMinimized()) control.restore(); control.show(); control.focus(); } });
app.on('activate', () => { if (control && !control.isDestroyed()) { if (control.isMinimized()) control.restore(); control.show(); control.focus(); } });
app.on('before-quit', () => { quitting = true; clearOverlay(); globalShortcut.unregisterAll(); if (localServer) void localServer.stop(); });
app.on('window-all-closed', () => app.quit());
