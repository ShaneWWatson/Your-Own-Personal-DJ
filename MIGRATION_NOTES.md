# Migration Notes — Gemma 3 → Essentia.js (+ AGPL relicense)

## What changed and why

The app previously used a **Gemma 3 1B** language model to *guess* BPM, key, and
mood from each track's **text metadata** (title/artist/genre). That is not audio
analysis — it is an LLM inferring numbers from song names. This migration replaces
that with **Essentia.js**, which measures those values from the actual waveform.

## File-by-file

| File | Change |
|------|--------|
| `audio-analysis-worker.js` | **NEW.** Essentia.js worker. Actions: `init`, `analyze`. Returns real `{ bpm, key, mood, beatOffset, confidence }`. |
| `ai-worker.js` | **DELETED.** (Old Gemma worker.) |
| `renderer.js` | Points to new worker; decodes audio to mono PCM (`decodeTrackToMono`) and sends it to the worker; removed the LLM `analyze-metadata` and `select-next-track` calls; track selection now uses the existing heuristic engine; download-model UI neutralized; status labels updated. |
| `main.js` | Removed the Gemma `check-model-status` / `download-model` IPC handlers (no runtime model fetch needed). |
| `preload.js` | Removed the model-download bridge methods. |
| `index.html` | "Gemma AI Engine" labels → "Essentia Audio Engine"; download controls hidden via JS. |
| `package.json` | `@huggingface/transformers` → `essentia.js`; license → `AGPL-3.0-or-later`. |
| `LICENSE` | MIT → full **AGPL-3.0** text. |
| `NOTICE` | Credits Essentia.js (AGPL); Gemma/Transformers removed. |
| `README.md` | Rewritten: Essentia, real analysis, bundled engine (no 900 MB download), AGPL section. |

## Analysis flow (new)

1. `backgroundMetadataProcessor` finds a track missing bpm/key/mood/beatOffset.
2. `decodeTrackToMono()` fetches + decodes it to a 44.1 kHz mono `Float32Array`.
3. Samples are **transferred** to the worker → Essentia runs `RhythmExtractor2013`
   (BPM + beat positions) and `KeyExtractor` (key + scale); mood is derived from
   tempo + key mode + loudness.
4. Fallbacks: if Essentia is unavailable, heuristic metadata + the original
   Web Audio transient detector fill the gaps. Nothing crashes if analysis fails.

## ⚠️ Must verify after `npm install`

1. **Essentia.js dist filenames / import paths.** — ✅ **VERIFIED.** essentia.js 0.1.3
   ships `dist/essentia.js-core.es.js` and `dist/essentia-wasm.es.js`, which is
   exactly what the worker imports. No change needed unless you change versions.
2. **`package-lock.json`** — ✅ **Regenerated** for the new dependency set
   (essentia.js + @electron/packager). The old transformers-based lock was removed.
3. **WASM packaging.** When you `npm run build`, confirm `node_modules/essentia.js`
   (including its `.wasm`) is included in the packaged app.

## Dependency update (this revision)

All packages were checked against the npm registry and pinned to current versions:

| Package | Version | Note |
|---------|---------|------|
| essentia.js | ^0.1.3 | Latest; audio engine |
| music-metadata | ^11.12.3 | Latest |
| node-id3 | ^0.2.9 | Latest |
| electron | ^42.2.0 | Latest |
| @electron/packager | ^20.0.0 | **Replaces deprecated `electron-packager`** |

- `electron-packager` is deprecated ("Please use @electron/packager moving
  forward. There is no API change, just a package name change"). The build
  **binary name is unchanged** (`electron-packager`), so the `build` script is
  identical — only the dev-dependency name changed.
- `@electron/packager` v20 requires **Node ≥ 22.12.0**. The `engines` field in
  `package.json` and the README prerequisite were updated accordingly.
- `npm install --package-lock-only` resolves with **0 conflicts**;
  `npm audit` reports **0 vulnerabilities** and **0 deprecated** transitive packages.

## Testing checklist

- [ ] `npm install` succeeds; `node_modules/essentia.js/dist/` contains the imported files.
- [ ] `npm start` launches; the engine badge reads **Active / Essentia.js**.
- [ ] Scan a small folder of MP3s; console shows `Essentia analyzed "<title>": BPM … Key … Mood …`.
- [ ] BPM/Key values look sane vs. a known reference track.
- [ ] Crossfade/beatmatch transitions still work (uses `beatOffset` as before).
- [ ] Disconnect Essentia (rename a dist file) → app falls back to heuristics without crashing.

## Behavioral change to confirm you're OK with

The LLM-generated **DJ banter** ("spoken transition announcements") is gone. The
heuristic engine still produces template transition reasons (tempo/key/genre based).
If you want free-form banter back without re-introducing an AGPL-incompatible or
license-heavy model, that's a separate, optional add-on.
