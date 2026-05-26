// State Management
let state = {
  library: [],
  queue: [],
  history: [],
  mood: 'chill', // default
  customMoodPrompt: '',
  currentTrack: null,
  isPlaying: false,
  isScanning: false,
  folders: [],
  ollamaStatus: 'checking', // checking, connected, fallback, offline
  ollamaModel: null,
  isEnrichmentEnabled: true,
  
  // DJ Settings
  crossfadeDuration: 6,
  isCrossfading: false,
  masterVolume: 0.8,
  outputDeviceId: 'default',
  isDraggingSlider: false,
  currentTime: 0,
  duration: 0
};

// Target BPM and Key profiles for Moods
const moodProfiles = {
  chill: { targetBpm: 75, bpmRange: [50, 95], targetGenres: ['ambient', 'lofi', 'chill', 'acoustic', 'classical', 'jazz', 'downtempo', 'folk'] },
  focus: { targetBpm: 90, bpmRange: [75, 110], targetGenres: ['instrumental', 'classical', 'lofi', 'ambient', 'synthwave', 'study', 'post-rock'] },
  energy: { targetBpm: 135, bpmRange: [115, 180], targetGenres: ['rock', 'metal', 'grunge', 'punk', 'electronic', 'dance', 'techno', 'hip hop'] },
  party: { targetBpm: 125, bpmRange: [110, 140], targetGenres: ['pop', 'dance', 'electronic', 'house', 'funk', 'disco', 'hip hop', 'r&b'] }
};

// DOM Elements
const foldersList = document.getElementById('folders-list');
const btnAddFolder = document.getElementById('btn-add-folder');
const btnStartScan = document.getElementById('btn-start-scan');
const scanProgressContainer = document.getElementById('scan-progress-container');
const scanProgressBar = document.getElementById('scan-progress-bar');
const scanStatusText = document.getElementById('scan-status-text');
const scanPercentage = document.getElementById('scan-percentage');

const analysisProgressContainer = document.getElementById('analysis-progress-container');
const analysisProgressBar = document.getElementById('analysis-progress-bar');
const analysisStatusText = document.getElementById('analysis-status-text');
const analysisPercentage = document.getElementById('analysis-percentage');

const aiStatusBadge = document.getElementById('ai-status-badge');
const aiStatusText = document.getElementById('ai-status-text');
const aiModelName = document.getElementById('ai-model-name');
const aiConsole = document.getElementById('ai-console');

const moodsContainer = document.getElementById('moods-container');
const customMoodContainer = document.getElementById('custom-mood-container');
const customMoodInput = document.getElementById('custom-mood-input');
const btnApplyCustomMood = document.getElementById('btn-apply-custom-mood');

const trackTitle = document.getElementById('track-title');
const trackArtist = document.getElementById('track-artist');
const trackAlbum = document.getElementById('track-album');
const albumArt = document.getElementById('album-art');
const vinylDisc = document.getElementById('vinyl-disc');
const canvas = document.getElementById('waveform-visualizer');

const trackDurationCurrent = document.getElementById('track-duration-current');
const trackDurationTotal = document.getElementById('track-duration-total');
const progressSlider = document.getElementById('progress-slider');

const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');
const btnMute = document.getElementById('btn-mute');
const volumeSlider = document.getElementById('volume-slider');

const comingUpList = document.getElementById('coming-up-list');
const toggleEnrichment = document.getElementById('toggle-enrichment');
const enrichmentContent = document.getElementById('enrichment-content');

const libraryTableBody = document.getElementById('library-table-body');
const librarySearch = document.getElementById('library-search');

const popupNotification = document.getElementById('popup-notification');
const popupTitle = document.getElementById('popup-title');
const popupMessage = document.getElementById('popup-message');
const btnPopupClose = document.getElementById('btn-popup-close');

const genreBadge = document.getElementById('genre-badge');
const bpmBadge = document.getElementById('bpm-badge');
const keyBadge = document.getElementById('key-badge');
const moodBadge = document.getElementById('mood-badge');

const svgPlay = document.getElementById('svg-play');
const svgPause = document.getElementById('svg-pause');
const svgVolume = document.getElementById('svg-volume');

// Settings Elements
const btnSettings = document.getElementById('btn-settings');
const btnSettingsClose = document.getElementById('btn-settings-close');
const settingsModal = document.getElementById('settings-modal');
const selectOutputDevice = document.getElementById('select-output-device');
const crossfadeSlider = document.getElementById('crossfade-slider');
const crossfadeValue = document.getElementById('crossfade-value');

// Initialize visualizer context
const ctx = canvas.getContext('2d');
canvas.width = canvas.parentElement.clientWidth;
canvas.height = 48;

// --- IndexedDB Database Persistence ---
const DB_NAME = 'YourOwnPersonalDJ_DB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains('tracks')) {
        const trackStore = db.createObjectStore('tracks', { keyPath: 'path' });
        trackStore.createIndex('mood', 'mood', { unique: false });
        trackStore.createIndex('bpm', 'bpm', { unique: false });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function dbGetFolders() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('folders', 'readonly');
    const store = transaction.objectStore('folders');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.map(f => f.path));
    request.onerror = () => reject(request.error);
  });
}

