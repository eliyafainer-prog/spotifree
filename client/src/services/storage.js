const LIKED_SONGS_KEY = 'spotifree_liked_songs';
const PLAYLISTS_KEY = 'spotifree_playlists';
const RECENT_KEY = 'spotifree_recent_tracks';
const PLAYBACK_STATE_KEY = 'spotifree_last_playback';
const STUDIO_MIGRATION_KEY = 'spotifree_studio_migrated_v4';

// One-time migration: clear old non-studio streamableId on Spotify-imported tracks while keeping their cover artwork intact
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(STUDIO_MIGRATION_KEY) !== '1') {
    const cleanTrackList = (list) => {
      if (!Array.isArray(list)) return list;
      return list.map(t => {
        if (!t || typeof t !== 'object') return t;
        const origId = String(t.originalId || t.id || '');
        if ((origId.startsWith('sp_') || t.source === 'spotify') && !t.studioResolvedV4) {
          return {
            ...t,
            originalId: origId.startsWith('sp_') ? origId : (t.originalId || `sp_${t.spotifyId || t.title}`),
            id: origId.startsWith('sp_') ? origId : (t.originalId || `sp_${t.spotifyId || t.title}`),
            streamableId: null,
            studioResolvedV3: false,
            studioResolvedV4: false,
            durationSeconds: (t.durationSeconds && t.durationSeconds <= 420) ? t.durationSeconds : 0
          };
        }
        return t;
      });
    };

    const rawPlaylists = localStorage.getItem(PLAYLISTS_KEY);
    if (rawPlaylists) {
      const parsed = JSON.parse(rawPlaylists);
      if (Array.isArray(parsed)) {
        const migrated = parsed.map(p => (p && Array.isArray(p.tracks)) ? { ...p, tracks: cleanTrackList(p.tracks) } : p);
        localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(migrated));
      }
    }

    const rawLiked = localStorage.getItem(LIKED_SONGS_KEY);
    if (rawLiked) {
      const parsed = JSON.parse(rawLiked);
      if (Array.isArray(parsed)) {
        localStorage.setItem(LIKED_SONGS_KEY, JSON.stringify(cleanTrackList(parsed)));
      }
    }

    const rawPlayback = localStorage.getItem(PLAYBACK_STATE_KEY);
    if (rawPlayback) {
      const parsed = JSON.parse(rawPlayback);
      if (parsed && typeof parsed === 'object') {
        if (parsed.currentTrack) parsed.currentTrack = cleanTrackList([parsed.currentTrack])[0];
        if (Array.isArray(parsed.queue)) parsed.queue = cleanTrackList(parsed.queue);
        localStorage.setItem(PLAYBACK_STATE_KEY, JSON.stringify(parsed));
      }
    }

    localStorage.setItem(STUDIO_MIGRATION_KEY, '1');
  }
} catch (e) {}

export function sanitizeTrackForStorage(track) {
  if (!track || typeof track !== 'object') return track;
  const { audioBlob, ...rest } = track;
  return rest;
}

export function isSameTrack(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.streamableId && (a.streamableId === b.streamableId || a.streamableId === b.id)) return true;
  if (b.streamableId && b.streamableId === a.id) return true;
  if (a.originalId && (a.originalId === b.id || a.originalId === b.originalId)) return true;
  if (b.originalId && b.originalId === a.id) return true;
  if (a.title && b.title && a.artist && b.artist) {
    return (
      a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
      a.artist.trim().toLowerCase() === b.artist.trim().toLowerCase()
    );
  }
  return false;
}

