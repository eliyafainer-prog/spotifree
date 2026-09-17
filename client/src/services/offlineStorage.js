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
 * Save track and audio blob to IndexedDB
 */
export async function saveTrackOffline(track, audioBlob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album || 'SpotiFree',
      thumbnail: track.thumbnail,
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
 * Get offline track by ID or by track metadata (fallback matching)
 */
export async function getOfflineTrack(trackOrId) {
  if (!trackOrId) return null;
  const id = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) return resolve(request.result);

        // Fallback: match by title and artist if track object was provided
        if (typeof trackOrId === 'object' && trackOrId.title) {
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            const all = allReq.result || [];
            const match = all.find(item =>
              item.title?.toLowerCase().trim() === trackOrId.title?.toLowerCase().trim() &&
              (!trackOrId.artist || item.artist?.toLowerCase().trim() === trackOrId.artist?.toLowerCase().trim())
            );
            resolve(match || null);
          };
          allReq.onerror = () => resolve(null);
        } else {
          resolve(null);
        }
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
