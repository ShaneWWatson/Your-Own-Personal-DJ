const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startScan: (folders) => ipcRenderer.send('start-scan', folders),
  writeTags: (filePath, bpm, key) => ipcRenderer.invoke('write-tags', { filePath, bpm, key }),
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, data) => callback(data)),
  onScanComplete: (callback) => ipcRenderer.on('scan-complete', (event, data) => callback(data)),
  getSystemMusicFolder: () => ipcRenderer.invoke('get-system-music-folder'),
  loadLibrary: () => ipcRenderer.invoke('load-library'),
  
  // Model Download & Local Offline Support
  checkModelStatus: () => ipcRenderer.invoke('check-model-status'),
  downloadModel: () => ipcRenderer.invoke('download-model'),
  onModelDownloadStart: (callback) => ipcRenderer.on('model-download-start', (event, data) => callback(data)),
  onModelDownloadProgress: (callback) => ipcRenderer.on('model-download-progress', (event, data) => callback(data)),
  onModelDownloadComplete: (callback) => ipcRenderer.on('model-download-complete', (event) => callback()),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  
  // Audio Process Communication Bridge
  sendToAudio: (data) => ipcRenderer.send('to-audio-player', data),
  onAudioCommand: (callback) => ipcRenderer.on('audio-player-command', (event, data) => callback(data)),
  
  sendFromAudio: (data) => ipcRenderer.send('from-audio-player', data),
  onAudioEvent: (callback) => ipcRenderer.on('audio-player-event', (event, data) => callback(data))
});