async function dbAddFolder(path) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('folders', 'readwrite');
    const store = transaction.objectStore('folders');
    const request = store.put({ path });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbRemoveFolder(path) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('folders', 'readwrite');
    const store = transaction.objectStore('folders');
    const request = store.delete(path);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbGetTracks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('tracks', 'readonly');
    const store = transaction.objectStore('tracks');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbSaveTrack(track) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('tracks', 'readwrite');
    const store = transaction.objectStore('tracks');
    const request = store.put(track);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbSaveTracksBatch(tracks) {
  if (tracks.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('tracks', 'readwrite');
    const store = transaction.objectStore('tracks');
    tracks.forEach(t => store.put(t));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function dbDeleteTracksBatch(paths) {
  if (paths.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('tracks', 'readwrite');
    const store = transaction.objectStore('tracks');
    paths.forEach(p => store.delete(p));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// --- local AI Web Worker Manager ---
let aiWorker = null;
const pendingWorkerRequests = new Map();
let workerRequestId = 0;

async function initAIWorker() {
  state.ollamaStatus = 'checking';
  updateAIStatusUI();
  logConsole('Initializing local AI Web Worker thread...', 'system');

  aiWorker = new Worker('audio-analysis-worker.js?v=' + Date.now(), { type: 'module' });

  aiWorker.onmessage = (event) => {
    const { type, id, data, error } = event.data;

    if (type === 'status-update') {
      const { status, model, log, logType } = data;
      if (status) {
        state.ollamaStatus = status;
        updateAIStatusUI();
      }
      if (model) {
        state.ollamaModel = model;
        updateAIStatusUI();
      }
      if (log) {
        logConsole(log, logType || 'system');
      }
    } else {
      const pending = pendingWorkerRequests.get(id);
      if (pending) {
        pendingWorkerRequests.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(data);
        }
      }
    }
  };

  aiWorker.onerror = (err) => {
    console.error('AI Web Worker Error:', err);
    logConsole(`AI Web Worker Error: ${err.message}`, 'danger');
  };

  // Essentia.js WebAssembly ships bundled with the app — no model download needed.
  sendWorkerRequest('init');
}

function sendWorkerRequest(action, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++workerRequestId;
    pendingWorkerRequests.set(id, { resolve, reject });
    aiWorker.postMessage({ action, id, payload }, transfer);
  });
}

// --- Audio Process Communication Manager ---
function sendAudioCommand(command, payload = {}) {
  window.api.sendToAudio({ command, payload });
}

function setupAudioEvents() {
  window.api.onAudioEvent((data) => {
    const { event, data: payload } = data;

    switch (event) {
      case 'timeupdate':
        state.currentTime = payload.currentTime;
        state.duration = payload.duration;
        if (!state.isDraggingSlider) {
          progressSlider.value = (payload.currentTime / payload.duration) * 100;
          trackDurationCurrent.innerText = formatDuration(payload.currentTime);
        }
        break;

      case 'play':
        state.isPlaying = true;
        vinylDisc.classList.add('playing');
        vinylDisc.classList.remove('paused');
        svgPlay.classList.add('hidden');
        svgPause.classList.remove('hidden');
        startSimulatedVisualizer();
        break;

      case 'pause':
        state.isPlaying = false;
        vinylDisc.classList.remove('playing');
        vinylDisc.classList.add('paused');
        svgPlay.classList.remove('hidden');
        svgPause.classList.add('hidden');
        break;

      case 'loadedmetadata':
        state.duration = payload.duration;
        trackDurationTotal.innerText = formatDuration(payload.duration);
        break;

      case 'ended':
        logConsole('Track finished. Transitioning...', 'info');
        skipTrack();
        break;

      case 'request-next-track':
        playNextTrackFromQueue();
        break;

      case 'crossfade-start':
        handleCrossfadeStart(payload.track);
        break;

      case 'crossfade-end':
        handleCrossfadeEnd();
        break;

      case 'log':
        logConsole(payload.message, payload.type);
        break;

      case 'error':
        logConsole(payload.message, 'danger');
        break;
    }
  });
}

// Queue transition triggered from the audio process
async function playNextTrackFromQueue() {
  if (state.queue.length > 0) {
    const nextItem = state.queue.shift();
    const track = state.library.find(t => t.path === nextItem.path);
    renderQueue();
    sendAudioCommand('start-crossfade', { nextTrack: track });
  }
}

function handleCrossfadeStart(track) {
  // Sync state
  state.currentTrack = track;
  state.isCrossfading = true; // Set crossfading state temporarily during switch
  updateNowPlayingUI();

  // Save history
  state.history.push({
    path: track.path,
    artist: track.artist,
    playedAt: Date.now()
  });
  if (state.history.length > 100) state.history.shift();

  if (state.isEnrichmentEnabled) {
    enrichMetadata(track.artist, track.title);
  }
}

async function handleCrossfadeEnd() {
  state.isCrossfading = false;
  await fillQueue();
}

// Initialize App & Database
window.addEventListener('load', async () => {
  logConsole('Initializing Your Own Personal DJ...', 'system');
  
  // Set up audio events bridge
  setupAudioEvents();
  
  // Load folders and library from IndexedDB (with legacy auto-migration)
  let foldersListDB = [];
  let tracksDB = [];
  
  try {
    foldersListDB = await dbGetFolders();
    tracksDB = await dbGetTracks();
  } catch (err) {
    console.error('IndexedDB load error:', err);
    logConsole(`Database initialization error: ${err.message}`, 'danger');
  }
  
  if (foldersListDB.length > 0 || tracksDB.length > 0) {
    state.library = tracksDB;
    state.folders = foldersListDB;
    logConsole(`Loaded ${state.library.length} tracks from IndexedDB cache.`, 'success');
  } else {
    // Database is empty. Check if we need to migrate from legacy library.md
    logConsole('Checking for legacy library.md database for migration...', 'system');
    const migrated = await window.api.loadLibrary();
    if (migrated) {
      state.folders = migrated.folders || [];
      state.library = migrated.library || [];
      
      // Save folders and tracks to IndexedDB
      for (const f of state.folders) {
        await dbAddFolder(f);
      }
      await dbSaveTracksBatch(state.library);
      logConsole(`Successfully migrated ${state.library.length} tracks from library.md to IndexedDB.`, 'success');
      showNotification('Migration Complete', 'Successfully imported legacy music library to IndexedDB.');
    } else {
      // Attempt to load system default music folder
      const systemMusic = await window.api.getSystemMusicFolder();
      if (systemMusic) {
        state.folders.push(systemMusic);
        await dbAddFolder(systemMusic);
      }
    }
  }

  renderFoldersList();
  renderLibraryTable();
  checkScanButtonState();
  updateAnalysisProgress();

  // Set up settings triggers
  setUpSettings();

  // Set up audio player triggers (UI side)
  setUpAudioPlayerControls();

  // Initialize local AI engine in Worker
  initAIWorker();

  // Start background metadata processor
  setInterval(backgroundMetadataProcessor, 6000);
});

window.addEventListener('resize', () => {
  canvas.width = canvas.parentElement.clientWidth;
});

// Helper for UI Console Logs
function logConsole(message, type = 'system') {
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  line.innerText = `[${timeStr}] ${message}`;
  
  aiConsole.appendChild(line);
  aiConsole.scrollTop = aiConsole.scrollHeight;
}

// Custom Notification Dialog
function showNotification(title, message) {
  popupTitle.innerText = title;
  popupMessage.innerText = message;
  popupNotification.classList.remove('hidden');
  
  setTimeout(() => {
    popupNotification.classList.add('hidden');
  }, 5000);
}

btnPopupClose.addEventListener('click', () => {
  popupNotification.classList.add('hidden');
});

// --- Settings Section & Audio Output Device ---
function setUpSettings() {
  btnSettings.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    updateOutputDevices();
    updateModelStatusUI();
  });
  
  btnSettingsClose.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  // Close modal when clicking on the overlay backdrop
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });

  // Audio Engine Panel (Essentia.js ships bundled — there is nothing to download).
  // The legacy "download model" controls are hidden; the panel just reports readiness.
  const btnDownloadModel = document.getElementById('btn-download-model');
  const downloadProgressContainer = document.getElementById('model-download-progress-container');

  if (btnDownloadModel) btnDownloadModel.classList.add('hidden');
  if (downloadProgressContainer) downloadProgressContainer.classList.add('hidden');

  crossfadeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.crossfadeDuration = val;
    crossfadeValue.innerText = `${val}s`;
    sendAudioCommand('set-crossfade-duration', { duration: val });
  });

  selectOutputDevice.addEventListener('change', async (e) => {
    const deviceId = e.target.value;
    state.outputDeviceId = deviceId;
    sendAudioCommand('set-output-device', { deviceId });
  });
}

