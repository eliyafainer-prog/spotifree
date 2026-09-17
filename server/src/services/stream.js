const { spawn } = require('child_process');
const axios = require('axios');
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');

// Ensure cache directory exists
const CACHE_DIR = path.join(__dirname, '../../cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const URL_CACHE_FILE = path.join(CACHE_DIR, 'url_cache.json');
const RESOLVE_CACHE_FILE = path.join(CACHE_DIR, 'resolutions.json');

// In-memory caches with persistent disk backing
const urlCache = new Map();
const resolveCache = new Map();

// Load disk caches on boot
try {
  if (fs.existsSync(URL_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(URL_CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (v && v.expiresAt > now) {
        urlCache.set(k, v);
      }
    }
  }
} catch (e) {}

try {
  if (fs.existsSync(RESOLVE_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(RESOLVE_CACHE_FILE, 'utf8'));
    for (const [k, v] of Object.entries(data)) {
      if (k && v) resolveCache.set(k, v);
    }
  }
} catch (e) {}

function saveCachesToDisk() {
  try {
    const urlObj = {};
    const now = Date.now();
    for (const [k, v] of urlCache.entries()) {
      if (v && v.expiresAt > now) urlObj[k] = v;
    }
    fs.writeFileSync(URL_CACHE_FILE, JSON.stringify(urlObj), 'utf8');

    const resolveObj = {};
    for (const [k, v] of resolveCache.entries()) {
      if (k && v) resolveObj[k] = v;
    }
    fs.writeFileSync(RESOLVE_CACHE_FILE, JSON.stringify(resolveObj), 'utf8');
  } catch (e) {}
}

// Periodically sync caches to disk
setInterval(saveCachesToDisk, 20000);

// ==========================================
// PERSISTENT PYTHON WORKER (Zero boot time)
// ==========================================
let workerProcess = null;
let workerReady = false;
let nextReqId = 1;
const pendingRequests = new Map();

function startWorker() {
  const workerScript = path.join(__dirname, '../worker.py');
  workerProcess = spawn('python', [workerScript]);

  let buffer = '';

  workerProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep remainder

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'READY') {
        workerReady = true;
        continue;
      }
      try {
        const json = JSON.parse(trimmed);
        if (json.id && pendingRequests.has(json.id)) {
          const { resolve, reject, timer } = pendingRequests.get(json.id);
          clearTimeout(timer);
          pendingRequests.delete(json.id);
          if (json.url) {
            resolve(json.url);
          } else {
            reject(new Error(json.error || 'Extraction failed'));
          }
        }
      } catch (e) {}
    }
  });

  workerProcess.stderr.on('data', () => {});

  workerProcess.on('exit', () => {
    workerReady = false;
    workerProcess = null;
    setTimeout(startWorker, 2000);
  });
}

// Initialize worker immediately
startWorker();

/**
 * Extract audio stream URL via persistent in-memory worker
 */
function extractWithWorker(target) {
  return new Promise((resolve, reject) => {
    if (!workerProcess || !workerReady) {
      return extractStreamWithYtDlp(target).then(resolve).catch(reject);
    }

    const id = nextReqId++;
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        extractStreamWithYtDlp(target).then(resolve).catch(reject);
      }
    }, 8000);

    pendingRequests.set(id, { resolve, reject, timer });
    try {
      workerProcess.stdin.write(JSON.stringify({ id, target }) + '\n');
    } catch (e) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      extractStreamWithYtDlp(target).then(resolve).catch(reject);
    }
  });
}

/**
 * Fallback standalone yt-dlp execution
 */
function extractStreamWithYtDlp(target) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', 'yt_dlp',
      '-f', 'ba/b[height<=480]/best',
      '--get-url',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--no-config',
      '--geo-bypass',
      '--socket-timeout', '6',
      target
    ];

    const pyProcess = spawn('python', args);

    let output = '';
    let errorOutput = '';

    pyProcess.stdout.on('data', d => output += d.toString());
    pyProcess.stderr.on('data', d => errorOutput += d.toString());

    pyProcess.on('close', (code) => {
      const urls = output.trim().split('\n').filter(u => u.startsWith('http'));
      if (urls.length > 0) {
        return resolve(urls[0].trim());
      }
      reject(new Error(`Failed to extract stream: ${errorOutput || 'No playable stream found'}`));
    });

    pyProcess.on('error', reject);
  });
}

