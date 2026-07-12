# Your Own Personal DJ

Your Own Personal DJ is a premium desktop audio player built on Electron and the Web Audio API. It scans your local music folders, uses a locally running **Essentia.js** audio-analysis engine to measure each track's BPM, musical key, and mood directly from the audio signal, and acts as a virtual DJ by creating seamless, beatmatched transitions between songs in real time.

> [!WARNING]
> **Important Metadata Warning**: During library scanning, this program analyzes track BPM and musical key, and writes these values directly back to the files' ID3 metadata tags (for supported file types, like `.mp3`). By scanning directories containing your music files, you authorize the application to update and modify their metadata tags.

---

## Key Features

- **Local Audio Analysis (Essentia.js)**: Uses a locally running **Essentia.js** WebAssembly engine to analyze the actual audio waveform — not just the file's text tags. It extracts true BPM (`RhythmExtractor2013`), musical key/scale (`KeyExtractor`), beat positions, and derives a mood tag from the measured tempo, key mode, and loudness. All analysis runs on-device; nothing is uploaded.
- **Advanced Transient Downbeat Matching**: Determines the exact downbeat offset (`BeatOffset`) of each track from Essentia's detected beat positions, with a built-in Web Audio API envelope peak-detector as a fallback if analysis is unavailable.
- **Seamless DJ Transitions**:
  - **Tempo Matching**: Matches the tempo of the incoming song to the outgoing song by adjusting its playback speed (`playbackRate`) within a +/- 15% range.
  - **Phase Alignment**: Automatically computes the cue point of the incoming track to align its beats mathematically with the outgoing track's beat grid, preventing tempo clashing or "double beats."
  - **Tempo Drift Restoration**: Once the crossfade completes, the app gradually slides the playback rate back to the song's original speed (1.0x) over 5 seconds (simulating a DJ sliding a pitch fader).
- **Sonic DNA Selection Engine**: Picks the next track using a transparent, rule-based scoring engine that weighs mood, tempo proximity, harmonic key, and genre compatibility. Tracks are grouped into "Sonic Profiles" (from intimate acoustic, through classic and heavy rock, to dance/electronic) so transitions stay within compatible vibe tiers — with BPM-based elasticity for adjacent styles, artist/repeat cooldown windows, and guardrails against jarring mild↔heavy jumps.
- **Built-in & Custom Moods**: Choose a built-in mood (chill, focus, energy, party, uplifting) or type any vibe you want. Genre-style prompts (e.g. "trance", "metal", "acoustic") are matched by *sound* through the Sonic Profiles, so a hard-rock track never sneaks into a trance set; feeling- or theme-style prompts (e.g. "rainy Sunday", "songs about heartbreak") are matched by their lyrical content when the Lyric Mood AI is enabled.
- **Lyric Mood AI (optional, off by default)**: An optional layer that reads a track's embedded lyrics and judges whether they fit the active mood, refining selection beyond what tempo and key alone can reveal. It runs entirely on-device via a small local language model (a one-time ~1 GB download) or, if you prefer, through the Anthropic API with your own key. A toggle on the main screen turns it on or off; the choice is remembered between sessions, and while off no model is ever called.
- **Vibrant Glassmorphic UI**: Includes a responsive, hardware-accelerated disc animation, simulated canvas visualizer, queue list, settings panel, and a live console outputting analysis diagnostics.
- **Internet Metadata Enrichment**: Pulls releases, tags, genres, and release years asynchronously from the public **MusicBrainz API** for the currently playing track.
- **File Health Scan & MP3 Repair**: Every file is inspected in the background for structural damage. MP3s with repairable damage (garbage bytes in the audio stream, corrupt tag blocks) are automatically rebuilt frame-by-frame — the original is always kept as a `.bak` backup next to the file. Other formats are flagged in the console so you know to re-rip or re-download them.
- **Discord Rich Presence (optional)**: Show the track you're playing on your Discord profile, with album art and elapsed/remaining time. Uses your own Discord application through a dependency-free local IPC client and OAuth2; all credentials stay on your machine.
- **Last.fm Scrobbling (optional)**: Scrobble your plays and update your "Now Playing" status on Last.fm, following the official thresholds (≥30 seconds and ≥50% of the track). Authenticated with your own Last.fm API account via the standard web-auth flow; the session key is stored locally.
- **Crisis-Aware Custom Prompts**: A fully local guardrail scans custom mood prompts for language suggesting suicide or self-harm and, if detected, surfaces crisis-support resources before continuing. Nothing is ever sent anywhere — your request is still honored if you choose to proceed.