async function updateModelStatusUI() {
  // Essentia.js is bundled with the application; there is no separate model to
  // download. Just reflect a "Bundled" ready state on the badge if present.
  try {
    const badge = document.getElementById('model-status-badge');
    if (!badge) return;
    badge.innerText = 'Bundled';
    badge.style.background = 'rgba(16, 185, 129, 0.15)';
    badge.style.color = 'var(--success)';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
  } catch (err) {
    console.error('Error updating engine status UI:', err);
  }
}

async function updateOutputDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
    
    selectOutputDevice.innerHTML = '';
    
    if (audioOutputs.length === 0) {
      const option = document.createElement('option');
      option.value = 'default';
      option.innerText = 'Default Device';
      selectOutputDevice.appendChild(option);
      return;
    }

    audioOutputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.innerText = device.label || `Output Device (${device.deviceId.slice(0, 5)}...)`;
      selectOutputDevice.appendChild(option);
    });

    if (state.outputDeviceId && audioOutputs.some(d => d.deviceId === state.outputDeviceId)) {
      selectOutputDevice.value = state.outputDeviceId;
    } else {
      selectOutputDevice.value = 'default';
    }
  } catch (err) {
    console.error('Error listing output devices:', err);
  }
}

function parseLLMJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n/, '');
    cleaned = cleaned.replace(/\n```$/, '');
    cleaned = cleaned.trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw e;
  }
}

// --- Folder Management & Library Scanning ---
btnAddFolder.addEventListener('click', async () => {
  const folderPath = await window.api.selectFolder();
  if (folderPath && !state.folders.includes(folderPath)) {
    state.folders.push(folderPath);
    renderFoldersList();
    
    await dbAddFolder(folderPath);
    checkScanButtonState();
    logConsole(`Added directory: ${folderPath}`, 'system');
  }
});

function renderFoldersList() {
  foldersList.innerHTML = '';
  state.folders.forEach((folder, idx) => {
    const item = document.createElement('div');
    item.className = 'folder-item';
    
    const pathSpan = document.createElement('span');
    pathSpan.className = 'folder-path';
    pathSpan.innerText = folder;
    pathSpan.title = folder;
    
    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn-icon';
    btnRemove.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    `;
    btnRemove.addEventListener('click', async () => {
      state.folders.splice(idx, 1);
      renderFoldersList();
      
      await dbRemoveFolder(folder);
      checkScanButtonState();
      logConsole(`Removed directory: ${folder}`, 'system');
    });

    item.appendChild(pathSpan);
    item.appendChild(btnRemove);
    foldersList.appendChild(item);
  });
}

function checkScanButtonState() {
  if (state.folders.length > 0) {
    btnStartScan.removeAttribute('disabled');
    btnStartScan.classList.remove('disabled');
  } else {
    btnStartScan.setAttribute('disabled', 'true');
    btnStartScan.classList.add('disabled');
  }
}

btnStartScan.addEventListener('click', () => {
  if (state.isScanning) return;
  
  state.isScanning = true;
  btnStartScan.setAttribute('disabled', 'true');
  btnStartScan.classList.add('disabled');
  
  scanProgressContainer.classList.remove('hidden');
  scanProgressBar.style.width = '0%';
  scanPercentage.innerText = '0%';
  scanStatusText.innerText = 'Reading directories...';
  
  state.scannedPaths = new Set();
  
  logConsole('Starting asynchronous library scan...', 'info');
  window.api.startScan(state.folders);
});

let libraryRenderTimeout = null;

window.api.onScanProgress(async (data) => {
  const { current, total, track } = data;
  const percent = Math.round((current / total) * 100);
  
  scanProgressBar.style.width = `${percent}%`;
  scanPercentage.innerText = `${percent}%`;
  scanStatusText.innerText = `Scanned ${current}/${total} files`;

  if (state.scannedPaths) {
    state.scannedPaths.add(track.path);
  }

  const existingIdx = state.library.findIndex(t => t.path === track.path);
  if (existingIdx !== -1) {
    if (track.bpm === null && state.library[existingIdx].bpm !== null) {
      track.bpm = state.library[existingIdx].bpm;
    }
    if (track.key === null && state.library[existingIdx].key !== null) {
      track.key = state.library[existingIdx].key;
    }
    if ((track.mood === undefined || track.mood === null) && state.library[existingIdx].mood) {
      track.mood = state.library[existingIdx].mood;
    }
    if ((track.beatOffset === undefined || track.beatOffset === null) && state.library[existingIdx].beatOffset !== null && state.library[existingIdx].beatOffset !== undefined) {
      track.beatOffset = state.library[existingIdx].beatOffset;
    }
    state.library[existingIdx] = track;
  } else {
    state.library.push(track);
  }

  // Save the single track directly to IndexedDB
  await dbSaveTrack(track);

  if (!libraryRenderTimeout) {
    libraryRenderTimeout = setTimeout(() => {
      renderLibraryTable();
      libraryRenderTimeout = null;
    }, 300);
  }
});

window.api.onScanComplete(async (data) => {
  state.isScanning = false;
  checkScanButtonState();
  scanProgressContainer.classList.add('hidden');
  
  // Clean up dead/deleted paths that were not found in the scan
  if (state.scannedPaths) {
    const deadTracks = state.library.filter(t => !state.scannedPaths.has(t.path));
    const deadPaths = deadTracks.map(t => t.path);
    
    await dbDeleteTracksBatch(deadPaths);
    state.library = state.library.filter(t => state.scannedPaths.has(t.path));
    delete state.scannedPaths;
  }
  
  if (libraryRenderTimeout) {
    clearTimeout(libraryRenderTimeout);
    libraryRenderTimeout = null;
  }
  renderLibraryTable();
  updateAnalysisProgress();
  
  logConsole(`Library scan complete. Found ${data.total} audio files.`, 'success');
  showNotification('Scanning Completed', `Successfully scanned and cataloged ${data.total} music tracks.`);
});

// --- Background Metadata Processor (BPM, Key, Mood & beat offset via Essentia.js) ---
let isProcessingMetadata = false;

function updateAnalysisProgress() {
  if (state.library.length === 0) {
    analysisProgressContainer.classList.add('hidden');
    return;
  }

  const total = state.library.length;
  const completed = state.library.filter(t => t.bpm !== null && t.key !== null && t.mood !== undefined && t.mood !== null && t.beatOffset !== undefined && t.beatOffset !== null).length;
  const remaining = total - completed;

  if (remaining > 0) {
    analysisProgressContainer.classList.remove('hidden');
    const percent = Math.round((completed / total) * 100);
    analysisProgressBar.style.width = `${percent}%`;
    analysisPercentage.innerText = `${percent}%`;
    
    const engineType = state.ollamaStatus === 'connected' ? 'Essentia' : 'Heuristics';
    analysisStatusText.innerText = `Analyzing metadata & transients (${engineType}): ${completed}/${total} files`;
  } else {
    analysisProgressContainer.classList.add('hidden');
  }
}

