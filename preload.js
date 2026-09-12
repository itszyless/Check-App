const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('check', {
  // window controls
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winMaximize: () => ipcRenderer.send('win:maximize'),
  winClose: () => ipcRenderer.send('win:close'),

  // updates
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),

  // system
  getStats: () => ipcRenderer.invoke('sys:stats'),

  // temp cleaner
  scanTemp: () => ipcRenderer.invoke('temp:scan'),
  cleanTemp: (paths) => ipcRenderer.invoke('temp:clean', paths),

  // startup manager
  listStartup: () => ipcRenderer.invoke('startup:list'),
  removeStartup: (name) => ipcRenderer.invoke('startup:remove', name),
  setSelfAtLogin: (enabled) => ipcRenderer.invoke('startup:setSelfAtLogin', enabled),
  getSelfAtLogin: () => ipcRenderer.invoke('startup:getSelfAtLogin'),

  // screenshot
  takeScreenshot: () => ipcRenderer.invoke('shot:capture'),
  openScreenshotFolder: () => ipcRenderer.invoke('shot:openFolder'),

  // clipboard
  getClipboardHistory: () => ipcRenderer.invoke('clip:getHistory'),
  copyToClipboard: (text) => ipcRenderer.invoke('clip:copy', text),
  clearClipboardHistory: () => ipcRenderer.invoke('clip:clear'),
  onClipboardHistory: (cb) => ipcRenderer.on('clipboard-history', (_e, data) => cb(data)),

  // quick launcher pins
  listPins: () => ipcRenderer.invoke('pins:list'),
  addPin: () => ipcRenderer.invoke('pins:add'),
  removePin: (p) => ipcRenderer.invoke('pins:remove', p),
  launchPin: (p) => ipcRenderer.invoke('pins:launch', p),
  onLauncherReset: (cb) => ipcRenderer.on('launcher-reset', () => cb()),
  hideLauncher: () => ipcRenderer.send('launcher:hide')
});
