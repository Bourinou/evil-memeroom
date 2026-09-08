const { contextBridge, ipcRenderer } = require('electron');
const api = /** @satisfies {import('../shared/native.js').OverlayAPI} */ ({
  onShow: (callback) => ipcRenderer.on('overlay:show', (_event, value) => callback(value)),
  onClear: (callback) => ipcRenderer.on('overlay:clear', () => callback()),
  onVolume: (callback) => ipcRenderer.on('overlay:volume', (_event, value) => callback(value)),
  done: (id) => ipcRenderer.send('overlay:done', id),
  ready: (id) => ipcRenderer.send('overlay:ready', id),
  progress: (id) => ipcRenderer.send('overlay:progress', id),
  error: (value, id) => ipcRenderer.send('overlay:error', value, id),
});
contextBridge.exposeInMainWorld('overlay', api);
