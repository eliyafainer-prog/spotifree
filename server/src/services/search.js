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
    
    return videos.slice(0, limit).map(v => {
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
 * Get trending / popular tracks for home feed
 */
async function getTrendingTracks() {
  const trendingQueries = [
    'top hits today',
    'billboard hot 100',
    'popular songs 2026'
  ];
  const q = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
  return await searchTracks(q, 24);
}

module.exports = {
  searchTracks,
  getTrendingTracks,
  cleanTitle
};
