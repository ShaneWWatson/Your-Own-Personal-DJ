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
function startCrossfade(nextTrack) {
  if (isCrossfading) return;
  isCrossfading = true;
  crossfadeTriggered = false;

  sendEvent('log', { message: `DJ Transition: Crossfading into "${nextTrack.title}" by ${nextTrack.artist}...`, type: 'info' });

  const currentBpm = currentTrack?.bpm || 100;
  const currentOffset = currentTrack?.beatOffset || 0;
  
  let nextBpm = nextTrack.bpm || 100;
  let nextOffset = nextTrack.beatOffset;

  if (nextOffset === undefined || nextOffset === null) {
    nextOffset = 0;
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
