/*
 * Your Own Personal DJ
 * Copyright (C) 2026 Shane W Watson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * ---------------------------------------------------------------------------
 * audio-analysis-worker.js
 *
 * Replaces the previous Gemma (LLM) worker. Instead of *guessing* BPM / Key /
 * Mood from a track's text metadata, this worker performs REAL audio analysis
 * on the decoded PCM samples using Essentia.js (AGPL-3.0).
 *
 * The renderer decodes the audio file (it has access to OfflineAudioContext)
 * and transfers the raw mono Float32Array + sample rate to this worker. This
 * worker then runs Essentia's algorithms and returns grounded results.
 * ---------------------------------------------------------------------------
 */

/*
 * IMPORT PATHS — verified against essentia.js 0.1.3.
 * The package ships these ES-module builds under node_modules/essentia.js/dist/:
 *   - essentia.js-core.es.js   (the Essentia class)
 *   - essentia-wasm.es.js      (the WebAssembly backend)
 * These load correctly inside a `new Worker(..., { type: 'module' })` context.
 * If you bump essentia.js to a version that renames these, update the two lines
 * below. The namespace imports + fallbacks handle named-vs-default export shape.
 */
import * as EssentiaCore from './node_modules/essentia.js/dist/essentia.js-core.es.js';
import * as EssentiaWasmMod from './node_modules/essentia.js/dist/essentia-wasm.es.js';

let essentia = null;
let engineStatus = 'checking';
const ENGINE_NAME = 'Essentia.js (Local Audio Analysis)';

// Cap analysis to this many seconds of audio. Key/BPM are stable well within
// this window, and it bounds CPU time on long tracks.
const MAX_ANALYSIS_SECONDS = 90;

function sendStatus(status, model, log, logType, detail) {
  postMessage({
    type: 'status-update',
    data: { status, model, log, logType, detail }
  });
}

async function initEssentia() {
  sendStatus('checking', 'Loading Essentia.js...', 'Initializing local Essentia.js audio engine (WASM)...', 'system');

  try {
    const EssentiaClass = EssentiaCore.Essentia || EssentiaCore.default;
    let wasmBackend = EssentiaWasmMod.EssentiaWASM || EssentiaWasmMod.default || EssentiaWasmMod;

    // Some builds export the WASM backend as an async factory; others export
    // the already-instantiated backend object. Handle both.
    if (typeof wasmBackend === 'function') {
      wasmBackend = await wasmBackend();
    }
    if (wasmBackend && typeof wasmBackend.then === 'function') {
      wasmBackend = await wasmBackend;
    }

    essentia = new EssentiaClass(wasmBackend);

    engineStatus = 'connected';
    const version = (essentia && essentia.version) ? essentia.version : '';
    sendStatus('connected', ENGINE_NAME, `Essentia.js audio engine ready${version ? ' (v' + version + ')' : ''}.`, 'success');
  } catch (err) {
    console.error('Essentia.js failed to initialize:', err);
    engineStatus = 'fallback';
    sendStatus(
      'fallback',
      'Local Heuristic Engine',
      'The audio analysis engine could not start, so BPM, key, and mood will be estimated from file information instead. Playback still works normally. (Technical details saved to debug.log.)',
      'danger',
      `Essentia.js load failed: ${err.message}`
    );
  }
}

/* Map Essentia key + scale to the app's display format, e.g. "C# Maj" / "A Min". */
function formatKey(key, scale) {
  if (!key) return 'C Maj';
  const suffix = (scale && scale.toLowerCase() === 'minor') ? 'Min' : 'Maj';
  return `${key} ${suffix}`;
}

/*
 * Derive a mood tag from grounded audio features. This keeps the vocabulary
 * aligned with the app's selectable moods (chill / focus / energy / party /
 * uplifting) plus a few descriptive extras, so the heuristic scorer still works.
 * Note: 'uplifting' is ultimately a lyric/feel judgment (see the Lyric Mood AI);
 * the tag emitted here is only a provisional, soft sonic hint.
 */
function deriveMood({ bpm, scale, rms }) {
  const isMinor = scale && scale.toLowerCase() === 'minor';
  // rms is roughly 0..1 perceived loudness/energy of the signal.
  const extremeEnergy = rms >= 0.26; // Wall-of-sound level
  const highEnergy = rms >= 0.20;    // Driving rock/dance level
  const midEnergy = rms >= 0.13;     // Standard pop/rock level
  const lowEnergy = rms < 0.08;      // Quiet/Acoustic level

  // Party Vibes: Major, steady driving energy, danceable tempo
  if (!isMinor && bpm >= 115 && bpm <= 135 && highEnergy && !extremeEnergy) {
    return 'party';
  }

  // High Energy: Requires BOTH high speed and high volume, OR extreme volume
  // This prevents power ballads (mid-tempo, loud) from being called "Energy"
  if (bpm >= 138 && highEnergy) {
    return 'energy';
  }

  if (extremeEnergy && bpm >= 120) {
    return 'energy';
  }

  // Chill: Low energy or very slow
  if (bpm <= 95 && lowEnergy) {
    return isMinor ? 'dark' : 'chill';
  }
  if (bpm <= 105 && !highEnergy) {
    return isMinor ? 'focus' : 'chill';
  }

  // Focus: Steady mid-tempo, controlled volume (most ballads fall here now)
  // We strictly limit Focus to tracks that are not too fast or too loud.
  if (bpm >= 90 && bpm <= 120 && midEnergy && !highEnergy) {
    return 'focus';
  }

  // Uplifting: a PROVISIONAL guess only. True "uplifting" depends on lyrics and
  // overall feel (judged by the Lyric Mood AI), not sonics — so this tag is just
  // a soft scoring hint for bright major-key mid-tempo songs, never a mood gate.
  if (!isMinor && bpm >= 100 && bpm <= 135 && midEnergy) {
    return 'uplifting';
  }

  // Fallback for everything else.
  // If it's fast, it can be energy/party — but ONLY if there's real loudness
  // behind the tempo. A fast-but-quiet track (e.g. an up-tempo choir piece at
  // 140 BPM) isn't a banger, so don't dump it into party/energy by default.
  if (bpm > 125) {
    if (highEnergy) {
      return isMinor ? 'energy' : 'party';
    }
    // Fast but not loud: bright major reads as uplifting, minor as neutral focus.
    return isMinor ? 'focus' : 'uplifting';
  }

  // Don't blanket-label leftover major-key tracks "uplifting" — that overstates
  // a feel the audio can't confirm. 'focus' is the honest neutral default.
  return 'focus';
}

