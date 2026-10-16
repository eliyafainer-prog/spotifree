import React, { useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Sparkles,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  Mic2,
  Maximize2,
  Music,
  Loader2,
  Check,
  PlusCircle,
  MonitorSpeaker,
  PanelLeft
} from 'lucide-react';

// Rich Spotify Mini-Player palette (matches Image 3 deep wine/plum/indigo/teal tones)
const MINI_PLAYER_PALETTE = [
  '#4c1d4b', // Deep Wine Purple (exact match to Image 3!)
  '#3b2667', // Deep Indigo
  '#1e3264', // Spotify Royal Blue
  '#472133', // Burgundy Rose
  '#1b4332', // Deep Emerald
  '#4a2c11', // Warm Amber Brown
  '#2d3142'  // Slate Navy
];

function getTrackAccentColor(track) {
  if (!track) return MINI_PLAYER_PALETTE[0];
  const str = `${track.id || ''}${track.title || ''}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return MINI_PLAYER_PALETTE[Math.abs(hash) % MINI_PLAYER_PALETTE.length];
}

export function PlayerBar({
  currentTrack,
  isPlaying,
  isLoading = false,
  currentTime,
  duration,
  volume,
  isMuted,
  isShuffle,
  shuffleMode = 'off',
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
  onOpenFullscreen,
  showNowPlayingPanel = true,
  onToggleNowPlayingPanel
}) {
  const accentColor = useMemo(() => getTrackAccentColor(currentTrack), [currentTrack]);

  if (!currentTrack) return null;

  const formatTime = (secs) => {
    if (!secs || isNaN(secs) || !isFinite(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const currentVolume = isMuted ? 0 : volume;
  const volumePercent = Math.min(100, Math.max(0, currentVolume * 100));

  return (
    <>
      {/* ==================== MOBILE FLOATING MINI-PLAYER (Exact Match to Image 3) ==================== */}
      <div
        onClick={onOpenFullscreen}
        dir="ltr"
        style={{ backgroundColor: accentColor }}
        className="md:hidden relative mx-2 mb-1 h-[56px] rounded-[8px] overflow-hidden flex items-center justify-between px-2.5 cursor-pointer z-30 shadow-[0_8px_24px_rgba(0,0,0,0.85)]"
      >
        {/* Subtle ambient artwork overlay */}
        {currentTrack.thumbnail && (
          <>
            <img
              src={currentTrack.thumbnail}
              alt=""
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-150 opacity-35 saturate-150 pointer-events-none"
            />
            <div className="absolute inset-0 bg-black/35 pointer-events-none" />
          </>
        )}

        {/* Left Side in Mini-Player (Image 3): 40x40 Cover + Title & Artist */}
        <div className="relative z-10 flex items-center gap-2.5 min-w-0 flex-1 pr-2">
          <div className="w-10 h-10 rounded-[4px] bg-[#181818] overflow-hidden flex-shrink-0 shadow-md">
            {currentTrack.thumbnail ? (
              <img src={currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#b3b3b3]">
                <Music className="w-4 h-4" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1 text-right" dir="rtl">
            <span className="text-[13px] font-bold text-white truncate leading-tight" title={currentTrack.title}>
              {currentTrack.title}
            </span>
            <span className="text-[12px] text-white/80 truncate leading-tight mt-0.5" title={currentTrack.artist}>
              {currentTrack.artist}
            </span>
          </div>
        </div>

        {/* Right Side in Mini-Player (Image 3): Device/Lyrics Icon + Green Check + Play/Pause */}
        <div className="relative z-10 flex items-center gap-2.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onOpenLyrics}
            className="p-1.5 text-white/90 active:scale-95 transition-transform"
            title="מילים לשיר"
          >
            <MonitorSpeaker className="w-5 h-5" />
          </button>

          <button
            onClick={() => onToggleLike(currentTrack)}
            className="p-1 transition-transform active:scale-125"
            aria-label={isLiked ? 'הסר ממועדפים' : 'שמור במועדפים'}
          >
            {isLiked ? (
              <span className="w-6 h-6 rounded-full bg-spotify-green text-black flex items-center justify-center shadow">
                <Check className="w-3.5 h-3.5 stroke-[3.5]" />
              </span>
            ) : (
              <PlusCircle className="w-6 h-6 text-white/90" />
            )}
          </button>

          <button
            onClick={onTogglePlay}
            className="p-1.5 text-white flex items-center justify-center active:scale-90 transition-transform"
            aria-label={isPlaying ? 'השהה' : 'נגן'}
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            ) : isPlaying ? (
              <Pause className="w-6 h-6 fill-white text-white" />
            ) : (
              <Play className="w-6 h-6 fill-white text-white" />
            )}
          </button>
        </div>

        {/* Bottom Thin Progress Line inside Floating Pill */}
        <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-white/25 rounded-full overflow-hidden z-10" dir="ltr">
          <div
            className="h-full bg-white rounded-full transition-all duration-150"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* ==================== DESKTOP BOTTOM BAR (Exact Match to Image 1) ==================== */}
      <div className="hidden md:flex items-center justify-between bg-black h-[80px] px-4 z-40 select-none">
        {/* Right side (RTL): Now Playing Track Info + Green Checkmark */}
        <div className="flex items-center gap-3.5 w-[30%] min-w-[200px]">
          <div
            onClick={onOpenFullscreen}
            className="w-14 h-14 rounded-[4px] bg-[#282828] overflow-hidden flex-shrink-0 relative shadow-md cursor-pointer group"
          >
            {currentTrack.thumbnail ? (
              <img src={currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#b3b3b3]">
                <Music className="w-6 h-6" />
              </div>
            )}
          </div>

          <div className="flex flex-col min-w-0 truncate text-right">
            <span
              onClick={onOpenFullscreen}
              className="text-sm font-bold text-white truncate hover:underline cursor-pointer"
            >
              {currentTrack.title}
            </span>
            <span className="text-xs text-[#b3b3b3] truncate hover:underline hover:text-white cursor-pointer transition-colors">
              {currentTrack.artist}
            </span>
          </div>

          <button
            onClick={() => onToggleLike(currentTrack)}
            title={isLiked ? 'הסר משירים שאהבתי' : 'שמור בשירים שאהבתי'}
            className="p-1.5 transition-transform active:scale-125 flex-shrink-0"
          >
            {isLiked ? (
              <span className="w-4 h-4 rounded-full bg-spotify-green text-black flex items-center justify-center">
                <Check className="w-3 h-3 stroke-[3.5]" />
              </span>
            ) : (
              <PlusCircle className="w-4 h-4 text-[#b3b3b3] hover:text-white" />
            )}
          </button>
        </div>

        {/* Center: Playback Controls & Scrubber (LTR) */}
        <div className="flex flex-col items-center gap-1.5 w-[40%] max-w-[600px]" dir="ltr">
          <div className="flex items-center gap-5">
            {/* Shuffle */}
            <button
              onClick={onToggleShuffle}
              title={
                shuffleMode === 'smart'
                  ? 'ערבוב חכם פעיל (Smart Shuffle ✨)'
                  : shuffleMode === 'standard' || isShuffle
                  ? 'ערבוב רגיל פעיל'
                  : 'הפעל ערבוב'
              }
              className={`relative p-1 transition-all ${
                shuffleMode !== 'off' || isShuffle
                  ? 'text-spotify-green'
                  : 'text-[#b3b3b3] hover:text-white'
              }`}
            >
              <Shuffle className="w-4 h-4" />
              {shuffleMode === 'smart' && (
                <Sparkles className="w-2.5 h-2.5 text-spotify-green fill-spotify-green absolute -top-0.5 -right-1 animate-pulse" />
              )}
              {(shuffleMode !== 'off' || isShuffle) && (
                <span className="w-1 h-1 rounded-full bg-spotify-green absolute -bottom-1 left-1/2 -translate-x-1/2" />
              )}
            </button>

            {/* Previous Track */}
            <button
              onClick={onPrev}
              title="הקודם"
              className="text-[#b3b3b3] hover:text-white transition-colors active:scale-95"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>

            {/* White Circle Play/Pause Button */}
            <button
              onClick={onTogglePlay}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-black" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4 fill-black text-black" />
              ) : (
                <Play className="w-4 h-4 fill-black text-black translate-x-0.5" />
              )}
            </button>

            {/* Next Track */}
            <button
              onClick={onNext}
              title="הבא"
              className="text-[#b3b3b3] hover:text-white transition-colors active:scale-95"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            {/* Repeat */}
            <button
              onClick={onToggleRepeat}
              title="חזרה (Repeat)"
              className={`relative p-1 transition-colors ${
                repeatMode !== 'off' ? 'text-spotify-green' : 'text-[#b3b3b3] hover:text-white'
              }`}
            >
              {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              {repeatMode !== 'off' && (
                <span className="w-1 h-1 rounded-full bg-spotify-green absolute -bottom-1 left-1/2 -translate-x-1/2" />
              )}
            </button>
          </div>

          {/* Time Scrubber */}
          <div className="flex items-center gap-2 w-full group">
            <span className="text-[11px] text-[#b3b3b3] font-normal w-9 text-right tabular-nums">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="0.1"
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              style={{
                background: `linear-gradient(to right, #ffffff ${progressPercent}%, rgba(255, 255, 255, 0.25) ${progressPercent}%)`
              }}
              className="spotify-slider flex-1"
            />
            <span className="text-[11px] text-[#b3b3b3] font-normal w-9 text-left tabular-nums">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Left side (RTL): Lyrics, Now Playing Panel Toggle, Volume & Fullscreen (LTR) */}
        <div className="flex items-center justify-end gap-3 w-[30%]" dir="ltr">
          <button
            onClick={onOpenFullscreen}
            title="מסך מלא"
            className="p-1.5 text-[#b3b3b3] hover:text-white transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 group">
            <button
              onClick={onToggleMute}
              className="p-1.5 text-[#b3b3b3] hover:text-white transition-colors"
            >
              {isMuted || currentVolume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentVolume}
              onChange={(e) => onSetVolume(parseFloat(e.target.value))}
              style={{
                background: `linear-gradient(to right, #ffffff ${volumePercent}%, rgba(255, 255, 255, 0.25) ${volumePercent}%)`
              }}
              className="spotify-slider w-24"
            />
          </div>

          {onToggleNowPlayingPanel && (
            <button
              onClick={onToggleNowPlayingPanel}
              title="תצוגת מתנגן עכשיו"
              className={`p-1.5 transition-colors ${
                showNowPlayingPanel ? 'text-spotify-green' : 'text-[#b3b3b3] hover:text-white'
              }`}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={onOpenLyrics}
            title="מילים לשיר"
            className="p-1.5 text-[#b3b3b3] hover:text-white transition-colors"
          >
            <Mic2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}
