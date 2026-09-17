import React, { useState } from 'react';
import { X, DownloadCloud, Loader2, Music, Check, Sparkles } from 'lucide-react';
import { importPlaylist } from '../services/api';

export function ImportModal({ isOpen, onClose, onPlaylistImported }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

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

  const sampleSpotifyUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-spotify-dark border border-spotify-border rounded-xl max-w-lg w-full p-6 flex flex-col gap-5 shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <h2 className="font-bold text-lg text-white">ייבוא פלייליסט חיצוני</h2>
          </div>
          <button
            onClick={onClose}
            className="text-spotify-subtext hover:text-white p-1 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleFetch} className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-spotify-subtext">
            הדבק קישור מספוטיפיי או מיוטיוב:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="https://open.spotify.com/playlist/... או YouTube"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-spotify-elevated text-white text-sm px-3.5 py-2.5 rounded-lg border border-spotify-border focus:border-spotify-green focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="bg-spotify-green hover:bg-spotify-green-hover disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg text-sm transition-all flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'טען'}
            </button>
          </div>

          <div className="text-[11px] text-spotify-subtext flex items-center gap-1.5 mt-1">
            <Sparkles className="w-3.5 h-3.5 text-spotify-green" />
            <span>דוגמה:</span>
            <button
              type="button"
              onClick={() => {
                setUrl(sampleSpotifyUrl);
              }}
              className="text-spotify-green underline hover:text-spotify-green-hover truncate max-w-xs"
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
          <div className="p-4 bg-spotify-elevated rounded-lg border border-spotify-border flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {preview.cover ? (
                <img src={preview.cover} alt="" className="w-14 h-14 rounded-md object-cover shadow-md" />
              ) : (
                <div className="w-14 h-14 rounded-md bg-spotify-highlight flex items-center justify-center text-spotify-subtext">
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
              <Check className="w-4 h-4" />
              <span>שמור פלייליסט זה בספרייה שלי</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
