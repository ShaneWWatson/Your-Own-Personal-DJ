// DOM Elements
const audioPlayerA = document.getElementById('audio-player-a');
const audioPlayerB = document.getElementById('audio-player-b');

let activePlayer = audioPlayerA;
let inactivePlayer = audioPlayerB;

// State variables
let masterVolume = 0.8;
let crossfadeDuration = 10;
let isCrossfading = false;
let outputDeviceId = 'default';
let currentTrack = null;
let crossfadeTriggered = false;
let crossfadeInterval = null;

// Web Audio API for high-precision normalization (allows gain > 1.0)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const gainA = audioCtx.createGain();
const gainB = audioCtx.createGain();
const masterGain = audioCtx.createGain();

const sourceA = audioCtx.createMediaElementSource(audioPlayerA);
const sourceB = audioCtx.createMediaElementSource(audioPlayerB);

// Safety limiter: lets us confidently boost quiet tracks (gain > 1.0) without
// hard digital clipping. Acts only on peaks that would exceed -1 dBFS.
const limiter = audioCtx.createDynamicsCompressor();
limiter.threshold.value = -1.0;
limiter.knee.value = 0;
limiter.ratio.value = 20;
limiter.attack.value = 0.001;
limiter.release.value = 0.1;

sourceA.connect(gainA).connect(masterGain);
sourceB.connect(gainB).connect(masterGain);
masterGain.connect(limiter).connect(audioCtx.destination);

// Initial volumes
gainA.gain.value = 0;
gainB.gain.value = 0;
masterGain.gain.value = masterVolume;

// Track active normalization gain node
let activeGainNode = gainA;
let inactiveGainNode = gainB;

const TARGET_RMS = 0.12;
const PEAK_HEADROOM = 1.25; // allow modest peak overs — the limiter catches them

/**
 * Compute a linear gain multiplier for track normalization.
 *
 * The app's own measured loudness (RMS, from analysis) is ALWAYS preferred,
 * because every track in the library is measured with the same method — one
 * consistent reference level. ReplayGain tags written by other programs are
 * only used as an interim value before our analysis has run; they reference
 * a different loudness standard and previously caused tracks to sit at very
 * different volumes depending on which path they happened to take.
 */
function computeNormalizationGain(track) {
    if (!track) return 1.0;

    let factor = null;

    // 1. Our own measured loudness — the consistent, library-wide reference
    if (track.loudness != null && track.loudness > 0) {
        factor = TARGET_RMS / track.loudness;
    }
    // 2. Interim fallback: ReplayGain tags from the file (until analysis runs)
    else if (track.replaygainTrackGain != null) {
        factor = Math.pow(10, track.replaygainTrackGain / 20);
    }

    if (factor === null) return 1.0;

    // Peak cap with headroom. The old hard cap (1.0 / peak) silently blocked
    // quiet-but-fully-peaked recordings from ever being boosted; with the
    // limiter in the chain we can safely allow some overshoot.
    if (track.replaygainTrackPeak != null && track.replaygainTrackPeak > 0) {
        factor = Math.min(factor, PEAK_HEADROOM / track.replaygainTrackPeak);
    }

    return Math.max(0.1, Math.min(5.0, factor));
}

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

    // Check if we need to request the next track to start the transition.
    // Cold-ending tracks (abrupt ending on the recording) are NOT faded over:
    // we only need ~2s of lead time to cue the next song, then it drops right
    // on the ending. Fade-out tracks use the full crossfade window (+0.8s for
    // loading/buffering time).
    const transitionLead = (currentTrack && currentTrack.endingCold)
        ? 2.0
        : (crossfadeDuration + 0.8);
    if (player.duration - player.currentTime <= transitionLead && !crossfadeTriggered) {
        crossfadeTriggered = true;
        sendEvent('request-next-track');
    }
};

