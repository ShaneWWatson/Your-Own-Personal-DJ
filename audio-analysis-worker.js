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

function sendStatus(status, model, log, logType) {
  postMessage({
    type: 'status-update',
    data: { status, model, log, logType }
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
    sendStatus('fallback', 'Local Heuristic Engine', `Essentia.js load failed: ${err.message}. Operating in heuristic mode.`, 'danger');
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
 * aligned with the app's selectable moods (chill / focus / energy / party)
 * plus a few descriptive extras, so the existing heuristic scorer still works.
 */
function deriveMood({ bpm, scale, rms }) {
  const isMinor = scale && scale.toLowerCase() === 'minor';
  // rms is roughly 0..1 perceived loudness/energy of the signal.
  const highEnergy = rms >= 0.18;
  const lowEnergy = rms < 0.08;

  if (bpm >= 120 && highEnergy) {
    return isMinor ? 'energy' : 'party';
  }
  if (bpm >= 110 && !lowEnergy) {
    return isMinor ? 'energy' : 'party';
  }
  if (bpm <= 90 && lowEnergy) {
    return isMinor ? 'dark' : 'chill';
  }
  if (bpm <= 100) {
    return isMinor ? 'focus' : 'chill';
  }
  return isMinor ? 'focus' : 'uplifting';
}

/* Average loudness proxy (RMS) computed directly from samples. */
function computeRms(samples) {
  let sumSq = 0;
  // Sample at a stride for speed on long arrays.
  const stride = Math.max(1, Math.floor(samples.length / 500000));
  let n = 0;
  for (let i = 0; i < samples.length; i += stride) {
    sumSq += samples[i] * samples[i];
    n++;
  }
  return Math.sqrt(sumSq / (n || 1));
}

function analyze(samples, sampleRate) {
  if (engineStatus !== 'connected' || !essentia) {
    throw new Error('Essentia engine is not active');
  }

  // Trim to the analysis cap to bound CPU time.
  const maxSamples = Math.floor(MAX_ANALYSIS_SECONDS * sampleRate);
  const slice = samples.length > maxSamples ? samples.subarray(0, maxSamples) : samples;

  // Essentia expects its own vector type.
  const signal = essentia.arrayToVector(slice);

  let bpm = null;
  let beatOffset = 0;
  let confidence = 0;

  try {
    // RhythmExtractor2013: returns { bpm, ticks, confidence, estimates, bpmIntervals }
    const rhythm = essentia.RhythmExtractor2013(signal);
    bpm = Math.round(rhythm.bpm);
    confidence = rhythm.confidence;
    const ticks = essentia.vectorToArray(rhythm.ticks);
    if (ticks && ticks.length > 0) {
      // beatOffset = first detected beat position, reduced into one beat period.
      const period = 60 / (bpm || 100);
      beatOffset = parseFloat((ticks[0] % period).toFixed(3));
    }
  } catch (e) {
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
  } catch (e) {
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
    confidence
  };
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
