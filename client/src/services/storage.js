const LIKED_SONGS_KEY = 'spotifree_liked_songs';
const PLAYLISTS_KEY = 'spotifree_playlists';
const RECENT_KEY = 'spotifree_recent_tracks';

export function getLikedSongs() {
  try {
    const raw = localStorage.getItem(LIKED_SONGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLikedSongs(tracks) {
  try {
    localStorage.setItem(LIKED_SONGS_KEY, JSON.stringify(tracks));
  } catch (e) {
    console.error('Failed to save liked songs:', e);
  }
}

export function toggleLikeSong(track) {
  const current = getLikedSongs();
  const exists = current.some(t => t.id === track.id || (t.title === track.title && t.artist === track.artist));
  let updated;
  if (exists) {
    updated = current.filter(t => t.id !== track.id && !(t.title === track.title && t.artist === track.artist));
  } else {
    updated = [track, ...current];
  }
  saveLikedSongs(updated);
  return { updated, isLiked: !exists };
}

export function isSongLiked(track, likedSongs) {
  if (!track) return false;
  return likedSongs.some(t => t.id === track.id || (t.title === track.title && t.artist === track.artist));
}

export function getPlaylists() {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePlaylist(playlist) {
  const playlists = getPlaylists();
  const index = playlists.findIndex(p => p.id === playlist.id);
  let updated;
  if (index >= 0) {
    updated = [...playlists];
    updated[index] = playlist;
  } else {
    updated = [playlist, ...playlists];
  }
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
  return updated;
}

export function deletePlaylist(playlistId) {
  const playlists = getPlaylists();
  const updated = playlists.filter(p => p.id !== playlistId);
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
  return updated;
}

export function getRecentTracks() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentTrack(track) {
  try {
    const current = getRecentTracks().filter(t => t.id !== track.id);
    const updated = [track, ...current].slice(0, 30);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}
