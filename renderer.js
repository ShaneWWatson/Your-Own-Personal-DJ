/**
 * @file renderer.js — Main UI renderer process.
 *
 * Responsibilities: library state and IndexedDB persistence, the heuristic
 * DJ selection engine (Sonic DNA), background processors (Essentia analysis,
 * album-art repair, file-health), MusicBrainz enrichment, and all dashboard
 * UI interactions. Audio playback itself lives in audio-renderer.js.
 *
 * @license AGPL-3.0-or-later
 * @copyright 2026 Shane W Watson
 */

/**
 * Escape a string for safe interpolation into HTML templates (DOM-XSS guard).
 * @param {*} str - Any value; null/undefined become an empty string.
 * @returns {string} HTML-safe text.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// State Management
let state = {
  library: [],
  queue: [],
  history: [],
  mood: 'chill', // default
  customMoodPrompt: '',

  // Lyric Mood AI: "<moodKey>::<path>" → true/false (does the lyric fit?).
  // In-memory only; rebuilt on demand per mood. moodKey is the mood name, or
  // "custom::<prompt>" for custom vibes, so verdicts never leak across moods.
  lyricVerdicts: new Map(),
  currentTrack: null,
  isPlaying: false,
  isScanning: false,
  folders: [],
  engineStatus: 'checking', // checking, connected, fallback, offline
  engineModel: null,
  isEnrichmentEnabled: true,
  
  // DJ Settings
  crossfadeDuration: 10, // must match the audio-renderer default and the settings slider value
  isCrossfading: false,
  masterVolume: 0.8,
  outputDeviceId: 'default',
  isDraggingSlider: false,
  currentTime: 0,
  duration: 0
};

// Base64 encoded generic record label to ensure it loads reliably across all systems
const GENERIC_LABEL_SVG = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJncmFkIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj48c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjOGI1Y2Y2IiAvPjxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI2VjNDg5OSIgLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0idXJsKCNncmFkKSIgLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0NCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMjUpIiBzdHJva2Utd2lkdGg9IjEuNSIgLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSIzOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMTUpIiBzdHJva2Utd2lkdGg9IjEiIC8+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iMjgiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIiBzdHJva2Utd2lkdGg9IjEiIC8+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMykiIHN0cm9rZS13aWR0aD0iMSIgLz48dGV4dCB4PSI1MCIgeT0iMzgiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWksIC1hcHBsZS1zeXN0ZW0sIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIiIGZvbnQtd2VpZ2h0PSI5MDAiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGxldHRlci1zcGFjaW5nPSIxIj5ZT1A8L3RleHQ+PHRleHQgeD0iNTAiIHk9IjcwIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCAtYXBwbGUtc3lzdGVtLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBmb250LXdlaWdodD0iOTAwIiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBsZXR0ZXItc3BhY2luZz0iMSI+REo8L3RleHQ+PHRleHQgeD0iNTAiIHk9IjIyIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCAtYXBwbGUtc3lzdGVtLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjQiIGZvbnQtd2VpZ2h0PSI3MDAiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC44KSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgbGV0dGVyLXNwYWNpbmc9IjIiPlBFUlNPTkFMIE1JWDwvdGV4dD48dGV4dCB4PSI1MCIgeT0iODIiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWksIC1hcHBsZS1zeXN0ZW0sIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNCIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjgpIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBsZXR0ZXItc3BhY2luZz0iMiI+QUkgTVVTSUMgRU5HSU5FPC90ZXh0Pjwvc3ZnPg==`;

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

// Lyric Mood AI + crisis support modal
const lyricAiStatusBadge = document.getElementById('lyric-ai-status-badge');
const lyricAiProviderSelect = document.getElementById('lyric-ai-provider-select');
const anthropicConfigFields = document.getElementById('anthropic-config-fields');
const anthropicKeyInput = document.getElementById('anthropic-key-input');
const anthropicModelSelect = document.getElementById('anthropic-model-select');
const btnSaveAiConfig = document.getElementById('btn-save-ai-config');
const crisisModal = document.getElementById('crisis-modal');
const btnCrisis988 = document.getElementById('btn-crisis-988');
const btnCrisisContinue = document.getElementById('btn-crisis-continue');
const btnCrisisCancel = document.getElementById('btn-crisis-cancel');

const trackTitle = document.getElementById('track-title');
const trackArtist = document.getElementById('track-artist');
const trackAlbum = document.getElementById('track-album');
const albumArt = document.getElementById('album-art');
albumArt.onerror = () => {
  if (!albumArt.src.startsWith('data:image/svg+xml')) {
    albumArt.src = GENERIC_LABEL_SVG;
  }
};
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
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains('playHistory')) {
        const histStore = db.createObjectStore('playHistory', { autoIncrement: true });
        histStore.createIndex('playedAt', 'playedAt', { unique: false });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function dbSaveHistoryEntry(entry) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('playHistory', 'readwrite');
      const store = transaction.objectStore('playHistory');
      store.add(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.error('Error saving history entry:', err);
  }
}

async function dbLoadHistory() {
  try {
    const db = await openDB();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction('playHistory', 'readonly');
      const req = tx.objectStore('playHistory').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const cutoff = Date.now() - (2 * 60 * 60 * 1000);
    return all.filter(h => h.playedAt > cutoff);
  } catch (err) {
    console.error('Error loading history:', err);
    return [];
  }
}

async function dbPruneHistory() {
  try {
    const db = await openDB();
    const cutoff = Date.now() - (2 * 60 * 60 * 1000);
    await new Promise((resolve) => {
      const tx = db.transaction('playHistory', 'readwrite');
      const index = tx.objectStore('playHistory').index('playedAt');
      index.openCursor(IDBKeyRange.upperBound(cutoff, true)).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.error('Error pruning history:', err);
  }
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
  state.engineStatus = 'checking';
  updateAIStatusUI();
  logConsole('Initializing local AI Web Worker thread...', 'system');

  aiWorker = new Worker('audio-analysis-worker.js?v=' + Date.now(), { type: 'module' });

  aiWorker.onmessage = (event) => {
    const { type, id, data, error } = event.data;

    if (type === 'status-update') {
      const { status, model, log, logType } = data;
      if (status) {
        state.engineStatus = status;
        updateAIStatusUI();
      }
      if (model) {
        state.engineModel = model;
        updateAIStatusUI();
      }
      if (log) {
        logConsole(log, logType || 'system');
      }
      if (data.detail && window.api.logDebug) {
        window.api.logDebug(`[engine-detail] ${data.detail}`);
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
    if (window.api.logDebug) window.api.logDebug(`[worker-error] ${err.message || 'unknown worker error'}`);
    logConsole('The audio analysis engine ran into a problem — analysis will continue with a simpler method. (Details saved to debug.log.)', 'danger');
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

      case 'seeked':
        state.isDraggingSlider = false;
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

function handleCrossfadeStart(track) {
  // Sync state
  state.currentTrack = track;
  state.isCrossfading = true; // Set crossfading state temporarily during switch
  updateNowPlayingUI();

  // Save history
  const histEntry = { path: track.path, artist: track.artist, playedAt: Date.now() };
  state.history.push(histEntry);
  dbSaveHistoryEntry(histEntry);
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
    state.library = tracksDB.map(t => {
      t.path = normalizePath(t.path);
      delete t.sonicProfile; // force re-classification with updated rules
      return sanitizeLibraryTrack(t);
    });
    state.folders = foldersListDB.map(normalizePath);
    logConsole(`Loaded ${state.library.length} tracks from IndexedDB cache.`, 'success');
  } else {
    // Database is empty. Check if we need to migrate from legacy library.md
    logConsole('Checking for legacy library.md database for migration...', 'system');
    const migrated = await window.api.loadLibrary();
    if (migrated) {
      state.folders = (migrated.folders || []).map(normalizePath);
      state.library = (migrated.library || []).map(t => {
        t.path = normalizePath(t.path);
        return sanitizeLibraryTrack(t);
      });
      
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
        const normSystemMusic = normalizePath(systemMusic);
        state.folders.push(normSystemMusic);
        await dbAddFolder(normSystemMusic);
      }
    }
  }

  // Restore play history so cooldowns survive close/reopen
  try {
    const savedHistory = await dbLoadHistory();
    state.history = savedHistory;
    if (savedHistory.length > 0) {
      logConsole(`Restored ${savedHistory.length} recent play history entries.`, 'system');
    }
    dbPruneHistory(); // fire-and-forget cleanup of entries older than 2 hours
  } catch (err) {
    console.error('Failed to load play history:', err);
  }

  renderFoldersList();
  renderLibraryTable();
  checkScanButtonState();
  updateAnalysisProgress();

  // Set up settings triggers
  setUpSettings();

  // Set up tabs triggers
  setUpTabs();

  // Set up mood selector
  setUpMoodSelector();

  // Set up Lyric Mood AI settings + crisis support modal
  setUpAiSettings();
  setUpCrisisModal();

  // Set up audio player triggers (UI side)
  setUpAudioPlayerControls();

  // Initialize local AI engine in Worker
  initAIWorker();

  // Start background metadata processor
  setInterval(backgroundMetadataProcessor, 6000);

  // Start background album-art inspector/repairer (staggered so the two
  // processors and MusicBrainz requests don't pile up)
  setInterval(backgroundArtProcessor, 9000);

  // Start background file-health inspector (damage detection + MP3 repair)
  setInterval(backgroundHealthProcessor, 10000);
});

window.addEventListener('resize', () => {
  canvas.width = canvas.parentElement.clientWidth;
});

/**
 * Append a line to the on-screen console and mirror it into debug.log.
 * Auto-scroll only happens when the user is already at the bottom of the log.
 * @param {string} message - Human-readable message (already user-friendly).
 * @param {'system'|'info'|'success'|'warning'|'danger'|'ai'} [type='system']
 */