async function backgroundMetadataProcessor() {
  updateAnalysisProgress();

  if (isProcessingMetadata || state.library.length === 0) return;
  
  const track = state.library.find(t => t.bpm === null || t.key === null || t.mood === undefined || t.mood === null || t.beatOffset === undefined || t.beatOffset === null);
  if (!track) return;

  isProcessingMetadata = true;
  logConsole(`Analyzing "${track.title}" with Essentia.js audio analysis...`, 'info');

  let bpm = track.bpm;
  let key = track.key;
  let mood = track.mood;
  let beatOffset = track.beatOffset;

  const needsAnalysis = (bpm === null || key === null || mood === undefined || mood === null || beatOffset === undefined || beatOffset === null);

  if (needsAnalysis) {
    // 1. Real audio analysis via Essentia.js.
    //    The renderer decodes the waveform (it has OfflineAudioContext); the
    //    worker runs Essentia on the raw samples and returns BPM/Key/Mood/offset.
    if (state.ollamaStatus === 'connected' && aiWorker) {
      try {
        const decoded = await decodeTrackToMono(track.path);
        const result = await sendWorkerRequest(
          'analyze',
          { samples: decoded.samples, sampleRate: decoded.sampleRate },
          [decoded.samples.buffer] // transfer for zero-copy speed
        );

        if (result.bpm) bpm = result.bpm;
        if (result.key) key = result.key;
        if (result.mood) mood = result.mood;
        if (result.beatOffset !== undefined && result.beatOffset !== null) beatOffset = result.beatOffset;

        logConsole(`Essentia analyzed "${track.title}": BPM ${bpm}, Key ${key}, Mood ${mood} (beat offset ${beatOffset}s)`, 'ai');
      } catch (err) {
        logConsole(`Essentia analysis failed for "${track.title}": ${err.message}. Falling back.`, 'warning');
      }
    }

    // 2. Heuristic fallback for any field Essentia couldn't determine.
    if (bpm === null || key === null || mood === undefined || mood === null) {
      const fallback = getHeuristicMetadata(track);
      if (bpm === null) bpm = fallback.bpm;
      if (key === null) key = fallback.key;
      if (mood === undefined || mood === null) mood = fallback.mood;
      logConsole(`Heuristic fallback for "${track.title}": BPM ${bpm}, Key ${key}, Mood ${mood}`, 'system');
    }

    // 3. If beat offset is still missing (Essentia unavailable), use the
    //    built-in Web Audio transient detector as a last resort.
    if (beatOffset === undefined || beatOffset === null) {
      logConsole(`Running fallback transient beat detection for "${track.title}"...`, 'info');
      try {
        const audioAnalysis = await runTransientAnalysis(track.path, bpm);
        beatOffset = audioAnalysis.beatOffset;
        if (audioAnalysis.bpm && (!bpm || bpm === 100)) {
          bpm = audioAnalysis.bpm;
        }
      } catch (err) {
        logConsole(`Transient analysis failed for "${track.title}": ${err.message}`, 'warning');
        beatOffset = 0;
      }
    }
  }

  // Update track
  track.bpm = bpm;
  track.key = key;
  track.mood = mood;
  track.beatOffset = beatOffset;
  
  // Write ID3 tags back to file in main process (if MP3)
  if (track.format.toLowerCase() === 'mp3') {
    const res = await window.api.writeTags(track.path, bpm, key);
    if (res.success) {
      logConsole(`Successfully wrote ID3 tags to file: ${track.title}`, 'success');
    } else {
      const isLocked = res.code === 'EBADF' || res.code === 'EBUSY' || res.code === 'EPERM' || (res.error && res.error.includes('descriptor'));
      if (isLocked) {
        logConsole(`Could not write ID3 tags directly (file is currently in use/playing): ${track.title}`, 'info');
      } else {
        logConsole(`Failed to write tags: ${res.error}`, 'warning');
      }
    }
  }

  await dbSaveTrack(track);
  renderLibraryTable();
  updateAnalysisProgress();
  
  if (state.currentTrack && state.currentTrack.path === track.path) {
    state.currentTrack = track;
    updateNowPlayingUI();
  }

  isProcessingMetadata = false;
}

function getHeuristicMetadata(track) {
  const genre = track.genre.toLowerCase();
  let bpm = 100;
  let key = 'C Maj';
  let mood = 'chill';
  
  if (genre.includes('ambient') || genre.includes('classical')) {
    bpm = 70;
    mood = 'chill';
  } else if (genre.includes('lofi') || genre.includes('chill') || genre.includes('downtempo')) {
    bpm = 80;
    mood = 'chill';
  } else if (genre.includes('focus') || genre.includes('acoustic') || genre.includes('jazz') || genre.includes('folk')) {
    bpm = 90;
    mood = 'focus';
  } else if (genre.includes('pop') || genre.includes('r&b') || genre.includes('funk')) {
    bpm = 115;
    mood = 'party';
  } else if (genre.includes('house') || genre.includes('techno') || genre.includes('dance') || genre.includes('disco')) {
    bpm = 125;
    mood = 'party';
  } else if (genre.includes('rock') || genre.includes('grunge') || genre.includes('punk')) {
    bpm = 130;
    mood = 'energy';
  } else if (genre.includes('metal')) {
    bpm = 145;
    mood = 'energy';
  }
  
  const keys = ['C Maj', 'A Min', 'G Maj', 'E Min', 'D Maj', 'B Min', 'A Maj', 'F# Min', 'F Maj', 'D Min', 'Bb Maj', 'G Min'];
  const charCodeSum = track.title.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  key = keys[charCodeSum % keys.length];

  return { bpm, key, mood };
}

// --- DJ Rules & Match Algorithms ---
function isArtistAllowed(artist) {
  if (!artist || artist === 'Unknown Artist') return true;
  const now = Date.now();
  const timeLimit = 20 * 60 * 1000; // 20 minutes

  // (a) Recently PLAYED within the window?
  const recentPlay = state.history.find(h => h.artist === artist && (now - h.playedAt) < timeLimit);
  if (recentPlay) return false;

  // (b) Already sitting in the lookahead QUEUE? Queued tracks play within a few
  //     minutes, so any same-artist track in the queue would violate the 20-min
  //     rule once it plays. Block it here too.
  const inQueue = state.queue.some(q => q.artist === artist);
  if (inQueue) return false;

  return true;
}

function isSongAllowed(path) {
  const now = Date.now();
  const timeLimit = 60 * 60 * 1000; // 60 minutes

  // (a) Recently PLAYED within the window?
  const recentPlay = state.history.find(h => h.path === path && (now - h.playedAt) < timeLimit);
  if (recentPlay) return false;

  // (b) Already in the lookahead QUEUE?
  const inQueue = state.queue.some(q => q.path === path);
  if (inQueue) return false;

  return true;
}

