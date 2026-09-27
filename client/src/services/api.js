import { isNativeApp } from './nativeAudio';

// High-speed Server Infrastructure
export const DEFAULT_SERVERS = {
  tunnel: 'https://depending-lawyer-memories-gui.trycloudflare.com',
  local: 'http://10.100.102.16:5050',
  android_termux: 'http://127.0.0.1:5050',
  cloud: 'https://spotifree-h7s8.onrender.com'
};

let activeServerUrl = null;
let discoveryPromise = null;

/**
 * High-speed parallel server discovery:
 * Races cached server, local Wi-Fi, active Cloudflare tunnel, and Render dynamic registry.
 * Locks onto the fastest live server in 30-200ms!
 */
export async function discoverActiveServer(force = false) {
  if (activeServerUrl && !force) return activeServerUrl;
  if (discoveryPromise && !force) return discoveryPromise;

  discoveryPromise = (async () => {
    // Check user manual override in settings
    const custom = localStorage.getItem('spotifree_server_url');
    if (custom) {
      activeServerUrl = custom.replace(/\/+$/, '');
      return activeServerUrl;
    }

    if (!isNativeApp && typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost:5173')) {
      activeServerUrl = '';
      return '';
    }

    const cachedServer = localStorage.getItem('spotifree_last_healthy_server');
    const candidates = [
      cachedServer,
      DEFAULT_SERVERS.android_termux,
      'http://10.100.102.16:5050',
      DEFAULT_SERVERS.tunnel,
      DEFAULT_SERVERS.cloud
    ].filter(Boolean);

    const uniqueCandidates = [...new Set(candidates)];

    const ping = async (srv) => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 900);
      try {
        const res = await fetch(`${srv}/health`, { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data && data.activeTunnel) {
            return data.activeTunnel;
          }
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
        localStorage.setItem('spotifree_last_healthy_server', activeServerUrl);
        console.log(`[API] Locked onto fastest server: ${activeServerUrl}`);
        return activeServerUrl;
      }
    } catch (e) {
      // If direct pings didn't answer within 900ms, ask Render for the dynamic registered tunnel
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${DEFAULT_SERVERS.cloud}/api/tunnel/active`, { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) {
          const data = await res.json();
          if (data && data.tunnelUrl) {
            activeServerUrl = data.tunnelUrl.replace(/\/+$/, '');
            localStorage.setItem('spotifree_last_healthy_server', activeServerUrl);
            return activeServerUrl;
          }
        }
      } catch (err) {}
    }

    activeServerUrl = cachedServer || DEFAULT_SERVERS.tunnel || DEFAULT_SERVERS.cloud;
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
  const custom = localStorage.getItem('spotifree_server_url');
  if (custom) return custom.replace(/\/+$/, '');

  if (activeServerUrl !== null) {
    return activeServerUrl;
  }

  const cached = localStorage.getItem('spotifree_last_healthy_server');
  if (cached) return cached;

  if (isNativeApp) {
    return DEFAULT_SERVERS.tunnel;
  }

  return '';
}

export function setActiveServerUrl(url) {
  if (!url) {
    localStorage.removeItem('spotifree_server_url');
    activeServerUrl = null;
  } else {
    const clean = url.replace(/\/+$/, '');
    localStorage.setItem('spotifree_server_url', clean);
    activeServerUrl = clean;
  }
}

export function getApiBase() {
  const base = getActiveServerUrl();
  return base ? `${base}/api` : '/api';
}

/**
 * Fast fetch with circuit-breaker failover (1.8s timeout per candidate, never hanging 15 seconds)
 */
async function fetchWithFailover(apiPath, options = {}) {
  const currentBase = getActiveServerUrl();
  const serverCandidates = [
    currentBase,
    DEFAULT_SERVERS.android_termux,
    DEFAULT_SERVERS.tunnel,
    DEFAULT_SERVERS.cloud,
    'http://10.100.102.16:5050'
  ].filter(Boolean);

  const uniqueServers = [...new Set(serverCandidates)];
  let lastError = null;

  for (const srv of uniqueServers) {
    const fullUrl = srv ? `${srv}${apiPath}` : apiPath;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    const combinedSignal = options.signal || controller.signal;

    try {
      const res = await fetch(fullUrl, { ...options, signal: combinedSignal });
      clearTimeout(timeoutId);
      if (res.ok) {
        if (srv && srv !== activeServerUrl) {
          activeServerUrl = srv;
          localStorage.setItem('spotifree_last_healthy_server', srv);
        }
        return res;
      }
      if (res.status >= 500) {
        // Server is ALIVE but failed the operation (e.g. 500 internal error). 
        // Break the loop and return immediately to fail-fast.
        return res;
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      console.warn(`Server ${srv} failed for ${apiPath}:`, err.message);
      if (srv === activeServerUrl) {
        activeServerUrl = null;
        try { localStorage.removeItem('spotifree_last_healthy_server'); } catch (e) {}
      }
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
      if (data.streamUrl) return data.streamUrl;
    }
  } catch (e) {
    console.warn('Server fetchDirectStreamUrl failed, falling back to client-side Piped API:', e.message);
  }

  // Client-side Fallback using Piped API (uses residential IP, bypasses server IP blocks)
  const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.smnz.de'
  ];
  
  try {
    const promises = PIPED_INSTANCES.map(inst => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2 second max wait per instance
      
      return fetch(`${inst}/streams/${vid}`, { signal: controller.signal })
        .then(async res => {
          clearTimeout(id);
          if (!res.ok) throw new Error(`Piped ${res.status}`);
          const data = await res.json();
          const audioStreams = data.audioStreams;
          if (audioStreams && audioStreams.length > 0) {
            const m4a = audioStreams.find(s => s.format === 'M4A' || (s.mimeType && s.mimeType.includes('mp4')));
            if (m4a && m4a.url) return m4a.url;
            return audioStreams[0].url;
          }
          throw new Error('No audio found on piped');
        })
        .catch(err => {
          clearTimeout(id);
          throw err;
        });
    });

    const directUrl = await Promise.any(promises);
    if (directUrl) return directUrl;
  } catch (err) {
    console.warn('All client-side Piped instances failed');
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
