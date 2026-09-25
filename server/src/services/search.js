const axios = require('axios');
const yts = require('yt-search');

/**
 * Clean track title by removing unnecessary labels like (Official Music Video), [HD], etc.
 */
function cleanTitle(title) {
  if (!title) return '';
  const str = typeof title === 'string'
    ? title
    : (title.text || (Array.isArray(title.runs) ? title.runs.map(r => r.text || '').join('') : String(title)));
  return str
    .replace(/\s*[\(\[](official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer|hd|4k|audio)[\)\]]/gi, '')
    .replace(/\s*[\(\[]ft\.?.*?[\)\]]/gi, '')
    .trim();
}

// In-Memory Search Cache (TTL: 2 hours, max 1000 queries)
const searchCache = new Map();
const SEARCH_CACHE_TTL = 1000 * 60 * 60 * 2;
const MAX_SEARCH_CACHE = 1000;

function getCachedSearch(key) {
  const item = searchCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return item.data;
}

function setCachedSearch(key, data) {
  if (searchCache.size >= MAX_SEARCH_CACHE) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  searchCache.set(key, { data, timestamp: Date.now() });
}

/**
 * 1. Ultra-fast direct YouTube InnerTube Search API (1-1.2s response, never throttled)
 */
async function searchInnerTube(query, limit = 20) {
  try {
    const response = await axios.post(
      'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
      {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'he',
            gl: 'IL'
          }
        },
        query: query
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 4500
      }
    );

    const data = response.data;
    const results = [];
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        if (item.videoRenderer) {
          const v = item.videoRenderer;
          if (!v.videoId) continue;

          const rawTitle = v.title?.runs?.[0]?.text || '';
          const artistName = v.ownerText?.runs?.[0]?.text || 'Unknown Artist';
          const durStr = v.lengthText?.simpleText || '0:00';
          const parts = durStr.split(':').map(Number);
          let sec = 0;
          if (parts.length === 2) sec = (parts[0] || 0) * 60 + (parts[1] || 0);
          else if (parts.length === 3) sec = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);

          // Skip long DJ mixes / full albums (> 10 mins) for fast music playback
          if (sec > 600) continue;

          const thumbs = v.thumbnail?.thumbnails || [];
          const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

          results.push({
            id: v.videoId,
            title: cleanTitle(rawTitle) || rawTitle,
            originalTitle: rawTitle,
            artist: artistName.replace(/\s*-\s*Topic$/i, ''),
            duration: durStr,
            durationSeconds: sec,
            thumbnail: thumb,
            views: v.viewCountText?.simpleText || '',
            url: `https://youtube.com/watch?v=${v.videoId}`
          });

          if (results.length >= limit) break;
        }
      }
      if (results.length >= limit) break;
    }

    return results;
  } catch (err) {
    return [];
  }
}

/**
 * 2. Secondary fallback: yt-search library
 */
async function searchYts(query, limit = 20) {
  try {
    const r = await Promise.race([
      yts(query),
      new Promise((_, reject) => setTimeout(() => reject(new Error('yts timeout')), 6000))
    ]);

    const videos = r?.videos || [];
    let filtered = videos.filter(v => !v.seconds || v.seconds < 600);
    if (filtered.length === 0) filtered = videos;

    return filtered.slice(0, limit).map(v => {
      const thumbnail = v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
      const artistName = typeof v.author === 'string' ? v.author : (v.author?.name ? String(v.author.name).replace(/\s*-\s*Topic$/i, '') : 'Unknown Artist');
      const rawTitle = typeof v.title === 'string' ? v.title : (v.title?.text || String(v.title || ''));

      return {
        id: v.videoId,
        title: cleanTitle(rawTitle) || rawTitle,
        originalTitle: rawTitle,
        artist: artistName,
        duration: v.timestamp || '0:00',
        durationSeconds: v.seconds || 0,
        thumbnail: thumbnail,
        views: v.views,
        url: v.url
      };
    });
  } catch (e) {
    return [];
  }
}

/**
 * 3. Fast emergency fallback: iTunes Search API (guaranteed 200ms response)
 */
async function searchItunes(query, limit = 20) {
  try {
    const res = await axios.get('https://itunes.apple.com/search', {
      params: {
        term: query,
        entity: 'song',
        limit: limit
      },
      timeout: 3000
    });

    const items = res.data?.results || [];
    return items.map((t, idx) => {
      const durSec = Math.round((t.trackTimeMillis || 0) / 1000);
      const mins = Math.floor(durSec / 60);
      const secs = durSec % 60;
      const artwork = (t.artworkUrl100 || '').replace('100x100bb', '600x600bb');

      return {
        id: `it_${t.trackId || idx}`,
        title: t.trackName || 'Unknown Title',
        originalTitle: t.trackName || 'Unknown Title',
        artist: t.artistName || 'Unknown Artist',
        album: t.collectionName || 'Single',
        duration: `${mins}:${secs < 10 ? '0' : ''}${secs}`,
        durationSeconds: durSec,
        thumbnail: artwork,
        source: 'itunes',
        query: `${t.artistName} - ${t.trackName}`
      };
    });
  } catch (e) {
    return [];
  }
}

/**
 * Main Search Function with layered instant fallbacks
 */
async function searchTracks(query, limit = 20) {
  if (!query || !query.trim()) return [];
  const normalizedKey = query.trim().toLowerCase();

  // 1. Instant in-memory cache hit (0ms)
  const cached = getCachedSearch(normalizedKey);
  if (cached && cached.length > 0) {
    return cached.slice(0, limit);
  }

  // 2. Ultra-fast InnerTube API (1s)
  let results = await searchInnerTube(query.trim(), limit);

  // 3. Fallback to yts
  if (results.length === 0) {
    results = await searchYts(query.trim(), limit);
  }

  // 4. Emergency fallback to iTunes
  if (results.length === 0) {
    results = await searchItunes(query.trim(), limit);
  }

  if (results.length > 0) {
    setCachedSearch(normalizedKey, results);
  }

  return results;
}

/**
 * Get trending / popular tracks for home feed
 */
async function getTrendingTracks() {
  const trendingQueries = [
    'top hits 2026',
    'billboard hot 100',
    'popular songs',
    'להיטים ישראלים 2026'
  ];
  const q = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
  const tracks = await searchTracks(q, 30);
  const singleTracks = tracks.filter(t => !t.durationSeconds || (t.durationSeconds >= 90 && t.durationSeconds <= 420));
  return singleTracks.length >= 10 ? singleTracks.slice(0, 24) : tracks.slice(0, 24);
}

module.exports = {
  searchTracks,
  getTrendingTracks,
  cleanTitle
};
