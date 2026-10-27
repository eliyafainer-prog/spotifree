const DB_NAME = 'SpotiFreeOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'offline_tracks';

export const MIN_AUDIO_SIZE_BYTES = 50 * 1024; // 50 KB

let cachedDbPromise = null;

// Synchronous in-memory index cache for 0ms instant offline checks (preserves browser transient user activation!)
const offlineIndexSet = new Set();
let isOfflineCachePopulated = false;

/**
 * Validate that an offline track record contains a valid, playable audio blob (>= 50KB).
 * If corrupted/empty, deletes the record from IndexedDB and memory index.
 */
function isRecordValidAudio(record) {
  if (!record || !record.audioBlob) return false;
  const size = record.audioBlob.size !== undefined ? record.audioBlob.size : (record.sizeBytes || 0);
  return typeof size === 'number' && size >= MIN_AUDIO_SIZE_BYTES;
}

function addToOfflineIndex(item) {
  if (!item) return;
  const ids = [item.id, item.streamableId, item.originalId, item.spotifyId, item.videoId].filter(Boolean).map(String);
  for (const id of ids) {
    offlineIndexSet.add(id);
  }
  if (item.title) {
    const key = `${normMetaStr(item.title)}:::${normMetaStr(item.artist)}`;
    offlineIndexSet.add(key);
  }
}

function removeFromOfflineIndex(trackId) {
  if (!trackId) return;
  offlineIndexSet.delete(String(trackId));
}

/**
 * Pre-populate the in-memory offline index on module load
 */
export async function initOfflineCache() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        offlineIndexSet.clear();
        const items = req.result || [];
        for (const item of items) {
          if (isRecordValidAudio(item)) {
            addToOfflineIndex(item);
          } else if (item?.id) {
            deleteOfflineTrack(item.id).catch(() => {});
          }
        }
        isOfflineCachePopulated = true;
        resolve(true);
      };
      req.onerror = () => {
        isOfflineCachePopulated = true;
        resolve(false);
      };
    });
  } catch {
    isOfflineCachePopulated = true;
    return false;
  }
}

// Auto-run in browser context
if (typeof window !== 'undefined') {
  setTimeout(() => initOfflineCache(), 10);
}

/**
 * Synchronous instant check (0ms) to know if a track might exist in offline storage
 */
export function isOfflineTrackCachedSync(trackOrId) {
  if (!trackOrId || !isOfflineCachePopulated) return false;
  if (typeof trackOrId === 'string') {
    return offlineIndexSet.has(trackOrId);
  }
  const candidateIds = [trackOrId.streamableId, trackOrId.id, trackOrId.originalId, trackOrId.spotifyId, trackOrId.videoId].filter(Boolean).map(String);
  for (const cid of candidateIds) {
    if (offlineIndexSet.has(cid)) return true;
  }
  if (trackOrId.title) {
    const key = `${normMetaStr(trackOrId.title)}:::${normMetaStr(trackOrId.artist)}`;
    if (offlineIndexSet.has(key)) return true;
  }
  return false;
}

/**
 * Open or upgrade IndexedDB database (reuses singleton connection for 1ms lookups)
 */
function openDB() {
  if (cachedDbPromise) return cachedDbPromise;

  cachedDbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      cachedDbPromise = null;
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

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        cachedDbPromise = null;
      };
      db.onclose = () => {
        cachedDbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      cachedDbPromise = null;
      reject(request.error);
    };
  });

  return cachedDbPromise;
}

/**
 * Safe Object URL helper to prevent memory leaks across offline playback
 */
