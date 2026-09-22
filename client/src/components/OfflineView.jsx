import React, { useState, useEffect } from 'react';
import { ArrowDownCircle, Trash2, HardDrive, Music, Play, Shuffle, CheckCircle2 } from 'lucide-react';
import { getAllOfflineTracks, deleteOfflineTrack, getOfflineStorageUsage } from '../services/offlineStorage';
import { TrackRow } from './TrackRow';

export function OfflineView({
  currentTrack,
  isPlaying,
  onPlayTrack,
  likedSongs,
  onToggleLike,
  onTrackDeleted,
  shuffleMode = 'off',
  onToggleShuffle
}) {
  const [tracks, setTracks] = useState([]);
  const [usage, setUsage] = useState({ formatted: '0 MB', count: 0 });
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
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
  }, []);

  const handleDelete = async (e, trackId) => {
    e.stopPropagation();
    await deleteOfflineTrack(trackId);
    await loadData();
    if (onTrackDeleted) {
      onTrackDeleted();
    }
  };

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      onPlayTrack(tracks[0], tracks, 0);
    }
  };

  const handleShufflePlay = () => {
    if (tracks.length === 0) return;
    if (shuffleMode === 'off' && onToggleShuffle) {
      onToggleShuffle();
    }
    const randomIdx = Math.floor(Math.random() * tracks.length);
    onPlayTrack(tracks[randomIdx], tracks, randomIdx);
  };

  return (
    <div className="flex flex-col gap-6 animate-fadeIn pb-16 select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 p-6 bg-gradient-to-r from-teal-950/60 via-spotify-elevated/40 to-transparent rounded-2xl border border-teal-500/20 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center flex-shrink-0 shadow">
            <ArrowDownCircle className="w-9 h-9" />
          </div>
          <div className="flex flex-col text-right">
            <span className="text-xs uppercase font-bold tracking-wider text-teal-400">
              האזנה אופליין ללא אינטרנט
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-white mt-0.5">
              שירים שהורדו למכשיר
            </h1>
            <div className="text-xs text-spotify-subtext flex items-center gap-2 mt-1">
              <span>{usage.count} שירים זמינים אופליין</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-teal-300">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{usage.formatted} תפוסים</span>
              </span>
            </div>
          </div>
        </div>

        {tracks.length > 0 && (
          <div className="flex items-center gap-3">
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
              לחץ על סמל ההורדה (חץ למטה) ליד כל שיר כדי לשמור אותו במכשיר. השיר יישמר ויוכל להתנגן מיד ב-0 שניות ללא צורך באינטרנט!
            </p>
          </div>
        ) : (
          tracks.map((track, idx) => (
            <div
              key={track.id}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-spotify-highlight/40 group cursor-pointer transition-colors"
              onClick={() => onPlayTrack(track, tracks, idx)}
            >
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <span className="w-6 font-mono text-xs text-spotify-subtext text-center">
                  {idx + 1}
                </span>
                <div className="w-10 h-10 rounded bg-spotify-elevated overflow-hidden flex-shrink-0 relative">
                  {track.thumbnail ? (
                    <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                      <Music className="w-4 h-4" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col min-w-0 truncate text-right">
                  <span className={`text-sm font-semibold truncate ${currentTrack?.id === track.id ? 'text-spotify-green' : 'text-white'}`}>
                    {track.title}
                  </span>
                  <span className="text-xs text-spotify-subtext truncate">
                    {track.artist}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-shrink-0 pl-2">
                <span className="text-[11px] text-teal-400 font-mono flex items-center gap-1 bg-teal-500/10 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>אופליין</span>
                </span>
                <span className="text-xs text-spotify-subtext font-mono w-10 text-left">
                  {track.duration || '0:00'}
                </span>
                <button
                  onClick={(e) => handleDelete(e, track.id)}
                  title="מחק מהאופליין"
                  className="p-1.5 text-spotify-subtext hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
