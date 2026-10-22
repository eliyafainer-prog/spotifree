import React, { useState, useRef } from 'react';
import {
  X,
  DownloadCloud,
  Loader2,
  Music,
  Check,
  Sparkles,
  Upload,
  Download,
  FileJson,
  Layers
} from 'lucide-react';
import { importPlaylist } from '../services/api';
import { exportBackupData, importBackupData } from '../services/storage';

export function ImportModal({ isOpen, onClose, onPlaylistImported, onLibraryRestored, showToast }) {
  const [activeTab, setActiveTab] = useState('url'); // 'url' | 'backup'
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [backupStatus, setBackupStatus] = useState(null);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFetch = async (e) => {
    e?.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setPreview(null);

    try {
      const result = await importPlaylist(url.trim());
      setPreview(result);
    } catch (err) {
      setError(err.message || 'נכשל פיענוח הקישור. ודא שהפלייליסט ציבורי ושהקישור תקין.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!preview) return;

    const newPlaylist = {
      id: `pl_${Date.now()}`,
      title: preview.title,
      cover: preview.cover,
      type: preview.type,
      tracks: preview.tracks,
      createdAt: Date.now()
    };

    onPlaylistImported(newPlaylist);
    onClose();
    setUrl('');
    setPreview(null);
  };

  const handleExportBackup = () => {
    try {
      const jsonStr = exportBackupData();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `spotifree_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);

      if (showToast) showToast('קובץ גיבוי הורד בהצלחה!');
      setBackupStatus({ type: 'success', message: 'קובץ הגיבוי הורד בהצלחה למכשיר שלך.' });
    } catch (err) {
      setBackupStatus({ type: 'error', message: 'שגיאה ביצירת קובץ הגיבוי.' });
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result;
        const result = importBackupData(content);
        if (onLibraryRestored) onLibraryRestored();
        if (showToast) {
          showToast(`שוחזרו בהצלחה ${result.playlistsCount} פלייליסטים ו-${result.likedSongsCount} שירים!`);
        }
        setBackupStatus({
          type: 'success',
          message: `שוחזרו בהצלחה ${result.playlistsCount} פלייליסטים חדשים ו-${result.likedSongsCount} שירים מועדפים!`
        });
      } catch (err) {
        setBackupStatus({ type: 'error', message: err.message || 'קובץ הגיבוי פגום או לא תקין.' });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sampleSpotifyUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn select-none">
      <div className="bg-[#181818] border border-white/10 rounded-2xl max-w-lg w-full p-6 flex flex-col gap-5 shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <h2 className="font-bold text-lg text-white">ייבוא וגיבוי מוזיקה</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#b3b3b3] hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex bg-[#222222] p-1 rounded-xl gap-1">
          <button
            onClick={() => setActiveTab('url')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'url' ? 'bg-[#333333] text-white shadow' : 'text-[#b3b3b3] hover:text-white'
            }`}
          >
            <DownloadCloud className="w-4 h-4" />
            <span>קישור חיצוני (Spotify / YT)</span>
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'backup' ? 'bg-[#333333] text-white shadow' : 'text-[#b3b3b3] hover:text-white'
            }`}
          >
            <FileJson className="w-4 h-4" />
            <span>גיבוי ושחזור JSON</span>
          </button>
        </div>

        {activeTab === 'url' ? (
          <>
            {/* Input Form */}
            <form onSubmit={handleFetch} className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-[#b3b3b3]">
                הדבק קישור מספוטיפיי או מיוטיוב:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://open.spotify.com/playlist/... או YouTube"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 bg-[#282828] text-white text-sm px-3.5 py-2.5 rounded-lg border border-white/10 focus:border-spotify-green focus:outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={loading || !url.trim()}
                  className="bg-spotify-green hover:bg-spotify-green-hover disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg text-sm transition-all flex items-center gap-2 shadow"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'טען'}
                </button>
              </div>

              <div className="text-[11px] text-[#b3b3b3] flex items-center gap-1.5 mt-1">
                <Sparkles className="w-3.5 h-3.5 text-spotify-green" />
                <span>דוגמה:</span>
                <button
                  type="button"
                  onClick={() => setUrl(sampleSpotifyUrl)}
                  className="text-spotify-green underline hover:text-spotify-green-hover truncate max-w-xs text-right"
                >
                  Today's Top Hits (Spotify)
                </button>
              </div>
            </form>

            {/* Error message */}
            {error && (
              <div className="p-3 bg-red-900/30 border border-red-500/40 rounded-lg text-xs text-red-300">
                {error}
              </div>
            )}

            {/* Preview of loaded playlist */}
            {preview && (
              <div className="p-4 bg-[#282828] rounded-xl border border-white/10 flex flex-col gap-3 animate-fadeIn">
                <div className="flex items-center gap-3">
                  {preview.cover ? (
                    <img src={preview.cover} alt="" className="w-14 h-14 rounded-md object-cover shadow-md" />
                  ) : (
                    <div className="w-14 h-14 rounded-md bg-[#333333] flex items-center justify-center text-[#b3b3b3]">
                      <Music className="w-6 h-6" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white text-base truncate">{preview.title}</h3>
                    <p className="text-xs text-spotify-green font-medium">
                      זוהו {preview.totalTracks} שירים ({preview.type.toUpperCase()})
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleSave}
                  className="w-full bg-spotify-green hover:bg-spotify-green-hover text-black font-bold py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-spotify-green/20"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>שמור פלייליסט זה בספרייה שלי</span>
                </button>
              </div>
            )}
          </>
        ) : (
          /* Backup & Restore Tab */
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[#b3b3b3] leading-relaxed">
              שמור עותק מקומי של כל הפלייליסטים, השירים המועדפים והגדרות הספרייה שלך לקובץ JSON מאובטח, או שחזר אותם בכל מכשיר.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Export Button */}
              <button
                onClick={handleExportBackup}
                className="flex flex-col items-center justify-center gap-2 p-4 bg-[#242424] hover:bg-[#2c2c2c] border border-white/10 rounded-xl text-white transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Download className="w-5 h-5" />
                </div>
                <span className="font-bold text-xs">ייצא קובץ גיבוי</span>
                <span className="text-[10px] text-[#b3b3b3] text-center">
                  הורד קובץ .json למכשיר
                </span>
              </button>

              {/* Import Button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 p-4 bg-[#242424] hover:bg-[#2c2c2c] border border-white/10 rounded-xl text-white transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-5 h-5" />
                </div>
                <span className="font-bold text-xs">שחזר מגיבוי</span>
                <span className="text-[10px] text-[#b3b3b3] text-center">
                  טען קובץ .json קיים
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>

            {backupStatus && (
              <div
                className={`p-3 rounded-lg text-xs border ${
                  backupStatus.type === 'success'
                    ? 'bg-spotify-green/10 text-spotify-green border-spotify-green/30'
                    : 'bg-red-900/30 text-red-300 border-red-500/40'
                }`}
              >
                {backupStatus.message}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