export function getLikedSongs() {
  try {
    const raw = localStorage.getItem(LIKED_SONGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveLikedSongs(tracks) {
  try {
    if (!Array.isArray(tracks)) return;
    localStorage.setItem(LIKED_SONGS_KEY, JSON.stringify(tracks));
  } catch (e) {
    console.error('Failed to save liked songs:', e);
  }
}

export function toggleLikeSong(track) {
  if (!track) return { updated: getLikedSongs(), isLiked: false };
  const cleanTrack = sanitizeTrackForStorage(track);
  const current = getLikedSongs();
  const exists = current.some(t => isSameTrack(t, cleanTrack));
  let updated;
  if (exists) {
    updated = current.filter(t => !isSameTrack(t, cleanTrack));
  } else {
    updated = [cleanTrack, ...current];
  }
  saveLikedSongs(updated);
  return { updated, isLiked: !exists };
}

export function isSongLiked(track, likedSongs) {
  if (!track || !Array.isArray(likedSongs)) return false;
  return likedSongs.some(t => isSameTrack(t, track));
}

const DEFAULT_INITIAL_PLAYLISTS = [
  {
    id: 'pl_israeli_favorites',
    title: 'שירים שאני אוהב',
    type: 'playlist',
    tracks: [
      { id: 'sp_om_adam_mah_laasot', title: 'מה לעשות עם הזאב', artist: 'עלמה גוב', thumbnail: 'https://i.scdn.co/image/ab67616d0000b2734199fc9ee18e192ff83984ca', durationSeconds: 220 },
      { id: 'sp_cute_boy', title: 'Cute Boy', artist: 'נונו, שגיא קריב, Tel Aviv', thumbnail: 'https://i.scdn.co/image/ab67616d0000b273b75459392233ea25eb8f22fa', durationSeconds: 198 },
      { id: 'sp_earrings', title: 'Earrings', artist: 'Malcolm Todd', thumbnail: 'https://i.scdn.co/image/ab67616d0000b27329fbba4694b91448b30e01ea', durationSeconds: 167 },
      { id: 'sp_festigal_future', title: 'הילדים של העתיד', artist: 'אליאנה תדהר, תובל שפיר', thumbnail: 'https://i.scdn.co/image/ab67616d0000b27376a91d1e43d460cf6134b223', durationSeconds: 215 },
      { id: 'sp_balada_lasonen', title: 'בלדה לסוכן כפול', artist: 'משינה', thumbnail: 'https://i.scdn.co/image/ab67616d0000b2738fc9f122501a1d1ca933320f', durationSeconds: 205 },
      { id: 'sp_iloveit', title: 'I Love It (feat. Charli XCX)', artist: 'Icona Pop', thumbnail: 'https://i.scdn.co/image/ab67616d0000b273f5569420bf13e618e7e178fc', durationSeconds: 157 }
    ],
    createdAt: Date.now()
  }
];

export function getPlaylists() {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    if (!raw) {
      try {
        localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(DEFAULT_INITIAL_PLAYLISTS));
      } catch (e) {}
      return DEFAULT_INITIAL_PLAYLISTS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.filter(p => p && typeof p === 'object') : DEFAULT_INITIAL_PLAYLISTS;
  } catch {
    return DEFAULT_INITIAL_PLAYLISTS;
  }
}

export function savePlaylist(playlist) {
  if (!playlist) return getPlaylists();
  const playlists = getPlaylists();
  const index = playlists.findIndex(p => p.id === playlist.id);
  let updated;
  if (index >= 0) {
    updated = [...playlists];
    updated[index] = playlist;
  } else {
    updated = [playlist, ...playlists];
  }
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
  } catch (e) {}
  return updated;
}

export function deletePlaylist(playlistId) {
  const playlists = getPlaylists();
  const updated = playlists.filter(p => p.id !== playlistId);
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
  } catch (e) {}
  return updated;
}