const onEnded = (e) => {
    const player = e.target;
    if (coldPending) return; // a cold-ending handoff is armed; it handles this moment
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
    player.addEventListener('seeked', (e) => {
        if (e.target !== activePlayer) return;
        sendEvent('seeked');
    });
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

        case 'update-normalization':
            // Re-apply gain for the active track after loudness analysis completes
            if (payload.track) {
                if (currentTrack && payload.track.path === currentTrack.path) {
                    currentTrack.loudness = payload.track.loudness;
                    currentTrack.replaygainTrackGain = payload.track.replaygainTrackGain;
                    currentTrack.replaygainTrackPeak = payload.track.replaygainTrackPeak;
                    const normGain = computeNormalizationGain(currentTrack);
                    // Smooth 1-second transition so the volume shift isn't jarring
                    activeGainNode.gain.setTargetAtTime(normGain, audioCtx.currentTime, 0.3);
                }
            }
            break;
    }
});

// Command Executions
function playTrack(track) {
    if (crossfadeInterval) clearInterval(crossfadeInterval);
    cancelPendingCold();
    isCrossfading = false;
    crossfadeTriggered = false;
    currentTrack = track;

    // Resume audio context if suspended (browser security requirement)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    // Clear any existing drifts
    if (audioPlayerA.driftInterval) clearInterval(audioPlayerA.driftInterval);
    if (audioPlayerB.driftInterval) clearInterval(audioPlayerB.driftInterval);

    activePlayer = audioPlayerA;
    inactivePlayer = audioPlayerB;
    activeGainNode = gainA;
    inactiveGainNode = gainB;

    const secureUrl = 'app-media:///' + track.path.replace(/\\/g, '/');
    activePlayer.src = secureUrl;
    activePlayer.playbackRate = 1.0;

    // Set normalization gain via Web Audio
    const normGain = computeNormalizationGain(track);
    activeGainNode.gain.setTargetAtTime(normGain, audioCtx.currentTime, 0.02);
    inactiveGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);

    // Set element volume to 1.0 (we use gain nodes for volume now)
    activePlayer.volume = 1.0;
    inactivePlayer.volume = 0;
    inactivePlayer.pause();
    inactivePlayer.src = '';

    if (outputDeviceId && typeof activePlayer.setSinkId === 'function') {
        activePlayer.setSinkId(outputDeviceId).catch(err => console.error(err));
    }

    activePlayer.play().then(() => {
        sendEvent('crossfade-start', { track });
        sendEvent('crossfade-end');
    }).catch(err => {
        sendEvent('error', { message: `Playback error: ${err.message}`, path: track.path });
    });
}

function togglePlayback() {
    if (!activePlayer.src) return;
    if (activePlayer.paused) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
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
    masterGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.02);
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
    cancelPendingCold();
    isCrossfading = false;
    crossfadeTriggered = false;

    audioPlayerA.pause();
    audioPlayerA.src = '';
    audioPlayerA.currentTime = 0;

    audioPlayerB.pause();
    audioPlayerB.src = '';
    audioPlayerB.currentTime = 0;
}

// --- Cold-ending handoff state ---
let coldPending = false;
let coldFireFn = null;
let coldArmedPlayer = null;
let coldTimeoutId = null;

function cancelPendingCold() {
    if (coldArmedPlayer && coldFireFn) coldArmedPlayer.removeEventListener('ended', coldFireFn);
    if (coldTimeoutId) clearTimeout(coldTimeoutId);
    coldPending = false;
    coldFireFn = null;
    coldArmedPlayer = null;
    coldTimeoutId = null;
}

/**
 * DJ cold-ending handoff: the outgoing song was recorded with an abrupt
 * ("cold") ending, so fading over it would chop it off awkwardly. Instead we
 * let it play out to its natural end and drop the next track exactly on the
 * ending — the classic DJ move for cold-ending records.
 */
