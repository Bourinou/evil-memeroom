const { contextBridge, ipcRenderer } = require('electron');
const api = /** @satisfies {import('../shared/native.js').NativeAPI} */ ({
  info: () => ipcRenderer.invoke('app:info'),
  ensureHosting: () => ipcRenderer.invoke('host:ensure'),
  onHosting: (callback) => ipcRenderer.on('host:changed', (_event, value) => callback(value)),
  preparePreview: (id, asset, server) => ipcRenderer.invoke('preview:prepare', id, asset, server),
  releasePreview: (id) => ipcRenderer.send('preview:release', id),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),
  recordShortcut: (active) => ipcRenderer.invoke('shortcut:record', active),
  saveDismissShortcut: (value) => ipcRenderer.invoke('shortcut:save', value),
  saveClient: (value) => ipcRenderer.invoke('client:save', value),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  savePreset: (value) => ipcRenderer.invoke('presets:save', value),
  renamePreset: (id, name) => ipcRenderer.invoke('presets:rename', id, name),
  removePreset: (id) => ipcRenderer.invoke('presets:remove', id),
  loadPreset: (id, server, token) => ipcRenderer.invoke('presets:load', id, server, token),
  show: (value) => ipcRenderer.invoke('overlay:show', value),
  test: () => ipcRenderer.invoke('overlay:test'),
  clear: () => ipcRenderer.send('overlay:clear'),
  minimize: () => ipcRenderer.invoke('app:minimize'),
  onSettings: (callback) => {
    ipcRenderer.on('settings:changed', (_event, value) => callback(value));
  },
  onError: (callback) => {
    ipcRenderer.on('overlay:error', (_event, value) => callback(value));
  },
});
contextBridge.exposeInMainWorld('memeroom', api);
