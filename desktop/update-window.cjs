const path = require('node:path');
const { runStartupUpdate } = require('./startup-update.cjs');

async function checkStartupUpdate({ app, BrowserWindow, ipcMain }) {
  const disabled = process.env.MEMEROOM_DISABLE_UPDATES === '1';
  // Mac ZIPs are currently unsigned; Squirrel.Mac requires a signed application.
  if (!app.isPackaged || disabled || !['win32', 'linux'].includes(process.platform) || (process.platform === 'linux' && !process.env.APPIMAGE)) return { installed: false, close() {} };
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = console;
  const controller = new AbortController();
  const window = new BrowserWindow({ title: 'evil memeroom', width: 440, height: 260, resizable: false, maximizable: false, backgroundColor: '#0b0d10', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'update-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
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
  try {
    await window.loadFile(path.join(__dirname, 'update.html'));
    const result = await runStartupUpdate({
      updater: autoUpdater, signal: controller.signal,
      status: value => {
        installing = value.phase === 'installing';
        if (!window.isDestroyed()) window.webContents.send('update:status', value);
      },
      install: () => new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => { clearTimeout(timer); app.removeListener('before-quit', done); autoUpdater.removeListener('error', failed); };
        const done = () => { cleanup(); resolve(); };
        const failed = error => { cleanup(); reject(error); };
        app.once('before-quit', done); autoUpdater.once('error', failed);
        timer = setTimeout(() => failed(new Error('Impossible de lancer l’installation.')), 5000);
        try { autoUpdater.quitAndInstall(true, true); } catch (error) { failed(error); }
      })
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
