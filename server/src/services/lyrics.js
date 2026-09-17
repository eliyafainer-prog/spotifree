const axios = require('axios');

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
 * Fetch lyrics from LRCLIB
 */
async function getLyrics(trackName, artistName, durationSeconds = null) {
  try {
    const params = {
      track_name: trackName,
      artist_name: artistName
    };
    if (durationSeconds) {
      params.duration = Math.round(durationSeconds);
    }

    const response = await axios.get('https://lrclib.net/api/get', {
      params,
      headers: {
        'User-Agent': 'SpotiFreeApp/1.0 (https://github.com/spotifree)'
      },
      timeout: 5000
    });

    const data = response.data;
    const synced = data.syncedLyrics ? parseLrc(data.syncedLyrics) : [];
    const plain = data.plainLyrics ? data.plainLyrics.split('\n').map(l => l.trim()).filter(Boolean) : [];

    return {
      synced: synced,
      plain: plain,
      hasSynced: synced.length > 0,
      instrumental: !!data.instrumental
    };
  } catch (err) {
    // If exact get fails, try search endpoint
    try {
      const searchRes = await axios.get('https://lrclib.net/api/search', {
        params: { q: `${trackName} ${artistName}` },
        headers: {
          'User-Agent': 'SpotiFreeApp/1.0'
        },
        timeout: 5000
      });

      if (searchRes.data && searchRes.data.length > 0) {
        const item = searchRes.data[0];
        const synced = item.syncedLyrics ? parseLrc(item.syncedLyrics) : [];
        const plain = item.plainLyrics ? item.plainLyrics.split('\n').map(l => l.trim()).filter(Boolean) : [];
        return {
          synced,
          plain,
          hasSynced: synced.length > 0,
          instrumental: !!item.instrumental
        };
      }
    } catch (searchErr) {
      // Ignored
    }

    return {
      synced: [],
      plain: [],
      hasSynced: false,
      instrumental: false
    };
  }
}

module.exports = {
  getLyrics,
  parseLrc
};
