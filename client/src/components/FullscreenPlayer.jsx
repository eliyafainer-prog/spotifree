import React from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Sparkles,
  Repeat,
  Repeat1,
  Heart,
  Mic2,
  Music,
  Check,
  PlusCircle,
  Share2,
  ListMusic,
  MonitorSpeaker,
  ArrowDownCircle,
  ListPlus,
  Loader2
} from 'lucide-react';

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
  isDownloaded = false,
  isDownloading = false,
  onDownloadTrack,
  onOpenAddToPlaylist,
  onOpenLyrics,
  previewLyricsLines = [],
  queue = [],
  queueIndex = -1,
  onPlayTrack
}) {
  if (!isOpen || !currentTrack) return null;

  const formatTime = (secs) => {
    if (!secs || isNaN(secs) || !isFinite(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-[#121212] flex flex-col justify-between px-6 py-5 animate-slideUp select-none overflow-y-auto no-scrollbar">
      {/* Dynamic Ambient Color Backdrop from Album Cover */}
      {currentTrack.thumbnail && (
        <>
          <img
            src={currentTrack.thumbnail}
            alt=""
            className="fixed inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-55 saturate-150 pointer-events-none"
          />
          <div className="fixed inset-0 bg-gradient-to-b from-black/30 via-[#121212]/75 to-black pointer-events-none" />
        </>
      )}

      {/* Top Navigation Header */}
      <div className="relative z-10 flex items-center justify-between pt-1">
        <button
          onClick={onClose}
          className="p-2 -mr-2 text-white/90 hover:text-white active:scale-95 transition-transform"
          aria-label="סגור נגן"
        >
          <ChevronDown className="w-7 h-7" />
        </button>

        <div className="text-center flex flex-col items-center">
          <span className="text-[10px] uppercase tracking-widest text-white/70 font-semibold">
            מתנגן מתוך פלייליסט
          </span>
          <p className="text-xs text-white font-bold truncate max-w-[220px] mt-0.5">
            {currentTrack.album || 'SpotiFree'}
          </p>
        </div>

        <button
          onClick={onOpenLyrics}
          title="מילים לשיר"
          className="p-2 -ml-2 text-white/90 hover:text-spotify-green transition-colors"
        >
          <Mic2 className="w-5 h-5" />
        </button>
      </div>

      {/* Centered Large Square Album Artwork */}
      <div className="relative z-10 flex-1 flex items-center justify-center my-4 py-2">
        <div className="w-full max-w-[330px] aspect-square rounded-[8px] overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.85)] bg-[#282828] relative">
          {currentTrack.thumbnail ? (
            <img
              src={currentTrack.thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-[#282828] flex items-center justify-center text-[#b3b3b3]">
              <Music className="w-24 h-24" />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section: Metadata + Scrubber + Main Controls + Live Lyrics Preview + Up Next */}
      <div className="relative z-10 flex flex-col w-full max-w-[380px] mx-auto pb-4">
        {/* Track Title, Artist & Spotify Green Check / Plus Button */}
        <div className="flex items-center justify-between gap-4 mb-5">
          <div className="flex flex-col min-w-0 flex-1 text-right">
            <h1 className="text-[22px] font-extrabold text-white truncate leading-tight">
              {currentTrack.title}
            </h1>
            <p className="text-[15px] text-white/70 truncate mt-0.5 font-medium">
              {currentTrack.artist}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {onDownloadTrack && (
              <button
                onClick={() => !isDownloaded && !isDownloading && onDownloadTrack(currentTrack)}
                className="p-1.5 transition-transform active:scale-95"
                title={isDownloaded ? 'שמור אופליין ✓' : 'הורד לאופליין'}
              >
                {isDownloading ? (
                  <Loader2 className="w-6 h-6 text-spotify-green animate-spin" />
                ) : isDownloaded ? (
                  <ArrowDownCircle className="w-6 h-6 fill-spotify-green text-black" />
                ) : (
                  <ArrowDownCircle className="w-6 h-6 text-white/80 hover:text-spotify-green" />
                )}
              </button>
            )}

            {onOpenAddToPlaylist && (
              <button
                onClick={() => onOpenAddToPlaylist(currentTrack)}
                className="p-1.5 text-white/80 hover:text-spotify-green transition-transform active:scale-95"
                title="הוסף לפלייליסט"
              >
                <ListPlus className="w-6 h-6" />
              </button>
            )}

            <button
              onClick={() => onToggleLike(currentTrack)}
              className="p-1.5 transition-transform active:scale-125"
              aria-label={isLiked ? 'הסר משירים שאהבתי' : 'הוסף לשירים שאהבתי'}
            >
              {isLiked ? (
                <span className="w-7 h-7 rounded-full bg-spotify-green text-black flex items-center justify-center shadow-md">
                  <Check className="w-4 h-4 stroke-[3.5]" />
                </span>
              ) : (
                <PlusCircle className="w-7 h-7 text-white/80 hover:text-white" />
              )}
            </button>
          </div>
        </div>

        {/* Scrubber Bar (LTR) */}
        <div className="flex flex-col gap-1.5 mb-4 group" dir="ltr">
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
            className="spotify-slider spotify-slider-always w-full h-1"
          />
          <div className="flex justify-between text-[11px] text-white/65 font-medium tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Main Transport Controls (LTR) */}
        <div className="flex items-center justify-between mb-4" dir="ltr">
          <button
            onClick={onToggleShuffle}
            className={`relative p-2 transition-transform active:scale-95 ${
              shuffleMode !== 'off' || isShuffle ? 'text-spotify-green' : 'text-white/80 hover:text-white'
            }`}
          >
            <Shuffle className="w-6 h-6" />
            {shuffleMode === 'smart' && (
              <Sparkles className="w-3.5 h-3.5 text-spotify-green fill-spotify-green absolute top-0.5 right-0.5 animate-pulse" />
            )}
            {(shuffleMode !== 'off' || isShuffle) && (
              <span className="w-1.5 h-1.5 rounded-full bg-spotify-green absolute bottom-0 left-1/2 -translate-x-1/2" />
            )}
          </button>

          <button
            onClick={onPrev}
            className="p-2 text-white active:scale-90 transition-transform"
          >
            <SkipBack className="w-8 h-8 fill-white text-white" />
          </button>

          <button
            onClick={onTogglePlay}
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-xl"
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 fill-black text-black" />
            ) : (
              <Play className="w-7 h-7 fill-black text-black translate-x-0.5" />
            )}
          </button>

          <button
            onClick={onNext}
            className="p-2 text-white active:scale-90 transition-transform"
          >
            <SkipForward className="w-8 h-8 fill-white text-white" />
          </button>

          <button
            onClick={onToggleRepeat}
            className={`relative p-2 transition-transform active:scale-95 ${
              repeatMode !== 'off' ? 'text-spotify-green' : 'text-white/80 hover:text-white'
            }`}
          >
            {repeatMode === 'one' ? <Repeat1 className="w-6 h-6" /> : <Repeat className="w-6 h-6" />}
            {repeatMode !== 'off' && (
              <span className="w-1.5 h-1.5 rounded-full bg-spotify-green absolute bottom-0 left-1/2 -translate-x-1/2" />
            )}
          </button>
        </div>

        {/* Bottom Utility Row: Devices on left, Share & Queue on right (LTR) */}
        <div className="flex items-center justify-between text-white/75 mb-5 px-1" dir="ltr">
          <button onClick={onOpenLyrics} className="p-1.5 hover:text-white transition-colors">
            <MonitorSpeaker className="w-5 h-5 text-spotify-green" />
          </button>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: currentTrack.title, text: `${currentTrack.title} - ${currentTrack.artist}` }).catch(() => {});
                }
              }}
              className="p-1.5 hover:text-white transition-colors"
            >
              <Share2 className="w-5 h-5" />
            </button>
            <button onClick={onOpenLyrics} className="p-1.5 hover:text-white transition-colors">
              <ListMusic className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Authentic Spotify Purple Live Synced Lyrics Card */}
        <div
          onClick={onOpenLyrics}
          className="w-full rounded-2xl bg-gradient-to-b from-[#6b1169] to-[#4a0c48] p-4 flex flex-col gap-2.5 cursor-pointer transition-all shadow-xl mb-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-white tracking-wide">מילות השיר</span>
            <span className="text-[11px] font-bold bg-black/30 text-white px-3 py-1 rounded-full">
              הצג מילים
            </span>
          </div>

          {previewLyricsLines && previewLyricsLines.length > 0 ? (
            <div className="flex flex-col gap-1.5 text-right py-1">
              {previewLyricsLines.map((line, i) => (
                <p
                  key={i}
                  className={`font-extrabold leading-snug transition-colors ${
                    line.isCurrent ? 'text-white text-lg' : 'text-white/50 text-base'
                  }`}
                >
                  {line.text}
                </p>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-right py-2">
              <p className="text-white font-extrabold text-base">{currentTrack.title}</p>
              <p className="text-white/70 font-bold text-xs">לחץ לצפייה במילים מסונכרנות בזמן אמת</p>
            </div>
          )}
        </div>

        {/* Up Next in Queue Card inside Mobile Fullscreen Player */}
        {queue && queue.length > 1 && (
          <div className="w-full rounded-2xl bg-[#1f1f1f] p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-white">הבא בתור</span>
              <span className="text-[#b3b3b3] truncate max-w-[160px]">{currentTrack.artist}</span>
            </div>
            {queue.slice(queueIndex + 1, queueIndex + 4).map((nextT, idx) => (
              <div
                key={nextT.id || idx}
                onClick={() => onPlayTrack && onPlayTrack(nextT)}
                className="flex items-center gap-3 p-1.5 rounded-md active:bg-white/10 cursor-pointer transition-colors"
              >
                <div className="w-10 h-10 rounded-[4px] bg-[#282828] overflow-hidden flex-shrink-0">
                  {nextT.thumbnail ? (
                    <img src={nextT.thumbnail} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-4 h-4 m-3 text-[#b3b3b3]" />
                  )}
                </div>
                <div className="flex flex-col min-w-0 flex-1 text-right">
                  <span className="text-xs font-bold text-white truncate">{nextT.title}</span>
                  <span className="text-[11px] text-[#b3b3b3] truncate">{nextT.artist}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
