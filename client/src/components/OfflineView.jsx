import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownCircle,
  Trash2,
  HardDrive,
  Music,
  Play,
  Pause,
  Shuffle,
  Sparkles,
  CheckCircle2,
  Search,
  X,
  Loader2,
  MoveVertical,
  Clock,
  Plus,
  ListPlus,
  ArrowRight,
  Check,
  Upload,
  Mic2
} from 'lucide-react';
import {
  getAllOfflineTracks,
  deleteOfflineTrack,
  getOfflineStorageUsage,
  saveOfflineTracksOrder,
  isTrackInIdSet,
  importLocalAudioFiles,
  exportOfflineTrackToDevice,
  saveOfflineTrackLyrics
} from '../services/offlineStorage';
import { getLyrics } from '../services/api';
import { isSameTrack } from '../services/storage';
import { TrackRow } from './TrackRow';
import { PlaylistThumb } from './Sidebar';

export function OfflineView({
  currentTrack,
  isPlaying,
  isLoading = false,
  onPlayTrack,
  onTogglePlay,
  likedSongs = [],
  onToggleLike,
  onTrackDeleted,
  shuffleMode = 'off',
  onToggleShuffle,
  onPlayShuffled,
  downloadedCount = 0,
  downloadedIds = new Set(),
  activeDownloads = [],
  queuedDownloadsCount = 0,
  downloadProgress = {},
  playlists = [],
  onOpenAddToPlaylist,
  onCreatePlaylistFromOffline,
  onSelectPlaylist,
  onBack
}) {
  const [tracks, setTracks] = useState([]);
  const [usage, setUsage] = useState({ formatted: '0 MB', count: 0 });
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [sortBy, setSortBy] = useState('custom');
  const [isReorderMode, setIsReorderMode] = useState(false);

  // Create Playlist from Offline Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
  const [selectedTrackIds, setSelectedTrackIds] = useState(new Set());
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [isSyncingLyrics, setIsSyncingLyrics] = useState(false);

  const fileInputRef = useRef(null);
  const draggedIndexRef = useRef(null);

  const handleImportLocalFiles = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsImportingFiles(true);
    try {
      await importLocalAudioFiles(files);
      await loadData();
      if (onTrackDeleted) onTrackDeleted();
    } catch (err) {
      console.error('Failed to import local audio files:', err);
    } finally {
      setIsImportingFiles(false);
      e.target.value = '';
    }
  };

  const handleExportTrack = async (track) => {
    try {
      await exportOfflineTrackToDevice(track);
    } catch (err) {
      console.error('Export track failed:', err);
    }
  };

  const handleSyncOfflineLyrics = async () => {
    if (isSyncingLyrics || tracks.length === 0) return;
    setIsSyncingLyrics(true);
    try {
      const missing = tracks.filter(t => !t.lyrics || (!t.lyrics.hasSynced && !(t.lyrics.plain?.length > 0)));
      for (const t of missing) {
        try {
          const lyr = await getLyrics(t.title, t.artist, t.durationSeconds);
          if (lyr && (lyr.hasSynced || (lyr.plain && lyr.plain.length > 0))) {
            await saveOfflineTrackLyrics(t, lyr);
          }
        } catch {}
      }
      await loadData();
    } finally {
      setIsSyncingLyrics(false);
    }
  };

  const loadData = async () => {
    try {
      const all = await getAllOfflineTracks();
      const u = await getOfflineStorageUsage();
      setTracks(all);
      setUsage(u);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [downloadedCount]);

  const handleDeleteTrack = async (trackOrId) => {
    const id = typeof trackOrId === 'string' ? trackOrId : trackOrId?.id;
    if (!id) return;
    await deleteOfflineTrack(id);
    await loadData();
    if (onTrackDeleted) {
      onTrackDeleted();
    }
  };

  const processedTracks = useMemo(() => {
    let result = [...tracks];

    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase();
      result = result.filter(
        t =>
          (t.title && t.title.toLowerCase().includes(q)) ||
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
        if (sortBy === 'newest') return (b.downloadedAt || 0) - (a.downloadedAt || 0);
        return 0;
      });
    }

    return result;
  }, [tracks, filterQuery, sortBy, isReorderMode]);

  const isOfflineCurrentlyPlaying = useMemo(() => {
    if (!currentTrack || !tracks.length) return false;
    return tracks.some(t => isSameTrack(t, currentTrack));
  }, [currentTrack, tracks]);

  const totalDurationText = useMemo(() => {
    const totalSec = tracks.reduce((acc, t) => acc + (t.durationSeconds || 0), 0);
    if (!totalSec) return '';
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    if (hrs > 0) return `${hrs} שעות ו-${mins} דק׳`;
    return `${mins} דקות`;
  }, [tracks]);

  const handlePlayAll = () => {
    if (isOfflineCurrentlyPlaying && onTogglePlay) {
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
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= tracks.length || toIdx >= tracks.length) return;
    const newTracks = [...tracks];
    const [moved] = newTracks.splice(fromIdx, 1);
    newTracks.splice(toIdx, 0, moved);
    setTracks(newTracks);
    saveOfflineTracksOrder(newTracks);
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

  const openCreateModal = () => {
    setNewPlaylistTitle(`פלייליסט אופליין #${(playlists?.length || 0) + 1}`);
    setSelectedTrackIds(new Set(tracks.map(t => t.id)));
    setIsCreateModalOpen(true);
  };

  const toggleSelectTrack = (id) => {
    setSelectedTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirmCreatePlaylist = (e) => {
    e?.preventDefault();
    const title = newPlaylistTitle.trim() || `פלייליסט אופליין #${(playlists?.length || 0) + 1}`;
    const chosenTracks = tracks.filter(t => selectedTrackIds.has(t.id));
    setIsCreateModalOpen(false);
    if (onCreatePlaylistFromOffline) {
      onCreatePlaylistFromOffline(title, chosenTracks);
    }
  };

  // Playlists that have at least 1 song downloaded offline
  const offlineReadyPlaylists = useMemo(() => {
    if (!Array.isArray(playlists)) return [];
    return playlists
      .map(pl => {
        const plTracks = pl.tracks || [];
        const offlineCount = plTracks.filter(t => isTrackInIdSet(t, downloadedIds)).length;
        return { ...pl, offlineCount, totalCount: plTracks.length };
      })
      .filter(pl => pl.offlineCount > 0 || pl.id?.startsWith('custom_'));
  }, [playlists, downloadedIds]);

  const ambientCover = tracks.find(t => t?.thumbnail)?.thumbnail || '';

  return (
    <div className="flex flex-col animate-fadeIn pb-20 -mx-4 md:-mx-6 -mt-4 md:-mt-6 select-none">
      {/* ==================== FULL-BLEED AMBIENT GRADIENT HEADER (Matches PlaylistView) ==================== */}
      <div className="relative overflow-hidden pt-5 pb-5 px-4 md:px-8">
        {ambientCover ? (
          <>
            <img
              src={ambientCover}
              alt=""
              className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-35 saturate-150 pointer-events-none"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-teal-950/65 via-[#121212]/80 to-[#121212] pointer-events-none" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/70 via-[#132a23] to-[#121212] pointer-events-none" />
        )}

        {/* Top Bar: Back Button + Search in Offline + Sort Dropdown (Exact match to PlaylistView!) */}
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
              placeholder="חפש בשירים שהורדו לאופליין"
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
              <option value="newest" className="bg-[#282828] text-white">הורדו לאחרונה</option>
            </select>
          </div>
        </div>

        {/* Cover Art (2x2 Collage of Offline Songs!) + Metadata */}
        <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-end gap-5 sm:gap-6">
          <div className="w-48 h-48 sm:w-52 sm:h-52 rounded-[6px] bg-[#182820] shadow-[0_16px_48px_rgba(0,0,0,0.75)] overflow-hidden flex-shrink-0 relative">
            {tracks.length >= 4 ? (
              <PlaylistThumb playlist={{ tracks }} className="w-full h-full" />
            ) : ambientCover ? (
              <img src={ambientCover} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-emerald-600 via-teal-800 to-[#121212] flex items-center justify-center">
                <ArrowDownCircle className="w-24 h-24 fill-spotify-green text-black drop-shadow-lg" />
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-full flex items-center gap-1 text-[11px] font-bold text-spotify-green border border-spotify-green/30">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>אופליין</span>
            </div>
          </div>

          <div className="flex flex-col items-start text-right w-full flex-1 min-w-0">
            <span className="text-xs font-bold text-spotify-green uppercase tracking-wider mb-1">
              האזנה אופליין ללא אינטרנט
            </span>
            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
              שירים שהורדו למכשיר
            </h1>
            <div className="flex items-center gap-2 mt-2.5 text-xs sm:text-sm text-[#b3b3b3] flex-wrap">
              <div className="w-5 h-5 rounded-full bg-spotify-green flex items-center justify-center text-black font-black text-[10px]">
                E
              </div>
              <span className="font-bold text-white">SpotiFree</span>
              <span>•</span>
              <span>{usage.count} שירים</span>
              {totalDurationText && (
                <>
                  <span>•</span>
                  <span>{totalDurationText}</span>
                </>
              )}
              <span>•</span>
              <span className="flex items-center gap-1 text-spotify-green font-semibold">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{usage.formatted} שמורים במכשיר</span>
              </span>
            </div>
          </div>
        </div>

        {/* Authentic Spotify Controls Bar (Create Playlist from Offline + Reorder on Right, Smart Shuffle + 56px Green Play Circle on Left) */}
        <div className="relative z-10 flex items-center justify-between mt-5 pt-1 flex-wrap gap-3">
          {/* Right side in RTL: Create Playlist from Offline + Import MP3 + Sync Lyrics + Reorder Mode */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac"
              multiple
              onChange={handleImportLocalFiles}
              className="hidden"
            />

            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 text-xs font-extrabold px-4 py-2 rounded-full bg-spotify-green text-black hover:bg-spotify-green-hover shadow-lg shadow-spotify-green/20 transition-all hover:scale-105 active:scale-95"
              title="צור פלייליסט חדש מהשירים שהורדו לאופליין"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>צור פלייליסט מאופליין</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImportingFiles}
              className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all"
              title="ייבא קובצי שמע (MP3, M4A, WAV) מהמכשיר להאזנה באופליין"
            >
              {isImportingFiles ? (
                <Loader2 className="w-4 h-4 animate-spin text-spotify-green" />
              ) : (
                <Upload className="w-4 h-4 text-spotify-green" />
              )}
              <span>{isImportingFiles ? 'מייבא קבצים...' : 'ייבוא MP3 מהמכשיר'}</span>
            </button>

            {tracks.length > 0 && (
              <button
                onClick={handleSyncOfflineLyrics}
                disabled={isSyncingLyrics}
                className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all"
                title="הורד ושמור מילים לכל השירים באופליין"
              >
                {isSyncingLyrics ? (
                  <Loader2 className="w-4 h-4 animate-spin text-spotify-green" />
                ) : (
                  <Mic2 className="w-4 h-4 text-spotify-green" />
                )}
                <span>{isSyncingLyrics ? 'שומר מילים לאופליין...' : 'שמור מילים לאופליין'}</span>
              </button>
            )}

            {tracks.length > 1 && (
              <button
                onClick={() => {
                  if (!isReorderMode) {
                    setSortBy('custom');
                    setFilterQuery('');
                  }
                  setIsReorderMode(prev => !prev);
                }}
                title={isReorderMode ? 'סיים סידור שירים' : 'ערוך סדר שירים'}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-full border transition-all ${
                  isReorderMode
                    ? 'bg-white text-black border-white font-bold'
                    : 'border-white/25 text-[#b3b3b3] hover:text-white hover:border-white'
                }`}
              >
                <MoveVertical className="w-4 h-4" />
                <span>{isReorderMode ? 'סיום סידור' : 'עריכת סדר'}</span>
              </button>
            )}
          </div>

          {/* Left side in RTL: Smart Shuffle + 56px Green Play Circle */}
          <div className="flex items-center gap-5">
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

            <button
              onClick={handlePlayAll}
              disabled={processedTracks.length === 0}
              title={isOfflineCurrentlyPlaying && isPlaying ? 'השהה' : 'נגן'}
              className="w-14 h-14 rounded-full bg-spotify-green hover:bg-spotify-green-hover text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_8px_24px_rgba(30,215,96,0.35)]"
            >
              {isOfflineCurrentlyPlaying && isPlaying ? (
                <Pause className="w-7 h-7 fill-black text-black" />
              ) : (
                <Play className="w-7 h-7 fill-black text-black translate-x-0.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Active Downloads Queue Card */}
      {(activeDownloads.length > 0 || queuedDownloadsCount > 0) && (
        <div className="mx-4 md:mx-6 mb-4 p-4 rounded-xl bg-[#182820] border border-spotify-green/30 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-spotify-green text-xs font-bold">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>מוריד שירים למכשיר...</span>
            </div>
            {queuedDownloadsCount > 0 && (
              <span className="text-xs text-[#b3b3b3]">
                ממתינים בתור: {queuedDownloadsCount} שירים
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {activeDownloads.map((item) => {
              const pct =
                downloadProgress[item.id] ||
                downloadProgress[item.streamableId] ||
                downloadProgress[item.originalId] ||
                5;
              return (
                <div key={item.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white font-semibold truncate">
                      {item.title} — <span className="text-[#b3b3b3] font-normal">{item.artist}</span>
                    </span>
                    <span className="text-spotify-green font-mono font-bold">{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-spotify-green transition-all duration-200 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Offline Playlists Shelf (Playlists available in Offline Mode) */}
      {offlineReadyPlaylists.length > 0 && (
        <div className="px-4 md:px-6 mb-5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-white">הפלייליסטים שלך באופליין</h2>
            <button
              onClick={openCreateModal}
              className="text-xs font-bold text-spotify-green hover:underline flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>פלייליסט אופליין חדש</span>
            </button>
          </div>
          <div className="flex overflow-x-auto gap-3 no-scrollbar pb-1">
            {offlineReadyPlaylists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => onSelectPlaylist && onSelectPlaylist(pl.id)}
                className="w-36 sm:w-40 flex-shrink-0 p-2.5 rounded-lg bg-[#181818] hover:bg-[#242424] border border-white/5 cursor-pointer transition-all group flex flex-col gap-1.5"
              >
                <div className="relative aspect-square w-full rounded-[6px] overflow-hidden bg-[#282828] shadow">
                  <PlaylistThumb playlist={pl} className="w-full h-full" />
                  <span className="absolute top-1.5 left-1.5 bg-black/75 text-spotify-green text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <ArrowDownCircle className="w-3 h-3 fill-spotify-green text-black" />
                    <span>{pl.offlineCount}/{pl.totalCount}</span>
                  </span>
                </div>
                <span className="text-xs font-bold text-white truncate">{pl.title}</span>
                <span className="text-[11px] text-[#b3b3b3] truncate">
                  {pl.offlineCount} שירים שמורים
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reorder Mode Banner */}
      {isReorderMode && (
        <div className="mx-4 md:mx-6 mb-3 p-3 rounded-lg bg-spotify-green/15 border border-spotify-green/40 text-white text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MoveVertical className="w-4 h-4 text-spotify-green" />
            <span>גרור שירים או השתמש בחיצים כדי לשנות את סדר השירים באופליין.</span>
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
        <div className="flex items-center justify-end w-28 pl-2">
          <Clock className="w-4 h-4" />
        </div>
      </div>

      {/* Tracks List with Full TrackRow Features */}
      <div className="flex flex-col px-2 sm:px-4 mt-1">
        {loading ? (
          <div className="p-12 text-center text-[#b3b3b3]">טוען שירים שמורים...</div>
        ) : tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center text-[#b3b3b3] gap-3">
            <div className="w-16 h-16 rounded-full bg-[#282828] flex items-center justify-center text-[#b3b3b3]">
              <ArrowDownCircle className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-white">עדיין לא הורדת שירים להאזנה אופליין</h3>
            <p className="text-xs text-[#b3b3b3] max-w-sm">
              לחץ על סמל ההורדה (חץ למטה) ליד כל שיר או בנגן כדי לשמור שירים במכשיר ולהאזין להם ללא אינטרנט, וליצור מהם פלייליסטים!
            </p>
          </div>
        ) : processedTracks.length === 0 ? (
          <div className="p-12 text-center text-[#b3b3b3] text-sm">
            לא נמצאו שירים שמורים התואמים לחיפוש.
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
              isDownloaded={true}
              onExportTrack={handleExportTrack}
              onOpenAddToPlaylist={onOpenAddToPlaylist}
              onRemoveFromPlaylist={() => handleDeleteTrack(track.id)}
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

      {/* ==================== CREATE PLAYLIST FROM OFFLINE MODAL (Portaled to document.body) ==================== */}
      {isCreateModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn select-none"
          onClick={() => setIsCreateModalOpen(false)}
          dir="rtl"
        >
          <div
            className="bg-[#242424] rounded-2xl p-5 sm:p-6 w-full max-w-md border border-white/15 shadow-2xl flex flex-col max-h-[85vh] text-right"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-center justify-between pb-3.5 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2">
                <ListPlus className="w-5 h-5 text-spotify-green" />
                <h2 className="text-lg font-extrabold text-white">יצירת פלייליסט ממצב אופליין</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 text-[#b3b3b3] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCreatePlaylist} className="flex flex-col gap-4 mt-4 min-h-0 flex-1 overflow-hidden">
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <label className="text-xs font-bold text-[#b3b3b3]">שם הפלייליסט</label>
                <input
                  type="text"
                  autoFocus
                  value={newPlaylistTitle}
                  onChange={(e) => setNewPlaylistTitle(e.target.value)}
                  placeholder="לדוגמה: שירים לטיסה / אופליין שלי..."
                  className="w-full bg-[#181818] border border-white/15 focus:border-spotify-green rounded-xl px-3.5 py-2.5 text-sm font-bold text-white outline-none"
                />
              </div>

              {tracks.length > 0 && (
                <div className="flex flex-col min-h-0 flex-1 overflow-hidden gap-2">
                  <div className="flex items-center justify-between text-xs flex-shrink-0">
                    <span className="font-bold text-white">
                      בחר שירים מהאופליין ({selectedTrackIds.size} מתוך {tracks.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTrackIds.size === tracks.length) {
                          setSelectedTrackIds(new Set());
                        } else {
                          setSelectedTrackIds(new Set(tracks.map(t => t.id)));
                        }
                      }}
                      className="text-spotify-green font-bold hover:underline"
                    >
                      {selectedTrackIds.size === tracks.length ? 'בטל בחירת הכל' : 'בחר את כל השירים'}
                    </button>
                  </div>

                  <div className="max-h-[38vh] min-h-[120px] overflow-y-auto flex flex-col gap-1 pr-1 no-scrollbar border border-white/10 rounded-xl p-2 bg-[#181818]">
                    {tracks.map((t) => {
                      const checked = selectedTrackIds.has(t.id);
                      return (
                        <div
                          key={t.id}
                          onClick={() => toggleSelectTrack(t.id)}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors flex-shrink-0 ${
                            checked ? 'bg-spotify-green/15 border border-spotify-green/30' : 'hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded overflow-hidden bg-[#282828] flex-shrink-0">
                              {t.thumbnail ? (
                                <img src={t.thumbnail} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <Music className="w-4 h-4 m-2.5 text-[#b3b3b3]" />
                              )}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1 text-right">
                              <span className="text-xs font-bold text-white truncate">{t.title}</span>
                              <span className="text-[11px] text-[#b3b3b3] truncate">{t.artist}</span>
                            </div>
                          </div>

                          <div
                            className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ml-1 ${
                              checked ? 'bg-spotify-green text-black' : 'border border-white/30'
                            }`}
                          >
                            {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 flex-shrink-0">
                <button
                  type="submit"
                  className="flex-1 bg-spotify-green hover:bg-spotify-green-hover text-black font-extrabold text-sm py-3 rounded-full shadow-lg transition-transform active:scale-95"
                >
                  צור פלייליסט ({selectedTrackIds.size} שירים)
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
                >
                  ביטול
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
