const LIKED_SONGS_KEY = 'spotifree_liked_songs';
const PLAYLISTS_KEY = 'spotifree_playlists';
const RECENT_KEY = 'spotifree_recent_tracks';
const PLAYBACK_STATE_KEY = 'spotifree_last_playback';
const STUDIO_MIGRATION_KEY = 'spotifree_studio_migrated_v3';

// One-time migration: clear old non-studio streamableId on Spotify-imported tracks while keeping their cover artwork intact
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(STUDIO_MIGRATION_KEY) !== '1') {
    const cleanTrackList = (list) => {
      if (!Array.isArray(list)) return list;
      return list.map(t => {
        if (!t || typeof t !== 'object') return t;
        const origId = String(t.originalId || t.id || '');
        if (origId.startsWith('sp_') && !t.studioResolvedV3) {
          return {
            ...t,
            originalId: origId,
            id: origId,
            streamableId: null,
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
  const current = getLikedSongs();
  const exists = current.some(t => isSameTrack(t, track));
  let updated;
  if (exists) {
    updated = current.filter(t => !isSameTrack(t, track));
  } else {
    updated = [track, ...current];
  }
  saveLikedSongs(updated);
  return { updated, isLiked: !exists };
}

export function isSongLiked(track, likedSongs) {
  if (!track || !Array.isArray(likedSongs)) return false;
  return likedSongs.some(t => isSameTrack(t, track));
}

export function getPlaylists() {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(p => p && typeof p === 'object') : [];
  } catch {
    return [];
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
          return {
            ...t,
            originalId: t.originalId || t.id,
            streamableId: resolvedTrack.streamableId || resolvedTrack.id,
            id: resolvedTrack.streamableId || resolvedTrack.id,
            thumbnail: resolvedTrack.thumbnail || t.thumbnail,
            hasCustomArtwork: true,
            studioResolvedV3: true,
            durationSeconds: (t.durationSeconds && t.durationSeconds <= 420)
              ? t.durationSeconds
              : (resolvedTrack.durationSeconds || t.durationSeconds)
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
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return { updated: playlists, success: false, reason: 'Playlist not found' };

    const playlist = { ...playlists[index] };
    const existingTracks = playlist.tracks || [];

    if (isTrackInPlaylist(playlist, track)) {
      return { updated: playlists, success: false, alreadyExists: true };
    }

    const newTracks = [...existingTracks, track];
    playlist.tracks = newTracks;
    playlist.trackCount = newTracks.length;
    if (!playlist.cover && track.thumbnail) {
      playlist.cover = track.thumbnail;
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

export function createCustomPlaylist(title, description = '') {
  try {
    const playlists = getPlaylists();
    const newPlaylist = {
      id: 'custom_' + Date.now(),
      title: title.trim(),
      description: description.trim(),
      type: 'playlist',
      cover: '',
      tracks: [],
      trackCount: 0,
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