function logConsole(message, type = 'system') {
  const line = document.createElement('div');
  line.className = `console-line ${type}`;

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  line.innerText = `[${timeStr}] ${message}`;

  // Only follow the newest message if the user is already at (or near) the
  // bottom of the log. If they have scrolled up to read something, leave
  // their view exactly where it is.
  const wasAtBottom = (aiConsole.scrollHeight - aiConsole.scrollTop - aiConsole.clientHeight) < 24;
  aiConsole.appendChild(line);
  if (wasAtBottom) {
    aiConsole.scrollTop = aiConsole.scrollHeight;
  }

  // Mirror every console line into debug.log (written next to the executable)
  if (window.api.logDebug) {
    window.api.logDebug(`[${type}] ${message}`);
  }
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

  // Internet Metadata enrichment on/off switch
  toggleEnrichment.addEventListener('change', (e) => {
    state.isEnrichmentEnabled = e.target.checked;
    logConsole(`Internet metadata enrichment ${state.isEnrichmentEnabled ? 'enabled' : 'disabled'}.`, 'info');
    if (state.isEnrichmentEnabled && state.currentTrack) {
      enrichMetadata(state.currentTrack.artist, state.currentTrack.title);
    } else if (!state.isEnrichmentEnabled) {
      enrichmentContent.innerHTML = `
        <div class="enrichment-placeholder">
          <p>Internet Metadata is turned off. Flip the switch to pull details from MusicBrainz.</p>
        </div>
      `;
    }
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

// --- Folder Management & Library Scanning ---
btnAddFolder.addEventListener('click', async () => {
  const folderPath = await window.api.selectFolder();
  if (folderPath) {
    const normalizedFolder = normalizePath(folderPath);
    if (!state.folders.includes(normalizedFolder)) {
      state.folders.push(normalizedFolder);
      renderFoldersList();
      
      await dbAddFolder(normalizedFolder);
      checkScanButtonState();
      logConsole(`Added directory: ${normalizedFolder}`, 'system');
    }
  }
});

function updateAIStatusUI() {
  const statusMap = {
    checking: { label: 'Checking...', cls: 'fallback' },
    connected: { label: 'Connected', cls: 'connected' },
    fallback: { label: 'Heuristic Mode', cls: 'fallback' },
    offline: { label: 'Offline', cls: 'offline' }
  };
  const s = statusMap[state.engineStatus] || statusMap.checking;
  aiStatusBadge.className = `ai-status-badge ${s.cls}`;
  aiStatusText.innerText = s.label;
  aiModelName.innerText = state.engineModel || 'Loading local model...';
}

function renderLibraryTable() {
  const query = (librarySearch.value || '').toLowerCase().trim();
  const tracks = query
    ? state.library.filter(t =>
        (t.title || '').toLowerCase().includes(query) ||
        (t.artist || '').toLowerCase().includes(query) ||
        (t.genre || '').toLowerCase().includes(query)
      )
    : state.library;

  if (tracks.length === 0) {
    libraryTableBody.innerHTML = `<tr><td colspan="9" class="text-center">${
      query ? 'No tracks match your search.' : 'No tracks in library yet. Add folders and scan.'
    }</td></tr>`;
    return;
  }

  libraryTableBody.innerHTML = tracks.map(track => {
    const isPlaying = state.currentTrack && state.currentTrack.path === track.path;
    const mood = track.mood ? track.mood.charAt(0).toUpperCase() + track.mood.slice(1) : '—';
    return `<tr class="${isPlaying ? 'playing' : ''}" data-path="${escapeHtml(track.path)}" style="cursor:pointer">
      <td>${escapeHtml(track.title || '—')}</td>
      <td>${escapeHtml(track.artist || '—')}</td>
      <td>${escapeHtml(track.album || '—')}</td>
      <td>${escapeHtml(track.genre || '—')}</td>
      <td>${track.bpm ? track.bpm : '—'}</td>
      <td>${escapeHtml(track.key || '—')}</td>
      <td>${escapeHtml(mood)}</td>
      <td>${formatDuration(track.duration || 0)}</td>
      <td>${escapeHtml((track.format || '').toUpperCase())}</td>
    </tr>`;
  }).join('');

  libraryTableBody.querySelectorAll('tr[data-path]').forEach(row => {
    row.addEventListener('click', () => {
      const track = state.library.find(t => t.path === row.dataset.path);
      if (track) playTrack(track);
    });
  });
}

if (librarySearch) {
  librarySearch.addEventListener('input', () => renderLibraryTable());
}

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
      
      await dbRemoveFolder(normalizePath(folder));
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

btnStartScan.addEventListener('click', async () => {
  if (state.isScanning) return;
  
  logConsole('Starting full library re-analysis for accuracy...', 'info');

  // Reset metadata for ALL tracks to ensure accuracy across classification, loudness, and art.
  for (const track of state.library) {
    track.path = normalizePath(track.path);
    track.bpm = null;
    track.key = null;
    track.mood = null;
    track.beatOffset = null;
    track.loudness = null;
    track.undecodable = false;
    delete track.isHeuristic;
    delete track.endingCold;
    delete track.artCheckedAt;
    delete track.healthCheckedAt;
    delete track.health;
    // Rescan amnesty: give parked/cooling-down tracks a fresh analysis budget
    clearAnalysisFailure(track);

    // We only clear albumArt if it's NOT a high-quality external URL or long base64 string
    // to give the system a chance to re-fetch/embed it if it was missing or low-res.
    if (!track.albumArt || track.albumArt.length < 500) {
      track.albumArt = null;
    }

    await dbSaveTrack(track);
  }

  logConsole(`Reset ${state.library.length} tracks for full Essentia & Vibe re-analysis.`, 'success');
  renderLibraryTable();
  updateAnalysisProgress();

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

  track.path = normalizePath(track.path);

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
    if (state.library[existingIdx].undecodable) {
      track.undecodable = true;
    }
    if (!isAlbumArtValid(track.albumArt) && isAlbumArtValid(state.library[existingIdx].albumArt)) {
      track.albumArt = state.library[existingIdx].albumArt;
    }
    if (state.library[existingIdx].endingCold !== undefined) {
      track.endingCold = state.library[existingIdx].endingCold;
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
  
  // Clean up dead/deleted paths that were not found in the scan.
  // Skip cleanup entirely if the scan errored or found nothing — otherwise a
  // disconnected drive or failed scan would wipe the whole library.
  if (data.error || data.total === 0) {
    delete state.scannedPaths;
    if (data.error) logConsole(`Scan failed: ${data.error}. Library left untouched.`, 'danger');
  } else if (state.scannedPaths) {
    const deadTracks = state.library.filter(t => !state.scannedPaths.has(normalizePath(t.path)));
    const deadPaths = deadTracks.map(t => normalizePath(t.path));
    
    await dbDeleteTracksBatch(deadPaths);
    state.library = state.library.filter(t => state.scannedPaths.has(normalizePath(t.path)));
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

// --- Shared analysis / repair helpers ---

/**
 * Translate technical errors into plain language for the console.
 * The raw technical message is always preserved in debug.log.
 */
function friendlyError(err, context) {
  const raw = (err && err.message) ? err.message : String(err);
  if (window.api.logDebug) window.api.logDebug(`[error-detail] ${context}: ${raw}`);
  const msg = raw.toLowerCase();

  if (msg.includes('decod')) {
    return 'This file could not be read as audio — it may be damaged or in a format the player does not support.';
  }
  if (msg.includes('fetch failed') || msg.includes('404') || msg.includes('not found')) {
    return 'The file could not be opened — it may have been moved, renamed, or deleted.';
  }
  if (msg.includes('not active') || msg.includes('not ready')) {
    return 'The audio analysis engine is still warming up — this song will be retried automatically.';
  }
  if (msg.includes('memory') || msg.includes('allocation') || msg.includes('abort') || msg.includes('wasm') || msg.includes('out of bounds')) {
    return 'The analysis engine hit a snag on this song — switching to a simpler method.';
  }
  if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('offline')) {
    // "Failed to fetch" during local analysis is the app-media:// file read failing,
    // not a network problem. Same if the OS reports we're online.
    const localContexts = ['essentia-analysis', 'transient-analysis', 'health-check'];
    if (localContexts.includes(context)) {
      // For local analysis, "Failed to fetch" is the app-media:// file read
      // failing — not a network problem.
      return 'This file could not be read for analysis — it may be locked, moved, or too large.';
    }
    if (navigator.onLine === false) {
      return 'No internet connection right now — online features will retry later.';
    }
    // Online, but a genuinely network-bound request (e.g. MusicBrainz art
    // lookup) failed — the service is unreachable, busy, or rate-limiting.
    return 'Couldn’t reach the online music database (it may be busy or rate-limiting) — will retry later.';
  }
  return 'Something unexpected went wrong with this song (technical details were saved to debug.log).';
}

// --- Bounded analysis retries ---
// A track that repeatedly fails analysis is retried with escalating cooldowns,
// then permanently parked until the user runs a manual rescan.
const ANALYSIS_MAX_ATTEMPTS = 3;
const ANALYSIS_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000];
const ART_NET_RETRY_MS = 60 * 60 * 1000; // retry failed art fetches in ~1 hour

function recordAnalysisFailure(track, err) {
  track.analysisFailures = (track.analysisFailures || 0) + 1;
  const msg = ((err && err.message) ? err.message : String(err)).toLowerCase();
  const nonRetryable = msg.includes('too large');

  if (nonRetryable || track.analysisFailures >= ANALYSIS_MAX_ATTEMPTS) {
    track.analysisGaveUp = true;
    delete track.analysisCooldownUntil;
    logConsole(`Giving up on analyzing "${track.title}" after ${track.analysisFailures} attempt(s) — a manual rescan will retry it.`, 'warning');
  } else {
    const idx = Math.min(track.analysisFailures - 1, ANALYSIS_BACKOFF_MS.length - 1);
    track.analysisCooldownUntil = Date.now() + ANALYSIS_BACKOFF_MS[idx];
  }
}

function clearAnalysisFailure(track) {
  delete track.analysisFailures;
  delete track.analysisCooldownUntil;
  delete track.analysisGaveUp;
}

/**
 * Detect a "cold" (abrupt) song ending by comparing the loudness of the final
 * second against the loudness of the preceding ~15 seconds. Songs that are
 * still loud right up to the last moment end cold; songs that taper off were
 * mastered with a fade-out.
 */
function detectColdEnding(samples, sampleRate) {
  const n = samples.length;
  if (!n || n < sampleRate * 5) return false;

  const rmsOf = (start, end) => {
    let sum = 0, count = 0;
    for (let i = Math.max(0, start); i < Math.min(n, end); i += 4) {
      sum += samples[i] * samples[i];
      count++;
    }
    return Math.sqrt(sum / (count || 1));
  };

  const tail = rmsOf(n - Math.floor(sampleRate * 1.0), n);
  const body = rmsOf(n - Math.floor(sampleRate * 16), n - Math.floor(sampleRate * 1.0));
  if (body <= 0.0001) return false;

  return (tail / body) > 0.5;
}

/**
 * Validate stored album art. Catches missing art, stub-length data URLs, and
 * corrupt base64 whose decoded bytes are not a real image (JPEG/PNG/GIF/WebP/BMP).
 */
function isAlbumArtValid(art) {
  if (!art) return false;
  const s = String(art);
  if (s.startsWith('https://')) return true;
  if (!s.startsWith('data:image/')) return false;

  const comma = s.indexOf(',');
  if (comma === -1 || s.length - comma < 500) return false;

  try {
    const head = atob(s.slice(comma + 1, comma + 25));
    const b = [];
    for (let i = 0; i < head.length; i++) b.push(head.charCodeAt(i));

    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;            // JPEG
    if (b[0] === 0x89 && head.slice(1, 4) === 'PNG') return true;                // PNG
    if (head.startsWith('GIF8')) return true;                                    // GIF
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return true;    // WebP
    if (head.startsWith('BM')) return true;                                      // BMP
    return false;
  } catch {
    return false; // base64 itself is corrupt
  }
}

/**
 * Reduce multi-genre tag dumps ("Rock;Pop;Dance/Electronic;...") to the first
 * listed genre and cap runaway lengths. Returns 'Unknown' for blank values.
 */
function cleanGenre(val) {
  if (val === null || val === undefined) return 'Unknown';
  let g = String(val).replace(/\0/g, '').trim();
  if (!g) return 'Unknown';

  const first = g.split(/[;,|/•·]+/)[0].trim();
  if (first) g = first;
  if (g.length > 48) g = g.slice(0, 48).trim();

  return g || 'Unknown';
}

/**
 * Look a track up on MusicBrainz and fetch its cover art from the Cover Art
 * Archive. Returns a base64 data URL, or null if nothing usable was found.
 */
async function fetchArtFromMusicBrainz(track) {
  const artistClean = (track.artist || '').replace(/feat\..*/i, '').replace(/ft\..*/i, '').trim();
  const query = `artist:"${artistClean}" AND recording:"${track.title}"`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json`;

  // No custom headers here: a User-Agent on a cross-origin fetch triggers a
  // CORS preflight the MusicBrainz API rejects. The polite UA is injected at
  // the session layer in main.js instead.
  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json();
  const recordings = data.recordings || [];
  if (recordings.length === 0 || !recordings[0].releases || recordings[0].releases.length === 0) return null;

  const releaseId = recordings[0].releases[0].id;
  const imgResp = await fetch(`https://coverartarchive.org/release/${releaseId}/front-250`);
  if (!imgResp.ok) return null;

  const blob = await imgResp.blob();
  const dataUrl = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });

  return isAlbumArtValid(dataUrl) ? dataUrl : null;
}

// --- Background Album Art Repair ---
// Independently inspects the library for missing or corrupt artwork and
// repairs it from MusicBrainz: saved to the database, and embedded into the
// file's ID3 tags for MP3s. Unfixable tracks are rechecked after 7 days.
let isFetchingArt = false;
const ART_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

async function backgroundArtProcessor() {
  if (isFetchingArt || isProcessingMetadata || state.isScanning || state.library.length === 0) return;

  const track = state.library.find(t =>
    !isAlbumArtValid(t.albumArt) &&
    (!t.artCheckedAt || (Date.now() - t.artCheckedAt) > ART_RECHECK_MS)
  );
  if (!track) return;

  isFetchingArt = true;
  try {
    const hadCorrupt = !!track.albumArt;
    if (hadCorrupt) {
      logConsole(`Album art for "${track.title}" looks corrupt — replacing it from MusicBrainz...`, 'info');
      track.albumArt = null;
    } else {
      logConsole(`Album art missing for "${track.title}" — searching MusicBrainz...`, 'info');
    }

    const dataUrl = await fetchArtFromMusicBrainz(track);
    if (dataUrl) {
      track.albumArt = dataUrl;
      delete track.artCheckedAt;

      if ((track.format || '').toLowerCase() === 'mp3' && !track.undecodable) {
        const res = await window.api.writeTags(track.path, track.bpm, track.key, dataUrl);
        if (!res.success && window.api.logDebug) {
          window.api.logDebug(`[art-embed] Could not embed art into ${track.path}: ${res.error}`);
        }
      }

      logConsole(`Album art repaired for "${track.title}" (saved to database${(track.format || '').toLowerCase() === 'mp3' ? ' and file tags' : ''}).`, 'success');

      if (state.currentTrack && state.currentTrack.path === track.path) {
        state.currentTrack.albumArt = dataUrl;
        albumArt.src = dataUrl;
      }
    } else {
      track.artCheckedAt = Date.now(); // nothing found — recheck in a week
      logConsole(`No album art found online for "${track.title}" — will check again later.`, 'system');
    }

    await dbSaveTrack(track);
  } catch (err) {
    logConsole(`Album art lookup paused: ${friendlyError(err, 'art-repair')}`, 'warning');
    const isNetworkErr = /failed to fetch|network/i.test(err.message || '') || navigator.onLine === false;
    if (isNetworkErr) {
      // Transient network problem — backdate so retry happens in ~1 hour, not 7 days
      track.artCheckedAt = Date.now() - ART_RECHECK_MS + ART_NET_RETRY_MS;
    } else {
      track.artCheckedAt = Date.now(); // hard failure — full 7-day cooldown
    }
    try { await dbSaveTrack(track); } catch { /* non-fatal */ }
  } finally {
    isFetchingArt = false;
  }
}

// --- Background File Health Processor ---
// Inspects each file once for structural damage. MP3s with repairable damage
// are rebuilt automatically (the original is kept as a .bak backup); other
// formats are flagged so the user knows to replace them. Repaired files are
// sent back through audio analysis from scratch.
let isCheckingHealth = false;

async function backgroundHealthProcessor() {
  if (isCheckingHealth || isProcessingMetadata || isFetchingArt || state.isScanning || state.library.length === 0) return;

  // Files that failed to decode get checked first; then everything else, once
  const track = state.library.find(t => t.undecodable && !t.healthCheckedAt) ||
                state.library.find(t => !t.healthCheckedAt);
  if (!track) return;

  isCheckingHealth = true;
  try {
    track.path = normalizePath(track.path);
    const report = await window.api.checkFileHealth(track.path);

    if (!report || report.error) {
      track.healthCheckedAt = Date.now();
      track.health = 'unknown';
      if (report && report.error && window.api.logDebug) {
        window.api.logDebug(`[health] ${track.path}: ${report.error}`);
      }
      await dbSaveTrack(track);
      return;
    }

    if (report.healthy) {
      track.healthCheckedAt = Date.now();
      track.health = 'good';
      if (track.undecodable) {
        // NOTE: deliberately log-only. Resetting `undecodable` here would
        // ping-pong with the metadata processor: it re-fails the decode,
        // re-marks the track, and this branch un-marks it again — forever.
        logConsole(`"${track.title}" couldn't be decoded earlier, but its file structure looks intact — the encoding may simply be unsupported.`, 'info');
      }
      await dbSaveTrack(track);
      return;
    }

    if (!report.scannable) {
      // Structure unreadable — only alarming if playback/decoding also failed
      track.healthCheckedAt = Date.now();
      track.health = track.undecodable ? 'damaged' : 'unverified';
      if (track.undecodable) {
        logConsole(`"${track.title}" appears badly damaged — almost no readable audio was found, and it can't be repaired safely. Re-ripping or re-downloading it is the best fix.`, 'warning');
      }
      await dbSaveTrack(track);
      return;
    }

    // Damage found
    const issueText = (report.issues || []).join('; ');

    if (report.repairable) {
      // Never rewrite the song that is currently playing — retry later
      if (state.currentTrack && state.currentTrack.path === track.path) {
        return;
      }

      logConsole(`Found damage in "${track.title}" (${issueText}) — repairing now. The original is being saved as a backup.`, 'warning');
      const result = await window.api.repairFile(track.path);
      track.healthCheckedAt = Date.now();

      if (result && result.success) {
        track.health = 'repaired';
        track.undecodable = false;
        // Re-analyze the repaired audio from scratch. The file content
        // changed, so the analysis failure budget resets too (bounded:
        // healthCheckedAt prevents a second repair cycle).
        clearAnalysisFailure(track);
        track.bpm = null;
        track.key = null;
        track.mood = null;
        track.beatOffset = null;
        track.loudness = null;
        delete track.endingCold;
        logConsole(`Repaired "${track.title}": removed ${result.junkRemoved} bytes of corrupted data${result.removedCorruptTag ? ' and a broken tag block' : ''}, kept all ${result.framesKept} good audio frames. Original saved as ${result.backupName}.`, 'success');
      } else if (result && (result.code === 'EBUSY' || result.code === 'EPERM' || result.code === 'EACCES')) {
        delete track.healthCheckedAt; // file in use / locked — retry later
        logConsole(`"${track.title}" is currently in use — repair will be retried later.`, 'info');
      } else {
        track.health = 'damaged';
        logConsole(`Could not repair "${track.title}" safely — the file was left untouched. ${result && result.reason ? result.reason : ''}`, 'warning');
      }
    } else {
      track.healthCheckedAt = Date.now();
      track.health = 'damaged';
      const fmt = (track.format || 'this').toUpperCase();
      logConsole(`"${track.title}" appears damaged (${issueText}). ${fmt} files can't be auto-repaired — re-ripping or re-downloading it is the safest fix.`, 'warning');
    }

    await dbSaveTrack(track);
  } catch (err) {
    logConsole(`File health check paused: ${friendlyError(err, 'health-check')}`, 'warning');
    // Mark as checked so a throwing health check doesn't re-run every cycle
    track.healthCheckedAt = Date.now();
    track.health = 'unknown';
    try { await dbSaveTrack(track); } catch { /* non-fatal */ }
  } finally {
    isCheckingHealth = false;
  }
}

// --- Background Metadata Processor (BPM, Key, Mood & beat offset via Essentia.js) ---
let isProcessingMetadata = false;

function updateAnalysisProgress() {
  if (state.library.length === 0) {
    analysisProgressContainer.classList.add('hidden');
    return;
  }

  const total = state.library.length;
  // A track is "completed" if it has metadata OR is marked as undecodable
  // OR analysis has permanently given up on it (parked until rescan)
  const completed = state.library.filter(t =>
    t.undecodable || t.analysisGaveUp || (
      t.bpm !== null &&
      t.key !== null &&
      t.mood !== undefined &&
      t.mood !== null &&
      t.beatOffset !== undefined &&
      t.beatOffset !== null &&
      t.loudness !== undefined && t.loudness !== null &&
      t.endingCold !== undefined
    )
  ).length;
  const remaining = total - completed;

  if (remaining > 0) {
    analysisProgressContainer.classList.remove('hidden');
    const percent = Math.round((completed / total) * 100);
    analysisProgressBar.style.width = `${percent}%`;
    analysisPercentage.innerText = `${percent}%`;
    
    const engineType = state.engineStatus === 'connected' ? 'Essentia' : 'Heuristics';
    analysisStatusText.innerText = `Analyzing metadata & transients (${engineType}): ${completed}/${total} files`;
  } else {
    analysisProgressContainer.classList.add('hidden');
  }
}

/**
 * Background analysis pipeline (runs on an interval). Picks one unanalyzed
 * track per tick and fills in: BPM, key, mood, beat offset, loudness, and
 * ending type via Essentia — with heuristic and transient-detector fallbacks —
 * then fetches missing album art and writes ID3 tags back to MP3 files.
 * Guarded by `isProcessingMetadata`; always releases the lock via finally.
 * @returns {Promise<void>}
 */
async function backgroundMetadataProcessor() {
  updateAnalysisProgress();

  if (isProcessingMetadata || state.library.length === 0) return;
  
  // Find a track that hasn't been analyzed, isn't marked as undecodable,
  // isn't permanently parked, and isn't in a failure-backoff cooldown.
  const track = state.library.find(t =>
    !t.undecodable &&
    !t.analysisGaveUp &&
    (!t.analysisCooldownUntil || t.analysisCooldownUntil <= Date.now()) && (
      t.bpm === null ||
      t.key === null ||
      t.mood === undefined ||
      t.mood === null ||
      t.beatOffset === undefined ||
      t.beatOffset === null ||
      t.loudness === undefined ||
      t.loudness === null ||
      t.endingCold === undefined
    )
  );
  if (!track) return;

  isProcessingMetadata = true;
  try {
  track.path = normalizePath(track.path);

  let bpm = track.bpm;
  let key = track.key;
  let mood = track.mood;
  let beatOffset = track.beatOffset;

  const needsAnalysis = (bpm === null || key === null || mood === undefined || mood === null || beatOffset === undefined || beatOffset === null ||
    track.loudness === undefined || track.loudness === null || track.endingCold === undefined);

  if (needsAnalysis) {
    let essentiaSuccess = false;
    let analysisErr = null;
    let allocFailed = false;

    if (track.undecodable) {
      logConsole(`Skipping audio analysis for undecodable track "${track.title}" (using heuristics)`, 'info');
    } else if (aiWorker) {
      logConsole(`Analyzing "${track.title}" with Essentia.js audio analysis...`, 'info');
      try {
        const decoded = await decodeTrackToMono(track.path);

        // Inspect the song's ending BEFORE the samples are transferred away:
        // loud right up to the last second = "cold" ending (no fade-out).
        track.endingCold = detectColdEnding(decoded.samples, decoded.sampleRate);

        const result = await sendWorkerRequest(
          'analyze',
          { samples: decoded.samples, sampleRate: decoded.sampleRate },
          [decoded.samples.buffer] // transfer for zero-copy speed
        );

        if (result.bpm) bpm = result.bpm;
        if (result.key) key = result.key;
        if (result.mood) mood = result.mood;
        if (result.beatOffset !== undefined && result.beatOffset !== null) beatOffset = result.beatOffset;
        if (result.rms !== undefined) track.loudness = result.rms;

        essentiaSuccess = true;
        logConsole(`Essentia analyzed "${track.title}": BPM ${bpm}, Key ${key}, Mood ${mood} (beat offset ${beatOffset}s)`, 'ai');
      } catch (err) {
        logConsole(`Couldn't fully analyze "${track.title}": ${friendlyError(err, 'essentia-analysis')}`, 'warning');
        analysisErr = err;
        allocFailed = /allocation|out of memory/i.test(err.message);
        // Mark as undecodable so we don't get stuck on this file in the background processor
        if (err.message.includes('decoding failed') || err.message.includes('decode')) {
          track.undecodable = true;
        }
      }
    }

    const markedHeuristic = !essentiaSuccess;

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
      if (track.undecodable || allocFailed) {
        // Under memory pressure, don't fetch+decode the whole file a second time
        beatOffset = 0;
      } else {
        logConsole(`Running fallback transient beat detection for "${track.title}"...`, 'info');
        try {
          const audioAnalysis = await runTransientAnalysis(track.path, bpm);
          beatOffset = audioAnalysis.beatOffset;
          if (audioAnalysis.bpm && (!bpm || bpm === 100)) {
            bpm = audioAnalysis.bpm;
          }
        } catch (err) {
          logConsole(`Beat detection didn't work for "${track.title}": ${friendlyError(err, 'transient-analysis')}`, 'warning');
          analysisErr = analysisErr || err;
          if (err.message.includes('decoding failed') || err.message.includes('decode')) {
            track.undecodable = true;
          }
          beatOffset = 0;
        }
      }
    }

    if (markedHeuristic) {
      track.isHeuristic = true;
    } else {
      delete track.isHeuristic;
    }

    // Track repeated failures so a bad file is retried with backoff and
    // eventually parked instead of looping every tick.
    if (analysisErr) {
      recordAnalysisFailure(track, analysisErr);
    } else if (essentiaSuccess) {
      clearAnalysisFailure(track);
    }
  }

  // Update track
  track.bpm = bpm;
  track.key = key;
  track.mood = mood;
  track.beatOffset = beatOffset;

  // Loudness must always end up set — Essentia can succeed yet return no rms,
  // and sanitizeLibraryTrack nulls non-positive values on load. A null here
  // re-selects the track every tick forever.
  if (track.loudness === undefined || track.loudness === null || track.loudness <= 0) {
    track.loudness = 0.10; // Default neutral loudness
  }

  // If the ending couldn't be inspected (decode failed), assume a normal
  // fade-out so the DJ keeps its default crossfade behavior.
  if (track.endingCold === undefined) track.endingCold = false;
  
  // 4. Background Album Art Fetching (if missing or corrupt, and not cooling down)
  let artworkToEmbed = null;
  if (!isAlbumArtValid(track.albumArt) &&
      (!track.artCheckedAt || (Date.now() - track.artCheckedAt) > ART_RECHECK_MS)) {
    try {
      logConsole(`Fetching ${track.albumArt ? 'replacement' : 'missing'} album art for "${track.title}" from MusicBrainz...`, 'info');
      track.albumArt = null; // drop corrupt data so the protocol fallback works meanwhile
      const dataUrl = await fetchArtFromMusicBrainz(track);
      if (dataUrl) {
        track.albumArt = dataUrl;  // store as base64 — no redirect needed for display
        artworkToEmbed = dataUrl;
        delete track.artCheckedAt;
        logConsole(`Found album art for "${track.title}" on MusicBrainz/CAA.`, 'success');
      } else {
        track.artCheckedAt = Date.now(); // nothing available — recheck in a week
      }
    } catch (err) {
      console.warn(`Art fetch failed for ${track.title}:`, err);
      if (window.api.logDebug) window.api.logDebug(`[art-fetch] ${track.title}: ${err.message}`);
      // Backdate so the fetch becomes eligible again in ~1 hour, not every tick
      track.artCheckedAt = Date.now() - ART_RECHECK_MS + ART_NET_RETRY_MS;
    }
  }

  // Write ID3 tags back to file in main process (if MP3)
  if ((track.format || '').toLowerCase() === 'mp3' && !track.undecodable) {
    const res = await window.api.writeTags(track.path, bpm, key, artworkToEmbed);
    if (res.success) {
      logConsole(`Successfully wrote tags (and art) to file: ${track.title}`, 'success');
    } else {
      const isLocked = res.code === 'EBADF' || res.code === 'EBUSY' || res.code === 'EPERM' || (res.error && res.error.includes('descriptor'));
      if (isLocked) {
        logConsole(`Could not write ID3 tags directly (file is currently in use): ${track.title}`, 'info');
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
    // Push updated loudness/replaygain to audio-renderer so gain is corrected live
    sendAudioCommand('update-normalization', { track });
  }

  // Attempt to optimize the current queue with this freshly analyzed track
  tryQueueOptimization(track);
  } catch (err) {
    console.error('Background metadata processor error:', err);
    logConsole(`Background analysis error for a track: ${err.message}`, 'danger');
    // Errors that escape the inner handlers must also count toward the
    // retry budget, or this track loops every tick.
    recordAnalysisFailure(track, err);
    try { await dbSaveTrack(track); } catch (saveErr) { console.error('Failed to persist failure state:', saveErr); }
  } finally {
    // Always release the lock so one bad track can't halt the whole pipeline
    isProcessingMetadata = false;
  }
}

/**
 * Proactively improves the queue as new tracks are scanned and analyzed.
 * If the new track is a significantly better match than a track currently in the
 * lookahead queue, it swaps them out to ensure the highest quality mix.
 */
function tryQueueOptimization(newTrack) {
  if (state.queue.length === 0 || !state.currentTrack) return;

  // 1. Basic eligibility checks
  if (state.queue.some(q => q.path === newTrack.path)) return; // Already in queue
  if (!doesTrackMatchMood(newTrack, state.mood)) return;
  if (!isArtistAllowed(newTrack.artist) || !isSongAllowed(newTrack.path)) return;

  const currentBpm = state.currentTrack?.bpm || 100;
  const currentGenre = state.currentTrack?.genre || 'unknown';
  const currentKey = state.currentTrack?.key || 'C Maj';

  const newScore = getHeuristicScore(newTrack, currentBpm, currentGenre, currentKey);

  // 2. Find the lowest scoring track currently in the queue
  let lowestScore = Infinity;
  let lowestIdx = -1;

  for (let i = 0; i < state.queue.length; i++) {
    const qItem = state.queue[i];
    const qTrack = state.library.find(t => t.path === qItem.path);
    if (!qTrack) continue;

    const qScore = getHeuristicScore(qTrack, currentBpm, currentGenre, currentKey);
    if (qScore < lowestScore) {
      lowestScore = qScore;
      lowestIdx = i;
    }
  }

  // 3. If new track is a "Better Match" (threshold: +100 points)
  if (lowestIdx !== -1 && newScore > (lowestScore + 100)) {
    const oldTrack = state.library.find(t => t.path === state.queue[lowestIdx].path);
    logConsole(`Mix Optimized: Freshly scanned "${newTrack.title}" is a better fit than "${oldTrack?.title || 'queued track'}". Swapping...`, 'ai');

    let reason = `Discovered a superior ${newTrack.genre} transition for the ${state.mood} vibe.`;
    const bpmDiff = Math.abs((newTrack.bpm || 100) - currentBpm);
    if (bpmDiff < 10) {
      reason = `Spotted a closer tempo match at ${newTrack.bpm} BPM with "${newTrack.title}".`;
    } else if (newTrack.key === currentKey) {
      reason = `Optimized harmonic flow with "${newTrack.title}" in ${newTrack.key}.`;
    }

    state.queue[lowestIdx] = {
      path: newTrack.path,
      reason: reason
    };
    renderQueue();
  }
}

// --- Lyric Mood AI (Anthropic) ---------------------------------------------
// When configured with an API key (Settings), songs with embedded lyrics are
// judged by Claude against the active mood — especially custom vibes. Verdicts
// are cached per (mood, track) for the session. Tracks without lyrics keep
// using the sonic/keyword pipeline unchanged.

let aiStatus = { provider: 'local', configured: false, model: null, localModelReady: false, downloading: false };
let lyricAnalysisToken = 0; // invalidates in-flight runs when the mood changes

const MOOD_LYRIC_DESCRIPTIONS = {
  chill: 'calm, relaxed, mellow, soothing — easygoing themes, nothing aggressive or emotionally heavy',
  focus: 'steady and unobtrusive, suitable for deep concentration or studying — no jarring or distressing themes',
  energy: 'high energy, intense, driving, motivating — themes of power, speed, adrenaline, or determination',
  party: 'fun, celebratory, danceable, feel-good — themes of partying, dancing, friends, and good times',
  // Uplifting is about lyrical content and overall feel, NOT tempo or loudness.
  // A quiet hymn can be uplifting; a loud aggressive track is not.
  uplifting: 'positive, hopeful, encouraging, inspiring — themes of hope, triumph, faith, gratitude, perseverance, love, or joy that leave the listener feeling lifted and reassured, regardless of how fast or loud the music is. Angry, bleak, despairing, or purely aggressive lyrics do NOT fit, even at high energy.',
};

/** Cache key prefix for the currently active mood (custom prompts get their own space). */
function lyricMoodKey() {
  return state.mood === 'custom' ? `custom::${state.customMoodPrompt}` : state.mood;
}

function lyricMoodDescription() {
  return state.mood === 'custom'
    ? state.customMoodPrompt
    : (MOOD_LYRIC_DESCRIPTIONS[state.mood] || null);
}

/** @returns {boolean|undefined} true/false when Claude has judged this track for the active mood. */
function getLyricVerdict(track) {
  return state.lyricVerdicts.get(`${lyricMoodKey()}::${track.path}`);
}

async function refreshAiStatus() {
  try {
    aiStatus = await window.api.aiGetStatus();
  } catch {
    aiStatus = { provider: 'local', configured: false, model: null, localModelReady: false, downloading: false };
  }
  updateAiSettingsUI();
}

function updateAiSettingsUI() {
  if (!lyricAiStatusBadge) return;
  if (aiStatus.downloading) {
    lyricAiStatusBadge.innerText = 'Downloading…';
  } else if (!aiStatus.configured) {
    lyricAiStatusBadge.innerText = aiStatus.provider === 'local' ? 'Needs download' : 'Needs key';
  } else {
    lyricAiStatusBadge.innerText = aiStatus.provider === 'local' ? 'Local' : 'Claude';
  }
  if (lyricAiProviderSelect) lyricAiProviderSelect.value = aiStatus.provider;
  if (aiStatus.model && anthropicModelSelect) anthropicModelSelect.value = aiStatus.model;
  if (anthropicConfigFields) {
    anthropicConfigFields.style.display = aiStatus.provider === 'anthropic' ? 'flex' : 'none';
  }
}

/**
 * Ask Claude (via the main process) whether each lyric-bearing track fits the
 * active mood, then refresh the queue so verdicts take effect. No-op without
 * an API key. Re-entrant safe: a mood change mid-flight discards stale results.
 */
async function runLyricMoodAnalysis() {
  if (!aiStatus.configured || state.library.length === 0) return;
  const moodKey = lyricMoodKey();
  const description = lyricMoodDescription();
  if (!description) return;

  const pending = state.library.filter(t => !state.lyricVerdicts.has(`${moodKey}::${t.path}`));
  if (pending.length === 0) return;

  const token = ++lyricAnalysisToken;
  logConsole(`Lyric AI: judging lyrics against "${description}"...`, 'ai');

  let response;
  try {
    response = await window.api.aiAnalyzeLyrics({
      tracks: pending.map(t => ({ path: t.path, title: t.title, artist: t.artist })),
      moodDescription: description,
      moodKey,
    });
  } catch (err) {
    logConsole(`Lyric AI failed: ${friendlyError(err, 'lyric-ai')}`, 'warning');
    return;
  }

  if (response.error === 'invalid-api-key') {
    logConsole('Lyric AI: the API key was rejected — check Settings.', 'danger');
    return;
  }
  if (response.error === 'model-downloading') {
    logConsole('Lyric AI: the local model is still downloading — lyrics will be judged once it finishes.', 'info');
    return;
  }
  if (response.error === 'model-not-ready') {
    logConsole('Lyric AI: local model not downloaded yet — open Settings and hit Save to fetch it (~1 GB, one time).', 'warning');
    return;
  }
  if (response.error === 'rate-limited') {
    logConsole('Lyric AI: rate limited by the API — applying partial results.', 'warning');
  }

  for (const r of (response.results || [])) {
    state.lyricVerdicts.set(`${moodKey}::${r.path}`, r.fits);
  }

  // Mood changed while we were waiting — keep the cache, skip the refill.
  if (token !== lyricAnalysisToken || moodKey !== lyricMoodKey()) return;

  if (response.analyzed > 0) {
    const fitCount = (response.results || []).filter(r => r.fits).length;
    logConsole(`Lyric AI: ${fitCount}/${response.analyzed} lyric-bearing songs fit this vibe (${response.skippedNoLyrics} without lyrics use the sonic engine).`, 'ai');
    state.queue = [];
    fillQueue();
  }
}

function setUpAiSettings() {
  refreshAiStatus();

  // Show/hide the Claude fields live as the provider dropdown changes
  lyricAiProviderSelect.addEventListener('change', () => {
    anthropicConfigFields.style.display =
      lyricAiProviderSelect.value === 'anthropic' ? 'flex' : 'none';
  });

  btnSaveAiConfig.addEventListener('click', async () => {
    const config = { provider: lyricAiProviderSelect.value };
    if (config.provider === 'anthropic') {
      config.model = anthropicModelSelect.value;
      const apiKey = anthropicKeyInput.value.trim();
      if (apiKey) config.apiKey = apiKey; // blank field = keep the stored key
    }
    const result = await window.api.aiSetConfig(config);
    if (result && result.ok) {
      aiStatus = result;
      anthropicKeyInput.value = '';
      updateAiSettingsUI();
      if (aiStatus.configured) {
        logConsole(`Lyric Mood AI enabled (${aiStatus.provider === 'local' ? 'local model — private, no cost' : aiStatus.model}).`, 'info');
        runLyricMoodAnalysis();
      } else if (aiStatus.provider === 'local') {
        logConsole('Lyric Mood AI: downloading the local model (~1 GB, one time)...', 'info');
      } else {
        logConsole('Lyric Mood AI: no API key set yet.', 'info');
      }
    } else {
      logConsole(`Couldn't save Lyric AI settings: ${(result && result.error) || 'unknown error'}`, 'warning');
    }
  });

  window.api.onAiAnalyzeProgress(({ done, total }) => {
    logConsole(`Lyric AI: ${done}/${total} songs checked...`, 'ai');
  });

  let lastLoggedPct = -10;
  window.api.onAiModelDownloadProgress((data) => {
    if (data.error) {
      aiStatus.downloading = false;
      updateAiSettingsUI();
      logConsole(`Lyric AI model download failed: ${data.error}`, 'warning');
      return;
    }
    if (data.done) {
      lastLoggedPct = -10;
      refreshAiStatus().then(() => {
        logConsole('Lyric AI: local model ready — lyrics now stay 100% on this PC.', 'ai');
        runLyricMoodAnalysis();
      });
      return;
    }
    aiStatus.downloading = true;
    if (lyricAiStatusBadge) lyricAiStatusBadge.innerText = `Downloading ${data.pct}%`;
    if (data.pct >= lastLoggedPct + 10) { // log every ~10% to avoid console spam
      lastLoggedPct = data.pct;
      logConsole(`Lyric AI: downloading local model... ${data.pct}%`, 'info');
    }
  });
}

// --- Crisis support guardrail ------------------------------------------------
// Runs locally on the custom mood prompt — nothing is sent anywhere to detect
// this. The request is honored either way; we just make sure help info is seen
// first. Patterns target suicide/self-harm phrasing, not general sad themes.

const CRISIS_PATTERNS = [
  /suicid/i,
  /self[\s-]?harm/i,
  /self[\s-]?injur/i,
  /kill(ing)?\s+(myself|me|yourself|himself|herself|themselves)/i,
  /end(ing)?\s+(my|your|it)\s*(all|life)/i,
  /take\s+my\s+(own\s+)?life/i,
  /want(ing)?\s+to\s+die/i,
  /wanna\s+die/i,
  /wish\s+i\s+(was|were)\s+dead/i,
  /better\s+off\s+dead/i,
  /no\s+reason\s+to\s+live/i,
  /cut(ting)?\s+(myself|my\s+(arms?|wrists?|legs?))/i,
  /hurt(ing)?\s+myself/i,
  /overdos/i,
  /unaliv/i,
];

function detectCrisisContent(text) {
  return CRISIS_PATTERNS.some(re => re.test(text));
}

let crisisContinueAction = null;

/** Show the support modal; [onContinue] runs only if the user chooses to proceed. */
function showCrisisModal(onContinue) {
  crisisContinueAction = onContinue;
  crisisModal.classList.remove('hidden');
}

function setUpCrisisModal() {
  btnCrisisContinue.addEventListener('click', () => {
    crisisModal.classList.add('hidden');
    const action = crisisContinueAction;
    crisisContinueAction = null;
    if (action) action();
  });
  btnCrisisCancel.addEventListener('click', () => {
    crisisModal.classList.add('hidden');
    crisisContinueAction = null;
  });
  btnCrisis988.addEventListener('click', () => {
    window.api.openExternal('https://988lifeline.org');
  });
}

// --- Sonic DNA Framework ---
// This framework groups music into "Vibe Tiers" to prevent Contextual Whiplash.
const SONIC_PROFILES = {
  INTIMATE: {
    artists: ['bob bennett', 'bebo norman', 'eli', 'fernando ortega', 'leigh nash', 'grant-lee phillips', 'margaret cho'],
    keywords: ['acoustic', 'ballad', 'piano', 'soft', 'peace', 'sparrow', 'still', 'solo', 'storyteller'],
    allowedMoods: ['chill', 'focus'],
    compatibility: ['INTIMATE', 'STEADY_CCM']
  },
  STEADY_CCM: {
    artists: ['chris tomlin', 'lauren daigle', 'brian doerksen', 'sixpence', 'barlowgirl', 'lenny leblanc', 'don moen'],
    keywords: ['worship', 'praise', 'noel', 'hark', 'herald', 'angels', 'cathedral', 'psalm', 'hymn'],
    allowedMoods: ['focus', 'uplifting'],
    compatibility: ['INTIMATE', 'STEADY_CCM', 'CLASSIC_POP']
  },
  CLASSIC_POP: {
    artists: ['the police', 'kansas', 'u2', 'r.e.m.', 'talking heads', 'dire straits', 'fleetwood mac', 'bryan duncan', 'vigilantes of love', 'blue oyster cult', 'b.o.c.', 'little richard', 'smalltown poets'],
    keywords: ['new wave', 'pop rock', 'classic rock', 'every breath', 'gold', 'heart', 'day'],
    // 'uplifting' is intentionally NOT here: it is a lyric/feel judgment, not a
    // sonic-energy one (see doesTrackMatchMood's dedicated uplifting branch).
    // Coupling it with 'energy' is what put aggressive rock next to gentle hymns.
    allowedMoods: ['energy'],
    compatibility: ['STEADY_CCM', 'CLASSIC_POP', 'DRIVING_ALT']
  },
  DRIVING_ALT: {
    artists: ['all star united', 'paramore', 'boys like girls', 'powderfinger', 'shaded red', 'margaret becker', 'echoing green', 'beanbag'],
    keywords: ['alternative', 'emo', 'pop-punk', 'grunge', 'thunder', 'misery', 'caught', 'scene'],
    allowedMoods: ['energy', 'party'],
    compatibility: ['CLASSIC_POP', 'DRIVING_ALT', 'HEAVY_ROCK']
  },
  HEAVY_ROCK: {
    artists: ['petra', 'guardian', 'mastedon', 'whiteheart', 'creed', 'blindside'],
    keywords: ['hard rock', 'metal', 'angel of light', 'state of mine', 'replay', 'arms wide open'],
    allowedMoods: ['energy'],
    compatibility: ['DRIVING_ALT', 'HEAVY_ROCK', 'BUSY_INDUSTRIAL']
  },
  BUSY_INDUSTRIAL: {
    artists: ['ap2', 'frank klepacki', 'antidote', 'jarrid mendelson', 'battlecross'],
    keywords: ['industrial', 'mechanical', 'rage', 'fight', 'boss', 'valve', 'gloom', 'destroy', 'carbine', 'unmoved mover'],
    allowedMoods: ['energy'],
    compatibility: ['HEAVY_ROCK', 'BUSY_INDUSTRIAL', 'BIG_BEAT']
  },
  BIG_BEAT: {
    artists: ['midival punditz', 'the crystal method', 'prodigy', 'chemical brothers', 'world wide message tribe', 'seafield', 'ultrabeat', 'beastie boys'],
    keywords: ['techno', 'electronica', 'atomizer', 'jumping', 'house of god', 'manchester', 'truth is out there', 'hip hop', 'rap'],
    allowedMoods: ['party', 'energy'],
    compatibility: ['BUSY_INDUSTRIAL', 'BIG_BEAT', 'DANCE_FLOOR']
  },
  DANCE_FLOOR: {
    artists: ['dj remy', 'kaskade', 'ultrabeat', 'robert miles', 'situation', 'matthew dear'],
    keywords: ['trance', 'house', 'dance', 'club', 'children', 'backstabber'],
    allowedMoods: ['party'],
    compatibility: ['BIG_BEAT', 'DANCE_FLOOR']
  },
  TRADITIONAL: {
    artists: ['folk like us', 'benny goodman', 'vivaldi', 'sibelius', 'london philharmonic', 'carola'],
    keywords: ['jig', 'reel', 'polka', 'hornpipe', 'swing', 'big band', 'spring', 'four seasons', 'allegro', 'finlandia', 'carol'],
    // 'party' is intentionally NOT a blanket mood here: only fast trad (>130 BPM
    // jigs/reels/swing) qualifies, via the elasticity rule in doesTrackMatchMood.
    // Blanket 'party' put 98-BPM blues/country-tagged rock next to club tracks.
    allowedMoods: ['uplifting'],
    compatibility: ['TRADITIONAL', 'CLASSIC_POP']
  }
};

/**
 * Tests whether a term appears as a whole word (or phrase) in text.
 * Escapes regex special characters so artist/keyword strings are safe.
 */
function wordMatch(text, term) {
  try {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b', 'i').test(text);
  } catch {
    return text.includes(term);
  }
}

/**
 * Determines the Sonic Profile of a track based on artist and keywords.
 * Caches the result on the track object for performance.
 */
function getSonicProfile(track) {
  if (track.sonicProfile) return track.sonicProfile;

  const artist = (track.artist || '').toLowerCase();
  const trackTitle = (track.title || '').toLowerCase();
  const genre = (track.genre || '').toLowerCase();
  const text = (artist + ' ' + trackTitle + ' ' + genre).toLowerCase();

  let foundKey = 'CLASSIC_POP'; // Default fallback

  // 1. Artist Match (Highest Priority) — whole-word to avoid 'eli' matching 'melissa'
  for (const [key, profile] of Object.entries(SONIC_PROFILES)) {
    if (profile.artists.some(a => wordMatch(artist, a))) {
      foundKey = key;
      break;
    }
  }

  if (foundKey === 'CLASSIC_POP') {
    // 2. Keyword Match — whole-word to prevent 'day'→'monday', 'heart'→'sweetheart', etc.
    for (const [key, profile] of Object.entries(SONIC_PROFILES)) {
      if (profile.keywords.some(k => wordMatch(text, k))) {
        foundKey = key;
        break;
      }
    }
  }

  if (foundKey === 'CLASSIC_POP') {
    // 3. Genre / text fallback — expanded to cover folk, ambient, jazz, etc.
    if (wordMatch(text, 'metal') || wordMatch(text, 'hardcore') || wordMatch(text, 'hard rock')) {
      foundKey = 'HEAVY_ROCK';
    } else if (wordMatch(text, 'worship') || wordMatch(text, 'christian') || wordMatch(text, 'gospel') || wordMatch(text, 'hymn') || wordMatch(text, 'praise')) {
      foundKey = 'STEADY_CCM';
    } else if (wordMatch(text, 'folk') || wordMatch(text, 'acoustic') || wordMatch(text, 'singer-songwriter') || wordMatch(text, 'ambient') || wordMatch(text, 'new age')) {
      foundKey = 'INTIMATE';
    } else if (wordMatch(text, 'southern rock') || wordMatch(text, 'blues rock') || wordMatch(text, 'blues-rock') || wordMatch(text, 'rock and roll') || wordMatch(text, 'rock & roll') || wordMatch(text, "rock 'n' roll")) {
      // Rock hybrids stay rock — a bare 'blues'/'country' match below would
      // misfile them as TRADITIONAL (e.g. Lynyrd Skynyrd next to club tracks).
      foundKey = 'CLASSIC_POP';
    } else if (wordMatch(text, 'jazz') || wordMatch(text, 'blues') || wordMatch(text, 'swing') || wordMatch(text, 'big band') || wordMatch(text, 'classical') || wordMatch(text, 'orchestral')) {
      foundKey = 'TRADITIONAL';
    } else if (wordMatch(text, 'punk') || wordMatch(text, 'alternative') || wordMatch(text, 'alt-rock') || wordMatch(text, 'emo') || wordMatch(text, 'country rock')) {
      foundKey = 'DRIVING_ALT';
    } else if (wordMatch(text, 'trance') || wordMatch(text, 'house') || wordMatch(text, 'club') || wordMatch(text, 'edm')) {
      foundKey = 'DANCE_FLOOR';
    } else if (wordMatch(text, 'electronic') || wordMatch(text, 'techno') || wordMatch(text, 'hip hop') || wordMatch(text, 'hip-hop') || wordMatch(text, 'rap')) {
      foundKey = 'BIG_BEAT';
    } else if (wordMatch(text, 'country') || wordMatch(text, 'bluegrass') || wordMatch(text, 'celtic') || wordMatch(text, 'irish')) {
      foundKey = 'TRADITIONAL';
    }
  }

  track.sonicProfile = foundKey;
  return foundKey;
}

/**
 * Decide whether a track fits the requested mood, using its Sonic DNA
 * profile plus BPM-based elasticity rules for adjacent styles.
 * @param {object} track - Library track.
 * @param {string} mood - Active mood
 *   ('chill'|'focus'|'energy'|'party'|'uplifting'|'custom').
 * @returns {boolean}
 */
function doesTrackMatchMood(track, mood) {
  if (!track) return false;
  const sMood = mood.toLowerCase();

  // Custom mood: a Claude lyric verdict (when available) is authoritative;
  // tracks without lyrics or before analysis completes fall back to keyword search.
  if (sMood === 'custom') {
    if (!state.customMoodPrompt) return true;
    const lyricVerdict = getLyricVerdict(track);
    if (lyricVerdict !== undefined) return lyricVerdict;
    const promptWords = state.customMoodPrompt.toLowerCase().split(' ');
    const searchArea = `${track.title} ${track.artist} ${track.genre} ${track.mood || ''}`.toLowerCase();
    return promptWords.some(w => w.length > 2 && searchArea.includes(w));
  }

  const profileKey = getSonicProfile(track);
  const profile = SONIC_PROFILES[profileKey];

  // Uplifting is a lyric/feel mood, deliberately independent of the sonic
  // energy path. The Lyric AI verdict is authoritative when available. Without
  // it (no lyrics, AI off, or analysis pending) we fall back conservatively:
  // only warm, non-aggressive profiles in a major key — we never *assume* loud
  // or aggressive music is uplifting just because it's energetic.
  if (sMood === 'uplifting') {
    const lyricVerdict = getLyricVerdict(track);
    if (lyricVerdict !== undefined) return lyricVerdict;
    const UPLIFTING_FALLBACK_PROFILES = ['INTIMATE', 'STEADY_CCM', 'TRADITIONAL', 'CLASSIC_POP'];
    if (!UPLIFTING_FALLBACK_PROFILES.includes(profileKey)) return false;
    return !(track.key || '').toLowerCase().includes('min'); // major key only
  }

  // Rule: Profile must explicitly allow the mood
  if (profile.allowedMoods.includes(sMood)) return true;

  // Elasticity: Allow cross-over for adjacent styles
  if (sMood === 'chill') {
    if (profileKey === 'STEADY_CCM') return true;
    if (profileKey === 'TRADITIONAL') return true;                        // mellow folk/classical
    if (profileKey === 'CLASSIC_POP' && (track.bpm || 999) < 90) return true; // slow classics
  }
  if (sMood === 'focus') {
    if (profileKey === 'INTIMATE') return true;
    if (profileKey === 'TRADITIONAL') return true;                        // classical for studying
    if (profileKey === 'STEADY_CCM') return true;
  }
  if (sMood === 'party') {
    if (profileKey === 'CLASSIC_POP' && (track.bpm || 0) > 120) return true;
    if (profileKey === 'TRADITIONAL' && (track.bpm || 0) > 130) return true; // fast jigs/reels
  }
  if (sMood === 'energy') {
    if (profileKey === 'DRIVING_ALT') return true;
    if (profileKey === 'CLASSIC_POP' && (track.bpm || 0) > 140) return true;
  }

  return false;
}

function getPrimaryArtist(artist) {
  if (!artist) return '';
  return artist.split(/\s+(?:feat\.?|ft\.?|with|&|vs\.?|and)\s+/i)[0].trim().toLowerCase();
}

function isArtistAllowed(artist) {
  if (!artist || artist === 'Unknown Artist') return true;
  const primary = getPrimaryArtist(artist);

  // Block if the currently playing track shares the same primary artist
  if (state.currentTrack && getPrimaryArtist(state.currentTrack.artist) === primary) return false;

  // Block if already in the queue under the same primary artist
  const inQueue = state.queue.some(q => {
    const t = state.library.find(t => t.path === q.path);
    return t && getPrimaryArtist(t.artist) === primary;
  });
  if (inQueue) return false;

  // Block if the artist played at all within the rolling 20-minute window.
  // (The old threshold of "2+ plays" let an artist return after only ~3
  // songs: one play didn't trip the cooldown, and only the current-track
  // and 3-slot queue checks stood in the way.)
  const twentyMin = 20 * 60 * 1000;
  const cutoff = Date.now() - twentyMin;
  return !state.history.some(h => getPrimaryArtist(h.artist) === primary && h.playedAt > cutoff);
}

function isSongAllowed(path) {
  const oneHour = 60 * 60 * 1000;
  const cutoff = Date.now() - oneHour;
  return !state.history.some(h => h.path === path && h.playedAt > cutoff);
}

function weightedRandomPick(scoredCandidates) {
  if (!scoredCandidates || scoredCandidates.length === 0) return null;
  // Shift scores so the minimum is 1, then use as weights
  const minScore = Math.min(...scoredCandidates.map(c => c.score));
  const shifted = scoredCandidates.map(c => ({ track: c.track, weight: Math.max(1, c.score - minScore + 1) }));
  const total = shifted.reduce((sum, c) => sum + c.weight, 0);
  let rand = Math.random() * total;
  for (const c of shifted) {
    rand -= c.weight;
    if (rand <= 0) return c.track;
  }
  return shifted[shifted.length - 1].track;
}

const QUEUE_LOOKAHEAD = 3;

async function fillQueue() {
  if (state.library.length === 0) return;
  while (state.queue.length < QUEUE_LOOKAHEAD) {
    const next = await getNextDJTrack();
    if (!next) break;
    state.queue.push(next);
  }
  renderQueue();
}

/**
 * The DJ brain: pick the next track using a nine-tier candidate funnel that
 * progressively relaxes constraints (mood DNA → cooldowns → genre
 * compatibility) so a song is always found, then weights the final pick by
 * heuristic score.
 * @returns {Promise<{path: string, reason: string}|null>} Queue entry, or
 *   null when the library is empty.
 */
async function getNextDJTrack() {
  const mood = state.mood;
  // Compare transitions against the track this pick will actually follow:
  // the tail of the queue when refilling several slots at once, falling back
  // to the playing track. Comparing every pick against the playing track let
  // mutually-incompatible tracks (e.g. TRADITIONAL between DANCE_FLOOR and
  // BIG_BEAT) land side by side in the queue.
  const queueTail = state.queue.length > 0
    ? state.library.find(t => t.path === state.queue[state.queue.length - 1].path)
    : null;
  const currentTrack = queueTail || state.currentTrack;

  // Pre-filter library to valid candidates for this mood to save time
  const moodCandidates = state.library.filter(t => doesTrackMatchMood(t, mood));
  const hasMoodMatches = moodCandidates.length > 0;

  // Candidate evaluation tiers
  const getCandidates = (requireExplicit = false, respectArtistCooldown = true, respectGenreCompatibility = true) => {
    return (hasMoodMatches ? moodCandidates : state.library).filter(track => {
      // 1. Basic unique checks
      if (state.queue.some(q => q.path === track.path)) return false;
      if (currentTrack && currentTrack.path === track.path) return false;

      // 2. DNA Logic
      if (requireExplicit && !track.mood) return false;

      // 3. Flow Logic
      if (respectArtistCooldown && !isArtistAllowed(track.artist)) return false;
      if (!isSongAllowed(track.path)) return false;

      if (currentTrack && respectGenreCompatibility) {
        if (!areGenresCompatible(currentTrack.genre, track.genre, currentTrack, track)) return false;
      }

      return true;
    });
  };

  // Tier 1: Perfect DNA match (Analyzed, Cooldowns, Compatible)
  let candidates = getCandidates(true, true, true);

  // Tier 2: Vibe match (Any, Cooldowns, Compatible)
  if (candidates.length === 0) candidates = getCandidates(false, true, true);

  // Tier 3: Relaxed compatibility (Any, Cooldowns, ignore Genre check)
  if (candidates.length === 0) candidates = getCandidates(false, true, false);

  // Tier 4: Relaxed cooldowns (Any, ignore Artist check, ignore Genre check)
  if (candidates.length === 0) candidates = getCandidates(false, false, false);

  // Tier 5: Respect mood + song cooldown, drop all other filters
  if (candidates.length === 0) candidates = (hasMoodMatches ? moodCandidates : state.library).filter(t =>
    !state.queue.some(q => q.path === t.path) && isSongAllowed(t.path)
  );

  // Tier 6: Respect mood, drop all cooldowns
  if (candidates.length === 0) candidates = (hasMoodMatches ? moodCandidates : state.library).filter(t =>
    !state.queue.some(q => q.path === t.path)
  );

  // Tier 7: Drop mood but keep genre compatibility — prevents jarring style jumps (e.g. Bob Bennett next to Beanbag)
  if (candidates.length === 0) candidates = state.library.filter(t =>
    !state.queue.some(q => q.path === t.path) &&
    isSongAllowed(t.path) &&
    areGenresCompatible(currentTrack?.genre, t.genre, currentTrack, t)
  );

  // Tier 8: Genre compatible, drop cooldowns too
  if (candidates.length === 0) candidates = state.library.filter(t =>
    !state.queue.some(q => q.path === t.path) &&
    areGenresCompatible(currentTrack?.genre, t.genre, currentTrack, t)
  );

  // Tier 9: Absolute last resort — ignore everything, just avoid the queue
  if (candidates.length === 0) candidates = state.library.filter(t => !state.queue.some(q => q.path === t.path));

  if (candidates.length === 0) return null;

  // Score and pick
  const currentBpm = currentTrack?.bpm || 100;
  const currentGenre = currentTrack?.genre || 'unknown';
  const currentKey = currentTrack?.key || 'C Maj';

  const scoredCandidates = candidates.map(c => ({
    track: c,
    score: getHeuristicScore(c, currentBpm, currentGenre, currentKey, currentTrack)
  }));

  const best = weightedRandomPick(scoredCandidates);
  if (!best) return null;

  let reason = `Transitioning into a smooth ${best.genre} vibe with "${best.title}" by ${best.artist}.`;
  if (currentTrack) {
    const bpmDiff = Math.abs((best.bpm || 100) - currentBpm);
    if (bpmDiff < 10) reason = `Matching the tempo at ${best.bpm} BPM, here is "${best.title}" by ${best.artist}.`;
    else if (best.key === currentKey) reason = `Keeping the harmonic key of ${best.key} going with "${best.title}".`;
  }

  logConsole(`DJ selected: "${best.title}" by ${best.artist} (DNA: ${getSonicProfile(best)})`, 'system');
  return { path: best.path, reason };
}

/**
 * Score a candidate track for transition quality against the current track:
 * mood match, genre-tier compatibility, BPM proximity, harmonic key,
 * major/minor continuity, loudness-contrast guardrails, and repeat penalties.
 * @param {object} track - Candidate track.
 * @param {number} currentBpm - BPM of the reference track (or 100 default).
 * @param {string} currentGenre - Genre of the reference track.
 * @param {string} currentKey - Musical key of the reference track.
 * @param {object} [referenceTrack] - The track the candidate would follow
 *   (queue tail during refills); defaults to the playing track.
 * @returns {number} Score (higher = better transition).
 */
function getHeuristicScore(track, currentBpm, currentGenre, currentKey, referenceTrack = state.currentTrack) {
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

    // Claude lyric verdict dominates keyword hits when present
    const lyricVerdict = getLyricVerdict(track);
    if (lyricVerdict === true) score += 400;
    else if (lyricVerdict === false) score -= 400;
  } else {
    // Stricter checking for the active mood
    const isMoodMatch = doesTrackMatchMood(track, state.mood);
    if (isMoodMatch) {
      score += 500; // Massive boost for actual matches
    } else {
      score -= 1000; // Heavy penalty for tracks that don't pass the guardrails
    }

    if (track.mood && track.mood.toLowerCase() === state.mood.toLowerCase()) {
      score += 200;
    } else if (track.mood) {
      const tMood = track.mood.toLowerCase();
      // Expanded mood cross-compatibility for scoring
      if (state.mood === 'energy' && (tMood.includes('intense') || tMood.includes('heavy') || tMood.includes('aggressive') || tMood.includes('fast') || tMood.includes('driving'))) {
        score += 150;
      } else if (state.mood === 'chill' && (tMood.includes('mellow') || tMood.includes('relax') || tMood.includes('ambient') || tMood.includes('calm') || tMood.includes('soft') || tMood.includes('quiet') || tMood.includes('peaceful'))) {
        score += 150;
      } else if (state.mood === 'focus' && (tMood.includes('study') || tMood.includes('concentration') || tMood.includes('steady') || tMood.includes('instrumental') || tMood.includes('minimal'))) {
        score += 150;
      } else if (state.mood === 'party' && (tMood.includes('dance') || tMood.includes('groove') || tMood.includes('funky') || tMood.includes('upbeat') || tMood.includes('club'))) {
        score += 150;
      } else if (state.mood === 'uplifting' && (tMood.includes('uplift') || tMood.includes('hopeful') || tMood.includes('triumph') || tMood.includes('worship') || tMood.includes('praise') || tMood.includes('inspir') || tMood.includes('joy'))) {
        score += 150;
      }
    }

    // Claude lyric verdict for standard moods: a scoring signal, not a gate —
    // sonics still decide candidacy, lyrics nudge the pick.
    const lyricVerdict = getLyricVerdict(track);
    if (lyricVerdict === true) score += 150;
    else if (lyricVerdict === false) score -= 150;
  }

  // 2. Transitions, BPM, and Key (Secondary Factors)
  if (referenceTrack) {
    if (areGenresCompatible(currentGenre, track.genre, referenceTrack, track)) {
      score += 10;
    } else {
      score -= 250; // Heavily penalize incompatible genre transitions
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

    // 3. Emotional / Valence Continuity (prevent Happy to Sad jumps)
    // Major to Major or Minor to Minor is preferred.
    const currentIsMinor = currentKey.toLowerCase().includes('min');
    const nextIsMinor = (track.key || '').toLowerCase().includes('min');
    if (currentIsMinor === nextIsMinor) {
      score += 30; // Bonus for staying in the same emotional lane
    } else {
      score -= 50; // Penalty for jarring emotional shifts
    }

    // 4. Dynamic Contrast Guardrail (prevent Energy to Sparse jumps)
    // If outgoing track was loud/energetic, avoid tracks known to have quiet intros.
    const currentLoudness = referenceTrack?.loudness || 0.15;
    const isNextPianoLed = (track.title || '').toLowerCase().includes('piano') ||
                           (track.genre || '').toLowerCase().includes('ballad') ||
                           ['barlowgirl', 'leigh nash', 'lenny leblanc'].some(a => (track.artist || '').toLowerCase().includes(a));

    if (currentLoudness > 0.18 && isNextPianoLed) {
      score -= 100; // Strong penalty for dropping from high energy into a thin piano intro
    }
  }

  // 3. Repeat and Artist Penalty (Soft cooldown for fallback/small-library scenarios)
  const now = Date.now();
  
  // (a) Song Repeat Penalty: penalize up to -300 points for plays within 60 minutes
  const recentPlays = state.history.filter(h => h.path === track.path);
  if (recentPlays.length > 0) {
    const lastPlayed = Math.max(...recentPlays.map(h => h.playedAt));
    const timeSincePlayed = now - lastPlayed;
    const oneHour = 60 * 60 * 1000;
    if (timeSincePlayed < oneHour) {
      const penalty = -300 * (1 - (timeSincePlayed / oneHour));
      score += penalty;
    }
  }

  // (b) Artist Repeat Penalty: heavily penalize artist plays within the same
  // rolling 20 minutes (up to -250, decaying). This is the backstop for the
  // fallback tiers that drop the hard isArtistAllowed check on small
  // libraries — a repeat should be a last resort, not a 3-song cycle.
  // Compare by primary artist so "X feat. Y" still counts as X.
  if (track.artist && track.artist !== 'Unknown Artist') {
    const primary = getPrimaryArtist(track.artist);
    const recentArtistPlays = state.history.filter(h => getPrimaryArtist(h.artist) === primary);
    if (recentArtistPlays.length > 0) {
      const lastPlayed = Math.max(...recentArtistPlays.map(h => h.playedAt));
      const timeSincePlayed = now - lastPlayed;
      const twentyMin = 20 * 60 * 1000;
      if (timeSincePlayed < twentyMin) {
        const penalty = -250 * (1 - (timeSincePlayed / twentyMin));
        score += penalty;
      }
    }
  }

  return score;
}

function getHeuristicMetadata(track) {
  const profileKey = getSonicProfile(track);
  const profile = SONIC_PROFILES[profileKey];

  let bpm = 110;
  let mood = profile.allowedMoods[0];

  switch(profileKey) {
    case 'INTIMATE': bpm = 75; break;
    case 'STEADY_CCM': bpm = 95; break;
    case 'CLASSIC_POP': bpm = 118; break;
    case 'DRIVING_ALT': bpm = 125; break;
    case 'HEAVY_ROCK': bpm = 135; break;
    case 'BUSY_INDUSTRIAL': bpm = 140; break;
    case 'BIG_BEAT': bpm = 132; break;
    case 'DANCE_FLOOR': bpm = 128; break;
    case 'TRADITIONAL': bpm = 145; break;
  }

  const keys = ['C Maj', 'A Min', 'G Maj', 'E Min', 'D Maj', 'B Min', 'A Maj', 'F# Min', 'F Maj', 'D Min', 'Bb Maj', 'G Min'];
  const charCodeSum = track.title.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const key = keys[charCodeSum % keys.length];

  return { bpm, key, mood };
}

function areGenresCompatible(genre1, genre2, track1, track2) {
  // If we don't have track objects, we can't check profiles, so allow it as a fallback
  if (!track1 || !track2) return true;

  const profile1 = getSonicProfile(track1);
  const profile2 = getSonicProfile(track2);

  // Rule: The two profiles must be explicitly compatible (adjacent tiers)
  const isCompatible = SONIC_PROFILES[profile1].compatibility.includes(profile2);

  if (!isCompatible) {
    console.log(`[DJ Logic] Blocked jump from ${profile1} to ${profile2}`);
  }

  return isCompatible;
}

// --- Tabs navigation setup ---
function setUpTabs() {
  const tabDashboard = document.getElementById('tab-dashboard');
  const tabLibrary = document.getElementById('tab-library');
  const contentDashboard = document.getElementById('content-dashboard');
  const contentLibrary = document.getElementById('content-library');

  if (tabDashboard && tabLibrary && contentDashboard && contentLibrary) {
    tabDashboard.addEventListener('click', () => {
      tabDashboard.classList.add('active');
      tabLibrary.classList.remove('active');
      contentDashboard.classList.add('active');
      contentLibrary.classList.remove('active');
    });

    tabLibrary.addEventListener('click', () => {
      tabLibrary.classList.add('active');
      tabDashboard.classList.remove('active');
      contentLibrary.classList.add('active');
      contentDashboard.classList.remove('active');
      renderLibraryTable();
    });
  }
}

function setUpMoodSelector() {
  moodsContainer.querySelectorAll('.mood-card').forEach(card => {
    card.addEventListener('click', () => {
      moodsContainer.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      state.mood = card.dataset.mood;

      if (state.mood === 'custom') {
        customMoodContainer.classList.remove('hidden');
      } else {
        customMoodContainer.classList.add('hidden');
        state.customMoodPrompt = '';
        logConsole(`Mood changed to: ${state.mood}`, 'info');
        state.queue = [];
        fillQueue();
        runLyricMoodAnalysis();
      }
    });
  });

  btnApplyCustomMood.addEventListener('click', () => {
    const prompt = customMoodInput.value.trim();
    if (!prompt) return;

    const applyVibe = () => {
      state.customMoodPrompt = prompt;
      logConsole(`Custom mood applied: "${prompt}"`, 'info');
      state.queue = [];
      fillQueue();
      runLyricMoodAnalysis();
    };

    // Local-only screen: if the vibe touches on suicide/self-harm, surface
    // crisis resources first. The request is still honored on Continue.
    if (detectCrisisContent(prompt)) {
      showCrisisModal(applyVibe);
    } else {
      applyVibe();
    }
  });

  customMoodInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnApplyCustomMood.click();
  });
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

    // Safety fallback: if for some reason the 'seeked' event doesn't
    // arrive, we reset the dragging flag after 1 second anyway.
    setTimeout(() => {
      state.isDraggingSlider = false;
    }, 1000);
  });

  const endDragSafety = () => {
    // If the user clicked but didn't move (no 'change' event),
    // ensure we resume slider updates.
    if (state.isDraggingSlider) {
      setTimeout(() => {
        state.isDraggingSlider = false;
      }, 200);
    }
  };

  progressSlider.addEventListener('mouseup', endDragSafety);
  progressSlider.addEventListener('touchend', endDragSafety);
}

