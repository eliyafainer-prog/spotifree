import React from 'react';
import { Play, Trash2, Music, Clock } from 'lucide-react';
import { TrackRow } from './TrackRow';

export function PlaylistView({
  playlist,
  currentTrack,
  isPlaying,
  onPlayTrack,
  likedSongs,
  onToggleLike,
  onDeletePlaylist
}) {
  if (!playlist) return null;

  const tracks = playlist.tracks || [];

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      onPlayTrack(tracks[0], tracks, 0);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fadeIn pb-12">
      {/* Playlist Hero Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 bg-gradient-to-b from-spotify-highlight/60 to-transparent rounded-xl">
        <div className="w-48 h-48 sm:w-52 sm:h-52 rounded-lg bg-spotify-elevated shadow-2xl overflow-hidden flex-shrink-0">
          {playlist.cover ? (
            <img src={playlist.cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
              <Music className="w-16 h-16" />
            </div>
          )}
        </div>

        <div className="flex flex-col items-center sm:items-start text-center sm:text-right flex-1 min-w-0">
          <span className="text-xs uppercase font-bold tracking-wider text-spotify-subtext">
            {playlist.type ? `פלייליסט (${playlist.type.toUpperCase()})` : 'פלייליסט אישי'}
          </span>
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white mt-1 mb-3 truncate max-w-full">
            {playlist.title}
          </h1>
          <div className="text-xs sm:text-sm text-spotify-subtext flex items-center gap-2">
            <span className="font-semibold text-white">SpotiFree Library</span>
            <span>•</span>
            <span>{tracks.length} שירים</span>
          </div>
        </div>
      </div>

      {/* Action Bar (Play All, Delete) */}
      <div className="flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={handlePlayAll}
            disabled={tracks.length === 0}
            className="w-14 h-14 rounded-full bg-spotify-green hover:bg-spotify-green-hover text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-spotify-green/20"
          >
            <Play className="w-6 h-6 fill-current translate-x-0.5" />
          </button>
        </div>

        {onDeletePlaylist && playlist.id !== 'liked' && (
          <button
            onClick={() => onDeletePlaylist(playlist.id)}
            title="מחק פלייליסט זה"
            className="p-2 text-spotify-subtext hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Table Header (Desktop) */}
      <div className="hidden md:flex items-center justify-between px-4 py-2 border-b border-spotify-border/40 text-xs font-semibold text-spotify-subtext uppercase tracking-wider">
        <div className="flex items-center gap-4 flex-1">
          <span className="w-6 text-center">#</span>
          <span>שם השיר / אמן</span>
        </div>
        <div className="flex items-center gap-4 pr-2">
          <Clock className="w-4 h-4" />
        </div>
      </div>

      {/* Track List */}
      <div className="flex flex-col gap-1 px-2">
        {tracks.length === 0 ? (
          <div className="p-8 text-center text-spotify-subtext">
            אין שירים בפלייליסט זה עדיין.
          </div>
        ) : (
          tracks.map((track, idx) => (
            <TrackRow
              key={track.id || idx}
              index={idx}
              track={track}
              isCurrentTrack={currentTrack?.id === track.id}
              isPlaying={isPlaying}
              onPlay={(t) => onPlayTrack(t, tracks, idx)}
              isLiked={likedSongs.some(s => s.id === track.id || (s.title === track.title && s.artist === track.artist))}
              onToggleLike={onToggleLike}
            />
          ))
        )}
      </div>
    </div>
  );
}
