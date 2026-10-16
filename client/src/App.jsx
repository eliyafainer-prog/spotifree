import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Home,
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
  List,
  Check,
  FolderSearch,
  Bell,
  Users
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

import { Sidebar, PlaylistThumb } from './components/Sidebar';
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
      } catch (err) {}
    };
    startService();
  }, []);

  // Navigation & Views
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'search' | 'library' | 'liked' | 'playlist' | 'offline' | 'analytics'
  const [homeFilter, setHomeFilter] = useState('all'); // 'all' | 'music' | 'playlists'
  const [libraryLayout, setLibraryLayout] = useState('list');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [showNowPlayingPanel, setShowNowPlayingPanel] = useState(true);
  const [mobileProfileMenuOpen, setMobileProfileMenuOpen] = useState(false);

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
  }, [searchQuery]);

  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    if (currentView !== 'search') setCurrentView('search');

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
    showToast(isLiked ? 'נוסף לשירים שאהבתם' : 'הוסר משירים שאהבתם');
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
  const isCurrentLiked = likedSongs.some(s => isSameTrack(s, player.currentTrack));

  // Find active lyric lines for the Desktop Left Panel preview card (Image 1)
  const previewLyricsLines = React.useMemo(() => {
    if (lyricsData?.hasSynced && lyricsData.synced?.length > 0) {
      let activeIdx = 0;
      for (let i = 0; i < lyricsData.synced.length; i++) {
        if (player.currentTime >= lyricsData.synced[i].time) {
          activeIdx = i;
        } else {
          break;
        }
      }
      return lyricsData.synced.slice(Math.max(0, activeIdx - 1), activeIdx + 3).map((l, idx) => ({
        text: l.text,
        isCurrent: idx === (activeIdx > 0 ? 1 : 0)
      }));
    }
    if (lyricsData?.plain?.length > 0) {
      return lyricsData.plain.slice(0, 4).map((t, idx) => ({ text: t, isCurrent: idx === 0 }));
    }
    return null;
  }, [lyricsData, player.currentTime]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-black text-white select-none">
      {/* ==================== DESKTOP GLOBAL TOP BAR (Exact Match to Image 1) ==================== */}
      <header className="hidden md:flex items-center justify-between h-16 px-4 bg-black flex-shrink-0 z-30">
        {/* Right side (RTL): Official Spotify White Logo */}
        <div
          onClick={() => {
            setCurrentView('home');
            setSelectedPlaylistId(null);
          }}
          className="flex items-center gap-2 cursor-pointer pr-1"
        >
          <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
        </div>

        {/* Center: Round Home Button + Global Pill Search Input ("מה אתם רוצים לנגן?") */}
        <div className="flex items-center gap-2 flex-1 max-w-[540px] mx-4">
          <button
            onClick={() => {
              setCurrentView('home');
              setSelectedPlaylistId(null);
            }}
            title="דף הבית"
            className="w-12 h-12 rounded-full bg-[#1f1f1f] hover:bg-[#2a2a2a] hover:scale-105 transition-all flex items-center justify-center flex-shrink-0 text-white"
          >
            <Home className={`w-6 h-6 ${currentView === 'home' ? 'fill-white' : ''}`} />
          </button>

          <form
            onSubmit={handleSearchSubmit}
            className="flex-1 h-12 rounded-full bg-[#1f1f1f] hover:bg-[#2a2a2a] focus-within:bg-[#242424] focus-within:ring-2 focus-within:ring-white/90 transition-all flex items-center px-3.5 gap-3"
          >
            <Search className="w-5 h-5 text-[#b3b3b3] flex-shrink-0" />
            <input
              type="text"
              placeholder="מה אתם רוצים לנגן?"
              value={searchQuery}
              onFocus={() => {
                if (currentView !== 'search') setCurrentView('search');
              }}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (currentView !== 'search') setCurrentView('search');
              }}
              className="flex-1 bg-transparent text-white text-sm font-medium focus:outline-none placeholder:text-[#b3b3b3] text-right"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-[#b3b3b3] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            ) : (
              <div className="flex items-center gap-2.5 pr-2 border-r border-white/15 text-[#b3b3b3]">
                <FolderSearch
                  onClick={() => setCurrentView('search')}
                  className="w-5 h-5 hover:text-white cursor-pointer"
                  title="עיון בקטגוריות"
                />
              </div>
            )}
          </form>
        </div>

        {/* Left side (RTL): White Pill Button + Icons + Green Profile Circle "E" (Exact Match to Image 1) */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="bg-white hover:scale-105 active:scale-95 text-black font-extrabold text-xs px-4 py-1.5 rounded-full transition-transform"
          >
            ייבוא מספוטיפיי
          </button>

          <button
            onClick={() => setCurrentView('analytics')}
            title="סטטיסטיקות האזנה"
            className="p-2 text-[#b3b3b3] hover:text-white transition-colors"
          >
            <Bell className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsServerModalOpen(true)}
            title="הגדרות שרת"
            className="p-2 text-[#b3b3b3] hover:text-white transition-colors"
          >
            <Users className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsServerModalOpen(true)}
            title="פרופיל והגדרות"
            className="w-8 h-8 rounded-full bg-[#1ed760] text-black font-extrabold text-sm flex items-center justify-center ring-4 ring-[#1f1f1f] hover:scale-105 transition-transform"
          >
            E
          </button>
        </div>
      </header>

      {/* ==================== MAIN 3-COLUMN WORKSPACE ==================== */}
      <div className="flex flex-1 overflow-hidden md:px-2 md:gap-2">
        {/* Column 1 (Right in RTL): Your Library Sidebar */}
        <Sidebar
          currentView={currentView}
          setCurrentView={setCurrentView}
          playlists={playlists}
          likedCount={likedSongs.length}
          downloadedCount={downloadedIds.size}
          openImportModal={() => setIsImportModalOpen(true)}
          onCreatePlaylist={() => handleCreatePlaylist(`פלייליסט מס׳ ${playlists.length + 1} שלי`)}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
        />

        {/* Column 2 (Center): Main Content Feed */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#121212] md:rounded-lg overflow-hidden relative">
          {/* Subtle Ambient Purple/Indigo Top Gradient on Home View (Matches Image 1) */}
          {currentView === 'home' && (
            <div className="hidden md:block absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-[#3b2667]/60 via-[#1e1535]/30 to-transparent pointer-events-none" />
          )}

          {/* Top Bar inside Main Panel */}
          {currentView !== 'playlist' && currentView !== 'liked' && (
            <div className="relative z-20 flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 sticky top-0">
              {currentView === 'home' ? (
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar w-full">
                  {/* Mobile Green Avatar "E" (Exact match to Image 3! Tapping opens Server/Analytics sheet) */}
                  <button
                    onClick={() => setMobileProfileMenuOpen(prev => !prev)}
                    className="md:hidden w-8 h-8 rounded-full bg-[#1ed760] text-black font-extrabold text-sm flex items-center justify-center flex-shrink-0 ml-1"
                  >
                    E
                  </button>

                  <button
                    onClick={() => setHomeFilter('all')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                      homeFilter === 'all'
                        ? 'bg-[#1ed760] md:bg-white text-black font-bold'
                        : 'bg-[#2a2a2a] md:bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    הכול
                  </button>
                  <button
                    onClick={() => setHomeFilter('music')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                      homeFilter === 'music'
                        ? 'bg-[#1ed760] md:bg-white text-black font-bold'
                        : 'bg-[#2a2a2a] md:bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    מוזיקה
                  </button>
                  <button
                    onClick={() => setHomeFilter('playlists')}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                      homeFilter === 'playlists'
                        ? 'bg-[#1ed760] md:bg-white text-black font-bold'
                        : 'bg-[#2a2a2a] md:bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    פודקאסטים
                  </button>
                </div>
              ) : currentView === 'search' ? (
                <div className="flex flex-col gap-3 w-full">
                  <div className="flex items-center justify-between md:hidden">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setMobileProfileMenuOpen(prev => !prev)}
                        className="w-8 h-8 rounded-full bg-[#1ed760] text-black font-extrabold text-sm flex items-center justify-center"
                      >
                        E
                      </button>
                      <h1 className="text-2xl font-extrabold text-white">חיפוש</h1>
                    </div>
                  </div>
                  {/* Mobile White Search Bar */}
                  <form onSubmit={handleSearchSubmit} className="w-full md:hidden relative">
                    <Search className="w-5 h-5 absolute right-3.5 top-1/2 -translate-y-1/2 text-[#121212]" />
                    <input
                      type="text"
                      placeholder="מה אתם רוצים לנגן?"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-11 bg-white text-[#121212] font-semibold text-[15px] pr-11 pl-10 rounded-[6px] focus:outline-none placeholder:text-zinc-500 text-right shadow-sm"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )}
                  </form>
                </div>
              ) : (
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setMobileProfileMenuOpen(prev => !prev)}
                      className="md:hidden w-8 h-8 rounded-full bg-[#1ed760] text-black font-extrabold text-sm flex items-center justify-center"
                    >
                      E
                    </button>
                    <h1 className="text-xl font-extrabold text-white">
                      {currentView === 'library' && 'הספרייה'}
                      {currentView === 'offline' && 'הורדות אופליין'}
                      {currentView === 'analytics' && 'סטטיסטיקות האזנה'}
                    </h1>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mobile Profile Quick Menu Drawer (when tapping green "E" circle) */}
          {mobileProfileMenuOpen && (
            <div className="md:hidden mx-4 mb-2 p-3 rounded-lg bg-[#282828] border border-white/10 flex items-center justify-around z-30 animate-fadeIn">
              <button
                onClick={() => {
                  setMobileProfileMenuOpen(false);
                  setIsImportModalOpen(true);
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-spotify-green"
              >
                <PlusCircle className="w-4 h-4" />
                <span>ייבוא פלייליסט</span>
              </button>
              <button
                onClick={() => {
                  setMobileProfileMenuOpen(false);
                  setCurrentView('analytics');
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-white"
              >
                <BarChart3 className="w-4 h-4" />
                <span>סטטיסטיקות</span>
              </button>
              <button
                onClick={() => {
                  setMobileProfileMenuOpen(false);
                  setIsServerModalOpen(true);
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-white"
              >
                <Server className="w-4 h-4 text-spotify-green" />
                <span>הגדרות שרת</span>
              </button>
            </div>
          )}

          {/* Main Scrollable Content Area (no-scrollbar on mobile so there is no grey bar on the left edge!) */}
          <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 md:px-6 pt-1 pb-24">
            {/* ==================== VIEW: HOME (Exact Match to Image 1 & Image 3) ==================== */}
            {currentView === 'home' && (
              <div className="flex flex-col gap-7 animate-fadeIn">
                {/* Top 2x4 Compact Grid (Image 1 & Image 3) */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {/* Card 1: שירים שאהבתם */}
                  <div
                    onClick={() => setCurrentView('liked')}
                    className="flex items-center gap-2.5 h-[52px] bg-[#282828]/90 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                  >
                    <div className="w-[52px] h-[52px] bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center flex-shrink-0">
                      <Heart className="w-6 h-6 fill-white text-white" />
                    </div>
                    <span className="flex-1 text-right font-bold text-[13px] text-white line-clamp-2 pr-0.5 pl-2 leading-tight">
                      שירים שאהבתם
                    </span>
                  </div>

                  {/* User's Saved/Imported Playlists with 2x2 Collage Covers */}
                  {playlists.slice(0, 6).map((pl) => (
                    <div
                      key={pl.id}
                      onClick={() => {
                        setSelectedPlaylistId(pl.id);
                        setCurrentView('playlist');
                      }}
                      className="flex items-center gap-2.5 h-[52px] bg-[#282828]/90 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                    >
                      <PlaylistThumb playlist={pl} className="w-[52px] h-[52px]" />
                      <span className="flex-1 text-right font-bold text-[13px] text-white line-clamp-2 pr-0.5 pl-2 leading-tight">
                        {pl.title}
                      </span>
                    </div>
                  ))}

                  {/* Recent Tracks fill remaining slots in the top 8 grid if user has fewer than 6 playlists */}
                  {playlists.length < 6 &&
                    recentTracks.slice(0, 6 - playlists.length).map((t, idx) => (
                      <div
                        key={`top_rec_${t.id || idx}`}
                        onClick={() => handlePlayTrack(t, recentTracks, idx)}
                        className="flex items-center gap-2.5 h-[52px] bg-[#282828]/90 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                      >
                        <div className="w-[52px] h-[52px] bg-[#181818] flex-shrink-0 overflow-hidden">
                          {t.thumbnail ? (
                            <img src={t.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <Music2 className="w-5 h-5 m-4 text-[#b3b3b3]" />
                          )}
                        </div>
                        <span className="flex-1 text-right font-bold text-[13px] text-white line-clamp-2 pr-0.5 pl-2 leading-tight">
                          {t.title}
                        </span>
                      </div>
                    ))}

                  {/* Import Playlist Card if grid still has room */}
                  {playlists.length + recentTracks.length < 7 && (
                    <div
                      onClick={() => setIsImportModalOpen(true)}
                      className="flex items-center gap-2.5 h-[52px] bg-[#282828]/90 hover:bg-[#3e3e3e] active:bg-[#3e3e3e] rounded-[4px] overflow-hidden cursor-pointer transition-colors group"
                    >
                      <div className="w-[52px] h-[52px] bg-[#202020] flex items-center justify-center flex-shrink-0 text-spotify-green">
                        <PlusCircle className="w-6 h-6" />
                      </div>
                      <span className="flex-1 text-right font-bold text-[13px] text-white line-clamp-2 pr-0.5 pl-2 leading-tight">
                        ייבוא מספוטיפיי
                      </span>
                    </div>
                  )}
                </div>

                {/* Section 1: חזרה לנקודה האחרונה (Exact title from Image 1 & Image 3) */}
                {homeFilter !== 'playlists' && recentTracks.length > 0 && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-extrabold text-[22px] text-white tracking-tight">חזרה לנקודה האחרונה</h2>
                      <span className="hidden sm:inline text-xs font-bold text-[#b3b3b3] hover:underline cursor-pointer">
                        הצגת כל האפשרויות
                      </span>
                    </div>
                    <div className="flex overflow-x-auto gap-4 no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                      {recentTracks.slice(0, 10).map((track, idx) => (
                        <div
                          key={track.id || idx}
                          onClick={() => handlePlayTrack(track, recentTracks, idx)}
                          className="w-[152px] sm:w-[172px] flex-shrink-0 sm:p-2.5 sm:rounded-md sm:hover:bg-[#181818] flex flex-col gap-1.5 group cursor-pointer transition-colors"
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
                          <div className="flex flex-col min-w-0 text-right mt-0.5">
                            <span className="font-bold text-[13px] truncate text-white">{track.title}</span>
                            <span className="text-xs text-[#b3b3b3] truncate mt-0.5">{track.artist}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 2: הפלייליסטים שלכם (Exact title from Image 3) */}
                {homeFilter !== 'music' && playlists.length > 0 && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-extrabold text-[22px] text-white tracking-tight">הפלייליסטים שלכם</h2>
                      <span
                        onClick={() => setCurrentView('library')}
                        className="hidden sm:inline text-xs font-bold text-[#b3b3b3] hover:underline cursor-pointer"
                      >
                        הצגת כל האפשרויות
                      </span>
                    </div>
                    <div className="flex overflow-x-auto gap-4 no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                      {playlists.map((pl) => (
                        <div
                          key={pl.id}
                          onClick={() => {
                            setSelectedPlaylistId(pl.id);
                            setCurrentView('playlist');
                          }}
                          className="w-[152px] sm:w-[172px] flex-shrink-0 sm:p-2.5 sm:rounded-md sm:hover:bg-[#181818] flex flex-col gap-1.5 group cursor-pointer transition-colors"
                        >
                          <div className="relative aspect-square w-full rounded-[6px] overflow-hidden bg-[#282828] shadow-md">
                            <PlaylistThumb playlist={pl} className="w-full h-full" />
                            <button className="hidden sm:flex absolute bottom-2 right-2 w-11 h-11 rounded-full bg-spotify-green text-black items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-105">
                              <Play className="w-5 h-5 fill-black text-black translate-x-0.5" />
                            </button>
                          </div>
                          <div className="flex flex-col min-w-0 text-right mt-0.5">
                            <span className="text-[11px] text-[#b3b3b3]">פלייליסט</span>
                            <span className="font-bold text-[13px] truncate text-white">{pl.title}</span>
                            <span className="text-xs text-[#b3b3b3] truncate">{pl.tracks?.length || 0} שירים</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 3: תחנות מומלצות ולהיטים חמים (Matches Image 1) */}
                {homeFilter !== 'playlists' && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-[#b3b3b3] mb-0.5">מוזיקה ללא הפסקה על סמך האמנים והשירים האהובים עליכם.</p>
                        <h2 className="font-extrabold text-[22px] text-white tracking-tight">תחנות מומלצות ולהיטים</h2>
                      </div>
                    </div>

                    {isTrendingLoading ? (
                      <div className="flex items-center justify-center p-12 text-[#b3b3b3] gap-3">
                        <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                        <span className="text-sm">טוען שירים...</span>
                      </div>
                    ) : (
                      <div className="flex overflow-x-auto sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                        {trendingTracks.map((track, idx) => {
                          const active = isSameTrack(player.currentTrack, track);
                          return (
                            <div
                              key={track.id || idx}
                              onClick={() => handlePlayTrack(track, trendingTracks, idx)}
                              onMouseEnter={() => prefetchNextTracks([track])}
                              className="w-[152px] sm:w-auto flex-shrink-0 sm:p-2.5 rounded-md sm:hover:bg-[#181818] flex flex-col gap-1.5 group cursor-pointer transition-all duration-200"
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
                              <div className="flex flex-col min-w-0 text-right mt-0.5">
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
                  <div className="flex flex-col gap-3 mt-1">
                    <h2 className="font-bold text-base text-white">עיון בהכל</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {BROWSE_CATEGORIES.map((cat, idx) => (
                        <div
                          key={idx}
                          onClick={() => setSearchQuery(cat.query)}
                          className={`${cat.color} h-24 sm:h-28 rounded-[8px] p-3.5 relative overflow-hidden cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-md`}
                        >
                          <span className="font-extrabold text-base text-white leading-snug block max-w-[75%] text-right">
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
                <div className="flex items-center justify-between gap-2 pb-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCreatePlaylist(`פלייליסט מס׳ ${playlists.length + 1} שלי`)}
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
                  <div className="flex flex-col gap-1">
                    {/* Pinned: שירים שאהבתם */}
                    <div
                      onClick={() => setCurrentView('liked')}
                      className="flex items-center gap-3.5 p-2 rounded-md hover:bg-[#1f1f1f] active:bg-[#1f1f1f] cursor-pointer transition-colors"
                    >
                      <div className="w-16 h-16 rounded-[4px] bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center text-white flex-shrink-0 shadow">
                        <Heart className="w-7 h-7 fill-white" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1 text-right">
                        <span className="text-base font-semibold text-white truncate">שירים שאהבתם</span>
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

                    {/* Playlists with 2x2 Collages */}
                    {playlists.map((pl) => (
                      <div
                        key={pl.id}
                        onClick={() => {
                          setSelectedPlaylistId(pl.id);
                          setCurrentView('playlist');
                        }}
                        className="flex items-center gap-3.5 p-2 rounded-md hover:bg-[#1f1f1f] active:bg-[#1f1f1f] cursor-pointer transition-colors"
                      >
                        <PlaylistThumb playlist={pl} className="w-16 h-16 rounded-[4px] shadow" />
                        <div className="flex flex-col min-w-0 flex-1 text-right">
                          <span className="text-base font-semibold text-white truncate">{pl.title}</span>
                          <span className="text-[13px] text-[#b3b3b3] truncate mt-0.5">
                            {pl.type === 'album' ? 'אלבום' : 'פלייליסט'} • {pl.tracks?.length || 0} שירים
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    <div
                      onClick={() => setCurrentView('liked')}
                      className="flex flex-col gap-2 cursor-pointer group"
                    >
                      <div className="aspect-square rounded-[6px] bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center shadow-lg">
                        <Heart className="w-14 h-14 fill-white text-white" />
                      </div>
                      <span className="font-bold text-sm text-white truncate">שירים שאהבתם</span>
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
                        <PlaylistThumb playlist={pl} className="aspect-square w-full rounded-[6px] shadow-lg" />
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
                  title: 'שירים שאהבתם',
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

        {/* ==================== Column 3 (Left in RTL): DESKTOP NOW PLAYING + LYRICS PREVIEW PANEL (Exact Match to Image 1) ==================== */}
        {showNowPlayingPanel && player.currentTrack && (
          <aside className="hidden xl:flex flex-col w-[300px] 2xl:w-[340px] flex-shrink-0 bg-[#121212] rounded-lg overflow-y-auto no-scrollbar p-4 gap-4 select-none">
            {/* Panel Header: Current Playlist / Source Name */}
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white truncate">
                {activePlaylist?.title || player.currentTrack.album || 'שירים שאהבתם'}
              </span>
              <button
                onClick={() => setShowNowPlayingPanel(false)}
                className="p-1 text-[#b3b3b3] hover:text-white rounded-full"
                title="סגור פאנל"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Large Square Track Cover */}
            <div
              onClick={() => setIsFullscreenPlayerOpen(true)}
              className="aspect-square w-full rounded-[8px] overflow-hidden bg-[#282828] shadow-xl cursor-pointer"
            >
              {player.currentTrack.thumbnail ? (
                <img src={player.currentTrack.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#b3b3b3]">
                  <Music2 className="w-16 h-16" />
                </div>
              )}
            </div>

            {/* Song Title & Artist on Right + Green Checkmark on Left (Exact Match to Image 1) */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col min-w-0 flex-1 text-right">
                <span className="text-xl font-extrabold text-white truncate hover:underline cursor-pointer">
                  {player.currentTrack.title}
                </span>
                <span className="text-sm text-[#b3b3b3] truncate mt-0.5">
                  {player.currentTrack.artist}
                </span>
              </div>

              <button
                onClick={() => handleToggleLike(player.currentTrack)}
                className="flex-shrink-0 transition-transform active:scale-125"
                title={isCurrentLiked ? 'הסר משירים שאהבתם' : 'הוסף לשירים שאהבתם'}
              >
                {isCurrentLiked ? (
                  <span className="w-6 h-6 rounded-full bg-spotify-green text-black flex items-center justify-center shadow">
                    <Check className="w-3.5 h-3.5 stroke-[3.5]" />
                  </span>
                ) : (
                  <PlusCircle className="w-6 h-6 text-[#b3b3b3] hover:text-white" />
                )}
              </button>
            </div>

            {/* Purple Live Lyrics Preview Card ("תצוגה מקדימה של מילות השיר" — Exact Match to Image 1!) */}
            <div
              onClick={() => setIsLyricsOpen(true)}
              className="w-full rounded-xl bg-gradient-to-b from-[#6b1169] to-[#4a0c48] p-4 flex flex-col gap-2.5 cursor-pointer hover:brightness-110 transition-all shadow-lg"
            >
              <span className="text-xs font-bold text-white/90 text-right">
                תצוגה מקדימה של מילות השיר
              </span>
              {previewLyricsLines && previewLyricsLines.length > 0 ? (
                <div className="flex flex-col gap-1.5 text-right py-1">
                  {previewLyricsLines.map((line, i) => (
                    <p
                      key={i}
                      className={`font-extrabold leading-snug transition-colors ${
                        line.isCurrent ? 'text-white text-lg' : 'text-white/50 text-base'
                      }`}
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 text-right py-2">
                  <p className="text-white font-extrabold text-base">{player.currentTrack.title}</p>
                  <p className="text-white/65 font-bold text-sm">לחץ לצפייה במילות השיר המלאות</p>
                </div>
              )}
            </div>

            {/* Next in Queue / Related Card */}
            {player.queue && player.queue.length > 1 && (
              <div className="w-full rounded-xl bg-[#1f1f1f] p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-white">הבא בתור</span>
                  <span className="text-[#b3b3b3]">{player.currentTrack.artist}</span>
                </div>
                {player.queue
                  .slice(player.queueIndex + 1, player.queueIndex + 3)
                  .map((nextT, idx) => (
                    <div
                      key={nextT.id || idx}
                      onClick={() => handlePlayTrack(nextT)}
                      className="flex items-center gap-2.5 p-1.5 rounded-md hover:bg-white/10 cursor-pointer transition-colors"
                    >
                      <div className="w-10 h-10 rounded-[4px] bg-[#282828] overflow-hidden flex-shrink-0">
                        {nextT.thumbnail ? (
                          <img src={nextT.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Music2 className="w-4 h-4 m-3 text-[#b3b3b3]" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1 text-right">
                        <span className="text-xs font-bold text-white truncate">{nextT.title}</span>
                        <span className="text-[11px] text-[#b3b3b3] truncate">{nextT.artist}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </aside>
        )}
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
        isLiked={isCurrentLiked}
        onToggleLike={handleToggleLike}
        onOpenLyrics={() => setIsLyricsOpen(true)}
        onOpenFullscreen={() => setIsFullscreenPlayerOpen(true)}
        showNowPlayingPanel={showNowPlayingPanel}
        onToggleNowPlayingPanel={() => setShowNowPlayingPanel(prev => !prev)}
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
        isLiked={isCurrentLiked}
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
          isLiked={isCurrentLiked}
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