export function revokeOfflineObjectUrl(objectUrl) {
  if (!objectUrl || typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(objectUrl);
  } catch (e) {}
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
 * Save track, audio blob, and optional lyrics data to IndexedDB (with cached offline artwork and all ID aliases)
 */
export async function saveTrackOffline(track, audioBlob, lyricsData = null) {
  if (!track || !audioBlob) {
    throw new Error('Track and audioBlob are required for offline saving');
  }

  // Validate Blob / ArrayBuffer size (must be at least 50KB to ensure valid audio data and prevent saving 0:00 corrupted files)
  const MIN_AUDIO_SIZE_BYTES = 50 * 1024; // 50 KB
  const blobSize = audioBlob.size !== undefined ? audioBlob.size : (audioBlob.byteLength || 0);

  if (!blobSize || blobSize < MIN_AUDIO_SIZE_BYTES) {
    throw new Error(`קובץ השמע אינו תקין או קטן מדי (${Math.round((blobSize || 0) / 1024)}KB). נדרש לפחות 50KB.`);
  }

  // Ensure audioBlob has explicit audio MIME type
  const finalBlob = audioBlob.type && audioBlob.type.startsWith('audio/')
    ? audioBlob
    : new Blob([audioBlob], { type: 'audio/mpeg' });

  // Secondary verification on constructed blob size
  if (finalBlob.size < MIN_AUDIO_SIZE_BYTES) {
    throw new Error(`קובץ השמע פגום או ריק (${Math.round(finalBlob.size / 1024)}KB). ההורדה לא הושלמה.`);
  }

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
      spotifyId: track.spotifyId || (String(track.id).startsWith('sp_') ? track.id : null),
      videoId: track.videoId || null,
      title: track.title,
      artist: track.artist,
      album: track.album || 'SpotiFree',
      thumbnail: cachedThumb || track.thumbnail || '',
      duration: track.duration,
      durationSeconds: track.durationSeconds,
      audioBlob: finalBlob,
      sizeBytes: finalBlob.size,
      lyrics: lyricsData || track.lyrics || null,
      downloadedAt: Date.now()
    };

    const request = store.put(record);
    request.onsuccess = () => {
      addToOfflineIndex(record);
      resolve(record);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update lyrics on an already-saved offline track record
 */
export async function saveOfflineTrackLyrics(trackOrId, lyricsData) {
  if (!trackOrId || !lyricsData) return false;
  try {
    const existing = await getOfflineTrack(trackOrId);
    if (!existing) return false;
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const updated = { ...existing, lyrics: lyricsData };
      const req = store.put(updated);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

function normMetaStr(str) {
  return String(str || '').toLowerCase().replace(/[\s\-_'".()\[\],]+/g, ' ').trim();
}

export function getTrackNormKey(track) {
  if (!track || !track.title) return null;
  const title = normMetaStr(track.title);
  const artist = normMetaStr(track.artist);
  return title ? `meta:::${title}:::${artist}` : null;
}

/**
 * Build a Set of all IDs (id, streamableId, originalId, spotifyId, videoId, and normalized title+artist key) for downloaded tracks
 */
export function buildDownloadedIdSet(tracks = []) {
  const set = new Set();
  for (const t of tracks) {
    if (!t) continue;
    if (t.id) set.add(String(t.id));
    if (t.streamableId) set.add(String(t.streamableId));
    if (t.originalId) set.add(String(t.originalId));
    if (t.spotifyId) set.add(String(t.spotifyId));
    if (t.videoId) set.add(String(t.videoId));
    const normKey = getTrackNormKey(t);
    if (normKey) set.add(normKey);
  }
  return set;
}

/**
 * Check if a track matches any ID or normalized metadata key in a downloadedIds Set
 */
export function isTrackInIdSet(track, idSet) {
  if (!track || !idSet) return false;
  const normKey = getTrackNormKey(track);
  return Boolean(
    (track.id && idSet.has(String(track.id))) ||
    (track.streamableId && idSet.has(String(track.streamableId))) ||
    (track.originalId && idSet.has(String(track.originalId))) ||
    (track.spotifyId && idSet.has(String(track.spotifyId))) ||
    (track.videoId && idSet.has(String(track.videoId))) ||
    (normKey && idSet.has(normKey))
  );
}

/**
 * Get offline track by ID or by track metadata (supports id, streamableId, originalId, spotifyId, videoId, and normalized title+artist fallback)
 */
export async function getOfflineTrack(trackOrId) {
  if (!trackOrId) return null;

  // Instant (0ms) synchronous fast-path: if offline cache is populated and track is not in it, skip IndexedDB completely!
  if (isOfflineCachePopulated && !isOfflineTrackCachedSync(trackOrId)) {
    return null;
  }

  const isObj = typeof trackOrId === 'object';
  const lookupIds = isObj
    ? [trackOrId.streamableId, trackOrId.id, trackOrId.originalId, trackOrId.spotifyId, trackOrId.videoId].filter(Boolean)
    : [trackOrId];

  if (lookupIds.length === 0) return null;

  try {
    const db = await openDB();
    const handleResult = (record) => {
      if (!record) return null;
      if (!isRecordValidAudio(record)) {
        console.warn(`[OfflineStorage] Auto-cleaning corrupt/short offline record: ${record.id} (${record.title})`);
        if (record.id) {
          deleteOfflineTrack(record.id).catch(() => {});
        }
        return null;
      }
      return record;
    };

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const searchAll = () => {
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const all = allReq.result || [];
          if (isObj) {
            const candidateIds = lookupIds.map(String);
            const idMatch = all.find(item => {
              const itemIds = [item.id, item.streamableId, item.originalId, item.spotifyId, item.videoId].filter(Boolean).map(String);
              return candidateIds.some(cid => itemIds.includes(cid));
            });
            if (idMatch) return resolve(handleResult(idMatch));

            if (trackOrId.title) {
              const targetTitle = normMetaStr(trackOrId.title);
              const targetArtist = normMetaStr(trackOrId.artist);
              const titleMatch = all.find(item => {
                const iTitle = normMetaStr(item.title);
                const iArtist = normMetaStr(item.artist);
                const titleEqual = iTitle === targetTitle || (targetTitle.length > 5 && (iTitle.includes(targetTitle) || targetTitle.includes(iTitle)));
                if (!titleEqual) return false;
                if (!targetArtist || !iArtist) return true;
                return iArtist === targetArtist || iArtist.includes(targetArtist) || targetArtist.includes(iArtist);
              });
              if (titleMatch) return resolve(handleResult(titleMatch));
            }
          } else {
            const strId = String(trackOrId);
            const strMatch = all.find(item => {
              const itemIds = [item.id, item.streamableId, item.originalId, item.spotifyId, item.videoId].filter(Boolean).map(String);
              return itemIds.includes(strId);
            });
            if (strMatch) return resolve(handleResult(strMatch));
          }
          resolve(null);
        };
        allReq.onerror = () => resolve(null);
      };

      const request = store.get(lookupIds[0]);
      request.onsuccess = () => {
        if (request.result) return resolve(handleResult(request.result));
        searchAll();
      };
      request.onerror = () => searchAll();
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

const OFFLINE_ORDER_KEY = 'spotifree_offline_custom_order';

/**
 * Save custom track order for Offline mode
 */
export function saveOfflineTracksOrder(tracks = []) {
  try {
    const ids = tracks.map(t => t?.id).filter(Boolean);
    localStorage.setItem(OFFLINE_ORDER_KEY, JSON.stringify(ids));
  } catch (e) {}
}

/**
 * Get all downloaded offline tracks (preserving custom order if reordered by user)
 */
export async function getAllOfflineTracks() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const rawResults = request.result || [];
        offlineIndexSet.clear();
        const validResults = [];

        for (const item of rawResults) {
          if (isRecordValidAudio(item)) {
            addToOfflineIndex(item);
            validResults.push(item);
          } else if (item?.id) {
            console.warn(`[OfflineStorage] Cleaning invalid/empty offline record: ${item.id} (${item.title})`);
            deleteOfflineTrack(item.id).catch(() => {});
          }
        }

        isOfflineCachePopulated = true;
        const results = validResults.sort((a, b) => b.downloadedAt - a.downloadedAt);
        try {
          const rawOrder = localStorage.getItem(OFFLINE_ORDER_KEY);
          if (rawOrder) {
            const orderIds = JSON.parse(rawOrder);
            if (Array.isArray(orderIds) && orderIds.length > 0) {
              const orderMap = new Map(orderIds.map((id, idx) => [id, idx]));
              results.sort((a, b) => {
                const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : -1;
                const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : -1;
                if (idxA === -1 && idxB === -1) return b.downloadedAt - a.downloadedAt;
                if (idxA === -1) return -1;
                if (idxB === -1) return 1;
                return idxA - idxB;
              });
            }
          }
        } catch (e) {}
        resolve(results);
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

    request.onsuccess = () => {
      removeFromOfflineIndex(trackId);
      resolve(true);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Read audio file duration using a temporary HTMLAudioElement
 */
function probeAudioDuration(blob) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob);
      const tempAudio = new Audio();
      const cleanup = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(0);
      }, 2500);
      tempAudio.onloadedmetadata = () => {
        clearTimeout(timer);
        const dur = isFinite(tempAudio.duration) ? Math.round(tempAudio.duration) : 0;
        cleanup();
        resolve(dur);
      };
      tempAudio.onerror = () => {
        clearTimeout(timer);
        cleanup();
        resolve(0);
      };
      tempAudio.src = url;
    } catch {
      resolve(0);
    }
  });
}

function formatSecToDuration(secs) {
  if (!secs || secs <= 0) return '3:30';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Import local audio files (.mp3, .m4a, .wav, .ogg, .flac) from user's device into Offline Storage
 */
export async function importLocalAudioFiles(fileList) {
  if (!fileList || fileList.length === 0) return [];
  const imported = [];

  for (const file of Array.from(fileList)) {
    if (!file) continue;
    const rawName = file.name.replace(/\.[^/.]+$/, '').trim();
    let artist = 'קובץ מקומי';
    let title = rawName;

    if (rawName.includes(' - ')) {
      const parts = rawName.split(' - ');
      artist = parts[0].trim() || 'קובץ מקומי';
      title = parts.slice(1).join(' - ').trim() || rawName;
    }

    const durationSeconds = await probeAudioDuration(file);
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const trackObj = {
      id,
      streamableId: id,
      originalId: id,
      title,
      artist,
      album: 'קבצים מקומיים',
      thumbnail: '',
      duration: formatSecToDuration(durationSeconds),
      durationSeconds: durationSeconds || 210,
      isLocalFile: true
    };

    const saved = await saveTrackOffline(trackObj, file, null);
    imported.push(saved);
  }

  return imported;
}

/**
 * Export an offline track's audioBlob to the user's device as an MP3 file
 */
export async function exportOfflineTrackToDevice(track) {
  const record = track?.audioBlob ? track : await getOfflineTrack(track);
  if (!record || !record.audioBlob) {
    throw new Error('לא נמצא קובץ שמע שמור עבור שיר זה');
  }

  const safeTitle = `${record.artist || ''} - ${record.title || 'Track'}`
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();
  const filename = `${safeTitle || 'SpotiFree-Track'}.mp3`;

  const url = URL.createObjectURL(record.audioBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
 * Calculate total storage used by offline tracks
 */
export async function getOfflineStorageUsage() {
  const tracks = await getAllOfflineTracks();
  const totalBytes = tracks.reduce((sum, t) => sum + (t.sizeBytes || 0), 0);
  return {
    count: tracks.length,
    bytes: totalBytes,
    totalBytes,
    formatted: formatBytes(totalBytes),
    formattedSize: formatBytes(totalBytes)
  };
}

export const getOfflineStorageStats = getOfflineStorageUsage;

