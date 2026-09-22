import React, { useEffect, useRef, useState } from 'react';
import { X, Mic2, Sparkles, FileText, Music, Play } from 'lucide-react';

export function SyncedLyrics({ lyricsData, currentTime, onSeek, onClose, currentTrack }) {
  const activeLineRef = useRef(null);
  const containerRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const scrollTimeoutRef = useRef(null);

  const { synced = [], plain = [], hasSynced = false } = lyricsData || {};

  // Find index of currently active line based on playback time
  let activeIndex = -1;
  if (hasSynced && synced.length > 0) {
    for (let i = 0; i < synced.length; i++) {
      if (currentTime >= synced[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }
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

  // Handle user manual scroll: pause auto-scroll for 3 seconds then resume smoothly
  const handleScroll = () => {
    setUserScrolled(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setUserScrolled(false);
    }, 3500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden select-none animate-fadeIn">
      {/* Dynamic Ambient Background Canvas derived from album artwork */}
      {currentTrack?.thumbnail && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={currentTrack.thumbnail}
            alt=""
            className="w-full h-full object-cover blur-[90px] opacity-25 scale-125 transform transition-all duration-1000"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black/95" />
        </div>
      )}

      {/* Top Header Bar */}
      <div className="relative z-10 flex items-center justify-between p-4 md:px-8 md:py-6 border-b border-white/10 backdrop-blur-md bg-black/30">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-spotify-elevated overflow-hidden shadow-lg flex-shrink-0 relative border border-white/10">
            {currentTrack?.thumbnail ? (
              <img src={currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                <Music className="w-5 h-5" />
              </div>
            )}
          </div>

          <div className="flex flex-col min-w-0 text-right">
            <h2 className="font-extrabold text-base md:text-xl text-white truncate max-w-xs md:max-w-md tracking-tight">
              {currentTrack?.title}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs md:text-sm text-spotify-subtext truncate max-w-xs">
                {currentTrack?.artist}
              </span>
              {hasSynced ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-spotify-green/20 text-spotify-green border border-spotify-green/30">
                  <Sparkles className="w-3 h-3 animate-pulse" />
                  מסונכרן לקצב
                </span>
              ) : plain.length > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/10 text-white/70">
                  <FileText className="w-3 h-3" />
                  מילים רגילות
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          title="סגור חלון מילים"
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-md"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Lyrics Scrollable Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto max-w-3xl w-full mx-auto py-16 px-4 md:px-8 flex flex-col items-center gap-6 md:gap-8 text-center scrollbar-none"
      >
        {hasSynced && synced.length > 0 ? (
          synced.map((line, idx) => {
            const isActive = idx === activeIndex;
            const isPast = idx < activeIndex;

            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : null}
                onClick={() => onSeek(line.time)}
                dir="auto"
                className={`group cursor-pointer transition-all duration-300 max-w-2xl px-4 py-2 rounded-2xl ${
                  isActive
                    ? 'text-white font-extrabold text-2xl md:text-4xl scale-105 drop-shadow-[0_0_20px_rgba(30,215,96,0.6)] bg-white/5'
                    : isPast
                    ? 'text-white/35 hover:text-white/70 font-bold text-lg md:text-2xl hover:scale-102'
                    : 'text-white/25 hover:text-white/60 font-bold text-lg md:text-2xl hover:scale-102'
                }`}
              >
                <span className="inline-block leading-relaxed">
                  {line.text}
                </span>
              </div>
            );
          })
        ) : plain.length > 0 ? (
          // Plain unsynced lyrics view
          <div className="flex flex-col gap-4 max-w-xl w-full text-center py-6" dir="auto">
            <div className="text-xs text-spotify-green/80 font-medium mb-4 inline-block bg-spotify-green/10 px-3 py-1 rounded-full mx-auto">
              מילות השיר (טקסט מלא)
            </div>
            {plain.map((line, idx) => (
              <p
                key={idx}
                className="text-white/80 font-medium text-lg md:text-xl leading-relaxed transition-colors hover:text-white"
              >
                {line}
              </p>
            ))}
          </div>
        ) : (
          // Empty State
          <div className="flex flex-col items-center justify-center gap-4 my-auto text-spotify-subtext py-12">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-spotify-subtext/60">
              <Mic2 className="w-8 h-8" />
            </div>
            <p className="text-lg font-bold text-white/90">לא נמצאו מילים לשיר זה במאגר</p>
            <p className="text-sm text-spotify-subtext max-w-xs">
              המערכת סורקת מאגרי מילים רשמיים. נסה שיר אחר או חפש מחדש.
            </p>
          </div>
        )}
      </div>

      {/* Subtle Bottom Tip Bar */}
      {hasSynced && synced.length > 0 && (
        <div className="relative z-10 py-2.5 px-4 text-center border-t border-white/5 bg-black/40 backdrop-blur-sm text-[11px] text-spotify-subtext/60">
          💡 לחץ על כל שורה כדי לקפוץ ישירות לנקודה זו בשיר
        </div>
      )}
    </div>
  );
}
