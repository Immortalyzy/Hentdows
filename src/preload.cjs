const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hentdows', {
  state: () => ipcRenderer.invoke('app:state'),
  navigate: url => ipcRenderer.invoke('app:navigate', url),
  command: command => ipcRenderer.invoke('app:command', command),
  enqueue: () => ipcRenderer.invoke('app:enqueue'),
  queueAction: (id, action) => ipcRenderer.invoke('app:queue-action', id, action),
  chooseFolder: () => ipcRenderer.invoke('app:choose-folder'),
  openFolder: id => ipcRenderer.invoke('app:open-folder', id),
  panel: panel => ipcRenderer.invoke('app:panel', panel),
  subscribe: callback => { const listener = (_, state) => callback(state); ipcRenderer.on('app:changed', listener); return () => ipcRenderer.removeListener('app:changed', listener); }
});
