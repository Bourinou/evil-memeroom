const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  onShow: callback => ipcRenderer.on('overlay:show', (_event, value) => callback(value)),
  onClear: callback => ipcRenderer.on('overlay:clear', () => callback()),
  onVolume: callback => ipcRenderer.on('overlay:volume', (_event, value) => callback(value)),
  done: id => ipcRenderer.send('overlay:done', id),
  ready: (id, size) => ipcRenderer.send('overlay:ready', id, size),
  progress: id => ipcRenderer.send('overlay:progress', id),
  error: (value, id) => ipcRenderer.send('overlay:error', value, id)
});
