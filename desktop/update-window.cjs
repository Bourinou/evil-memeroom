const path = require('node:path');
const { runStartupUpdate } = require('./startup-update.cjs');

async function checkStartupUpdate({ app, BrowserWindow, ipcMain, hidden = false }) {
  const disabled = process.env.MEMEROOM_DISABLE_UPDATES === '1';
  if (!app.isPackaged || disabled || !['win32', 'linux', 'darwin'].includes(process.platform) || (process.platform === 'linux' && !process.env.APPIMAGE)) return { installed: false, close() {} };
  const controller = new AbortController();
  const window = new BrowserWindow({ title: 'evil memeroom', width: 440, height: 260, show: !hidden, resizable: false, maximizable: false, backgroundColor: '#0b0d10', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'update-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  let installing = false;
  const skip = event => {
    if (!installing && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) controller.abort();
  };
  ipcMain.on('update:skip', skip);
  // Keep a hidden window alive until the control window exists.
  const onClose = event => { if (!installing) { event.preventDefault(); controller.abort(); window.hide(); } };
  window.on('close', onClose);

  let updater, installFn;
  if (process.platform === 'darwin') {
    const { MacGithubUpdater } = require('./mac-updater.cjs');
    const macUpdater = new MacGithubUpdater({ owner: 'Bourinou', repo: 'evil-memeroom', app });
    updater = macUpdater;
    installFn = () => macUpdater.install();
  } else {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = console;
    try {
      autoUpdater.setFeedURL({ provider: 'github', owner: 'Bourinou', repo: 'evil-memeroom' });
    } catch (e) {
      console.warn('autoUpdater setFeedURL:', e.message);
    }
    updater = autoUpdater;
    installFn = () => new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); app.removeListener('before-quit', done); autoUpdater.removeListener('error', failed); };
      const done = () => { cleanup(); resolve(); };
      const failed = error => { cleanup(); reject(error); };
      app.once('before-quit', done); autoUpdater.once('error', failed);
      timer = setTimeout(() => failed(new Error('Impossible de lancer l’installation.')), 5000);
      try { autoUpdater.quitAndInstall(true, true); } catch (error) { failed(error); }
    });
  }

  try {
    await window.loadFile(path.join(__dirname, 'update.html'));
    const result = await runStartupUpdate({
      updater, signal: controller.signal,
      status: value => {
        installing = value.phase === 'installing';
        if (!window.isDestroyed()) window.webContents.send('update:status', value);
      },
      install: installFn
    });
    if (result.error) console.warn('evil memeroom :', result.error);
    if (!result.installed && !window.isDestroyed()) window.hide();
    return { ...result, close() { if (!window.isDestroyed()) { window.removeListener('close', onClose); window.destroy(); } } };
  } catch (error) {
    console.warn('evil memeroom : mise à jour indisponible.', error.message);
    window.hide();
    return { installed: false, close() { if (!window.isDestroyed()) window.destroy(); } };
  } finally { ipcMain.removeListener('update:skip', skip); }
}
module.exports = { checkStartupUpdate };
