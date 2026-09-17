const { spawn } = require('child_process');
const axios = require('axios');

// In-memory cache for stream URLs (valid for ~4-6 hours)
const urlCache = new Map();

/**
 * Extract audio stream URL for a given YouTube video ID
 */
function getAudioStreamUrl(videoId) {
  return new Promise((resolve, reject) => {
    // Check cache
    const cached = urlCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      return resolve(cached.url);
    }

    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pyProcess = spawn('python', [
      '-m', 'yt_dlp',
      '-f', 'ba/b[height<=480]/best',
      '--get-url',
      '--no-playlist',
      targetUrl
    ]);

    let output = '';
    let errorOutput = '';

    pyProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    pyProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`yt-dlp error for ${videoId}:`, errorOutput);
        return reject(new Error(`Failed to extract stream: ${errorOutput}`));
      }

      const streamUrl = output.trim().split('\n')[0];
      if (!streamUrl || !streamUrl.startsWith('http')) {
        return reject(new Error('Invalid stream URL returned'));
      }

      // Cache for 3 hours
      urlCache.set(videoId, {
        url: streamUrl,
        expiresAt: Date.now() + 3 * 60 * 60 * 1000
      });

      resolve(streamUrl);
    });

    pyProcess.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Proxy stream to handle HTTP Range requests smoothly
 */
async function pipeStream(videoId, req, res) {
  try {
    const streamUrl = await getAudioStreamUrl(videoId);
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
      // Pass audio content headers to client
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
      res.status(500).json({ error: 'Failed to stream audio' });
    }
  }
}

module.exports = {
  getAudioStreamUrl,
  pipeStream
};
