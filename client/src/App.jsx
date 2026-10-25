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
  Users,
  ListPlus
} from 'lucide-react';

import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useMediaSession } from './hooks/useMediaSession';
import { searchTracks, getTrendingTracks, getHomeCatalog, getLyrics, downloadTrackAudioBlob, prefetchNextTracks, resolveTrack } from './services/api';
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
import {
  saveTrackOffline,
  getAllOfflineTracks,
  getOfflineTrack,
  saveOfflineTrackLyrics,
  buildDownloadedIdSet,
  isTrackInIdSet,
  getTrackNormKey
} from './services/offlineStorage';

import { Sidebar, PlaylistThumb } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { PlayerBar } from './components/PlayerBar';
import { FullscreenPlayer } from './components/FullscreenPlayer';
import { SyncedLyrics } from './components/SyncedLyrics';
import { ImportModal } from './components/ImportModal';
import { QueueModal } from './components/QueueModal';
import { AddToPlaylistModal } from './components/AddToPlaylistModal';
import { TrackRow } from './components/TrackRow';
import { PlaylistView } from './components/PlaylistView';
import { AnalyticsView } from './components/AnalyticsView';
import { OfflineView } from './components/OfflineView';
import { ServerSettingsModal } from './components/ServerSettingsModal';
import { isNativeApp } from './services/nativeAudio';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

const BROWSE_CATEGORIES = [
  { title: 'להיטים ישראליים', query: 'להיטים ישראליים עומר אדם נועה קירל פאר טסי', color: 'bg-[#e13300]' },
  { title: 'פופ עולמי', query: 'Top Pop Hits The Weeknd Dua Lipa Bruno Mars', color: 'bg-[#7358ff]' },
  { title: 'ים-תיכוני ומזרחית', query: 'מזרחית ים תיכוני אייל גולן עדן בן זקן משה פרץ', color: 'bg-[#1e3264]' },
  { title: 'היפ-הופ וראפ ישראלי', query: 'היפ הופ ישראלי טונה רביד פלוטניק יסמין מועלם', color: 'bg-[#bc5900]' },
  { title: 'קלאסיקות פסטיגל', query: 'פסטיגל שירים רשמיים מרגי נועה קירל אליאנה תדהר', color: 'bg-[#d84000]' },
  { title: 'מסיבה ודאנס', query: 'Party Dance Hits Electronic Club Mix', color: 'bg-[#e8115b]' },
  { title: 'אימונים וכושר', query: 'Workout Gym Motivation High Energy Hits', color: 'bg-[#148a08]' },
  { title: 'רוק ישראלי', query: 'רוק ישראלי משינה היהודים מוניקה סקס אביב גפן', color: 'bg-[#b02897]' },
  { title: 'שירים שקטים ורגועים', query: 'שירים שקטים בעברית עידן רייכל חנן בן ארי אקוסטי', color: 'bg-[#0d73ec]' },
  { title: 'נוסטלגיה ישראלית', query: 'קלאסיקות ישראליות אריק איינשטיין שלמה ארצי כוורת', color: 'bg-[#8d67ab]' },
  { title: 'להיטי שנות ה-2000', query: 'Throwback 2000s Hits Pop R&B Classics', color: 'bg-[#503750]' },
  { title: 'להיטי ויראלי וטיקטוק', query: 'TikTok Viral Hits Trending Songs', color: 'bg-[#dc148c]' },
  { title: 'היפ-הופ וראפ עולמי', query: 'Hip Hop Rap Drake Travis Scott Kendrick Lamar', color: 'bg-[#ba5d07]' },
  { title: 'רוק קלאסי ואגדות', query: 'Classic Rock Queen Led Zeppelin Nirvana Oasis', color: 'bg-[#e91429]' },
  { title: 'לטיני ורגאטון', query: 'Reggaeton Latin Hits Bad Bunny Karol G', color: 'bg-[#e1118c]' },
  { title: 'אלקטרוני וטכנו', query: 'Electronic House Melodic Techno Calvin Harris Fred again', color: 'bg-[#006450]' },
  { title: 'R&B וסול', query: 'R&B Soul SZA Frank Ocean Chris Brown Rihanna', color: 'bg-[#27856a]' },
  { title: 'מזרחית של פעם', query: 'מזרחית נוסטלגיה זוהר ארגוב חיים משה שרית חדד', color: 'bg-[#477d95]' },
  { title: 'נסיעה ליליות', query: 'Night Drive Synthwave Chill Pop Hits', color: 'bg-[#1e3264]' },
  { title: 'קיץ וחוף הים', query: 'Summer Beach Vibes Hits פופ קיץ ישראלי', color: 'bg-[#f59b23]' }
];

