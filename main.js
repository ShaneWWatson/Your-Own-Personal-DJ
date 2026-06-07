const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const musicMetadata = require('music-metadata');
const NodeID3 = require('node-id3');
const { Readable } = require('stream');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true
    }
  }
]);

// Configure custom userData path to store IndexedDB in AppData\Local\YourOwnPersonalDJ\
const dbDir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'YourOwnPersonalDJ') : path.join(app.getPath('userData'), 'YourOwnPersonalDJ');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
app.setPath('userData', dbDir);
const libraryCachePath = path.join(dbDir, 'library.md');

let mainWindow;
let audioWindow;

function createAudioWindow() {
  audioWindow = new BrowserWindow({
    show: false, // Keep it invisible
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const audioURL = url.pathToFileURL(path.join(__dirname, 'audio.html')).toString().replace('file:', 'app-media:');
  audioWindow.loadURL(audioURL);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'icon.png'), // placeholder/icon if we want
    titleBarStyle: 'default',
    autoHideMenuBar: true
  });

  const indexURL = url.pathToFileURL(path.join(__dirname, 'index.html')).toString().replace('file:', 'app-media:');
  mainWindow.loadURL(indexURL);

  mainWindow.on('closed', () => {
    if (audioWindow && !audioWindow.isDestroyed()) {
      audioWindow.close();
    }
    app.quit();
  });
}

