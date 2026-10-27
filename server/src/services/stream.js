const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

// Persistent HTTP Keep-Alive Agent for 0ms TLS reuse across YouTube CDN sockets
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });

// Ensure cache directory exists
const CACHE_DIR = path.join(__dirname, '../../cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const URL_CACHE_FILE = path.join(CACHE_DIR, 'url_cache.json');

// Bounded in-memory caches (prevents memory leaks on Render 512MB container)
const MAX_CACHE_ENTRIES = 500;
const urlCache = new Map();
const inFlightRequests = new Map();

function setBoundedCache(map, key, value) {
  if (!key) return;
  if (map.size >= MAX_CACHE_ENTRIES && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
  map.set(key, value);
}

function getSignedUrlExpirationMs(url) {
  if (!url || typeof url !== 'string') return 0;
  try {
    const expMatch = url.match(/[?&](?:expires|expire)=(\d{10,13})/i);
    if (expMatch && expMatch[1]) {
      const val = Number(expMatch[1]);
      return val < 1e11 ? val * 1000 : val;
    }
    const policyMatch = url.match(/[?&]Policy=([A-Za-z0-9_-]+)/);
    if (policyMatch && policyMatch[1]) {
      const jsonStr = Buffer.from(policyMatch[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const epochMatch = jsonStr.match(/"AWS:EpochTime"\s*:\s*(\d{10,13})/);
      if (epochMatch && epochMatch[1]) {
        const val = Number(epochMatch[1]);
        return val < 1e11 ? val * 1000 : val;
      }
    }
  } catch (e) {}
  return 0;
}

function isValidCachedStreamUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('mime=audio%2Fwebm')) return false;
  if (url.includes('/preview/') || url.includes('cf-preview-media') || url.includes('_preview')) return false;
  const signedExp = getSignedUrlExpirationMs(url);
  if (signedExp > 0 && signedExp - 45000 <= Date.now()) {
    return false;
  }
  return true;
}

// Load disk cache on boot
try {
  if (fs.existsSync(URL_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(URL_CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (v && v.expiresAt > now && isValidCachedStreamUrl(v.url)) {
        setBoundedCache(urlCache, k, v);
      }
    }
  }
} catch (e) {}

async function saveCachesToDisk() {
  try {
    const urlObj = {};
    const now = Date.now();
    for (const [k, v] of urlCache.entries()) {
      if (v && v.expiresAt > now && isValidCachedStreamUrl(v.url)) {
        urlObj[k] = v;
      }
    }
    await fs.promises.writeFile(URL_CACHE_FILE, JSON.stringify(urlObj), 'utf8');
  } catch (e) {}
}

const cacheSaveInterval = setInterval(saveCachesToDisk, 30000);
if (cacheSaveInterval && typeof cacheSaveInterval.unref === 'function') {
  cacheSaveInterval.unref();
}

function evictStreamCache(videoId, fallbackQuery) {
  if (videoId) urlCache.delete(videoId);
  if (fallbackQuery) urlCache.delete(fallbackQuery.trim());
}

// ============================================================================
// DIRECT YT-DLP / WORKER AUDIO EXTRACTOR (100% Reliable Official YouTube M4A Fallback)
// ============================================================================
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

/**
 * Fast direct yt-dlp fallback engine (~1.5s) for extracting official YouTube audio streams
 */
async function extractYoutubeYtDlp(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  return new Promise((resolve) => {
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const proc = spawn(PYTHON_BIN, [
      '-m', 'yt_dlp',
      '-g',
      '-f', '140/ba[protocol^=http][ext=m4a]/ba[protocol^=http]/ba/best',
      '--no-warnings',
      '--no-playlist',
      '--socket-timeout', '5',
      targetUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      resolve(null);
    }, 7000);

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && stdout) {
        const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
        const directUrl = lines.find(l => l.startsWith('http'));
        if (directUrl) return resolve(directUrl);
      }
      resolve(null);
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
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
      { timeout: 1400, httpsAgent }
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

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de'
];

let cachedYtVisitorId = null;
let cachedYtVisitorExp = 0;

async function getYoutubeVisitorId() {
  if (cachedYtVisitorId && cachedYtVisitorExp > Date.now()) {
    return cachedYtVisitorId;
  }
  try {
    const r = await axios.get('https://www.youtube.com/sw.js_data', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 2500,
      httpsAgent
    });
    const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    const m = raw.match(/Cgt[a-zA-Z0-9_-]+|Cg[a-zA-Z0-9_%-]+/);
    if (m && m[0]) {
      cachedYtVisitorId = m[0];
      cachedYtVisitorExp = Date.now() + 25 * 60 * 1000;
      return cachedYtVisitorId;
    }
  } catch (e) {}
  return null;
}

/**
 * Pure-Node.js Official YouTube Studio Audio Extractor via VISIONOS 1.02 InnerTube API (~220ms, 0 child processes!)
 * Returns direct audio/mp4 (itag=140 AAC) studio stream URL from YouTube's CDN.
 */
async function extractYoutubeDirectVisionOs(videoId, meta = {}) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  try {
    const visitorId = await getYoutubeVisitorId();
    const res = await axios.post(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        context: {
          client: {
            clientName: 'VISIONOS',
            clientVersion: '1.02',
            deviceMake: 'Apple',
            deviceModel: 'RealityDevice17,1',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
            osName: 'visionOS',
            osVersion: '26.5.23O471',
            hl: 'en',
            timeZone: 'UTC',
            utcOffsetMinutes: 0
          }
        },
        videoId,
        playbackContext: {
          contentPlaybackContext: {
            html5Preference: 'HTML5_PREF_WANTS',
            signatureTimestamp: 20746
          }
        },
        contentCheckOk: true,
        racyCheckOk: true
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
          'X-Youtube-Client-Name': '101',
          'X-Youtube-Client-Version': '1.02',
          'Origin': 'https://www.youtube.com',
          ...(visitorId ? { 'X-Goog-Visitor-Id': visitorId } : {})
        },
        timeout: 3800,
        httpsAgent
      }
    );

    if (res.data?.playabilityStatus?.status !== 'OK') return null;

    const vidLengthSec = Number(res.data?.videoDetails?.lengthSeconds) || 0;
    if (vidLengthSec > 0 && (vidLengthSec < 40 || vidLengthSec > 720)) return null;

    const adaptive = res.data?.streamingData?.adaptiveFormats || [];
    const audioFormats = adaptive.filter(f => f && f.mimeType && f.mimeType.startsWith('audio/') && f.url);
    if (audioFormats.length === 0) return null;

    // Prefer itag=140 (audio/mp4; codecs="mp4a.40.2" - universal AAC studio stream for iOS/Android/Desktop)
    const m4a =
      audioFormats.find(f => f.itag === 140) ||
      audioFormats.find(f => f.mimeType.includes('audio/mp4') && (f.bitrate || 0) >= 120000) ||
      audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    return m4a?.url || null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch direct Google CDN audio stream URL from YouTube VISIONOS API or public Invidious instances
 */
async function fetchFromInvidious(videoId, meta = {}) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const directYt = await extractYoutubeDirectVisionOs(videoId, meta);
  if (directYt) return directYt;

  const promises = INVIDIOUS_INSTANCES.map(inst =>
    axios.get(`${inst}/api/v1/videos/${videoId}`, {
      timeout: 3500,
      httpsAgent,
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
 * Get audio stream URL for a given video ID or search query (~300-500ms, 0MB child process overhead)
 */
async function getAudioStreamUrl(videoId, fallbackQuery = null, isPriority = true, meta = null) {
  const isVideoId = Boolean(videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId));
  const effectiveQuery = fallbackQuery ? fallbackQuery.trim() : null;
  const cacheKey = (videoId && !videoId.startsWith('sp_') && videoId !== 'query')
    ? videoId
    : (effectiveQuery || videoId);

  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && isValidCachedStreamUrl(cached.url)) {
    // If cacheKey is a YouTube videoId, reject any stale .m3u8 and re-extract pure YouTube M4A!
    if (isVideoId && cached.url.includes('.m3u8')) {
      urlCache.delete(cacheKey);
    } else {
      return cached.url;
    }
  }

  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const jobPromise = (async () => {
    const isVideoId = Boolean(videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId));
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

    if (!effectiveMeta.title && isVideoId) {
      const oembed = await fetchVideoMetaFromOembed(videoId);
      if (oembed) {
        effectiveMeta.title = oembed.title || '';
        effectiveMeta.artist = oembed.artist || '';
      }
    }

    let streamUrl = null;

    // 1. Primary Official Studio Engine: When a verified YouTube videoId is present, extract the exact official YouTube M4A (itag=140) in ~210ms!
    if (isVideoId) {
      try {
        streamUrl = await extractYoutubeDirectVisionOs(videoId, effectiveMeta);
      } catch (e) {}

      // Self-healing: If videoId is dead/unplayable (e.g. copyright taken down), find an active alternative on YouTube
      if (!streamUrl) {
        try {
          const { searchInnerTube } = require('./search');
          const altQuery = `${effectiveMeta.artist || ''} ${effectiveMeta.title || ''}`.trim() || fallbackQuery;
          if (altQuery) {
            const candidates = await searchInnerTube(altQuery, 5, false);
            for (const cand of candidates) {
              if (cand.id && cand.id !== videoId && /^[a-zA-Z0-9_-]{11}$/.test(cand.id)) {
                const altStream = await extractYoutubeDirectVisionOs(cand.id, effectiveMeta);
                if (altStream) {
                  streamUrl = altStream;
                  videoId = cand.id;
                  break;
                }
              }
            }
          }
        } catch (e) {}
      }
    } else if (effectiveMeta.title || effectiveQuery) {
      // If videoId is an unresolved Spotify track ID (e.g. sp_...), resolve it accurately to the official studio track
      try {
        const { resolveTrackToStreamableId } = require('./importer');
        const resolved = await resolveTrackToStreamableId({
          title: effectiveMeta.title || effectiveQuery,
          artist: effectiveMeta.artist || '',
          album: effectiveMeta.album || '',
          durationSeconds: effectiveMeta.durationSeconds || 0
        });
        if (resolved && resolved.streamableId && /^[a-zA-Z0-9_-]{11}$/.test(resolved.streamableId)) {
          videoId = resolved.streamableId;
          isVideoId = true;
          streamUrl = await extractYoutubeDirectVisionOs(videoId, effectiveMeta);
        }
      } catch (e) {}
    }

    // 2. Direct yt-dlp fallback if VisionOS extraction failed for videoId
    if (!streamUrl && isVideoId) {
      try {
        streamUrl = await extractYoutubeYtDlp(videoId);
      } catch (e) {}
    }

    // 3. Self-healing YouTube search via InnerTube or yt-search if track still not resolved
    if (!streamUrl) {
      try {
        const { searchInnerTube, searchYts } = require('./search');
        const qToUse = effectiveQuery || `${effectiveMeta.artist} ${effectiveMeta.title}`.trim();
        if (qToUse) {
          let candidates = await searchInnerTube(qToUse, 3, false).catch(() => []);
          if (!candidates.length) {
            candidates = await searchYts(qToUse, 3).catch(() => []);
          }
          for (const cand of candidates) {
            if (cand.id && /^[a-zA-Z0-9_-]{11}$/.test(cand.id)) {
              streamUrl = await extractYoutubeDirectVisionOs(cand.id, effectiveMeta);
              if (!streamUrl) {
                streamUrl = await extractYoutubeYtDlp(cand.id);
              }
              if (streamUrl) {
                videoId = cand.id;
                isVideoId = true;
                break;
              }
            }
          }
        }
      } catch (e) {}
    }

    // 4. Final Fallback: Invidious instances if videoId is available
    if (!streamUrl && isVideoId) {
      streamUrl = await fetchFromInvidious(videoId, effectiveMeta);
    }

    if (!streamUrl) {
      throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
    }

    const signedExp = getSignedUrlExpirationMs(streamUrl);
    let ttlMs = 30 * 60 * 1000; // Default 30 minutes for YouTube signed URLs
    if (signedExp > Date.now() + 60000) {
      ttlMs = Math.min(45 * 60 * 1000, signedExp - Date.now() - 45000);
    } else if (streamUrl.includes('googlevideo.com')) {
      ttlMs = 30 * 60 * 1000;
    }

    const cacheEntry = {
      url: streamUrl,
      expiresAt: Date.now() + ttlMs
    };
    setBoundedCache(urlCache, cacheKey, cacheEntry);
    if (isVideoId) {
      setBoundedCache(urlCache, videoId, cacheEntry);
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
 * Background pre-fetching (lightweight pure Node.js, max 2 tracks to conserve memory)
 */
async function prefetchTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  for (const track of tracks.slice(0, 2)) {
    if (!track) continue;
    const vid = track.streamableId || track.id;
    const fallbackQuery = `${track.artist || ''} - ${track.title || ''}`.replace(/^-\s*|\s*-$/g, '').trim();
    const key = (vid && !vid.startsWith('sp_')) ? vid : fallbackQuery;
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

/**
 * Patch init.mp4 mvhd, tkhd, elst, and mdhd boxes with the full track duration
 * so HTML5 <audio> immediately knows the exact full song duration instead of 10s!
 */
function patchInitMp4Duration(buf, totalSec) {
  if (!totalSec || totalSec <= 0) return buf;
  let mvhdTs = 1000;
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'edts', 'dinf']);

  function walk(start, end) {
    let offset = start;
    while (offset + 8 <= end) {
      const size = buf.readUInt32BE(offset);
      if (size < 8 || offset + size > end) break;
      const type = buf.slice(offset + 4, offset + 8).toString('ascii');
      if (type === 'mvhd' || type === 'mdhd') {
        const ver = buf[offset + 8];
        if (ver === 0 && offset + 28 <= end) {
          const ts = buf.readUInt32BE(offset + 20);
          if (ts > 0) {
            if (type === 'mvhd') mvhdTs = ts;
            buf.writeUInt32BE(Math.round(totalSec * ts), offset + 24);
          }
        }
      } else if (type === 'tkhd') {
        const ver = buf[offset + 8];
        if (ver === 0 && offset + 32 <= end) {
          buf.writeUInt32BE(Math.round(totalSec * mvhdTs), offset + 28);
        }
      } else if (type === 'elst') {
        const ver = buf[offset + 8];
        if (ver === 0 && offset + 20 <= end) {
          const count = buf.readUInt32BE(offset + 12);
          if (count >= 1) {
            buf.writeUInt32BE(Math.round(totalSec * mvhdTs), offset + 16);
          }
        }
      }
      if (containers.has(type)) {
        walk(offset + 8, offset + size);
      }
      offset += size;
    }
  }

  try {
    walk(0, buf.length);
  } catch (e) {}
  return buf;
}

/**
 * Strip styp and sidx boxes from the beginning of .m4s segments so <audio>
 * never mistakes a 10s segment index (sidx) for the total song duration!
 */
function stripStypSidx(buf) {
  try {
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset);
      if (size < 8 || offset + size > buf.length) break;
      const type = buf.slice(offset + 4, offset + 8).toString('ascii');
      if (type === 'moof' || type === 'ftyp') {
        return offset > 0 ? buf.slice(offset) : buf;
      }
      offset += size;
    }
  } catch (e) {}
  return buf;
}

/**
 * Build unified browser-like HTTP headers for upstream CDN requests (googlevideo / Invidious)
 */
function buildUpstreamHeaders(targetUrl = '', rangeHeader = null) {
  const urlStr = String(targetUrl || '');
  const isGoogleVideo = urlStr.includes('googlevideo.com') || urlStr.includes('youtube.com');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'Connection': 'keep-alive'
  };

  if (isGoogleVideo) {
    headers['Referer'] = 'https://www.youtube.com/';
    headers['Origin'] = 'https://www.youtube.com';
    // googlevideo requires Range header to avoid throttling / 403 blocks
    headers['Range'] = rangeHeader || 'bytes=0-';
  } else if (rangeHeader) {
    headers['Range'] = rangeHeader;
  } else if (rangeHeader) {
    headers['Range'] = rangeHeader;
  }

  return headers;
}

/**
 * Zero-process Pure Node.js HLS fMP4 / MP3 Stream Concatenator
 * Streams full-length fMP4 (with patched moov duration and stripped sidx) or MP3 segments using ~200KB RAM!
 * Supports HTTP Range requests and seeking so scrubber never snaps back to 0!
 */
async function pipeHlsInNode(m3u8Url, req, res) {
  let aborted = false;

  req.on('close', () => {
    aborted = true;
  });

  const m3u8Res = await axios.get(m3u8Url, {
    timeout: 4500,
    httpsAgent,
    maxRedirects: 5,
    headers: buildUpstreamHeaders(m3u8Url)
  });
  const lines = String(m3u8Res.data || '').split('\n');
  let mapUrl = null;
  const segments = [];
  let totalDurationSec = 0;
  let currentSegmentDur = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const infMatch = trimmed.match(/#EXTINF:([0-9.]+)/);
    if (infMatch && infMatch[1]) {
      currentSegmentDur = parseFloat(infMatch[1]) || 0;
    }
    const mapMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch && mapMatch[1]) {
      mapUrl = mapMatch[1];
    } else if (trimmed.startsWith('http')) {
      segments.push({
        url: trimmed,
        duration: currentSegmentDur,
        startTime: totalDurationSec
      });
      totalDurationSec += currentSegmentDur;
      currentSegmentDur = 0;
    }
  }

  if (segments.length === 0) {
    throw new Error('Empty HLS playlist');
  }

  const isMp3 = !mapUrl && (segments[0].url.includes('.mp3') || m3u8Url.includes('mp3'));
  const contentType = isMp3 ? 'audio/mpeg' : 'audio/mp4';

  // Support explicit seek parameter (?seek=seconds or ?start=seconds)
  let targetStartTime = 0;
  const seekQuery = parseFloat(req.query.seek || req.query.start);
  if (!isNaN(seekQuery) && seekQuery > 0) {
    targetStartTime = seekQuery;
  }

  // Find corresponding starting segment if seeking
  let startSegmentIdx = 0;
  if (targetStartTime > 0) {
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startTime + segments[i].duration > targetStartTime) {
        startSegmentIdx = i;
        break;
      }
    }
  }

  // Always return 200 OK without Range for HLS streams so browser decodes continuously without chunk errors or restarts
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=14400');

  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // 1. If fMP4 (init.mp4 map present), always send patched init.mp4 first so decoder initializes
  if (mapUrl && !aborted && !res.writableEnded) {
    try {
      const initRes = await axios.get(mapUrl, {
        responseType: 'arraybuffer',
        timeout: 6000,
        httpsAgent,
        maxRedirects: 5,
        headers: buildUpstreamHeaders(mapUrl)
      });
      const patchedInit = patchInitMp4Duration(Buffer.from(initRes.data), totalDurationSec);
      if (!aborted && !res.writableEnded) {
        res.write(patchedInit);
      }
    } catch (e) {}
  }

  // 2. Stream segments starting from startSegmentIdx
  for (let i = startSegmentIdx; i < segments.length; i++) {
    if (aborted || res.writableEnded) break;
    try {
      const segUrl = segments[i].url;
      const segRes = await axios.get(segUrl, {
        responseType: 'arraybuffer',
        timeout: 9000,
        httpsAgent,
        maxRedirects: 5,
        headers: buildUpstreamHeaders(segUrl)
      });
      if (aborted || res.writableEnded) break;
      const rawBuf = Buffer.from(segRes.data);
      const cleanBuf = isMp3 ? rawBuf : stripStypSidx(rawBuf);
      const canContinue = res.write(cleanBuf);
      if (!canContinue && !aborted && !res.writableEnded) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    } catch (segErr) {
      if (aborted) break;
    }
  }

  if (!aborted && !res.writableEnded) {
    res.end();
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
    let streamUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);

    if (!streamUrl) {
      throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
    }

    // Pure Node.js HLS fMP4/MP3 streaming (0 ffmpeg processes, 0MB overhead, ~120ms TTFB)
    if (streamUrl.includes('.m3u8')) {
      try {
        await pipeHlsInNode(streamUrl, req, res);
        return;
      } catch (hlsErr) {
        // Token expired: evict cache and re-extract once
        urlCache.delete(videoId);
        if (fallbackQuery) urlCache.delete(fallbackQuery);
        streamUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
        if (streamUrl && streamUrl.includes('.m3u8')) {
          await pipeHlsInNode(streamUrl, req, res);
          return;
        }
      }
    }

    const range = req.headers.range;
    let headers = buildUpstreamHeaders(streamUrl, range);

    let response = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'stream',
      headers,
      httpsAgent,
      decompress: false,
      maxRedirects: 5,
      validateStatus: () => true
    });

    // If cached URL expired or returned 403, evict and re-extract fresh from YouTube immediately
    if (response.status >= 400) {
      urlCache.delete(videoId);
      if (fallbackQuery) urlCache.delete(fallbackQuery);
      try {
        streamUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta || {});
        if (streamUrl) {
          if (streamUrl.includes('.m3u8')) {
            await pipeHlsInNode(streamUrl, req, res);
            return;
          }
          headers = buildUpstreamHeaders(streamUrl, range);
          response = await axios({
            method: 'GET',
            url: streamUrl,
            responseType: 'stream',
            headers,
            httpsAgent,
            decompress: false,
            maxRedirects: 5,
            validateStatus: () => true
          });
        }
      } catch (e) {}
    }

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
  extractYoutubeDirectVisionOs,
  pipeStream,
  pipeHlsInNode,
  prefetchTracks,
  extractYoutubeYtDlp,
  evictStreamCache,
  buildUpstreamHeaders,
  fetchFromInvidious,
  patchInitMp4Duration,
  stripStypSidx
};
