import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  PlusCircle,
  Heart,
  Music2,
  Sparkles,
  Flame,
  Clock,
  Play,
  Loader2,
  ExternalLink,
  Volume2,
  ArrowDownCircle
} from 'lucide-react';

import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useMediaSession } from './hooks/useMediaSession';
import { searchTracks, getTrendingTracks, getLyrics, downloadTrackAudioBlob, prefetchNextTracks, resolveTrack } from './services/api';
import {
  getLikedSongs,
  toggleLikeSong,
  getPlaylists,
  savePlaylist,
  deletePlaylist,
  getRecentTracks,
  updateTrackInPlaylists,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  createCustomPlaylist
} from './services/storage';
import { recordTrackPlay, recordListeningSeconds } from './services/analytics';
import { saveTrackOffline, getAllOfflineTracks } from './services/offlineStorage';

import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { PlayerBar } from './components/PlayerBar';
import { FullscreenPlayer } from './components/FullscreenPlayer';
import { SyncedLyrics } from './components/SyncedLyrics';
import { ImportModal } from './components/ImportModal';
import { AddToPlaylistModal } from './components/AddToPlaylistModal';
import { TrackRow } from './components/TrackRow';
import { PlaylistView } from './components/PlaylistView';
import { AnalyticsView } from './components/AnalyticsView';
import { OfflineView } from './components/OfflineView';