function renderQueue() {
  if (state.queue.length === 0) {
    comingUpList.innerHTML = '<div class="empty-queue-text">No tracks queued. Add music and hit Play.</div>';
    return;
  }
  comingUpList.innerHTML = state.queue.map((item, idx) => {
    const track = state.library.find(t => t.path === item.path);
    if (!track) return '';
    return `<div class="queue-item" data-index="${idx}">
      <div class="queue-info">
        <div class="queue-title">${escapeHtml(track.title || '—')}</div>
        <div class="queue-artist">${escapeHtml(track.artist || '—')}</div>
        ${item.reason ? `<div class="queue-reason">${escapeHtml(item.reason)}</div>` : ''}
      </div>
      <button class="btn-icon queue-remove-btn" title="Remove">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"></path>
        </svg>
      </button>
    </div>`;
  }).join('');

  comingUpList.querySelectorAll('.queue-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(parseInt(btn.closest('[data-index]').dataset.index));
    });
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

let isTransitioning = false;

async function playTrack(track) {
  if (!track || isTransitioning) return;
  isTransitioning = true;
  
  try {
    state.currentTrack = track;
    state.isCrossfading = false;

    // Instruct audio process to play
    sendAudioCommand('play-track', { track });
    updateNowPlayingUI();

    await fillQueue();
  } finally {
    isTransitioning = false;
  }
}

