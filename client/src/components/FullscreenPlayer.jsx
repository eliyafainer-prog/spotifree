import React from 'react';
import { ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Sparkles, Repeat, Repeat1, Heart, Mic2, Music } from 'lucide-react';

export function FullscreenPlayer({
  isOpen,
  onClose,
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  isShuffle,
  shuffleMode = 'off',
  onToggleShuffle,
  repeatMode,
  onToggleRepeat,
  isLiked,
  onToggleLike,
  onOpenLyrics
}) {
  if (!isOpen || !currentTrack) return null;

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-spotify-elevated via-spotify-dark to-black flex flex-col justify-between p-6 animate-slideUp select-none">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="p-2 text-spotify-subtext hover:text-white transition-colors"
        >
          <ChevronDown className="w-7 h-7" />
        </button>

        <div className="text-center">
          <span className="text-[11px] uppercase tracking-wider text-spotify-subtext font-bold">
            מתנגן עכשיו
          </span>
          <p className="text-xs text-white font-medium truncate max-w-[200px]">
            {currentTrack.album || 'SpotiFree'}
          </p>
        </div>

        <button
          onClick={onOpenLyrics}
          title="מילים לשיר"
          className="p-2 text-spotify-subtext hover:text-spotify-green transition-colors"
        >
          <Mic2 className="w-6 h-6" />
        </button>
      </div>

      {/* Album Artwork with Ambient Shadow */}
      <div className="flex-1 flex items-center justify-center my-4 py-2">
        <div className="w-72 h-72 sm:w-80 sm:h-80 rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-white/10 relative">
          {currentTrack.thumbnail ? (
            <img
              src={currentTrack.thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-spotify-highlight flex items-center justify-center text-spotify-subtext">
              <Music className="w-20 h-20" />
            </div>
          )}
        </div>
      </div>

      {/* Song Info & Like Button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-col min-w-0 flex-1 pr-4 text-right">
          <h1 className="text-xl font-bold text-white truncate">
            {currentTrack.title}
          </h1>
          <p className="text-sm text-spotify-subtext truncate mt-0.5">
            {currentTrack.artist}
          </p>
        </div>

        <button
          onClick={() => onToggleLike(currentTrack)}
          className={`p-2 transition-transform active:scale-125 ${
            isLiked ? 'text-spotify-green' : 'text-spotify-subtext hover:text-white'
          }`}
        >
          <Heart className={`w-6 h-6 ${isLiked ? 'fill-spotify-green' : ''}`} />
        </button>
      </div>

      {/* Progress Slider (LTR) */}
      <div className="flex flex-col gap-1.5 mb-6 group" dir="ltr">
        <div className="relative w-full flex items-center">
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            style={{
              background: `linear-gradient(to right, #1ed760 ${progressPercent}%, rgba(255, 255, 255, 0.25) ${progressPercent}%)`
            }}
            className="spotify-slider w-full h-1.5"
          />
        </div>
        <div className="flex justify-between text-[11px] text-spotify-subtext font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Main Controls (Big Buttons for Mobile) (LTR) */}
      <div className="flex items-center justify-between px-2 mb-6" dir="ltr">
        <button
          onClick={onToggleShuffle}
          title={
            shuffleMode === 'smart'
              ? 'ערבוב חכם פעיל (Smart Shuffle ✨)'
              : shuffleMode === 'standard' || isShuffle
              ? 'ערבוב רגיל פעיל'
              : 'ערבוב כבוי'
          }
          className={`p-2 transition-all active:scale-95 ${
            shuffleMode === 'smart'
              ? 'text-spotify-green'
              : shuffleMode === 'standard' || isShuffle
              ? 'text-spotify-green'
              : 'text-spotify-subtext hover:text-white'
          }`}
        >
          <div className="relative inline-flex items-center justify-center">
            <Shuffle className="w-5 h-5" />
            {shuffleMode === 'smart' && (
              <Sparkles className="w-3 h-3 text-emerald-300 absolute -top-2 -right-2 animate-pulse" />
            )}
          </div>
        </button>

        <button
          onClick={onPrev}
          className="p-2 text-white hover:text-spotify-green transition-colors active:scale-95"
        >
          <SkipBack className="w-7 h-7 fill-current" />
        </button>

        <button
          onClick={onTogglePlay}
          className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-white/20"
        >
          {isPlaying ? (
            <Pause className="w-7 h-7 fill-current" />
          ) : (
            <Play className="w-7 h-7 fill-current translate-x-0.5" />
          )}
        </button>

        <button
          onClick={onNext}
          className="p-2 text-white hover:text-spotify-green transition-colors active:scale-95"
        >
          <SkipForward className="w-7 h-7 fill-current" />
        </button>

        <button
          onClick={onToggleRepeat}
          className={`p-2 transition-colors ${
            repeatMode !== 'off' ? 'text-spotify-green' : 'text-spotify-subtext'
          }`}
        >
          {repeatMode === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
        </button>
      </div>

      {/* Bottom Footer Actions */}
      <div className="flex items-center justify-center gap-3 pb-2">
        <button
          onClick={onOpenLyrics}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-5 py-2.5 rounded-full backdrop-blur-md transition-colors"
        >
          <Mic2 className="w-4 h-4 text-spotify-green" />
          <span>הצג מילים מסונכרנות</span>
        </button>
      </div>
    </div>
  );
}
