import { isNativeApp } from './nativeAudio';

// High-speed Server Infrastructure
export const DEFAULT_SERVERS = {
  tunnel: '',
  local: 'http://localhost:5050',
  android_termux: 'http://127.0.0.1:5050',
  cloud: 'https://spotifree-h7s8.onrender.com'
};

// Clean up any stale/dead tunnel URLs from previous sessions in localStorage
try {
  const lastHealthy = localStorage.getItem('spotifree_last_healthy_server') || '';
  if (lastHealthy.includes('trycloudflare.com') || lastHealthy.includes('10.') || lastHealthy.includes('192.168.')) {
    localStorage.removeItem('spotifree_last_healthy_server');
  }
  const customSrv = localStorage.getItem('spotifree_server_url') || '';
  if (customSrv.includes('trycloudflare.com') || customSrv.includes('10.') || customSrv.includes('192.168.')) {
    localStorage.removeItem('spotifree_server_url');
  }
} catch (e) {}

let activeServerUrl = null;
let discoveryPromise = null;

/**
 * High-speed parallel server discovery:
 * Locks onto the current origin on web, or fastest live server on native mobile.
 */
export async function discoverActiveServer(force = false) {
  if (activeServerUrl !== null && !force) return activeServerUrl;
  if (discoveryPromise && !force) return discoveryPromise;

  discoveryPromise = (async () => {
    try {
      const custom = localStorage.getItem('spotifree_server_url');
      if (custom) {
        activeServerUrl = custom.replace(/\/+$/, '');
        return activeServerUrl;
      }
    } catch (e) {}

    if (!isNativeApp && typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost:5173')) {
      activeServerUrl = '';
      return '';
    }

    let cachedServer = null;
    try {
      cachedServer = localStorage.getItem('spotifree_last_healthy_server');
    } catch (e) {}

    const candidates = [
      cachedServer,
      DEFAULT_SERVERS.cloud
    ].filter(Boolean);

    const uniqueCandidates = [...new Set(candidates)];

    const ping = async (srv) => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 1500);
      try {
        const res = await fetch(`${srv}/health`, { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) {
          return srv;
        }
      } catch (e) {
        clearTimeout(tid);
      }
      throw new Error(`Ping failed for ${srv}`);
    };

    try {
      const winner = await Promise.any(uniqueCandidates.map(s => ping(s)));
      if (winner) {
        activeServerUrl = winner.replace(/\/+$/, '');
        try { localStorage.setItem('spotifree_last_healthy_server', activeServerUrl); } catch (e) {}
        return activeServerUrl;
      }
    } catch (e) {}

    activeServerUrl = isNativeApp ? DEFAULT_SERVERS.cloud : '';
    return activeServerUrl;
  })();

  try {
    return await discoveryPromise;
  } finally {
    discoveryPromise = null;
  }
}

// Proactively run discovery on startup
discoverActiveServer().catch(() => {});

export function getActiveServerUrl() {
  try {
    const custom = localStorage.getItem('spotifree_server_url');
    if (custom) return custom.replace(/\/+$/, '');
  } catch (e) {}

  if (!isNativeApp && typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost:5173')) {
    return '';
  }

  if (activeServerUrl !== null) {
    return activeServerUrl;
  }

  try {
    const cached = localStorage.getItem('spotifree_last_healthy_server');
    if (cached) return cached;
  } catch (e) {}

  if (isNativeApp) {
    return DEFAULT_SERVERS.cloud;
  }

  return '';
}

export function setActiveServerUrl(url) {
  try {
    if (!url) {
      localStorage.removeItem('spotifree_server_url');
      activeServerUrl = null;
    } else {
      const clean = url.replace(/\/+$/, '');
      localStorage.setItem('spotifree_server_url', clean);
      activeServerUrl = clean;
    }
  } catch (e) {}
}

export function getApiBase() {
  const base = getActiveServerUrl();
  return base ? `${base}/api` : '/api';
}

/**
 * Fast fetch with automatic failover (never duplicate requests to same server)
 */