---

## Data Architecture: Where Data Goes and Why

Your Own Personal DJ is designed to keep your project files clean and adhere to operating system standards:

- **Local Database (IndexedDB)**:
  - **Location**: `%LOCALAPPDATA%\YourOwnPersonalDJ\` on Windows (i.e. `C:\Users\<username>\AppData\Local\YourOwnPersonalDJ\`), or `~/Library/Application Support/YourOwnPersonalDJ/` on macOS. The app stores its track database, scanned folders, and play history in IndexedDB inside this directory.
  - **Why**: Windows applications should store cached data and user databases in the user's local AppData directory rather than the application bundle. This prevents workspace pollution, aligns with standard Windows folder permissions, and ensures your database persists even when updating, deleting, or rebuilding the program code.
  - **Legacy `library.md`**: Older versions stored the library as a Markdown file at the same location. On first launch, the app automatically migrates it into IndexedDB and renames it to `library.md.migrated`.
- **Integration & AI Settings**:
  - Configuration for the optional features lives as small JSON files in the same app-data directory: `ai-config.json` (Lyric Mood AI provider/model and, if used, your Anthropic API key), `discord-config.json`, and `lastfm-config.json`. If you enable the local Lyric Mood AI, its language model is stored once in a `models/` subfolder. These files stay on your machine and are never uploaded.
  - Secret values inside those files (API keys, OAuth tokens, shared secrets) are encrypted at rest with Electron `safeStorage` (Windows DPAPI). Configs saved by older versions are re-encrypted automatically on the next launch.
  - The main-screen Lyric Mood AI on/off preference is remembered in the renderer's local storage, so it persists across sessions independently of the analysis database.
- **Media Files**:
  - **Location**: Your music files stay exactly where they are on your system. The app uses a secure custom Electron streaming protocol (`app-media://`) to stream audio directly from your local folders without copying, duplicating, or uploading them anywhere.
- **ID3 Metadata Writing**:
  - For `.mp3` files, estimated BPM and Key tags are written directly back to the files' ID3 metadata tags (using standard ID3v2.3 headers) in the background so that they remain available to other media players.
- **Debug Log (`debug.log`)**:
  - **Location**: Same directory as the executable on Windows (the project folder during development); the app-data directory above on macOS, where writing into the `.app` bundle would break its signature.
  - **What it records**: Everything shown in the in-app console window, plus raw technical error details behind the user-friendly messages, so issues can be decoded and troubleshot later. Rotates automatically at 5 MB (`debug.log.old`).

---

## Disk Space & Resource Footprint

- **Packaged Standalone Executable**: ~**180 MB** (contains the packaged Electron container, Node.js runtime, and compiled native modules).
- **Audio Analysis Engine**: Essentia.js ships **bundled** inside the application's `node_modules` (a few MB of WebAssembly). The core BPM/key/mood analysis has **no large model to download** and no network dependency.
- **Lyric Mood AI Model (optional)**: Only if you enable the Lyric Mood AI with the *local* provider, a small language model (a one-time ~1 GB download) is fetched into the app-data `models/` folder. With the feature off (the default), or when using the Anthropic provider instead, nothing is downloaded.
- **Database (IndexedDB)**: Typically a few MB (scales with the size of your music catalog and embedded album art; holds paths, titles, genres, BPM, key, mood, beat offsets, and play history).
- **Hardware Resources**:
  - **CPU**: Audio analysis runs in a background Web Worker so the UI stays responsive. Analysis is capped to the first ~90 seconds of each track to bound CPU time.
  - **Memory**: Electron processes typically consume between 150MB - 350MB of RAM during audio playback and background processing.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) **v22.12.0 or higher** (required by `@electron/packager` v20; also fine for running the app)
- Git (optional, for version control)

### Installation & Run

1. Clone or download this project directory.
2. In your terminal, navigate to the folder and install dependencies:
   ```bash
   npm install
   ```
