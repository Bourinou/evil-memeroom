const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('memeroomUpdate', {
  skip: () => ipcRenderer.send('update:skip'),
  onStatus: (callback) => ipcRenderer.on('update:status', (_event, value) => callback(value)),
});