async function fetchWithFailover(apiPath, options = {}) {
  const currentBase = getActiveServerUrl();
  const serverCandidates = [];

  if (currentBase !== null && currentBase !== undefined) {
    serverCandidates.push(currentBase);
  }

  // Dev environment fallback
  if (typeof window !== 'undefined' && window.location.origin?.includes('localhost:5173')) {
    serverCandidates.push('http://localhost:5050');
  }

  // Always make cloud fallback available
  if (currentBase !== DEFAULT_SERVERS.cloud) {
    serverCandidates.push(DEFAULT_SERVERS.cloud);
  }

  const uniqueServers = [...new Set(serverCandidates)];
  if (uniqueServers.length === 0) uniqueServers.push('');

  // 1. Try primary server first with generous 16s timeout for Render cold-starts
  const primarySrv = uniqueServers[0];
  const primaryUrl = primarySrv ? `${primarySrv}${apiPath}` : apiPath;
  const primaryController = new AbortController();
  const primaryTimer = setTimeout(() => primaryController.abort(), 16000);
  const primarySignal = options.signal || primaryController.signal;

  try {
    const res = await fetch(primaryUrl, { ...options, signal: primarySignal });
    clearTimeout(primaryTimer);
    if (res.ok) {
      return res;
    }
  } catch (primaryErr) {
    clearTimeout(primaryTimer);
    // Primary failed or timed out, proceed to failover candidates
  }

  // 2. Fallback candidates
  let fallbackServers = uniqueServers.slice(1);
  if (fallbackServers.length === 0 && primarySrv !== DEFAULT_SERVERS.cloud) {
    fallbackServers = [DEFAULT_SERVERS.cloud];
  }

  if (fallbackServers.length === 0) {
    throw new Error('Server unreachable');
  }

  const fallbackPromises = fallbackServers.map(srv => {
    return new Promise(async (resolve, reject) => {
      const fullUrl = srv ? `${srv}${apiPath}` : apiPath;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 16000);
      const combinedSignal = options.signal || controller.signal;

      try {
        const res = await fetch(fullUrl, { ...options, signal: combinedSignal });
        clearTimeout(timeoutId);
        if (res.ok) {
          if (srv && srv !== activeServerUrl) {
            activeServerUrl = srv;
            try { localStorage.setItem('spotifree_last_healthy_server', srv); } catch (e) {}
          }
          resolve(res);
        } else {
          reject(new Error(`Status ${res.status}`));
        }
      } catch (err) {
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  });

  try {
    return await Promise.any(fallbackPromises);
  } catch (err) {
    throw new Error('All servers unreachable');
  }
}

// In-Memory Client Caches for 0ms repeat searches and resolutions
const clientSearchCache = new Map();
const clientResolveCache = new Map();

/**
 * Search tracks with client-side caching & instant failover
 */
export async function searchTracks(query, limit = 60) {
  if (!query || !query.trim()) return [];
  const key = `${query.trim().toLowerCase()}:::${limit}`;

  if (clientSearchCache.has(key)) {
    return clientSearchCache.get(key);
  }

  const res = await fetchWithFailover(`/api/search?q=${encodeURIComponent(query.trim())}&limit=${limit}`);
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
 * Get full home catalog (trending tracks + curated multi-genre sections)
 */
export async function getHomeCatalog() {
  const res = await fetchWithFailover('/api/trending');
  if (!res.ok) throw new Error('Failed to fetch catalog');
  const data = await res.json();
  return {
    tracks: data.tracks || [],
    sections: data.sections || []
  };
}

/**
 * Get trending tracks
 */
export async function getTrendingTracks() {
  const catalog = await getHomeCatalog();
  return catalog.tracks || [];
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
    const fallbackQuery = encodeURIComponent(`${track.artist || ''} - ${track.title || ''}`.replace(/^-\s*|\s*-$/g, '').trim());
    const dur = Math.round(Number(track.durationSeconds) || 0);
    const title = encodeURIComponent(track.title || '');
    const artist = encodeURIComponent(track.artist || '');
    const album = encodeURIComponent(track.album || '');
    const res = await fetchWithFailover(`/api/stream/${encodeURIComponent(vid)}?q=${fallbackQuery}&dur=${dur}&title=${title}&artist=${artist}&album=${album}`);
    if (res && res.ok) {
      const data = await res.json();
      if (data.streamUrl) return data.streamUrl;
    }
  } catch (e) {}

  return null;
}

/**
 * Generate playable audio URL with full studio track metadata
 */
export function getPlayableAudioUrl(track, serverOverride = null) {
  const active = getActiveServerUrl();
  const base = serverOverride !== null ? serverOverride : (active !== null && active !== undefined ? active : DEFAULT_SERVERS.cloud);
  const fallbackQuery = encodeURIComponent(`${track.artist || ''} - ${track.title || ''}`.replace(/^-\s*|\s*-$/g, '').trim());
  const streamableId = encodeURIComponent(track.streamableId || track.id || 'query');
  const dur = Math.round(Number(track.durationSeconds) || 0);
  const title = encodeURIComponent(track.title || '');
  const artist = encodeURIComponent(track.artist || '');
  const album = encodeURIComponent(track.album || '');
  return `${base}/api/stream/pipe/${streamableId}?q=${fallbackQuery}&dur=${dur}&title=${title}&artist=${artist}&album=${album}`;
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
 * Generate dedicated offline download URL with multi-source fallback
 */
export function getOfflineDownloadUrl(track, serverOverride = null) {
  const active = getActiveServerUrl();
  const base = serverOverride !== null ? serverOverride : (active !== null && active !== undefined ? active : DEFAULT_SERVERS.cloud);
  const fallbackQuery = encodeURIComponent(`${track.artist || ''} - ${track.title || ''}`.replace(/^-\s*|\s*-$/g, '').trim());
  const streamableId = encodeURIComponent(track.streamableId || track.id || 'query');
  const dur = Math.round(Number(track.durationSeconds) || 0);
  const title = encodeURIComponent(track.title || '');
  const artist = encodeURIComponent(track.artist || '');
  const album = encodeURIComponent(track.album || '');
  return `${base}/api/offline/download/${streamableId}?q=${fallbackQuery}&dur=${dur}&title=${title}&artist=${artist}&album=${album}`;
}

/**
 * Download track audio as a Blob for offline playback with real-time progress & 3-stage auto-retry
 */
export async function downloadTrackAudioBlob(track, onProgress = null) {
  let lastErr = null;
  const estimatedBytes = Math.max(2200000, (Number(track?.durationSeconds) || 180) * 18000);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const baseAudioUrl = attempt <= 2 ? getOfflineDownloadUrl(track) : getPlayableAudioUrl(track);
      const audioUrl = `${baseAudioUrl}&dl=1&attempt=${attempt}`;
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || 'audio/mp4';
      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : estimatedBytes;

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];
        let receivedBytes = 0;

        if (onProgress) onProgress(2, 0, totalBytes);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.byteLength;
            if (onProgress) {
              const pct = Math.min(99, Math.max(3, Math.round((receivedBytes / totalBytes) * 100)));
              onProgress(pct, receivedBytes, totalBytes);
            }
          }
        }

        const blob = new Blob(chunks, { type: contentType });
        if (blob.size < 10000) {
          throw new Error('Incomplete audio file received');
        }
        if (onProgress) onProgress(100, receivedBytes, receivedBytes);
        return blob;
      } else {
        const blob = await response.blob();
        if (blob.size < 10000) {
          throw new Error('Incomplete audio file received');
        }
        if (onProgress) onProgress(100, blob.size, blob.size);
        return blob;
      }
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 900));
      }
    }
  }

  throw lastErr || new Error('הורדת קובץ השמע נכשלה מהשרת.');
}

