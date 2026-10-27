const axios = require('axios');
const https = require('https');
const { spawn, execSync } = require('child_process');
const {
  getAudioStreamUrl,
  evictStreamCache,
  buildUpstreamHeaders,
  fetchFromInvidious,
  extractYoutubeYtDlp,
  patchInitMp4Duration,
  stripStypSidx
} = require('./stream');

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });

let cachedFfmpegAvailable = null;

function isFfmpegAvailable() {
  if (cachedFfmpegAvailable !== null) return cachedFfmpegAvailable;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    cachedFfmpegAvailable = true;
  } catch (e) {
    cachedFfmpegAvailable = false;
  }
  return cachedFfmpegAvailable;
}

/**
 * Robust offline stream URL finder: Pure YouTube (VisionOS InnerTube / yt-dlp / Invidious)
 */
async function findOfflineStreamUrl(videoId, fallbackQuery, meta = {}, forceFresh = false) {
  if (forceFresh && typeof evictStreamCache === 'function') {
    evictStreamCache(videoId, fallbackQuery);
  }

  // 1. Primary: Unified YouTube Stream Engine (VisionOS InnerTube / self-healing)
  try {
    const primaryUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
    if (primaryUrl) return primaryUrl;
  } catch (e) {}

  // 2. Direct yt-dlp fallback if videoId is a valid 11-char YouTube ID
  const isVideoId = Boolean(videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId));
  if (isVideoId && typeof extractYoutubeYtDlp === 'function') {
    try {
      const ytDlpUrl = await extractYoutubeYtDlp(videoId);
      if (ytDlpUrl) return ytDlpUrl;
    } catch (e) {}
  }

  // 3. Resolve through YouTube search if videoId is missing or unplayable
  const queryToSearch = fallbackQuery || `${meta?.artist || ''} ${meta?.title || ''}`.trim();
  if (queryToSearch) {
    try {
      const { searchInnerTube, searchYts } = require('./search');
      let candidates = await searchInnerTube(queryToSearch, 4, false).catch(() => []);
      if (!candidates || candidates.length === 0) {
        candidates = await searchYts(queryToSearch, 4).catch(() => []);
      }
      for (const cand of candidates) {
        if (cand && cand.id && /^[a-zA-Z0-9_-]{11}$/.test(cand.id)) {
          try {
            const stream = await getAudioStreamUrl(cand.id, null, true, meta);
            if (stream) return stream;
          } catch (e) {}
          if (typeof extractYoutubeYtDlp === 'function') {
            try {
              const stream = await extractYoutubeYtDlp(cand.id);
              if (stream) return stream;
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }

  // 4. Invidious fallback for valid videoId
  if (isVideoId && typeof fetchFromInvidious === 'function') {
    try {
      const invUrl = await fetchFromInvidious(videoId, meta);
      if (invUrl) return invUrl;
    } catch (e) {}
  }

  throw new Error('לא נמצא מקור שמע זמין מיוטיוב להורדה');
}

async function fetchSegmentWithRetry(segUrl) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const segRes = await axios.get(segUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        httpsAgent,
        maxRedirects: 5,
        headers: buildUpstreamHeaders(segUrl)
      });
      return Buffer.from(segRes.data);
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 300));
    }
  }
}

function detectAudioMime(buf) {
  if (!buf || buf.length < 4) return null;
  // MP4 / M4A: bytes 4..7 are 'ftyp'
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return 'audio/mp4';
  }
  // MP3 ID3 header: 'ID3' (0x49, 0x44, 0x33)
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return 'audio/mpeg';
  }
  // MP3 raw frame sync: 0xFF followed by bits 111 (0xE0)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) {
    return 'audio/mpeg';
  }
  // OGG: 'OggS'
  if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return 'audio/ogg';
  }
  return null;
}

/**
 * HLS unpacker / converter with fallback
 */
