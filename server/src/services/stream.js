const { spawn } = require('child_process');
const axios = require('axios');
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Persistent HTTP Keep-Alive Agent for reusable CDN sockets
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

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
const inFlightRequests = new Map();
const failedVideoIds = new Set();

// Load disk caches on boot (filtering out old WebM streams)
try {
  if (fs.existsSync(URL_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(URL_CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (v && v.expiresAt > now && v.url && !v.url.includes('mime=audio%2Fwebm')) {
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
      if (v && v.expiresAt > now && v.url && !v.url.includes('mime=audio%2Fwebm')) {
        urlObj[k] = v;
      }
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

// Persistent cross-platform Python binary (python on Windows, python3 on Linux/Cloud)
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

// ==========================================
// PERSISTENT MULTI-THREADED PYTHON WORKER
// ==========================================
let workerProcess = null;
let workerReady = false;
let nextReqId = 1;
const pendingRequests = new Map();

function startWorker() {
  const workerScript = path.join(__dirname, '../worker.py');
  workerProcess = spawn(PYTHON_BIN, [workerScript]);

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

  workerProcess.stderr.on('data', (d) => {
    console.error('[Worker stderr]:', d.toString().trim());
  });

  workerProcess.on('exit', () => {
    workerReady = false;
    workerProcess = null;
    setTimeout(startWorker, 2000);
  });
}

// Initialize worker immediately
startWorker();

/**
 * Extract audio stream URL via persistent multi-threaded in-memory worker
 */
function extractWithWorker(target, isPriority = true) {
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
    }, 7000);

    pendingRequests.set(id, {
      resolve: (url) => {
        resolve(url);
      },
      reject: (err) => {
        reject(err);
      },
      timer
    });

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
    const cookieCandidates = [
      process.env.COOKIE_FILE,
      '/etc/secrets/cookies.txt',
      path.join(__dirname, '../../cookies.txt'),
      path.join(process.cwd(), 'cookies.txt'),
      path.join(process.cwd(), 'server/cookies.txt')
    ].filter(Boolean);

    let cookiePath = null;
    for (const c of cookieCandidates) {
      if (fs.existsSync(c)) {
        try {
          const tmpCp = process.platform === 'win32' ? path.join(process.env.TEMP || '.', 'cookies.txt') : '/tmp/cookies.txt';
          fs.copyFileSync(c, tmpCp);
          cookiePath = tmpCp;
        } catch (e) {
          cookiePath = c;
        }
        break;
      }
    }

    const args = [
      '-m', 'yt_dlp',
      '-f', '140/ba[ext=m4a]/ba/best',
      '--get-url',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--no-config',
      '--geo-bypass',
      '--socket-timeout', '8'
    ];

    if (cookiePath) {
      args.push('--cookies', cookiePath);
    }

    args.push(target);

    const pyProcess = spawn(PYTHON_BIN, args);

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
async function getAudioStreamUrl(videoId, fallbackQuery = null, isPriority = true) {
  const cacheKey = videoId || fallbackQuery;
  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.url && !cached.url.includes('mime=audio%2Fwebm')) {
    return cached.url;
  }

  // Deduplicate concurrent in-flight extractions (prevents mobile Safari multi-range stampede)
  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const jobPromise = (async () => {
    let streamUrl = null;

    // 1. Direct video ID (11 chars YouTube ID)
    const isVideoId = videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId);
    if (isVideoId && !failedVideoIds.has(videoId)) {
      try {
        streamUrl = await extractWithWorker(`https://www.youtube.com/watch?v=${videoId}`, isPriority);
        if (streamUrl) {
          urlCache.set(videoId, {
            url: streamUrl,
            expiresAt: Date.now() + 4 * 60 * 60 * 1000
          });
          return streamUrl;
        }
      } catch (err) {
        console.warn(`Direct stream for ${videoId} failed (${err.message}). Trying query resolution...`);
        failedVideoIds.add(videoId);
      }
    }

    // 2. Query resolution using resolveCache (0ms if previously resolved)
    if (!streamUrl && fallbackQuery) {
      const cleanKey = fallbackQuery.toLowerCase().trim();
      let targetVideoId = resolveCache.get(cleanKey);

      if (targetVideoId && failedVideoIds.has(targetVideoId)) {
        targetVideoId = null;
      }

      if (!targetVideoId) {
        try {
          const ytsRes = await yts(fallbackQuery);
          if (ytsRes && ytsRes.videos && ytsRes.videos.length > 0) {
            // Find first video that is NOT blacklisted and under 10 minutes (avoids multi-hour mix files)
            const candidate = ytsRes.videos.find(v => !failedVideoIds.has(v.videoId) && (!v.seconds || v.seconds < 600));
            if (candidate) {
              targetVideoId = candidate.videoId;
              resolveCache.set(cleanKey, targetVideoId);
            }
          }
        } catch (e) {
          console.error('yts search failed:', e.message);
        }
      }

      if (targetVideoId && !failedVideoIds.has(targetVideoId)) {
        // Check if videoId itself was already cached
        const cachedVideo = urlCache.get(targetVideoId);
        if (cachedVideo && cachedVideo.expiresAt > Date.now() && cachedVideo.url && !cachedVideo.url.includes('mime=audio%2Fwebm')) {
          urlCache.set(cacheKey, cachedVideo);
          return cachedVideo.url;
        }

        try {
          streamUrl = await extractWithWorker(`https://www.youtube.com/watch?v=${targetVideoId}`, isPriority);
          if (streamUrl) {
            const entry = { url: streamUrl, expiresAt: Date.now() + 4 * 60 * 60 * 1000 };
            urlCache.set(targetVideoId, entry);
            urlCache.set(cacheKey, entry);
            return streamUrl;
          }
        } catch (e) {
          console.error('extractWithWorker failed for targetVideoId:', e.message);
          failedVideoIds.add(targetVideoId);
        }
      }
    }

    // 3. Fallback search
    if (!streamUrl && videoId && !isVideoId) {
      try {
        streamUrl = await extractWithWorker(`ytsearch5:${videoId}`, isPriority);
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
  })();

  inFlightRequests.set(cacheKey, jobPromise);
  try {
    return await jobPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Background pre-fetching for upcoming tracks (runs in parallel via multi-threaded worker)
 */
async function prefetchTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  for (const t of tracks.slice(0, 3)) {
    if (!t) continue;
    const query = `${t.title || ''} ${t.artist || ''}`.trim();
    const key = t.id || query;
    if (!urlCache.has(key)) {
      getAudioStreamUrl(t.id, query, false).catch(() => {});
    }
  }
}

/**
 * Proxy stream with zero-buffering and immediate header flushing for minimum audio latency
 */
async function pipeStream(videoId, req, res, fallbackQuery = null) {
  let upstreamStream = null;

  // Destroy upstream stream if mobile client closes or aborts request
  req.on('close', () => {
    if (upstreamStream && typeof upstreamStream.destroy === 'function') {
      upstreamStream.destroy();
    }
  });

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
      httpsAgent: httpsAgent,
      decompress: false, // Prevents axios decompression latency
      maxRedirects: 5,
      validateStatus: () => true
    });

    upstreamStream = response.data;

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
