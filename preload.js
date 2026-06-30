/**
 * @file preload.js — Secure IPC bridge.
 *
 * Exposes a minimal, explicitly-enumerated `window.api` surface to the
 * renderer processes via contextBridge. No Node.js primitives ever cross
 * the bridge — only message-passing functions.
 *
 * @license AGPL-3.0-or-later
 * @copyright 2026 Shane W Watson
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startScan: (folders) => ipcRenderer.send('start-scan', folders),
  writeTags: (filePath, bpm, key, albumArtBase64) => ipcRenderer.invoke('write-tags', { filePath, bpm, key, albumArtBase64 }),
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, data) => callback(data)),
  onScanComplete: (callback) => ipcRenderer.on('scan-complete', (event, data) => callback(data)),
  getSystemMusicFolder: () => ipcRenderer.invoke('get-system-music-folder'),
  loadLibrary: () => ipcRenderer.invoke('load-library'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  logDebug: (line) => ipcRenderer.send('debug-log', line),
  checkFileHealth: (filePath) => ipcRenderer.invoke('check-file-health', filePath),
  repairFile: (filePath) => ipcRenderer.invoke('repair-file', filePath),

  // Lyric Mood AI (local model or Anthropic) — config/key stay in the main process
  aiGetStatus: () => ipcRenderer.invoke('ai-get-status'),
  aiSetConfig: (config) => ipcRenderer.invoke('ai-set-config', config),
  aiAnalyzeLyrics: (payload) => ipcRenderer.invoke('ai-analyze-lyrics', payload),
  onAiAnalyzeProgress: (callback) => ipcRenderer.on('ai-analyze-progress', (event, data) => callback(data)),
  onAiModelDownloadProgress: (callback) => ipcRenderer.on('ai-model-download-progress', (event, data) => callback(data)),
  
  // Discord Integration
  discordGetStatus: () => ipcRenderer.invoke('discord-get-status'),
  discordSetConfig: (config) => ipcRenderer.invoke('discord-set-config', config),
  discordAuthorize: (config) => ipcRenderer.invoke('discord-authorize', config),
  discordDisconnect: () => ipcRenderer.invoke('discord-disconnect'),

  // Last.fm Scrobbling
  lastfmGetStatus: () => ipcRenderer.invoke('lastfm-get-status'),
  lastfmSetConfig: (config) => ipcRenderer.invoke('lastfm-set-config', config),
  lastfmAuthorize: (config) => ipcRenderer.invoke('lastfm-authorize', config),
  lastfmDisconnect: () => ipcRenderer.invoke('lastfm-disconnect'),

  // Audio Process Communication Bridge
  sendToAudio: (data) => ipcRenderer.send('to-audio-player', data),
  onAudioCommand: (callback) => ipcRenderer.on('audio-player-command', (event, data) => callback(data)),
  
  sendFromAudio: (data) => ipcRenderer.send('from-audio-player', data),
  onAudioEvent: (callback) => ipcRenderer.on('audio-player-event', (event, data) => callback(data))
});
