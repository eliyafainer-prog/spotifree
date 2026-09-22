const isNativeApp = typeof window !== 'undefined' && (
  window.Capacitor?.isNativePlatform?.() ||
  window.location.protocol === 'capacitor:' ||
  (window.location.hostname === 'localhost' && !['3000', '5173'].includes(window.location.port))
);

const API_BASE = isNativeApp ? 'https://spotifree-h7s8.onrender.com/api' : '/api';

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
 * Generate playable audio URL immediately without network round-trips
 */
export function getPlayableAudioUrl(track) {
  const fallbackQuery = encodeURIComponent(`${track.title || ''} ${track.artist || ''}`.trim());
  const streamableId = encodeURIComponent(track.id || '');
  return `${API_BASE}/stream/pipe/${streamableId}?q=${fallbackQuery}`;
}

/**
 * Pre-fetch next tracks in background to eliminate buffering latency
 */
export async function prefetchNextTracks(tracks) {
  if (!tracks || tracks.length === 0) return;
  try {
    fetch(`${API_BASE}/stream/prefetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: tracks.slice(0, 3) })
    }).catch(() => {});
  } catch {
    // Background prefetch is non-blocking
  }
}

/**
 * Download track audio as a Blob for offline playback
 */
export async function downloadTrackAudioBlob(track, onProgress = null) {
  const audioUrl = await getPlayableAudioUrl(track);
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error('הורדת קובץ השמע נכשלה מהשרת.');
  }

  const blob = await response.blob();
  return blob;
}

/**
 * Resolve track (e.g. Spotify imported track) to streamable YouTube videoId and individual artwork
 */
export async function resolveTrack(track) {
  if (track.streamableId && !track.streamableId.startsWith('sp_')) {
    return { streamableId: track.streamableId, thumbnail: track.thumbnail };
  }
  if (track.id && !track.id.startsWith('sp_')) {
    return { streamableId: track.id, thumbnail: track.thumbnail };
  }

  const res = await fetch(`${API_BASE}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track })
  });
  if (!res.ok) throw new Error('Failed to resolve track to streamable source');
  return await res.json();
}

