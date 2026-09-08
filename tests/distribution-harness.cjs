const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
app.setPath('userData', process.env.MEMEROOM_USER_DATA);
app.whenReady().then(() => {
  global.qaBrowser = new BrowserWindow({ show: false, width: 920, height: 740, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  global.qaBrowser.loadURL('about:blank');
});

global.runDistributionCheck = async ({ url, directory, platform, version = '0.2.9' }) => {
  const { NsisUpdater, AppImageUpdater } = require('electron-updater');
  const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
  await fs.mkdir(directory, { recursive: true });
  const appUpdateConfigPath = path.join(directory, 'app-update.yml');
  await fs.writeFile(appUpdateConfigPath, 'updaterCacheDirName: cache\n');
  const adapter = { version, name: 'memeroom-distribution-test', isPackaged: true, appUpdateConfigPath, userDataPath: directory, baseCachePath: directory, whenReady: () => app.whenReady(), onQuit() {}, quit() { throw new Error('Tests must not run the installer'); } };
  const Updater = platform === 'windows' ? NsisUpdater : AppImageUpdater;
  const updater = new Updater(null, adapter);
  updater.httpExecutor = new ElectronHttpExecutor();
  updater.logger = null;
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
  updater.disableDifferentialDownload = true; updater.disableWebInstaller = true;
  // Simulate a Linux client even when the test host is Windows.
  updater._testOnlyOptions = { platform: platform === 'windows' ? 'win32' : 'linux' };
  updater.setFeedURL({ provider: 'generic', url, useMultipleRangeRequest: false });
  const previous = process.env.APPIMAGE;
  if (platform === 'linux') process.env.APPIMAGE = path.join(directory, 'previous.AppImage');
  try {
    const result = await updater.checkForUpdates();
    if (!result.isUpdateAvailable) return { available: false };
    const files = await updater.downloadUpdate(result.cancellationToken);
    return { available: true, version: result.updateInfo.version, files };
  } finally { if (previous === undefined) delete process.env.APPIMAGE; else process.env.APPIMAGE = previous; }
};

global.beginStartupWindowCheck = () => {
  const { ipcMain } = require('electron');
  const { autoUpdater } = require('electron-updater');
  const { checkStartupUpdate } = require('../desktop/update-window.cjs');
  const originalCheck = autoUpdater.checkForUpdates, originalDownload = autoUpdater.downloadUpdate;
  global.startupOutcome = null; global.startupDownloads = 0;
  autoUpdater.checkForUpdates = () => new Promise(resolve => { global.finishStartupCheck = resolve; });
  autoUpdater.downloadUpdate = async () => { global.startupDownloads++; };
  const facade = { isPackaged: true, once: app.once.bind(app), removeListener: app.removeListener.bind(app) };
  checkStartupUpdate({ app: facade, BrowserWindow, ipcMain }).then(result => {
    global.startupOutcome = { installed: result.installed };
    result.close();
    autoUpdater.checkForUpdates = originalCheck; autoUpdater.downloadUpdate = originalDownload;
  });
};