// Register custom protocol for local media streaming
app.whenReady().then(() => {
  protocol.handle('app-media', async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      let filePath = decodeURIComponent(parsedUrl.pathname);
      
      // 1. Handle Album Art requests: app-media:///art/C%3A%5CMusic%5Csong.mp3
      if (filePath.startsWith('/art/')) {
        let cleanPath = filePath.slice(5); // Remove '/art/' prefix

        // Handle encoded path (if any) and normalize
        cleanPath = path.normalize(cleanPath);

        // Fix for Windows drive letters (e.g. \C:\ -> C:\)
        if (cleanPath.startsWith('\\') && cleanPath.charAt(2) === ':') {
          cleanPath = cleanPath.slice(1);
        }

        if (!fs.existsSync(cleanPath)) {
          console.error(`[Art Protocol] File not found: ${cleanPath}`);
          return new Response('Not Found', { status: 404 });
        }

        try {
          // parseFile is more reliable for different formats
          const metadata = await musicMetadata.parseFile(cleanPath, { skipCovers: false });

          if (metadata.common.picture && metadata.common.picture.length > 0) {
            // Find the best quality picture
            const pic = metadata.common.picture.find(p => p.type === 'Front Cover') || metadata.common.picture[0];

            let mimeType = (pic.format || 'image/jpeg').toLowerCase();
            if (!mimeType.includes('/')) mimeType = 'image/' + mimeType;
            if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

            return new Response(pic.data, {
              headers: {
                'Content-Type': mimeType,
                'Content-Length': pic.data.length.toString(),
                'Cache-Control': 'public, max-age=86400'
              }
            });
          }
        } catch (err) {
          console.error(`[Art Protocol] Metadata error for ${cleanPath}:`, err);
        }
        return new Response('No Art Found', { status: 404 });
      }

      // 2. Handle Audio File requests: app-media://c/Music/song.mp3 or app-media:///C:/Music/song.mp3
      // Extract drive letter if parsed as host (e.g. app-media://c:/Users/...)
      let drive = parsedUrl.host || '';
      if (drive.endsWith(':')) {
        drive = drive.slice(0, -1);
      }
      
      if (drive.length === 1 && /[a-zA-Z]/.test(drive)) {
        filePath = drive + ':' + filePath;
      } else {
        // Strip leading slash if path is "/C:/Users/..."
        if (filePath.startsWith('/') && (filePath.charAt(2) === ':' || filePath.charAt(2) === '|')) {
          filePath = filePath.slice(1);
        }
      }
      
      console.log(`[app-media Request] Method: ${request.method}, URL: ${request.url} => Path: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        return new Response('File not found', { status: 404 });
      }
      
      // Restrict access for paths outside the app directory.
      // Files inside the app directory (like index.html, renderer.js, audio-analysis-worker.js, etc.) are allowed.
      // Files outside the app directory are strictly limited to valid audio extensions.
      const normalizedFilePath = path.normalize(filePath).toLowerCase();
      const normalizedAppDir = path.normalize(__dirname).toLowerCase();
      
      if (!normalizedFilePath.startsWith(normalizedAppDir)) {
        const ext = path.extname(filePath).toLowerCase();
        const allowedAudioExts = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.wma'];
        if (!allowedAudioExts.includes(ext)) {
          console.warn(`[app-media Protocol Blocked] Unauthorized access attempt to non-audio file: ${filePath}`);
          return new Response('Forbidden', { status: 403 });
        }
      }
      
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = request.headers.get('range');
      
      // Determine content type based on extension
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.gif': 'image/gif',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      if (range) {
        // Parse Range: e.g. "bytes=32768-" or "bytes=32768-65536"
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        const nodeStream = fs.createReadStream(filePath, { start, end });
        const webStream = Readable.toWeb(nodeStream);
        
        return new Response(webStream, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize.toString(),
            'Content-Type': contentType
          }
        });
      } else {
        const nodeStream = fs.createReadStream(filePath);
        const webStream = Readable.toWeb(nodeStream);
        return new Response(webStream, {
          status: 200,
          headers: {
            'Content-Length': fileSize.toString(),
            'Content-Type': contentType
          }
        });
      }
    } catch (err) {
      console.error('Protocol handler error:', err);
      return new Response('Error loading media', { status: 500 });
    }
  });

  createWindow();
  createAudioWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createAudioWindow();
    }
  });
});

app.on('window-all-closed', function () {
  app.exit(0);
});

app.on('will-quit', function () {
  app.exit(0);
});

process.on('SIGINT', () => {
  app.exit(0);
});

process.on('SIGTERM', () => {
  app.exit(0);
});

// Broker to forward commands from GUI window to Audio window
ipcMain.on('to-audio-player', (event, data) => {
  if (audioWindow && !audioWindow.isDestroyed()) {
    audioWindow.webContents.send('audio-player-command', data);
  }
});

// Broker to forward events from Audio window to GUI window
ipcMain.on('from-audio-player', (event, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio-player-event', data);
  }
});

// Safe External Link Launcher
ipcMain.on('open-external', (event, urlToOpen) => {
  try {
    if (urlToOpen && (urlToOpen.startsWith('http://') || urlToOpen.startsWith('https://'))) {
      require('electron').shell.openExternal(urlToOpen);
    }
  } catch (err) {
    console.error('Failed to open external URL:', err);
  }
});

function normalizePath(filePath) {
  if (!filePath) return '';
  let normalized = path.normalize(filePath);
  if (process.platform === 'win32') {
    normalized = normalized.replace(/\//g, '\\');
    if (normalized.length >= 2 && normalized[1] === ':') {
      normalized = normalized[0].toUpperCase() + normalized.slice(1);
    }
  }
  return normalized;
}

// Native Directory Picker
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return null;
  } else {
    return normalizePath(result.filePaths[0]);
  }
});

// Default Music Folder
ipcMain.handle('get-system-music-folder', () => {
  try {
    return normalizePath(app.getPath('music'));
  } catch (err) {
    console.error('Error getting system music path:', err);
    return null;
  }
});

// Recursive file scanner helpers
async function getAudioFiles(dirPath, filesList = []) {
  try {
    const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const file of files) {
      const resPath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        await getAudioFiles(resPath, filesList);
      } else {
        const ext = path.extname(file.name).toLowerCase();
        if (['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.wma'].includes(ext)) {
          filesList.push(normalizePath(resPath));
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }
  return filesList;
}

// --- Metadata sanitization helpers ---

// Strip null bytes and trim; return fallback for blank/missing values.
function sanitizeText(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  const cleaned = String(val).replace(/\0/g, '').trim();
  return cleaned || fallback;
}

// Accept any common BPM representation and return a plain integer, or null.
// Handles "128 BPM", "~128", "128.7", "0", out-of-range values, NaN, etc.
function normalizeBpm(val) {
  if (val === null || val === undefined) return null;
  const parsed = parseInt(String(val).replace(/[^0-9]/g, ''), 10);
  if (isNaN(parsed) || parsed < 20 || parsed > 300) return null;
  return parsed;
}

// Normalise the many key formats music apps write into the consistent
// "Note Maj/Min" form this app uses (e.g. "Am" → "A Min",
// "C# major" → "C# Maj", "Bb" → "Bb Maj", "Am/C" → "A Min").
// Returns null for unrecognised formats — Essentia analysis fills those in.
function normalizeKey(val) {
  if (!val) return null;
  let s = String(val).trim().replace(/\/.*$/, '').trim(); // strip slash-chord bass note

  let m;
  // Already in app format: "A Maj" / "A Min"
  m = s.match(/^([A-G][#b]?)\s+(Maj|Min)$/i);
  if (m) return `${m[1]} ${m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()}`;

  // Long form: "A major" / "Bb minor"
  m = s.match(/^([A-G][#b]?)\s+(major|minor)$/i);
  if (m) return `${m[1]} ${m[2].toLowerCase() === 'minor' ? 'Min' : 'Maj'}`;

  // Short minor: "Am", "C#m", "Bbm"
  m = s.match(/^([A-G][#b]?)m$/i);
  if (m) return `${m[1]} Min`;

  // Bare note — assume major: "A", "C#", "Bb"
  m = s.match(/^([A-G][#b]?)$/i);
  if (m) return `${m[1]} Maj`;

  return null; // unrecognised — let Essentia determine it
}

// --- ReplayGain helpers ---

// Search native tag blocks for a ReplayGain entry. Handles ID3v2 TXXX frames
// (MP3) and plain key=value tags (FLAC/Vorbis, APEv2, etc.).
function findReplaygainNativeTag(metadata, descKey) {
  const upper = descKey.toUpperCase();
  for (const nativeType of Object.keys(metadata.native || {})) {
    const tags = metadata.native[nativeType];
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      // ID3v2 TXXX: { id: 'TXXX', value: { description: '...', text: '...' } }
      if (tag.id === 'TXXX' && tag.value &&
          String(tag.value.description || '').toUpperCase() === upper) {
        return tag.value.text ?? tag.value.value ?? null;
      }
      // Vorbis / APEv2 / generic: { id: 'REPLAYGAIN_TRACK_GAIN', value: '-3.24 dB' }
      if (String(tag.id || '').toUpperCase() === upper) {
        return tag.value;
      }
    }
  }
  return null;
}

// Parse a ReplayGain dB string or number ("-3.24 dB", "+2.0", 3.24, …)
// into a rounded float, rejecting clearly invalid values.
function parseReplaygainDb(val) {
  if (val === null || val === undefined) return null;
  const m = String(val).match(/([+-]?\d+\.?\d*)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n) || n < -51 || n > 51) return null;
  return parseFloat(n.toFixed(2));
}

// Parse a ReplayGain peak value (linear amplitude, typically 0–1).
function parseReplaygainPeak(val) {
  if (val === null || val === undefined) return null;
  const n = parseFloat(String(val));
  if (isNaN(n) || n <= 0 || n > 2) return null;
  return parseFloat(n.toFixed(6));
}

function findNativeTag(metadata, tagId) {
  for (const nativeType of Object.keys(metadata.native || {})) {
    const tags = metadata.native[nativeType];
    if (Array.isArray(tags)) {
      const match = tags.find(t => t.id === tagId);
      if (match) return match.value;
    }
  }
  return null;
}

// Scanning handler
ipcMain.on('start-scan', async (event, folders) => {
  try {
    const allFiles = [];
    for (const folder of folders) {
      const normFolder = normalizePath(folder);
      if (fs.existsSync(normFolder)) {
        await getAudioFiles(normFolder, allFiles);
      }
    }

    const total = allFiles.length;
    let current = 0;

    if (total === 0) {
      event.sender.send('scan-complete', { total: 0 });
      return;
    }

    for (const filePath of allFiles) {
      const normalizedFilePath = normalizePath(filePath);
      try {
        const metadata = await musicMetadata.parseFile(normalizedFilePath);
        const duration = metadata.format.duration || 0;
        
        // Try to read BPM and key from metadata tags
        const rawBpm = metadata.common.bpm || findNativeTag(metadata, 'TBPM') || null;
        const rawKey = metadata.common.key || findNativeTag(metadata, 'TKEY') || null;

        // ReplayGain: prefer music-metadata's parsed objects, fall back to native tags
        const rgGainTag = metadata.common.replaygain_track_gain;
        const rgPeakTag = metadata.common.replaygain_track_peak;
        const replaygainTrackGain = (rgGainTag && typeof rgGainTag.dB === 'number')
          ? parseReplaygainDb(rgGainTag.dB)
          : parseReplaygainDb(findReplaygainNativeTag(metadata, 'REPLAYGAIN_TRACK_GAIN'));
        const replaygainTrackPeak = (rgPeakTag && typeof rgPeakTag.ratio === 'number')
          ? parseReplaygainPeak(rgPeakTag.ratio)
          : parseReplaygainPeak(findReplaygainNativeTag(metadata, 'REPLAYGAIN_TRACK_PEAK'));

        // Guard against zero-length or corrupted embedded image data
        let albumArt = null;
        if (metadata.common.picture && metadata.common.picture.length > 0) {
          // Find the best quality picture (usually type 'Front Cover')
          let pic = metadata.common.picture.find(p => p.type === 'Front Cover') || metadata.common.picture[0];

          if (pic.data && pic.data.length > 100) {
            // Ensure the format is a valid MIME type (e.g. 'image/jpeg')
            let mimeType = (pic.format || 'image/jpeg').toLowerCase();
            if (!mimeType.includes('/')) {
              mimeType = 'image/' + mimeType;
            }
            // Standardise common variations
            if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

            albumArt = `data:${mimeType};base64,${pic.data.toString('base64')}`;
            console.log(`[Scan] Extracted album art for ${normalizedFilePath} (${pic.data.length} bytes)`);
          }
        }

        const rawGenre = metadata.common.genre && metadata.common.genre.length > 0
          ? metadata.common.genre[0] : '';

        const track = {
          path: normalizedFilePath,
          title: sanitizeText(metadata.common.title) || path.basename(normalizedFilePath, path.extname(normalizedFilePath)),
          artist: sanitizeText(metadata.common.artist, 'Unknown Artist'),
          album: sanitizeText(metadata.common.album, 'Unknown Album'),
          genre: sanitizeText(rawGenre, 'Unknown'),
          duration: duration,
          bpm: normalizeBpm(rawBpm),
          key: normalizeKey(rawKey),
          albumArt: albumArt,
          replaygainTrackGain: replaygainTrackGain,
          replaygainTrackPeak: replaygainTrackPeak,
          format: path.extname(normalizedFilePath).slice(1)
        };
        
        current++;
        event.sender.send('scan-progress', { current, total, track });
      } catch (err) {
        console.error(`Error parsing metadata for file ${normalizedFilePath}:`, err);
        current++;
        
        // Fallback for files that throw errors but are valid extensions
        const track = {
          path: normalizedFilePath,
          title: path.basename(normalizedFilePath, path.extname(normalizedFilePath)),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          genre: 'Unknown',
          duration: 0,
          bpm: null,
          key: null,
          albumArt: null,
          format: path.extname(normalizedFilePath).slice(1)
        };
        event.sender.send('scan-progress', { current, total, track });
      }
    }
    
    event.sender.send('scan-complete', { total });
  } catch (err) {
    console.error('Scan error:', err);
    event.sender.send('scan-complete', { total: 0, error: err.message });
  }
});

// ID3 tag writer (Specifically for MP3s)
ipcMain.handle('write-tags', async (event, { filePath, bpm, key, albumArtBase64 }) => {
  let attempts = 4;
  let delay = 250; // ms
  const normalizedFilePath = normalizePath(filePath);
  
  while (attempts > 0) {
    try {
      const ext = path.extname(normalizedFilePath).toLowerCase();
      if (ext !== '.mp3') {
        return { success: false, error: 'Only MP3 files support direct ID3 tag writing in this version.' };
      }

      const tags = {};
      if (bpm !== undefined && bpm !== null) {
        tags.BPM = bpm.toString();
      }
      if (key) {
        tags.initialKey = key;
      }

      if (albumArtBase64) {
        const base64Data = albumArtBase64.split(',')[1] || albumArtBase64;
        const imageBuffer = Buffer.from(base64Data, 'base64');
        tags.image = {
          mime: "image/jpeg",
          type: { id: 3, name: "front cover" },
          description: "Album Art extracted by YOP DJ",
          imageBuffer: imageBuffer
        };
      }

      const success = NodeID3.update(tags, normalizedFilePath);
      if (success === true) {
        return { success: true };
      } else if (success instanceof Error) {
        throw success;
      } else {
        throw new Error('Unknown node-id3 write error');
      }
    } catch (err) {
      attempts--;
      if (attempts === 0) {
        console.error(`Error writing tags to ${normalizedFilePath} after multiple retries:`, err);
        return { success: false, error: err.message, code: err.code || err.errno };
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // exponential backoff (250ms, 500ms, 1000ms)
    }
  }
});

// Helper to parse Markdown back into library data
function markdownToLibrary(mdString) {
  const lines = mdString.split(/\r?\n/);
  const folders = [];
  const library = [];
  
  let inFoldersSection = false;
  let inTracksSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('## Scanned Folders')) {
      inFoldersSection = true;
      inTracksSection = false;
      continue;
    }
    if (trimmed.startsWith('## Track Database')) {
      inFoldersSection = false;
      inTracksSection = true;
      continue;
    }
    if (trimmed.startsWith('#') || (trimmed.startsWith('###') && !inTracksSection && !inFoldersSection)) {
      inFoldersSection = false;
      inTracksSection = false;
      continue;
    }
    
    if (inFoldersSection) {
      if (trimmed.startsWith('- ')) {
        folders.push(trimmed.slice(2).trim());
      }
      continue;
    }
    
    if (inTracksSection) {
      if (trimmed.startsWith('|') && !trimmed.includes('---') && !trimmed.toLowerCase().includes('title | artist')) {
        const cols = trimmed.split('|').map(c => c.trim());
        if (cols.length >= 11) {
          const hasMood = cols.length >= 13;
          const hasBeatOffset = cols.length >= 12;
          
          let mood = null;
          let beatOffset = null;
          let duration = 0;
          let format = 'mp3';
          let pathVal = '';
          
          if (hasMood) {
            mood = cols[7] || null;
            beatOffset = cols[8] ? parseFloat(cols[8]) : null;
            duration = cols[9] ? parseFloat(cols[9]) : 0;
            format = cols[10] || 'mp3';
            pathVal = cols[11].replace(/\\\|/g, '|');
          } else if (hasBeatOffset) {
            beatOffset = cols[7] ? parseFloat(cols[7]) : null;
            duration = cols[8] ? parseFloat(cols[8]) : 0;
            format = cols[9] || 'mp3';
            pathVal = cols[10].replace(/\\\|/g, '|');
          } else {
            duration = cols[7] ? parseFloat(cols[7]) : 0;
            format = cols[8] || 'mp3';
            pathVal = cols[9].replace(/\\\|/g, '|');
          }
          
          const track = {
            title: cols[1].replace(/\\\|/g, '|'),
            artist: cols[2].replace(/\\\|/g, '|'),
            album: cols[3].replace(/\\\|/g, '|'),
            genre: cols[4].replace(/\\\|/g, '|'),
            bpm: cols[5] ? parseInt(cols[5]) : null,
            key: cols[6] || null,
            mood: mood,
            beatOffset: beatOffset,
            duration: duration,
            format: format,
            path: pathVal
          };
          library.push(track);
        }
      }
    }
  }
  
  return { folders, library };
}

ipcMain.handle('load-library', async () => {
  try {
    if (fs.existsSync(libraryCachePath)) {
      const content = await fs.promises.readFile(libraryCachePath, 'utf8');
      const data = markdownToLibrary(content);
      
      // Rename library.md to library.md.migrated
      const migratedPath = libraryCachePath + '.migrated';
      fs.renameSync(libraryCachePath, migratedPath);
      console.log('Successfully read library.md and renamed it to library.md.migrated.');
      return data;
    } else {
      const migratedPath = libraryCachePath + '.migrated';
      if (fs.existsSync(migratedPath)) {
        const content = await fs.promises.readFile(migratedPath, 'utf8');
        const data = markdownToLibrary(content);
        console.log('Successfully read library.md.migrated.');
        return data;
      }
    }
    return null;
  } catch (err) {
    console.error('Error loading library cache from Markdown for migration:', err);
    return null;
  }
});

// NOTE: The legacy Gemma model-download/status IPC handlers were removed when
// the app migrated from the Gemma LLM to Essentia.js. Essentia's WebAssembly
// ships bundled inside node_modules, so there is no model to fetch at runtime.
