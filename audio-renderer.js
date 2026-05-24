// DOM Elements
const audioPlayerA = document.getElementById('audio-player-a');
const audioPlayerB = document.getElementById('audio-player-b');

let activePlayer = audioPlayerA;
let inactivePlayer = audioPlayerB;

// State variables
let masterVolume = 0.8;
let crossfadeDuration = 6;
let isCrossfading = false;
let outputDeviceId = 'default';
let currentTrack = null;
let crossfadeTriggered = false;
let crossfadeInterval = null;

// Helper to send events back to the main UI process
function sendEvent(event, data = {}) {
  window.api.sendFromAudio({ event, data });
}

// Media Event Handlers
const onTimeUpdate = (e) => {
  const player = e.target;
  if (player !== activePlayer || player.seeking) return;
  if (isNaN(player.duration)) return;

  sendEvent('timeupdate', {
    currentTime: player.currentTime,
    duration: player.duration
  });

  // Check if we need to request the next track to start crossfading
  if (player.duration - player.currentTime <= crossfadeDuration && !crossfadeTriggered) {
    crossfadeTriggered = true;
    sendEvent('request-next-track');
  }
};

const onEnded = (e) => {
  const player = e.target;
  if (player !== activePlayer) return;
  sendEvent('ended');
};

const onPlay = (e) => {
  if (e.target !== activePlayer) return;
  sendEvent('play');
};

const onPause = (e) => {
  if (e.target !== activePlayer) return;
  sendEvent('pause');
};

// Bind audio listeners
[audioPlayerA, audioPlayerB].forEach(player => {
  player.addEventListener('timeupdate', onTimeUpdate);
  player.addEventListener('ended', onEnded);
  player.addEventListener('play', onPlay);
  player.addEventListener('pause', onPause);
  player.addEventListener('loadedmetadata', (e) => {
    if (e.target !== activePlayer) return;
    sendEvent('loadedmetadata', { duration: e.target.duration });
  });
});

// Setup volume on init
audioPlayerA.volume = masterVolume;
audioPlayerB.volume = 0;

// Listen for commands from the UI thread
window.api.onAudioCommand(async (data) => {
  const { command, payload } = data;

  switch (command) {
    case 'play-track':
      playTrack(payload.track);
      break;

    case 'toggle-playback':
      togglePlayback();
      break;

    case 'seek':
      seek(payload.time);
      break;

    case 'set-volume':
      setVolume(payload.volume);
      break;

    case 'set-crossfade-duration':
      crossfadeDuration = payload.duration;
      break;

    case 'set-output-device':
      setOutputDevice(payload.deviceId);
      break;

    case 'start-crossfade':
      startCrossfade(payload.nextTrack);
      break;

    case 'stop':
      stopPlayback();
      break;

    case 'analyze-transients':
      analyzeTransients(payload.path, payload.bpm, payload.requestId);
      break;
  }
});

// Command Executions
function playTrack(track) {
  if (crossfadeInterval) clearInterval(crossfadeInterval);
  isCrossfading = false;
  crossfadeTriggered = false;
  currentTrack = track;

  // Clear any existing drifts
  if (audioPlayerA.driftInterval) clearInterval(audioPlayerA.driftInterval);
  if (audioPlayerB.driftInterval) clearInterval(audioPlayerB.driftInterval);

  activePlayer = audioPlayerA;
  inactivePlayer = audioPlayerB;

  const secureUrl = 'app-media:///' + track.path.replace(/\\/g, '/');
  activePlayer.src = secureUrl;
  activePlayer.playbackRate = 1.0;
  activePlayer.volume = masterVolume;
  inactivePlayer.volume = 0;
  inactivePlayer.pause();
  inactivePlayer.src = '';

  if (outputDeviceId && typeof activePlayer.setSinkId === 'function') {
    activePlayer.setSinkId(outputDeviceId).catch(err => console.error(err));
  }

  activePlayer.play().then(() => {
    sendEvent('crossfade-start', { track });
  }).catch(err => {
    sendEvent('error', { message: `Playback error: ${err.message}`, path: track.path });
  });
}

function togglePlayback() {
  if (!activePlayer.src) return;
  if (activePlayer.paused) {
    activePlayer.play().catch(err => console.error(err));
  } else {
    activePlayer.pause();
  }
}

function seek(time) {
  if (!activePlayer.src || isCrossfading) return;
  activePlayer.currentTime = time;
}

function setVolume(vol) {
  masterVolume = vol;
  if (!isCrossfading) {
    activePlayer.volume = vol;
  }
}

function setOutputDevice(deviceId) {
  outputDeviceId = deviceId;
  if (typeof audioPlayerA.setSinkId === 'function') {
    audioPlayerA.setSinkId(deviceId).catch(err => console.error(err));
    audioPlayerB.setSinkId(deviceId).catch(err => console.error(err));
  }
}

function stopPlayback() {
  if (crossfadeInterval) clearInterval(crossfadeInterval);
  isCrossfading = false;
  crossfadeTriggered = false;
  
  audioPlayerA.pause();
  audioPlayerA.src = '';
  audioPlayerA.currentTime = 0;
  
  audioPlayerB.pause();
  audioPlayerB.src = '';
  audioPlayerB.currentTime = 0;
}

