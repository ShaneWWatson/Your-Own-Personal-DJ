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
  ollamaStatus: 'checking', // checking (loading model), connected (ready), fallback (rules active), disconnected (failed)
  ollamaModel: null,
  isEnrichmentEnabled: true,
  
  // DJ Crossfading & Device settings
  crossfadeDuration: 6, // default 6 seconds
  isCrossfading: false,
  masterVolume: 0.8,
  outputDeviceId: 'default',
  isDraggingSlider: false
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

// Dual Audio Player Elements for Crossfading
const audioPlayerA = document.getElementById('audio-player-a');
const audioPlayerB = document.getElementById('audio-player-b');
let activePlayer = audioPlayerA;
let inactivePlayer = audioPlayerB;

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

// Local Transformers.js references
let pipeline = null;
let env = null;
let generator = null;

// Initialize App & Local AI Pipeline
window.addEventListener('load', async () => {
  logConsole('Initializing Your Own Personal DJ...', 'system');
  
  // Set default player volumes
  audioPlayerA.volume = state.masterVolume;
  audioPlayerB.volume = 0;

  // Load folders and library from cache
  const cachedLibrary = await window.api.loadLibrary();
  if (cachedLibrary) {
    state.library = cachedLibrary.library || [];
    state.folders = cachedLibrary.folders || [];
    logConsole(`Loaded ${state.library.length} tracks from library cache.`, 'success');
    renderFoldersList();
    renderLibraryTable();
    checkScanButtonState();
    updateAnalysisProgress();
  } else {
    // Attempt to load system default music folder
    const systemMusic = await window.api.getSystemMusicFolder();
    if (systemMusic) {
      state.folders.push(systemMusic);
      renderFoldersList();
      checkScanButtonState();
    }
  }

  // Set up settings triggers
  setUpSettings();

  // Set up audio player triggers
  setUpAudioPlayer();

  // Initialize local AI engine (runs in background)
  await initLocalAI();

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
  
  // Add timestamp
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
  
  // Auto dismiss after 5 seconds
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
  });
  
  btnSettingsClose.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  crossfadeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.crossfadeDuration = val;
    crossfadeValue.innerText = `${val}s`;
  });

  selectOutputDevice.addEventListener('change', async (e) => {
    const deviceId = e.target.value;
    state.outputDeviceId = deviceId;
    
    try {
      if (typeof audioPlayerA.setSinkId === 'function') {
        await audioPlayerA.setSinkId(deviceId);
        await audioPlayerB.setSinkId(deviceId);
        logConsole(`Audio output device changed successfully.`, 'success');
      } else {
        logConsole('Changing audio output device is not supported in this environment.', 'warning');
      }
    } catch (err) {
      logConsole(`Error setting audio output device: ${err.message}`, 'danger');
    }
  });
}

