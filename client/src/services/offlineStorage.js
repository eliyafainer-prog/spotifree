const DB_NAME = 'SpotiFreeOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'offline_tracks';

/**
 * Open or upgrade IndexedDB database
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB is not supported on this browser.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('artist', 'artist', { unique: false });
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Convert cover image URL to a self-contained Data URL so cover art works 100% offline without internet
 */
async function fetchCoverAsDataUrl(url) {
  if (!url || url.startsWith('data:')) return url || '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return url;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : url);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

/**
 * Save track and audio blob to IndexedDB (with cached offline artwork and all ID aliases)
 */
export async function saveTrackOffline(track, audioBlob) {
  if (!track || !audioBlob) throw new Error('Track and audioBlob are required');
  const cachedThumb = await fetchCoverAsDataUrl(track.thumbnail);
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const primaryId = track.streamableId && !String(track.streamableId).startsWith('sp_')
      ? track.streamableId
      : track.id;

    const record = {
      id: primaryId,
      streamableId: track.streamableId || primaryId,
      originalId: track.originalId || track.id,
      title: track.title,
      artist: track.artist,
      album: track.album || 'SpotiFree',
      thumbnail: cachedThumb || track.thumbnail || '',
      duration: track.duration,
      durationSeconds: track.durationSeconds,
      audioBlob: audioBlob,
      sizeBytes: audioBlob.size,
      downloadedAt: Date.now()
    };

    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Build a Set of all IDs (id, streamableId, originalId) for downloaded tracks
 */
export function buildDownloadedIdSet(tracks = []) {
  const set = new Set();
  for (const t of tracks) {
    if (!t) continue;
    if (t.id) set.add(t.id);
    if (t.streamableId) set.add(t.streamableId);
    if (t.originalId) set.add(t.originalId);
  }
  return set;
}

/**
 * Check if a track matches any ID in a downloadedIds Set
 */
export function isTrackInIdSet(track, idSet) {
  if (!track || !idSet) return false;
  return Boolean(
    (track.id && idSet.has(track.id)) ||
    (track.streamableId && idSet.has(track.streamableId)) ||
    (track.originalId && idSet.has(track.originalId))
  );
}

/**
 * Get offline track by ID or by track metadata (supports id, streamableId, originalId, and title+artist fallback)
 */
export async function getOfflineTrack(trackOrId) {
  if (!trackOrId) return null;
  const lookupId = typeof trackOrId === 'string'
    ? trackOrId
    : (trackOrId.streamableId || trackOrId.id);

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(lookupId);

      request.onsuccess = () => {
        if (request.result) return resolve(request.result);

        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const all = allReq.result || [];
          if (typeof trackOrId === 'object') {
            const candidateIds = [trackOrId.id, trackOrId.streamableId, trackOrId.originalId].filter(Boolean);
            const idMatch = all.find(item =>
              candidateIds.includes(item.id) ||
              candidateIds.includes(item.streamableId) ||
              candidateIds.includes(item.originalId)
            );
            if (idMatch) return resolve(idMatch);

            if (trackOrId.title) {
              const titleMatch = all.find(item =>
                item.title?.toLowerCase().trim() === trackOrId.title?.toLowerCase().trim() &&
                (!trackOrId.artist || item.artist?.toLowerCase().trim() === trackOrId.artist?.toLowerCase().trim())
              );
              if (titleMatch) return resolve(titleMatch);
            }
          } else {
            const strMatch = all.find(item => item.streamableId === lookupId || item.originalId === lookupId);
            if (strMatch) return resolve(strMatch);
          }
          resolve(null);
        };
        allReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Check if a track is already downloaded
 */
export async function isTrackDownloaded(trackOrId) {
  const track = await getOfflineTrack(trackOrId);
  return !!track;
}

/**
 * Get all downloaded offline tracks
 */
export async function getAllOfflineTracks() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result || [];
        resolve(results.sort((a, b) => b.downloadedAt - a.downloadedAt));
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get offline tracks:', err);
    return [];
  }
}

/**
 * Delete a downloaded track
 */
export async function deleteOfflineTrack(trackId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(trackId);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Format bytes to readable MB string
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Calculate total offline storage used
 */
export async function getOfflineStorageUsage() {
  const tracks = await getAllOfflineTracks();
  const totalBytes = tracks.reduce((acc, t) => acc + (t.sizeBytes || 0), 0);
  return {
    totalBytes,
    formatted: formatBytes(totalBytes),
    count: tracks.length
  };
}