// Persistent resolved tracks cache in localStorage for 0ms repeat playback
const RESOLVED_CACHE_KEY = 'spotifree_resolved_v4';
let persistedResolveCache = {};
try {
  const stored = localStorage.getItem(RESOLVED_CACHE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') persistedResolveCache = parsed;
  }
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
 * Check if a track already has a cached resolution synchronously
 */
export function getCachedTrackResolution(track) {
  if (!track) return null;
  const key = `${track.artist || ''}:::${track.title || ''}`.trim().toLowerCase();
  if (clientResolveCache.has(key)) return clientResolveCache.get(key);
  if (persistedResolveCache[key]) return persistedResolveCache[key];
  return null;
}

/**
 * Resolve track (e.g. Spotify imported track) to streamable YouTube videoId and individual artwork
 */
export async function resolveTrack(track, forceArtwork = false) {
  if (!forceArtwork && track.hasCustomArtwork !== false && track.studioResolvedV4) {
    if (track.streamableId && !track.streamableId.startsWith('sp_')) {
      return { streamableId: track.streamableId, thumbnail: track.thumbnail, hasCustomArtwork: true, studioResolvedV3: true, studioResolvedV4: true };
    }
    if (track.id && !track.id.startsWith('sp_')) {
      return { streamableId: track.id, thumbnail: track.thumbnail, hasCustomArtwork: true, studioResolvedV3: true, studioResolvedV4: true };
    }
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
    body: JSON.stringify({ track: { ...track, hasCustomArtwork: false } })
  });
  if (!res.ok) throw new Error('Failed to resolve track to streamable source');
  const data = await res.json();
  data.studioResolvedV3 = true;
  data.studioResolvedV4 = true;

  if (clientResolveCache.size > 500) {
    const oldest = clientResolveCache.keys().next().value;
    clientResolveCache.delete(oldest);
  }
  clientResolveCache.set(key, data);
  saveToResolvedCache(key, data);

  return data;
}