/**
 * Get audio stream URL for a given video ID or search query, with fast in-memory & disk caching
 */
async function getAudioStreamUrl(videoId, fallbackQuery = null) {
  const cacheKey = videoId || fallbackQuery;
  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  let streamUrl = null;

  // 1. Direct video ID (11 chars YouTube ID)
  const isVideoId = videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId);
  if (isVideoId) {
    try {
      streamUrl = await extractWithWorker(`https://www.youtube.com/watch?v=${videoId}`);
      if (streamUrl) {
        urlCache.set(videoId, {
          url: streamUrl,
          expiresAt: Date.now() + 4 * 60 * 60 * 1000
        });
        return streamUrl;
      }
    } catch (err) {
      console.warn(`Direct stream for ${videoId} failed (${err.message}). Trying query resolution...`);
    }
  }

  // 2. Query resolution using resolveCache (0ms if previously resolved)
  if (!streamUrl && fallbackQuery) {
    const cleanKey = fallbackQuery.toLowerCase().trim();
    let targetVideoId = resolveCache.get(cleanKey);

    if (!targetVideoId) {
      try {
        const ytsRes = await yts(fallbackQuery);
        if (ytsRes && ytsRes.videos && ytsRes.videos.length > 0) {
          targetVideoId = ytsRes.videos[0].videoId;
          resolveCache.set(cleanKey, targetVideoId);
        }
      } catch (e) {
        console.error('yts search failed:', e.message);
      }
    }

    if (targetVideoId) {
      // Check if videoId itself was already cached
      const cachedVideo = urlCache.get(targetVideoId);
      if (cachedVideo && cachedVideo.expiresAt > Date.now()) {
        urlCache.set(cacheKey, cachedVideo);
        return cachedVideo.url;
      }

      try {
        streamUrl = await extractWithWorker(`https://www.youtube.com/watch?v=${targetVideoId}`);
        if (streamUrl) {
          const entry = { url: streamUrl, expiresAt: Date.now() + 4 * 60 * 60 * 1000 };
          urlCache.set(targetVideoId, entry);
          urlCache.set(cacheKey, entry);
          return streamUrl;
        }
      } catch (e) {
        console.error('extractWithWorker failed for targetVideoId:', e.message);
      }
    }
  }

  // 3. Fallback search
  if (!streamUrl && videoId && !isVideoId) {
    try {
      streamUrl = await extractWithWorker(`ytsearch5:${videoId}`);
    } catch (e) {}
  }

  if (!streamUrl) {
    throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
  }

  // Cache for 4 hours
  urlCache.set(cacheKey, {
    url: streamUrl,
    expiresAt: Date.now() + 4 * 60 * 60 * 1000
  });

  return streamUrl;
}

/**
 * Background pre-fetching for upcoming tracks (runs asynchronously without blocking)
 */
async function prefetchTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  for (const t of tracks.slice(0, 6)) {
    if (!t) continue;
    const query = `${t.title || ''} ${t.artist || ''}`.trim();
    const key = t.id || query;
    if (!urlCache.has(key)) {
      getAudioStreamUrl(t.id, query).catch(() => {});
    }
  }
}

/**
 * Proxy stream with zero-buffering and immediate header flushing for minimum audio latency
 */
async function pipeStream(videoId, req, res, fallbackQuery = null) {
  try {
    const streamUrl = await getAudioStreamUrl(videoId, fallbackQuery);
    const range = req.headers.range;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    if (range) {
      headers['Range'] = range;
    }

    const response = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'stream',
      headers: headers,
      decompress: false, // Prevents axios decompression latency
      maxRedirects: 5,
      validateStatus: () => true
    });

    res.status(response.status);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=14400');

    for (const [key, value] of Object.entries(response.headers)) {
      if (['content-type', 'content-length', 'content-range'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    response.data.pipe(res);
  } catch (err) {
    console.error('Error piping stream:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'שגיאה בהזרמת השמע: ' + err.message });
    }
  }
}

module.exports = {
  getAudioStreamUrl,
  pipeStream,
  prefetchTracks
};
