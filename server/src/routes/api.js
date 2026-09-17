const express = require('express');
const router = express.Router();
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
 * Resolve track (e.g. Spotify track) to streamable YouTube ID
 */
router.post('/resolve', async (req, res) => {
  const { track } = req.body;
  if (!track) {
    return res.status(400).json({ error: 'Track object is required' });
  }

  try {
    const streamableId = await resolveTrackToStreamableId(track);
    res.json({ streamableId });
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
