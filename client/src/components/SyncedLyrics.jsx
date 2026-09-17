import React, { useEffect, useRef } from 'react';
import { X, Mic2, AlertCircle } from 'lucide-react';

export function SyncedLyrics({ lyricsData, currentTime, onSeek, onClose, currentTrack }) {
  const activeLineRef = useRef(null);
  const containerRef = useRef(null);

  const { synced = [], plain = [], hasSynced = false } = lyricsData || {};

  // Find index of currently active line
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

  // Smoothly scroll active line into the middle of the viewport
  useEffect(() => {
    if (activeLineRef.current && containerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [activeIndex]);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-spotify-dark/95 via-black/98 to-black backdrop-blur-xl flex flex-col p-4 md:p-8 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-spotify-border/40 max-w-4xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-spotify-highlight flex items-center justify-center text-spotify-green">
            <Mic2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-lg md:text-xl text-white truncate max-w-xs md:max-w-md">
              {currentTrack?.title}
            </h2>
            <p className="text-xs md:text-sm text-spotify-subtext">
              {currentTrack?.artist}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-spotify-highlight text-spotify-subtext hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Lyrics Content Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto max-w-4xl w-full mx-auto py-12 px-2 md:px-6 flex flex-col items-center gap-6 text-center select-none"
      >
        {hasSynced && synced.length > 0 ? (
          synced.map((line, idx) => {
            const isActive = idx === activeIndex;
            const isPast = idx < activeIndex;

            return (
              <p
                key={idx}
                ref={isActive ? activeLineRef : null}
                onClick={() => onSeek(line.time)}
                className={`cursor-pointer transition-all duration-300 font-bold text-lg md:text-2xl lg:text-3xl max-w-2xl leading-relaxed ${
                  isActive
                    ? 'text-white scale-105 drop-shadow-[0_0_12px_rgba(30,215,96,0.5)]'
                    : isPast
                    ? 'text-white/40 hover:text-white/70'
                    : 'text-white/25 hover:text-white/60'
                }`}
              >
                {line.text}
              </p>
            );
          })
        ) : plain.length > 0 ? (
          // Plain lyrics without timestamps
          <div className="flex flex-col gap-4 max-w-xl text-spotify-subtext font-medium text-lg leading-relaxed">
            <div className="text-xs text-spotify-green mb-4">(מילים לא מסונכרנות לזמן)</div>
            {plain.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 my-auto text-spotify-subtext">
            <AlertCircle className="w-10 h-10 text-spotify-subtext/60" />
            <p className="text-base font-medium">לא נמצאו מילים לשיר זה במאגר</p>
            <p className="text-xs text-spotify-subtext/60">נסה שיר אחר או חפש מחדש</p>
          </div>
        )}
      </div>
    </div>
  );
}
