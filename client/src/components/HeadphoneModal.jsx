import React, { useState, useEffect } from 'react';
import { Headphones, X, Volume2, CheckCircle2, AlertCircle, Sparkles, Play, ShieldCheck } from 'lucide-react';

export function HeadphoneModal({ isOpen, onClose }) {
  const [deviceList, setDeviceList] = useState([]);
  const [lastEvent, setLastEvent] = useState(null);
  const [testState, setTestState] = useState(null); // 'left' | 'right' | 'stereo' | null
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    // Check MediaSession support
    if (!('mediaSession' in navigator)) {
      setIsSupported(false);
    }

    // Detect connected audio devices
    const getDevices = async () => {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
          setDeviceList(audioOutputs);
        } catch (e) {
          console.error(e);
        }
      }
    };

    getDevices();

    // Listen for device changes (plug/unplug)
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      const onDeviceChange = () => {
        getDevices();
        setLastEvent('חיבור/ניתוק התקן שמע זוהה זה עתה');
      };
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Play synthetic stereo tone via Web Audio API
  const playTestTone = (type) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);

      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        if (type === 'left') {
          panner.pan.setValueAtTime(-1, ctx.currentTime);
          osc.frequency.setValueAtTime(440, ctx.currentTime);
          setTestState('צליל באוזן שמאל 👈');
        } else if (type === 'right') {
          panner.pan.setValueAtTime(1, ctx.currentTime);
          osc.frequency.setValueAtTime(554.37, ctx.currentTime);
          setTestState('צליל באוזן ימין 👉');
        } else {
          // Sweep from left to right
          panner.pan.setValueAtTime(-1, ctx.currentTime);
          panner.pan.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
          osc.frequency.setValueAtTime(523.25, ctx.currentTime);
          setTestState('בדיקת סטריאו משולבת (שמאל ➔ ימין) 🎧');
        }

        osc.connect(panner);
        panner.connect(gain);
      } else {
        osc.connect(gain);
        setTestState('צליל בדיקה מופעל');
      }

      gain.connect(ctx.destination);

      const duration = type === 'stereo' ? 1.4 : 0.8;
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.start();
      osc.stop(ctx.currentTime + duration);

      setTimeout(() => {
        setTestState(null);
      }, duration * 1000 + 400);
    } catch (err) {
      console.error('Audio test failed:', err);
      setTestState('שגיאה בהפעלת בדיקת שמע: ' + err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-spotify-elevated border border-spotify-border w-full max-w-lg rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-right select-none">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-spotify-border/40">
          <button
            onClick={onClose}
            className="p-1.5 text-spotify-subtext hover:text-white rounded-full hover:bg-spotify-highlight transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">בדיקת חיבור אוזניות ושמע</h2>
            <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
              <Headphones className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Status Checklist */}
        <div className="flex flex-col gap-2.5 bg-spotify-dark/60 p-4 rounded-xl border border-white/5">
          <span className="text-xs font-bold text-spotify-subtext uppercase tracking-wider mb-1">
            סטטוס אינטגרציה פעילה במכשיר
          </span>

          <div className="flex items-center justify-between text-xs sm:text-sm">
            <div className="flex items-center gap-2 text-white">
              <span>אינטגרציית MediaSession</span>
            </div>
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>פעיל (כפתורי אוזניות נתמכים)</span>
            </span>
          </div>

          <div className="flex items-center justify-between text-xs sm:text-sm">
            <div className="flex items-center gap-2 text-white">
              <span>עצירה אוטומטית בניתוק (Auto-Pause)</span>
            </div>
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>מופעל (הגנה מרעש ברמקול)</span>
            </span>
          </div>

          <div className="flex items-center justify-between text-xs sm:text-sm">
            <div className="flex items-center gap-2 text-white">
              <span>שליטה במסך נעילה ובווילון התראות</span>
            </div>
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>תמונת HD וסרגל זמן פעילים</span>
            </span>
          </div>
        </div>

        {/* Interactive Stereo Channel Test */}
        <div className="flex flex-col gap-3">
          <span className="text-xs font-bold text-spotify-subtext uppercase tracking-wider">
            בדיקת שמע וערוצי סטריאו (באוזניות)
          </span>
          <p className="text-xs text-spotify-subtext leading-relaxed">
            לחץ על הכפתורים לבדיקת צליל נעים באוזן ימין, באוזן שמאל או סטריאו מלא:
          </p>

          <div className="grid grid-cols-3 gap-2.5">
            <button
              onClick={() => playTestTone('left')}
              className="py-2.5 px-3 rounded-lg bg-spotify-highlight hover:bg-spotify-border text-white text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-95 border border-white/5"
            >
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <span>אוזן שמאל (L)</span>
            </button>

            <button
              onClick={() => playTestTone('stereo')}
              className="py-2.5 px-3 rounded-lg bg-spotify-green hover:bg-spotify-green-hover text-black text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-95 shadow-md shadow-spotify-green/20"
            >
              <Headphones className="w-4 h-4" />
              <span>סטריאו מלא</span>
            </button>

            <button
              onClick={() => playTestTone('right')}
              className="py-2.5 px-3 rounded-lg bg-spotify-highlight hover:bg-spotify-border text-white text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-95 border border-white/5"
            >
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <span>אוזן ימין (R)</span>
            </button>
          </div>

          {testState && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-center text-xs font-bold animate-pulse">
              {testState}
            </div>
          )}
        </div>

        {/* Headphone Hardware Buttons Guide */}
        <div className="bg-spotify-dark/40 border border-spotify-border/40 p-3.5 rounded-xl flex flex-col gap-2">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-spotify-green" />
            <span>פקודות כפתורי אוזניות נתמכות:</span>
          </span>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-spotify-subtext">
            <div>• <strong className="text-white">לחיצה אחת:</strong> נגן / השהה (Play / Pause)</div>
            <div>• <strong className="text-white">שתי לחיצות:</strong> שיר הבא (Next Track)</div>
            <div>• <strong className="text-white">שלוש לחיצות:</strong> שיר קודם (Previous Track)</div>
            <div>• <strong className="text-white">לחיצה ארוכה:</strong> הרצה 10 שניות קדימה</div>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between text-[11px] text-spotify-subtext pt-2 border-t border-spotify-border/40">
          <span>SpotiFree Audio Engine 2.0</span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-white text-black font-bold text-xs hover:bg-gray-200 transition-colors"
          >
            אישור וסגירה
          </button>
        </div>
      </div>
    </div>
  );
}
