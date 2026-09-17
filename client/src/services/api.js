const API_BASE = '/api';

/**
 * Search tracks
 */
export async function searchTracks(query) {
  if (!query || !query.trim()) return [];
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();
  return data.tracks || [];
}

/**
 * Get trending tracks
 */
export async function getTrendingTracks() {
  const res = await fetch(`${API_BASE}/trending`);
  if (!res.ok) throw new Error('Failed to fetch trending');
  const data = await res.json();
  return data.tracks || [];
}

/**
 * Import playlist from Spotify or YouTube URL
 */
export async function importPlaylist(url) {
  const res = await fetch(`${API_BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    let errMsg = 'שגיאה בייבוא הפלייליסט';
    try {
      const err = await res.json();
      errMsg = err.error || errMsg;
    } catch {
      const txt = await res.text();
      if (txt) errMsg = txt;
    }
    throw new Error(errMsg);
  }
  const data = await res.json();
  return data.playlist;
}

/**
 * Get synced lyrics from LRCLIB
 */
export async function getLyrics(track, artist, duration) {
  try {
    const params = new URLSearchParams({
      track,
      artist,
      ...(duration ? { duration } : {})
    });
    const res = await fetch(`${API_BASE}/lyrics?${params.toString()}`);
    if (!res.ok) return { synced: [], plain: [], hasSynced: false };
    return await res.json();
  } catch (e) {
    return { synced: [], plain: [], hasSynced: false };
  }
}

/**
 * Resolve a track and get playable audio URL
 */
export async function getPlayableAudioUrl(track) {
  let streamableId = track.id;

  // If track is from Spotify import or needs resolution
  if (track.source === 'spotify' || (typeof track.id === 'string' && track.id.startsWith('sp_'))) {
    const res = await fetch(`${API_BASE}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track })
    });
    if (!res.ok) throw new Error('Failed to resolve track audio');
    const data = await res.json();
    streamableId = data.streamableId;
  }

  // Use the backend pipe endpoint with HTTP Range support and fallback query
  const fallbackQuery = encodeURIComponent(`${track.title} ${track.artist || ''}`.trim());
  return `${API_BASE}/stream/pipe/${streamableId}?q=${fallbackQuery}`;
}