3. Start the application in development mode:
   ```bash
   npm start
   ```

### Packaging & Compiling

The Windows and macOS versions build from the same codebase and land in separate output folders (`dist/win/` and `dist/mac/`), so both can exist side by side.

**Windows** — bundle a standalone desktop executable (`Your Own Personal DJ.exe`):

```bash
npm run build
```
The packaged product will be compiled under `dist/win/Your Own Personal DJ-win32-x64/`. You can copy or move this folder anywhere and launch the application directly from the executable.

**macOS** — a `.app` bundle can only be assembled on a macOS machine (bundle symlinks + code signing), so there are two routes:

- *On a Mac*: `npm run build:mac` (Apple Silicon) or `npm run build:mac-intel` (Intel). Output lands under `dist/mac/Your Own Personal DJ-darwin-<arch>/`.
- *Without a Mac*: run the **Build macOS app** workflow on GitHub (Actions tab → Build macOS app → Run workflow) — it packages the app on GitHub's macOS runners for both Apple Silicon and Intel and uploads each as a downloadable artifact.

> [!NOTE]
> The macOS build is ad-hoc signed, not notarized through an Apple Developer account. On first launch, right-click the app → **Open** (or run `xattr -dr com.apple.quarantine "Your Own Personal DJ.app"`), and macOS will remember the choice.

---

## Project Structure

```
YourOwnPersonalDJ/
├── .gitignore                  # Excludes dependencies, debug logs, and packaging builds
├── package.json                # App configurations, dependencies, and build/lint scripts
├── eslint.config.mjs           # ESLint flat config (per-environment globals)
├── LICENSE                     # GNU Affero General Public License v3.0
├── NOTICE                      # Third-party attributions
├── LICENSES_chromium.html      # Detailed credits and licensing for used libraries
├── main.js                     # Main process: lifecycle, IPC, streaming protocol, file health/repair
├── preload.js                  # IPC bridge: exposes the secure window.api surface to renderers
├── index.html                  # Main user interface markup
├── styles.css                  # Styling design system (vanilla CSS layout)
├── renderer.js                 # UI logic: library, DJ selection engine, background processors
├── audio-analysis-worker.js    # Essentia.js worker: BPM, key, mood & beat-offset extraction
├── audio.html                  # Isolated audio playback engine window
├── audio-renderer.js           # Playback engine: normalization, crossfades, cold-ending handoffs
├── icon.icns                   # macOS app icon (generated from icon.png)
├── .github/workflows/          # CI: Dependabot + "Build macOS app" workflow
├── debug.log                   # (Auto-generated at runtime) Troubleshooting log, rotates at 5 MB
└── dist/                       # (Auto-generated on build) Packaged builds: win/ and mac/
```

---

## Development

- **Linting**: The project uses ESLint (recommended rules, environment-aware config). Run it with:
  ```bash
  npm run lint
  ```
- **Security posture**: Renderer windows run with `contextIsolation`, `sandbox`, and `nodeIntegration: false`. All renderer↔main communication crosses an explicitly-enumerated `contextBridge` API. Windows cannot open popups or navigate away from app pages. Custom-protocol file access is restricted by an audio-extension allowlist outside the app directory. Integration secrets are encrypted at rest via `safeStorage`, and the Discord/Last.fm authorization callback servers bind to `127.0.0.1` only, carry a per-attempt `state` token, and shut down automatically if the flow is abandoned.
- **Documentation style**: Source files carry `@file` headers with license notices; significant functions are documented with JSDoc (`@param`/`@returns`).

---

## Licensing & Attributions

- **This Application**: Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0-or-later)**. See the root [LICENSE](LICENSE) file. Copyright © 2026 Shane W Watson.
- **Why AGPL**: This project depends on **Essentia.js**, which is licensed under the AGPL-3.0. To remain license-compliant, Your Own Personal DJ is distributed under the same license. If you modify this program and make it available to others over a network, the AGPL requires you to offer them the corresponding source code.
- **Third-Party Software Components**: Detailed attributions are provided in the root [NOTICE](NOTICE) file. External open-source libraries (Essentia.js, Electron, Chromium, music-metadata, node-id3, etc.) are credited with their corresponding licenses in the [LICENSES_chromium.html](LICENSES_chromium.html) file.
