const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { searchTracks, getTrendingTracks } = require('../services/search');
const { getAudioStreamUrl, pipeStream } = require('../services/stream');
const { getLyrics } = require('../services/lyrics');
const { universalImport, resolveTrackToStreamableId } = require('../services/importer');

/**
 * Search tracks
 */
router.get('/search', async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  try {
    const tracks = await searchTracks(q);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get trending tracks
 */
router.get('/trending', async (req, res) => {
  try {
    const tracks = await getTrendingTracks();
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug-extract', async (req, res) => {
  const { exec } = require('child_process');
  const fs = require('fs');
  const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const targetId = req.query.id || 'kJQP7kiw5Fk';
  
  const cookieCandidates = [
    path.join(__dirname, '../../cookies.txt'),
    path.join(process.cwd(), 'server/cookies.txt'),
    path.join(process.cwd(), 'cookies.txt'),
    path.join(__dirname, '../cookies.txt'),
    process.env.COOKIE_FILE,
    '/etc/secrets/cookies.txt'
  ].filter(Boolean);

  let existingCookies = [];
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
  // If the query specifies ?force_repo=1 or ?file=..., use that.
  let selected = existingCookies.find(c => !c.path.includes('/etc/secrets')) || existingCookies[0] || null;
  if (req.query.file && fs.existsSync(req.query.file)) {
    selected = { path: req.query.file, size: fs.statSync(req.query.file).size };
  }

  const foundCookie = selected ? selected.path : null;
  const cookieSize = selected ? selected.size : 0;

  let cookieFlag = '';
  if (foundCookie && !req.query.no_cookie) {
    try {
      const targetCp = process.platform === 'win32' ? path.join(process.env.TEMP || '.', 'cookies.txt') : '/tmp/cookies.txt';
      const raw = fs.readFileSync(foundCookie, 'utf8');
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
      fs.writeFileSync(targetCp, clean.join(''), 'utf8');
      cookieFlag = `--cookies "${targetCp}"`;
    } catch (e) {
      cookieFlag = `--cookies "${foundCookie}"`;
    }
  }
  const uaFlag = req.query.ua ? `--user-agent "${req.query.ua}"` : '';
  const extraFlags = req.query.extra ? req.query.extra : '';
  exec(`${PYTHON_BIN} -m yt_dlp --version`, (err1, vOut) => {
    exec(`${PYTHON_BIN} -m yt_dlp --get-url -f 140/ba ${cookieFlag} ${extraFlags} ${uaFlag} https://www.youtube.com/watch?v=${targetId}`, (err2, stdout, stderr) => {
      let cookiePreview = null;
      if (foundCookie) {
        try {
          cookiePreview = fs.readFileSync(foundCookie, 'utf8').slice(0, 300);
        } catch (e) {
          cookiePreview = e.message;
        }
      }
      res.json({
        deployVersion: 'cookie-fix-v2',
        pythonBin: PYTHON_BIN,
        foundCookie,
        cookieSize,
        allCandidates: existingCookies,
        cookiePreview,
        version: vOut ? vOut.trim() : (err1?.message || 'failed'),
        stdout: stdout ? stdout.trim() : null,
        stderr: stderr ? stderr.trim() : null,
        error: err2 ? err2.message : null
      });
    });
  });
});

/**
 * Get stream URL directly
 */
router.get('/stream/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const streamUrl = await getAudioStreamUrl(id);
    res.json({ streamUrl, proxyUrl: `/api/stream/pipe/${id}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Pipe audio stream with HTTP Range requests support
 */
router.get('/stream/pipe/:id', (req, res) => {
  const { id } = req.params;
  const fallbackQuery = req.query.q || null;
  pipeStream(id, req, res, fallbackQuery);
});

/**
 * Prefetch stream URLs in the background for instant playback of next tracks
 */
router.post('/stream/prefetch', (req, res) => {
  const { tracks } = req.body;
  if (Array.isArray(tracks)) {
    const { prefetchTracks } = require('../services/stream');
    prefetchTracks(tracks);
  }
  res.json({ ok: true });
});

/**
 * Resolve track (e.g. Spotify track) to streamable YouTube ID
 */
router.post('/resolve', async (req, res) => {
  const { track } = req.body;
  if (!track) {
    return res.status(400).json({ error: 'Track object is required' });
  }

  try {
    const resolved = await resolveTrackToStreamableId(track);
    res.json(resolved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Import playlist from Spotify or YouTube URL
 */
router.post('/import', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const playlist = await universalImport(url);
    res.json({ playlist });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Get synced lyrics
 */
router.get('/lyrics', async (req, res) => {
  const { track, artist, duration } = req.query;
  if (!track || !artist) {
    return res.status(400).json({ error: 'track and artist query params are required' });
  }

  try {
    const lyricsData = await getLyrics(track, artist, duration ? parseFloat(duration) : null);
    res.json(lyricsData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
