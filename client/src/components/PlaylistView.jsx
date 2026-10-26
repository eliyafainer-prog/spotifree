import React, { useState, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  Shuffle,
  Sparkles,
  Trash2,
  Music,
  Clock,
  Search,
  X,
  Pencil,
  Check,
  MoveVertical,
  SlidersHorizontal,
  Heart,
  Disc3,
  ArrowRight,
  ArrowDownCircle,
  Loader2
} from 'lucide-react';
import { TrackRow } from './TrackRow';
import { PlaylistThumb } from './Sidebar';
import { isSameTrack } from '../services/storage';
import { isTrackInIdSet } from '../services/offlineStorage';

export function PlaylistView({
  playlist,
  currentTrack,
  isPlaying,
  isLoading = false,
  onPlayTrack,
  onTogglePlay,
  likedSongs = [],
  onToggleLike,
  onDeletePlaylist,
  downloadedIds = new Set(),
  downloadingIds = new Set(),
  queuedDownloadIds = new Set(),
  downloadProgress = {},
  onDownloadTrack,
  onDownloadBatch,
  onOpenAddToPlaylist,
  onRemoveTrackFromPlaylist,
  shuffleMode = 'off',
  onToggleShuffle,
  onPlayShuffled,
  onReorderTracks,
  onRenamePlaylist,
  onBack
}) {
  if (!playlist) return null;

  const rawTracks = playlist.tracks || [];

  const [filterQuery, setFilterQuery] = useState('');
  const [sortBy, setSortBy] = useState('custom');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(playlist.title || '');
  const [showSearchInput, setShowSearchInput] = useState(false);

  const draggedIndexRef = useRef(null);

  const isPlaylistCurrentlyPlaying = useMemo(() => {
    if (!currentTrack || !rawTracks.length) return false;
    return rawTracks.some(t => isSameTrack(t, currentTrack));
  }, [currentTrack, rawTracks]);

  const handlePlayAll = () => {
    if (isPlaylistCurrentlyPlaying && onTogglePlay) {
      onTogglePlay();
      return;
    }
    if (processedTracks.length > 0) {
      onPlayTrack(processedTracks[0], processedTracks, 0);
    }
  };

  const handleShuffleButton = () => {
    if (onToggleShuffle) {
      onToggleShuffle();
    } else if (onPlayShuffled && processedTracks.length > 0) {
      onPlayShuffled(processedTracks);
    }
  };

  const handleMoveTrack = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= rawTracks.length || toIdx >= rawTracks.length) return;
    const newTracks = [...rawTracks];
    const [moved] = newTracks.splice(fromIdx, 1);
    newTracks.splice(toIdx, 0, moved);
    if (onReorderTracks) {
      onReorderTracks(newTracks);
    }
  };

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

  const handleSaveTitle = () => {
    const trimmed = editedTitle.trim();
    if (trimmed && onRenamePlaylist) {
      onRenamePlaylist(trimmed);
    }
    setIsEditingTitle(false);
  };

  const processedTracks = useMemo(() => {
    let result = [...rawTracks];

    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase();
      result = result.filter(
        t => (t.title && t.title.toLowerCase().includes(q)) ||
             (t.artist && t.artist.toLowerCase().includes(q))
      );
    }

    if (!isReorderMode && sortBy !== 'custom') {
      result.sort((a, b) => {
        if (sortBy === 'title-asc') return (a.title || '').localeCompare(b.title || '', 'he');
        if (sortBy === 'title-desc') return (b.title || '').localeCompare(a.title || '', 'he');
        if (sortBy === 'artist-asc') return (a.artist || '').localeCompare(b.artist || '', 'he');
        if (sortBy === 'duration-desc') return (b.durationSeconds || 0) - (a.durationSeconds || 0);
        if (sortBy === 'duration-asc') return (a.durationSeconds || 0) - (b.durationSeconds || 0);
        if (sortBy === 'newest') return -1;
        return 0;
      });
    }

    return result;
  }, [rawTracks, filterQuery, sortBy, isReorderMode]);

  const totalDurationText = useMemo(() => {
    const totalSec = rawTracks.reduce((acc, t) => acc + (t.durationSeconds || 0), 0);
    if (!totalSec) return '';
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    if (hrs > 0) return `${hrs} שעות ו-${mins} דק׳`;
    return `${mins} דקות`;
  }, [rawTracks]);

  const isAlbum = playlist.type?.toLowerCase() === 'album';
  const isLikedView = playlist.id === 'liked';
  const isCustomPlaylist = !isLikedView;
  const ambientCover = playlist.cover || rawTracks.find(t => t?.thumbnail)?.thumbnail || '';

  const downloadedCount = useMemo(
    () => rawTracks.filter(t => isTrackInIdSet(t, downloadedIds)).length,
    [rawTracks, downloadedIds]
  );
  const allDownloaded = rawTracks.length > 0 && downloadedCount === rawTracks.length;
  const anyDownloading = rawTracks.some(
    t => isTrackInIdSet(t, downloadingIds) || isTrackInIdSet(t, queuedDownloadIds)
  );

  const handleDownloadAll = () => {
    if (rawTracks.length === 0) return;
    const pending = rawTracks.filter(
      t => !isTrackInIdSet(t, downloadedIds) && !isTrackInIdSet(t, downloadingIds) && !isTrackInIdSet(t, queuedDownloadIds)
    );
    if (pending.length === 0) return;
    if (onDownloadBatch) {
      onDownloadBatch(pending);
    } else if (onDownloadTrack) {
      pending.forEach(t => onDownloadTrack(t));
    }
  };

  return (
    <div className="flex flex-col animate-fadeIn pb-36 md:pb-24 -mx-4 md:-mx-6 -mt-4 md:-mt-6">
      {/* Authentic Full-Bleed Ambient Gradient Header */}
      <div className="relative overflow-hidden pt-5 pb-5 px-4 md:px-8">
        {/* Ambient blurred background from cover artwork */}
        {isLikedView ? (
          <div className="absolute inset-0 bg-gradient-to-b from-[#5038a0] via-[#2c1f59] to-[#121212] pointer-events-none" />
        ) : ambientCover ? (
          <>
            <img
              src={ambientCover}
              alt=""
              className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-45 saturate-150 pointer-events-none"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-[#121212]/70 to-[#121212] pointer-events-none" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-[#2a4365] via-[#1a2639] to-[#121212] pointer-events-none" />
        )}

        {/* Top Back Button + Find-in-Playlist Search Bar (Spotify Mobile style) */}
        <div className="relative z-10 flex items-center justify-between gap-2 mb-5">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors flex-shrink-0"
              title="חזרה"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-white/70 pointer-events-none" />
            <input
              type="text"
              placeholder="חפש בפלייליסט"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full bg-white/10 hover:bg-white/15 focus:bg-white/20 text-white text-xs font-medium pr-9 pl-8 py-2 rounded-md outline-none transition-colors text-right placeholder:text-white/70 backdrop-blur-md"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative flex items-center bg-white/10 hover:bg-white/15 backdrop-blur-md px-3 py-2 rounded-md text-xs font-semibold text-white">
            <select
              value={sortBy}
              disabled={isReorderMode}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-white text-xs font-semibold outline-none cursor-pointer"
            >
              <option value="custom" className="bg-[#282828] text-white">מיון: מותאם אישית</option>
              <option value="title-asc" className="bg-[#282828] text-white">שם שיר (א׳-ת׳)</option>
              <option value="artist-asc" className="bg-[#282828] text-white">אמן (א׳-ת׳)</option>
              <option value="duration-desc" className="bg-[#282828] text-white">משך (ארוך לקצר)</option>
              <option value="newest" className="bg-[#282828] text-white">נוספו לאחרונה</option>
            </select>
          </div>
        </div>

        {/* Cover Art (Supports 2x2 Collage via PlaylistThumb!) + Title Metadata */}
        <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-end gap-5 sm:gap-6">
          <div className="w-52 h-52 sm:w-56 sm:h-56 rounded-[6px] bg-[#282828] shadow-[0_16px_48px_rgba(0,0,0,0.75)] overflow-hidden flex-shrink-0">
            {isLikedView ? (
              <div className="w-full h-full bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center">
                <Heart className="w-24 h-24 fill-white text-white drop-shadow-lg" />
              </div>
            ) : (
              <PlaylistThumb playlist={playlist} className="w-full h-full" />
            )}
          </div>

          <div className="flex flex-col items-start sm:items-start text-right w-full flex-1 min-w-0">
            <span className="hidden sm:inline-block text-xs font-bold text-white/90 mb-1">
              {isLikedView ? 'פלייליסט' : isAlbum ? 'אלבום' : 'פלייליסט ציבורי'}
            </span>

            {isEditingTitle ? (
              <div className="flex items-center gap-2 my-1 w-full max-w-md">
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  autoFocus
                  className="bg-[#282828] text-white text-xl sm:text-3xl font-extrabold px-3 py-1.5 rounded-md border border-spotify-green outline-none w-full text-right"
                />
                <button
                  onClick={handleSaveTitle}
                  className="p-2 bg-spotify-green text-black rounded-md"
                  title="שמור"
                >
                  <Check className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setIsEditingTitle(false)}
                  className="p-2 bg-[#282828] text-[#b3b3b3] hover:text-white rounded-md"
                  title="בטל"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 w-full group">
                <h1 className="text-2xl sm:text-4xl lg:text-6xl font-black text-white tracking-tight leading-tight line-clamp-2">
                  {isLikedView ? 'שירים שאהבתם' : playlist.title}
                </h1>
                {isCustomPlaylist && onRenamePlaylist && (
                  <button
                    onClick={() => {
                      setEditedTitle(playlist.title);
                      setIsEditingTitle(true);
                    }}
                    title="שנה שם פלייליסט"
                    className="sm:opacity-0 sm:group-hover:opacity-100 p-1.5 text-[#b3b3b3] hover:text-white transition-opacity rounded-full"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mt-2.5 text-xs sm:text-sm text-[#b3b3b3] flex-wrap">
              <div className="w-5 h-5 rounded-full bg-spotify-green flex items-center justify-center text-black font-black text-[10px]">
                E
              </div>
              <span className="font-bold text-white">SpotiFree</span>
              <span>•</span>
              <span>{rawTracks.length} שירים</span>
              {totalDurationText && (
                <>
                  <span>•</span>
                  <span className="text-[#b3b3b3]">{totalDurationText}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Authentic Spotify Controls Bar (Primary 56px Green Play + Shuffle on right, Actions & Tools) */}
        <div className="relative z-10 flex items-center justify-between mt-5 pt-1">
          {/* Right side in RTL: Iconic Spotify 56px Green Play Circle + Shuffle + Download + Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={handlePlayAll}
              disabled={processedTracks.length === 0}
              title={isPlaylistCurrentlyPlaying && isPlaying ? 'השהה' : 'נגן'}
              className="w-14 h-14 rounded-full bg-spotify-green hover:bg-spotify-green-hover text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_8px_24px_rgba(30,215,96,0.35)] flex-shrink-0"
            >
              {isPlaylistCurrentlyPlaying && isPlaying ? (
                <Pause className="w-7 h-7 fill-black text-black" />
              ) : (
                <Play className="w-7 h-7 fill-black text-black translate-x-0.5" />
              )}
            </button>

            <button
              onClick={handleShuffleButton}
              disabled={processedTracks.length === 0}
              title={
                shuffleMode === 'smart'
                  ? 'ערבוב חכם פעיל ✨'
                  : shuffleMode === 'standard'
                  ? 'ערבוב פעיל'
                  : 'ערבוב כבוי'
              }
              className={`relative p-2 transition-transform active:scale-95 ${
                shuffleMode !== 'off' ? 'text-spotify-green' : 'text-[#b3b3b3] hover:text-white'
              }`}
            >
              <Shuffle className="w-6 h-6" />
              {shuffleMode === 'smart' && (
                <Sparkles className="w-3.5 h-3.5 text-spotify-green fill-spotify-green absolute top-0.5 right-0.5 animate-pulse" />
              )}
              {shuffleMode !== 'off' && (
                <span className="w-1.5 h-1.5 rounded-full bg-spotify-green absolute bottom-0.5 left-1/2 -translate-x-1/2" />
              )}
            </button>

            {onDownloadTrack && rawTracks.length > 0 && (
              <button
                onClick={handleDownloadAll}
                title={
                  allDownloaded
                    ? 'כל השירים שמורים אופליין'
                    : anyDownloading
                    ? `מוריד פלייליסט לאופליין (${downloadedCount}/${rawTracks.length})`
                    : downloadedCount > 0 ? `הורד שירים שנותרו (${rawTracks.length - downloadedCount} נותרו)` : 'הורד את כל הפלייליסט להאזנה אופליין'
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all active:scale-95 ${
                  allDownloaded
                    ? 'bg-spotify-green/15 text-spotify-green border border-spotify-green/30'
                    : anyDownloading
                    ? 'bg-spotify-green/15 text-spotify-green border border-spotify-green/40'
                    : 'bg-white/5 hover:bg-white/10 text-[#b3b3b3] hover:text-white border border-white/10'
                }`}
              >
                {anyDownloading ? (
                  <>
                    <Loader2 className="w-5 h-5 text-spotify-green animate-spin" />
                    <span className="text-xs font-bold text-spotify-green">
                      מוריד ({downloadedCount}/{rawTracks.length})
                    </span>
                  </>
                ) : allDownloaded ? (
                  <>
                    <ArrowDownCircle className="w-5 h-5 fill-spotify-green text-black" />
                    <span className="text-xs font-bold text-spotify-green">שמור אופליין ({rawTracks.length})</span>
                  </>
                ) : (
                  <>
                    <ArrowDownCircle className="w-5 h-5" />
                    <span className="text-xs font-semibold">
                      {downloadedCount > 0 ? `הורד (${rawTracks.length - downloadedCount} נותרו)` : 'הורד לאופליין'}
                    </span>
                  </>
                )}
              </button>
            )}

            {onReorderTracks && rawTracks.length > 1 && (
              <button
                onClick={() => {
                  if (!isReorderMode) {
                    setSortBy('custom');
                    setFilterQuery('');
                  }
                  setIsReorderMode(prev => !prev);
                }}
                title={isReorderMode ? 'סיים סידור שירים' : 'ערוך סדר שירים'}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                  isReorderMode
                    ? 'bg-spotify-green text-black border-spotify-green font-bold'
                    : 'border-white/25 text-[#b3b3b3] hover:text-white hover:border-white'
                }`}
              >
                <MoveVertical className="w-4 h-4" />
                <span>{isReorderMode ? 'סיום סידור' : 'עריכת סדר'}</span>
              </button>
            )}

            {onDeletePlaylist && isCustomPlaylist && (
              <button
                onClick={() => onDeletePlaylist(playlist.id)}
                title="מחק פלייליסט"
                className="p-2 text-[#b3b3b3] hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reorder Mode Banner */}
      {isReorderMode && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-spotify-green/15 border border-spotify-green/40 text-white text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MoveVertical className="w-4 h-4 text-spotify-green" />
            <span>גרור שירים או השתמש בחיצים כדי לשנות את הסדר בפלייליסט.</span>
          </div>
          <button
            onClick={() => setIsReorderMode(false)}
            className="px-3 py-1 rounded-full bg-spotify-green text-black font-bold text-xs"
          >
            שמור
          </button>
        </div>
      )}

      {/* Desktop Spotify Table Header */}
      <div className="hidden sm:flex items-center justify-between px-6 py-2 mx-2 border-b border-white/10 text-xs font-medium text-[#b3b3b3]">
        <div className="flex items-center gap-3 flex-1">
          <span className="w-6 text-center">#</span>
          <span>כותרת</span>
        </div>
        <div className="hidden lg:flex w-[26%] px-2">
          <span>אלבום</span>
        </div>
        <div className="flex items-center justify-end w-24 pl-2">
          <Clock className="w-4 h-4" />
        </div>
      </div>

      {/* Tracks List */}
      <div className="flex flex-col px-2 sm:px-4 mt-1">
        {processedTracks.length === 0 ? (
          <div className="p-12 text-center text-[#b3b3b3] text-sm">
            {filterQuery ? 'לא נמצאו שירים התואמים לחיפוש.' : 'הפלייליסט הזה ריק כרגע.'}
          </div>
        ) : (
          processedTracks.map((track, idx) => (
            <TrackRow
              key={track.id || idx}
              index={idx}
              track={track}
              isCurrentTrack={isSameTrack(currentTrack, track)}
              isPlaying={isPlaying}
              isLoading={isLoading}
              onPlay={(t) => onPlayTrack(t, processedTracks, idx)}
              isLiked={likedSongs.some(s => isSameTrack(s, track))}
              onToggleLike={onToggleLike}
              isDownloaded={isTrackInIdSet(track, downloadedIds)}
              isDownloading={isTrackInIdSet(track, downloadingIds)}
              isQueuedDownload={isTrackInIdSet(track, queuedDownloadIds)}
              downloadProgress={
                downloadProgress[track.id] ||
                downloadProgress[track.streamableId] ||
                downloadProgress[track.originalId] ||
                0
              }
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
