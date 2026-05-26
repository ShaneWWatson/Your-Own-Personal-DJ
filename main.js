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
  protocol.handle('app-media', (request) => {
    try {
      const parsedUrl = new URL(request.url);
      let filePath = decodeURIComponent(parsedUrl.pathname);
      
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

// Native Directory Picker
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return null;
  } else {
    return result.filePaths[0];
  }
});

// Default Music Folder
ipcMain.handle('get-system-music-folder', () => {
  try {
    return app.getPath('music');
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
          filesList.push(resPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }
  return filesList;
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
      if (fs.existsSync(folder)) {
        await getAudioFiles(folder, allFiles);
      }
    }

    const total = allFiles.length;
    let current = 0;

    if (total === 0) {
      event.sender.send('scan-complete', { total: 0 });
      return;
    }

    for (const filePath of allFiles) {
      try {
        const metadata = await musicMetadata.parseFile(filePath);
        const duration = metadata.format.duration || 0;
        
        // Try to read BPM and key from metadata tags
        const bpm = metadata.common.bpm || findNativeTag(metadata, 'TBPM') || null;
        const key = metadata.common.key || findNativeTag(metadata, 'TKEY') || null;
        
        let albumArt = null;
        if (metadata.common.picture && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0];
          albumArt = `data:${pic.format};base64,${pic.data.toString('base64')}`;
        }
        
        const track = {
          path: filePath,
          title: metadata.common.title || path.basename(filePath, path.extname(filePath)),
          artist: metadata.common.artist || 'Unknown Artist',
          album: metadata.common.album || 'Unknown Album',
          genre: metadata.common.genre && metadata.common.genre.length > 0 ? metadata.common.genre[0] : 'Unknown',
          duration: duration,
          bpm: bpm ? parseInt(bpm) : null,
          key: key || null,
          albumArt: albumArt,
          format: path.extname(filePath).slice(1)
        };
        
        current++;
        event.sender.send('scan-progress', { current, total, track });
      } catch (err) {
        console.error(`Error parsing metadata for file ${filePath}:`, err);
        current++;
        
        // Fallback for files that throw errors but are valid extensions
        const track = {
          path: filePath,
          title: path.basename(filePath, path.extname(filePath)),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          genre: 'Unknown',
          duration: 0,
          bpm: null,
          key: null,
          albumArt: null,
          format: path.extname(filePath).slice(1)
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
ipcMain.handle('write-tags', async (event, { filePath, bpm, key }) => {
  let attempts = 4;
  let delay = 250; // ms
  
  while (attempts > 0) {
    try {
      const ext = path.extname(filePath).toLowerCase();
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

      const success = NodeID3.update(tags, filePath);
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
        console.error(`Error writing tags to ${filePath} after multiple retries:`, err);
        return { success: false, error: err.message, code: err.code || err.errno };
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // exponential backoff (250ms, 500ms, 1000ms)
    }
  }
});

// Helper to convert library data to Markdown format
function libraryToMarkdown(libraryData) {
  const folders = libraryData.folders || [];
  const library = libraryData.library || [];
  
  let md = `# Music Library Database\n\n`;
  md += `This file acts as the local database for Your Own Personal DJ. Feel free to view or edit the BPM and Key columns manually.\n\n`;
  
  md += `## Scanned Folders\n`;
  folders.forEach(f => {
    md += `- ${f}\n`;
  });
  md += `\n`;
  
  md += `## Track Database\n\n`;
  md += `| Title | Artist | Album | Genre | BPM | Key | Mood | BeatOffset | Duration | Format | Path |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  
  library.forEach(t => {
    const title = (t.title || '').replace(/\|/g, '\\|');
    const artist = (t.artist || '').replace(/\|/g, '\\|');
    const album = (t.album || '').replace(/\|/g, '\\|');
    const genre = (t.genre || '').replace(/\|/g, '\\|');
    const bpm = t.bpm !== null && t.bpm !== undefined ? t.bpm : '';
    const key = t.key || '';
    const mood = t.mood || '';
    const beatOffset = t.beatOffset !== null && t.beatOffset !== undefined ? t.beatOffset : '';
    const duration = t.duration || 0;
    const format = t.format || '';
    const filePath = (t.path || '').replace(/\|/g, '\\|');
    
    md += `| ${title} | ${artist} | ${album} | ${genre} | ${bpm} | ${key} | ${mood} | ${beatOffset} | ${duration} | ${format} | ${filePath} |\n`;
  });
  
  return md;
}

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
