const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { searchTracks, getTrendingTracks, getHomeCatalog } = require('../services/search');
const { getAudioStreamUrl, pipeStream } = require('../services/stream');
const { pipeOfflineDownload } = require('../services/offlineDownloader');
const { getLyrics } = require('../services/lyrics');
const { universalImport, resolveTrackToStreamableId } = require('../services/importer');
const { setRegisteredTunnel, getRegisteredTunnel } = require('../services/tunnelState');

/**
 * Health check under /api
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'SpotiFree Server',
    version: '1.0.0',
    activeTunnel: null
  });
});

/**
 * Register active dynamic tunnel (called by local PC server)
 */
router.post('/tunnel/register', (req, res) => {
  const { tunnelUrl } = req.body;
  if (tunnelUrl && typeof tunnelUrl === 'string') {
    setRegisteredTunnel(tunnelUrl);
    console.log(`[API] Dynamic tunnel registered: ${tunnelUrl}`);
    return res.json({ ok: true, tunnelUrl });
  }
  res.status(400).json({ error: 'tunnelUrl string is required' });
});

/**
 * Get active dynamic tunnel (called by mobile/web clients)
 */
router.get('/tunnel/active', (req, res) => {
  const tunnel = getRegisteredTunnel();
  res.json({
    tunnelUrl: tunnel.url || null,
    isAlive: tunnel.isFresh,
    registeredAt: tunnel.lastHeartbeat
  });
});

/**
 * Search tracks
 */
router.get('/search', async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  try {
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 60));
    const tracks = await searchTracks(q, limit);
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
    const catalog = await getHomeCatalog();
    res.json({ tracks: catalog.tracks || [], sections: catalog.sections || [] }); // trending

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get stream URL directly
 */
router.get('/stream/:id', async (req, res) => {
  const { id } = req.params;
  const fallbackQuery = req.query.q || null;
  const meta = {
    durationSeconds: Number(req.query.dur) || 0,
    title: req.query.title || '',
    artist: req.query.artist || '',
    album: req.query.album || ''
  };
  try {
    const streamUrl = await getAudioStreamUrl(id, fallbackQuery, true, meta);
    res.json({ streamUrl, proxyUrl: `/api/stream/pipe/${id}${fallbackQuery ? `?q=${encodeURIComponent(fallbackQuery)}` : ''}` });
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
  const meta = {
    durationSeconds: Number(req.query.dur) || 0,
    title: req.query.title || '',
    artist: req.query.artist || '',
    album: req.query.album || ''
  };
  pipeStream(id, req, res, fallbackQuery, meta);
});

/**
 * Dedicated offline download endpoint (multi-query fallbacks)
 */
router.get('/offline/download/:id', (req, res) => {
  const meta = {
    durationSeconds: Number(req.query.dur) || 0,
    title: req.query.title || '',
    artist: req.query.artist || '',
    album: req.query.album || ''
  };
  pipeOfflineDownload(req.params.id, req, res, req.query.q || null, meta);
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
