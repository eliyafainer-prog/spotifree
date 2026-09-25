import { isNativeApp } from './nativeAudio';

// Server URLs
export const DEFAULT_SERVERS = {
  tunnel: 'https://compilation-benjamin-gnome-pockets.trycloudflare.com',
  local: 'http://10.100.102.16:5050',
  cloud: 'https://spotifree-h7s8.onrender.com',
  tailscale: 'http://100.99.113.87:5050'
};

export function getActiveServerUrl() {
  const custom = localStorage.getItem('spotifree_server_url');
  if (custom) return custom.replace(/\/+$/, '');

  if (isNativeApp) {
    // In native Android app, default to Tunnel (unblocked everywhere, residential IP speed)
    return DEFAULT_SERVERS.tunnel;
  }

  // In web browser, use relative path ('' -> '/api')
  return '';
}

export function setActiveServerUrl(url) {
  if (!url) {
    localStorage.removeItem('spotifree_server_url');
  } else {
    localStorage.setItem('spotifree_server_url', url.replace(/\/+$/, ''));
  }
}

export function getApiBase() {
  const base = getActiveServerUrl();
  return base ? `${base}/api` : '/api';
}

/**
 * Robust fetch with automatic cascading failover (Tunnel -> Local -> Cloud)
 */
async function fetchWithFailover(apiPath, options = {}) {
  const base = getActiveServerUrl();
  const serverCandidates = [
    base,
    DEFAULT_SERVERS.tunnel,
    DEFAULT_SERVERS.local,
    DEFAULT_SERVERS.cloud
  ].filter(Boolean);

  const uniqueServers = [...new Set(serverCandidates)];
  let lastError = null;

  for (const srv of uniqueServers) {
    const fullUrl = srv ? `${srv}${apiPath}` : apiPath;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const combinedSignal = options.signal || controller.signal;

    try {
      const res = await fetch(fullUrl, { ...options, signal: combinedSignal });
      clearTimeout(timeoutId);
      if (res.ok) {
        return res;
      }
      if (res.status < 500) {
        // 4xx errors (client errors) shouldn't cycle through servers
        return res;
      }
      throw new Error(`Server ${srv} returned ${res.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      console.warn(`Server ${srv} failed for ${apiPath}:`, err.message);
    }
  }

  throw lastError || new Error('All servers unreachable');
}

// In-Memory Client Caches for 0ms repeat searches and resolutions
const clientSearchCache = new Map();
const clientResolveCache = new Map();

/**
 * Search tracks with client-side caching & instant failover
 */
export async function searchTracks(query) {
  if (!query || !query.trim()) return [];
  const key = query.trim().toLowerCase();

  if (clientSearchCache.has(key)) {
    return clientSearchCache.get(key);
  }

  const res = await fetchWithFailover(`/api/search?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) throw new Error('חיפוש שירים נכשל');
  const data = await res.json();
  const tracks = data.tracks || [];

  if (clientSearchCache.size > 200) {
    const oldest = clientSearchCache.keys().next().value;
    clientSearchCache.delete(oldest);
  }
  clientSearchCache.set(key, tracks);

  return tracks;
}

/**
 * Get trending tracks
 */
export async function getTrendingTracks() {
  const res = await fetchWithFailover('/api/trending');
  if (!res.ok) throw new Error('Failed to fetch trending');
  const data = await res.json();
  return data.tracks || [];
}

/**
 * Import playlist from Spotify or YouTube URL (Instant response)
 */
export async function importPlaylist(url) {
  const res = await fetchWithFailover('/api/import', {
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
    const res = await fetchWithFailover(`/api/lyrics?${params.toString()}`);
    if (!res.ok) return { synced: [], plain: [], hasSynced: false };
    return await res.json();
  } catch (e) {
    return { synced: [], plain: [], hasSynced: false };
  }
}

/**
 * Fetch direct audio stream URL with 0ms buffering from nearest CDN edge
 */
export async function fetchDirectStreamUrl(track) {
  if (!track) return null;
  const vid = track.streamableId || track.id;
  if (!vid || vid.startsWith('sp_')) return null;

  try {
    const res = await fetchWithFailover(`/api/stream/${encodeURIComponent(vid)}`);
    if (res && res.ok) {
      const data = await res.json();
      return data.streamUrl || null;
    }
  } catch (e) {
    console.warn('fetchDirectStreamUrl error:', e.message);
  }
  return null;
}

/**
 * Generate playable audio URL with fallback server support
 */
export function getPlayableAudioUrl(track, serverOverride = null) {
  const base = serverOverride || getActiveServerUrl() || DEFAULT_SERVERS.tunnel || DEFAULT_SERVERS.cloud;
  const fallbackQuery = encodeURIComponent(`${track.title || ''} ${track.artist || ''}`.trim());
  const streamableId = encodeURIComponent(track.streamableId || track.id || '');
  return `${base}/api/stream/pipe/${streamableId}?q=${fallbackQuery}`;
}

/**
 * Pre-fetch next tracks in background to eliminate buffering latency
 */
export async function prefetchNextTracks(tracks) {
  if (!tracks || tracks.length === 0) return;
  try {
    fetchWithFailover('/api/stream/prefetch', {
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

// Persistent resolved tracks cache in localStorage for 0ms repeat playback
const RESOLVED_CACHE_KEY = 'spotifree_resolved_v1';
let persistedResolveCache = {};
try {
  const stored = localStorage.getItem(RESOLVED_CACHE_KEY);
  if (stored) persistedResolveCache = JSON.parse(stored);
} catch (e) {}

function saveToResolvedCache(key, data) {
  try {
    persistedResolveCache[key] = data;
    const keys = Object.keys(persistedResolveCache);
    if (keys.length > 500) {
      delete persistedResolveCache[keys[0]];
    }
    localStorage.setItem(RESOLVED_CACHE_KEY, JSON.stringify(persistedResolveCache));
  } catch (e) {}
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

  const key = `${track.artist || ''}:::${track.title || ''}`.trim().toLowerCase();
  if (clientResolveCache.has(key)) {
    return clientResolveCache.get(key);
  }
  if (persistedResolveCache[key]) {
    clientResolveCache.set(key, persistedResolveCache[key]);
    return persistedResolveCache[key];
  }

  const res = await fetchWithFailover('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track })
  });
  if (!res.ok) throw new Error('Failed to resolve track to streamable source');
  const data = await res.json();

  if (clientResolveCache.size > 500) {
    const oldest = clientResolveCache.keys().next().value;
    clientResolveCache.delete(oldest);
  }
  clientResolveCache.set(key, data);
  saveToResolvedCache(key, data);

  return data;
}
