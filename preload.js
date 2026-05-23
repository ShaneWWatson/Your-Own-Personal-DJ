const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startScan: (folders) => ipcRenderer.send('start-scan', folders),
  writeTags: (filePath, bpm, key) => ipcRenderer.invoke('write-tags', { filePath, bpm, key }),
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, data) => callback(data)),
  onScanComplete: (callback) => ipcRenderer.on('scan-complete', (event, data) => callback(data)),
  getSystemMusicFolder: () => ipcRenderer.invoke('get-system-music-folder'),
  saveLibrary: (library) => ipcRenderer.invoke('save-library', library),
  loadLibrary: () => ipcRenderer.invoke('load-library')
});