async function playNextFromQueue() {
  if (isTransitioning) return;
  await fillQueue();
  if (state.queue.length > 0) {
    const nextItem = state.queue.shift();
    const track = state.library.find(t => t.path === nextItem.path);
    renderQueue();
    await playTrack(track);
  }
}

async function skipTrack() {
  if (isTransitioning) return;
  isTransitioning = true;

  try {
    await fillQueue();
    if (state.queue.length > 0) {
      const nextItem = state.queue.shift();
      const track = state.library.find(t => t.path === nextItem.path);
      renderQueue();

      if (state.currentTrack) {
        sendAudioCommand('start-crossfade', { nextTrack: track });
      } else {
        await playTrack(track);
      }
    }
  } finally {
    // Release the lock after a short delay to prevent accidental double-clicks
    setTimeout(() => {
      isTransitioning = false;
    }, 500);
  }
}

async function playNextTrackFromQueue() {
  // If we are already handling a transition (manual or auto), ignore this request
  if (isTransitioning) return;
  isTransitioning = true;

  try {
    if (state.queue.length > 0) {
      const nextItem = state.queue.shift();
      const track = state.library.find(t => t.path === nextItem.path);
      renderQueue();
      sendAudioCommand('start-crossfade', { nextTrack: track });
    }
  } finally {
    setTimeout(() => {
      isTransitioning = false;
    }, 500);
  }
}

