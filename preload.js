const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('check', {
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winMaximize: () => ipcRenderer.send('win:maximize'),
  winClose: () => ipcRenderer.send('win:close'),

  getAppInfo: () => ipcRenderer.invoke('app:info'),

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  getStats: () => ipcRenderer.invoke('sys:stats'),

  scanTemp: () => ipcRenderer.invoke('temp:scan'),
  cleanTemp: (paths) => ipcRenderer.invoke('temp:clean', paths),

  listStartup: () => ipcRenderer.invoke('startup:list'),
  removeStartup: (name) => ipcRenderer.invoke('startup:remove', name),
  setSelfAtLogin: (enabled) => ipcRenderer.invoke('startup:setSelfAtLogin', enabled),
  getSelfAtLogin: () => ipcRenderer.invoke('startup:getSelfAtLogin'),

  takeScreenshot: () => ipcRenderer.invoke('shot:capture'),
  openScreenshotFolder: () => ipcRenderer.invoke('shot:openFolder'),

  getClipboardHistory: () => ipcRenderer.invoke('clip:getHistory'),
  refreshClipboard: () => ipcRenderer.invoke('clip:refresh'),
  getClipboardPreview: (id) => ipcRenderer.invoke('clip:preview', id),
  copyClipboardItem: (id) => ipcRenderer.invoke('clip:copyItem', id),
  openClipboardItem: (id) => ipcRenderer.invoke('clip:openItem', id),
  showClipboardItem: (id) => ipcRenderer.invoke('clip:showItem', id),
  removeClipboardItem: (id) => ipcRenderer.invoke('clip:remove', id),
  clearClipboardHistory: () => ipcRenderer.invoke('clip:clear'),
  onClipboardHistory: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('clipboard-history', handler);
    return () => ipcRenderer.removeListener('clipboard-history', handler);
  },

  listPins: () => ipcRenderer.invoke('pins:list'),
  addPin: () => ipcRenderer.invoke('pins:add'),
  removePin: (p) => ipcRenderer.invoke('pins:remove', p),
  launchPin: (p) => ipcRenderer.invoke('pins:launch', p),
  onLauncherReset: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('launcher-reset', handler);
    return () => ipcRenderer.removeListener('launcher-reset', handler);
  },
  hideLauncher: () => ipcRenderer.send('launcher:hide')
});