export function getRecentTracks() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function addRecentTrack(track) {
  if (!track) return getRecentTracks();
  try {
    const current = getRecentTracks().filter(t => !isSameTrack(t, track));
    const updated = [track, ...current].slice(0, 30);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function updateTrackInPlaylists(resolvedTrack) {
  if (!resolvedTrack) return;
  try {
    const playlists = getPlaylists();
    let changed = false;
    const updated = playlists.map(p => {
      if (!Array.isArray(p.tracks)) return p;
      let pChanged = false;
      const newTracks = p.tracks.map(t => {
        if (isSameTrack(t, resolvedTrack)) {
          pChanged = true;
          changed = true;
          const finalSec = (t.durationSeconds && t.durationSeconds >= 35 && t.durationSeconds <= 420)
            ? t.durationSeconds
            : (resolvedTrack.durationSeconds || t.durationSeconds || 0);
          const mins = Math.floor(finalSec / 60);
          const secs = Math.round(finalSec % 60);
          const finalDurStr = finalSec > 0 ? `${mins}:${secs < 10 ? '0' : ''}${secs}` : (t.duration || '0:00');
          return {
            ...t,
            originalId: t.originalId || t.id,
            streamableId: resolvedTrack.streamableId || resolvedTrack.id,
            id: resolvedTrack.streamableId || resolvedTrack.id,
            thumbnail: resolvedTrack.thumbnail || t.thumbnail,
            hasCustomArtwork: true,
            studioResolvedV3: true,
            studioResolvedV4: true,
            duration: finalDurStr,
            durationSeconds: finalSec
          };
        }
        return t;
      });
      return pChanged ? { ...p, tracks: newTracks } : p;
    });

    if (changed) {
      localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    }
  } catch (e) {}
}

export function getLastPlaybackState() {
  try {
    const raw = localStorage.getItem(PLAYBACK_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLastPlaybackState(state) {
  try {
    if (!state || typeof state !== 'object') return;
    localStorage.setItem(PLAYBACK_STATE_KEY, JSON.stringify(state));
  } catch (e) {}
}

export function isTrackInPlaylist(playlist, track) {
  if (!playlist || !Array.isArray(playlist.tracks) || !track) return false;
  return playlist.tracks.some(t => isSameTrack(t, track));
}

export function addTrackToPlaylist(playlistId, track) {
  try {
    const cleanTrack = sanitizeTrackForStorage(track);
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return { updated: playlists, success: false, reason: 'Playlist not found' };

    const playlist = { ...playlists[index] };
    const existingTracks = playlist.tracks || [];

    if (isTrackInPlaylist(playlist, cleanTrack)) {
      return { updated: playlists, success: false, alreadyExists: true };
    }

    const newTracks = [...existingTracks, cleanTrack];
    playlist.tracks = newTracks;
    playlist.trackCount = newTracks.length;
    if (!playlist.cover && cleanTrack.thumbnail) {
      playlist.cover = cleanTrack.thumbnail;
    }

    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return { updated, success: true, playlist };
  } catch (e) {
    console.error('Failed to add track to playlist:', e);
    return { updated: getPlaylists(), success: false };
  }
}

export function removeTrackFromPlaylist(playlistId, trackId) {
  try {
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return playlists;

    const playlist = { ...playlists[index] };
    const filteredTracks = (playlist.tracks || []).filter(
      t => t.id !== trackId && t.streamableId !== trackId
    );

    playlist.tracks = filteredTracks;
    playlist.trackCount = filteredTracks.length;

    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to remove track from playlist:', e);
    return getPlaylists();
  }
}

export function createCustomPlaylist(title, description = '', initialTracks = []) {
  try {
    const playlists = getPlaylists();
    const cleanTracks = Array.isArray(initialTracks)
      ? initialTracks.filter(Boolean).map(sanitizeTrackForStorage)
      : [];
    const firstCover = cleanTracks.find(t => t?.thumbnail)?.thumbnail || '';
    const newPlaylist = {
      id: 'custom_' + Date.now(),
      title: title.trim(),
      description: description.trim(),
      type: 'playlist',
      cover: firstCover,
      tracks: cleanTracks,
      trackCount: cleanTracks.length,
      createdAt: new Date().toISOString()
    };

    const updated = [newPlaylist, ...playlists];
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return { updated, playlist: newPlaylist };
  } catch (e) {
    console.error('Failed to create playlist:', e);
    return { updated: getPlaylists(), playlist: null };
  }
}

/**
 * Reorder tracks in a custom playlist and save to storage
 */
export function reorderPlaylistTracks(playlistId, newTracks) {
  try {
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return playlists;

    const playlist = { ...playlists[index], tracks: newTracks, trackCount: newTracks.length };
    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to reorder playlist tracks:', e);
    return getPlaylists();
  }
}

/**
 * Reorder tracks in liked songs and save to storage
 */
export function reorderLikedSongs(newTracks) {
  try {
    saveLikedSongs(newTracks);
    return newTracks;
  } catch (e) {
    console.error('Failed to reorder liked songs:', e);
    return getLikedSongs();
  }
}

/**
 * Rename a custom playlist
 */
export function renamePlaylist(playlistId, newTitle) {
  try {
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return playlists;

    const playlist = { ...playlists[index], title: newTitle.trim() };
    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to rename playlist:', e);
    return getPlaylists();
  }
}

/**
 * Export all user playlists and liked songs to a JSON file format
 */
export function exportBackupData() {
  const data = {
    version: 1,
    exportDate: new Date().toISOString(),
    playlists: getPlaylists(),
    likedSongs: getLikedSongs()
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Import user playlists and liked songs from backup JSON string
 * returns { playlistsCount, likedSongsCount }
 */
export function importBackupData(jsonString) {
  const parsed = JSON.parse(jsonString);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('קובץ גיבוי לא תקין');
  }

  let importedPlaylistsCount = 0;
  let importedLikedCount = 0;

  // Import playlists
  if (Array.isArray(parsed.playlists)) {
    const existingPlaylists = getPlaylists();
    const existingIds = new Set(existingPlaylists.map(p => p.id));
    const existingTitles = new Set(existingPlaylists.map(p => (p.title || p.name || '').trim().toLowerCase()));

    for (const p of parsed.playlists) {
      const pTitle = (p.title || p.name || '').trim();
      if (pTitle && !existingIds.has(p.id) && !existingTitles.has(pTitle.toLowerCase())) {
        existingPlaylists.push(p);
        existingIds.add(p.id);
        existingTitles.add(pTitle.toLowerCase());
        importedPlaylistsCount++;
      }
    }
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(existingPlaylists));
  }

  // Import liked songs
  if (Array.isArray(parsed.likedSongs)) {
    const existingLiked = getLikedSongs();
    for (const track of parsed.likedSongs) {
      if (track && !existingLiked.some(t => isSameTrack(t, track))) {
        existingLiked.push(sanitizeTrackForStorage(track));
        importedLikedCount++;
      }
    }
    saveLikedSongs(existingLiked);
  }

  return {
    playlistsCount: importedPlaylistsCount,
    likedSongsCount: importedLikedCount
  };
}
