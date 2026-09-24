import React, { useState, useEffect, useRef } from 'react';
import { Lock, Unlock, Moon, Music2, SkipForward, SkipBack, Play, Pause } from 'lucide-react';

export function PocketModeOverlay({
  isOpen,
  onClose,
  currentTrack,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrev
}) {
  const [unlockHint, setUnlockHint] = useState(false);
  const lastTapRef = useRef(0);
  const hintTimeoutRef = useRef(null);

  // Keep screen on while Pocket Mode is active so Android doesn't suspend playback
  useEffect(() => {
    let sentinel = null;
    if (isOpen && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(s => { sentinel = s; }).catch(() => {});
    }
    return () => {
      if (sentinel) sentinel.release().catch(() => {});
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTap = (e) => {
    e.preventDefault();
    const now = Date.now();
    // Double tap detection (within 400ms)
    if (now - lastTapRef.current < 400) {
      onClose();
      return;
    }
    lastTapRef.current = now;

    // Show temporary hint
    setUnlockHint(true);
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setUnlockHint(false), 2500);
  };

  return (
    <div
      onClick={handleTap}
      onTouchStart={handleTap}
      className="fixed inset-0 z-[9999] bg-black flex flex-col justify-between p-6 select-none cursor-default"
      style={{ backgroundColor: '#000000' }}
    >
      {/* Top Status */}
      <div className="flex items-center justify-between text-zinc-700 text-xs font-mono pt-4">
        <div className="flex items-center gap-2">
          <Moon className="w-3.5 h-3.5 text-zinc-600" />
          <span>מצב כיס פעיל (OLED Off)</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-600">
          <Lock className="w-3.5 h-3.5" />
          <span>מגע נעול</span>
        </div>
      </div>

      {/* Center Ambient Track info (Ultra Dim to conserve 100% OLED battery) */}
      <div className="flex flex-col items-center justify-center text-center gap-4 my-auto">
        <div className="w-16 h-16 rounded-full border border-zinc-800 flex items-center justify-center text-zinc-700">
          <Music2 className="w-7 h-7" />
        </div>
        <div className="flex flex-col gap-1 max-w-xs px-4">
          <h3 className="text-zinc-500 font-bold text-sm truncate">{currentTrack?.title || 'שיר מתנגן'}</h3>
          <p className="text-zinc-700 text-xs truncate">{currentTrack?.artist || 'SpotiFree'}</p>
        </div>

        {/* Minimalist headphone controls in pocket mode */}
        <div
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="flex items-center gap-6 mt-4 text-zinc-600"
        >
          <button onClick={onPrev} className="p-3 text-zinc-600 hover:text-zinc-400 active:scale-90">
            <SkipBack className="w-5 h-5 fill-current" />
          </button>
          <button onClick={onTogglePlay} className="p-3 text-zinc-500 hover:text-zinc-300 active:scale-90">
            {isPlaying ? <Pause className="w-7 h-7 fill-current" /> : <Play className="w-7 h-7 fill-current" />}
          </button>
          <button onClick={onNext} className="p-3 text-zinc-600 hover:text-zinc-400 active:scale-90">
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
        </div>
      </div>

      {/* Bottom Hint */}
      <div className="text-center pb-6">
        <div className={`transition-opacity duration-300 ${unlockHint ? 'opacity-100 text-zinc-400' : 'opacity-30 text-zinc-700'}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-zinc-800 bg-zinc-950 text-xs">
            <Unlock className="w-3.5 h-3.5" />
            <span>הקש פעמיים ברצף לשחרור הנעילה</span>
          </div>
        </div>
      </div>
    </div>
  );
}
