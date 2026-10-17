const { spawn } = require('child_process');
const axios = require('axios');
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { getRegisteredTunnel } = require('./tunnelState');

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
const failedVideoIds = new Map(); // id -> timestamp
let youtubeDatacenterBlockedUntil = 0;

function isValidCachedStreamUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('mime=audio%2Fwebm')) return false;
  if (url.includes('/preview/') || url.includes('cf-preview-media') || url.includes('_preview')) return false;
  return true;
}

function isFailed(id) {
  if (!id) return false;
  const t = failedVideoIds.get(id);
  if (!t) return false;
  if (Date.now() - t > 15000) {
    failedVideoIds.delete(id);
    return false;
  }
  return true;
}

function markFailed(id) {
  if (id) failedVideoIds.set(id, Date.now());
}

// Load disk caches on boot (filtering out old WebM or 30s preview streams)
try {
  if (fs.existsSync(URL_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(URL_CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (v && v.expiresAt > now && isValidCachedStreamUrl(v.url)) {
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
      if (v && v.expiresAt > now && isValidCachedStreamUrl(v.url)) {
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
    for (const [id, req] of pendingRequests.entries()) {
      clearTimeout(req.timer);
      extractStreamWithYtDlp(req.target).then(req.resolve).catch(req.reject);
    }
    pendingRequests.clear();
    setTimeout(startWorker, 2000);
  });
}

// Initialize worker immediately
startWorker();

/**
 * Extract audio stream URL via persistent multi-threaded in-memory worker
 */
function extractWithWorker(target, isPriority = true, meta = null) {
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
    }, 25000);

    pendingRequests.set(id, {
      target,
      resolve: (url) => {
        resolve(url);
      },
      reject: (err) => {
        reject(err);
      },
      timer
    });

    try {
      workerProcess.stdin.write(JSON.stringify({ id, target, meta: meta || {} }) + '\n');
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
      path.join(__dirname, '../../cookies.txt'),
      path.join(process.cwd(), 'server/cookies.txt'),
      path.join(process.cwd(), 'cookies.txt'),
      path.join(__dirname, '../cookies.txt'),
      process.env.COOKIE_FILE,
      '/etc/secrets/cookies.txt'
    ].filter(Boolean);

    const existingCookies = [];
    for (const c of cookieCandidates) {
      if (fs.existsSync(c)) {
        try {
          const stat = fs.statSync(c);
          if (stat.size > 50) {
            existingCookies.push({ path: c, size: stat.size, mtime: stat.mtimeMs });
          }
        } catch (e) {}
      }
    }
    // Priority order: Repo cookies always come first over old /etc/secrets!
    const selected = existingCookies.find(c => !c.path.includes('/etc/secrets')) || existingCookies[0] || null;

    let cookiePath = null;
    if (selected) {
      const best = selected.path;
      try {
        const tmpCp = process.platform === 'win32' ? path.join(process.env.TEMP || '.', 'cookies.txt') : '/tmp/cookies.txt';
        const raw = fs.readFileSync(best, 'utf8');
        const lines = raw.split('\n');
        const clean = ['# Netscape HTTP Cookie File\n'];
        for (const line of lines) {
          const stripped = line.trim();
          if (!stripped || stripped.startsWith('#')) continue;
          const parts = stripped.split(/\s+/);
          if (parts.length >= 7) {
            const val = parts.slice(6).join(' ');
            clean.push(`${parts[0]}\t${parts[1]}\t${parts[2]}\t${parts[3]}\t${parts[4]}\t${parts[5]}\t${val}\n`);
          }
        }
        fs.writeFileSync(tmpCp, clean.join(''), 'utf8');
        cookiePath = tmpCp;
      } catch (e) {
        cookiePath = best;
      }
    }

    const args = [
      '-m', 'yt_dlp',
      '-f', '140/ba[protocol^=http][ext=m4a]/ba[protocol^=http]/ba/18/b/best',
      '--extractor-args', 'youtube:player_client=android,visionos,web',
      '--get-url',
      '--remote-components', 'ejs:github',
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

    pyProcess.on('close', () => {
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
 * Fast 120ms YouTube oEmbed lookup to get title + artist when only videoId is provided
 */
async function fetchVideoMetaFromOembed(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const res = await axios.get(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { timeout: 1400 }
    );
    if (res.data && res.data.title) {
      const author = (res.data.author_name || '').replace(/\s*-\s*Topic$/i, '').trim();
      const rawTitle = res.data.title
        .replace(/\s*[\(\[](official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer|hd|4k|audio|קליפ\s*רשמי|אודיו\s*רשמי)[\)\]]/gi, '')
        .trim();
      let cleanTitle = rawTitle;
      let cleanArtist = author;
      if (rawTitle.includes(' - ')) {
        const parts = rawTitle.split(' - ');
        cleanArtist = parts[0].trim();
        cleanTitle = parts.slice(1).join(' - ').trim();
      }
      const query = cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())
        ? `${cleanArtist} - ${cleanTitle}`
        : rawTitle;
      return { query, title: cleanTitle, artist: cleanArtist };
    }
  } catch (e) {}
  return null;
}

/**
 * Get audio stream URL for a given video ID or search query, with fast in-memory & disk caching
 */
async function getAudioStreamUrl(videoId, fallbackQuery = null, isPriority = true, meta = null) {
  const cacheKey = videoId || fallbackQuery;
  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && isValidCachedStreamUrl(cached.url)) {
    return cached.url;
  }

  // Deduplicate concurrent in-flight extractions (prevents mobile multi-range stampede)
  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const jobPromise = (async () => {
    let streamUrl = null;
    let resolvedVideoId = videoId;
    let isVideoId = Boolean(resolvedVideoId && /^[a-zA-Z0-9_-]{11}$/.test(resolvedVideoId));
    let effectiveQuery = fallbackQuery ? fallbackQuery.trim() : null;

    const effectiveMeta = {
      durationSeconds: Number(meta?.durationSeconds) || 0,
      title: String(meta?.title || '').trim(),
      artist: String(meta?.artist || '').trim(),
      album: String(meta?.album || '').trim()
    };

    if (!effectiveMeta.title && effectiveQuery) {
      if (effectiveQuery.includes(' - ')) {
        const parts = effectiveQuery.split(' - ');
        if (!effectiveMeta.artist) effectiveMeta.artist = parts[0].trim();
        effectiveMeta.title = parts.slice(1).join(' - ').trim();
      } else {
        effectiveMeta.title = effectiveQuery;
      }
    }

    // If an unresolved Spotify track (sp_...) or raw query arrived directly, resolve it via importer's strict studio scorer first!
    if (!isVideoId && (effectiveMeta.title || effectiveQuery)) {
      try {
        const { resolveTrackToStreamableId } = require('./importer');
        const resolved = await resolveTrackToStreamableId({
          id: videoId || 'query',
          title: effectiveMeta.title || effectiveQuery,
          artist: effectiveMeta.artist || '',
          album: effectiveMeta.album || '',
          durationSeconds: effectiveMeta.durationSeconds || 0,
          hasCustomArtwork: true
        });
        if (resolved && resolved.streamableId && /^[a-zA-Z0-9_-]{11}$/.test(resolved.streamableId)) {
          resolvedVideoId = resolved.streamableId;
          isVideoId = true;
          if (!effectiveMeta.durationSeconds && resolved.durationSeconds) {
            effectiveMeta.durationSeconds = resolved.durationSeconds;
          }
          const resolvedCached = urlCache.get(resolvedVideoId);
          if (resolvedCached && resolvedCached.expiresAt > Date.now() && isValidCachedStreamUrl(resolvedCached.url)) {
            urlCache.set(cacheKey, resolvedCached);
            return resolvedCached.url;
          }
        }
      } catch (e) {}
    }

    if (!effectiveQuery && !isVideoId && resolvedVideoId && !resolvedVideoId.startsWith('sp_')) {
      effectiveQuery = resolvedVideoId.trim();
    }

    // If only videoId was provided without metadata, fetch title/artist via oEmbed in parallel
    const oembedPromise = (!effectiveQuery && isVideoId)
      ? fetchVideoMetaFromOembed(resolvedVideoId)
      : Promise.resolve(null);

    const ytBlocked = Date.now() < youtubeDatacenterBlockedUntil;

    // Helper for SoundCloud full-track studio extraction
    const extractSoundCloud = async (qOverride = null) => {
      const oembedData = await oembedPromise;
      if (oembedData) {
        if (!effectiveMeta.title && oembedData.title) effectiveMeta.title = oembedData.title;
        if (!effectiveMeta.artist && oembedData.artist) effectiveMeta.artist = oembedData.artist;
      }

      // Build clean studio search query using primary artist + core title (without parenthetical suffixes)
      const primaryArtist = (effectiveMeta.artist || '').split(',')[0].trim();
      const coreTitle = (effectiveMeta.title || '')
        .replace(/\s*[\(\[][^)\]]*[\)\]]/g, '')
        .split(' - ')[0]
        .trim();

      let queryToUse = qOverride;
      if (!queryToUse) {
        if (primaryArtist && coreTitle && !coreTitle.toLowerCase().includes(primaryArtist.toLowerCase())) {
          queryToUse = `${primaryArtist} ${coreTitle}`;
        } else {
          queryToUse = coreTitle || effectiveQuery || oembedData?.query;
        }
      }

      if (!queryToUse) throw new Error('No query for SoundCloud');
      const cleanQ = queryToUse.replace(/[^\p{L}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim();
      const url = await extractWithWorker(`scsearch5:${cleanQ}`, isPriority, effectiveMeta);
      if (url && isValidCachedStreamUrl(url)) {
        return url;
      }
      throw new Error('Invalid SC url');
    };

    // Helper for YouTube direct worker extraction (with bot-block circuit breaker)
    const extractYouTube = async (vid) => {
      if (!vid || isFailed(vid) || ytBlocked) {
        throw new Error('YouTube skipped or blocked');
      }
      try {
        const url = await extractWithWorker(`https://www.youtube.com/watch?v=${vid}`, isPriority, effectiveMeta);
        if (url && isValidCachedStreamUrl(url)) return url;
        throw new Error('Empty YT url');
      } catch (err) {
        const msg = String(err.message || '');
        if (msg.includes('Sign in to confirm') || msg.includes('not a bot')) {
          youtubeDatacenterBlockedUntil = Date.now() + 15 * 60 * 1000;
          console.warn('[Stream] YouTube datacenter bot-block detected; activating fast SoundCloud/Invidious circuit-breaker for 15m.');
        }
        markFailed(vid);
        throw err;
      }
    };

    // Start SoundCloud studio search and Invidious lookup in parallel at t=0ms
    const scPromise = extractSoundCloud().catch(() => null);
    const invPromise = isVideoId
      ? fetchFromInvidious(resolvedVideoId).then(u => (u && isValidCachedStreamUrl(u) ? u : null)).catch(() => null)
      : Promise.resolve(null);

    // 1. Try YouTube worker (when not blocked) racing against SoundCloud studio match
    if (isVideoId && !ytBlocked) {
      try {
        streamUrl = await Promise.any([
          extractYouTube(resolvedVideoId),
          scPromise.then(u => {
            if (u) return u;
            throw new Error('No SC match');
          })
        ]);
      } catch (e) {}
    }

    // 2. Prefer validated SoundCloud studio stream (100% CDN compatible on Render & mobile background)
    if (!streamUrl) {
      streamUrl = await scPromise;
    }

    // 3. Fallback to Invidious direct stream (already running in parallel since t=0ms)
    if (!streamUrl && isVideoId) {
      streamUrl = await invPromise;
    }

    if (!streamUrl) {
      throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
    }

    // Cache under both cacheKey and resolvedVideoId (12m for HLS .m3u8 tokens, 1h for googlevideo, 4h for progressive HTTP)
    const ttlMs = streamUrl.includes('.m3u8')
      ? 12 * 60 * 1000
      : streamUrl.includes('googlevideo.com')
        ? 60 * 60 * 1000
        : 4 * 60 * 60 * 1000;
    const cacheEntry = {
      url: streamUrl,
      expiresAt: Date.now() + ttlMs
    };
    urlCache.set(cacheKey, cacheEntry);
    if (isVideoId) {
      urlCache.set(resolvedVideoId, cacheEntry);
    }

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
 * Background pre-fetching using persistent worker thread pool to eliminate buffering latency
 */
async function prefetchTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  for (const track of tracks.slice(0, 3)) {
    if (!track) continue;
    const vid = track.streamableId || track.id;
    const fallbackQuery = `${track.artist || ''} - ${track.title || ''}`.replace(/^-\s*|\s*-$/g, '').trim();
    const key = vid || fallbackQuery;
    const meta = {
      durationSeconds: Number(track.durationSeconds) || 0,
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || ''
    };
    if (key && !urlCache.has(key) && !inFlightRequests.has(key)) {
      getAudioStreamUrl(vid, fallbackQuery || null, false, meta).catch(() => {});
    }
  }
}

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de'
];

/**
 * Fetch direct Google CDN audio stream URL from public Invidious instances in parallel
 */
async function fetchFromInvidious(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const promises = INVIDIOUS_INSTANCES.map(inst =>
    axios.get(`${inst}/api/v1/videos/${videoId}`, {
      timeout: 4200,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }).then(res => {
      if (res.data && res.data.adaptiveFormats) {
        const audio = res.data.adaptiveFormats.find(f => f.type && f.type.includes('audio/mp4')) ||
                      res.data.adaptiveFormats.find(f => f.type && f.type.startsWith('audio/'));
        if (audio && audio.url) {
          return audio.url;
        }
      }
      throw new Error('No audio found in format list');
    })
  );

  try {
    return await Promise.any(promises);
  } catch (e) {
    return null;
  }
}

/**
 * Direct Audio Stream Proxy: forwards HTTP Range requests with Content-Range & Content-Length
 * for 100% native scrubber timeline advancement, seek support, and mobile background playback.
 */
async function pipeStream(videoId, req, res, fallbackQuery = null, meta = null) {
  let upstreamStream = null;

  req.on('close', () => {
    if (upstreamStream && typeof upstreamStream.destroy === 'function') {
      upstreamStream.destroy();
    }
  });

  try {
    let streamUrl = null;
    try {
      streamUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
    } catch (e) {
      if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        streamUrl = await fetchFromInvidious(videoId);
      }
    }

    if (!streamUrl && videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      streamUrl = await fetchFromInvidious(videoId);
    }

    if (!streamUrl) {
      throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
    }

    const isHls = streamUrl.includes('.m3u8');
    const isVideo = streamUrl.includes('mime=video') || streamUrl.includes('itag=18');
    if (isVideo || isHls) {
      const isMp3Hls = isHls && streamUrl.includes('mp3');
      const ffmpegArgs = isMp3Hls
        ? [
            '-loglevel', 'error',
            '-i', streamUrl,
            '-vn',
            '-c:a', 'copy',
            '-f', 'mp3',
            'pipe:1'
          ]
        : [
            '-loglevel', 'error',
            '-i', streamUrl,
            '-vn',
            '-c:a', 'copy',
            ...(isHls ? ['-bsf:a', 'aac_adtstoasc'] : []),
            '-f', 'mp4',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            'pipe:1'
          ];

      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      upstreamStream = ffmpeg;

      req.on('close', () => {
        try { ffmpeg.kill(); } catch (e) {}
      });

      res.setHeader('Content-Type', isMp3Hls ? 'audio/mpeg' : 'audio/mp4');
      res.setHeader('Cache-Control', 'public, max-age=14400');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      ffmpeg.stdout.pipe(res);
      ffmpeg.on('error', (err) => {
        console.error('FFmpeg pipe error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Audio demuxing failed' });
        } else {
          try { res.end(); } catch (e) {}
        }
      });
      ffmpeg.stdout.on('error', () => {
        try { ffmpeg.kill(); } catch (e) {}
      });
      return;
    }

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
      decompress: false,
      maxRedirects: 5,
      validateStatus: () => true
    });

    if (response.status >= 200 && response.status < 400) {
      upstreamStream = response.data;

      if (typeof res.status === 'function') {
        res.status(response.status);
      } else {
        res.statusCode = response.status;
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=14400');

      for (const [key, value] of Object.entries(response.headers)) {
        const lower = key.toLowerCase();
        if (['content-type', 'content-length', 'content-range'].includes(lower)) {
          res.setHeader(lower, value);
        }
      }

      // Always normalize to audio/mp4 for background audio playback
      const ct = String(res.getHeader('Content-Type') || '');
      if (!ct || ct.includes('video/')) {
        res.setHeader('Content-Type', 'audio/mp4');
      }

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      response.data.pipe(res);
      return;
    }

    // If Google CDN blocked Render's datacenter IP (403) on a POT-signed Invidious stream,
    // redirect the client's <audio> element (302) so the user's residential IP streams directly from Google CDN!
    if (response.status === 403 && streamUrl.includes('googlevideo.com') && !req.query.dl) {
      return res.redirect(302, streamUrl);
    }

    if (response.status === 403 || response.status >= 400) {
      urlCache.delete(videoId);
      if (fallbackQuery) urlCache.delete(fallbackQuery.toLowerCase().trim());
    }

    throw new Error(`Upstream CDN returned status ${response.status}`);
  } catch (err) {
    console.error(`pipeStream error for ${videoId}:`, err.message);
    if (!res.headersSent) {
      if (typeof res.status === 'function') {
        res.status(500).json({ error: 'שגיאה בהזרמת השמע: ' + err.message });
      } else {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'שגיאה בהזרמת השמע: ' + err.message }));
      }
    }
  }
}

module.exports = {
  getAudioStreamUrl,
  pipeStream,
  prefetchTracks
};
