import React from 'react';
import { Play, Trash2, Music, Clock } from 'lucide-react';
import { TrackRow } from './TrackRow';

export function PlaylistView({
  playlist,
  currentTrack,
  isPlaying,
  isLoading = false,
  onPlayTrack,
  likedSongs,
  onToggleLike,
  onDeletePlaylist,
  downloadedIds = new Set(),
  downloadingIds = new Set(),
  onDownloadTrack
}) {
  if (!playlist) return null;

  const tracks = playlist.tracks || [];

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      onPlayTrack(tracks[0], tracks, 0);
    }
  };

  const isAlbum = playlist.type?.toLowerCase() === 'album';

  return (
    <div className="flex flex-col gap-6 animate-fadeIn pb-16">
      {/* Playlist Hero Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 bg-gradient-to-b from-spotify-highlight/70 via-spotify-elevated/40 to-transparent rounded-2xl border border-white/5 shadow-2xl">
        <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-xl bg-spotify-elevated shadow-[0_12px_40px_rgba(0,0,0,0.8)] overflow-hidden flex-shrink-0 border border-white/10">
          {playlist.cover ? (
            <img src={playlist.cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-spotify-subtext bg-gradient-to-br from-spotify-elevated to-spotify-dark">
              <Music className="w-20 h-20" />
            </div>
          )}
        </div>

        <div className="flex flex-col items-center sm:items-start text-center sm:text-right flex-1 min-w-0">
          <span className="text-xs uppercase font-bold tracking-wider text-spotify-green">
            {isAlbum ? 'אלבום' : 'פלייליסט'}
          </span>
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white mt-1 mb-3 truncate max-w-full">
            {playlist.title}
          </h1>
          <div className="text-xs sm:text-sm text-spotify-subtext flex items-center gap-2">
            <span className="font-semibold text-white">SpotiFree</span>
            <span>•</span>
            <span>{tracks.length} שירים</span>
          </div>
        </div>
      </div>

      {/* Action Bar (Big Play Button, Delete) */}
      <div className="flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={handlePlayAll}
            disabled={tracks.length === 0}
            className="w-14 h-14 rounded-full bg-spotify-green hover:bg-spotify-green-hover text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl shadow-spotify-green/25"
          >
            <Play className="w-6 h-6 fill-current translate-x-0.5" />
          </button>
        </div>

        {onDeletePlaylist && playlist.id !== 'liked' && (
          <button
            onClick={() => onDeletePlaylist(playlist.id)}
            title="מחק פלייליסט זה מהספרייה"
            className="p-2 text-spotify-subtext hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Table Header (Desktop RTL) */}
      <div className="hidden md:flex items-center justify-between px-4 py-2 border-b border-spotify-border/40 text-xs font-semibold text-spotify-subtext uppercase tracking-wider">
        <div className="flex items-center gap-4 flex-1">
          <span className="w-6 text-center">#</span>
          <span>שם השיר / אמן</span>
        </div>
        <div className="flex items-center gap-4 pl-4">
          <Clock className="w-4 h-4" />
        </div>
      </div>

      {/* Track List */}
      <div className="flex flex-col gap-1 px-1">
        {tracks.length === 0 ? (
          <div className="p-12 text-center text-spotify-subtext">
            אין שירים עדיין.
          </div>
        ) : (
          tracks.map((track, idx) => (
            <TrackRow
              key={track.id || idx}
              index={idx}
              track={track}
              isCurrentTrack={currentTrack?.id === track.id}
              isPlaying={isPlaying}
              isLoading={isLoading}
              onPlay={(t) => onPlayTrack(t, tracks, idx)}
              isLiked={likedSongs.some(s => s.id === track.id || (s.title === track.title && s.artist === track.artist))}
              onToggleLike={onToggleLike}
              isDownloaded={downloadedIds?.has(track.id)}
              isDownloading={downloadingIds?.has(track.id)}
              onDownload={onDownloadTrack}
            />
          ))
        )}
      </div>
    </div>
  );
}
