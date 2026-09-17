import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  Mic2,
  Maximize2,
  Music
} from 'lucide-react';

export function PlayerBar({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isShuffle,
  repeatMode,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onSetVolume,
  onToggleMute,
  onToggleShuffle,
  onToggleRepeat,
  isLiked,
  onToggleLike,
  onOpenLyrics,
  onOpenFullscreen
}) {
  if (!currentTrack) return null;

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      {/* Mobile Mini Player */}
      <div
        onClick={onOpenFullscreen}
        className="md:hidden flex flex-col bg-spotify-elevated/95 backdrop-blur-md border-t border-spotify-border px-3.5 py-2 cursor-pointer z-30 relative"
      >
        {/* Progress Line at Top */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10">
          <div
            className="h-full bg-spotify-green transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-md bg-spotify-dark overflow-hidden flex-shrink-0 shadow">
              {currentTrack.thumbnail ? (
                <img src={currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                  <Music className="w-4 h-4" />
                </div>
              )}
            </div>
            <div className="flex flex-col min-w-0 truncate text-right">
              <span className="text-sm font-semibold text-white truncate">{currentTrack.title}</span>
              <span className="text-xs text-spotify-subtext truncate">{currentTrack.artist}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onToggleLike(currentTrack)}
              className={`p-1.5 ${isLiked ? 'text-spotify-green' : 'text-spotify-subtext'}`}
            >
              <Heart className={`w-5 h-5 ${isLiked ? 'fill-spotify-green' : ''}`} />
            </button>

            <button
              onClick={onTogglePlay}
              className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-md"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current translate-x-0.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Fixed Bottom Bar (RTL aligned) */}
      <div className="hidden md:flex items-center justify-between bg-black border-t border-spotify-border/40 h-20 px-4 z-40 select-none">
        {/* Right side in RTL: Track Information */}
        <div className="flex items-center gap-3.5 w-[30%] min-w-[200px]">
          <div className="w-14 h-14 rounded-md bg-spotify-elevated overflow-hidden flex-shrink-0 relative shadow-md">
            {currentTrack.thumbnail ? (
              <img src={currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                <Music className="w-6 h-6" />
              </div>
            )}
          </div>

          <div className="flex flex-col min-w-0 truncate text-right">
            <span className="text-sm font-semibold text-white truncate hover:underline cursor-pointer">
              {currentTrack.title}
            </span>
            <span className="text-xs text-spotify-subtext truncate hover:underline hover:text-white cursor-pointer transition-colors">
              {currentTrack.artist}
            </span>
          </div>

          <button
            onClick={() => onToggleLike(currentTrack)}
            title={isLiked ? 'הסר ממועדפים' : 'שמור במועדפים'}
            className={`p-1 transition-transform active:scale-125 ${
              isLiked ? 'text-spotify-green' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <Heart className={`w-5 h-5 ${isLiked ? 'fill-spotify-green' : ''}`} />
          </button>
        </div>

        {/* Center: Playback Controls & Scrubber */}
        <div className="flex flex-col items-center gap-1.5 w-[40%] max-w-xl">
          <div className="flex items-center gap-5">
            <button
              onClick={onToggleShuffle}
              title="ערבוב (Shuffle)"
              className={`p-1 transition-colors ${
                isShuffle ? 'text-spotify-green' : 'text-spotify-subtext hover:text-white'
              }`}
            >
              <Shuffle className="w-4 h-4" />
            </button>

            {/* Previous track */}
            <button
              onClick={onPrev}
              title="הקודם"
              className="text-spotify-subtext hover:text-white transition-colors"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            {/* Big Play/Pause Button */}
            <button
              onClick={onTogglePlay}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-md"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current translate-x-0.5" />
              )}
            </button>

            {/* Next track */}
            <button
              onClick={onNext}
              title="הבא"
              className="text-spotify-subtext hover:text-white transition-colors"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>

            <button
              onClick={onToggleRepeat}
              title="חזרה (Repeat)"
              className={`p-1 transition-colors ${
                repeatMode !== 'off' ? 'text-spotify-green' : 'text-spotify-subtext hover:text-white'
              }`}
            >
              {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
            </button>
          </div>

          {/* Time Scrubber */}
          <div className="flex items-center gap-2 w-full group">
            <span className="text-[11px] text-spotify-subtext font-mono w-9 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-spotify-green"
            />
            <span className="text-[11px] text-spotify-subtext font-mono w-9 text-left">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Left side in RTL: Lyrics, Volume, Fullscreen */}
        <div className="flex items-center justify-end gap-3.5 w-[30%]">
          <button
            onClick={onOpenLyrics}
            title="מילים מסונכרנות"
            className="p-1.5 text-spotify-subtext hover:text-spotify-green transition-colors"
          >
            <Mic2 className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 group">
            <button
              onClick={onToggleMute}
              className="p-1.5 text-spotify-subtext hover:text-white transition-colors"
            >
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => onSetVolume(parseFloat(e.target.value))}
              className="w-24 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-spotify-green"
            />
          </div>

          <button
            onClick={onOpenFullscreen}
            title="מסך מלא"
            className="p-1.5 text-spotify-subtext hover:text-white transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}