function startColdTransition(nextTrack) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    isCrossfading = true;
    coldPending = true;

    sendEvent('log', {
        message: `"${currentTrack.title}" ends cold — letting it finish, then dropping "${nextTrack.title}" right on the ending.`,
        type: 'info'
    });

    const outgoingPlayer = activePlayer;
    const incomingPlayer = inactivePlayer;
    const outgoingGainNode = activeGainNode;
    const incomingGainNode = inactiveGainNode;
    const incomingGainMul = computeNormalizationGain(nextTrack);

    // Pre-cue the incoming track at its first downbeat, original speed, muted
    incomingPlayer.src = 'app-media:///' + nextTrack.path.replace(/\\/g, '/');
    incomingPlayer.playbackRate = 1.0;
    incomingPlayer.volume = 1.0; // signal level is controlled by the gain node
    incomingGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.01);
    incomingPlayer.currentTime = Math.max(0, nextTrack.beatOffset || 0);
    if (outputDeviceId && typeof incomingPlayer.setSinkId === 'function') {
        incomingPlayer.setSinkId(outputDeviceId).catch(err => console.error(err));
    }

    coldArmedPlayer = outgoingPlayer;
    coldFireFn = () => {
        if (!coldPending) return;
        cancelPendingCold();

        // Swap roles
        activePlayer = incomingPlayer;
        inactivePlayer = outgoingPlayer;
        activeGainNode = incomingGainNode;
        inactiveGainNode = outgoingGainNode;
        currentTrack = nextTrack;
        crossfadeTriggered = false;

        activeGainNode.gain.setTargetAtTime(incomingGainMul, audioCtx.currentTime, 0.01);
        inactiveGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);

        sendEvent('crossfade-start', { track: nextTrack });

        activePlayer.play().then(() => {
            inactivePlayer.pause();
            inactivePlayer.currentTime = 0;
            inactivePlayer.src = '';
            inactivePlayer.playbackRate = 1.0;
            isCrossfading = false;
            sendEvent('crossfade-end');
        }).catch(err => {
            isCrossfading = false;
            sendEvent('crossfade-end');
            sendEvent('error', { message: `Playback error: ${err.message}`, path: nextTrack.path });
        });
    };

    outgoingPlayer.addEventListener('ended', coldFireFn);

    // Fallback: if 'ended' never arrives (rare stream stall), force the
    // handoff shortly after the song should have finished.
    const remaining = isNaN(outgoingPlayer.duration)
        ? 3
        : Math.max(0, outgoingPlayer.duration - outgoingPlayer.currentTime);
    coldTimeoutId = setTimeout(() => { if (coldFireFn) coldFireFn(); }, (remaining + 3) * 1000);
}

