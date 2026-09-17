const { spawn } = require('child_process');
const axios = require('axios');

// In-memory cache for stream URLs (valid for ~3-4 hours)
const urlCache = new Map();

/**
 * Extract audio stream URL using yt-dlp
 */
function extractStreamWithYtDlp(target) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', 'yt_dlp',
      '-f', 'ba/b[height<=480]/best',
      '--get-url',
      '--no-playlist',
      '--no-warnings',
      '--default-search', 'ytsearch5',
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
 * Get audio stream URL for a given video ID or search query, with optional fallback query
 */
async function getAudioStreamUrl(videoId, fallbackQuery = null) {
  const cacheKey = videoId || fallbackQuery;
  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  let streamUrl = null;

  // 1. Try video ID directly if valid
  const isVideoId = videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId);
  if (isVideoId) {
    try {
      streamUrl = await extractStreamWithYtDlp(`https://www.youtube.com/watch?v=${videoId}`);
    } catch (err) {
      console.warn(`Direct stream for ${videoId} failed (${err.message}). Trying fallback query...`);
    }
  }

  // 2. If direct video failed or wasn't provided, try fallback query or query search
  if (!streamUrl && fallbackQuery) {
    try {
      streamUrl = await extractStreamWithYtDlp(`ytsearch5:${fallbackQuery}`);
    } catch (fallbackErr) {
      console.error(`Fallback query search failed:`, fallbackErr.message);
    }
  }

  // 3. If still no stream and videoId has text
  if (!streamUrl && !isVideoId && videoId) {
    streamUrl = await extractStreamWithYtDlp(`ytsearch5:${videoId}`);
  }

  if (!streamUrl) {
    throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
  }

  // Cache for 3 hours
  urlCache.set(cacheKey, {
    url: streamUrl,
    expiresAt: Date.now() + 3 * 60 * 60 * 1000
  });

  return streamUrl;
}

/**
 * Proxy stream to handle HTTP Range requests smoothly
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
      validateStatus: () => true
    });

    res.status(response.status);
    for (const [key, value] of Object.entries(response.headers)) {
      if (['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

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
  pipeStream
};
