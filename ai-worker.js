import { pipeline, env } from './node_modules/@huggingface/transformers/dist/transformers.js?v=2';

let generator = null;
let modelStatus = 'checking';
let modelName = 'Gemma 3 1B (Local WebGPU)';

// Helper to send status/logs back to the main UI
function sendStatus(status, model, log, logType) {
  postMessage({
    type: 'status-update',
    data: { status, model, log, logType }
  });
}

async function initLocalAI(localModelPath) {
  if (localModelPath) {
    let formattedPath = localModelPath.replace(/\\/g, '/');
    if (formattedPath.startsWith('/')) {
      formattedPath = formattedPath.slice(1);
    }
    env.remoteHost = `app-media:///${formattedPath}/`;
    env.remotePathTemplate = '{model}/';
    env.allowLocalModels = false;
    
    sendStatus('checking', 'Loading Local Weights...', 'Loading local Gemma model weights from AppData...', 'info');
  } else {
    env.remoteHost = 'https://huggingface.co/';
    env.remotePathTemplate = '{model}/resolve/{revision}/';
  }
  sendStatus('checking', 'Initializing Gemma Model...', 'Loading Transformers.js pipeline...', 'system');

  try {
    const modelId = 'onnx-community/gemma-3-1b-it-ONNX';
    sendStatus('checking', 'Loading Weights...', 'Loading local Gemma model weights (WebGPU)...', 'info');

    generator = await pipeline('text-generation', modelId, {
      device: 'webgpu',
      dtype: 'q4',
      progress_callback: (data) => {
        if (data.status === 'downloading') {
          const percent = Math.round((data.loaded / data.total) * 100);
          if (percent % 10 === 0) {
            sendStatus('checking', 'Downloading Weights...', `Downloading Gemma model: ${percent}% of ${data.file}`, 'info');
          }
        } else if (data.status === 'done') {
          sendStatus('checking', 'Loading Weights...', `Loaded weights block: ${data.file}`, 'success');
        }
      }
    });

    modelStatus = 'connected';
    modelName = 'Gemma 3 1B (Local WebGPU)';
    sendStatus('connected', modelName, 'Local Gemma model loaded and active using WebGPU acceleration!', 'success');
  } catch (err) {
    console.error('WebGPU loading failed, trying CPU WASM fallback:', err);
    sendStatus('checking', 'CPU Fallback...', `WebGPU failed: ${err.message}. Retrying with CPU WebAssembly...`, 'warning');

    try {
      const modelId = 'onnx-community/gemma-3-1b-it-ONNX';
      generator = await pipeline('text-generation', modelId, {
        device: 'wasm',
        dtype: 'q4',
        progress_callback: (data) => {
          if (data.status === 'downloading') {
            const percent = Math.round((data.loaded / data.total) * 100);
            if (percent % 10 === 0) {
              sendStatus('checking', 'Downloading (WASM)...', `Downloading weights (WASM fallback): ${percent}%`, 'info');
            }
          }
        }
      });
      modelStatus = 'connected';
      modelName = 'Gemma 3 1B (Local CPU WASM)';
      sendStatus('connected', modelName, 'Local Gemma model loaded successfully using CPU WASM fallback.', 'success');
    } catch (fallbackErr) {
      console.error('All local AI loaders failed:', fallbackErr);
      modelStatus = 'fallback';
      modelName = 'Local Heuristic Engine';
      sendStatus('fallback', modelName, `AI load failed: ${fallbackErr.message}. Operating in smart heuristic mode.`, 'danger');
    }
  }
}

self.onmessage = async (event) => {
  const { action, id, payload } = event.data;

  if (action === 'init') {
    const localModelPath = payload?.localModelPath || null;
    await initLocalAI(localModelPath);
    postMessage({ id, data: { success: true } });
    return;
  }

  if (action === 'analyze-metadata') {
    const { track } = payload;
    if (modelStatus !== 'connected' || !generator) {
      postMessage({ id, error: 'AI model is not active' });
      return;
    }

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
      postMessage({ id, data: { generatedText } });
    } catch (err) {
      postMessage({ id, error: err.message });
    }
    return;
  }

  if (action === 'select-next-track') {
    const { mood, customMoodPrompt, currentTrack, currentBpm, currentGenre, currentKey, selectedPool } = payload;
    if (modelStatus !== 'connected' || !generator) {
      postMessage({ id, error: 'AI model is not active' });
      return;
    }

    try {
      const prompt = `<start_of_turn>user\nYou are a professional radio DJ. Pick the NEXT song to play from the Candidate Pool to match the user's mood: "${mood === 'custom' ? customMoodPrompt : mood}".

Current playing song:
- Title: "${currentTrack?.title || 'None'}"
- Artist: "${currentTrack?.artist || 'None'}"
- Genre: "${currentGenre}"
- BPM: ${currentBpm}
- Key: "${currentKey}"
- Mood: "${currentTrack?.mood || 'unknown'}"

Rules:
1. Ensure a smooth transition. Do not transition directly between mild genres (e.g. classical, ambient, lofi, acoustic, jazz) and heavy genres (e.g. metal, punk, hard rock, grunge). If moving between these types, you MUST select a medium genre song (e.g. pop, rock, indie, electronic) to bridge the transition.
2. Keep similar tempos when appropriate.
3. The user's requested mood "${mood === 'custom' ? customMoodPrompt : mood}" is the ABSOLUTE PRIMARY factor. Prioritize candidates whose analyzed Mood matches or fits this requested mood above all else. BPM matching and Key matching are secondary criteria to be used only for fine-tuning smooth transitions.
4. Do not play the same song in the last hour of time.
5. Do not play the same artist within the last 20 minutes of time.

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
      postMessage({ id, data: { generatedText } });
    } catch (err) {
      postMessage({ id, error: err.message });
    }
    return;
  }
};
