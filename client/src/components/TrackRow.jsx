import React from 'react';
import { Play, Pause, Heart, Music } from 'lucide-react';

export function TrackRow({ track, index, isCurrentTrack, isPlaying, onPlay, isLiked, onToggleLike }) {
  const formatDuration = (seconds) => {
    if (!seconds) return track.duration || '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      onClick={() => onPlay(track)}
      className={`group flex items-center justify-between p-2 rounded-md transition-colors cursor-pointer select-none ${
        isCurrentTrack
          ? 'bg-spotify-highlight text-spotify-green'
          : 'hover:bg-spotify-highlight/40 text-white'
      }`}
    >
      {/* Left: Index / Play state + Artwork + Title/Artist */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-6 text-center text-xs text-spotify-subtext font-mono flex-shrink-0 flex items-center justify-center">
          {isCurrentTrack ? (
            isPlaying ? (
              <span className="flex items-end justify-center gap-0.5 h-3">
                <span className="w-1 bg-spotify-green animate-pulse h-full"></span>
                <span className="w-1 bg-spotify-green animate-pulse h-2"></span>
                <span className="w-1 bg-spotify-green animate-pulse h-full"></span>
              </span>
            ) : (
              <Play className="w-4 h-4 fill-spotify-green text-spotify-green" />
            )
          ) : (
            <span className="group-hover:hidden">{index + 1}</span>
          )}
          {!isCurrentTrack && (
            <Play className="w-4 h-4 text-white fill-white hidden group-hover:block" />
          )}
        </div>

        <div className="w-10 h-10 rounded bg-spotify-elevated flex-shrink-0 overflow-hidden relative">
          {track.thumbnail ? (
            <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
              <Music className="w-4 h-4" />
            </div>
          )}
        </div>

        <div className="flex flex-col min-w-0 truncate">
          <span className={`text-sm font-medium truncate ${isCurrentTrack ? 'text-spotify-green font-bold' : 'text-white'}`}>
            {track.title}
          </span>
          <span className="text-xs text-spotify-subtext truncate group-hover:text-white transition-colors">
            {track.artist}
          </span>
        </div>
      </div>

      {/* Right: Like Button & Duration */}
      <div className="flex items-center gap-4 flex-shrink-0 pr-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLike(track);
          }}
          title={isLiked ? 'הסר ממועדפים' : 'שמור במועדפים'}
          className={`p-1 transition-transform active:scale-125 ${
            isLiked ? 'text-spotify-green' : 'text-spotify-subtext opacity-0 group-hover:opacity-100 hover:text-white'
          }`}
        >
          <Heart className={`w-4 h-4 ${isLiked ? 'fill-spotify-green' : ''}`} />
        </button>

        <span className="text-xs text-spotify-subtext font-mono w-10 text-right">
          {formatDuration(track.durationSeconds)}
        </span>
      </div>
    </div>
  );
}