function areGenresCompatible(genre1, genre2) {
  genre1 = genre1.toLowerCase();
  genre2 = genre2.toLowerCase();
  
  if (genre1 === 'unknown' || genre2 === 'unknown' || genre1 === genre2) return true;
  
  const mildGenres = ['ambient', 'classical', 'orchestral', 'opera', 'lofi', 'acoustic', 'study', 'folk', 'downtempo', 'jazz', 'new age', 'meditative', 'chillout'];
  const heavyGenres = ['metal', 'heavy metal', 'death metal', 'thrash metal', 'hardcore', 'punk', 'grunge', 'hard rock', 'industrial', 'thrash', 'screamo'];
  
  const isMild1 = mildGenres.some(g => genre1.includes(g));
  const isMild2 = mildGenres.some(g => genre2.includes(g));
  
  const isHeavy1 = heavyGenres.some(g => genre1.includes(g));
  const isHeavy2 = heavyGenres.some(g => genre2.includes(g));
  
  if ((isMild1 && isHeavy2) || (isHeavy1 && isMild2)) {
    return false;
  }
  
  return true;
}

// --- Queue Builder ---
async function fillQueue() {
  if (state.library.length === 0) return;
  
  while (state.queue.length < 3) {
    logConsole('DJ Engine: Selecting next track...', 'info');
    const nextTrack = await getNextDJTrack();
    if (!nextTrack) break;
    state.queue.push(nextTrack);
    renderQueue();
  }
}

async function getNextDJTrack() {
  // Layer 1: Strict constraints
  let candidates = state.library.filter(track => {
    if (state.queue.some(q => q.path === track.path)) return false;
    if (state.currentTrack && state.currentTrack.path === track.path) return false;
    if (state.currentTrack && !areGenresCompatible(state.currentTrack.genre, track.genre)) return false;
    if (!isArtistAllowed(track.artist)) return false;
    if (!isSongAllowed(track.path)) return false;
    return true;
  });

  // Layer 2: Relax genre constraints
  if (candidates.length === 0) {
    candidates = state.library.filter(track => {
      if (state.queue.some(q => q.path === track.path)) return false;
      if (state.currentTrack && state.currentTrack.path === track.path) return false;
      if (!isArtistAllowed(track.artist)) return false;
      if (!isSongAllowed(track.path)) return false;
      return true;
    });
  }

  // Layer 3: Relax artist constraints
  if (candidates.length === 0) {
    candidates = state.library.filter(track => {
      if (state.queue.some(q => q.path === track.path)) return false;
      if (state.currentTrack && state.currentTrack.path === track.path) return false;
      if (!isSongAllowed(track.path)) return false;
      return true;
    });
  }

  // Layer 4: Absolute fallback
  if (candidates.length === 0) {
    candidates = state.library.filter(track => {
      if (state.queue.some(q => q.path === track.path)) return false;
      if (state.currentTrack && state.currentTrack.path === track.path) return false;
      return true;
    });
  }

  if (candidates.length === 0) return null;

  const currentBpm = state.currentTrack?.bpm || 100;
  const currentGenre = state.currentTrack?.genre || 'unknown';
  const currentKey = state.currentTrack?.key || 'C Maj';

  // Track selection is handled by the heuristic rule engine below.
  // (The previous LLM "DJ" selection step was removed when Gemma was replaced
  //  by Essentia.js — Essentia does audio analysis, not track-choice reasoning.)

  // Heuristic Rule Engine
  const scoredCandidates = candidates.map(c => {
    const noise = Math.random() * 30;
    return {
      track: c,
      score: getHeuristicScore(c, currentBpm, currentGenre, currentKey) + noise
    };
  });

  scoredCandidates.sort((a, b) => b.score - a.score);
  
  const poolSize = Math.min(5, scoredCandidates.length);
  const candidatePool = scoredCandidates.slice(0, poolSize);
  const chosenIndex = Math.floor(Math.random() * candidatePool.length);
  const best = candidatePool[chosenIndex].track;

  let reason = `Transitioning into a smooth ${best.genre} vibe with "${best.title}" by ${best.artist}.`;
  if (state.currentTrack) {
    const bpmDiff = Math.abs((best.bpm || 100) - currentBpm);
    if (bpmDiff < 10) {
      reason = `Matching the tempo at ${best.bpm} BPM, here is "${best.title}" by ${best.artist}.`;
    } else if (best.key === currentKey) {
      reason = `Keeping the harmonic key of ${best.key} going with "${best.title}".`;
    }
  }

  logConsole(`Heuristic DJ selected: "${best.title}" by ${best.artist} (Score: ${candidatePool[chosenIndex].score.toFixed(1)})`, 'system');
  return {
    path: best.path,
    reason: reason
  };
}

function getHeuristicScore(track, currentBpm, currentGenre, currentKey) {
  let score = 0;
  
  // 1. Mood Matching (Primary Factor)
  if (state.mood === 'custom') {
    const promptWords = state.customMoodPrompt.toLowerCase().split(' ');
    const searchArea = `${track.title} ${track.artist} ${track.genre} ${track.mood || ''}`.toLowerCase();
    let matches = 0;
    promptWords.forEach(w => {
      if (w.length > 2 && searchArea.includes(w)) matches++;
    });
    score += matches * 100;
  } else {
    if (track.mood && track.mood.toLowerCase() === state.mood.toLowerCase()) {
      score += 200;
    } else if (track.mood) {
      const tMood = track.mood.toLowerCase();
      if (state.mood === 'energy' && (tMood.includes('energetic') || tMood.includes('upbeat') || tMood.includes('fast') || tMood.includes('intense') || tMood.includes('heavy'))) {
        score += 150;
      } else if (state.mood === 'chill' && (tMood.includes('mellow') || tMood.includes('relax') || tMood.includes('ambient') || tMood.includes('calm') || tMood.includes('soft') || tMood.includes('quiet'))) {
        score += 150;
      } else if (state.mood === 'focus' && (tMood.includes('study') || tMood.includes('concentration') || tMood.includes('steady') || tMood.includes('instrumental') || tMood.includes('calm') || tMood.includes('ambient'))) {
        score += 150;
      } else if (state.mood === 'party' && (tMood.includes('dance') || tMood.includes('groove') || tMood.includes('funky') || tMood.includes('upbeat') || tMood.includes('house'))) {
        score += 150;
      }
    }

    const profile = moodProfiles[state.mood];
    if (profile) {
      const trackGenre = track.genre.toLowerCase();
      const genreMatch = profile.targetGenres.some(tg => trackGenre.includes(tg));
      if (genreMatch) score += 50;
    }
  }

  // 2. Transitions, BPM, and Key (Secondary Factors)
  const profile = state.mood !== 'custom' ? moodProfiles[state.mood] : null;
  if (profile && track.bpm && track.bpm >= profile.bpmRange[0] && track.bpm <= profile.bpmRange[1]) {
    score += 20;
  }

  if (state.currentTrack) {
    if (areGenresCompatible(currentGenre, track.genre)) {
      score += 10;
    } else {
      score -= 100;
    }

    if (track.bpm) {
      const bpmDiff = Math.abs(track.bpm - currentBpm);
      if (bpmDiff < 10) score += 20;
      else if (bpmDiff < 20) score += 10;
      else score -= 15;
    }

    if (track.key && track.key === currentKey) {
      score += 10;
    }
  }

  return score;
}

