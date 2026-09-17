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
  Volume2
} from 'lucide-react';

import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useMediaSession } from './hooks/useMediaSession';
import { searchTracks, getTrendingTracks, getLyrics } from './services/api';
import {
  getLikedSongs,
  toggleLikeSong,
  getPlaylists,
  savePlaylist,
  deletePlaylist,
  getRecentTracks
} from './services/storage';

import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { PlayerBar } from './components/PlayerBar';
import { FullscreenPlayer } from './components/FullscreenPlayer';
import { SyncedLyrics } from './components/SyncedLyrics';
import { ImportModal } from './components/ImportModal';
import { TrackRow } from './components/TrackRow';
import { PlaylistView } from './components/PlaylistView';

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

  // Load trending tracks on mount
  useEffect(() => {
    let isMounted = true;
    setIsTrendingLoading(true);
    getTrendingTracks()
      .then(tracks => {
        if (isMounted) setTrendingTracks(tracks);
      })
      .catch(err => console.error('Failed to load trending:', err))
      .finally(() => {
        if (isMounted) setIsTrendingLoading(false);
      });

    return () => { isMounted = false; };
  }, []);

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

  // Handle Search input
  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const results = await searchTracks(searchQuery.trim());
      setSearchResults(results);
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

  // Play track helper (updates recent tracks)
  const handlePlayTrack = (track, queueList = null, index = -1) => {
    player.playTrack(track, queueList, index);
    setTimeout(() => {
      setRecentTracks(getRecentTracks());
    }, 500);
  };

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
                        onPlay={(t) => handlePlayTrack(t, searchResults, idx)}
                        isLiked={likedSongs.some(s => s.id === track.id || (s.title === track.title && s.artist === track.artist))}
                        onToggleLike={handleToggleLike}
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
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
              />
            )}

            {/* VIEW: SPECIFIC PLAYLIST */}
            {currentView === 'playlist' && activePlaylist && (
              <PlaylistView
                playlist={activePlaylist}
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                onDeletePlaylist={handleDeletePlaylist}
              />
            )}
          </div>
        </main>
      </div>

      {/* Fixed Bottom Controls & Navigation */}
      <PlayerBar
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        isMuted={player.isMuted}
        isShuffle={player.isShuffle}
        repeatMode={player.repeatMode}
        onTogglePlay={player.togglePlay}
        onNext={player.nextTrack}
        onPrev={player.prevTrack}
        onSeek={player.seek}
        onSetVolume={player.setVolume}
        onToggleMute={player.toggleMute}
        onToggleShuffle={player.toggleShuffle}
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
        onToggleShuffle={player.toggleShuffle}
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
    </div>
  );
}
