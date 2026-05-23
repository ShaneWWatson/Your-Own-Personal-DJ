# Your Own Personal DJ

Your Own Personal DJ is a premium desktop audio player built on Electron and Web Audio APIs. It scans your local music folders, uses a locally running AI model to analyze track metadata (BPM, musical key, and mood), and acts as a virtual DJ by creating seamless, beatmatched transitions between songs in real time.

> [!WARNING]
> **Important Metadata Warning**: During library scanning, this program analyzes track BPM and musical key, and writes these values directly back to the files' ID3 metadata tags (for supported file types, like `.mp3`). By scanning directories containing your music files, you authorize the application to update and modify their metadata tags.

---

## Key Features

- **Local AI Vibe & Mood Analysis**: Uses a local **Gemma 2B** model running natively on your hardware (accelerated via WebGPU with WebAssembly CPU fallback) to estimate the BPM, musical Key, and Mood tags of your music library.
- **Advanced Transient Downbeat Matching**: Analyzes the first 30 seconds of track audio on the fly using a Web Audio API absolute envelope peak-detector and a Gaussian grid-fitting algorithm to find the exact downbeat offset (`BeatOffset`) of the first major beat.
- **Seamless DJ Transitions**:
  - **Tempo Matching**: Matches the tempo of the incoming song to the outgoing song by adjusting its playback speed (`playbackRate`) within a +/- 15% range.
  - **Phase Alignment**: Automatically computes the cue point of the incoming track to align its beats mathematically with the outgoing track's beat grid, preventing tempo clashing or "double beats."
  - **Tempo Drift Restoration**: Once the crossfade completes, the app gradually slides the playback rate back to the song's original speed (1.0x) over 5 seconds (simulating a DJ sliding a pitch fader).
- **Vibrant Glassmorphic UI**: Includes a responsive, hardware-accelerated disc animation, simulated canvas visualizer, queue list, settings panel, and a live console outputting AI diagnostics.
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
- **Local AI Model Cache**: ~**1.6 GB** (the pre-quantized Gemma 2B model weights file `onnx-community/gemma-2-2b-it-ONNX-w4a16` is downloaded upon first launch and cached under standard Hugging Face hubs or Chromium's Origin Private File System/Cache API).
- **Database Cache (`library.md`)**: Typically less than **1 MB** (scales with the size of your music catalog; holds textual paths, titles, genres, BPM, key, mood, and beat offsets).
- **Hardware Resources**:
  - **GPU**: Utilizes WebGPU for local Gemma AI operations (falls back to WebAssembly CPU execution if no compatible GPU or browser interface is found).
  - **Memory**: Electron processes typically consume between 150MB - 350MB of RAM during audio playback and background processing.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
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
├── .gitignore               # Excludes dependencies and local packaging builds
├── package.json             # App configurations, dependencies, and build scripts
├── LICENSES.chromium.html   # Detailed credits and licensing for used libraries
├── main.js                  # Main process: app lifecycle, IPC channels, and DB management
├── preload.js               # IPC bridge: exposes secure file and ID3 APIs to frontend
├── index.html               # Main user interface markup
├── styles.css               # Styling design system (vanilla CSS layout)
├── renderer.js              # Frontend logic: audio player, downbeat analytics, AI & heuristics
└── dist/                    # (Auto-generated on build) Standalone packaged build
```

---

## Licensing

- **Custom Application Source Code**: Licensed under the **MIT License** (Copyright &copy; 2026 Shane W Watson).
- **Libraries & Dependencies**: All external open-source libraries (Electron, Chromium, transformers.js, music-metadata, node-id3, etc.) are credited with their corresponding licenses in the [LICENSES.chromium.html](file:///c:/Users/techn/OneDrive/Downloads/Documents/YourOwnPersonalDJ/LICENSES.chromium.html) file.
