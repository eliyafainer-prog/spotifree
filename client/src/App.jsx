import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  PlusCircle,
  Plus,
  Heart,
  Music2,
  Sparkles,
  Flame,
  Clock,
  Play,
  Pause,
  Loader2,
  ArrowDownCircle,
  Server,
  BarChart3,
  Pin,
  X,
  LayoutGrid,
  List
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
  createCustomPlaylist,
  reorderPlaylistTracks,
  reorderLikedSongs,
  renamePlaylist,
  isSameTrack
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
import { ServerSettingsModal } from './components/ServerSettingsModal';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

const BROWSE_CATEGORIES = [
  { title: 'להיטים ישראליים', query: 'להיטים ישראליים עומר אדם נועה קירל', color: 'bg-[#e13300]' },
  { title: 'פופ עולמי', query: 'Top Pop Hits 2025 The Weeknd Dua Lipa', color: 'bg-[#7358ff]' },
  { title: 'ים-תיכוני ומזרחית', query: 'מזרחית ים תיכוני אייל גולן עדן בן זקן', color: 'bg-[#1e3264]' },
  { title: 'היפ-הופ וראפ', query: 'Hip Hop Rap Hits טונה רביד פלוטניק', color: 'bg-[#bc5900]' },
  { title: 'מסיבה ודאנס', query: 'Party Dance Hits Electronic', color: 'bg-[#e8115b]' },
  { title: 'אימונים וכושר', query: 'Workout Gym Motivation Hits', color: 'bg-[#148a08]' },
  { title: 'רוק קלאסי', query: 'Classic Rock Greatest Hits', color: 'bg-[#e91429]' },
  { title: 'שירים שקטים ורגועים', query: 'שירים שקטים בעברית Chill Acoustic', color: 'bg-[#0d73ec]' },
  { title: 'נוסטלגיה ישראלית', query: 'קלאסיקות ישראליות אריק איינשטיין שלמה ארצי', color: 'bg-[#8d67ab]' },
  { title: 'להיטי ויראלי וטיקטוק', query: 'TikTok Viral Hits 2025', color: 'bg-[#dc148c]' }
];

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 17) return 'צהריים טובים';
  if (hour >= 17 && hour < 22) return 'ערב טוב';
  return 'לילה טוב';
}

