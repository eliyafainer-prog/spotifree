const yts = require('yt-search');

/**
 * Clean track title by removing unnecessary labels like (Official Music Video), [HD], etc.
 */
function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*[\(\[](official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer|hd|4k|audio)[\)\]]/gi, '')
    .replace(/\s*[\(\[]ft\.?.*?[\)\]]/gi, '')
    .trim();
}

/**
 * Search tracks by query
 */
async function searchTracks(query, limit = 20) {
  if (!query || !query.trim()) return [];
  
  try {
    const r = await yts(query);
    const videos = r.videos || [];
    
    // Filter out long DJ mixes / compilation videos (> 10 mins) for fast streaming
    let filtered = videos.filter(v => !v.seconds || v.seconds < 600);
    if (filtered.length === 0) filtered = videos; // fallback if user explicitly searched for a mix

    return filtered.slice(0, limit).map(v => {
      // Best available thumbnail
      const thumbnail = v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
      
      return {
        id: v.videoId,
        title: cleanTitle(v.title) || v.title,
        originalTitle: v.title,
        artist: v.author ? v.author.name.replace(/\s*-\s*Topic$/i, '') : 'Unknown Artist',
        duration: v.timestamp || '0:00',
        durationSeconds: v.seconds || 0,
        thumbnail: thumbnail,
        views: v.views,
        url: v.url
      };
    });
  } catch (err) {
    console.error('Error in searchTracks:', err.message);
    throw err;
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
