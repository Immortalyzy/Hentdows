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
  saveSettings: patch => ipcRenderer.invoke('app:save-settings', patch),
  library: (action, input) => ipcRenderer.invoke('app:library', action, input),
  onLibraryBack: callback => { const listener = () => callback(); ipcRenderer.on('library:back', listener); return () => ipcRenderer.removeListener('library:back', listener); },
  subscribe: callback => { const listener = (_, state) => callback(state); ipcRenderer.on('app:changed', listener); return () => ipcRenderer.removeListener('app:changed', listener); }
});
