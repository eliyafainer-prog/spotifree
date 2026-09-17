const STATS_KEY = 'spotifree_listening_stats';
const SESSIONS_KEY = 'spotifree_play_history';

/**
 * Get raw play events
 */
export function getPlayHistory() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Record a played track event with timestamp
 */
export function recordTrackPlay(track) {
  if (!track) return;
  try {
    const history = getPlayHistory();
    const event = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      thumbnail: track.thumbnail,
      timestamp: Date.now(),
      hour: new Date().getHours(),
      day: new Date().toLocaleDateString('he-IL', { weekday: 'short' })
    };

    const updated = [event, ...history].slice(0, 500); // Keep last 500 plays
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to record track play:', e);
  }
}

/**
 * Record seconds of listening time
 */
export function recordListeningSeconds(seconds) {
  if (!seconds || seconds <= 0) return;
  try {
    const current = parseFloat(localStorage.getItem('spotifree_total_seconds') || '0');
    localStorage.setItem('spotifree_total_seconds', (current + seconds).toString());
  } catch (e) {
    // Ignored
  }
}

/**
 * Calculate comprehensive data analytics report
 */
export function getAnalyticsReport() {
  const history = getPlayHistory();
  const totalSeconds = parseFloat(localStorage.getItem('spotifree_total_seconds') || '0');

  // Total listening hours and minutes
  const totalMinutes = Math.round(totalSeconds / 60);
  const totalHours = (totalSeconds / 3600).toFixed(1);

  // Top Tracks by play count
  const trackCountMap = {};
  for (const item of history) {
    const key = `${item.title}___${item.artist}`;
    if (!trackCountMap[key]) {
      trackCountMap[key] = {
        title: item.title,
        artist: item.artist,
        thumbnail: item.thumbnail,
        count: 0
      };
    }
    trackCountMap[key].count++;
  }

  const topTracks = Object.values(trackCountMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top Artists by play count
  const artistCountMap = {};
  for (const item of history) {
    const artist = item.artist || 'אמן לא ידוע';
    artistCountMap[artist] = (artistCountMap[artist] || 0) + 1;
  }

  const topArtists = Object.entries(artistCountMap)
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Hourly distribution (24 hours)
  const hourlyCounts = new Array(24).fill(0);
  for (const item of history) {
    if (typeof item.hour === 'number' && item.hour >= 0 && item.hour < 24) {
      hourlyCounts[item.hour]++;
    }
  }

  // Peak listening hour
  let peakHour = 0;
  let maxHourCount = 0;
  hourlyCounts.forEach((count, h) => {
    if (count > maxHourCount) {
      maxHourCount = count;
      peakHour = h;
    }
  });

  // Time of day categorization
  let morning = 0, afternoon = 0, evening = 0, night = 0;
  history.forEach(item => {
    const h = item.hour || 0;
    if (h >= 6 && h < 12) morning++;
    else if (h >= 12 && h < 18) afternoon++;
    else if (h >= 18 && h < 24) evening++;
    else night++;
  });

  return {
    totalPlays: history.length,
    totalMinutes,
    totalHours,
    topTracks,
    topArtists,
    hourlyCounts,
    peakHour: `${peakHour}:00`,
    timeOfDay: {
      morning,
      afternoon,
      evening,
      night
    }
  };
}