// DJ Smooth Transition / Crossfading & Playback
function startCrossfade(nextTrack) {
    // The DJ's transition decision: songs with an abrupt recorded ending get a
    // cold handoff (play to the end, then drop the next track); songs with a
    // mastered fade-out get the usual beatmatched slow fade.
    if (currentTrack && currentTrack.endingCold && !isCrossfading) {
        startColdTransition(nextTrack);
        return;
    }
    // If a crossfade is already in progress, force-complete it before starting the next one.
    // This prevents "skipping" skip commands when buttons are pressed rapidly.
    if (isCrossfading) {
        cancelPendingCold();
        if (crossfadeInterval) clearInterval(crossfadeInterval);

        // Set the "in-progress" incoming player to full volume immediately
        activeGainNode.gain.setTargetAtTime(computeNormalizationGain(currentTrack), audioCtx.currentTime, 0.02);

        // Stop the previous song that was still fading out
        inactivePlayer.pause();
        inactivePlayer.currentTime = 0;
        inactivePlayer.src = '';

        isCrossfading = false;
        sendEvent('crossfade-end');
    }

    if (audioCtx.state === 'suspended') audioCtx.resume();
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
    const T_beat_in = 60 / nextBpm;
    const mod = (n, m) => ((n % m) + m) % m;

    // Calculate the current beat-phase of the outgoing song
    const tOut = activePlayer.currentTime;
    const elapsedSinceLastBeatOut = mod(tOut - currentOffset, 60 / currentBpm);
    const phaseRatioOut = elapsedSinceLastBeatOut / (60 / currentBpm);

    // Align the incoming song to the same beat-phase
    // We add a tiny 50ms buffer to account for the play() execution overhead
    let startIn = mod(nextOffset + (phaseRatioOut * T_beat_in) + 0.050, T_beat_in);

    inactivePlayer.currentTime = startIn;
    sendEvent('log', {
        message: `Beat matching: Cueing incoming track "${nextTrack.title}" at ${startIn.toFixed(3)}s to align with outgoing beat grid`,
        type: 'system'
    });

    // Capture per-track normalization multipliers before the player swap
    const outgoingGainMul = computeNormalizationGain(currentTrack);
    const incomingGainMul = computeNormalizationGain(nextTrack);

    // Swap active and inactive players
    const outgoingPlayer = activePlayer;
    const incomingPlayer = inactivePlayer;

    const outgoingGainNode = activeGainNode;
    const incomingGainNode = inactiveGainNode;

    activePlayer = incomingPlayer;
    inactivePlayer = outgoingPlayer;

    activeGainNode = incomingGainNode;
    inactiveGainNode = outgoingGainNode;

    // Incoming player was muted while loading; restore element volume so its
    // signal actually flows into the Web Audio gain node graph.
    activePlayer.volume = 1.0;
    inactivePlayer.volume = 1.0;

    currentTrack = nextTrack;

    // Signal UI that crossfade started (to update now playing, history)
    sendEvent('crossfade-start', { track: nextTrack });

    // Handle 0s crossfade
    if (crossfadeDuration === 0) {
        inactivePlayer.pause();
        inactivePlayer.currentTime = 0;
        inactivePlayer.src = '';

        activeGainNode.gain.setTargetAtTime(incomingGainMul, audioCtx.currentTime, 0.02);
        inactiveGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);

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

    // Use a Constant Power crossfade curve (square root) for a smoother, fuller sound
    // This prevents the "volume dip" in the middle of a linear crossfade.
    activePlayer.play().then(() => {
        let elapsed = 0;
        const intervalTime = 40; // Smoother 40ms steps
        const totalSteps = (crossfadeDuration * 1000) / intervalTime;

        if (crossfadeInterval) clearInterval(crossfadeInterval);

        crossfadeInterval = setInterval(() => {
            elapsed++;
            const ratio = elapsed / totalSteps;

            if (ratio >= 1) {
                clearInterval(crossfadeInterval);

                inactivePlayer.pause();
                inactivePlayer.currentTime = 0;
                inactivePlayer.src = '';
                inactivePlayer.playbackRate = 1.0;

                activeGainNode.gain.setTargetAtTime(incomingGainMul, audioCtx.currentTime, 0.02);
                inactiveGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);

                isCrossfading = false;

                sendEvent('crossfade-end');
                rampPlaybackRate(activePlayer, 1.0, 5000);
            } else {
                // Constant Power curve logic for crossfade
                const fadeInRatio = Math.sqrt(ratio);
                const fadeOutRatio = Math.sqrt(1 - ratio);

                activeGainNode.gain.setTargetAtTime(fadeInRatio * incomingGainMul, audioCtx.currentTime, 0.02);
                inactiveGainNode.gain.setTargetAtTime(fadeOutRatio * outgoingGainMul, audioCtx.currentTime, 0.02);
            }
        }, intervalTime);
    }).catch(err => {
        sendEvent('log', {
            message: `Crossfade failed for "${nextTrack.title}": ${err.message}. Hard switching...`,
            type: 'warning'
        });
        inactivePlayer.pause();
        inactivePlayer.playbackRate = 1.0;
        // Volume is managed by the Web Audio gain graph, not element.volume
        activeGainNode.gain.setTargetAtTime(incomingGainMul, audioCtx.currentTime, 0.02);
        inactiveGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
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