async function pipeHlsDownload(m3u8Url, req, res) {
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  if (isFfmpegAvailable()) {
    try {
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
      const headers = `User-Agent: ${userAgent}\r\nAccept: */*\r\n`;
      const args = [
        '-y',
        '-headers', headers,
        '-i', m3u8Url,
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        '-f', 'mp3',
        'pipe:1'
      ];
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let killed = false;
      let totalBytesOut = 0;
      let bufferedChunks = [];
      const PRE_FLUSH_THRESHOLD = 50 * 1024;

      const cleanup = () => {
        if (!killed) {
          killed = true;
          try { proc.kill('SIGKILL'); } catch (e) {}
        }
      };

      req.on('close', cleanup);

      const ffmpegDone = await new Promise((resolve) => {
        proc.stdout.on('data', (chunk) => {
          totalBytesOut += chunk.length;

          if (!res.headersSent) {
            bufferedChunks.push(chunk);
            if (totalBytesOut >= PRE_FLUSH_THRESHOLD) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Accept-Ranges', 'bytes');
              res.setHeader('Cache-Control', 'no-store');
              if (typeof res.flushHeaders === 'function') res.flushHeaders();

              for (const b of bufferedChunks) {
                if (!res.writableEnded) res.write(b);
              }
              bufferedChunks = null;
            }
          } else if (!res.writableEnded) {
            const ok = res.write(chunk);
            if (!ok) {
              proc.stdout.pause();
              res.once('drain', () => {
                if (!killed) proc.stdout.resume();
              });
            }
          }
        });

        proc.stderr.on('data', () => {});

        proc.on('error', () => {
          cleanup();
          resolve(false);
        });

        proc.on('close', (code) => {
          req.removeListener('close', cleanup);
          if (code === 0 && totalBytesOut >= PRE_FLUSH_THRESHOLD) {
            if (!res.headersSent) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Accept-Ranges', 'bytes');
              res.setHeader('Cache-Control', 'no-store');
              if (typeof res.flushHeaders === 'function') res.flushHeaders();
              if (bufferedChunks) {
                for (const b of bufferedChunks) {
                  if (!res.writableEnded) res.write(b);
                }
                bufferedChunks = null;
              }
            }
            if (!res.writableEnded) res.end();
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });

      if (ffmpegDone) {
        return;
      }

      console.warn(`[OfflineDownloader] ffmpeg produced insufficient data (${totalBytesOut} bytes), falling back to Node.js segment unpacker...`);
    } catch (e) {
      console.warn('[OfflineDownloader] ffmpeg remux fallback:', e.message);
    }
  }

  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }

  const m3u8Res = await axios.get(m3u8Url, {
    timeout: 6000,
    httpsAgent,
    maxRedirects: 5,
    headers: buildUpstreamHeaders(m3u8Url)
  });
  const lines = String(m3u8Res.data || '').split('\n');
  let mapUrl = null;
  const mediaUrls = [];
  let totalDurationSec = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const infMatch = trimmed.match(/#EXTINF:([0-9.]+)/);
    if (infMatch && infMatch[1]) {
      totalDurationSec += parseFloat(infMatch[1]) || 0;
    }
    const mapMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch && mapMatch[1]) {
      mapUrl = mapMatch[1];
    } else if (trimmed.startsWith('http')) {
      mediaUrls.push(trimmed);
    }
  }

  if (mediaUrls.length === 0) {
    throw new Error('Empty HLS playlist');
  }

  let firstBuf = null;
  let detectedType = null;

  if (mapUrl && !aborted && !res.writableEnded) {
    const initBuf = await fetchSegmentWithRetry(mapUrl);
    detectedType = detectAudioMime(initBuf) || 'audio/mp4';
    const isMp3 = detectedType === 'audio/mpeg';
    res.statusCode = 200;
    res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const patchedInit = isMp3 ? initBuf : patchInitMp4Duration(initBuf, totalDurationSec);
    if (!aborted && !res.writableEnded) {
      res.write(patchedInit);
    }
  } else if (mediaUrls.length > 0 && !aborted && !res.writableEnded) {
    firstBuf = await fetchSegmentWithRetry(mediaUrls[0]);
    detectedType = detectAudioMime(firstBuf);
    const isMp3 = detectedType === 'audio/mpeg' || mediaUrls[0].includes('.mp3') || m3u8Url.includes('mp3');
    res.statusCode = 200;
    res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    if (firstBuf && !aborted && !res.writableEnded) {
      const cleanFirst = isMp3 ? firstBuf : stripStypSidx(firstBuf);
      res.write(cleanFirst);
    }
  }

  const isMp3Stream = (res.getHeader('Content-Type') || '').includes('mpeg');

  const BATCH_SIZE = 4;
  const startIndex = firstBuf ? 1 : 0;
  for (let i = startIndex; i < mediaUrls.length; i += BATCH_SIZE) {
    if (aborted || res.writableEnded) break;
    const batchUrls = mediaUrls.slice(i, i + BATCH_SIZE);
    const buffers = await Promise.all(batchUrls.map(u => fetchSegmentWithRetry(u)));

    for (const rawBuf of buffers) {
      if (aborted || res.writableEnded || !rawBuf) break;
      const cleanBuf = isMp3Stream ? rawBuf : stripStypSidx(rawBuf);
      const canContinue = res.write(cleanBuf);
      if (!canContinue && !aborted && !res.writableEnded) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
  }

  if (!aborted && !res.writableEnded) {
    res.end();
  }
}