async function removeFromQueue(index) {
  if (index >= 0 && index < state.queue.length) {
    const removed = state.queue.splice(index, 1)[0];
    const track = state.library.find(t => t.path === removed.path);
    logConsole(`Removed from queue: "${track ? track.title : 'Unknown'}"`, 'info');
    renderQueue();
    await fillQueue(); // Maintain lookahead buffer
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

  if (state.currentTrack.albumArt && (state.currentTrack.albumArt.startsWith('http') || state.currentTrack.albumArt.length > 500)) {
    // If it's an external URL (MusicBrainz) or a long data URL, use it directly.
    albumArt.src = state.currentTrack.albumArt;
  } else {
    // Pull from the file itself via the high-performance art protocol
    // Using triple-slash, encoding, and a timestamp to force refresh on track change
    const artUrl = `app-media:///art/${encodeURIComponent(state.currentTrack.path)}?v=${Date.now()}`;
    albumArt.src = artUrl;
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
    
    // UA is injected at the session layer (main.js); setting it here would
    // force a CORS preflight that MusicBrainz rejects.
    const response = await fetch(url);

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

    const cleanTitle = escapeHtml(rec.title);
    const cleanArtistCredit = escapeHtml(rec['artist-credit']?.[0]?.name || artist);
    const cleanAlbum = escapeHtml(albumName);
    const cleanReleaseDate = escapeHtml(releaseDate);
    const cleanCountry = escapeHtml(country);
    const cleanTags = escapeHtml(tagsList);

    enrichmentContent.innerHTML = `
      <div style="display:flex; flex-direction:column; gap: 8px;">
        <div style="font-size:0.9rem; font-weight:700; color:white;">${cleanTitle}</div>
        <div style="font-size:0.78rem; color:var(--primary-hover); margin-bottom: 4px;">by ${cleanArtistCredit}</div>
        
        <div class="enriched-data-grid">
          <div class="enriched-tag">
            <strong>Album</strong>
            ${cleanAlbum}
          </div>
          <div class="enriched-tag">
            <strong>Release Date</strong>
            ${cleanReleaseDate}
          </div>
          <div class="enriched-tag">
            <strong>Country</strong>
            ${cleanCountry}
          </div>
          <div class="enriched-tag">
            <strong>Tags / Genres</strong>
            ${cleanTags}
          </div>
        </div>
      </div>
    `;
    
    // Attempt Cover Art Archive fetch if no embedded cover art
    if (state.currentTrack && state.currentTrack.artist === artist && state.currentTrack.title === title) {
      if (!state.currentTrack.albumArt && releases.length > 0 && releases[0].id) {
        const releaseId = releases[0].id;
        const caaUrl = `https://coverartarchive.org/release/${releaseId}/front-250`;

        try {
          const imgResp = await fetch(caaUrl);
          if (imgResp.ok) {
            const blob = await imgResp.blob();
            const dataUrl = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            if (dataUrl && dataUrl.length > 500) {
              state.currentTrack.albumArt = dataUrl;
              albumArt.src = dataUrl;

              const libTrack = state.library.find(t => t.path === state.currentTrack.path);
              if (libTrack) libTrack.albumArt = dataUrl;

              await dbSaveTrack(state.currentTrack);
              renderLibraryTable();
            }
          }
        } catch (err) {
          console.warn('Cover art fetch failed in enrichMetadata:', err);
        }
      }
    }
  } catch (err) {
    console.error('Internet Enrichment error:', err);
    enrichmentContent.innerHTML = `
      <div class="enrichment-placeholder">
        <p>Offline / Could not connect to MusicBrainz database.</p>
      </div>
    `;
  }
}

/**
 * Strip a leading ID3v2 tag block from an audio buffer, which trips up
 * decodeAudioData on some files. Returns the original buffer when no valid
 * tag is present.
 * @param {ArrayBuffer} arrayBuffer - Raw file bytes.
 * @returns {ArrayBuffer}
 */
function stripId3v2(arrayBuffer) {
  const uint8 = new Uint8Array(arrayBuffer);
  // Check if it starts with "ID3" (hex: 49 44 33)
  if (uint8[0] === 0x49 && uint8[1] === 0x44 && uint8[2] === 0x33) {
    const byte6 = uint8[6];
    const byte7 = uint8[7];
    const byte8 = uint8[8];
    const byte9 = uint8[9];
    
    // Synchsafe integer size bytes must be < 128
    if (byte6 < 128 && byte7 < 128 && byte8 < 128 && byte9 < 128) {
      const size = (byte6 << 21) | (byte7 << 14) | (byte8 << 7) | byte9;
      let totalSize = 10 + size;
      
      // If footer is present (flags bit 4 is set)
      if ((uint8[5] & 0x10) !== 0) {
        totalSize += 10;
      }
      
      if (totalSize < arrayBuffer.byteLength) {
        return arrayBuffer.slice(totalSize);
      }
    }
  }
  return arrayBuffer;
}

function normalizePath(filePath) {
  if (!filePath) return '';
  let normalized = filePath.replace(/\//g, '\\');
  if (normalized.length >= 2 && normalized[1] === ':') {
    normalized = normalized[0].toUpperCase() + normalized.slice(1);
  }
  return normalized;
}

/**
 * Repair corrupted metadata values that may have been stored in IndexedDB by
 * earlier versions of the app (before scan-time sanitization was added):
 * BPM range, key format, text fields, genre dumps, album art validity,
 * ReplayGain bounds, and loudness bounds.
 * @param {object} track - Track as loaded from IndexedDB (mutated in place).
 * @returns {object} The same track, sanitized.
 */
function sanitizeLibraryTrack(track) {
  // BPM: must be a whole number in a realistic musical range
  if (track.bpm !== null && track.bpm !== undefined) {
    const n = parseInt(track.bpm, 10);
    track.bpm = (!isNaN(n) && n >= 20 && n <= 300) ? n : null;
  }

  // Key: normalise to "Note Maj/Min" — mirrors the main-process normalizeKey logic
  if (track.key) {
    let s = String(track.key).trim().replace(/\/.*$/, '').trim();
    let m;
    m = s.match(/^([A-G][#b]?)\s+(Maj|Min)$/i);
    if (m) { track.key = `${m[1]} ${m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()}`; }
    else if ((m = s.match(/^([A-G][#b]?)\s+(major|minor)$/i))) {
      track.key = `${m[1]} ${m[2].toLowerCase() === 'minor' ? 'Min' : 'Maj'}`;
    } else if ((m = s.match(/^([A-G][#b]?)m$/i))) {
      track.key = `${m[1]} Min`;
    } else if ((m = s.match(/^([A-G][#b]?)$/i))) {
      track.key = `${m[1]} Maj`;
    } else {
      track.key = null; // unrecognised — Essentia will re-analyse
    }
  }

  // Text fields: strip null bytes and collapse blank values to sensible defaults
  const textDefaults = { title: null, artist: 'Unknown Artist', album: 'Unknown Album', genre: 'Unknown' };
  Object.keys(textDefaults).forEach(field => {
    if (track[field] !== undefined) {
      let cleaned = String(track[field] ?? '').replace(/\0/g, '').trim();

      // Specific fix for mis-tagged "Podcast" genre (e.g. Sea Wolf)
      if (field === 'genre' && (cleaned.toLowerCase() === 'podcast' || cleaned === '186')) {
        if (track.artist && track.artist.toLowerCase().includes('sea wolf')) {
          cleaned = 'Indie Rock';
        } else {
          cleaned = 'Unknown';
        }
      }

      // Fix for "Carbine (Escape Mix)" - ensuring it's seen as Industrial/Electronic, not Metal
      if (field === 'genre' && track.title && track.title.toLowerCase().includes('carbine')) {
        cleaned = 'Industrial Electronic';
      }

      // Collapse multi-genre tag dumps ("Rock;Pop;Dance/Electronic;...") to the
      // first listed genre and cap runaway lengths (some files carry 128+ chars)
      if (field === 'genre' && cleaned) {
        const g = cleanGenre(cleaned);
        cleaned = (g === 'Unknown') ? '' : g;
      }

      track[field] = cleaned || textDefaults[field] ||
        (field === 'title' ? track.path.split('\\').pop().replace(/\.[^.]+$/, '') : '');
    }
  });

  // albumArt: must be valid, decodable image data (or an https URL).
  // Corrupt/stub art is cleared here so the background art repairer can
  // re-fetch it from MusicBrainz.
  if (track.albumArt != null && !isAlbumArtValid(track.albumArt)) {
    track.albumArt = null;
  }

  // ReplayGain: validate dB gain (−51 to +51) and linear peak (0 to 2)
  if (track.replaygainTrackGain != null) {
    const n = parseFloat(track.replaygainTrackGain);
    track.replaygainTrackGain = (!isNaN(n) && n > -51 && n < 51) ? parseFloat(n.toFixed(2)) : null;
  }
  if (track.replaygainTrackPeak != null) {
    const n = parseFloat(track.replaygainTrackPeak);
    track.replaygainTrackPeak = (!isNaN(n) && n > 0 && n <= 2) ? parseFloat(n.toFixed(6)) : null;
  }

  // loudness (RMS): must be a positive number, typically < 1
  if (track.loudness != null) {
    const n = parseFloat(track.loudness);
    track.loudness = (!isNaN(n) && n > 0 && n <= 1) ? parseFloat(n.toFixed(4)) : null;
  }

  return track;
}

// Always create a fresh OfflineAudioContext per decode — reusing a single
// context causes abort() crashes on some tracks (e.g. after a failed decode).
function createFreshAudioCtx() {
  return new (window.OfflineAudioContext || window.AudioContext)(1, 44100, 44100);
}

// Safe wrapper around decodeAudioData that falls back to the original buffer if the tag-stripped buffer fails.
// No backup copy is needed: stripId3v2 returns a DISTINCT buffer when a tag exists
// (so the original is never detached by the first decode), and when no tag exists
// a fallback decode of identical bytes would fail identically anyway.
async function decodeAudioDataWithFallback(arrayBuffer) {
  const ctx = createFreshAudioCtx(); // fresh every time
  const cleanBuffer = stripId3v2(arrayBuffer);

  if (cleanBuffer === arrayBuffer) {
    // No ID3 tag — single attempt, nothing different to fall back to
    return await ctx.decodeAudioData(arrayBuffer);
  }

  try {
    return await ctx.decodeAudioData(cleanBuffer);
  } catch (stripErr) {
    // Under memory pressure a second full decode only makes things worse
    if (/allocation|out of memory/i.test(stripErr.message || '')) throw stripErr;
    console.warn('Tag-stripped decode failed; falling back to original buffer...', stripErr);
    const ctx2 = createFreshAudioCtx(); // fresh again — don't reuse a context that already errored
    return await ctx2.decodeAudioData(arrayBuffer);
  }
}

// Files above this size are skipped by analysis (decoded PCM would be several
// GB); they get heuristic metadata instead.
const MAX_ANALYSIS_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Decode an audio file to a mono Float32Array for Essentia analysis.
 * Decoding uses OfflineAudioContext (renderer-only); the resulting samples
 * are then transferred (zero-copy) to the Essentia worker.
 * @param {string} trackPath - Absolute path of the audio file.
 * @returns {Promise<{samples: Float32Array, sampleRate: number}>}
 * @throws {Error} When the file cannot be fetched or decoded.
 */
async function decodeTrackToMono(trackPath) {
  const secureUrl = 'app-media:///' + trackPath.replace(/\\/g, '/');
  const response = await fetch(secureUrl);
  if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_ANALYSIS_FILE_BYTES) {
    // "too large" routes through recordAnalysisFailure as non-retryable
    throw new Error(`file too large for analysis (${Math.round(arrayBuffer.byteLength / 1024 / 1024)} MB)`);
  }
  const audioBuffer = await decodeAudioDataWithFallback(arrayBuffer);

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

/**
 * Fallback beat detector: Web Audio envelope peak analysis used when
 * Essentia is unavailable. Estimates BPM (if unknown) and the downbeat
 * offset by scoring candidate beat-grid phases against detected transients.
 * @param {string} trackPath - Absolute path of the audio file.
 * @param {number|null} knownBpm - BPM from tags/Essentia, if already known.
 * @returns {Promise<{bpm: number, beatOffset: number}>}
 * @throws {Error} When the file cannot be fetched or decoded.
 */
async function runTransientAnalysis(trackPath, knownBpm) {
  const secureUrl = 'app-media:///' + trackPath.replace(/\\/g, '/');
  const response = await fetch(secureUrl);
  if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
  
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await decodeAudioDataWithFallback(arrayBuffer);
  
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