// --- Player controls setup ---
function setUpAudioPlayerControls() {
  btnPlay.addEventListener('click', () => {
    if (state.library.length === 0) {
      logConsole('No music in library. Please select a folder and scan first.', 'warning');
      return;
    }
    if (!state.currentTrack) {
      playNextFromQueue();
    } else {
      sendAudioCommand('toggle-playback');
    }
  });

  btnNext.addEventListener('click', () => {
    skipTrack();
  });

  btnPrev.addEventListener('click', () => {
    if (state.currentTime > 3 || state.history.length <= 1) {
      sendAudioCommand('seek', { time: 0 });
    } else {
      // Pop current and pop previous to play it
      state.history.pop(); 
      const prev = state.history.pop();
      if (prev) {
        state.isCrossfading = false;
        const track = state.library.find(t => t.path === prev.path);
        playTrack(track);
      }
    }
  });

  volumeSlider.addEventListener('input', (e) => {
    const vol = e.target.value / 100;
    state.masterVolume = vol;
    sendAudioCommand('set-volume', { volume: vol });
    updateVolumeIcon(vol);
  });

  btnMute.addEventListener('click', () => {
    // Mute/Unmute command triggers volume toggle in audio process
    // Let's implement mute by sending a zero volume, or simple toggle mute
    // Here we can just toggle muted state locally and send command
    state.isMuted = !state.isMuted;
    sendAudioCommand('set-volume', { volume: state.isMuted ? 0 : state.masterVolume });
    
    if (state.isMuted) {
      svgVolume.innerHTML = `<path d="M11 5 6 9H2v6h4l5 4V5zm2 5 4 4m0-4-4 4" stroke="currentColor" stroke-width="2"></path>`;
    } else {
      updateVolumeIcon(state.masterVolume);
    }
  });

  progressSlider.addEventListener('mousedown', () => {
    if (!state.currentTrack || state.isCrossfading) return;
    state.isDraggingSlider = true;
  });

  progressSlider.addEventListener('touchstart', () => {
    if (!state.currentTrack || state.isCrossfading) return;
    state.isDraggingSlider = true;
  });

  progressSlider.addEventListener('input', (e) => {
    if (!state.currentTrack || state.isCrossfading) return;
    state.isDraggingSlider = true;
    const seekTime = (e.target.value / 100) * state.duration;
    trackDurationCurrent.innerText = formatDuration(seekTime);
  });

  progressSlider.addEventListener('change', (e) => {
    if (!state.currentTrack || state.isCrossfading) return;
    const seekTime = (e.target.value / 100) * state.duration;
    sendAudioCommand('seek', { time: seekTime });
    state.isDraggingSlider = false;
  });
}

function updateVolumeIcon(vol) {
  if (vol === 0) {
    svgVolume.innerHTML = `<path d="M11 5 6 9H2v6h4l5 4V5zm2 5 4 4m0-4-4 4" stroke="currentColor" stroke-width="2"></path>`;
  } else if (vol < 0.5) {
    svgVolume.innerHTML = `<path d="M11 5 6 9H2v6h4l5 4V5zm4 3a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2"></path>`;
  } else {
    svgVolume.innerHTML = `<path d="M11 5 6 9H2v6h4l5 4V5zm4 3a5 5 0 0 1 0 8m2.5-12a9 9 0 0 1 0 16" stroke="currentColor" stroke-width="2"></path>`;
  }
}

async function playTrack(track) {
  if (!track) return;
  state.currentTrack = track;
  state.isCrossfading = false;
  
  // Instruct audio process to play
  sendAudioCommand('play-track', { track });
  updateNowPlayingUI();
  
  await fillQueue();
}

async function playNextFromQueue() {
  await fillQueue();
  if (state.queue.length > 0) {
    const nextItem = state.queue.shift();
    const track = state.library.find(t => t.path === nextItem.path);
    renderQueue();
    await playTrack(track);
  }
}

async function skipTrack() {
  await fillQueue();
  if (state.queue.length > 0) {
    const nextItem = state.queue.shift();
    const track = state.library.find(t => t.path === nextItem.path);
    renderQueue();
    
    if (state.currentTrack && state.isPlaying) {
      sendAudioCommand('start-crossfade', { nextTrack: track });
    } else {
      await playTrack(track);
    }
  }
}

function updateNowPlayingUI() {
  if (!state.currentTrack) return;
  trackTitle.innerText = state.currentTrack.title;
  trackArtist.innerText = state.currentTrack.artist;
  trackAlbum.innerText = state.currentTrack.album || 'Unknown Album';
  
  genreBadge.innerText = state.currentTrack.genre;
  bpmBadge.innerText = state.currentTrack.bpm ? `${state.currentTrack.bpm} BPM` : '-- BPM';
  keyBadge.innerText = state.currentTrack.key || 'Key';
  moodBadge.innerText = state.currentTrack.mood ? state.currentTrack.mood.charAt(0).toUpperCase() + state.currentTrack.mood.slice(1) : 'Unknown Mood';
  trackDurationTotal.innerText = formatDuration(state.currentTrack.duration);

  if (state.currentTrack.albumArt) {
    albumArt.src = state.currentTrack.albumArt;
  } else {
    albumArt.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231e1b4b'/><circle cx='50' cy='50' r='40' fill='none' stroke='%234f46e5' stroke-width='2'/><path d='M30 50 A20 20 0 0 1 70 50' fill='none' stroke='%230d9488' stroke-width='2'/></svg>`;
  }

  const rows = libraryTableBody.querySelectorAll('tr');
  rows.forEach(row => {
    if (row.dataset.path === state.currentTrack.path) {
      row.classList.add('playing');
    } else {
      row.classList.remove('playing');
    }
  });
}

function formatDuration(sec) {
  if (isNaN(sec) || sec === Infinity) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- Simulated Glowing Canvas Visualizer ---
let animFrameId = null;

function startSimulatedVisualizer() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  drawSimulatedVisualizer();
}

function drawSimulatedVisualizer() {
  animFrameId = requestAnimationFrame(drawSimulatedVisualizer);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!state.isPlaying) return;

  const time = Date.now() * 0.003;
  const numBars = 48;
  const barWidth = canvas.width / numBars;
  
  for (let i = 0; i < numBars; i++) {
    const speedMultiplier = 1 + (i % 3) * 0.5;
    const waveValue = Math.sin(time * speedMultiplier + i * 0.15) * 0.5 + 0.5;
    const noise = Math.random() * 0.15;
    
    const barHeight = Math.max(4, (waveValue + noise) * canvas.height * 0.9);
    const x = i * barWidth;
    
    const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
    grad.addColorStop(0, '#0d9488');
    grad.addColorStop(0.6, '#8b5cf6');
    grad.addColorStop(1, '#ec4899');

    ctx.fillStyle = grad;
    ctx.fillRect(x + 2, canvas.height - barHeight, barWidth - 4, barHeight);
  }
}