// DJ Smooth Transition / Crossfading & Playback
async function startCrossfade(nextTrack) {
  if (isCrossfading) return;
  isCrossfading = true;
  crossfadeTriggered = false;

  sendEvent('log', { message: `DJ Transition: Crossfading into "${nextTrack.title}" by ${nextTrack.artist}...`, type: 'info' });

  const currentBpm = currentTrack?.bpm || 100;
  const currentOffset = currentTrack?.beatOffset || 0;
  
  let nextBpm = nextTrack.bpm || 100;
  let nextOffset = nextTrack.beatOffset;

  // Run on-the-fly analysis if transient metrics are missing
  if (nextOffset === undefined || nextOffset === null) {
    sendEvent('log', { message: `On-the-fly audio analysis for "${nextTrack.title}"...`, type: 'info' });
    try {
      const analysis = await runTransientAnalysis(nextTrack.path, nextBpm);
      nextOffset = analysis.beatOffset;
      nextTrack.beatOffset = nextOffset;
      
      // Notify UI thread to update database
      sendEvent('transients-analyzed', {
        path: nextTrack.path,
        bpm: analysis.bpm,
        beatOffset: analysis.beatOffset
      });
    } catch (err) {
      console.error('On-the-fly analysis failed:', err);
      nextOffset = 0;
    }
  }
  
  // Calculate tempo alignment (playbackRate)
  const playbackRateIn = currentBpm / nextBpm;
  const clampedPlaybackRateIn = Math.max(0.85, Math.min(1.15, playbackRateIn));
  
  sendEvent('log', {
    message: `Tempo matching: Outgoing BPM: ${currentBpm}, Incoming BPM: ${nextBpm}. Setting incoming playbackRate to ${clampedPlaybackRateIn.toFixed(3)}`,
    type: 'system'
  });

  const secureUrl = 'app-media:///' + nextTrack.path.replace(/\\/g, '/');
  inactivePlayer.src = secureUrl;
  inactivePlayer.playbackRate = clampedPlaybackRateIn;
  inactivePlayer.volume = 0;

  if (outputDeviceId && typeof inactivePlayer.setSinkId === 'function') {
    inactivePlayer.setSinkId(outputDeviceId).catch(err => console.error(err));
  }

  // Calculate phase alignment (beat synchronization)
  const tOut = activePlayer.currentTime;
  const T_beat_in = 60 / nextBpm;
  
  const mod = (n, m) => ((n % m) + m) % m;
  let startIn = mod(clampedPlaybackRateIn * (tOut - currentOffset) + nextOffset, T_beat_in);
  
  inactivePlayer.currentTime = startIn;
  sendEvent('log', {
    message: `Beat matching: Cueing incoming track "${nextTrack.title}" at ${startIn.toFixed(3)}s to align with outgoing beat grid`,
    type: 'system'
  });

  // Swap active and inactive players
  const outgoingPlayer = activePlayer;
  const incomingPlayer = inactivePlayer;
  
  activePlayer = incomingPlayer;
  inactivePlayer = outgoingPlayer;
  currentTrack = nextTrack;

  // Signal UI that crossfade started (to update now playing, history)
  sendEvent('crossfade-start', { track: nextTrack });

  // Handle 0s crossfade
  if (crossfadeDuration === 0) {
    inactivePlayer.pause();
    inactivePlayer.currentTime = 0;
    inactivePlayer.volume = 0;
    inactivePlayer.playbackRate = 1.0;
    
    activePlayer.volume = masterVolume;
    activePlayer.play().then(() => {
      rampPlaybackRate(activePlayer, 1.0, 5000);
      isCrossfading = false;
      sendEvent('crossfade-end');
    }).catch(err => {
      console.error(err);
      isCrossfading = false;
    });
    return;
  }

  activePlayer.play().then(() => {
    let elapsed = 0;
    const intervalTime = 50; // 50ms steps
    const totalSteps = (crossfadeDuration * 1000) / intervalTime;
    
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
        
        activePlayer.volume = masterVolume;
        isCrossfading = false;
        
        sendEvent('crossfade-end');
        rampPlaybackRate(activePlayer, 1.0, 5000); // drift back to normal speed
      } else {
        activePlayer.volume = ratio * masterVolume;
        inactivePlayer.volume = (1 - ratio) * masterVolume;
      }
    }, intervalTime);
  }).catch(err => {
    sendEvent('log', {
      message: `Crossfade failed for "${nextTrack.title}": ${err.message}. Hard switching...`,
      type: 'warning'
    });
    inactivePlayer.pause();
    inactivePlayer.playbackRate = 1.0;
    activePlayer.volume = masterVolume;
    isCrossfading = false;
    sendEvent('crossfade-end');
  });
}

function rampPlaybackRate(player, targetRate, durationMs) {
  const startRate = player.playbackRate;
  if (startRate === targetRate) return;
  
  const stepTime = 100; // update rate every 100ms
  const totalSteps = durationMs / stepTime;
  let currentStep = 0;
  
  if (player.driftInterval) clearInterval(player.driftInterval);
  
  player.driftInterval = setInterval(() => {
    currentStep++;
    const ratio = currentStep / totalSteps;
    
    if (ratio >= 1) {
      clearInterval(player.driftInterval);
      player.playbackRate = targetRate;
      sendEvent('log', { message: `Tempo drift complete. Track playing at original speed (${targetRate}x)`, type: 'system' });
    } else {
      player.playbackRate = startRate + (targetRate - startRate) * ratio;
    }
  }, stepTime);
}

// Transient detection helper
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

// Background transient analysis trigger
async function analyzeTransients(trackPath, knownBpm, requestId) {
  try {
    const analysis = await runTransientAnalysis(trackPath, knownBpm);
    sendEvent('transients-analyzed', {
      path: trackPath,
      bpm: analysis.bpm,
      beatOffset: analysis.beatOffset,
      requestId
    });
  } catch (err) {
    console.error('Error analyzing transients:', err);
    sendEvent('transients-analyzed', { path: trackPath, bpm: knownBpm || 100, beatOffset: 0, error: err.message, requestId });
  }
}
