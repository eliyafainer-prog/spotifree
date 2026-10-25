import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Mic2,
  Sparkles,
  FileText,
  Music,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Heart,
  Loader2,
  Copy,
  Check,
  Type,
  Clock
} from 'lucide-react';

export function SyncedLyrics({
  lyricsData,
  currentTime = 0,
  duration = 0,
  isPlaying = false,
  isLoading = false,
  onSeek,
  onTogglePlay,
  onNext,
  onPrev,
  isShuffle = false,
  shuffleMode = 'off',
  onToggleShuffle,
  isLiked = false,
  onToggleLike,
  onClose,
  currentTrack
}) {
  const activeLineRef = useRef(null);
  const containerRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const scrollTimeoutRef = useRef(null);

  // New interactive controls: Sync offset (in seconds), font size ('normal' | 'large' | 'xl'), auto-scroll for plain lyrics, copy state
  const [syncOffset, setSyncOffset] = useState(0);
  const [fontSize, setFontSize] = useState('normal'); // 'normal' | 'large' | 'xl'
  const [autoScrollPlain, setAutoScrollPlain] = useState(true);
  const [copied, setCopied] = useState(false);

  // Reset offset when switching songs
  useEffect(() => {
    setSyncOffset(0);
    setUserScrolled(false);
  }, [currentTrack?.id, currentTrack?.title]);

  const { synced = [], plain = [], hasSynced = false } = lyricsData || {};

  // Effective playback time with user sync offset applied
  const effectiveTime = Math.max(0, currentTime + syncOffset);

  // Find index of currently active line based on playback time
  let activeIndex = -1;
  if (hasSynced && synced.length > 0) {
    for (let i = 0; i < synced.length; i++) {
      if (effectiveTime >= synced[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }
  } else if (!hasSynced && plain.length > 0 && autoScrollPlain && duration > 0) {
    // Smart estimated line progression for unsynced plain lyrics
    const ratio = Math.min(0.99, Math.max(0, effectiveTime / duration));
    activeIndex = Math.floor(ratio * plain.length);
  }

  // Smoothly auto-scroll active line into the middle of the screen unless the user manually scrolls
  useEffect(() => {
    if (!userScrolled && activeLineRef.current && containerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [activeIndex, userScrolled]);

  // Handle user manual scroll: pause auto-scroll for 3.5 seconds then resume smoothly
  const handleScroll = () => {
    setUserScrolled(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setUserScrolled(false);
    }, 3500);
  };

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const cycleFontSize = () => {
    setFontSize(prev => (prev === 'normal' ? 'large' : prev === 'large' ? 'xl' : 'normal'));
  };

  const handleCopyLyrics = async () => {
    const textToCopy = hasSynced
      ? synced.map(l => l.text).join('\n')
      : plain.join('\n');
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(
        `${currentTrack?.title || ''} - ${currentTrack?.artist || ''}\n\n${textToCopy}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {}
  };

  const activeSizeClasses =
    fontSize === 'xl'
      ? 'text-3xl sm:text-4xl md:text-5xl lg:text-6xl'
      : fontSize === 'large'
      ? 'text-2xl sm:text-3xl md:text-4xl lg:text-5xl'
      : 'text-xl sm:text-2xl md:text-3xl lg:text-4xl';

  const inactiveSizeClasses =
    fontSize === 'xl'
      ? 'text-xl sm:text-2xl md:text-3xl'
      : fontSize === 'large'
      ? 'text-lg sm:text-xl md:text-2xl'
      : 'text-base sm:text-lg md:text-xl';

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden select-none animate-fadeIn">
      {/* Dynamic Ambient Background Canvas derived from album artwork */}
      {currentTrack?.thumbnail && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={currentTrack.thumbnail}
            alt=""
            className="w-full h-full object-cover blur-[75px] opacity-45 scale-125 saturate-150 transform transition-all duration-1000"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black/85" />
        </div>
      )}

      {/* Top Header Bar */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 p-3.5 md:px-8 border-b border-white/10 backdrop-blur-md bg-black/40">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-spotify-elevated overflow-hidden shadow-lg flex-shrink-0 relative border border-white/10">
            {currentTrack?.thumbnail ? (
              <img src={currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                <Music className="w-5 h-5" />
              </div>
            )}
          </div>

          <div className="flex flex-col min-w-0 text-right">
            <h2 className="font-black text-sm sm:text-base md:text-xl text-white truncate max-w-[200px] sm:max-w-xs md:max-w-md tracking-tight">
              {currentTrack?.title}
            </h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs md:text-sm text-spotify-subtext truncate max-w-[140px] sm:max-w-xs">
                {currentTrack?.artist}
              </span>
              {hasSynced ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-[11px] font-bold bg-spotify-green/20 text-spotify-green border border-spotify-green/30 shadow-sm">
                  <Sparkles className="w-3 h-3 animate-pulse" />
                  מסונכרן לקצב
                </span>
              ) : plain.length > 0 ? (
                <button
                  onClick={() => setAutoScrollPlain(prev => !prev)}
                  title="הפעל/כבה גלילה חכמה לפי התקדמות השיר"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-[11px] font-bold transition-colors ${
                    autoScrollPlain
                      ? 'bg-spotify-green/20 text-spotify-green border border-spotify-green/30'
                      : 'bg-white/10 text-white/70'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  {autoScrollPlain ? 'גלילה חכמה פעילה' : 'מילים רגילות'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Lyrics Toolbar: Sync Offset, Font Size, Copy, Close */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {(hasSynced || (plain.length > 0 && autoScrollPlain)) && (
            <div className="flex items-center bg-white/10 rounded-full px-1.5 py-1 gap-1 border border-white/10" dir="ltr">
              <button
                onClick={() => setSyncOffset(prev => Math.round((prev - 0.5) * 10) / 10)}
                title="הקדם סנכרון מילים ב-0.5 שניות"
                className="px-1.5 py-0.5 text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                -0.5s
              </button>
              <button
                onClick={() => setSyncOffset(0)}
                title="אפס תזמון סנכרון"
                className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-full transition-colors flex items-center gap-1 ${
                  syncOffset !== 0 ? 'text-spotify-green bg-spotify-green/15' : 'text-white/60'
                }`}
              >
                <Clock className="w-3 h-3 hidden sm:inline" />
                {syncOffset > 0 ? `+${syncOffset}s` : `${syncOffset}s`}
              </button>
              <button
                onClick={() => setSyncOffset(prev => Math.round((prev + 0.5) * 10) / 10)}
                title="אחר סנכרון מילים ב-0.5 שניות"
                className="px-1.5 py-0.5 text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                +0.5s
              </button>
            </div>
          )}

          {(hasSynced || plain.length > 0) && (
            <>
              <button
                onClick={cycleFontSize}
                title={`גודל גופן: ${fontSize === 'normal' ? 'רגיל' : fontSize === 'large' ? 'גדול' : 'ענק'}`}
                className="h-9 px-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white/85 hover:text-white flex items-center gap-1 text-xs font-bold transition-all"
              >
                <Type className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {fontSize === 'normal' ? 'רגיל' : fontSize === 'large' ? 'גדול' : 'ענק'}
                </span>
              </button>

              <button
                onClick={handleCopyLyrics}
                title="העתק את מילות השיר"
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white/85 hover:text-white flex items-center justify-center transition-all"
              >
                {copied ? <Check className="w-4 h-4 text-spotify-green" /> : <Copy className="w-4 h-4" />}
              </button>
            </>
          )}

          <button
            onClick={onClose}
            title="סגור חלון מילים (Esc)"
            className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Lyrics Scrollable Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto max-w-3xl w-full mx-auto py-10 px-6 md:px-12 flex flex-col gap-5 md:gap-6 text-right [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        dir="auto"
      >
        {hasSynced && synced.length > 0 ? (
          synced.map((line, idx) => {
            const isActive = idx === activeIndex;
            const isPast = idx < activeIndex;

            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : null}
                onClick={() => {
                  setUserScrolled(false);
                  if (onSeek) onSeek(Math.max(0, line.time - syncOffset));
                }}
                className={`cursor-pointer transition-all duration-300 py-1.5 px-2.5 rounded-xl origin-right select-none ${
                  isActive
                    ? `text-white font-black ${activeSizeClasses} scale-[1.02] bg-white/[0.04] drop-shadow-[0_0_25px_rgba(255,255,255,0.45)]`
                    : isPast
                    ? `text-white/40 hover:text-white/80 font-bold ${inactiveSizeClasses} hover:bg-white/[0.02]`
                    : `text-white/25 hover:text-white/70 font-bold ${inactiveSizeClasses} hover:bg-white/[0.02]`
                }`}
              >
                <span className="inline-block leading-relaxed tracking-tight">
                  {line.text}
                </span>
              </div>
            );
          })
        ) : plain.length > 0 ? (
          // Plain lyrics view with optional Smart Auto-Scroll & proportional click-to-seek
          <div className="flex flex-col gap-3.5 max-w-2xl w-full py-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs text-spotify-green/90 font-bold inline-flex items-center gap-1.5 bg-spotify-green/10 px-3 py-1 rounded-full w-fit">
                <FileText className="w-3.5 h-3.5" />
                <span>
                  {autoScrollPlain
                    ? 'מילות השיר • גלילה חכמה לפי קצב השיר (לחץ על שורה לדילוג)'
                    : 'מילות השיר (טקסט מלא)'}
                </span>
              </div>
            </div>
            {plain.map((line, idx) => {
              const isActive = autoScrollPlain && idx === activeIndex;
              const isPast = autoScrollPlain && idx < activeIndex;
              return (
                <p
                  key={idx}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => {
                    if (onSeek && duration > 0 && plain.length > 0) {
                      setUserScrolled(false);
                      onSeek((idx / plain.length) * duration);
                    }
                  }}
                  className={`cursor-pointer transition-all duration-300 py-1 px-2 rounded-lg leading-relaxed ${
                    isActive
                      ? `text-white font-black ${activeSizeClasses} bg-white/[0.05] drop-shadow-[0_0_18px_rgba(255,255,255,0.3)]`
                      : isPast
                      ? `text-white/50 hover:text-white/85 font-semibold ${inactiveSizeClasses}`
                      : `text-white/80 hover:text-white font-semibold ${inactiveSizeClasses}`
                  }`}
                >
                  {line}
                </p>
              );
            })}
          </div>
        ) : (
          // Empty State
          <div className="flex flex-col items-center justify-center gap-4 my-auto text-spotify-subtext py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-spotify-subtext/60">
              <Mic2 className="w-8 h-8" />
            </div>
            <p className="text-xl font-black text-white/90">לא נמצאו מילים לשיר זה במאגר</p>
            <p className="text-sm text-spotify-subtext max-w-xs">
              המערכת סורקת מספר מאגרי מילים בינלאומיים וישראליים (LRCLIB, Lyrics.ovh, Lyrist).
            </p>
          </div>
        )}
      </div>

      {/* Integrated Full Music Player Bottom Controls */}
      <div className="relative z-10 p-4 md:px-8 bg-black/60 backdrop-blur-xl border-t border-white/10 flex flex-col gap-3">
        {/* Progress Bar & Timestamps */}
        <div className="flex items-center gap-3 w-full max-w-2xl mx-auto text-xs font-medium text-spotify-subtext" dir="ltr">
          <span className="w-10 text-left font-mono">{formatTime(currentTime)}</span>
          <div className="flex-1 relative flex items-center group h-4">
            <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden group-hover:h-1.5 transition-all">
              <div
                className="h-full bg-spotify-green group-hover:bg-spotify-green-hover transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={(e) => onSeek && onSeek(parseFloat(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <span className="w-10 text-right font-mono">{formatTime(duration)}</span>
        </div>

        {/* Buttons Bar */}
        <div className="flex items-center justify-between max-w-2xl w-full mx-auto">
          {/* Like Button */}
          <button
            onClick={() => onToggleLike && currentTrack && onToggleLike(currentTrack)}
            title={isLiked ? 'הסר משירים שאהבתי' : 'שמור בשירים שאהבתי'}
            className={`p-2 transition-transform hover:scale-110 active:scale-95 ${
              isLiked ? 'text-spotify-green' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <Heart className={`w-5 h-5 ${isLiked ? 'fill-spotify-green' : ''}`} />
          </button>

          {/* Main Controls (Prev, Play, Next) */}
          <div className="flex items-center gap-4">
            <button
              onClick={onPrev}
              title="שיר קודם"
              className="p-2 text-spotify-subtext hover:text-white transition-all hover:scale-110 active:scale-95"
            >
              <SkipBack className="w-6 h-6 fill-current" />
            </button>

            <button
              onClick={onTogglePlay}
              title={isPlaying ? 'השהה' : 'נגן'}
              className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-black" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current translate-x-0.5" />
              )}
            </button>

            <button
              onClick={onNext}
              title="שיר הבא"
              className="p-2 text-spotify-subtext hover:text-white transition-all hover:scale-110 active:scale-95"
            >
              <SkipForward className="w-6 h-6 fill-current" />
            </button>
          </div>

          {/* Shuffle Button */}
          <button
            onClick={onToggleShuffle}
            title={shuffleMode === 'smart' ? 'ערבוב חכם ✨' : shuffleMode === 'standard' || isShuffle ? 'ערבוב רגיל 🔀' : 'ערבוב כבוי'}
            className={`p-2 transition-transform hover:scale-110 active:scale-95 ${
              shuffleMode !== 'off' || isShuffle ? 'text-spotify-green' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <div className="relative inline-flex items-center justify-center">
              <Shuffle className="w-5 h-5" />
              {shuffleMode === 'smart' && (
                <Sparkles className="w-2.5 h-2.5 text-emerald-300 absolute -top-1 -right-1.5 animate-pulse" />
              )}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