// --- MusicBrainz Internet Metadata Enrichment ---
async function enrichMetadata(artist, title) {
  if (!state.isEnrichmentEnabled) return;

  enrichmentContent.innerHTML = `
    <div class="enrichment-placeholder">
      <div class="pulse-dot"></div>
      <p style="margin-top: 8px;">Querying MusicBrainz Database...</p>
    </div>
  `;

  try {
    const artistClean = artist.replace(/feat\..*/i, '').replace(/ft\..*/i, '').trim();
    const query = `artist:"${artistClean}" AND recording:"${title}"`;
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'YourOwnPersonalDJ/1.0.0 ( techn.personal.dj@gmail.com )'
      }
    });

    if (!response.ok) throw new Error('MusicBrainz response was not ok');

    const data = await response.json();
    const recordings = data.recordings || [];

    if (recordings.length === 0) {
      enrichmentContent.innerHTML = `
        <div class="enrichment-placeholder">
          <p>No additional metadata found on MusicBrainz for this track.</p>
        </div>
      `;
      return;
    }

    const rec = recordings[0];
    const releases = rec.releases || [];
    const tags = rec.tags || [];
    
    const albumName = releases.length > 0 ? releases[0].title : 'Unknown Album';
    const releaseDate = releases.length > 0 ? (releases[0].date || 'Unknown') : 'Unknown';
    const country = releases.length > 0 ? (releases[0].country || 'Unknown') : 'Unknown';
    const tagsList = tags.slice(0, 4).map(t => t.name).join(', ') || 'None';

    enrichmentContent.innerHTML = `
      <div style="display:flex; flex-direction:column; gap: 8px;">
        <div style="font-size:0.9rem; font-weight:700; color:white;">${rec.title}</div>
        <div style="font-size:0.78rem; color:var(--primary-hover); margin-bottom: 4px;">by ${rec['artist-credit']?.[0]?.name || artist}</div>
        
        <div class="enriched-data-grid">
          <div class="enriched-tag">
            <strong>Album</strong>
            ${albumName}
          </div>
          <div class="enriched-tag">
            <strong>Release Date</strong>
            ${releaseDate}
          </div>
          <div class="enriched-tag">
            <strong>Country</strong>
            ${country}
          </div>
          <div class="enriched-tag">
            <strong>Tags / Genres</strong>
            ${tagsList}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Internet Enrichment error:', err);
    enrichmentContent.innerHTML = `
      <div class="enrichment-placeholder">
        <p>Offline / Could not connect to MusicBrainz database.</p>
      </div>
    `;
  }
}

toggleEnrichment.addEventListener('change', (e) => {
  state.isEnrichmentEnabled = e.target.checked;
  if (!state.isEnrichmentEnabled) {
    enrichmentContent.innerHTML = `
      <div class="enrichment-placeholder">
        <p>Internet Metadata is disabled.</p>
      </div>
    `;
  } else if (state.currentTrack) {
    enrichMetadata(state.currentTrack.artist, state.currentTrack.title);
  }
});

// --- Mood Selection Cards ---
moodsContainer.addEventListener('click', async (e) => {
  const card = e.target.closest('.mood-card');
  if (!card) return;

  moodsContainer.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');

  const selectedMood = card.dataset.mood;
  state.mood = selectedMood;

  if (selectedMood === 'custom') {
    customMoodContainer.classList.remove('hidden');
    customMoodInput.focus();
  } else {
    customMoodContainer.classList.add('hidden');
    state.customMoodPrompt = '';
    
    logConsole(`Mood changed to: ${selectedMood.toUpperCase()}`, 'info');
    
    state.queue = [];
    renderQueue();
    await fillQueue();
    
    if (state.isPlaying && state.currentTrack) {
      logConsole(`DJ Vibe Shift: Crossfading into ${selectedMood.toUpperCase()} mood track immediately...`, 'info');
      skipTrack();
    }
  }
});

btnApplyCustomMood.addEventListener('click', () => {
  applyCustomMood();
});

customMoodInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    applyCustomMood();
  }
});

async function applyCustomMood() {
  const prompt = customMoodInput.value.trim();
  if (!prompt) return;

  state.customMoodPrompt = prompt;
  logConsole(`Custom Mood Prompt applied: "${prompt}"`, 'info');

  state.queue = [];
  renderQueue();
  await fillQueue();
  
  if (state.isPlaying && state.currentTrack) {
    logConsole(`DJ Vibe Shift: Crossfading into custom mood ("${prompt}") immediately...`, 'info');
    skipTrack();
  }
}

// --- Library Views & Search Rendering ---
function renderLibraryTable() {
  const query = librarySearch.value.trim().toLowerCase();
  
  const filtered = state.library.filter(track => {
    if (!query) return true;
    return (
      track.title.toLowerCase().includes(query) ||
      track.artist.toLowerCase().includes(query) ||
      (track.album && track.album.toLowerCase().includes(query)) ||
      track.genre.toLowerCase().includes(query)
    );
  });

  libraryTableBody.innerHTML = '';
  
  if (filtered.length === 0) {
    libraryTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center">No matching tracks found.</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(track => {
    const tr = document.createElement('tr');
    tr.dataset.path = track.path;
    
    if (state.currentTrack && state.currentTrack.path === track.path) {
      tr.className = 'playing';
    }

    tr.innerHTML = `
      <td title="${track.title}">${track.title}</td>
      <td title="${track.artist}">${track.artist}</td>
      <td title="${track.album || ''}">${track.album || ''}</td>
      <td>${track.genre}</td>
      <td class="text-center">${track.bpm ? track.bpm : '<span style="color:var(--text-dark);">--</span>'}</td>
      <td class="text-center">${track.key ? track.key : '<span style="color:var(--text-dark);">--</span>'}</td>
      <td class="text-center" style="text-transform: capitalize;">${track.mood ? track.mood : '<span style="color:var(--text-dark);">--</span>'}</td>
      <td>${formatDuration(track.duration)}</td>
      <td style="text-transform: uppercase;">${track.format}</td>
    `;

    tr.addEventListener('dblclick', () => {
      state.queue = [];
      renderQueue();
      playTrack(track);
    });

    libraryTableBody.appendChild(tr);
  });
}

librarySearch.addEventListener('input', () => {
  renderLibraryTable();
});

function renderQueue() {
  comingUpList.innerHTML = '';
  
  if (state.queue.length === 0) {
    comingUpList.innerHTML = `<div class="empty-queue-text">No tracks queued. Add music and hit Play.</div>`;
    return;
  }

  state.queue.forEach((item, idx) => {
    const track = state.library.find(t => t.path === item.path);
    if (!track) return;

    const div = document.createElement('div');
    div.className = 'queue-item';
    
    const art = document.createElement('img');
    art.className = 'queue-art';
    if (track.albumArt) {
      art.src = track.albumArt;
    } else {
      art.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231e1b4b'/><circle cx='50' cy='50' r='40' fill='none' stroke='%234f46e5' stroke-width='2'/></svg>`;
    }

    const info = document.createElement('div');
    info.className = 'queue-info';
    
    const title = document.createElement('div');
    title.className = 'queue-title';
    title.innerText = track.title;
    
    const artist = document.createElement('div');
    artist.className = 'queue-artist';
    artist.innerText = track.artist;

    info.appendChild(title);
    info.appendChild(artist);

    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    
    const bpm = document.createElement('span');
    bpm.className = 'queue-bpm';
    bpm.innerText = track.bpm ? `${track.bpm} BPM` : '-- BPM';

    const reason = document.createElement('span');
    reason.className = 'queue-reason';
    reason.innerText = item.reason || '';
    reason.title = item.reason || '';

    meta.appendChild(bpm);
    meta.appendChild(reason);

    div.appendChild(art);
    div.appendChild(info);
    div.appendChild(meta);
    
    comingUpList.appendChild(div);
  });
}

