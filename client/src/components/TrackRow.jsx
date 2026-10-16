import React, { useState, useEffect } from 'react';
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
  ChevronDown,
  MoreVertical,
  Check
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
  const [imgError, setImgError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [track?.thumbnail]);

  const formatDuration = (seconds) => {
    if (!seconds || !Number.isFinite(seconds)) return track.duration || '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleClick = () => {
    if (isReorderMode || menuOpen) return;
    if (isCurrentTrack && isLoading) return;
    onPlay(track);
  };

  return (
    <>
      <div
        onClick={handleClick}
        onMouseEnter={() => !isReorderMode && prefetchNextTracks([track])}
        draggable={isReorderMode}
        onDragStart={(e) => onDragStart && onDragStart(e, index)}
        onDragOver={(e) => onDragOver && onDragOver(e, index)}
        onDrop={(e) => onDrop && onDrop(e, index)}
        className={`group flex items-center justify-between gap-3 px-2 sm:px-4 py-2 rounded-md transition-colors select-none ${
          isReorderMode
            ? 'cursor-grab active:cursor-grabbing bg-white/[0.03] border border-white/10'
            : 'cursor-pointer active:bg-white/10 sm:hover:bg-white/[0.08]'
        }`}
      >
        {/* Right side in RTL: Reorder / Desktop Index + Album Cover + Title & Artist */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isReorderMode ? (
            <div className="flex items-center gap-1 text-[#b3b3b3] flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <GripVertical className="w-4 h-4 text-[#b3b3b3]" />
              <div className="flex flex-col">
                <button
                  disabled={!canMoveUp}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveUp && onMoveUp(index);
                  }}
                  className={`p-0.5 rounded ${canMoveUp ? 'text-white hover:text-spotify-green' : 'text-white/20 cursor-not-allowed'}`}
                  title="הזז למעלה"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={!canMoveDown}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveDown && onMoveDown(index);
                  }}
                  className={`p-0.5 rounded ${canMoveDown ? 'text-white hover:text-spotify-green' : 'text-white/20 cursor-not-allowed'}`}
                  title="הזז למטה"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            /* Desktop-only index column (real Spotify hides index numbers on mobile playlists) */
            <div className="hidden sm:flex w-6 text-center text-sm text-[#b3b3b3] font-normal flex-shrink-0 items-center justify-center">
              {isCurrentTrack ? (
                isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-spotify-green" />
                ) : isPlaying ? (
                  <span className="flex items-end justify-center gap-[2px] h-3.5 w-3.5">
                    <span className="w-[3px] bg-spotify-green animate-eq-1 rounded-sm"></span>
                    <span className="w-[3px] bg-spotify-green animate-eq-2 rounded-sm"></span>
                    <span className="w-[3px] bg-spotify-green animate-eq-3 rounded-sm"></span>
                  </span>
                ) : (
                  <Play className="w-4 h-4 fill-spotify-green text-spotify-green" />
                )
              ) : (
                <>
                  <span className="group-hover:hidden text-[#b3b3b3]">{index + 1}</span>
                  <Play className="w-4 h-4 text-white fill-white hidden group-hover:block" />
                </>
              )}
            </div>
          )}

          {/* Square Album Artwork (48x48 on mobile, 40x40 on desktop like Spotify) */}
          <div className="w-12 h-12 sm:w-10 sm:h-10 rounded-[4px] bg-[#282828] flex-shrink-0 overflow-hidden relative shadow-sm">
            {track.thumbnail && !imgError ? (
              <img
                src={track.thumbnail}
                alt=""
                loading="lazy"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#b3b3b3]">
                <Music className="w-5 h-5" />
              </div>
            )}

            {/* Mobile active playing indicator overlay on artwork */}
            {isCurrentTrack && (
              <div className="sm:hidden absolute inset-0 bg-black/50 flex items-center justify-center">
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-spotify-green" />
                ) : isPlaying ? (
                  <span className="flex items-end justify-center gap-[2px] h-4 w-4">
                    <span className="w-[3px] bg-spotify-green animate-eq-1 rounded-sm"></span>
                    <span className="w-[3px] bg-spotify-green animate-eq-2 rounded-sm"></span>
                    <span className="w-[3px] bg-spotify-green animate-eq-3 rounded-sm"></span>
                  </span>
                ) : (
                  <Play className="w-5 h-5 fill-spotify-green text-spotify-green" />
                )}
              </div>
            )}
          </div>

          {/* Song Title & Artist Subtitle */}
          <div className="flex flex-col min-w-0 flex-1 text-right justify-center">
            <span
              className={`text-[15px] sm:text-sm font-medium truncate leading-snug ${
                isCurrentTrack ? 'text-spotify-green font-semibold' : 'text-white'
              }`}
              title={track.title}
            >
              {track.title}
            </span>
            <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
              {/* Spotify Green Downloaded Arrow Badge */}
              {isDownloading ? (
                <Loader2 className="w-3.5 h-3.5 text-spotify-green animate-spin flex-shrink-0" />
              ) : isDownloaded ? (
                <ArrowDownCircle className="w-3.5 h-3.5 fill-spotify-green text-black flex-shrink-0" />
              ) : null}

              <span
                className="text-[13px] sm:text-xs text-[#b3b3b3] group-hover:text-white transition-colors truncate leading-snug"
                title={track.artist}
              >
                {track.artist}
              </span>
            </div>
          </div>
        </div>

        {/* Desktop Middle Column: Album Name */}
        <div className="hidden lg:flex items-center min-w-0 w-[26%] px-2">
          <span className="text-xs text-[#b3b3b3] group-hover:text-white truncate transition-colors">
            {track.album || track.artist}
          </span>
        </div>

        {/* Left side in RTL: Spotify Action Controls */}
        <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Desktop Download Button */}
          {onDownload && (
            <button
              onClick={() => {
                if (!isDownloaded && !isDownloading) onDownload(track);
              }}
              title={isDownloaded ? 'שמור להאזנה אופליין' : 'הורד להאזנה אופליין'}
              className={`hidden sm:inline-flex p-1.5 transition-all items-center justify-center ${
                isDownloading || isDownloaded
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {isDownloading ? (
                <Loader2 className="w-4 h-4 text-spotify-green animate-spin" />
              ) : isDownloaded ? (
                <ArrowDownCircle className="w-4 h-4 fill-spotify-green text-black" />
              ) : (
                <ArrowDownCircle className="w-4 h-4 text-[#b3b3b3] hover:text-white transition-colors" />
              )}
            </button>
          )}

          {/* Spotify Liked Checkmark / Heart Button */}
          <button
            onClick={() => onToggleLike(track)}
            title={isLiked ? 'הסר משירים שאהבתי' : 'שמור בשירים שאהבתי'}
            className={`p-1.5 transition-transform active:scale-125 ${
              isLiked
                ? 'text-spotify-green inline-flex'
                : 'text-[#b3b3b3] hover:text-white hidden sm:inline-flex sm:opacity-0 sm:group-hover:opacity-100'
            }`}
          >
            {isLiked ? (
              <span className="w-4 h-4 rounded-full bg-spotify-green text-black flex items-center justify-center">
                <Check className="w-3 h-3 stroke-[3]" />
              </span>
            ) : (
              <Heart className="w-4 h-4" />
            )}
          </button>

          {/* Desktop Add to Playlist */}
          {onOpenAddToPlaylist && (
            <button
              onClick={() => onOpenAddToPlaylist(track)}
              title="הוסף לפלייליסט"
              className="hidden sm:inline-flex p-1.5 text-[#b3b3b3] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ListPlus className="w-4 h-4" />
            </button>
          )}

          {/* Desktop Remove from Playlist */}
          {onRemoveFromPlaylist && (
            <button
              onClick={() => onRemoveFromPlaylist(track)}
              title="הסר מהפלייליסט"
              className="hidden sm:inline-flex p-1.5 text-[#b3b3b3] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* Desktop Duration */}
          <span className="hidden sm:inline-block text-xs text-[#b3b3b3] font-normal w-10 text-left tabular-nums">
            {formatDuration(track.durationSeconds)}
          </span>

          {/* Mobile 3-Dots Action Button (Authentic Spotify Mobile Track Menu) */}
          <button
            onClick={() => setMenuOpen(true)}
            className="sm:hidden p-2 text-[#b3b3b3] active:text-white"
            aria-label="אפשרויות שיר"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Spotify Mobile Bottom Sheet Track Menu */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end justify-center sm:hidden animate-fadeIn"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-full bg-[#282828] rounded-t-2xl p-5 pb-8 flex flex-col gap-4 animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-white/25 rounded-full mx-auto mb-1" />

            {/* Track Header in Bottom Sheet */}
            <div className="flex items-center gap-3.5 pb-3 border-b border-white/10">
              <div className="w-12 h-12 rounded bg-[#181818] overflow-hidden flex-shrink-0">
                {track.thumbnail && !imgError ? (
                  <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music className="w-6 h-6 m-3 text-[#b3b3b3]" />
                )}
              </div>
              <div className="flex flex-col min-w-0 flex-1 text-right">
                <span className="text-base font-bold text-white truncate">{track.title}</span>
                <span className="text-xs text-[#b3b3b3] truncate">{track.artist}</span>
              </div>
            </div>

            {/* Menu Actions */}
            <div className="flex flex-col gap-1">
              <button
                onClick={() => {
                  onToggleLike(track);
                  setMenuOpen(false);
                }}
                className="flex items-center gap-4 py-3 px-2 rounded-lg active:bg-white/10 text-white text-sm font-medium"
              >
                <Heart className={`w-5 h-5 ${isLiked ? 'fill-spotify-green text-spotify-green' : 'text-[#b3b3b3]'}`} />
                <span>{isLiked ? 'הסר משירים שאהבתי' : 'הוסף לשירים שאהבתי'}</span>
              </button>

              {onOpenAddToPlaylist && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenAddToPlaylist(track);
                  }}
                  className="flex items-center gap-4 py-3 px-2 rounded-lg active:bg-white/10 text-white text-sm font-medium"
                >
                  <ListPlus className="w-5 h-5 text-[#b3b3b3]" />
                  <span>הוסף לפלייליסט אחר</span>
                </button>
              )}

              {onDownload && (
                <button
                  onClick={() => {
                    if (!isDownloaded && !isDownloading) onDownload(track);
                    setMenuOpen(false);
                  }}
                  className="flex items-center gap-4 py-3 px-2 rounded-lg active:bg-white/10 text-white text-sm font-medium"
                >
                  <ArrowDownCircle className={`w-5 h-5 ${isDownloaded ? 'text-spotify-green' : 'text-[#b3b3b3]'}`} />
                  <span>{isDownloaded ? 'שמור במכשיר להאזנה אופליין ✓' : 'הורד להאזנה אופליין'}</span>
                </button>
              )}

              {onRemoveFromPlaylist && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onRemoveFromPlaylist(track);
                  }}
                  className="flex items-center gap-4 py-3 px-2 rounded-lg active:bg-white/10 text-red-400 text-sm font-medium"
                >
                  <Trash2 className="w-5 h-5" />
                  <span>הסר מפלייליסט זה</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
