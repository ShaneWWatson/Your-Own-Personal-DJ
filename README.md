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
- **Heuristic DJ Selection Engine**: Picks the next track using a transparent, rule-based scoring engine that weighs mood, tempo proximity, harmonic key, and genre compatibility — with guardrails against jarring transitions (e.g. bridging between mild and heavy genres) and repeat-protection windows.
- **Vibrant Glassmorphic UI**: Includes a responsive, hardware-accelerated disc animation, simulated canvas visualizer, queue list, settings panel, and a live console outputting analysis diagnostics.
- **Internet Metadata Enrichment**: Pulls releases, tags, genres, and release years asynchronously from the public **MusicBrainz API** for the currently playing track.

---

## Data Architecture: Where Data Goes and Why

Your Own Personal DJ is designed to keep your project files clean and adhere to operating system standards:

- **Local Database Cache (`library.md`)**:
  - **Location**: `C:\Users\<username>\AppData\Local\YourOwnPersonalDJ\library.md` (or `%LOCALAPPDATA%\YourOwnPersonalDJ\library.md`).
  - **Why**: Windows applications should store cached data and user databases in the user's local AppData directory rather than the application bundle. This prevents workspace pollution, aligns with standard Windows folder permissions, and ensures your database persists even when updating, deleting, or rebuilding the program code.
- **Media Files**:
  - **Location**: Your music files stay exactly where they are on your system. The app uses a secure custom Electron streaming protocol (`app-media://`) to stream audio directly from your local folders without copying, duplicating, or uploading them anywhere.
- **ID3 Metadata Writing**:
  - For `.mp3` files, estimated BPM and Key tags are written directly back to the files' ID3 metadata tags (using standard ID3v2.3 headers) in the background so that they remain available to other media players.

---

## Disk Space & Resource Footprint

- **Packaged Standalone Executable**: ~**180 MB** (contains the packaged Electron container, Node.js runtime, and compiled native modules).
- **Audio Analysis Engine**: Essentia.js ships **bundled** inside the application's `node_modules` (a few MB of WebAssembly). There is **no large model to download** at runtime and no network dependency for analysis.
- **Database Cache (`library.md`)**: Typically less than **1 MB** (scales with the size of your music catalog; holds textual paths, titles, genres, BPM, key, mood, and beat offsets).
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

To bundle the application into a standalone Windows desktop executable (`Your Own Personal DJ.exe`):

```bash
npm run build
```
The packaged product will be compiled under `dist/Your Own Personal DJ-win32-x64/`. You can copy or move this folder anywhere and launch the application directly from the executable.

---

## Project Structure

```
YourOwnPersonalDJ/
├── .gitignore                  # Excludes dependencies and local packaging builds
├── package.json                # App configurations, dependencies, and build scripts
├── LICENSE                     # GNU Affero General Public License v3.0
├── NOTICE                      # Third-party attributions
├── LICENSES.chromium.html      # Detailed credits and licensing for used libraries
├── main.js                     # Main process: app lifecycle, IPC channels, and DB management
├── preload.js                  # IPC bridge: exposes secure file and ID3 APIs to frontend
├── index.html                  # Main user interface markup
├── styles.css                  # Styling design system (vanilla CSS layout)
├── renderer.js                 # Frontend logic: audio player, decode, analysis & heuristics
├── audio-analysis-worker.js    # Essentia.js worker: BPM, key, mood & beat-offset extraction
├── audio.html                  # Isolated audio playback engine window
├── audio-renderer.js           # Crossfade / beatmatch playback engine
└── dist/                       # (Auto-generated on build) Standalone packaged build
```

---

## Licensing & Attributions

- **This Application**: Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0-or-later)**. See the root [LICENSE](LICENSE) file. Copyright © 2026 Shane W Watson.
- **Why AGPL**: This project depends on **Essentia.js**, which is licensed under the AGPL-3.0. To remain license-compliant, Your Own Personal DJ is distributed under the same license. If you modify this program and make it available to others over a network, the AGPL requires you to offer them the corresponding source code.
- **Third-Party Software Components**: Detailed attributions are provided in the root [NOTICE](NOTICE) file. External open-source libraries (Essentia.js, Electron, Chromium, music-metadata, node-id3, etc.) are credited with their corresponding licenses in the [LICENSES.chromium.html](LICENSES.chromium.html) file.
