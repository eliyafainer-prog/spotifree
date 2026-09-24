import React, { useState, useRef, useMemo } from 'react';
import {
  Play,
  Shuffle,
  Sparkles,
  Trash2,
  Music,
  Clock,
  ArrowUpDown,
  Search,
  X,
  Pencil,
  Check,
  MoveVertical,
  SlidersHorizontal
} from 'lucide-react';
import { TrackRow } from './TrackRow';

export function PlaylistView({
  playlist,
  currentTrack,
  isPlaying,
  isLoading = false,
  onPlayTrack,
  likedSongs = [],
  onToggleLike,
  onDeletePlaylist,
  downloadedIds = new Set(),
  downloadingIds = new Set(),
  onDownloadTrack,
  onOpenAddToPlaylist,
  onRemoveTrackFromPlaylist,
  shuffleMode = 'off',
  onToggleShuffle,
  onPlayShuffled,
  onReorderTracks,
  onRenamePlaylist
}) {
  if (!playlist) return null;

  const rawTracks = playlist.tracks || [];

  // Playlist management states
  const [filterQuery, setFilterQuery] = useState('');
  const [sortBy, setSortBy] = useState('custom'); // 'custom' | 'title-asc' | 'title-desc' | 'artist-asc' | 'duration-desc' | 'duration-asc' | 'newest'
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(playlist.title || '');

  // Drag & drop ref
  const draggedIndexRef = useRef(null);

  // Play All
  const handlePlayAll = () => {
    if (processedTracks.length > 0) {
      onPlayTrack(processedTracks[0], processedTracks, 0);
    }
  };

  // Shuffle Play
  const handleShufflePlay = () => {
    if (processedTracks.length === 0) return;
    if (onPlayShuffled) {
      onPlayShuffled(processedTracks);
    } else {
      if (shuffleMode === 'off' && onToggleShuffle) {
        onToggleShuffle();
      }
      const randomIdx = Math.floor(Math.random() * processedTracks.length);
      onPlayTrack(processedTracks[randomIdx], processedTracks, randomIdx);
    }
  };

  // Reorder helper (move item from fromIdx to toIdx in rawTracks)
  const handleMoveTrack = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= rawTracks.length || toIdx >= rawTracks.length) return;
    const newTracks = [...rawTracks];
    const [moved] = newTracks.splice(fromIdx, 1);
    newTracks.splice(toIdx, 0, moved);
    if (onReorderTracks) {
      onReorderTracks(newTracks);
    }
  };

  // HTML5 Drag and Drop handlers
  const handleDragStart = (e, index) => {
    draggedIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    const sourceIndex = draggedIndexRef.current;
    if (sourceIndex !== null && sourceIndex !== undefined && sourceIndex !== targetIndex) {
      handleMoveTrack(sourceIndex, targetIndex);
    }
    draggedIndexRef.current = null;
  };

  // Save renamed title
  const handleSaveTitle = () => {
    const trimmed = editedTitle.trim();
    if (trimmed && onRenamePlaylist) {
      onRenamePlaylist(trimmed);
    }
    setIsEditingTitle(false);
  };

  // Processed (filtered & sorted) tracks
  const processedTracks = useMemo(() => {
    let result = [...rawTracks];

    // Filter
    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase();
      result = result.filter(
        t => (t.title && t.title.toLowerCase().includes(q)) ||
             (t.artist && t.artist.toLowerCase().includes(q))
      );
    }

    // Sort (only if not actively reordering or if non-custom sort selected)
    if (!isReorderMode && sortBy !== 'custom') {
      result.sort((a, b) => {
        if (sortBy === 'title-asc') {
          return (a.title || '').localeCompare(b.title || '', 'he');
        }
        if (sortBy === 'title-desc') {
          return (b.title || '').localeCompare(a.title || '', 'he');
        }
        if (sortBy === 'artist-asc') {
          return (a.artist || '').localeCompare(b.artist || '', 'he');
        }
        if (sortBy === 'duration-desc') {
          return (b.durationSeconds || 0) - (a.durationSeconds || 0);
        }
        if (sortBy === 'duration-asc') {
          return (a.durationSeconds || 0) - (b.durationSeconds || 0);
        }
        if (sortBy === 'newest') {
          return -1; // Reverse original
        }
        return 0;
      });
    }

    return result;
  }, [rawTracks, filterQuery, sortBy, isReorderMode]);

  const isAlbum = playlist.type?.toLowerCase() === 'album';
  const isCustomPlaylist = playlist.id !== 'liked';

  return (
    <div className="flex flex-col gap-6 animate-fadeIn pb-16">
      {/* Playlist Hero Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 bg-gradient-to-b from-spotify-highlight/70 via-spotify-elevated/40 to-transparent rounded-2xl border border-white/5 shadow-2xl">
        <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-xl bg-spotify-elevated shadow-[0_12px_40px_rgba(0,0,0,0.8)] overflow-hidden flex-shrink-0 border border-white/10">
          {playlist.cover ? (
            <img src={playlist.cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-spotify-subtext bg-gradient-to-br from-spotify-elevated to-spotify-dark">
              <Music className="w-20 h-20" />
            </div>
          )}
        </div>

        <div className="flex flex-col items-center sm:items-start text-center sm:text-right flex-1 min-w-0">
          <span className="text-xs uppercase font-bold tracking-wider text-spotify-green">
            {isAlbum ? 'אלבום' : 'פלייליסט'}
          </span>

          {/* Editable Playlist Title */}
          {isEditingTitle ? (
            <div className="flex items-center gap-2 mt-1 mb-3 w-full max-w-md">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                autoFocus
                className="bg-spotify-elevated text-white text-xl sm:text-3xl font-black px-3 py-1.5 rounded-lg border border-spotify-green outline-none w-full text-right"
              />
              <button
                onClick={handleSaveTitle}
                className="p-2 bg-spotify-green text-black rounded-lg hover:scale-105 active:scale-95 transition-transform"
                title="שמור שם חדש"
              >
                <Check className="w-5 h-5" />
              </button>
              <button
                onClick={() => setIsEditingTitle(false)}
                className="p-2 bg-spotify-elevated text-spotify-subtext hover:text-white rounded-lg transition-colors"
                title="בטל"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 mt-1 mb-3 max-w-full group">
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white truncate">
                {playlist.title}
              </h1>
              {isCustomPlaylist && onRenamePlaylist && (
                <button
                  onClick={() => {
                    setEditedTitle(playlist.title);
                    setIsEditingTitle(true);
                  }}
                  title="שנה שם פלייליסט"
                  className="opacity-0 group-hover:opacity-100 p-2 text-spotify-subtext hover:text-white transition-opacity rounded-full hover:bg-white/10"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          <div className="text-xs sm:text-sm text-spotify-subtext flex items-center gap-2">
            <span className="font-semibold text-white">SpotiFree</span>
            <span>•</span>
            <span>{rawTracks.length} שירים</span>
            {filterQuery && (
              <>
                <span>•</span>
                <span className="text-spotify-green font-bold">({processedTracks.length} מסוננים)</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4">
        {/* Play, Shuffle & Reorder Mode */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePlayAll}
            disabled={processedTracks.length === 0}
            title="נגן את הפלייליסט לפי הסדר"
            className="w-14 h-14 rounded-full bg-spotify-green hover:bg-spotify-green-hover text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl shadow-spotify-green/25"
          >
            <Play className="w-6 h-6 fill-current translate-x-0.5" />
          </button>

          <button
            onClick={handleShufflePlay}
            disabled={processedTracks.length === 0}
            title={shuffleMode !== 'off' ? 'השמעה אקראית מופעלת' : 'נגן בערבוב אקראי'}
            className={`flex items-center gap-2 px-4 py-3 rounded-full font-bold text-sm transition-all shadow-lg hover:scale-105 active:scale-95 ${
              shuffleMode !== 'off'
                ? 'bg-spotify-green text-black shadow-spotify-green/20'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
            }`}
          >
            <div className="relative inline-flex items-center justify-center">
              <Shuffle className="w-5 h-5" />
              {shuffleMode === 'smart' && (
                <Sparkles className="w-2.5 h-2.5 text-emerald-300 absolute -top-1 -right-1.5 animate-pulse" />
              )}
            </div>
            <span>{shuffleMode === 'smart' ? 'ערבוב חכם ✨' : shuffleMode === 'standard' ? 'באקראי 🔀' : 'השמעה אקראית'}</span>
          </button>

          {/* Toggle Reorder Mode Button */}
          {onReorderTracks && rawTracks.length > 1 && (
            <button
              onClick={() => {
                if (!isReorderMode) {
                  setSortBy('custom');
                  setFilterQuery('');
                }
                setIsReorderMode(prev => !prev);
              }}
              title={isReorderMode ? 'סיים סידור שירים' : 'סדר שירים (גרור או הזז למעלה ולמטה)'}
              className={`flex items-center gap-2 px-4 py-3 rounded-full font-bold text-sm transition-all shadow-lg hover:scale-105 active:scale-95 ${
                isReorderMode
                  ? 'bg-amber-400 text-black shadow-amber-400/25 ring-2 ring-amber-300'
                  : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
              }`}
            >
              <MoveVertical className="w-4 h-4" />
              <span>{isReorderMode ? 'סיום סידור ✓' : 'סדר שירים ↕️'}</span>
            </button>
          )}
        </div>

        {/* Search inside playlist & Sorting Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          {/* Internal Search Bar */}
          <div className="relative flex-1 max-w-xs min-w-[160px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-spotify-subtext pointer-events-none" />
            <input
              type="text"
              placeholder="חפש בפלייליסט..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full bg-spotify-elevated/70 text-white text-xs pr-9 pl-8 py-2 rounded-full border border-white/10 focus:border-spotify-green focus:outline-none transition-colors text-right placeholder:text-spotify-subtext/70"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-spotify-subtext hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort By Dropdown */}
          <div className="relative flex items-center gap-1.5 bg-spotify-elevated/70 border border-white/10 px-3 py-1.5 rounded-full text-xs text-spotify-subtext">
            <SlidersHorizontal className="w-3.5 h-3.5 text-spotify-green" />
            <select
              value={sortBy}
              disabled={isReorderMode}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-white text-xs font-semibold outline-none cursor-pointer pr-1"
            >
              <option value="custom" className="bg-spotify-dark text-white">📌 סדר מותאם אישית</option>
              <option value="title-asc" className="bg-spotify-dark text-white">🔤 שם שיר (א' - ת')</option>
              <option value="title-desc" className="bg-spotify-dark text-white">🔤 שם שיר (ת' - א')</option>
              <option value="artist-asc" className="bg-spotify-dark text-white">👤 שם אמן (א' - ת')</option>
              <option value="duration-desc" className="bg-spotify-dark text-white">⏱️ משך (מהארוך לקצר)</option>
              <option value="duration-asc" className="bg-spotify-dark text-white">⏱️ משך (מהקצר לארוך)</option>
              <option value="newest" className="bg-spotify-dark text-white">🕒 נוספו לאחרונה</option>
            </select>
          </div>

          {/* Delete Playlist Button */}
          {onDeletePlaylist && isCustomPlaylist && (
            <button
              onClick={() => onDeletePlaylist(playlist.id)}
              title="מחק פלייליסט זה מהספרייה"
              className="p-2 text-spotify-subtext hover:text-red-400 transition-colors rounded-full hover:bg-white/5"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Reorder Mode Guidance Banner */}
      {isReorderMode && (
        <div className="mx-4 p-3 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <MoveVertical className="w-4 h-4 animate-bounce text-amber-400" />
            <span>
              <strong>מצב סידור פעיל:</strong> גרור שורה כדי להחליף מקום, או לחץ על החיצים (▲ / ▼) להזזה מיידית.
            </span>
          </div>
          <button
            onClick={() => setIsReorderMode(false)}
            className="px-3 py-1 rounded-full bg-amber-400 text-black font-bold text-xs hover:bg-amber-300 transition-colors"
          >
            סיום סידור
          </button>
        </div>
      )}

      {/* Table Header (Desktop RTL) */}
      <div className="hidden md:flex items-center justify-between px-4 py-2 border-b border-spotify-border/40 text-xs font-semibold text-spotify-subtext uppercase tracking-wider">
        <div className="flex items-center gap-4 flex-1">
          <span className="w-8 text-center">{isReorderMode ? 'סדר' : '#'}</span>
          <span>שם השיר / אמן</span>
        </div>
        <div className="flex items-center gap-4 pl-4">
          <Clock className="w-4 h-4" />
        </div>
      </div>

      {/* Track List */}
      <div className="flex flex-col gap-1 px-1">
        {processedTracks.length === 0 ? (
          <div className="p-12 text-center text-spotify-subtext">
            {filterQuery ? 'לא נמצאו שירים התואמים לחיפוש.' : 'אין שירים עדיין בפלייליסט.'}
          </div>
        ) : (
          processedTracks.map((track, idx) => (
            <TrackRow
              key={track.id || idx}
              index={idx}
              track={track}
              isCurrentTrack={currentTrack?.id === track.id}
              isPlaying={isPlaying}
              isLoading={isLoading}
              onPlay={(t) => onPlayTrack(t, processedTracks, idx)}
              isLiked={likedSongs.some(s => s.id === track.id || (s.title === track.title && s.artist === track.artist))}
              onToggleLike={onToggleLike}
              isDownloaded={downloadedIds?.has(track.id)}
              isDownloading={downloadingIds?.has(track.id)}
              onDownload={onDownloadTrack}
              onOpenAddToPlaylist={onOpenAddToPlaylist}
              onRemoveFromPlaylist={
                isCustomPlaylist && onRemoveTrackFromPlaylist
                  ? () => onRemoveTrackFromPlaylist(playlist.id, track.id)
                  : undefined
              }
              isReorderMode={isReorderMode}
              canMoveUp={idx > 0}
              canMoveDown={idx < processedTracks.length - 1}
              onMoveUp={() => handleMoveTrack(idx, idx - 1)}
              onMoveDown={() => handleMoveTrack(idx, idx + 1)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))
        )}
      </div>
    </div>
  );
}
