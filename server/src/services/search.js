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

const PUBLIC_SEARCH_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://invidious.tiekoetter.com',
  'https://inv.nadeko.net'
];

async function fallbackInvidiousSearch(query, limit = 20) {
  for (const inst of PUBLIC_SEARCH_INSTANCES) {
    try {
      const res = await axios.get(`${inst}/api/v1/search`, {
        params: { q: query, type: 'video' },
        timeout: 4000
      });
      if (Array.isArray(res.data) && res.data.length > 0) {
        return res.data
          .filter(v => v.type === 'video' || v.videoId)
          .slice(0, limit)
          .map(v => ({
            id: v.videoId,
            title: cleanTitle(v.title) || v.title,
            originalTitle: v.title,
            artist: v.author || 'Unknown Artist',
            duration: v.lengthSeconds ? `${Math.floor(v.lengthSeconds / 60)}:${(v.lengthSeconds % 60).toString().padStart(2, '0')}` : '0:00',
            durationSeconds: v.lengthSeconds || 0,
            thumbnail: v.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            views: v.viewCount || 0,
            url: `https://youtube.com/watch?v=${v.videoId}`
          }));
      }
    } catch (e) {}
  }
  return [];
}

/**
 * Search tracks by query
 */
async function searchTracks(query, limit = 20) {
  if (!query || !query.trim()) return [];
  
  try {
    const r = await yts(query);
    const videos = r.videos || [];
    
    if (videos.length === 0) {
      const fb = await fallbackInvidiousSearch(query, limit);
      if (fb.length > 0) return fb;
    }

    // Filter out long DJ mixes / compilation videos (> 10 mins) for fast streaming
    let filtered = videos.filter(v => !v.seconds || v.seconds < 600);
    if (filtered.length === 0) filtered = videos; // fallback if user explicitly searched for a mix

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
  } catch (err) {
    console.warn('yts search failed, using fallback search:', err.message);
    const fallbackResults = await fallbackInvidiousSearch(query, limit);
    if (fallbackResults.length > 0) return fallbackResults;
    return [];
  }
}

/**
 * Get trending / popular tracks for home feed (guaranteed fast single tracks)
 */
async function getTrendingTracks() {
  const trendingQueries = [
    'top hits music video',
    'billboard hot songs',
    'popular official audio',
    'hit songs 2026'
  ];
  const q = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
  const tracks = await searchTracks(q, 30);
  // Filter for authentic single tracks between 1.5 and 7 minutes
  const singleTracks = tracks.filter(t => !t.durationSeconds || (t.durationSeconds >= 90 && t.durationSeconds <= 420));
  return singleTracks.length >= 10 ? singleTracks.slice(0, 24) : tracks.slice(0, 24);
}

module.exports = {
  searchTracks,
  getTrendingTracks,
  cleanTitle
};
