import React from 'react';
import {
  Play,
  Pause,
  Heart,
  Music,
  ArrowDownCircle,
  CheckCircle2,
  Loader2,
  ListPlus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { prefetchNextTracks } from '../services/api';

export function TrackRow({
  track,
  index,
  isCurrentTrack,
  isPlaying,
  isLoading = false,
  onPlay,
  isLiked,
  onToggleLike,
  isDownloaded = false,
  isDownloading = false,
  onDownload,
  onOpenAddToPlaylist,
  onRemoveFromPlaylist,
  isReorderMode = false,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop
}) {
  const formatDuration = (seconds) => {
    if (!seconds) return track.duration || '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleClick = () => {
    if (isReorderMode) return;
    if (isCurrentTrack && isLoading) return;
    onPlay(track);
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => !isReorderMode && prefetchNextTracks([track])}
      draggable={isReorderMode}
      onDragStart={(e) => onDragStart && onDragStart(e, index)}
      onDragOver={(e) => onDragOver && onDragOver(e, index)}
      onDrop={(e) => onDrop && onDrop(e, index)}
      className={`group flex items-center justify-between p-2 rounded-md transition-colors select-none ${
        isReorderMode ? 'cursor-grab active:cursor-grabbing border border-transparent hover:border-white/20' : 'cursor-pointer'
      } ${
        isCurrentTrack
          ? 'bg-spotify-highlight text-spotify-green'
          : 'hover:bg-spotify-highlight/50 text-white'
      }`}
    >
      {/* Right side in RTL: Reorder handles / Index / Play Icon + Artwork + Title & Artist */}
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        {isReorderMode ? (
          <div className="flex items-center gap-1 text-spotify-subtext flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <GripVertical className="w-4 h-4 text-spotify-subtext/60 hover:text-white" />
            <div className="flex flex-col">
              <button
                disabled={!canMoveUp}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp && onMoveUp(index);
                }}
                className={`p-0.5 rounded hover:bg-white/10 ${canMoveUp ? 'text-white hover:text-spotify-green' : 'text-spotify-subtext/30 cursor-not-allowed'}`}
                title="הזז שיר למעלה"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={!canMoveDown}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown && onMoveDown(index);
                }}
                className={`p-0.5 rounded hover:bg-white/10 ${canMoveDown ? 'text-white hover:text-spotify-green' : 'text-spotify-subtext/30 cursor-not-allowed'}`}
                title="הזז שיר למטה"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="text-[11px] text-spotify-subtext/60 font-mono w-4 text-center">{index + 1}</span>
          </div>
        ) : (
          <div className="w-6 text-center text-xs text-spotify-subtext font-mono flex-shrink-0 flex items-center justify-center">
            {isCurrentTrack ? (
              isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-spotify-green" />
              ) : isPlaying ? (
                <span className="flex items-end justify-center gap-0.5 h-3.5">
                  <span className="w-1 bg-spotify-green animate-pulse h-full rounded-full"></span>
                  <span className="w-1 bg-spotify-green animate-pulse h-2 rounded-full"></span>
                  <span className="w-1 bg-spotify-green animate-pulse h-full rounded-full"></span>
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
        )}

        <div className="w-10 h-10 rounded bg-spotify-elevated flex-shrink-0 overflow-hidden shadow-sm relative">
          {track.thumbnail ? (
            <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
              <Music className="w-4 h-4" />
            </div>
          )}
        </div>

        <div className="flex flex-col min-w-0 truncate text-right">
          <span className={`text-sm font-semibold truncate ${isCurrentTrack ? 'text-spotify-green' : 'text-white'}`}>
            {track.title}
          </span>
          <span className="text-xs text-spotify-subtext truncate group-hover:text-white transition-colors">
            {track.artist}
          </span>
        </div>
      </div>

      {/* Left side in RTL: Download Button, Like Button & Duration */}
      <div className="flex items-center gap-3.5 flex-shrink-0 pl-2">
        {/* Offline Download Button */}
        {onDownload && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isDownloaded && !isDownloading) {
                onDownload(track);
              }
            }}
            title={isDownloaded ? 'שמור להאזנה אופליין' : 'הורד להאזנה אופליין'}
            className="p-1 transition-transform active:scale-125 flex items-center justify-center"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
            ) : isDownloaded ? (
              <CheckCircle2 className="w-4 h-4 text-teal-400 fill-teal-400/20" />
            ) : (
              <ArrowDownCircle className="w-4 h-4 text-spotify-subtext opacity-0 group-hover:opacity-100 hover:text-teal-400 transition-opacity" />
            )}
          </button>
        )}

        {/* Like Button */}
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

        {/* Add to Playlist Button */}
        {onOpenAddToPlaylist && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenAddToPlaylist(track);
            }}
            title="הוסף לפלייליסט"
            className="p-1 transition-transform active:scale-125 text-spotify-subtext opacity-0 group-hover:opacity-100 hover:text-white"
          >
            <ListPlus className="w-4 h-4" />
          </button>
        )}

        {/* Remove from Playlist Button (shown when viewing custom/user playlist) */}
        {onRemoveFromPlaylist && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveFromPlaylist(track);
            }}
            title="הסר שיר זה מהפלייליסט"
            className="p-1 transition-transform active:scale-125 text-spotify-subtext opacity-0 group-hover:opacity-100 hover:text-red-400"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Duration */}
        <span className="text-xs text-spotify-subtext font-mono w-10 text-left">
          {formatDuration(track.durationSeconds)}
        </span>
      </div>
    </div>
  );
}