/**
 * Dedicated Offline Download Stream Handler (Pure YouTube)
 */
async function pipeOfflineDownload(videoId, req, res, fallbackQuery = null, meta = null) {
  let upstreamStream = null;
  req.on('close', () => {
    if (upstreamStream && typeof upstreamStream.destroy === 'function') {
      upstreamStream.destroy();
    }
  });

  const tryStreamUrl = async (streamUrl) => {
    if (streamUrl.includes('.m3u8')) {
      await pipeHlsDownload(streamUrl, req, res);
      return true;
    }

    const range = req.headers?.range || null;
    const headers = buildUpstreamHeaders(streamUrl, range);

    const response = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'stream',
      timeout: 18000,
      httpsAgent,
      decompress: false,
      maxRedirects: 5,
      headers,
      validateStatus: () => true
    });

    if (response.status >= 200 && response.status < 400) {
      upstreamStream = response.data;
      res.statusCode = range && response.status === 206 ? 206 : 200;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');

      for (const [key, value] of Object.entries(response.headers)) {
        const lower = key.toLowerCase();
        if (['content-length', 'content-range'].includes(lower)) {
          res.setHeader(lower, value);
        }
      }

      let firstChunkHandled = false;
      const onFirstChunk = (chunk) => {
        if (firstChunkHandled) return;
        firstChunkHandled = true;
        const detected = detectAudioMime(chunk);
        const upstreamCt = String(response.headers['content-type'] || '').toLowerCase();
        let finalCt = detected;
        if (!finalCt) {
          if (upstreamCt.includes('mpeg') || upstreamCt.includes('mp3')) {
            finalCt = 'audio/mpeg';
          } else {
            finalCt = 'audio/mp4';
          }
        }
        res.setHeader('Content-Type', finalCt);
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        res.write(chunk);
        response.data.pipe(res);
      };

      response.data.once('data', onFirstChunk);
      response.data.once('error', () => {
        if (!res.headersSent) res.statusCode = 502;
        res.end();
      });
      return true;
    }

    if (response.data && typeof response.data.destroy === 'function') {
      response.data.destroy();
    }
    throw new Error(`Upstream status ${response.status}`);
  };

  try {
    let streamUrl = await findOfflineStreamUrl(videoId, fallbackQuery, meta || {}, false);
    if (!streamUrl) {
      throw new Error('No offline stream URL resolved');
    }

    try {
      await tryStreamUrl(streamUrl);
      return;
    } catch (firstErr) {
      if (res.headersSent) throw firstErr;
      if (typeof evictStreamCache === 'function') {
        evictStreamCache(videoId, fallbackQuery);
      }
      const freshUrl = await findOfflineStreamUrl(videoId, fallbackQuery, meta || {}, true);
      if (!freshUrl) throw firstErr;
      await tryStreamUrl(freshUrl);
      return;
    }
  } catch (err) {
    console.error(`[OfflineDownload] Failed for ${videoId} (${meta?.title || fallbackQuery}):`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}

// Compatibility stubs for any legacy callers
function parseTrackMeta(meta = {}, fallbackQuery = '') {
  const title = String(meta?.title || fallbackQuery || '').trim();
  const artist = String(meta?.artist || '').trim();
  return { titles: [title].filter(Boolean), artists: [artist].filter(Boolean) };
}

function scoreOfflineCandidate() {
  return 100;
}

module.exports = {
  findOfflineStreamUrl,
  pipeOfflineDownload,
  scoreOfflineCandidate,
  parseTrackMeta
};