async function updateOutputDevices() {
  try {
    // Request permission implicitly if not granted
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

// --- Self-Contained Local AI Engine (Transformers.js) ---
async function initLocalAI() {
  state.ollamaStatus = 'checking';
  updateAIStatusUI();
  logConsole('Loading Transformers.js pipeline...', 'system');

  try {
    const tf = await import('@huggingface/transformers');
    pipeline = tf.pipeline;
    env = tf.env;

    const modelId = 'onnx-community/gemma-2-2b-it-ONNX-w4a16';
    logConsole('Loading local Gemma model weights (WebGPU)...', 'info');

    generator = await pipeline('text-generation', modelId, {
      device: 'webgpu',
      progress_callback: (data) => {
        if (data.status === 'downloading') {
          const percent = Math.round((data.loaded / data.total) * 100);
          if (percent % 10 === 0) {
            logConsole(`Downloading Gemma model: ${percent}% of ${data.file}`, 'info');
          }
        } else if (data.status === 'done') {
          logConsole(`Loaded weights block: ${data.file}`, 'success');
        }
      }
    });

    state.ollamaStatus = 'connected';
    state.ollamaModel = 'Gemma 2B (Local WebGPU)';
    logConsole('Local Gemma model loaded and active using WebGPU acceleration!', 'success');
  } catch (err) {
    console.error('WebGPU loading failed, trying CPU WASM fallback:', err);
    logConsole(`WebGPU failed: ${err.message}. Retrying with CPU WebAssembly...`, 'warning');
    
    try {
      const modelId = 'onnx-community/gemma-2-2b-it-ONNX-w4a16';
      generator = await pipeline('text-generation', modelId, {
        device: 'wasm',
        progress_callback: (data) => {
          if (data.status === 'downloading') {
            const percent = Math.round((data.loaded / data.total) * 100);
            if (percent % 10 === 0) {
              logConsole(`Downloading weights (WASM fallback): ${percent}%`, 'info');
            }
          }
        }
      });
      state.ollamaStatus = 'connected';
      state.ollamaModel = 'Gemma 2B (Local CPU WASM)';
      logConsole('Local Gemma model loaded successfully using CPU WASM fallback.', 'success');
    } catch (fallbackErr) {
      console.error('All local AI loaders failed:', fallbackErr);
      state.ollamaStatus = 'fallback';
      state.ollamaModel = 'Local Heuristic Engine';
      logConsole(`AI load failed: ${fallbackErr.message}. Operating in smart heuristic mode.`, 'danger');
    }
  }

  updateAIStatusUI();
}

function updateAIStatusUI() {
  aiStatusBadge.className = `ai-status-badge ${state.ollamaStatus}`;
  
  if (state.ollamaStatus === 'connected') {
    aiStatusText.innerText = 'Active';
    aiModelName.innerText = state.ollamaModel;
  } else if (state.ollamaStatus === 'checking') {
    aiStatusText.innerText = 'Loading...';
    aiModelName.innerText = 'Initializing Model...';
  } else if (state.ollamaStatus === 'fallback') {
    aiStatusText.innerText = 'Heuristics';
    aiModelName.innerText = 'Rule-based Heuristics';
  } else {
    aiStatusText.innerText = 'Offline';
    aiModelName.innerText = 'Local Heuristics';
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
    saveLibraryState();
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
    btnRemove.addEventListener('click', () => {
      state.folders.splice(idx, 1);
      renderFoldersList();
      saveLibraryState();
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
  
  // Track scanned paths to clean up dead links in database
  state.scannedPaths = new Set();
  
  logConsole('Starting asynchronous library scan...', 'info');
  window.api.startScan(state.folders);
});

let libraryRenderTimeout = null;

window.api.onScanProgress((data) => {
  const { current, total, track } = data;
  const percent = Math.round((current / total) * 100);
  
  scanProgressBar.style.width = `${percent}%`;
  scanPercentage.innerText = `${percent}%`;
  scanStatusText.innerText = `Scanned ${current}/${total} files`;

  // Record scanned path
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
    state.library[existingIdx] = track;
  } else {
    state.library.push(track);
  }

  if (!libraryRenderTimeout) {
    libraryRenderTimeout = setTimeout(() => {
      renderLibraryTable();
      libraryRenderTimeout = null;
    }, 300);
  }
});

window.api.onScanComplete((data) => {
  state.isScanning = false;
  checkScanButtonState();
  scanProgressContainer.classList.add('hidden');
  
  // Clean up dead/deleted paths that were not found in the scan
  if (state.scannedPaths) {
    state.library = state.library.filter(t => state.scannedPaths.has(t.path));
    delete state.scannedPaths;
  }
  
  if (libraryRenderTimeout) {
    clearTimeout(libraryRenderTimeout);
    libraryRenderTimeout = null;
  }
  renderLibraryTable();
  saveLibraryState();
  updateAnalysisProgress();
  
  logConsole(`Library scan complete. Found ${data.total} audio files.`, 'success');
  showNotification('Scanning Completed', `Successfully scanned and cataloged ${data.total} music tracks.`);
});

async function saveLibraryState() {
  await window.api.saveLibrary({
    folders: state.folders,
    library: state.library
  });
}

// --- Background Metadata Processor (BPM & Key via Gemma & Transient Analysis) ---
let isProcessingMetadata = false;

// Audio Transient analysis helper
async function analyzeTrackAudio(trackPath, knownBpm = null) {
  try {
    const secureUrl = 'app-media:///' + trackPath.replace(/\\/g, '/');
    const response = await fetch(secureUrl);
    if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const ctx = new (window.OfflineAudioContext || window.AudioContext)(1, 44100, 44100);
    
    // Decode audio data
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    
    // We only analyze the first 30 seconds for speed and memory efficiency
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const duration = Math.min(audioBuffer.duration, 30);
    
    const stepSeconds = 0.01; // 10ms windows
    const stepSamples = Math.floor(sampleRate * stepSeconds);
    const numSteps = Math.floor(duration / stepSeconds);
    
    // 1. Calculate energy envelope (absolute amplitude)
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
    
    // 2. Detect peaks in the envelope
    const peakTimes = [];
    const peakAmplitudes = [];
    const movingAverageWindow = 15; // 150ms window
    
    for (let i = movingAverageWindow; i < numSteps - movingAverageWindow; i++) {
      let localSum = 0;
      for (let j = i - movingAverageWindow; j <= i + movingAverageWindow; j++) {
        localSum += envelope[j];
      }
      const localAvg = localSum / (2 * movingAverageWindow + 1);
      
      // Look for peaks that are 30% higher than the local average
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
    
    // 3. Determine BPM if not known
    let bpm = knownBpm;
    if (!bpm) {
      // Calculate intervals between peaks (up to 4s apart)
      const intervals = [];
      for (let i = 0; i < peakTimes.length; i++) {
        for (let j = i + 1; j < Math.min(i + 10, peakTimes.length); j++) {
          const interval = peakTimes[j] - peakTimes[i];
          if (interval >= 0.3 && interval <= 1.2) { // 50 to 200 BPM
            intervals.push(interval);
          }
        }
      }
      
      if (intervals.length > 0) {
        // Group intervals into bins to find the most common tempo (BPM)
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
        bpm = 100; // fallback
      }
    }
    
    // 4. Grid fitting to find the first beat offset
    const T = 60 / bpm;
    let bestOffset = 0;
    let maxScore = -1;
    const numCandidates = 100;
    const sigma = 0.03; // 30ms tolerance
    
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
  } catch (err) {
    console.error('Error in analyzeTrackAudio:', err);
    return { bpm: knownBpm || 100, beatOffset: 0 };
  }
}

// Tempo-drift ramp helper to slide playbackRate back to target smoothly
function rampPlaybackRate(player, targetRate, durationMs) {
  const startRate = player.playbackRate;
  if (startRate === targetRate) return;
  
  const stepTime = 100; // update rate every 100ms
  const totalSteps = durationMs / stepTime;
  let currentStep = 0;
  
  const interval = setInterval(() => {
    currentStep++;
    const ratio = currentStep / totalSteps;
    
    if (ratio >= 1) {
      clearInterval(interval);
      player.playbackRate = targetRate;
      logConsole(`Tempo drift complete. Track playing at original speed (${targetRate}x)`, 'system');
    } else {
      player.playbackRate = startRate + (targetRate - startRate) * ratio;
    }
  }, stepTime);
}

function updateAnalysisProgress() {
  if (state.library.length === 0) {
    analysisProgressContainer.classList.add('hidden');
    return;
  }

  const total = state.library.length;
  // A track is completed if it has bpm, key, mood, and beatOffset
  const completed = state.library.filter(t => t.bpm !== null && t.key !== null && t.mood !== undefined && t.mood !== null && t.beatOffset !== undefined && t.beatOffset !== null).length;
  const remaining = total - completed;

  if (remaining > 0) {
    analysisProgressContainer.classList.remove('hidden');
    const percent = Math.round((completed / total) * 100);
    analysisProgressBar.style.width = `${percent}%`;
    analysisPercentage.innerText = `${percent}%`;
    
    const engineType = state.ollamaStatus === 'connected' ? 'AI' : 'Heuristics';
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
  logConsole(`Analyzing metadata for "${track.title}" using local AI & audio analyzer...`, 'info');

  let bpm = track.bpm;
  let key = track.key;
  let beatOffset = track.beatOffset;

  if (bpm === null || key === null) {
    if (state.ollamaStatus === 'connected' && generator) {
      try {
        const prompt = `<start_of_turn>user\nEstimate the BPM (beats per minute, integer), musical Key (e.g., C Maj, A Min, F# Maj, E Min), and Mood (a single-word general mood descriptor in lowercase, e.g., chill, focus, energy, party, sad, dark, uplifting, calm, intense) for the following track.
        Track: "${track.title}"
        Artist: "${track.artist}"
        Genre: "${track.genre}"
        
        Respond ONLY in raw JSON format with this structure:
        {"bpm": 120, "key": "A Min", "mood": "chill"}<end_of_turn>\n<start_of_turn>model\n`;

        const output = await generator(prompt, {
          max_new_tokens: 80,
          temperature: 0.1,
          return_full_text: false
        });

        const generatedText = output[0].generated_text;
        const parsed = parseLLMJSON(generatedText);
        
        bpm = parseInt(parsed.bpm) || 100;
        key = parsed.key || 'C Maj';
        mood = parsed.mood || 'chill';
        logConsole(`Gemma analyzed "${track.title}": Estimated BPM: ${bpm}, Key: ${key}, Mood: ${mood}`, 'ai');
      } catch (err) {
        logConsole(`Gemma metadata estimation failed: ${err.message}. Using fallback.`, 'warning');
        const fallback = getHeuristicMetadata(track);
        bpm = fallback.bpm;
        key = fallback.key;
        mood = fallback.mood;
      }
    } else {
      const fallback = getHeuristicMetadata(track);
      bpm = fallback.bpm;
      key = fallback.key;
      mood = fallback.mood;
      logConsole(`Heuristics analyzed "${track.title}": Estimated BPM: ${bpm}, Key: ${key}, Mood: ${mood}`, 'system');
    }
  }

  // Analyze audio transients for beatOffset if missing
  if (beatOffset === undefined || beatOffset === null) {
    logConsole(`Analyzing audio transients for "${track.title}"...`, 'info');
    const audioAnalysis = await analyzeTrackAudio(track.path, bpm);
    beatOffset = audioAnalysis.beatOffset;
    if (audioAnalysis.bpm && (!track.bpm || track.bpm === 100)) {
      bpm = audioAnalysis.bpm;
      logConsole(`Refined BPM for "${track.title}" from audio analysis: ${bpm}`, 'success');
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
      logConsole(`Successfully wrote tags to file: ${track.title}`, 'success');
    } else {
      logConsole(`Failed to write tags: ${res.error}`, 'warning');
    }
  }

  await saveLibraryState();
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
  const timeLimit = 20 * 60 * 1000;
  
  const recentPlay = state.history.find(h => h.artist === artist && (now - h.playedAt) < timeLimit);
  return !recentPlay;
}

function isSongAllowed(path) {
  const now = Date.now();
  const timeLimit = 60 * 60 * 1000;
  
  const recentPlay = state.history.find(h => h.path === path && (now - h.playedAt) < timeLimit);
  return !recentPlay;
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
  
  // Strictly prevent direct Mild <-> Heavy transitions
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
  // Layer 1: Strict - respect both artist cooldown and 1-hour song cooldown, and genre compatibility
  let candidates = state.library.filter(track => {
    if (state.queue.some(q => q.path === track.path)) return false;
    if (state.currentTrack && state.currentTrack.path === track.path) return false;
    if (state.currentTrack && !areGenresCompatible(state.currentTrack.genre, track.genre)) return false;
    if (!isArtistAllowed(track.artist)) return false;
    if (!isSongAllowed(track.path)) return false;
    return true;
  });

  // Layer 2: Relax artist cooldown, but strictly respect the 1-hour song cooldown and genre compatibility
  if (candidates.length === 0) {
    candidates = state.library.filter(track => {
      if (state.queue.some(q => q.path === track.path)) return false;
      if (state.currentTrack && state.currentTrack.path === track.path) return false;
      if (state.currentTrack && !areGenresCompatible(state.currentTrack.genre, track.genre)) return false;
      if (!isSongAllowed(track.path)) return false;
      return true;
    });
  }

  // Layer 3: Absolute fallback (only when the library has fewer songs than played in 1 hour)
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

  // 1. Local AI Decision Maker
  if (state.ollamaStatus === 'connected' && generator) {
    try {
      let selectedPool = [];
      if (state.mood === 'custom') {
        // Shuffle candidates randomly to give the AI a varied sample to evaluate for the custom mood
        const shuffled = [...candidates].sort(() => 0.5 - Math.random());
        selectedPool = shuffled.slice(0, 15);
      } else {
        selectedPool = candidates
          .map(c => ({
            score: getHeuristicScore(c, currentBpm, currentGenre, currentKey),
            track: c
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map(item => item.track);
      }

      const prompt = `<start_of_turn>user\nYou are a professional radio DJ. Pick the NEXT song to play from the Candidate Pool to match the user's mood: "${state.mood === 'custom' ? state.customMoodPrompt : state.mood}".
      
      Current playing song:
      - Title: "${state.currentTrack?.title || 'None'}"
      - Artist: "${state.currentTrack?.artist || 'None'}"
      - Genre: "${currentGenre}"
      - BPM: ${currentBpm}
      - Key: "${currentKey}"
      - Mood: "${state.currentTrack?.mood || 'unknown'}"
      
      Rules:
      1. Ensure a smooth transition. Do not transition directly between mild genres (e.g. classical, ambient, lofi, acoustic, jazz) and heavy genres (e.g. metal, punk, hard rock, grunge). If moving between these types, you MUST select a medium genre song (e.g. pop, rock, indie, electronic) to bridge the transition.
      2. Keep similar tempos when appropriate.
      3. The user's requested mood "${state.mood === 'custom' ? state.customMoodPrompt : state.mood}" is the ABSOLUTE PRIMARY factor. Prioritize candidates whose analyzed Mood matches or fits this requested mood above all else. BPM matching and Key matching are secondary criteria to be used only for fine-tuning smooth transitions.
      
      Candidate Pool:
      ${selectedPool.map((c, i) => `${i}. Path: "${c.path}", Title: "${c.title}", Artist: "${c.artist}", Genre: "${c.genre}", BPM: ${c.bpm || 'unknown'}, Key: "${c.key || 'unknown'}", Mood: "${c.mood || 'unknown'}"`).join('\n')}
      
      Respond ONLY in raw JSON format with this structure:
      {"path": "selected path", "reason": "DJ transition announcement (max 20 words)"}<end_of_turn>\n<start_of_turn>model\n`;

      const output = await generator(prompt, {
        max_new_tokens: 120,
        temperature: 0.3,
        return_full_text: false
      });

      const generatedText = output[0].generated_text;
      const parsed = parseLLMJSON(generatedText);
      
      const chosenTrack = state.library.find(t => t.path === parsed.path);
      if (chosenTrack) {
        logConsole(`Gemma DJ selected: "${chosenTrack.title}" by ${chosenTrack.artist}`, 'ai');
        logConsole(`Gemma Reason: "${parsed.reason}"`, 'ai');
        return {
          path: chosenTrack.path,
          reason: parsed.reason
        };
      }
    } catch (e) {
      logConsole(`Gemma DJ selection failed: ${e.message}. Using rule fallback.`, 'warning');
    }
  }

  // 2. Heuristic Rule Engine
  const scoredCandidates = candidates.map(c => {
    return {
      track: c,
      score: getHeuristicScore(c, currentBpm, currentGenre, currentKey)
    };
  });

  scoredCandidates.sort((a, b) => b.score - a.score);
  
  // Pick randomly from the top 5 compatible candidates to ensure random playback order
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

  logConsole(`Heuristic DJ selected: "${best.title}" by ${best.artist} (Score: ${candidatePool[chosenIndex].score})`, 'system');
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
    score += matches * 100; // Strong primary boost for custom prompts
  } else {
    // Exact mood tag match
    if (track.mood && track.mood.toLowerCase() === state.mood.toLowerCase()) {
      score += 200; // Primary factor: Exact mood match
    } else if (track.mood) {
      // Related mood descriptors
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

    // Target Genres for the selected mood
    const profile = moodProfiles[state.mood];
    if (profile) {
      const trackGenre = track.genre.toLowerCase();
      const genreMatch = profile.targetGenres.some(tg => trackGenre.includes(tg));
      if (genreMatch) score += 50; // Genre vibe match is a strong secondary factor
    }
  }

  // 2. Transitions, BPM, and Key (Secondary Factors)
  const profile = state.mood !== 'custom' ? moodProfiles[state.mood] : null;
  if (profile && track.bpm && track.bpm >= profile.bpmRange[0] && track.bpm <= profile.bpmRange[1]) {
    score += 20; // Secondary factor: BPM is in the target mood range
  }

  if (state.currentTrack) {
    // Jarring transition penalty (e.g. classical to heavy metal) remains high
    if (areGenresCompatible(currentGenre, track.genre)) {
      score += 10;
    } else {
      score -= 100; // Heavy penalty to prevent jarring shifts
    }

    // Transition BPM alignment
    if (track.bpm) {
      const bpmDiff = Math.abs(track.bpm - currentBpm);
      if (bpmDiff < 10) score += 20;
      else if (bpmDiff < 20) score += 10;
      else score -= 15;
    }

    // Transition Key compatibility
    if (track.key && track.key === currentKey) {
      score += 10;
    }
  }

  return score;
}

// --- DJ Smooth Transition / Crossfading & Playback ---
let crossfadeInterval = null;

async function startCrossfade(nextTrack) {
  if (state.isCrossfading) return;
  state.isCrossfading = true;

  logConsole(`DJ Transition: Crossfading into "${nextTrack.title}" by ${nextTrack.artist}...`, 'info');

  // 1. Get BPM and offset for outgoing and incoming tracks
  const currentTrack = state.currentTrack;
  const currentBpm = currentTrack?.bpm || 100;
  const currentOffset = currentTrack?.beatOffset || 0;
  
  let nextBpm = nextTrack.bpm || 100;
  let nextOffset = nextTrack.beatOffset;
  
  if (nextOffset === undefined || nextOffset === null) {
    logConsole(`On-the-fly audio analysis for "${nextTrack.title}"...`, 'info');
    const analysis = await analyzeTrackAudio(nextTrack.path, nextBpm);
    nextOffset = analysis.beatOffset;
    nextTrack.beatOffset = nextOffset;
    
    // Save to library state
    const libTrack = state.library.find(t => t.path === nextTrack.path);
    if (libTrack) {
      libTrack.beatOffset = nextOffset;
      saveLibraryState();
    }
  }

  // 2. Calculate tempo alignment (playbackRate)
  const playbackRateIn = currentBpm / nextBpm;
  const clampedPlaybackRateIn = Math.max(0.85, Math.min(1.15, playbackRateIn));
  
  logConsole(`Tempo matching: Outgoing BPM: ${currentBpm}, Incoming BPM: ${nextBpm}. Setting incoming playbackRate to ${clampedPlaybackRateIn.toFixed(3)}`, 'system');

  // 3. Set up incoming player source and rate
  const secureUrl = 'app-media:///' + nextTrack.path.replace(/\\/g, '/');
  inactivePlayer.src = secureUrl;
  inactivePlayer.playbackRate = clampedPlaybackRateIn;
  inactivePlayer.volume = 0;

  // Apply output device sinkId
  if (state.outputDeviceId && typeof inactivePlayer.setSinkId === 'function') {
    inactivePlayer.setSinkId(state.outputDeviceId).catch(err => console.error(err));
  }

  // 4. Calculate phase alignment (beat synchronization)
  const tOut = activePlayer.currentTime;
  const T_beat_in = 60 / nextBpm;
  
  const mod = (n, m) => ((n % m) + m) % m;
  let startIn = mod(clampedPlaybackRateIn * (tOut - currentOffset) + nextOffset, T_beat_in);
  
  inactivePlayer.currentTime = startIn;
  logConsole(`Beat matching: Cueing incoming track "${nextTrack.title}" at ${startIn.toFixed(3)}s to align with outgoing beat grid`, 'system');

  // 5. Swap active and inactive players IMMEDIATELY so the UI and timelines track the incoming song!
  const outgoingPlayer = activePlayer;
  const incomingPlayer = inactivePlayer;
  
  activePlayer = incomingPlayer;
  inactivePlayer = outgoingPlayer;

  // 6. Update current track and now playing UI immediately!
  state.currentTrack = nextTrack;
  updateNowPlayingUI();

  state.history.push({
    path: nextTrack.path,
    artist: nextTrack.artist,
    playedAt: Date.now()
  });
  if (state.history.length > 100) state.history.shift();

  if (state.isEnrichmentEnabled) {
    enrichMetadata(nextTrack.artist, nextTrack.title);
  }

  // Handle 0s crossfade
  if (state.crossfadeDuration === 0) {
    inactivePlayer.pause();
    inactivePlayer.currentTime = 0;
    inactivePlayer.volume = 0;
    inactivePlayer.playbackRate = 1.0;
    
    activePlayer.volume = state.masterVolume;
    activePlayer.play().then(() => {
      rampPlaybackRate(activePlayer, 1.0, 5000);
      state.isCrossfading = false;
      fillQueue();
    }).catch(err => {
      console.error(err);
      state.isCrossfading = false;
    });
    return;
  }

  activePlayer.play().then(() => {
    let elapsed = 0;
    const intervalTime = 50; // 50ms steps
    const totalSteps = (state.crossfadeDuration * 1000) / intervalTime;
    
    if (crossfadeInterval) clearInterval(crossfadeInterval);

    crossfadeInterval = setInterval(() => {
      elapsed++;
      const ratio = elapsed / totalSteps;
      
      if (ratio >= 1) {
        clearInterval(crossfadeInterval);
        
        inactivePlayer.pause();
        inactivePlayer.currentTime = 0;
        inactivePlayer.volume = 0;
        inactivePlayer.playbackRate = 1.0; // Reset outgoing speed
        
        activePlayer.volume = state.masterVolume;
        state.isCrossfading = false;
        
        rampPlaybackRate(activePlayer, 1.0, 5000); // drift back to normal speed
        fillQueue();
      } else {
        // Fade activePlayer (incoming) in, inactivePlayer (outgoing) out
        activePlayer.volume = ratio * state.masterVolume;
        inactivePlayer.volume = (1 - ratio) * state.masterVolume;
      }
    }, intervalTime);
  }).catch(err => {
    logConsole(`Crossfade failed for "${nextTrack.title}" (Path: ${nextTrack.path}): ${err.message}. Hard switching...`, 'warning');
    inactivePlayer.pause();
    inactivePlayer.playbackRate = 1.0;
    activePlayer.volume = state.masterVolume;
    state.isCrossfading = false;
    fillQueue();
  });
}

function setUpAudioPlayer() {
  const onTimeUpdate = (e) => {
    const player = e.target;
    if (player !== activePlayer || state.isDraggingSlider || player.seeking) return;
    
    if (isNaN(player.duration)) return;
    
    const progress = (player.currentTime / player.duration) * 100;
    progressSlider.value = progress;
    trackDurationCurrent.innerText = formatDuration(player.currentTime);
    
    // Check if we need to start crossfade at the end of the song
    if (player.duration - player.currentTime <= state.crossfadeDuration && state.queue.length > 0) {
      const nextItem = state.queue.shift();
      const track = state.library.find(t => t.path === nextItem.path);
      renderQueue();
      startCrossfade(track);
    }
  };
  
  const onEnded = (e) => {
    const player = e.target;
    if (player !== activePlayer) return;
    
    // Fallback if crossfade didn't trigger
    logConsole('Track finished. Transitioning...', 'info');
    skipTrack();
  };
  
  const onPlay = (e) => {
    if (e.target !== activePlayer) return;
    state.isPlaying = true;
    vinylDisc.classList.add('playing');
    vinylDisc.classList.remove('paused');
    svgPlay.classList.add('hidden');
    svgPause.classList.remove('hidden');
    startSimulatedVisualizer();
  };
  
  const onPause = (e) => {
    if (e.target !== activePlayer) return;
    state.isPlaying = false;
    vinylDisc.classList.remove('playing');
    vinylDisc.classList.add('paused');
    svgPlay.classList.remove('hidden');
    svgPause.classList.add('hidden');
  };
  
  const onLoadedMetadata = (e) => {
    if (e.target !== activePlayer) return;
    trackDurationTotal.innerText = formatDuration(activePlayer.duration);
  };

  // Attach listeners to both dual audio elements
  [audioPlayerA, audioPlayerB].forEach(player => {
    player.addEventListener('timeupdate', onTimeUpdate);
    player.addEventListener('ended', onEnded);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('loadedmetadata', onLoadedMetadata);
  });
  
  // controls
  btnPlay.addEventListener('click', () => {
    if (state.library.length === 0) {
      logConsole('No music in library. Please select a folder and scan first.', 'warning');
      return;
    }
    togglePlayback();
  });

  btnNext.addEventListener('click', () => {
    skipTrack();
  });

  btnPrev.addEventListener('click', () => {
    if (activePlayer.currentTime > 3 || state.history.length <= 1) {
      activePlayer.currentTime = 0;
    } else {
      const last = state.history.pop(); // current track
      const prev = state.history.pop(); // previous track
      if (prev) {
        if (crossfadeInterval) clearInterval(crossfadeInterval);
        state.isCrossfading = false;
        
        const track = state.library.find(t => t.path === prev.path);
        playTrack(track);
      }
    }
  });

  volumeSlider.addEventListener('input', (e) => {
    const vol = e.target.value / 100;
    state.masterVolume = vol;
    
    if (!state.isCrossfading) {
      activePlayer.volume = vol;
    }
    updateVolumeIcon(vol);
  });

  btnMute.addEventListener('click', () => {
    activePlayer.muted = !activePlayer.muted;
    inactivePlayer.muted = activePlayer.muted;
    if (activePlayer.muted) {
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
    const seekTime = (e.target.value / 100) * activePlayer.duration;
    trackDurationCurrent.innerText = formatDuration(seekTime);
  });

  progressSlider.addEventListener('change', (e) => {
    if (!state.currentTrack || state.isCrossfading) return;
    const seekTime = (e.target.value / 100) * activePlayer.duration;
    activePlayer.currentTime = seekTime;
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

function togglePlayback() {
  if (state.isPlaying) {
    activePlayer.pause();
  } else {
    if (!state.currentTrack) {
      playNextFromQueue();
    } else {
      activePlayer.play().catch(err => console.error(err));
    }
  }
}

async function playTrack(track) {
  if (!track) return;
  state.currentTrack = track;
  
  const secureUrl = 'app-media:///' + track.path.replace(/\\/g, '/');
  
  if (crossfadeInterval) clearInterval(crossfadeInterval);
  state.isCrossfading = false;
  
  activePlayer.src = secureUrl;
  activePlayer.playbackRate = 1.0;
  activePlayer.volume = state.masterVolume;
  
  // Set output device if configured
  if (state.outputDeviceId && typeof activePlayer.setSinkId === 'function') {
    activePlayer.setSinkId(state.outputDeviceId).catch(err => console.error(err));
  }
  
  state.history.push({
    path: track.path,
    artist: track.artist,
    playedAt: Date.now()
  });

  if (state.history.length > 100) {
    state.history.shift();
  }

  updateNowPlayingUI();
  
  try {
    await activePlayer.play();
  } catch (err) {
    logConsole(`Playback error for "${track.title}" (Path: ${track.path}): ${err.message}`, 'danger');
  }

  if (state.isEnrichmentEnabled) {
    enrichMetadata(track.artist, track.title);
  }

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
    
    // Crossfade smoothly into the skipped track!
    if (state.currentTrack && state.isPlaying) {
      startCrossfade(track);
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
