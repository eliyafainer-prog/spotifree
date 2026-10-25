const axios = require('axios');

// Fast in-memory cache for fetched lyrics (prevents redundant API calls)
const lyricsCache = new Map();
const MAX_LYRICS_CACHE = 500;

/**
 * Clean track or artist strings from YouTube/Spotify noise for higher lyrics hit-rate
 */
function cleanText(text = '') {
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
    const cleanT = (t || '').trim();
    const cleanA = (a || '').trim();
    if (!cleanT) return;
    const key = `${cleanT.toLowerCase()}___${cleanA.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ track: cleanT, artist: cleanA });
    }
  };

  const t1 = cleanText(trackName);
  const a1 = cleanText(artistName)
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/Official$/i, '')
    .trim();

  addCandidate(t1, a1);

  // If title contains "Artist - Song" or "Song - Artist", try splitting both ways
  if (t1.includes(' - ')) {
    const parts = t1.split(' - ').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      addCandidate(parts[1], parts[0]);
      addCandidate(parts[0], parts[1]);
      addCandidate(parts[1], a1);
      addCandidate(parts[0], a1);
    }
  }

  // Strip anything left in parentheses or brackets
  const t2 = t1.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
  const a2 = a1.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').split(/[,&/]/)[0].trim();

  addCandidate(t2, a2);

  // Also try first artist if multiple artists are separated by comma or '&'
  if (a2 !== a1) {
    addCandidate(t1, a2);
  }

  return candidates;
}

/**
 * Parse LRC formatted string into array of { time, text } objects
 * Example line: "[00:12.50] Hello world" -> { time: 12.5, text: "Hello world" }
 */
function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split('\n');
  const synced = [];
  const timeRegex = /\[(\d{2,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const matches = [...line.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const text = line.replace(timeRegex, '').trim();
    if (!text) continue;

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const msStr = match[3] || '0';
      const ms = parseInt(msStr.padEnd(3, '0'), 10);
      const time = minutes * 60 + seconds + ms / 1000;

      synced.push({
        time: Math.round(time * 100) / 100,
        text
      });
    }
  }

  return synced.sort((a, b) => a.time - b.time);
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
    hasSynced: synced.length > 0,
    synced,
    plain,
    source
  };
}

/**
 * Secondary fallback: Query lyrics.ovh or lyrist for plain lyrics if LRCLIB has no match
 */
async function fetchFallbackPlainLyrics(candidates) {
  for (const cand of candidates.slice(0, 3)) {
    if (!cand.track || !cand.artist) continue;

    // 1. Try lyrics.ovh
    try {
      const ovhRes = await axios.get(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(cand.artist)}/${encodeURIComponent(cand.track)}`,
        { timeout: 3500 }
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
    } catch (e) {
      // Proceed to next fallback
    }

    // 2. Try lyrist
    try {
      const lyristRes = await axios.get(
        `https://lyrist.vercel.app/api/${encodeURIComponent(cand.track)}/${encodeURIComponent(cand.artist)}`,
        { timeout: 3500 }
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
    } catch (e) {
      // Proceed
    }
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

  const candidates = getSearchCandidates(trackName, artistName);
  const headers = {
    'User-Agent': 'SpotiFree/2.0 (https://github.com/spotifree)'
  };

  for (const cand of candidates) {
    try {
      // 1. Try exact match endpoint first
      const params = {
        track_name: cand.track,
        artist_name: cand.artist
      };
      if (durationSeconds && durationSeconds > 0) {
        params.duration = Math.round(durationSeconds);
      }

      try {
        const exactRes = await axios.get('https://lrclib.net/api/get', {
          params,
          headers,
          timeout: 4500
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
        // Fallback to search endpoint if 404 or timeout
      }

      // 2. Fallback to structured search (track_name + artist_name) and general query search
      let results = [];
      try {
        const searchStructured = await axios.get('https://lrclib.net/api/search', {
          params: { track_name: cand.track, artist_name: cand.artist },
          headers,
          timeout: 4500
        });
        if (Array.isArray(searchStructured.data)) {
          results = searchStructured.data;
        }
      } catch (e) {}

      if (results.length === 0) {
        const searchRes = await axios.get('https://lrclib.net/api/search', {
          params: { q: `${cand.track} ${cand.artist}`.trim() },
          headers,
          timeout: 4500
        });
        results = Array.isArray(searchRes.data) ? searchRes.data : [];
      }

      // If still empty and track name is distinctive, try searching by track_name alone and matching artist loosely
      if (results.length === 0 && cand.track.length >= 3) {
        try {
          const trackOnlyRes = await axios.get('https://lrclib.net/api/search', {
            params: { track_name: cand.track },
            headers,
            timeout: 4500
          });
          if (Array.isArray(trackOnlyRes.data) && trackOnlyRes.data.length > 0) {
            const artistLower = cand.artist.toLowerCase();
            const filtered = trackOnlyRes.data.filter(r => {
              const rArtist = (r.artistName || '').toLowerCase();
              return !artistLower || rArtist.includes(artistLower) || artistLower.includes(rArtist);
            });
            results = filtered.length > 0 ? filtered : trackOnlyRes.data.slice(0, 5);
          }
        } catch (e) {}
      }

      if (results.length > 0) {
        // Score candidates: strongly prefer syncedLyrics and closest duration
        const scored = results
          .filter(r => r.syncedLyrics || r.plainLyrics)
          .map(r => {
            let score = 0;
            if (r.syncedLyrics) score += 100;
            if (r.plainLyrics) score += 20;
            if (durationSeconds && r.duration) {
              const diff = Math.abs(r.duration - durationSeconds);
              if (diff <= 3) score += 50;
              else if (diff <= 10) score += 25;
              else if (diff > 45) score -= 40;
            }
            const tLower = (r.trackName || '').toLowerCase();
            const candLower = cand.track.toLowerCase();
            if (tLower === candLower) score += 30;
            return { record: r, score };
          })
          .sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
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
      console.error('Lyrics search error for candidate:', cand, err.message);
    }
  }

  // 3. Try secondary fallback providers for plain lyrics
  const fallbackResult = await fetchFallbackPlainLyrics(candidates);
  if (fallbackResult) {
    if (lyricsCache.size >= MAX_LYRICS_CACHE) {
      const firstKey = lyricsCache.keys().next().value;
      lyricsCache.delete(firstKey);
    }
    lyricsCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  return { hasSynced: false, synced: [], plain: [] };
}

module.exports = {
  getLyrics
};
