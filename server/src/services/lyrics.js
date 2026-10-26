const axios = require('axios');

// Fast in-memory cache for fetched lyrics (prevents redundant API calls)
const lyricsCache = new Map();
const MAX_LYRICS_CACHE = 500;

const LRCLIB_HEADERS = {
  'User-Agent': 'SpotiFree/2.0 (https://github.com/spotifree)'
};

/**
 * Clean track or artist strings from YouTube/Spotify noise for higher lyrics hit-rate
 */
function cleanText(text = '') {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\((?:official|video|audio|lyrics|lyric|live|remix|remastered|hd|hq|4k|prod\.?[^\)]*|מתוך[^\)]*|קליפ[^\)]*|ליריקס[^\)]*)\)/gi, '')
    .replace(/\[(?:official|video|audio|lyrics|lyric|live|remix|remastered|hd|hq|4k|prod\.?[^\]]*|מתוך[^\]]*|קליפ[^\]]*|ליריקס[^\]]*)\]/gi, '')
    .replace(/\b(?:feat\.?|ft\.?|featuring|prod\.?\s+by)\b.*/gi, '')
    .replace(/(?:\s+עם\s+|\s+מארח את\s+|\s+מארחת את\s+).*/gi, '')
    .replace(/-\s*(?:official\s*(?:music\s*)?video|official\s*audio|קליפ\s*רשמי|הקליפ\s*הרשמי|מילים|ליריקס).*$/gi, '')
    .replace(/[|\/\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate multiple search query candidates for Hebrew/international tracks
 */
function getSearchCandidates(trackName = '', artistName = '') {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (t, a) => {
    const cleanT = cleanText(t);
    const cleanA = cleanText(a)
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/VEVO$/i, '')
      .replace(/Official$/i, '')
      .trim();

    if (!cleanT) return;
    const key = `${cleanT.toLowerCase()}___${cleanA.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ track: cleanT, artist: cleanA });
    }
  };

  const rawTrack = (trackName || '').trim();
  const rawArtist = (artistName || '').trim();

  // If YouTube title contains "Artist - Song" or "Song - Artist", prioritize the separated components
  if (rawTrack.includes(' - ')) {
    const parts = rawTrack.split(' - ').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const p0 = parts[0];
      const p1 = parts.slice(1).join(' - ');

      // If p0 matches artistName, p1 is the track title!
      if (rawArtist && p0.toLowerCase().includes(rawArtist.toLowerCase())) {
        addCandidate(p1, p0);
        addCandidate(p1, rawArtist);
      } else if (rawArtist && p1.toLowerCase().includes(rawArtist.toLowerCase())) {
        addCandidate(p0, p1);
        addCandidate(p0, rawArtist);
      } else {
        // Try both combinations
        addCandidate(p1, p0);
        addCandidate(p0, p1);
        if (rawArtist) {
          addCandidate(p1, rawArtist);
          addCandidate(p0, rawArtist);
        }
      }
    }
  }

  // Next candidate: cleaned trackName with artistName
  addCandidate(cleanText(rawTrack), cleanText(rawArtist));

  // Stripped parentheses / brackets
  const tNoParens = rawTrack.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
  const aNoParens = rawArtist.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').split(/[,&/]/)[0].trim();
  if (tNoParens && tNoParens !== rawTrack) {
    addCandidate(tNoParens, aNoParens || rawArtist);
  }

  return candidates;
}

/**
 * Parse LRC formatted string into array of { time, text } objects
 * Supports [offset:+/-ms] tag and sub-second precision
 */
function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];

  // Parse optional [offset: +/-ms] tag
  let offsetSec = 0;
  const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  if (offsetMatch) {
    const parsedMs = parseInt(offsetMatch[1], 10);
    if (!isNaN(parsedMs)) {
      offsetSec = parsedMs / 1000;
    }
  }

  const lines = lrcText.split('\n');
  const synced = [];
  const timeRegex = /\[(\d{2,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const matches = [...line.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const text = line.replace(timeRegex, '').trim();
    if (!text) continue; // Skip lines that have no lyrics (instrumentals/pauses)

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const msStr = (match[3] || '0').padEnd(3, '0').slice(0, 3);
      const ms = parseInt(msStr, 10);
      const time = Math.max(0, minutes * 60 + seconds + ms / 1000 + offsetSec);

      synced.push({
        time: Math.round(time * 100) / 100,
        text
      });
    }
  }

  // Deduplicate and sort strictly by timestamp
  const seenTimes = new Set();
  const uniqueSynced = [];
  for (const item of synced.sort((a, b) => a.time - b.time)) {
    const key = `${item.time.toFixed(2)}_${item.text}`;
    if (!seenTimes.has(key)) {
      seenTimes.add(key);
      uniqueSynced.push(item);
    }
  }

  return uniqueSynced;
}

/**
 * Format raw LRCLIB record into client response object
 */
function formatLyricsResponse(record, source = 'lrclib') {
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  const plain = record.plainLyrics
    ? record.plainLyrics
        .split('\n')
        .map(l => l.trim())
        .filter((l, idx, arr) => l !== '' || (idx > 0 && arr[idx - 1] !== ''))
    : [];

  return {
    trackName: record.trackName || '',
    artistName: record.artistName || '',
    duration: record.duration || 0,
    hasSynced: synced.length > 0,
    synced,
    plain,
    source
  };
}

/**
 * Fallback providers for plain lyrics (lyrics.ovh / lyrist)
 */
async function fetchFallbackPlainLyrics(candidates) {
  for (const cand of candidates.slice(0, 2)) {
    if (!cand.track) continue;

    // 1. Try lyrics.ovh
    if (cand.artist) {
      try {
        const ovhRes = await axios.get(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(cand.artist)}/${encodeURIComponent(cand.track)}`,
          { timeout: 1600 }
        );
        if (ovhRes.data && ovhRes.data.lyrics && ovhRes.data.lyrics.trim().length > 20) {
          const cleanedPlain = ovhRes.data.lyrics
            .replace(/^Paroles de la chanson.*?\n/i, '')
            .replace(/\r\n/g, '\n')
            .trim();
          return formatLyricsResponse(
            {
              trackName: cand.track,
              artistName: cand.artist,
              plainLyrics: cleanedPlain
            },
            'lyrics.ovh'
          );
        }
      } catch (e) {}
    }

    // 2. Try lyrist
    try {
      const lyristRes = await axios.get(
        `https://lyrist.vercel.app/api/${encodeURIComponent(cand.track)}/${encodeURIComponent(cand.artist || '')}`,
        { timeout: 1600 }
      );
      if (lyristRes.data && lyristRes.data.lyrics && lyristRes.data.lyrics.trim().length > 20) {
        return formatLyricsResponse(
          {
            trackName: lyristRes.data.title || cand.track,
            artistName: lyristRes.data.artist || cand.artist,
            plainLyrics: lyristRes.data.lyrics
          },
          'lyrist'
        );
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Fetch synced or plain lyrics from LRCLIB (+ multi-source fallback)
 */
async function getLyrics(trackName, artistName, durationSeconds = null) {
  const cacheKey = `${(trackName || '').toLowerCase().trim()}__${(artistName || '').toLowerCase().trim()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  const candidates = getSearchCandidates(trackName, artistName).slice(0, 3);

  // STEP 1: Direct /api/get lookup per candidate (Fast, ~100ms, avoids 503 throttling on LRCLIB)
  for (const cand of candidates) {
    if (!cand.track) continue;
    try {
      const getParams = {
        track_name: cand.track,
        artist_name: cand.artist
      };

      const exactRes = await axios.get('https://lrclib.net/api/get', {
        params: getParams,
        headers: LRCLIB_HEADERS,
        timeout: 2500
      });

      if (exactRes.data && (exactRes.data.syncedLyrics || exactRes.data.plainLyrics)) {
        const formatted = formatLyricsResponse(exactRes.data, 'lrclib');
        if (lyricsCache.size >= MAX_LYRICS_CACHE) {
          const firstKey = lyricsCache.keys().next().value;
          lyricsCache.delete(firstKey);
        }
        lyricsCache.set(cacheKey, formatted);
        return formatted;
      }
    } catch (e) {
      // 404 is normal when candidate string is not an exact title; proceed to next candidate
    }
  }

  // STEP 2: If exact /api/get had no match, query LRCLIB search endpoint with guard against 503
  for (const cand of candidates.slice(0, 2)) {
    if (!cand.track) continue;
    try {
      const searchRes = await axios.get('https://lrclib.net/api/search', {
        params: { q: cand.track },
        headers: LRCLIB_HEADERS,
        timeout: 2500
      });

      const results = Array.isArray(searchRes.data) ? searchRes.data : [];
      if (results.length > 0) {
        // Score candidates: strongly favor synced lyrics and matching artist
        const scored = results
          .filter(r => r.syncedLyrics || r.plainLyrics)
          .map(r => {
            let score = 0;
            if (r.syncedLyrics) score += 100;
            if (r.plainLyrics) score += 25;

            const rTrackLower = (r.trackName || '').toLowerCase();
            const candTrackLower = cand.track.toLowerCase();
            if (rTrackLower === candTrackLower) score += 40;
            else if (rTrackLower.includes(candTrackLower) || candTrackLower.includes(rTrackLower)) score += 20;

            const rArtistLower = (r.artistName || '').toLowerCase();
            const candArtistLower = (cand.artist || '').toLowerCase();
            if (candArtistLower && rArtistLower) {
              if (rArtistLower === candArtistLower) score += 50;
              else if (rArtistLower.includes(candArtistLower) || candArtistLower.includes(rArtistLower)) score += 30;
            }

            if (durationSeconds && r.duration) {
              const diff = Math.abs(r.duration - durationSeconds);
              if (diff <= 5) score += 30;
              else if (diff <= 15) score += 15;
            }

            return { record: r, score };
          })
          .sort((a, b) => b.score - a.score);

        if (scored.length > 0 && scored[0].score >= 40) {
          const formatted = formatLyricsResponse(scored[0].record, 'lrclib');
          if (lyricsCache.size >= MAX_LYRICS_CACHE) {
            const firstKey = lyricsCache.keys().next().value;
            lyricsCache.delete(firstKey);
          }
          lyricsCache.set(cacheKey, formatted);
          return formatted;
        }
      }
    } catch (err) {
      // If /api/search fails (e.g. 503 ServerOverloaded), safely proceed to fallback
    }
  }

  // STEP 3: Fallback plain lyrics providers
  try {
    const fallbackResult = await fetchFallbackPlainLyrics(candidates);
    if (fallbackResult) {
      if (lyricsCache.size >= MAX_LYRICS_CACHE) {
        const firstKey = lyricsCache.keys().next().value;
        lyricsCache.delete(firstKey);
      }
      lyricsCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }
  } catch (e) {}

  return { hasSynced: false, synced: [], plain: [] };
}

module.exports = {
  getLyrics,
  cleanText,
  parseLrc,
  getSearchCandidates
};
