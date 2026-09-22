const axios = require('axios');

// In-memory cache for instant 0ms responses on repeat lookups
const lyricsCache = new Map();

/**
 * Parse standard LRC format string into structured array
 * Example: "[00:12.34] Hello world" -> { time: 12.34, text: "Hello world" }
 */
function parseLrc(lrcString) {
  if (!lrcString) return [];
  const lines = lrcString.split('\n');
  const result = [];
  const regex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\](.*)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const totalSeconds = minutes * 60 + seconds + milliseconds / 1000;
      const text = match[4].trim();

      if (text) {
        result.push({
          time: totalSeconds,
          text: text
        });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Clean track title and artist of YouTube clutter, brackets, and extra descriptions
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s*[\(\[](?:קליפ רשמי|קליפ|official\s*(?:music\s*)?video|official\s*audio|lyrics?|visualizer|hd|4k|audio|live|remaster(?:ed)?|גרסת במה|אודיו רשמי)[\]\)]/gi, '')
    .replace(/\s*-\s*(?:קליפ רשמי|קליפ|official\s*(?:music\s*)?video|official\s*audio|lyrics?|audio|visualizer)/gi, '')
    .replace(/\b(?:קליפ רשמי|קליפ|official\s*(?:music\s*)?video|official\s*audio|visualizer|אודיו רשמי)\b/gi, '')
    .replace(/["'״׳]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Generate intelligent search candidates for track title and artist
 */
function getSearchCandidates(trackName, artistName) {
  const candidates = [];
  const cleanTrack = cleanText(trackName);
  const cleanArtist = cleanText(artistName);

  // If track name contains the artist's name (e.g. "טל מוסרי איש השאלות")
  if (cleanArtist && cleanTrack.toLowerCase().includes(cleanArtist.toLowerCase())) {
    const trackWithoutArtist = cleanTrack
      .replace(new RegExp(cleanArtist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
      .replace(/^[\s\-_:]+|[\s\-_:]+$/g, '')
      .trim();
    if (trackWithoutArtist && trackWithoutArtist.length >= 2) {
      candidates.push({ track: trackWithoutArtist, artist: cleanArtist });
      candidates.push({ query: trackWithoutArtist });
    }
  }

  // If track name has "Artist - Song" format (very common in YouTube titles)
  if (cleanTrack.includes(' - ')) {
    const [partA, partB] = cleanTrack.split(' - ').map(s => s.trim());
    candidates.push({ track: partB, artist: partA });
    candidates.push({ track: partA, artist: partB });
    candidates.push({ query: `${partB} ${partA}` });
    candidates.push({ query: partB });
    candidates.push({ query: partA });
  }

  // Standard clean track & artist
  candidates.push({ track: cleanTrack, artist: cleanArtist });
  candidates.push({ query: `${cleanTrack} ${cleanArtist}` });
  candidates.push({ query: cleanTrack });

  // Original uncleaned as fallback
  if (trackName && trackName !== cleanTrack) {
    candidates.push({ query: trackName });
  }

  return candidates;
}

/**
 * Fetch lyrics from LRCLIB with smart multi-tier query strategy
 */
async function getLyrics(trackName, artistName, durationSeconds = null) {
  if (!trackName) {
    return { synced: [], plain: [], hasSynced: false, instrumental: false };
  }

  const cacheKey = `${trackName}_${artistName || ''}_${durationSeconds || ''}`.toLowerCase();
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  const candidates = getSearchCandidates(trackName, artistName);
  const headers = {
    'User-Agent': 'SpotiFreeApp/2.0 (https://github.com/spotifree)'
  };

  for (const candidate of candidates) {
    try {
      let items = [];

      // 1. Try structured search if track and artist are available
      if (candidate.track && candidate.artist) {
        const res = await axios.get('https://lrclib.net/api/search', {
          params: {
            track_name: candidate.track,
            artist_name: candidate.artist
          },
          headers,
          timeout: 4000
        });
        if (Array.isArray(res.data) && res.data.length > 0) {
          items = res.data;
        }
      }

      // 2. Try text search if no items yet
      if (items.length === 0 && candidate.query) {
        const res = await axios.get('https://lrclib.net/api/search', {
          params: { q: candidate.query },
          headers,
          timeout: 4000
        });
        if (Array.isArray(res.data) && res.data.length > 0) {
          items = res.data;
        }
      }

      if (items.length > 0) {
        // Sort items: 1. Synced lyrics first! 2. Closest duration match
        items.sort((a, b) => {
          const aSynced = a.syncedLyrics ? 1 : 0;
          const bSynced = b.syncedLyrics ? 1 : 0;
          if (aSynced !== bSynced) return bSynced - aSynced;

          if (durationSeconds) {
            const aDiff = Math.abs((a.duration || 0) - durationSeconds);
            const bDiff = Math.abs((b.duration || 0) - durationSeconds);
            return aDiff - bDiff;
          }
          return 0;
        });

        const best = items[0];
        const synced = best.syncedLyrics ? parseLrc(best.syncedLyrics) : [];
        const plain = best.plainLyrics
          ? best.plainLyrics.split('\n').map(l => l.trim()).filter(Boolean)
          : [];

        if (synced.length > 0 || plain.length > 0) {
          const result = {
            synced,
            plain,
            hasSynced: synced.length > 0,
            instrumental: !!best.instrumental,
            trackName: best.trackName || trackName,
            artistName: best.artistName || artistName
          };
          lyricsCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (err) {
      // Continue to next candidate
    }
  }

  const emptyResult = {
    synced: [],
    plain: [],
    hasSynced: false,
    instrumental: false
  };
  lyricsCache.set(cacheKey, emptyResult);
  return emptyResult;
}

module.exports = {
  getLyrics,
  parseLrc,
  cleanText
};