function updateAIStatusUI() {
  aiStatusBadge.className = `ai-status-badge ${state.ollamaStatus}`;
  
  if (state.ollamaStatus === 'connected') {
    aiStatusText.innerText = 'Active';
    aiModelName.innerText = state.ollamaModel;
  } else if (state.ollamaStatus === 'checking') {
    aiStatusText.innerText = 'Loading...';
    aiModelName.innerText = 'Initializing Essentia...';
  } else if (state.ollamaStatus === 'fallback') {
    aiStatusText.innerText = 'Heuristics';
    aiModelName.innerText = 'Rule-based Heuristics';
  } else {
    aiStatusText.innerText = 'Offline';
    aiModelName.innerText = 'Local Heuristics';
  }
}

// Decode an audio file to a mono Float32Array at 44100 Hz for Essentia analysis.
// Decoding uses OfflineAudioContext (renderer-only); the resulting samples are
// then transferred to the Essentia worker.
async function decodeTrackToMono(trackPath) {
  const secureUrl = 'app-media:///' + trackPath.replace(/\\/g, '/');
  const response = await fetch(secureUrl);
  if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  // Force 44100 Hz so Essentia's default-sample-rate algorithms stay accurate.
  const ctx = new (window.OfflineAudioContext || window.AudioContext)(1, 44100, 44100);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const mono = new Float32Array(len);

  if (channels === 1) {
    mono.set(audioBuffer.getChannelData(0));
  } else {
    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < len; i++) {
        mono[i] += data[i] / channels;
      }
    }
  }

  return { samples: mono, sampleRate };
}

// Transient detection helper (fallback beat detector)
async function runTransientAnalysis(trackPath, knownBpm) {
  const secureUrl = 'app-media:///' + trackPath.replace(/\\/g, '/');
  const response = await fetch(secureUrl);
  if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
  
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new (window.OfflineAudioContext || window.AudioContext)(1, 44100, 44100);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const duration = Math.min(audioBuffer.duration, 30);
  
  const stepSeconds = 0.01;
  const stepSamples = Math.floor(sampleRate * stepSeconds);
  const numSteps = Math.floor(duration / stepSeconds);
  
  const envelope = new Float32Array(numSteps);
  for (let i = 0; i < numSteps; i++) {
    const startSample = i * stepSamples;
    let sum = 0;
    const endSample = Math.min(startSample + stepSamples, channelData.length);
    for (let j = startSample; j < endSample; j++) {
      sum += Math.abs(channelData[j]);
    }
    envelope[i] = sum / (endSample - startSample || 1);
  }
  
  const peakTimes = [];
  const peakAmplitudes = [];
  const movingAverageWindow = 15;
  
  for (let i = movingAverageWindow; i < numSteps - movingAverageWindow; i++) {
    let localSum = 0;
    for (let j = i - movingAverageWindow; j <= i + movingAverageWindow; j++) {
      localSum += envelope[j];
    }
    const localAvg = localSum / (2 * movingAverageWindow + 1);
    
    if (envelope[i] > localAvg * 1.3 && 
        envelope[i] > envelope[i - 1] && 
        envelope[i] > envelope[i + 1] &&
        envelope[i] > envelope[i - 2] &&
        envelope[i] > envelope[i + 2]) {
      peakTimes.push(i * stepSeconds);
      peakAmplitudes.push(envelope[i]);
    }
  }
  
  if (peakTimes.length === 0) {
    return { bpm: knownBpm || 100, beatOffset: 0 };
  }
  
  let bpm = knownBpm;
  if (!bpm) {
    const intervals = [];
    for (let i = 0; i < peakTimes.length; i++) {
      for (let j = i + 1; j < Math.min(i + 10, peakTimes.length); j++) {
        const interval = peakTimes[j] - peakTimes[i];
        if (interval >= 0.3 && interval <= 1.2) {
          intervals.push(interval);
        }
      }
    }
    
    if (intervals.length > 0) {
      const bpmCandidates = intervals.map(inv => 60 / inv);
      let bestBpm = 100;
      let maxCount = 0;
      
      for (let targetBpm = 60; targetBpm <= 180; targetBpm++) {
        let count = 0;
        for (const cand of bpmCandidates) {
          if (Math.abs(cand - targetBpm) <= 1.5) {
            count++;
          }
          if (Math.abs(cand * 2 - targetBpm) <= 1.5) {
            count += 0.5;
          }
          if (Math.abs(cand / 2 - targetBpm) <= 1.5) {
            count += 0.5;
          }
        }
        if (count > maxCount) {
          maxCount = count;
          bestBpm = targetBpm;
        }
      }
      bpm = bestBpm;
    } else {
      bpm = 100;
    }
  }
  
  const T = 60 / bpm;
  let bestOffset = 0;
  let maxScore = -1;
  const numCandidates = 100;
  const sigma = 0.03;
  
  for (let c = 0; c < numCandidates; c++) {
    const candidateOffset = (c / numCandidates) * T;
    let score = 0;
    
    for (let p = 0; p < peakTimes.length; p++) {
      const peakTime = peakTimes[p];
      const amp = peakAmplitudes[p];
      
      const rem = (peakTime - candidateOffset) % T;
      const dist = Math.min(Math.abs(rem), T - Math.abs(rem));
      
      score += amp * Math.exp(-(dist * dist) / (2 * sigma * sigma));
    }
    
    if (score > maxScore) {
      maxScore = score;
      bestOffset = candidateOffset;
    }
  }
  
  return { bpm, beatOffset: parseFloat(bestOffset.toFixed(3)) };
}