/* Average loudness proxy (RMS) computed directly from samples. */
function computeRms(samples) {
  let sumSq = 0;
  // Increase sampling density for better accuracy.
  // Stride of 10 samples (instead of 500k) provides high-fidelity loudness estimation.
  const stride = 10;
  let n = 0;
  for (let i = 0; i < samples.length; i += stride) {
    sumSq += samples[i] * samples[i];
    n++;
  }
  return Math.sqrt(sumSq / (n || 1));
}

/**
 * Run the full Essentia analysis chain on decoded mono PCM samples:
 * RhythmExtractor2013 (BPM + beat positions), KeyExtractor (key + scale),
 * RMS loudness, and a derived mood tag. WASM vectors are always freed in
 * the finally block to prevent heap exhaustion.
 * @param {Float32Array} samples - Mono PCM audio at `sampleRate`.
 * @param {number} sampleRate - Sample rate of the provided audio.
 * @returns {{bpm: number|null, key: string, mood: string,
 *            beatOffset: number|null, confidence: number, rms: number}}
 * @throws {Error} When the Essentia engine is not initialized.
 */
function analyze(samples, sampleRate) {
  if (engineStatus !== 'connected' || !essentia) {
    throw new Error('Essentia engine is not active');
  }

  // Trim to the analysis cap to bound CPU time.
  const maxSamples = Math.floor(MAX_ANALYSIS_SECONDS * sampleRate);
  const slice = samples.length > maxSamples ? samples.subarray(0, maxSamples) : samples;

  let signal = null;
  let rhythm = null;

  try {
    // Essentia expects its own vector type.
    signal = essentia.arrayToVector(slice);

    let bpm = null;
    let beatOffset = null; // null (not 0) so the renderer's transient-detector fallback can run if rhythm extraction fails
    let confidence = 0;

    try {
      // RhythmExtractor2013: returns { bpm, ticks, confidence, estimates, bpmIntervals }
      rhythm = essentia.RhythmExtractor2013(signal);
      bpm = Math.round(rhythm.bpm);
      confidence = rhythm.confidence;
      const ticks = essentia.vectorToArray(rhythm.ticks);
      if (ticks && ticks.length > 0) {
        // beatOffset = first detected beat position, reduced into one beat period.
        const period = 60 / (bpm || 100);
        beatOffset = parseFloat((ticks[0] % period).toFixed(3));
      }
    } catch {
      // Leave bpm null; renderer will fall back to its own transient analysis.
      bpm = null;
    }

    let key = 'C Maj';
    let scale = 'major';
    try {
      // KeyExtractor: returns { key, scale, strength }
      const k = essentia.KeyExtractor(signal);
      key = formatKey(k.key, k.scale);
      scale = k.scale || 'major';
    } catch {
      key = 'C Maj';
      scale = 'major';
    }

    const rms = computeRms(slice);
    const mood = deriveMood({ bpm: bpm || 100, scale, rms });

    return {
      bpm,
      key,
      mood,
      beatOffset,
      confidence,
      rms: parseFloat(rms.toFixed(4))
    };
  } finally {
    // Clean up WASM heap allocations to prevent heap memory exhaustion and abort() errors
    if (signal) {
      try { essentia.deleteVector(signal); } catch (err) { console.error('Error deleting signal vector:', err); }
    }
    if (rhythm) {
      if (rhythm.ticks) {
        try { essentia.deleteVector(rhythm.ticks); } catch (err) { console.error('Error deleting ticks vector:', err); }
      }
      if (rhythm.estimates) {
        try { essentia.deleteVector(rhythm.estimates); } catch (err) { console.error('Error deleting estimates vector:', err); }
      }
      if (rhythm.bpmIntervals) {
        try { essentia.deleteVector(rhythm.bpmIntervals); } catch (err) { console.error('Error deleting bpmIntervals vector:', err); }
      }
    }
  }
}

self.onmessage = async (event) => {
  const { action, id, payload } = event.data;

  if (action === 'init') {
    await initEssentia();
    postMessage({ id, data: { success: true } });
    return;
  }

  if (action === 'analyze') {
    try {
      const { samples, sampleRate } = payload;
      const result = analyze(samples, sampleRate || 44100);
      postMessage({ id, data: result });
    } catch (err) {
      postMessage({ id, error: err.message });
    }
    return;
  }
};
