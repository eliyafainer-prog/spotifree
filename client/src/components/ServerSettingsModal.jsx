import React, { useState } from 'react';
import { Server, Wifi, Cloud, Check, RefreshCw, X, Globe } from 'lucide-react';
import { getActiveServerUrl, setActiveServerUrl, DEFAULT_SERVERS } from '../services/api';

export function ServerSettingsModal({ isOpen, onClose, showToast }) {
  const [currentUrl, setCurrentUrl] = useState(() => getActiveServerUrl());
  const [customInput, setCustomInput] = useState(() => getActiveServerUrl() || '');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  if (!isOpen) return null;

  const testConnection = async (url) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const target = (url || '').replace(/\/+$/, '') + '/api/trending';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(target, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        setTestResult({ success: true, message: 'החיבור הצליח! השרת פעיל ומוכן.' });
      } else {
        setTestResult({ success: false, message: `השרת החזיר שגיאה: ${res.status}` });
      }
    } catch (err) {
      setTestResult({ success: false, message: 'לא ניתן להתחבר לשרת זה. בדוק כתובת או רשת.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSelect = (url) => {
    setActiveServerUrl(url);
    setCurrentUrl(url);
    showToast?.('כתובת השרת עודכנה בהצלחה!');
    testConnection(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#181818] border border-white/10 rounded-2xl shadow-2xl p-6 text-white text-right font-sans">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <button
            onClick={onClose}
            className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">הגדרות חיבור שרת (SpotiFree)</h2>
            <Server className="w-5 h-5 text-green-500" />
          </div>
        </div>

        {/* Server Options */}
        <div className="mt-4 space-y-3">
          <p className="text-xs text-zinc-400 leading-relaxed">
            בחר את שרת המקור עבור חיפוש והזרמת שמע. שרת ה-PC המקומי מאפשר איכות מקסימלית ועקיפה מלאה של חסימות.
          </p>

          {/* Option 1: Local PC */}
          <button
            onClick={() => handleSelect(DEFAULT_SERVERS.local)}
            className={`w-full flex items-center justify-between p-3 rounded-xl border text-right transition-all ${
              currentUrl === DEFAULT_SERVERS.local
                ? 'bg-green-500/10 border-green-500/50 text-white'
                : 'bg-zinc-900 border-white/5 text-zinc-300 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2">
              {currentUrl === DEFAULT_SERVERS.local && <Check className="w-4 h-4 text-green-500" />}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-semibold text-sm flex items-center gap-1.5 justify-end">
                  <span>מחשב מקומי (Wi-Fi LAN)</span>
                  <Wifi className="w-4 h-4 text-green-400" />
                </div>
                <div className="text-xs text-zinc-400">{DEFAULT_SERVERS.local}</div>
              </div>
            </div>
          </button>

          {/* Option 2: Tailscale */}
          <button
            onClick={() => handleSelect(DEFAULT_SERVERS.tailscale)}
            className={`w-full flex items-center justify-between p-3 rounded-xl border text-right transition-all ${
              currentUrl === DEFAULT_SERVERS.tailscale
                ? 'bg-green-500/10 border-green-500/50 text-white'
                : 'bg-zinc-900 border-white/5 text-zinc-300 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2">
              {currentUrl === DEFAULT_SERVERS.tailscale && <Check className="w-4 h-4 text-green-500" />}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-semibold text-sm flex items-center gap-1.5 justify-end">
                  <span>Tailscale VPN (מכל מקום בעולם)</span>
                  <Globe className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-xs text-zinc-400">{DEFAULT_SERVERS.tailscale}</div>
              </div>
            </div>
          </button>

          {/* Option 3: Cloud Render */}
          <button
            onClick={() => handleSelect(DEFAULT_SERVERS.cloud)}
            className={`w-full flex items-center justify-between p-3 rounded-xl border text-right transition-all ${
              currentUrl === DEFAULT_SERVERS.cloud
                ? 'bg-green-500/10 border-green-500/50 text-white'
                : 'bg-zinc-900 border-white/5 text-zinc-300 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2">
              {currentUrl === DEFAULT_SERVERS.cloud && <Check className="w-4 h-4 text-green-500" />}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-semibold text-sm flex items-center gap-1.5 justify-end">
                  <span>שרת ענן (Render)</span>
                  <Cloud className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-xs text-zinc-400">{DEFAULT_SERVERS.cloud}</div>
              </div>
            </div>
          </button>

          {/* Custom IP input */}
          <div className="pt-2">
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              או הזן כתובת שרת ידנית:
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => handleSelect(customInput.trim())}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-semibold text-white transition-colors"
              >
                שמור
              </button>
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="http://192.168.1.xxx:5050"
                className="flex-1 px-3 py-2 bg-zinc-900 border border-white/10 rounded-xl text-xs text-left text-white placeholder-zinc-500 focus:outline-none focus:border-green-500"
              />
            </div>
          </div>

          {/* Test connection button & status */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
            <button
              onClick={() => testConnection(currentUrl)}
              disabled={isTesting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isTesting ? 'בודק חיבור...' : 'בדוק חיבור'}</span>
            </button>
            {testResult && (
              <span className={`text-xs ${testResult.success ? 'text-green-400' : 'text-rose-400'}`}>
                {testResult.message}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full py-2.5 bg-green-500 hover:bg-green-400 text-black font-semibold rounded-xl text-sm transition-colors shadow-lg shadow-green-500/20"
        >
          אישור וסגירה
        </button>
      </div>
    </div>
  );
}
