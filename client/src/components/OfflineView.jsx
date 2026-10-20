import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowDownCircle,
  Trash2,
  HardDrive,
  Music,
  Play,
  Shuffle,
  CheckCircle2,
  Search,
  X,
  Loader2,
  Heart,
  Check
} from 'lucide-react';
import { getAllOfflineTracks, deleteOfflineTrack, getOfflineStorageUsage } from '../services/offlineStorage';
import { isSameTrack } from '../services/storage';

export function OfflineView({
  currentTrack,
  isPlaying,
  onPlayTrack,
  likedSongs = [],
  onToggleLike,
  onTrackDeleted,
  shuffleMode = 'off',
  onToggleShuffle,
  onPlayShuffled,
  downloadedCount = 0,
  activeDownloads = [],
  queuedDownloadsCount = 0,
  downloadProgress = {}
}) {
  const [tracks, setTracks] = useState([]);
  const [usage, setUsage] = useState({ formatted: '0 MB', count: 0 });
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');

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

  const handleDelete = async (e, trackId) => {
    e.stopPropagation();
    await deleteOfflineTrack(trackId);
    await loadData();
    if (onTrackDeleted) {
      onTrackDeleted();
    }
  };

  const filteredTracks = useMemo(() => {
    if (!filterQuery.trim()) return tracks;
    const q = filterQuery.trim().toLowerCase();
    return tracks.filter(
      t =>
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q))
    );
  }, [tracks, filterQuery]);

  const handlePlayAll = () => {
    if (filteredTracks.length > 0) {
      onPlayTrack(filteredTracks[0], filteredTracks, 0);
    }
  };

  const handleShufflePlay = () => {
    if (filteredTracks.length === 0) return;
    if (onPlayShuffled) {
      onPlayShuffled(filteredTracks);
    } else {
      if (shuffleMode === 'off' && onToggleShuffle) {
        onToggleShuffle();
      }
      const randomIdx = Math.floor(Math.random() * filteredTracks.length);
      onPlayTrack(filteredTracks[randomIdx], filteredTracks, randomIdx);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes <= 0) return '';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col gap-5 animate-fadeIn pb-16 select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 p-6 bg-gradient-to-r from-teal-950/60 via-spotify-elevated/40 to-transparent rounded-2xl border border-teal-500/20 shadow-xl">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="w-16 h-16 rounded-xl bg-teal-500/15 text-spotify-green flex items-center justify-center flex-shrink-0 shadow">
            <ArrowDownCircle className="w-9 h-9" />
          </div>
          <div className="flex flex-col text-right">
            <span className="text-xs uppercase font-bold tracking-wider text-spotify-green">
              האזנה אופליין ללא אינטרנט
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-white mt-0.5">
              שירים שהורדו למכשיר
            </h1>
            <div className="text-xs text-spotify-subtext flex items-center gap-2 mt-1 flex-wrap">
              <span>{usage.count} שירים זמינים אופליין</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-teal-300">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{usage.formatted} שמורים במכשיר</span>
              </span>
            </div>
          </div>
        </div>

        {tracks.length > 0 && (
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={handlePlayAll}
              title="נגן את כל השירים לפי הסדר"
              className="bg-spotify-green hover:bg-spotify-green-hover text-black font-bold px-6 py-3 rounded-full text-sm flex items-center gap-2 shadow-lg shadow-spotify-green/20 hover:scale-105 active:scale-95 transition-all"
            >
              <Play className="w-5 h-5 fill-current translate-x-0.5" />
              <span>נגן הכל</span>
            </button>

            <button
              onClick={handleShufflePlay}
              title="השמעה אקראית של השירים השמורים"
              className={`font-bold px-5 py-3 rounded-full text-sm flex items-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition-all ${
                shuffleMode !== 'off'
                  ? 'bg-spotify-green text-black shadow-spotify-green/20'
                  : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
              }`}
            >
              <Shuffle className="w-4 h-4" />
              <span>השמעה אקראית</span>
            </button>
          </div>
        )}
      </div>

      {/* Active Downloads Queue Card */}
      {(activeDownloads.length > 0 || queuedDownloadsCount > 0) && (
        <div className="p-4 rounded-xl bg-[#182820] border border-spotify-green/30 flex flex-col gap-3">
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

      {/* Search Bar inside Offline Songs */}
      {tracks.length > 0 && (
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-[#b3b3b3] pointer-events-none" />
          <input
            type="text"
            placeholder="חפש בשירים שהורדו..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full bg-[#242424] hover:bg-[#2a2a2a] focus:bg-[#2a2a2a] text-white text-xs font-medium pr-10 pl-8 py-2.5 rounded-lg outline-none border border-white/10 focus:border-spotify-green transition-colors text-right placeholder:text-[#b3b3b3]"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#b3b3b3] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Tracks List */}
      <div className="flex flex-col gap-1 px-1">
        {loading ? (
          <div className="p-12 text-center text-spotify-subtext">טוען שירים שמורים...</div>
        ) : tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center text-spotify-subtext gap-3">
            <div className="w-16 h-16 rounded-full bg-spotify-elevated flex items-center justify-center text-spotify-subtext/60">
              <ArrowDownCircle className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-white">עדיין לא הורדת שירים להאזנה אופליין</h3>
            <p className="text-xs text-spotify-subtext max-w-sm">
              לחץ על סמל ההורדה (חץ למטה) ליד כל שיר או על ״הורד לאופליין״ בראש כל פלייליסט כדי לשמור שירים במכשיר. השירים יישמרו עם העטיפה ויתנגנו מיד גם ללא חיבור לאינטרנט!
            </p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="p-10 text-center text-[#b3b3b3] text-sm">
            לא נמצאו שירים שמורים התואמים לחיפוש.
          </div>
        ) : (
          filteredTracks.map((track, idx) => {
            const isCurrent = isSameTrack(currentTrack, track);
            const isLiked = likedSongs.some(s => isSameTrack(s, track));
            return (
              <div
                key={track.id}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-white/[0.08] active:bg-white/10 group cursor-pointer transition-colors"
                onClick={() => onPlayTrack(track, filteredTracks, idx)}
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <span className="hidden sm:inline-block w-6 font-mono text-xs text-spotify-subtext text-center">
                    {idx + 1}
                  </span>
                  <div className="w-11 h-11 sm:w-10 sm:h-10 rounded bg-spotify-elevated overflow-hidden flex-shrink-0 relative shadow">
                    {track.thumbnail ? (
                      <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                        <Music className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 truncate text-right flex-1">
                    <span className={`text-sm font-semibold truncate ${isCurrent ? 'text-spotify-green' : 'text-white'}`}>
                      {track.title}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-spotify-subtext truncate mt-0.5">
                      <ArrowDownCircle className="w-3.5 h-3.5 fill-spotify-green text-black flex-shrink-0" />
                      <span className="truncate">{track.artist}</span>
                      {track.sizeBytes > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-[11px] text-[#b3b3b3]/80 font-mono">
                            {formatFileSize(track.sizeBytes)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 pl-1" onClick={(e) => e.stopPropagation()}>
                  <span className="hidden md:inline-flex text-[11px] text-spotify-green font-semibold items-center gap-1 bg-spotify-green/10 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>שמור במכשיר</span>
                  </span>

                  {onToggleLike && (
                    <button
                      onClick={() => onToggleLike(track)}
                      className="p-1.5 text-[#b3b3b3] hover:text-white"
                      title={isLiked ? 'הסר משירים שאהבתם' : 'הוסף לשירים שאהבתם'}
                    >
                      {isLiked ? (
                        <span className="w-4 h-4 rounded-full bg-spotify-green text-black flex items-center justify-center">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                      ) : (
                        <Heart className="w-4 h-4" />
                      )}
                    </button>
                  )}

                  <span className="hidden sm:inline-block text-xs text-spotify-subtext font-mono w-10 text-left">
                    {track.duration || '0:00'}
                  </span>

                  <button
                    onClick={(e) => handleDelete(e, track.id)}
                    title="מחק מהורדות אופליין"
                    className="p-2 text-[#b3b3b3] hover:text-red-400 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
