import React, { useState } from 'react';
import { X, Plus, Music, Check, CheckCircle2, ListPlus } from 'lucide-react';
import { isTrackInPlaylist } from '../services/storage';

export function AddToPlaylistModal({
  isOpen,
  onClose,
  track,
  playlists = [],
  onAddToPlaylist,
  onCreatePlaylist
}) {
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [addedPlaylistIds, setAddedPlaylistIds] = useState(new Set());

  if (!isOpen || !track) return null;

  const handleCreate = (e) => {
    e?.preventDefault();
    if (!newPlaylistName.trim()) return;
    const newName = newPlaylistName.trim();
    setNewPlaylistName('');
    setIsCreating(false);
    onCreatePlaylist(newName, track);
  };

  const handleSelect = (playlistId) => {
    onAddToPlaylist(playlistId, track);
    setAddedPlaylistIds(prev => new Set([...prev, playlistId]));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn select-none"
      onClick={onClose}
    >
      <div
        className="bg-spotify-elevated rounded-2xl p-6 w-full max-w-md border border-white/10 shadow-2xl relative flex flex-col max-h-[85vh] animate-scaleUp text-right"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <button
            onClick={onClose}
            className="p-1 text-spotify-subtext hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white">הוספה לפלייליסט</h2>
            <ListPlus className="w-5 h-5 text-spotify-green" />
          </div>
        </div>

        {/* Selected Track Pill */}
        <div className="flex items-center gap-3 my-4 p-2.5 bg-black/40 rounded-xl border border-white/5">
          <div className="w-11 h-11 rounded-lg overflow-hidden bg-spotify-highlight flex-shrink-0">
            {track.thumbnail ? (
              <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                <Music className="w-5 h-5" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">{track.title}</p>
            <p className="text-xs text-spotify-subtext truncate">{track.artist}</p>
          </div>
        </div>

        {/* Create New Playlist Button / Inline Input */}
        {isCreating ? (
          <form onSubmit={handleCreate} className="mb-4 flex items-center gap-2">
            <input
              type="text"
              autoFocus
              placeholder="שם הפלייליסט החדש..."
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              className="flex-1 bg-spotify-dark border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder-spotify-subtext focus:outline-none focus:border-spotify-green"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim()}
              className="bg-spotify-green hover:bg-spotify-green-hover text-black font-bold text-xs px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              צור והוסף
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="p-2 text-spotify-subtext hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center justify-center gap-2 w-full py-2.5 mb-4 rounded-xl border border-dashed border-white/20 hover:border-spotify-green text-sm font-semibold text-white hover:text-spotify-green transition-all group"
          >
            <Plus className="w-4 h-4 group-hover:scale-110 transition-transform text-spotify-green" />
            <span>צור פלייליסט חדש</span>
          </button>
        )}

        {/* Playlists List */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1 custom-scrollbar">
          {playlists.length === 0 ? (
            <div className="p-8 text-center text-spotify-subtext text-xs">
              אין עדיין פלייליסטים. צור את הפלייליסט הראשון שלך למעלה!
            </div>
          ) : (
            playlists.map((pl) => {
              const alreadyIn = isTrackInPlaylist(pl, track) || addedPlaylistIds.has(pl.id);

              return (
                <div
                  key={pl.id}
                  onClick={() => !alreadyIn && handleSelect(pl.id)}
                  className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                    alreadyIn
                      ? 'bg-white/5 opacity-80 cursor-default'
                      : 'hover:bg-spotify-highlight/60 cursor-pointer active:scale-[0.99]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-spotify-dark flex-shrink-0 border border-white/5">
                      {pl.cover ? (
                        <img src={pl.cover} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                          <Music className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{pl.title}</p>
                      <p className="text-xs text-spotify-subtext">
                        {pl.tracks?.length || 0} שירים
                      </p>
                    </div>
                  </div>

                  <div className="flex-shrink-0 mr-3">
                    {alreadyIn ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-spotify-green bg-spotify-green/10 px-2.5 py-1 rounded-full">
                        <Check className="w-3.5 h-3.5" />
                        <span>נמצא בפלייליסט</span>
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(pl.id);
                        }}
                        className="p-1.5 rounded-full hover:bg-spotify-green hover:text-black text-spotify-subtext transition-colors"
                        title="הוסף לפלייליסט זה"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