export default function App() {
  const player = useAudioPlayer();

  useEffect(() => {
    if (!isNativeApp) return;
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

  // Trending tracks & multi-shelf catalog for Home view
  const [trendingTracks, setTrendingTracks] = useState([]);
  const [catalogSections, setCatalogSections] = useState([]);
  const [showAllTrending, setShowAllTrending] = useState(false);
  const [isTrendingLoading, setIsTrendingLoading] = useState(false);

  // Modals & Panels
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isFullscreenPlayerOpen, setIsFullscreenPlayerOpen] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [lyricsData, setLyricsData] = useState({ synced: [], plain: [], hasSynced: false });
  const [trackForAddToPlaylist, setTrackForAddToPlaylist] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [isNetworkOffline, setIsNetworkOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const toastTimeoutRef = useRef(null);

  useEffect(() => {
    const handleOnline = () => setIsNetworkOffline(false);
    const handleOffline = () => setIsNetworkOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2800);
  }, []);

  useEffect(() => {
    if (player.playbackError) {
      showToast(player.playbackError);
      player.clearPlaybackError();
    }
  }, [player.playbackError, player.clearPlaybackError, showToast]);

  const handleLibraryRestored = useCallback(() => {
    setPlaylists(getPlaylists());
    setLikedSongs(getLikedSongs());
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

  // Offline Downloads state & Smart Concurrency-Limited Queue (Max 2 parallel downloads)
  const [downloadedIds, setDownloadedIds] = useState(new Set());
  const [downloadedTracksCount, setDownloadedTracksCount] = useState(0);
  const [downloadingIds, setDownloadingIds] = useState(new Set());
  const [queuedDownloadIds, setQueuedDownloadIds] = useState(new Set());
  const [activeDownloadTracks, setActiveDownloadTracks] = useState([]);
  const [downloadProgress, setDownloadProgress] = useState({});

  const downloadQueueRef = useRef([]);
  const activeWorkersRef = useRef(0);
  const downloadedIdsRef = useRef(new Set());
  const downloadingIdsRef = useRef(new Set());
  const queuedIdsRef = useRef(new Set());

  const getTrackKeys = (t) => [t?.id, t?.streamableId, t?.originalId, getTrackNormKey(t)].filter(Boolean);

  const refreshDownloads = useCallback(async () => {
    try {
      const tracks = await getAllOfflineTracks();
      const idSet = buildDownloadedIdSet(tracks);
      downloadedIdsRef.current = idSet;
      setDownloadedIds(idSet);
      setDownloadedTracksCount(tracks.length);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refreshDownloads();
  }, [refreshDownloads]);

  const processDownloadQueue = useCallback(() => {
    const MAX_CONCURRENT = 2;

    while (activeWorkersRef.current < MAX_CONCURRENT && downloadQueueRef.current.length > 0) {
      const nextTrack = downloadQueueRef.current.shift();
      if (!nextTrack) continue;

      const initialKeys = getTrackKeys(nextTrack);
      initialKeys.forEach(k => queuedIdsRef.current.delete(k));
      setQueuedDownloadIds(new Set(queuedIdsRef.current));

      if (isTrackInIdSet(nextTrack, downloadedIdsRef.current) || isTrackInIdSet(nextTrack, downloadingIdsRef.current)) {
        continue;
      }

      activeWorkersRef.current += 1;
      initialKeys.forEach(k => downloadingIdsRef.current.add(k));
      setDownloadingIds(new Set(downloadingIdsRef.current));
      setActiveDownloadTracks(prev => [...prev.filter(x => x.id !== nextTrack.id), nextTrack]);

      const updateProgressForKeys = (keys, pct) => {
        setDownloadProgress(prev => {
          const next = { ...prev };
          keys.forEach(k => { next[k] = pct; });
          return next;
        });
      };

      updateProgressForKeys(initialKeys, 3);

      (async () => {
        let targetTrack = { ...nextTrack };
        let allKeys = [...initialKeys];

        try {
          // Download audio directly without blocking on YouTube resolution or lyrics!
          // /api/offline/download/:id natively resolves SoundCloud studio audio from title + artist in ~400ms
          const blob = await downloadTrackAudioBlob(targetTrack, (pct) => {
            updateProgressForKeys(allKeys, pct);
          });

          await saveTrackOffline(targetTrack, blob, null);

          allKeys.forEach(k => downloadedIdsRef.current.add(k));
          setDownloadedIds(new Set(downloadedIdsRef.current));
          setDownloadedTracksCount(prev => prev + 1);

          // Asynchronously enrich offline lyrics in the background without blocking the download queue
          getLyrics(targetTrack.title, targetTrack.artist, targetTrack.durationSeconds)
            .then(fetchedLyrics => {
              if (fetchedLyrics && (fetchedLyrics.hasSynced || (fetchedLyrics.plain && fetchedLyrics.plain.length > 0))) {
                saveOfflineTrackLyrics(targetTrack, fetchedLyrics).catch(() => {});
              }
            })
            .catch(() => {});

          if (downloadQueueRef.current.length === 0 && activeWorkersRef.current <= 1) {
            showToast(`✓ "${targetTrack.title}" נשמר להאזנה אופליין`);
          }
        } catch (err) {
          console.error('Download failed:', err);
          showToast(`⚠️ הורדת "${targetTrack.title}" נכשלה, נסה שוב`);
        } finally {
          allKeys.forEach(k => downloadingIdsRef.current.delete(k));
          setDownloadingIds(new Set(downloadingIdsRef.current));
          setActiveDownloadTracks(prev => prev.filter(x => x.id !== nextTrack.id && x.id !== targetTrack.id));
          setDownloadProgress(prev => {
            const next = { ...prev };
            allKeys.forEach(k => { delete next[k]; });
            return next;
          });
          activeWorkersRef.current = Math.max(0, activeWorkersRef.current - 1);
          setTimeout(() => processDownloadQueue(), 200);
        }
      })();
    }
  }, [showToast]);

  const handleDownloadTrack = useCallback((track) => {
    if (!track) return;
    if (
      isTrackInIdSet(track, downloadedIdsRef.current) ||
      isTrackInIdSet(track, downloadingIdsRef.current) ||
      isTrackInIdSet(track, queuedIdsRef.current)
    ) {
      return;
    }

    const keys = getTrackKeys(track);
    keys.forEach(k => queuedIdsRef.current.add(k));
    setQueuedDownloadIds(new Set(queuedIdsRef.current));
    downloadQueueRef.current.push(track);
    showToast(`⬇️ מוריד את "${track.title}" לאופליין...`);
    processDownloadQueue();
  }, [processDownloadQueue, showToast]);

  const handleDownloadBatch = useCallback((tracksList) => {
    if (!Array.isArray(tracksList) || tracksList.length === 0) return;
    const toQueue = tracksList.filter(
      t =>
        t &&
        !isTrackInIdSet(t, downloadedIdsRef.current) &&
        !isTrackInIdSet(t, downloadingIdsRef.current) &&
        !isTrackInIdSet(t, queuedIdsRef.current)
    );
    if (toQueue.length === 0) {
      showToast('✓ כל השירים כבר שמורים אופליין');
      return;
    }

    toQueue.forEach(t => {
      getTrackKeys(t).forEach(k => queuedIdsRef.current.add(k));
      downloadQueueRef.current.push(t);
    });
    setQueuedDownloadIds(new Set(queuedIdsRef.current));
    showToast(`⬇️ מוריד ${toQueue.length} שירים להאזנה אופליין...`);
    processDownloadQueue();
  }, [processDownloadQueue, showToast]);

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
    let retryTimer = null;

    const loadCatalog = (attempt = 1) => {
      setIsTrendingLoading(true);
      getHomeCatalog()
        .then(catalog => {
          if (!isMounted) return;
          const tracks = catalog.tracks || [];
          const sections = catalog.sections || [];
          if (tracks.length > 0) {
            setTrendingTracks(tracks);
            setCatalogSections(sections);
            prefetchNextTracks(tracks.slice(0, 5));
          } else if (attempt < 4) {
            retryTimer = setTimeout(() => loadCatalog(attempt + 1), 2200);
          }
        })
        .catch(err => {
          console.warn('Catalog fetch attempt', attempt, 'failed, retrying...', err);
          if (isMounted && attempt < 4) {
            retryTimer = setTimeout(() => loadCatalog(attempt + 1), 2200);
          }
        })
        .finally(() => {
          if (isMounted) setIsTrendingLoading(false);
        });
    };

    loadCatalog(1);

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  const activePlaylistForEffect = playlists.find(p => p.id === selectedPlaylistId);

  // Proactively prefetch and auto-enrich all playlist tracks in batches when opening a playlist
  useEffect(() => {
    const activePl = playlists.find(p => p.id === selectedPlaylistId);
    if (!activePl || !activePl.tracks || activePl.tracks.length === 0) return;

    prefetchNextTracks(activePl.tracks.slice(0, 4));

    const isAlbumPlaylist = activePl.type?.toLowerCase() === 'album';
    const unverified = activePl.tracks.filter(
      t => t.id?.startsWith('sp_') || !t.studioResolvedV7 || !t.thumbnail || (!isAlbumPlaylist && t.hasCustomArtwork === false) || (!isAlbumPlaylist && t.thumbnail === activePl.cover && !t.hasCustomArtwork)
    );

    if (unverified.length > 0) {
      let cancelled = false;

      (async () => {
        const batchSize = 2;
        for (let i = 0; i < unverified.length; i += batchSize) {
          if (cancelled) break;
          // Pause background playlist resolution while offline downloads are actively running
          while (!cancelled && (activeWorkersRef.current > 0 || downloadQueueRef.current.length > 0)) {
            await new Promise(r => setTimeout(r, 1500));
          }
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
                    artist: res.artist || t.artist,
                    hasCustomArtwork: true,
                    studioResolvedV3: true,
                    studioResolvedV4: true,
                    studioResolvedV5: true,
                    studioResolvedV6: true,
                    studioResolvedV7: true,
                    thumbnail: res.thumbnail || t.thumbnail,
                    durationSeconds: (t.durationSeconds && t.durationSeconds >= 35 && t.durationSeconds <= 420)
                      ? t.durationSeconds
                      : (res.durationSeconds || t.durationSeconds)
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
  }, [selectedPlaylistId, activePlaylistForEffect?.createdAt]);

  useEffect(() => {
    if (currentView === 'liked' && likedSongs.length > 0) {
      prefetchNextTracks(likedSongs.slice(0, 5));
    }
  }, [currentView, likedSongs]);

  useEffect(() => {
    if (!player.currentTrack) return;

    let isMounted = true;
    const track = player.currentTrack;

    (async () => {
      // 1. Check if lyrics are already saved in Offline Storage (IndexedDB) for instant & offline playback
      try {
        const offlineRecord = await getOfflineTrack(track);
        if (
          offlineRecord?.lyrics &&
          (offlineRecord.lyrics.hasSynced || (offlineRecord.lyrics.plain && offlineRecord.lyrics.plain.length > 0))
        ) {
          if (isMounted) setLyricsData(offlineRecord.lyrics);
          return;
        }
      } catch (e) {}

      // 2. Otherwise fetch from backend lyrics API (and cache into IndexedDB if track is downloaded)
      try {
        const data = await getLyrics(track.title, track.artist, track.durationSeconds);
        if (isMounted) setLyricsData(data);
        if (data && (data.hasSynced || (data.plain && data.plain.length > 0))) {
          saveOfflineTrackLyrics(track, data).catch(() => {});
        }
      } catch {
        if (isMounted) setLyricsData({ synced: [], plain: [], hasSynced: false });
      }
    })();

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

  const handleCreatePlaylistFromOffline = (title, initialTracks = []) => {
    const { updated, playlist } = createCustomPlaylist(
      title,
      'נוצר מתוך שירים שהורדו לאופליין',
      initialTracks
    );
    setPlaylists(updated);
    if (playlist) {
      setSelectedPlaylistId(playlist.id);
      setCurrentView('playlist');
      showToast(`✓ הפלייליסט "${playlist.title}" נוצר ממצב אופליין (${initialTracks.length} שירים)`);
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
    <div className="flex flex-col h-screen h-[100dvh] w-screen overflow-hidden bg-black text-white select-none">
      {/* Auto-Offline Detection Banner */}
      {isNetworkOffline && currentView !== 'offline' && (
        <div className="bg-emerald-950/90 border-b border-spotify-green/40 px-4 py-2 flex items-center justify-between text-xs z-50 flex-shrink-0">
          <div className="flex items-center gap-2 text-white font-semibold">
            <ArrowDownCircle className="w-4 h-4 text-spotify-green flex-shrink-0" />
            <span>אין חיבור לאינטרנט כעת • השירים שהורדת זמינים להאזנה מלאה באופליין!</span>
          </div>
          <button
            onClick={() => setCurrentView('offline')}
            className="px-3 py-1 rounded-full bg-spotify-green text-black font-extrabold text-xs hover:scale-105 transition-transform flex-shrink-0"
          >
            עבור לאופליין ({downloadedTracksCount})
          </button>
        </div>
      )}

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
          downloadedCount={downloadedTracksCount}
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
          <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 md:px-6 pt-1 pb-36 md:pb-24">
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
                    <span className="flex-1 text-right font-bold text-[13px] text-white line-clamp-2 pr-0.5 pl-1 leading-tight">
                      שירים שאהבתם
                    </span>
                    {likedSongs.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayTrack(likedSongs[0], likedSongs, 0);
                        }}
                        className="hidden sm:flex w-8 h-8 rounded-full bg-spotify-green text-black items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-105 ml-2 flex-shrink-0"
                        title="נגן"
                      >
                        <Play className="w-4 h-4 fill-black text-black translate-x-0.5" />
                      </button>
                    )}
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
                      <span className="flex-1 text-right font-bold text-[13px] text-white line-clamp-2 pr-0.5 pl-1 leading-tight">
                        {pl.title}
                      </span>
                      {pl.tracks?.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayTrack(pl.tracks[0], pl.tracks, 0);
                          }}
                          className="hidden sm:flex w-8 h-8 rounded-full bg-spotify-green text-black items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-105 ml-2 flex-shrink-0"
                          title="נגן פלייליסט"
                        >
                          <Play className="w-4 h-4 fill-black text-black translate-x-0.5" />
                        </button>
                      )}
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
                        <span className="flex-1 text-right font-bold text-[13px] text-white line-clamp-2 pr-0.5 pl-1 leading-tight">
                          {t.title}
                        </span>
                        <button
                          className="hidden sm:flex w-8 h-8 rounded-full bg-spotify-green text-black items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-105 ml-2 flex-shrink-0"
                          title="נגן"
                        >
                          <Play className="w-4 h-4 fill-black text-black translate-x-0.5" />
                        </button>
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

                {/* Curated Multi-Genre Catalog Shelves (120+ Songs across 6 Shelves) */}
                {homeFilter !== 'playlists' && catalogSections.length > 0 && catalogSections.map((section) => (
                  <section key={section.id} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        {section.subtitle && (
                          <p className="text-xs text-[#b3b3b3] mb-0.5">{section.subtitle}</p>
                        )}
                        <h2 className="font-extrabold text-[20px] sm:text-[22px] text-white tracking-tight">
                          {section.title}
                        </h2>
                      </div>
                      <button
                        onClick={() => {
                          setSearchQuery(section.title.split('—')[0].trim());
                          setCurrentView('search');
                        }}
                        className="text-xs font-bold text-[#b3b3b3] hover:text-white hover:underline cursor-pointer"
                      >
                        הצג הכל ({section.tracks?.length || 0})
                      </button>
                    </div>
                    <div className="flex overflow-x-auto gap-4 no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                      {(section.tracks || []).map((track, idx) => {
                        const active = isSameTrack(player.currentTrack, track);
                        const isSavedOffline = isTrackInIdSet(track, downloadedIds);
                        const isSavingOffline = isTrackInIdSet(track, downloadingIds) || isTrackInIdSet(track, queuedDownloadIds);
                        return (
                          <div
                            key={`${section.id}_${track.id || idx}`}
                            onClick={() => handlePlayTrack(track, section.tracks, idx)}
                            onMouseEnter={() => prefetchNextTracks([track])}
                            className="w-[152px] sm:w-[172px] flex-shrink-0 sm:p-2.5 rounded-md sm:hover:bg-[#181818] flex flex-col gap-1.5 group cursor-pointer transition-all duration-200"
                          >
                            <div className="relative aspect-square w-full rounded-[6px] overflow-hidden bg-[#282828] shadow-md">
                              {track.thumbnail ? (
                                <img src={track.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
                              ) : (
                                <Music2 className="w-10 h-10 m-auto text-[#b3b3b3]" />
                              )}
                              <div className=" absolute top-2 left-2 flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadTrack(track);
                                  }}
                                  title={isSavedOffline ? 'שמור אופליין ✓' : 'הורד להאזנה אופליין'}
                                  className={`w-7 h-7 rounded-full bg-black/65 backdrop-blur-sm flex items-center justify-center transition-opacity ${
                                    isSavedOffline || isSavingOffline
                                      ? 'opacity-100'
                                      : 'opacity-85 sm:opacity-0 sm:group-hover:opacity-100'
                                  }`}
                                >
                                  {isSavingOffline ? (
                                    <Loader2 className="w-3.5 h-3.5 text-spotify-green animate-spin" />
                                  ) : isSavedOffline ? (
                                    <ArrowDownCircle className="w-4 h-4 fill-spotify-green text-black" />
                                  ) : (
                                    <ArrowDownCircle className="w-4 h-4 text-white hover:text-spotify-green" />
                                  )}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenAddToPlaylist(track);
                                  }}
                                  title="הוסף לפלייליסט או צור פלייליסט"
                                  className="w-7 h-7 rounded-full bg-black/65 backdrop-blur-sm flex items-center justify-center text-white hover:text-spotify-green opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                >
                                  <ListPlus className="w-3.5 h-3.5" />
                                </button>
                              </div>
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
                  </section>
                ))}

                {/* Section 3: תחנות מומלצות ולהיטים חמים (Matches Image 1) */}
                {homeFilter !== 'playlists' && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-[#b3b3b3] mb-0.5">מוזיקה ללא הפסקה על סמך האמנים והשירים האהובים עליכם.</p>
                        <h2 className="font-extrabold text-[22px] text-white tracking-tight">
                          מאגר שירים ולהיטים מומלצים ({trendingTracks.length})
                        </h2>
                      </div>
                      {trendingTracks.length > 20 && (
                        <button
                          onClick={() => setShowAllTrending(prev => !prev)}
                          className="text-xs font-bold text-spotify-green hover:underline"
                        >
                          {showAllTrending ? 'הצג פחות' : `הצג את כל ${trendingTracks.length} השירים`}
                        </button>
                      )}
                    </div>

                    {isTrendingLoading ? (
                      <div className="flex items-center justify-center p-12 text-[#b3b3b3] gap-3">
                        <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                        <span className="text-sm">טוען מאגר שירים עשיר...</span>
                      </div>
                    ) : (
                      <div className="flex overflow-x-auto sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                        {(showAllTrending ? trendingTracks : trendingTracks.slice(0, 25)).map((track, idx) => {
                          const active = isSameTrack(player.currentTrack, track);
                          const isSavedOffline = isTrackInIdSet(track, downloadedIds);
                          const isSavingOffline = isTrackInIdSet(track, downloadingIds) || isTrackInIdSet(track, queuedDownloadIds);
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
                                <div className="absolute top-2 left-2 flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownloadTrack(track);
                                    }}
                                    title={isSavedOffline ? 'שמור אופליין ✓' : 'הורד להאזנה אופליין'}
                                    className={`w-7 h-7 rounded-full bg-black/65 backdrop-blur-sm flex items-center justify-center transition-opacity ${
                                      isSavedOffline || isSavingOffline
                                        ? 'opacity-100'
                                        : 'opacity-85 sm:opacity-0 sm:group-hover:opacity-100'
                                    }`}
                                  >
                                    {isSavingOffline ? (
                                      <Loader2 className="w-3.5 h-3.5 text-spotify-green animate-spin" />
                                    ) : isSavedOffline ? (
                                      <ArrowDownCircle className="w-4 h-4 fill-spotify-green text-black" />
                                    ) : (
                                      <ArrowDownCircle className="w-4 h-4 text-white hover:text-spotify-green" />
                                    )}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenAddToPlaylist(track);
                                    }}
                                    title="הוסף לפלייליסט או צור פלייליסט"
                                    className="w-7 h-7 rounded-full bg-black/65 backdrop-blur-sm flex items-center justify-center text-white hover:text-spotify-green opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                  >
                                    <ListPlus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
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
                    <span className="text-sm">מחפש במאגר המורחב (YouTube, Deezer, iTunes)...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-xs font-bold text-[#b3b3b3]">
                        נמצאו {searchResults.length} תוצאות במאגר
                      </span>
                      <button
                        onClick={() => handlePlayTrack(searchResults[0], searchResults, 0)}
                        className="text-xs font-bold text-spotify-green hover:underline flex items-center gap-1"
                      >
                        <Play className="w-3.5 h-3.5 fill-spotify-green" />
                        <span>נגן את כל התוצאות</span>
                      </button>
                    </div>
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
                          isDownloaded={isTrackInIdSet(track, downloadedIds)}
                          isDownloading={isTrackInIdSet(track, downloadingIds)}
                          isQueuedDownload={isTrackInIdSet(track, queuedDownloadIds)}
                          downloadProgress={
                            downloadProgress[track.id] ||
                            downloadProgress[track.streamableId] ||
                            downloadProgress[track.originalId] ||
                            0
                          }
                          onDownload={handleDownloadTrack}
                          onOpenAddToPlaylist={handleOpenAddToPlaylist}
                        />
                      ))}
                    </div>
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
                          שמורים במכשיר • {downloadedTracksCount} שירים
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
                queuedDownloadIds={queuedDownloadIds}
                downloadProgress={downloadProgress}
                onDownloadTrack={handleDownloadTrack}
                onDownloadBatch={handleDownloadBatch}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
                onPlayShuffled={handlePlayShuffled}
                onReorderTracks={handleReorderLiked}
                onBack={() => setCurrentView('home')}
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
                queuedDownloadIds={queuedDownloadIds}
                downloadProgress={downloadProgress}
                onDownloadTrack={handleDownloadTrack}
                onDownloadBatch={handleDownloadBatch}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
                onPlayShuffled={handlePlayShuffled}
                onReorderTracks={(newTracks) => handleReorderPlaylist(activePlaylist.id, newTracks)}
                onRenamePlaylist={(newTitle) => handleRenamePlaylist(activePlaylist.id, newTitle)}
                onBack={() => setCurrentView('home')}
              />
            )}

            {/* ==================== VIEW: OFFLINE DOWNLOADS ==================== */}
            {currentView === 'offline' && (
              <OfflineView
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                onPlayTrack={handlePlayTrack}
                onTogglePlay={player.togglePlay}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                onTrackDeleted={refreshDownloads}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
                onPlayShuffled={handlePlayShuffled}
                downloadedCount={downloadedTracksCount}
                downloadedIds={downloadedIds}
                activeDownloads={activeDownloadTracks}
                queuedDownloadsCount={downloadQueueRef.current.length}
                downloadProgress={downloadProgress}
                playlists={playlists}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                onCreatePlaylistFromOffline={handleCreatePlaylistFromOffline}
                onSelectPlaylist={(id) => {
                  setSelectedPlaylistId(id);
                  setCurrentView('playlist');
                }}
                onBack={() => setCurrentView('home')}
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

            {/* Song Title & Artist on Right + Offline & Playlist & Like Actions on Left */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col min-w-0 flex-1 text-right">
                <span className="text-xl font-extrabold text-white truncate hover:underline cursor-pointer">
                  {player.currentTrack.title}
                </span>
                <span className="text-sm text-[#b3b3b3] truncate mt-0.5">
                  {player.currentTrack.artist}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleDownloadTrack(player.currentTrack)}
                  className="p-1 text-[#b3b3b3] hover:text-spotify-green transition-transform active:scale-95"
                  title={isTrackInIdSet(player.currentTrack, downloadedIds) ? 'שמור באופליין ✓' : 'הורד לאופליין'}
                >
                  {isTrackInIdSet(player.currentTrack, downloadingIds) || isTrackInIdSet(player.currentTrack, queuedDownloadIds) ? (
                    <Loader2 className="w-5 h-5 text-spotify-green animate-spin" />
                  ) : isTrackInIdSet(player.currentTrack, downloadedIds) ? (
                    <ArrowDownCircle className="w-5 h-5 fill-spotify-green text-black" />
                  ) : (
                    <ArrowDownCircle className="w-5 h-5" />
                  )}
                </button>

                <button
                  onClick={() => handleOpenAddToPlaylist(player.currentTrack)}
                  className="p-1 text-[#b3b3b3] hover:text-spotify-green transition-transform active:scale-95"
                  title="הוסף לפלייליסט"
                >
                  <ListPlus className="w-5 h-5" />
                </button>

                <button
                  onClick={() => handleToggleLike(player.currentTrack)}
                  className="transition-transform active:scale-125"
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

      {/* Bottom Area: Fixed on mobile above Android nav bar, in-flow on desktop */}
      <div className="md:contents fixed bottom-0 inset-x-0 z-40 flex flex-col pointer-events-none pb-[env(safe-area-inset-bottom)]">
        <div className="pointer-events-auto w-full">
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
            isDownloaded={isTrackInIdSet(player.currentTrack, downloadedIds)}
            isDownloading={
              isTrackInIdSet(player.currentTrack, downloadingIds) ||
              isTrackInIdSet(player.currentTrack, queuedDownloadIds)
            }
            onDownloadTrack={handleDownloadTrack}
            onOpenAddToPlaylist={handleOpenAddToPlaylist}
            onOpenLyrics={() => setIsLyricsOpen(true)}
            onOpenFullscreen={() => setIsFullscreenPlayerOpen(true)}
            onOpenQueue={() => setIsQueueOpen(true)}
            showNowPlayingPanel={showNowPlayingPanel}
            onToggleNowPlayingPanel={() => setShowNowPlayingPanel(prev => !prev)}
          />
        </div>

        <div className="pointer-events-auto w-full">
          <MobileNav
            currentView={currentView}
            setCurrentView={setCurrentView}
            openImportModal={() => setIsImportModalOpen(true)}
            setSelectedPlaylistId={setSelectedPlaylistId}
          />
        </div>
      </div>

      {/* Fullscreen Player */}
      <FullscreenPlayer
        isOpen={isFullscreenPlayerOpen}
        onClose={() => setIsFullscreenPlayerOpen(false)}
        currentTrack={player.currentTrack}
        volume={player.volume}
        isMuted={player.isMuted}
        onVolumeChange={player.setVolume}
        onToggleMute={player.toggleMute}
        onOpenQueue={() => setIsQueueOpen(true)}
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
        isDownloaded={isTrackInIdSet(player.currentTrack, downloadedIds)}
        isDownloading={
          isTrackInIdSet(player.currentTrack, downloadingIds) ||
          isTrackInIdSet(player.currentTrack, queuedDownloadIds)
        }
        onDownloadTrack={handleDownloadTrack}
        onOpenAddToPlaylist={handleOpenAddToPlaylist}
        onOpenLyrics={() => {
          setIsFullscreenPlayerOpen(false);
          setIsLyricsOpen(true);
        }}
        previewLyricsLines={previewLyricsLines}
        queue={player.queue}
        queueIndex={player.queueIndex}
        onPlayTrack={handlePlayTrack}
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

      {/* Playlist Importer & Backup Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onPlaylistImported={handlePlaylistImported}
        onLibraryRestored={handleLibraryRestored}
        showToast={showToast}
      />

      {/* Queue Modal */}
      <QueueModal
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        currentTrack={player.currentTrack}
        queue={player.queue}
        queueIndex={player.queueIndex}
        isPlaying={player.isPlaying}
        onPlayTrack={handlePlayTrack}
        onRemoveFromQueue={player.removeFromQueue}
        onMoveInQueue={player.moveInQueue}
        onClearQueue={player.clearQueue}
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

      {/* Floating Live Offline Download Progress Pill */}
      {(activeDownloadTracks.length > 0 || queuedDownloadIds.size > 0) && currentView !== 'offline' && (
        <div
          onClick={() => setCurrentView('offline')}
          className="fixed bottom-32 md:bottom-24 right-4 z-[90] bg-[#182820]/95 backdrop-blur-md border border-spotify-green/40 rounded-xl px-3.5 py-2.5 shadow-2xl cursor-pointer hover:bg-[#1e3329] transition-all flex flex-col gap-1.5 w-64 sm:w-72"
        >
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-spotify-green font-bold truncate">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <span className="truncate">
                {activeDownloadTracks[0] ? `מוריד: ${activeDownloadTracks[0].title}` : 'מכין הורדה לאופליין...'}
              </span>
            </div>
            <span className="text-[11px] font-mono font-bold text-spotify-green flex-shrink-0 mr-1">
              {activeDownloadTracks[0]
                ? `${
                    downloadProgress[activeDownloadTracks[0].id] ||
                    downloadProgress[activeDownloadTracks[0].streamableId] ||
                    downloadProgress[activeDownloadTracks[0].originalId] ||
                    5
                  }%`
                : ''}
            </span>
          </div>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-spotify-green transition-all duration-200 rounded-full"
              style={{
                width: `${
                  activeDownloadTracks[0]
                    ? downloadProgress[activeDownloadTracks[0].id] ||
                      downloadProgress[activeDownloadTracks[0].streamableId] ||
                      downloadProgress[activeDownloadTracks[0].originalId] ||
                      5
                    : 5
                }%`
              }}
            />
          </div>
          {downloadQueueRef.current.length > 0 && (
            <span className="text-[10px] text-[#b3b3b3] text-right">
              עוד {downloadQueueRef.current.length} שירים ממתינים בתור להורדה • לחץ לצפייה
            </span>
          )}
        </div>
      )}

      {/* Spotify Bottom Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-36 md:bottom-24 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-[6px] bg-white text-black font-semibold text-xs shadow-2xl flex items-center gap-2 animate-fadeIn pointer-events-none">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