export default function App() {
  const player = useAudioPlayer();

  useEffect(() => {
    const startService = async () => {
      try {
        await ForegroundService.startForegroundService({
          id: 1,
          title: 'SpotiFree',
          body: 'Playing music in background',
          smallIcon: 'ic_stat_name'
        });
      } catch (err) {
        // Ignore on web
      }
    };
    startService();
  }, []);

  // Navigation & Views
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'search' | 'library' | 'liked' | 'playlist' | 'offline' | 'analytics'
  const [homeFilter, setHomeFilter] = useState('all'); // 'all' | 'music' | 'playlists'
  const [libraryLayout, setLibraryLayout] = useState('list'); // 'list' | 'grid'
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
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
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
      showToast('🔀 השמעה אקראית מופעלת');
    } else if (nextMode === 'smart') {
      showToast('✨ ערבוב חכם מופעל (Smart Shuffle)');
    } else {
      showToast('➡️ השמעה אקראית כבויה');
    }
  }, [player, showToast]);

  const handlePlayShuffled = useCallback((trackList) => {
    if (!trackList || trackList.length === 0) return;
    player.playShuffled(trackList);
    showToast('🔀 השמעה אקראית מופעלת');
  }, [player, showToast]);

  // Offline Downloads state
  const [downloadedIds, setDownloadedIds] = useState(new Set());
  const [downloadingIds, setDownloadingIds] = useState(new Set());

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

  const handleDownloadTrack = async (track) => {
    if (!track || downloadedIds.has(track.id) || downloadingIds.has(track.id)) return;

    setDownloadingIds(prev => new Set([...prev, track.id]));
    try {
      const blob = await downloadTrackAudioBlob(track);
      await saveTrackOffline(track, blob);
      setDownloadedIds(prev => new Set([...prev, track.id]));
      showToast('✓ השיר נשמר להאזנה אופליין');
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

  useMediaSession({
    currentTrack: player.currentTrack,
    isPlaying: player.isPlaying,
    duration: player.duration,
    currentTime: player.currentTime,
    onPlay: player.play,
    onPause: player.pause,
    onNext: player.nextTrack,
    onPrev: player.prevTrack,
    onSeek: player.seek
  });

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

  // Proactively prefetch and auto-enrich all playlist tracks in batches when opening a playlist
  useEffect(() => {
    const activePl = playlists.find(p => p.id === selectedPlaylistId);
    if (!activePl || !activePl.tracks || activePl.tracks.length === 0) return;

    prefetchNextTracks(activePl.tracks.slice(0, 4));

    const isAlbumPlaylist = activePl.type?.toLowerCase() === 'album';
    const unverified = activePl.tracks.filter(
      t => t.id?.startsWith('sp_') || !t.thumbnail || (!isAlbumPlaylist && t.hasCustomArtwork === false) || (!isAlbumPlaylist && t.thumbnail === activePl.cover && !t.hasCustomArtwork)
    );

    if (unverified.length > 0) {
      let cancelled = false;

      (async () => {
        const batchSize = 5;
        for (let i = 0; i < unverified.length; i += batchSize) {
          if (cancelled) break;
          const batch = unverified.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (t) => {
              try {
                const res = await resolveTrack(t, true);
                if (res && res.streamableId) {
                  updateTrackInPlaylists({
                    ...t,
                    originalId: t.originalId || t.id,
                    streamableId: res.streamableId,
                    id: res.streamableId,
                    hasCustomArtwork: true,
                    thumbnail: res.thumbnail || t.thumbnail,
                    durationSeconds: res.durationSeconds || t.durationSeconds
                  });
                }
              } catch (e) {}
            })
          );
          if (!cancelled) {
            setPlaylists(getPlaylists());
          }
        }
      })();

      return () => { cancelled = true; };
    }
  }, [selectedPlaylistId]);

  useEffect(() => {
    if (currentView === 'liked' && likedSongs.length > 0) {
      prefetchNextTracks(likedSongs.slice(0, 5));
    }
  }, [currentView, likedSongs]);

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

  // Live debounced search as the user types (320ms)
  useEffect(() => {
    if (currentView !== 'search') return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsSearching(true);
      searchTracks(trimmed)
        .then(results => {
          setSearchResults(results);
          if (results && results.length > 0) {
            prefetchNextTracks(results.slice(0, 4));
          }
        })
        .catch(err => console.error('Live search error:', err))
        .finally(() => setIsSearching(false));
    }, 320);

    return () => clearTimeout(timer);
  }, [searchQuery, currentView]);

  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setIsSearching(true);
    try {
      const results = await searchTracks(trimmed);
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

  const handleToggleLike = (track) => {
    const { updated, isLiked } = toggleLikeSong(track);
    setLikedSongs(updated);
    showToast(isLiked ? 'נוסף לשירים שאהבתי 💚' : 'הוסר משירים שאהבתי');
  };

  const handlePlaylistImported = (newPlaylist) => {
    const updated = savePlaylist(newPlaylist);
    setPlaylists(updated);
    setSelectedPlaylistId(newPlaylist.id);
    setCurrentView('playlist');
  };

  const handleDeletePlaylist = (playlistId) => {
    const updated = deletePlaylist(playlistId);
    setPlaylists(updated);
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
      setCurrentView('library');
    }
  };

  const handleOpenAddToPlaylist = (track) => {
    setTrackForAddToPlaylist(track);
  };

  const handleCloseAddToPlaylist = () => {
    setTrackForAddToPlaylist(null);
  };

  const handleAddToPlaylist = (playlistId, track) => {
    const { updated } = addTrackToPlaylist(playlistId, track);
    setPlaylists(updated);
    showToast('השיר נוסף לפלייליסט');
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

  const handleReorderPlaylist = (playlistId, newTracks) => {
    const updated = reorderPlaylistTracks(playlistId, newTracks);
    setPlaylists(updated);
  };

  const handleReorderLiked = (newTracks) => {
    const updated = reorderLikedSongs(newTracks);
    setLikedSongs(updated);
  };

  const handleRenamePlaylist = (playlistId, newTitle) => {
    const updated = renamePlaylist(playlistId, newTitle);
    setPlaylists(updated);
    showToast(`שם הפלייליסט עודכן ל-"${newTitle}"`);
  };

  const handlePlayTrack = (track, queueList = null, index = -1) => {
    player.playTrack(track, queueList, index);
    recordTrackPlay(track);
    setTimeout(() => {
      setRecentTracks(getRecentTracks());
      setPlaylists(getPlaylists());
    }, 600);
  };

  useEffect(() => {
    if (!player.isPlaying) return;
    const interval = setInterval(() => {
      recordListeningSeconds(1);
    }, 1000);
    return () => clearInterval(interval);
  }, [player.isPlaying]);

  useEffect(() => {
    const handleKeyDown = (e) => {
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

  const activePlaylist = selectedPlaylistId
    ? playlists.find(p => p.id === selectedPlaylistId)
    : null;

  const isLikedPlaylist = currentView === 'liked';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-black text-white select-none">
      {/* Main Content Wrapper */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <Sidebar
          currentView={currentView}
          setCurrentView={setCurrentView}
          playlists={playlists}
          likedCount={likedSongs.length}
          downloadedCount={downloadedIds.size}
          openImportModal={() => setIsImportModalOpen(true)}
          onCreatePlaylist={() => handleCreatePlaylist(`הפלייליסט שלי #${playlists.length + 1}`)}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
        />

        {/* Main Scrollable Viewport (#121212 Spotify Surface) */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#121212] md:rounded-lg md:m-2 overflow-hidden relative">
          {/* Top Bar (Filter Pills on Home, White Search Bar on Search, Clean Title on Library) */}
          {currentView !== 'playlist' && currentView !== 'liked' && (
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 bg-[#121212]/90 backdrop-blur-md sticky top-0 z-20">
              {currentView === 'home' ? (
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  <div className="w-8 h-8 rounded-full bg-spotify-green text-black font-black text-sm flex items-center justify-center flex-shrink-0">
                    S
                  </div>
                  <button
                    onClick={() => setHomeFilter('all')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                      homeFilter === 'all' ? 'bg-spotify-green text-black font-bold' : 'bg-[#2a2a2a] text-white hover:bg-[#333333]'
                    }`}
                  >
                    הכל
                  </button>
                  <button
                    onClick={() => setHomeFilter('music')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                      homeFilter === 'music' ? 'bg-spotify-green text-black font-bold' : 'bg-[#2a2a2a] text-white hover:bg-[#333333]'
                    }`}
                  >
                    מוזיקה
                  </button>
                  <button
                    onClick={() => setHomeFilter('playlists')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                      homeFilter === 'playlists' ? 'bg-spotify-green text-black font-bold' : 'bg-[#2a2a2a] text-white hover:bg-[#333333]'
                    }`}
                  >
                    פלייליסטים
                  </button>
                </div>
              ) : currentView === 'search' ? (
                <div className="flex flex-col gap-3 w-full">
                  <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-extrabold text-white">חיפוש</h1>
                  </div>
                  {/* Authentic Spotify White Search Input Bar */}
                  <form onSubmit={handleSearchSubmit} className="w-full max-w-xl relative">
                    <Search className="w-5 h-5 absolute right-3.5 top-1/2 -translate-y-1/2 text-[#121212]" />
                    <input
                      type="text"
                      placeholder="מה בא לך לשמוע?"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-11 bg-white text-[#121212] font-semibold text-[15px] pr-11 pl-10 rounded-[6px] focus:outline-none placeholder:text-zinc-500 text-right shadow-sm"
                      autoFocus
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-black"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )}
                  </form>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-spotify-green text-black font-black text-sm flex items-center justify-center">
                    S
                  </div>
                  <h1 className="text-xl font-extrabold text-white">
                    {currentView === 'library' && 'הספרייה שלך'}
                    {currentView === 'offline' && 'הורדות אופליין'}
                    {currentView === 'analytics' && 'סטטיסטיקות האזנה'}
                  </h1>
                </div>
              )}

              {/* Right/Left Header Quick Icons */}
              {currentView !== 'search' && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => setCurrentView('analytics')}
                    title="סטטיסטיקות"
                    className="p-2 rounded-full text-[#b3b3b3] hover:text-white hover:bg-[#282828] transition-colors"
                  >
                    <BarChart3 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setIsServerModalOpen(true)}
                    title="חיבור שרת"
                    className="p-2 rounded-full text-[#b3b3b3] hover:text-white hover:bg-[#282828] transition-colors"
                  >
                    <Server className="w-5 h-5 text-spotify-green" />
                  </button>
                  <button
                    onClick={() => setIsImportModalOpen(true)}
                    title="ייבוא פלייליסט מספוטיפיי"
                    className="flex items-center gap-1.5 bg-[#2a2a2a] hover:bg-[#383838] text-white text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
                  >
                    <Plus className="w-4 h-4 text-spotify-green" />
                    <span className="hidden sm:inline">ייבוא</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Main Scrollable View Body */}
          <div className="flex-1 overflow-y-auto px-4 md:px-6 pt-2 pb-24">
            {/* ==================== VIEW: HOME ==================== */}
            {currentView === 'home' && (
              <div className="flex flex-col gap-7 animate-fadeIn">
                {/* Iconic Spotify 2-Column Compact Top Grid (Playlists & Quick Shortcuts) */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {/* Card 1: Liked Songs */}
                  <div
                    onClick={() => setCurrentView('liked')}
                    className="flex items-center gap-2.5 h-14 bg-[#282828]/85 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                  >
                    <div className="w-14 h-14 bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center flex-shrink-0">
                      <Heart className="w-6 h-6 fill-white text-white" />
                    </div>
                    <span className="font-bold text-[13px] text-white line-clamp-2 pl-2 leading-tight">
                      שירים שאהבתי
                    </span>
                  </div>

                  {/* User's Saved/Imported Playlists in Top Grid */}
                  {playlists.slice(0, 5).map((pl) => (
                    <div
                      key={pl.id}
                      onClick={() => {
                        setSelectedPlaylistId(pl.id);
                        setCurrentView('playlist');
                      }}
                      className="flex items-center gap-2.5 h-14 bg-[#282828]/85 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                    >
                      <div className="w-14 h-14 bg-[#181818] flex-shrink-0 overflow-hidden">
                        {pl.cover ? (
                          <img src={pl.cover} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#b3b3b3]">
                            <Music2 className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <span className="font-bold text-[13px] text-white line-clamp-2 pl-2 leading-tight">
                        {pl.title}
                      </span>
                    </div>
                  ))}

                  {/* Offline Downloads Shortcut */}
                  <div
                    onClick={() => setCurrentView('offline')}
                    className="flex items-center gap-2.5 h-14 bg-[#282828]/85 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                  >
                    <div className="w-14 h-14 bg-gradient-to-br from-emerald-700 to-teal-900 flex items-center justify-center flex-shrink-0">
                      <ArrowDownCircle className="w-6 h-6 fill-spotify-green text-black" />
                    </div>
                    <span className="font-bold text-[13px] text-white line-clamp-2 pl-2 leading-tight">
                      הורדות אופליין
                    </span>
                  </div>

                  {/* Import Playlist Card */}
                  <div
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-2.5 h-14 bg-[#282828]/85 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                  >
                    <div className="w-14 h-14 bg-[#202020] flex items-center justify-center flex-shrink-0 text-spotify-green">
                      <PlusCircle className="w-6 h-6" />
                    </div>
                    <span className="font-bold text-[13px] text-white line-clamp-2 pl-2 leading-tight">
                      ייבוא מספוטיפיי
                    </span>
                  </div>
                </div>

                {/* Section 1: Recently Played (Horizontal Carousel on Mobile, Grid on Desktop) */}
                {homeFilter !== 'playlists' && recentTracks.length > 0 && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-extrabold text-xl text-white tracking-tight">הושמעו לאחרונה</h2>
                    </div>
                    <div className="flex overflow-x-auto gap-3.5 no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                      {recentTracks.slice(0, 10).map((track, idx) => (
                        <div
                          key={track.id || idx}
                          onClick={() => handlePlayTrack(track, recentTracks, idx)}
                          className="w-36 sm:w-44 flex-shrink-0 sm:p-3 sm:rounded-md sm:hover:bg-[#181818] flex flex-col gap-2 group cursor-pointer transition-colors"
                        >
                          <div className="relative aspect-square w-full rounded-[6px] overflow-hidden bg-[#282828] shadow-md">
                            {track.thumbnail ? (
                              <img src={track.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
                            ) : (
                              <Music2 className="w-10 h-10 m-auto text-[#b3b3b3]" />
                            )}
                            <button className="hidden sm:flex absolute bottom-2 right-2 w-11 h-11 rounded-full bg-spotify-green text-black items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-105">
                              <Play className="w-5 h-5 fill-black text-black translate-x-0.5" />
                            </button>
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-[13px] truncate text-white">{track.title}</span>
                            <span className="text-xs text-[#b3b3b3] truncate">{track.artist}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 2: Your Playlists Carousel */}
                {homeFilter !== 'music' && playlists.length > 0 && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-extrabold text-xl text-white tracking-tight">הפלייליסטים שלך</h2>
                    </div>
                    <div className="flex overflow-x-auto gap-3.5 no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                      {playlists.map((pl) => (
                        <div
                          key={pl.id}
                          onClick={() => {
                            setSelectedPlaylistId(pl.id);
                            setCurrentView('playlist');
                          }}
                          className="w-36 sm:w-44 flex-shrink-0 sm:p-3 sm:rounded-md sm:hover:bg-[#181818] flex flex-col gap-2 group cursor-pointer transition-colors"
                        >
                          <div className="relative aspect-square w-full rounded-[6px] overflow-hidden bg-[#282828] shadow-md">
                            {pl.cover ? (
                              <img src={pl.cover} alt="" loading="lazy" className="w-full h-full object-cover" />
                            ) : (
                              <Music2 className="w-10 h-10 m-auto text-[#b3b3b3]" />
                            )}
                            <button className="hidden sm:flex absolute bottom-2 right-2 w-11 h-11 rounded-full bg-spotify-green text-black items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-105">
                              <Play className="w-5 h-5 fill-black text-black translate-x-0.5" />
                            </button>
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-[13px] truncate text-white">{pl.title}</span>
                            <span className="text-xs text-[#b3b3b3] truncate">{pl.tracks?.length || 0} שירים</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 3: Trending & Hits */}
                {homeFilter !== 'playlists' && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-extrabold text-xl text-white tracking-tight">להיטים חמים עכשיו</h2>
                    </div>

                    {isTrendingLoading ? (
                      <div className="flex items-center justify-center p-12 text-[#b3b3b3] gap-3">
                        <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                        <span className="text-sm">טוען להיטים...</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                        {trendingTracks.map((track, idx) => {
                          const active = isSameTrack(player.currentTrack, track);
                          return (
                            <div
                              key={track.id || idx}
                              onClick={() => handlePlayTrack(track, trendingTracks, idx)}
                              onMouseEnter={() => prefetchNextTracks([track])}
                              className="sm:bg-[#181818] sm:hover:bg-[#282828] sm:p-3 rounded-md flex flex-col gap-2 group cursor-pointer transition-all duration-200"
                            >
                              <div className="relative aspect-square w-full rounded-[6px] overflow-hidden bg-[#282828] shadow-md">
                                {track.thumbnail ? (
                                  <img src={track.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
                                ) : (
                                  <Music2 className="w-10 h-10 m-auto text-[#b3b3b3]" />
                                )}
                                <button
                                  className={`absolute bottom-2 right-2 w-11 h-11 rounded-full bg-spotify-green text-black flex items-center justify-center shadow-xl transition-all duration-200 hover:scale-105 ${
                                    active
                                      ? 'opacity-100 translate-y-0'
                                      : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                                  }`}
                                >
                                  {active && player.isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin text-black" />
                                  ) : active && player.isPlaying ? (
                                    <Pause className="w-5 h-5 fill-black text-black" />
                                  ) : (
                                    <Play className="w-5 h-5 fill-black text-black translate-x-0.5" />
                                  )}
                                </button>
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className={`font-bold text-[13px] truncate ${active ? 'text-spotify-green' : 'text-white'}`}>
                                  {track.title}
                                </span>
                                <span className="text-xs text-[#b3b3b3] truncate">{track.artist}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}

            {/* ==================== VIEW: SEARCH ==================== */}
            {currentView === 'search' && (
              <div className="flex flex-col gap-4 animate-fadeIn">
                {isSearching ? (
                  <div className="flex items-center justify-center p-12 text-[#b3b3b3] gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                    <span className="text-sm">מחפש...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="flex flex-col">
                    {searchResults.map((track, idx) => (
                      <TrackRow
                        key={track.id || idx}
                        index={idx}
                        track={track}
                        isCurrentTrack={isSameTrack(player.currentTrack, track)}
                        isPlaying={player.isPlaying}
                        isLoading={player.isLoading}
                        onPlay={(t) => handlePlayTrack(t, searchResults, idx)}
                        isLiked={likedSongs.some(s => isSameTrack(s, track))}
                        onToggleLike={handleToggleLike}
                        isDownloaded={downloadedIds?.has(track.id)}
                        isDownloading={downloadingIds?.has(track.id)}
                        onDownload={handleDownloadTrack}
                        onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      />
                    ))}
                  </div>
                ) : (
                  /* Authentic Spotify "עיון בהכל" Colorful Category Tiles */
                  <div className="flex flex-col gap-3 mt-1">
                    <h2 className="font-bold text-base text-white">עיון בהכל</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {BROWSE_CATEGORIES.map((cat, idx) => (
                        <div
                          key={idx}
                          onClick={() => setSearchQuery(cat.query)}
                          className={`${cat.color} h-24 sm:h-28 rounded-[8px] p-3.5 relative overflow-hidden cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-md`}
                        >
                          <span className="font-extrabold text-base text-white leading-snug block max-w-[75%]">
                            {cat.title}
                          </span>
                          <div className="w-16 h-16 rounded shadow-lg bg-black/25 absolute -bottom-2 -left-2 rotate-[25deg] flex items-center justify-center">
                            <Music2 className="w-7 h-7 text-white/70" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== VIEW: YOUR LIBRARY ==================== */}
            {currentView === 'library' && (
              <div className="flex flex-col gap-4 animate-fadeIn">
                {/* Library Action Bar */}
                <div className="flex items-center justify-between gap-2 pb-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCreatePlaylist(`הפלייליסט שלי #${playlists.length + 1}`)}
                      className="px-3.5 py-1.5 rounded-full bg-[#2a2a2a] hover:bg-[#383838] text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>פלייליסט חדש</span>
                    </button>
                    <button
                      onClick={() => setIsImportModalOpen(true)}
                      className="px-3.5 py-1.5 rounded-full bg-[#2a2a2a] hover:bg-[#383838] text-spotify-green text-xs font-semibold flex items-center gap-1.5"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>ייבוא מספוטיפיי</span>
                    </button>
                  </div>

                  <button
                    onClick={() => setLibraryLayout(prev => (prev === 'list' ? 'grid' : 'list'))}
                    className="p-1.5 text-[#b3b3b3] hover:text-white"
                    title="החלף תצוגה"
                  >
                    {libraryLayout === 'list' ? <LayoutGrid className="w-5 h-5" /> : <List className="w-5 h-5" />}
                  </button>
                </div>

                {libraryLayout === 'list' ? (
                  /* Authentic Spotify Mobile/Desktop Library List View */
                  <div className="flex flex-col gap-1">
                    {/* Pinned: Liked Songs */}
                    <div
                      onClick={() => setCurrentView('liked')}
                      className="flex items-center gap-3.5 p-2 rounded-md hover:bg-[#1f1f1f] active:bg-[#1f1f1f] cursor-pointer transition-colors"
                    >
                      <div className="w-16 h-16 rounded-[4px] bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center text-white flex-shrink-0 shadow">
                        <Heart className="w-7 h-7 fill-white" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1 text-right">
                        <span className="text-base font-semibold text-white truncate">שירים שאהבתי</span>
                        <div className="flex items-center gap-1.5 text-[13px] text-[#b3b3b3] mt-0.5">
                          <Pin className="w-3.5 h-3.5 fill-spotify-green text-spotify-green rotate-45 flex-shrink-0" />
                          <span>פלייליסט • {likedSongs.length} שירים</span>
                        </div>
                      </div>
                    </div>

                    {/* Offline Downloads */}
                    <div
                      onClick={() => setCurrentView('offline')}
                      className="flex items-center gap-3.5 p-2 rounded-md hover:bg-[#1f1f1f] active:bg-[#1f1f1f] cursor-pointer transition-colors"
                    >
                      <div className="w-16 h-16 rounded-[4px] bg-gradient-to-br from-emerald-700 to-teal-900 flex items-center justify-center flex-shrink-0 shadow">
                        <ArrowDownCircle className="w-7 h-7 fill-spotify-green text-black" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1 text-right">
                        <span className="text-base font-semibold text-white truncate">הורדות אופליין</span>
                        <span className="text-[13px] text-[#b3b3b3] truncate mt-0.5">
                          שמורים במכשיר • {downloadedIds.size} שירים
                        </span>
                      </div>
                    </div>

                    {/* Playlists */}
                    {playlists.map((pl) => (
                      <div
                        key={pl.id}
                        onClick={() => {
                          setSelectedPlaylistId(pl.id);
                          setCurrentView('playlist');
                        }}
                        className="flex items-center gap-3.5 p-2 rounded-md hover:bg-[#1f1f1f] active:bg-[#1f1f1f] cursor-pointer transition-colors"
                      >
                        <div className="w-16 h-16 rounded-[4px] bg-[#282828] overflow-hidden flex-shrink-0 shadow">
                          {pl.cover ? (
                            <img src={pl.cover} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[#b3b3b3]">
                              <Music2 className="w-7 h-7" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1 text-right">
                          <span className="text-base font-semibold text-white truncate">{pl.title}</span>
                          <span className="text-[13px] text-[#b3b3b3] truncate mt-0.5">
                            {pl.type === 'album' ? 'אלבום' : 'פלייליסט'} • SpotiFree • {pl.tracks?.length || 0} שירים
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Grid View */
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <div
                      onClick={() => setCurrentView('liked')}
                      className="flex flex-col gap-2 cursor-pointer group"
                    >
                      <div className="aspect-square rounded-[6px] bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center shadow-lg">
                        <Heart className="w-14 h-14 fill-white text-white" />
                      </div>
                      <span className="font-bold text-sm text-white truncate">שירים שאהבתי</span>
                      <span className="text-xs text-[#b3b3b3]">פלייליסט • {likedSongs.length} שירים</span>
                    </div>

                    {playlists.map((pl) => (
                      <div
                        key={pl.id}
                        onClick={() => {
                          setSelectedPlaylistId(pl.id);
                          setCurrentView('playlist');
                        }}
                        className="flex flex-col gap-2 cursor-pointer group"
                      >
                        <div className="aspect-square rounded-[6px] overflow-hidden bg-[#282828] shadow-lg">
                          {pl.cover ? (
                            <img src={pl.cover} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Music2 className="w-12 h-12 m-auto text-[#b3b3b3]" />
                          )}
                        </div>
                        <span className="font-bold text-sm text-white truncate">{pl.title}</span>
                        <span className="text-xs text-[#b3b3b3]">{pl.tracks?.length || 0} שירים</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ==================== VIEW: LIKED SONGS ==================== */}
            {isLikedPlaylist && (
              <PlaylistView
                playlist={{
                  id: 'liked',
                  title: 'שירים שאהבתי',
                  cover: likedSongs[0]?.thumbnail || '',
                  type: 'Favorites',
                  tracks: likedSongs
                }}
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                onPlayTrack={handlePlayTrack}
                onTogglePlay={player.togglePlay}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onDownloadTrack={handleDownloadTrack}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
                onPlayShuffled={handlePlayShuffled}
                onReorderTracks={handleReorderLiked}
              />
            )}

            {/* ==================== VIEW: SPECIFIC PLAYLIST ==================== */}
            {currentView === 'playlist' && activePlaylist && (
              <PlaylistView
                playlist={activePlaylist}
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                onPlayTrack={handlePlayTrack}
                onTogglePlay={player.togglePlay}
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
                onPlayShuffled={handlePlayShuffled}
                onReorderTracks={(newTracks) => handleReorderPlaylist(activePlaylist.id, newTracks)}
                onRenamePlaylist={(newTitle) => handleRenamePlaylist(activePlaylist.id, newTitle)}
              />
            )}

            {/* ==================== VIEW: OFFLINE DOWNLOADS ==================== */}
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
                onPlayShuffled={handlePlayShuffled}
              />
            )}

            {/* ==================== VIEW: ANALYTICS ==================== */}
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
        isLiked={likedSongs.some(s => isSameTrack(s, player.currentTrack))}
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

      {/* Fullscreen Player */}
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
        isLiked={likedSongs.some(s => isSameTrack(s, player.currentTrack))}
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
          duration={player.duration}
          isPlaying={player.isPlaying}
          isLoading={player.isLoading}
          onSeek={player.seek}
          onTogglePlay={player.togglePlay}
          onNext={player.nextTrack}
          onPrev={player.prevTrack}
          isShuffle={player.isShuffle}
          shuffleMode={player.shuffleMode}
          onToggleShuffle={handleToggleShuffle}
          isLiked={likedSongs.some(s => isSameTrack(s, player.currentTrack))}
          onToggleLike={handleToggleLike}
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

      {/* Server Settings Modal */}
      <ServerSettingsModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        showToast={showToast}
      />

      {/* Spotify Bottom Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-36 md:bottom-24 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-[6px] bg-white text-black font-semibold text-xs shadow-2xl flex items-center gap-2 animate-fadeIn pointer-events-none">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