export default function App() {
  // Navigation & Views
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'search' | 'library' | 'liked' | 'playlist'
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);

  // Library & Storage state
  const [likedSongs, setLikedSongs] = useState(() => getLikedSongs());
  const [playlists, setPlaylists] = useState(() => getPlaylists());
  const [recentTracks, setRecentTracks] = useState(() => getRecentTracks());

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Trending tracks for Home view
  const [trendingTracks, setTrendingTracks] = useState([]);
  const [isTrendingLoading, setIsTrendingLoading] = useState(false);

  // Modals & Panels
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isFullscreenPlayerOpen, setIsFullscreenPlayerOpen] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [lyricsData, setLyricsData] = useState({ synced: [], plain: [], hasSynced: false });
  const [trackForAddToPlaylist, setTrackForAddToPlaylist] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2800);
  }, []);

  const handleToggleShuffle = useCallback(() => {
    const current = player.shuffleMode;
    const nextMode = current === 'off' ? 'standard' : current === 'standard' ? 'smart' : 'off';
    player.toggleShuffle();
    if (nextMode === 'standard') {
      showToast('🔀 השמעה אקראית: מופעלת (שירים מעורבבים ללא חזרות)');
    } else if (nextMode === 'smart') {
      showToast('✨ ערבוב חכם: מופעל (Smart Shuffle - כולל שירים דומים)');
    } else {
      showToast('➡️ השמעה אקראית: כבויה (ניגון לפי הסדר)');
    }
  }, [player, showToast]);

  // Offline Downloads state
  const [downloadedIds, setDownloadedIds] = useState(new Set());
  const [downloadingIds, setDownloadingIds] = useState(new Set());

  // Load downloaded track IDs on mount
  const refreshDownloads = useCallback(async () => {
    try {
      const tracks = await getAllOfflineTracks();
      setDownloadedIds(new Set(tracks.map(t => t.id)));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refreshDownloads();
  }, [refreshDownloads]);

  // Handle Download Track
  const handleDownloadTrack = async (track) => {
    if (!track || downloadedIds.has(track.id) || downloadingIds.has(track.id)) return;

    setDownloadingIds(prev => new Set([...prev, track.id]));
    try {
      const blob = await downloadTrackAudioBlob(track);
      await saveTrackOffline(track, blob);
      setDownloadedIds(prev => new Set([...prev, track.id]));
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  // Audio Player Engine
  const player = useAudioPlayer();

  // Headphone & Lock Screen Integration (MediaSession API)
  useMediaSession({
    currentTrack: player.currentTrack,
    isPlaying: player.isPlaying,
    duration: player.duration,
    currentTime: player.currentTime,
    onPlay: player.togglePlay,
    onPause: player.togglePlay,
    onNext: player.nextTrack,
    onPrev: player.prevTrack,
    onSeek: player.seek
  });

  // Load trending tracks on mount and proactively prefetch top songs
  useEffect(() => {
    let isMounted = true;
    setIsTrendingLoading(true);
    getTrendingTracks()
      .then(tracks => {
        if (isMounted) {
          setTrendingTracks(tracks);
          if (tracks.length > 0) {
            prefetchNextTracks(tracks.slice(0, 5));
          }
        }
      })
      .catch(err => console.error('Failed to load trending:', err))
      .finally(() => {
        if (isMounted) setIsTrendingLoading(false);
      });

    return () => { isMounted = false; };
  }, []);

  // Proactively prefetch and auto-enrich playlist tracks when opening a playlist
  useEffect(() => {
    const activePl = playlists.find(p => p.id === selectedPlaylistId);
    if (!activePl || !activePl.tracks || activePl.tracks.length === 0) return;

    prefetchNextTracks(activePl.tracks.slice(0, 5));

    // Background auto-enrich existing imported playlist tracks with individual artwork and YouTube IDs
    const needsEnrichment = activePl.tracks.some(t => t.id?.startsWith('sp_') || !t.thumbnail || t.thumbnail === activePl.cover);
    if (needsEnrichment) {
      let cancelled = false;
      const unverified = activePl.tracks.filter(t => t.id?.startsWith('sp_') || !t.thumbnail || t.thumbnail === activePl.cover).slice(0, 10);

      Promise.all(
        unverified.map(async (t) => {
          try {
            const res = await resolveTrack(t);
            if (res && res.streamableId) {
              updateTrackInPlaylists({
                ...t,
                originalId: t.id,
                streamableId: res.streamableId,
                id: res.streamableId,
                thumbnail: res.thumbnail || t.thumbnail,
                durationSeconds: res.durationSeconds || t.durationSeconds
              });
            }
          } catch (e) {}
        })
      ).then(() => {
        if (!cancelled) {
          setPlaylists(getPlaylists());
        }
      });

      return () => { cancelled = true; };
    }
  }, [selectedPlaylistId, playlists.length]);

  // Proactively prefetch liked songs when entering liked view
  useEffect(() => {
    if (currentView === 'liked' && likedSongs.length > 0) {
      prefetchNextTracks(likedSongs.slice(0, 5));
    }
  }, [currentView, likedSongs]);

  // Fetch lyrics whenever currentTrack changes
  useEffect(() => {
    if (!player.currentTrack) return;

    let isMounted = true;
    getLyrics(player.currentTrack.title, player.currentTrack.artist, player.currentTrack.durationSeconds)
      .then(data => {
        if (isMounted) setLyricsData(data);
      })
      .catch(() => {
        if (isMounted) setLyricsData({ synced: [], plain: [], hasSynced: false });
      });

    return () => { isMounted = false; };
  }, [player.currentTrack]);

  // Handle Search input and proactively prefetch top results
  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const results = await searchTracks(searchQuery.trim());
      setSearchResults(results);
      if (results && results.length > 0) {
        prefetchNextTracks(results.slice(0, 4));
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Toggle Like Song
  const handleToggleLike = (track) => {
    const { updated } = toggleLikeSong(track);
    setLikedSongs(updated);
  };

  // Handle Playlist Imported
  const handlePlaylistImported = (newPlaylist) => {
    const updated = savePlaylist(newPlaylist);
    setPlaylists(updated);
    setSelectedPlaylistId(newPlaylist.id);
    setCurrentView('playlist');
  };

  // Handle Playlist Deleted
  const handleDeletePlaylist = (playlistId) => {
    const updated = deletePlaylist(playlistId);
    setPlaylists(updated);
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
      setCurrentView('library');
    }
  };

  // Add/Remove/Create playlist track handlers
  const handleOpenAddToPlaylist = (track) => {
    setTrackForAddToPlaylist(track);
  };

  const handleCloseAddToPlaylist = () => {
    setTrackForAddToPlaylist(null);
  };

  const handleAddToPlaylist = (playlistId, track) => {
    const { updated } = addTrackToPlaylist(playlistId, track);
    setPlaylists(updated);
  };

  const handleRemoveTrackFromPlaylist = (playlistId, trackId) => {
    const updated = removeTrackFromPlaylist(playlistId, trackId);
    setPlaylists(updated);
  };

  const handleCreatePlaylist = (title, trackToInsert = null) => {
    const { updated, playlist } = createCustomPlaylist(title);
    if (playlist && trackToInsert) {
      const res = addTrackToPlaylist(playlist.id, trackToInsert);
      setPlaylists(res.updated);
    } else {
      setPlaylists(updated);
    }
    if (playlist) {
      setSelectedPlaylistId(playlist.id);
      setCurrentView('playlist');
    }
  };

  // Play track helper (updates recent tracks, playlists and analytics)
  const handlePlayTrack = (track, queueList = null, index = -1) => {
    player.playTrack(track, queueList, index);
    recordTrackPlay(track);
    setTimeout(() => {
      setRecentTracks(getRecentTracks());
      setPlaylists(getPlaylists());
    }, 600);
  };

  // Track listening time while playing
  useEffect(() => {
    if (!player.isPlaying) return;
    const interval = setInterval(() => {
      recordListeningSeconds(1);
    }, 1000);
    return () => clearInterval(interval);
  }, [player.isPlaying]);

  // Global Keyboard Shortcuts (Space to toggle, arrows to seek/volume, M to mute)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept when typing in search input
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        player.togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        player.seek(Math.min(player.currentTime + 5, player.duration));
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        player.seek(Math.max(player.currentTime - 5, 0));
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        player.setVolume(player.volume + 0.05);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        player.setVolume(player.volume - 0.05);
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'צ') {
        e.preventDefault();
        player.toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [player]);

  // Get currently viewed playlist object
  const activePlaylist = selectedPlaylistId
    ? playlists.find(p => p.id === selectedPlaylistId)
    : null;

  const isLikedPlaylist = currentView === 'liked';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-black text-white select-none">
      {/* Main App Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <Sidebar
          currentView={currentView}
          setCurrentView={setCurrentView}
          playlists={playlists}
          openImportModal={() => setIsImportModalOpen(true)}
          onCreatePlaylist={() => handleCreatePlaylist(`הפלייליסט שלי #${playlists.length + 1}`)}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
        />

        {/* Center Main Scrollable Content */}
        <main className="flex-1 flex flex-col min-w-0 bg-spotify-black rounded-t-lg md:rounded-lg md:m-2 overflow-hidden relative">
          {/* Top Search / Header Bar */}
          <div className="flex items-center justify-between p-4 bg-spotify-dark/80 backdrop-blur-md sticky top-0 z-20 border-b border-spotify-border/40">
            {currentView === 'search' ? (
              <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md relative">
                <Search className="w-5 h-5 absolute right-3.5 top-1/2 -translate-y-1/2 text-spotify-subtext" />
                <input
                  type="text"
                  placeholder="מה תרצה לשמוע? (שיר, אמן, אלבום...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-spotify-elevated text-white text-sm pr-11 pl-4 py-2.5 rounded-full border border-transparent focus:border-spotify-green focus:outline-none transition-all placeholder:text-spotify-subtext text-right"
                  autoFocus
                />
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-white">
                  {currentView === 'home' && 'דף הבית'}
                  {currentView === 'library' && 'הספרייה שלך'}
                  {currentView === 'liked' && 'שירים שאהבתי'}
                  {currentView === 'offline' && 'שירים שהורדו (Offline Downloads)'}
                  {currentView === 'analytics' && 'ניתוח נתונים (Listening Analytics)'}
                  {currentView === 'playlist' && (activePlaylist?.title || 'פלייליסט')}
                </span>
              </div>
            )}

            {/* Quick action: Import button */}
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 bg-spotify-elevated hover:bg-spotify-highlight text-white text-xs font-semibold px-3 py-2 rounded-full border border-spotify-border transition-colors"
            >
              <PlusCircle className="w-4 h-4 text-spotify-green" />
              <span className="hidden sm:inline">ייבוא פלייליסט</span>
            </button>
          </div>

          {/* View Content Area */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-28">
            {/* VIEW: HOME */}
            {currentView === 'home' && (
              <div className="flex flex-col gap-8 animate-fadeIn">
                {/* Hero Greeting Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div
                    onClick={() => setCurrentView('liked')}
                    className="flex items-center gap-3 bg-spotify-elevated hover:bg-spotify-highlight rounded-md overflow-hidden cursor-pointer transition-colors group p-2"
                  >
                    <div className="w-14 h-14 rounded bg-gradient-to-br from-indigo-600 to-pink-500 flex items-center justify-center flex-shrink-0 shadow">
                      <Heart className="w-7 h-7 fill-white text-white" />
                    </div>
                    <span className="font-bold text-sm">שירים שאהבתי</span>
                  </div>

                  <div
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-3 bg-spotify-elevated hover:bg-spotify-highlight rounded-md overflow-hidden cursor-pointer transition-colors group p-2"
                  >
                    <div className="w-14 h-14 rounded bg-spotify-highlight flex items-center justify-center flex-shrink-0 text-spotify-green border border-spotify-green/20">
                      <PlusCircle className="w-7 h-7" />
                    </div>
                    <span className="font-bold text-sm">ייבוא פלייליסט מספוטיפיי</span>
                  </div>
                </div>

                {/* Recently Played */}
                {recentTracks.length > 0 && (
                  <section className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 text-white font-bold text-lg md:text-xl">
                      <Clock className="w-5 h-5 text-spotify-green" />
                      <h2>הושמע לאחרונה</h2>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {recentTracks.slice(0, 6).map((track, idx) => (
                        <div
                          key={track.id || idx}
                          onClick={() => handlePlayTrack(track, recentTracks, idx)}
                          className="bg-spotify-dark hover:bg-spotify-elevated p-3 rounded-lg flex flex-col gap-2.5 group cursor-pointer transition-all duration-200"
                        >
                          <div className="relative aspect-square w-full rounded-md overflow-hidden bg-spotify-highlight shadow-md">
                            {track.thumbnail ? (
                              <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Music2 className="w-10 h-10 m-auto text-spotify-subtext" />
                            )}
                            <button className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-spotify-green text-black flex items-center justify-center shadow-lg opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-105">
                              <Play className="w-5 h-5 fill-current translate-x-0.5" />
                            </button>
                          </div>
                          <span className="font-bold text-xs truncate text-white">{track.title}</span>
                          <span className="text-[11px] text-spotify-subtext truncate">{track.artist}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Trending & Hits */}
                <section className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-white font-bold text-lg md:text-xl">
                    <Flame className="w-5 h-5 text-spotify-green" />
                    <h2>להיטים מומלצים</h2>
                  </div>

                  {isTrendingLoading ? (
                    <div className="flex items-center justify-center p-12 text-spotify-subtext gap-3">
                      <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                      <span>טוען שירים מומלצים...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {trendingTracks.map((track, idx) => (
                        <div
                          key={track.id || idx}
                          onClick={() => handlePlayTrack(track, trendingTracks, idx)}
                          onMouseEnter={() => prefetchNextTracks([track])}
                          className="bg-spotify-dark hover:bg-spotify-elevated p-3 rounded-lg flex flex-col gap-2.5 group cursor-pointer transition-all duration-200"
                        >
                          <div className="relative aspect-square w-full rounded-md overflow-hidden bg-spotify-highlight shadow-md">
                            {track.thumbnail ? (
                              <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Music2 className="w-10 h-10 m-auto text-spotify-subtext" />
                            )}
                            <button className={`absolute bottom-2 right-2 w-10 h-10 rounded-full bg-spotify-green text-black flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 ${
                              player.currentTrack?.id === track.id
                                ? 'opacity-100 translate-y-0'
                                : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                            }`}>
                              {player.currentTrack?.id === track.id && player.isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : player.currentTrack?.id === track.id && player.isPlaying ? (
                                <Pause className="w-5 h-5 fill-current" />
                              ) : (
                                <Play className="w-5 h-5 fill-current translate-x-0.5" />
                              )}
                            </button>
                          </div>
                          <span className="font-bold text-xs truncate text-white">{track.title}</span>
                          <span className="text-[11px] text-spotify-subtext truncate">{track.artist}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* VIEW: SEARCH */}
            {currentView === 'search' && (
              <div className="flex flex-col gap-4 animate-fadeIn">
                {isSearching ? (
                  <div className="flex items-center justify-center p-12 text-spotify-subtext gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                    <span>מחפש שירים ללא פרסומות...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <h2 className="font-bold text-lg text-white mb-2">תוצאות חיפוש</h2>
                    {searchResults.map((track, idx) => (
                      <TrackRow
                        key={track.id || idx}
                        index={idx}
                        track={track}
                        isCurrentTrack={player.currentTrack?.id === track.id}
                        isPlaying={player.isPlaying}
                        isLoading={player.isLoading}
                        onPlay={(t) => handlePlayTrack(t, searchResults, idx)}
                        isLiked={likedSongs.some(s => s.id === track.id || (s.title === track.title && s.artist === track.artist))}
                        onToggleLike={handleToggleLike}
                        isDownloaded={downloadedIds?.has(track.id)}
                        isDownloading={downloadingIds?.has(track.id)}
                        onDownload={handleDownloadTrack}
                        onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-spotify-subtext gap-2">
                    <Search className="w-12 h-12 text-spotify-subtext/40 mb-2" />
                    <p className="font-medium text-base">חפש כל שיר, אמן או אלבום שתרצה</p>
                    <p className="text-xs text-spotify-subtext/60">המוזיקה תתנגן ישירות באיכות גבוהה וללא פרסומות</p>
                  </div>
                )}
              </div>
            )}

            {/* VIEW: LIBRARY */}
            {currentView === 'library' && (
              <div className="flex flex-col gap-6 animate-fadeIn">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {/* Liked Songs Tile */}
                  <div
                    onClick={() => setCurrentView('liked')}
                    className="aspect-square rounded-lg bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600 p-4 flex flex-col justify-end shadow-xl cursor-pointer hover:scale-[1.02] transition-transform"
                  >
                    <Heart className="w-8 h-8 fill-white mb-2" />
                    <h3 className="font-black text-xl text-white">שירים שאהבתי</h3>
                    <p className="text-xs text-white/80">{likedSongs.length} שירים שמורים</p>
                  </div>

                  {/* Offline Downloads Tile */}
                  <div
                    onClick={() => setCurrentView('offline')}
                    className="aspect-square rounded-lg bg-gradient-to-br from-teal-700 via-emerald-800 to-cyan-900 p-4 flex flex-col justify-end shadow-xl cursor-pointer hover:scale-[1.02] transition-transform"
                  >
                    <ArrowDownCircle className="w-8 h-8 text-white mb-2" />
                    <h3 className="font-black text-xl text-white">הורדות אופליין</h3>
                    <p className="text-xs text-white/80">{downloadedIds.size} שירים שמורים במכשיר</p>
                  </div>

                  {/* Playlists Tiles */}
                  {playlists.map(pl => (
                    <div
                      key={pl.id}
                      onClick={() => {
                        setSelectedPlaylistId(pl.id);
                        setCurrentView('playlist');
                      }}
                      className="bg-spotify-dark hover:bg-spotify-elevated p-3 rounded-lg flex flex-col gap-2.5 cursor-pointer transition-colors group"
                    >
                      <div className="aspect-square rounded-md overflow-hidden bg-spotify-highlight">
                        {pl.cover ? (
                          <img src={pl.cover} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Music2 className="w-10 h-10 m-auto text-spotify-subtext" />
                        )}
                      </div>
                      <span className="font-bold text-sm text-white truncate">{pl.title}</span>
                      <span className="text-xs text-spotify-subtext">{pl.tracks?.length || 0} שירים</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* VIEW: LIKED SONGS */}
            {isLikedPlaylist && (
              <PlaylistView
                playlist={{
                  id: 'liked',
                  title: 'שירים שאהבתי (Liked Songs)',
                  cover: likedSongs[0]?.thumbnail || '',
                  type: 'Favorites',
                  tracks: likedSongs
                }}
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onDownloadTrack={handleDownloadTrack}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
              />
            )}

            {/* VIEW: SPECIFIC PLAYLIST */}
            {currentView === 'playlist' && activePlaylist && (
              <PlaylistView
                playlist={activePlaylist}
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                onDeletePlaylist={handleDeletePlaylist}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onDownloadTrack={handleDownloadTrack}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
              />
            )}

            {/* VIEW: OFFLINE DOWNLOADS */}
            {currentView === 'offline' && (
              <OfflineView
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                onTrackDeleted={refreshDownloads}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
              />
            )}

            {/* VIEW: DATA ANALYTICS & STATS */}
            {currentView === 'analytics' && (
              <AnalyticsView />
            )}
          </div>
        </main>
      </div>

      {/* Fixed Bottom Controls & Navigation */}
      <PlayerBar
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        isLoading={player.isLoading}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        isMuted={player.isMuted}
        isShuffle={player.isShuffle}
        shuffleMode={player.shuffleMode}
        repeatMode={player.repeatMode}
        onTogglePlay={player.togglePlay}
        onNext={player.nextTrack}
        onPrev={player.prevTrack}
        onSeek={player.seek}
        onSetVolume={player.setVolume}
        onToggleMute={player.toggleMute}
        onToggleShuffle={handleToggleShuffle}
        onToggleRepeat={player.toggleRepeat}
        isLiked={likedSongs.some(s => s.id === player.currentTrack?.id || (s.title === player.currentTrack?.title && s.artist === player.currentTrack?.artist))}
        onToggleLike={handleToggleLike}
        onOpenLyrics={() => setIsLyricsOpen(true)}
        onOpenFullscreen={() => setIsFullscreenPlayerOpen(true)}
      />

      {/* Mobile Tab Bar */}
      <MobileNav
        currentView={currentView}
        setCurrentView={setCurrentView}
        openImportModal={() => setIsImportModalOpen(true)}
        setSelectedPlaylistId={setSelectedPlaylistId}
      />

      {/* Fullscreen Player (Mobile Swipe-up / Expanded View) */}
      <FullscreenPlayer
        isOpen={isFullscreenPlayerOpen}
        onClose={() => setIsFullscreenPlayerOpen(false)}
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        duration={player.duration}
        onTogglePlay={player.togglePlay}
        onNext={player.nextTrack}
        onPrev={player.prevTrack}
        onSeek={player.seek}
        isShuffle={player.isShuffle}
        shuffleMode={player.shuffleMode}
        onToggleShuffle={handleToggleShuffle}
        repeatMode={player.repeatMode}
        onToggleRepeat={player.toggleRepeat}
        isLiked={likedSongs.some(s => s.id === player.currentTrack?.id || (s.title === player.currentTrack?.title && s.artist === player.currentTrack?.artist))}
        onToggleLike={handleToggleLike}
        onOpenLyrics={() => {
          setIsFullscreenPlayerOpen(false);
          setIsLyricsOpen(true);
        }}
      />

      {/* Synced Lyrics Modal */}
      {isLyricsOpen && (
        <SyncedLyrics
          lyricsData={lyricsData}
          currentTime={player.currentTime}
          onSeek={player.seek}
          onClose={() => setIsLyricsOpen(false)}
          currentTrack={player.currentTrack}
        />
      )}

      {/* Playlist Importer Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onPlaylistImported={handlePlaylistImported}
      />

      {/* Add Track To Playlist Modal */}
      <AddToPlaylistModal
        isOpen={!!trackForAddToPlaylist}
        track={trackForAddToPlaylist}
        onClose={handleCloseAddToPlaylist}
        playlists={playlists}
        onAddToPlaylist={handleAddToPlaylist}
        onCreatePlaylist={handleCreatePlaylist}
      />

      {/* Floating Status Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-full bg-spotify-elevated/95 text-white font-bold text-sm shadow-2xl border border-white/10 backdrop-blur-xl flex items-center gap-2.5 animate-fadeIn pointer-events-none">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
