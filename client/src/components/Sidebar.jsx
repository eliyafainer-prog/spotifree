import React, { useState } from 'react';
import { Library, Heart, Plus, Music2, ArrowDownCircle, Pin, Search, List, ListPlus } from 'lucide-react';

export function PlaylistThumb({ playlist, className = 'w-12 h-12 rounded-[4px]' }) {
  const tracks = playlist?.tracks || [];
  // Collect up to 4 unique track thumbnails for Spotify's signature 2x2 collage
  const uniqueThumbs = [];
  for (const t of tracks) {
    if (t?.thumbnail && !uniqueThumbs.includes(t.thumbnail)) {
      uniqueThumbs.push(t.thumbnail);
      if (uniqueThumbs.length === 4) break;
    }
  }

  if (uniqueThumbs.length >= 4 && (!playlist?.cover || playlist?.type !== 'album')) {
    return (
      <div className={`${className} grid grid-cols-2 grid-rows-2 overflow-hidden bg-[#282828] flex-shrink-0`}>
        {uniqueThumbs.map((src, i) => (
          <img key={i} src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
        ))}
      </div>
    );
  }

  if (playlist?.cover) {
    return (
      <img
        src={playlist.cover}
        alt=""
        className={`${className} object-cover bg-[#282828] flex-shrink-0`}
        loading="lazy"
      />
    );
  }

  if (uniqueThumbs.length > 0) {
    return (
      <img
        src={uniqueThumbs[0]}
        alt=""
        className={`${className} object-cover bg-[#282828] flex-shrink-0`}
        loading="lazy"
      />
    );
  }

  return (
    <div className={`${className} bg-[#282828] flex items-center justify-center text-[#b3b3b3] flex-shrink-0`}>
      <Music2 className="w-5 h-5" />
    </div>
  );
}

export function Sidebar({
  currentView,
  setCurrentView,
  playlists,
  likedCount = 0,
  downloadedCount = 0,
  openImportModal,
  onCreatePlaylist,
  selectedPlaylistId,
  setSelectedPlaylistId
}) {
  const [libFilter, setLibFilter] = useState('all'); // 'all' | 'playlists' | 'albums'
  const [libSearch, setLibSearch] = useState('');
  const [showLibSearch, setShowLibSearch] = useState(false);

  const filteredPlaylists = playlists.filter((pl) => {
    if (libFilter === 'albums' && pl.type !== 'album') return false;
    if (libFilter === 'playlists' && pl.type === 'album') return false;
    if (libSearch.trim()) {
      return pl.title?.toLowerCase().includes(libSearch.trim().toLowerCase());
    }
    return true;
  });

  return (
    <aside className="hidden md:flex flex-col w-[280px] lg:w-[320px] xl:w-[340px] flex-shrink-0 bg-[#121212] rounded-lg select-none h-full overflow-hidden">
      {/* Top Header: הספרייה on the right, + יצירה pill on the left (Exact match to Image 1) */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <button
          onClick={() => {
            setCurrentView('library');
            setSelectedPlaylistId(null);
          }}
          className="flex items-center gap-2.5 text-[#b3b3b3] hover:text-white transition-colors font-bold text-base"
        >
          <Library className="w-5 h-5 flex-shrink-0" />
          <span>הספרייה</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            onClick={openImportModal}
            title="ייבוא או יצירת פלייליסט"
            className="flex items-center gap-1.5 bg-[#1f1f1f] hover:bg-[#2a2a2a] text-white text-xs font-bold px-3.5 py-1.5 rounded-full transition-colors"
          >
            <Plus className="w-4 h-4 text-[#b3b3b3]" />
            <span>יצירה</span>
          </button>
          {onCreatePlaylist && (
            <button
              onClick={onCreatePlaylist}
              title="פלייליסט ריק חדש"
              className="p-2 rounded-full text-[#b3b3b3] hover:text-white hover:bg-[#1f1f1f] transition-colors"
            >
              <ListPlus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Pills Row: פלייליסטים | אמנים | אלבומים (Exact match to Image 1) */}
      <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setLibFilter(prev => (prev === 'playlists' ? 'all' : 'playlists'))}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            libFilter === 'playlists'
              ? 'bg-white text-black font-bold'
              : 'bg-[#232323] hover:bg-[#2a2a2a] text-white'
          }`}
        >
          פלייליסטים
        </button>
        <button
          onClick={() => setLibFilter(prev => (prev === 'albums' ? 'all' : 'albums'))}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            libFilter === 'albums'
              ? 'bg-white text-black font-bold'
              : 'bg-[#232323] hover:bg-[#2a2a2a] text-white'
          }`}
        >
          אלבומים
        </button>
        <button
          onClick={() => {
            setCurrentView('offline');
            setSelectedPlaylistId(null);
          }}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            currentView === 'offline'
              ? 'bg-white text-black font-bold'
              : 'bg-[#232323] hover:bg-[#2a2a2a] text-white'
          }`}
        >
          הורדות
        </button>
      </div>

      {/* Sub-header: Search Icon on right, לאחרונה ≡ on left (Exact match to Image 1) */}
      <div className="flex items-center justify-between px-4 py-1.5 text-[#b3b3b3]">
        {showLibSearch ? (
          <input
            type="text"
            value={libSearch}
            onChange={(e) => setLibSearch(e.target.value)}
            onBlur={() => { if (!libSearch) setShowLibSearch(false); }}
            placeholder="חפש בספרייה..."
            autoFocus
            className="bg-[#242424] text-white text-xs px-2.5 py-1 rounded outline-none w-44 text-right"
          />
        ) : (
          <button
            onClick={() => setShowLibSearch(true)}
            className="p-1.5 rounded-full hover:bg-[#232323] hover:text-white transition-colors"
            title="חפש בספרייה"
          >
            <Search className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-1.5 text-xs font-medium hover:text-white cursor-pointer">
          <span>לאחרונה</span>
          <List className="w-4 h-4" />
        </div>
      </div>

      {/* Scrollable Library Items List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5">
        {/* Pinned: שירים שאהבתם */}
        <button
          onClick={() => {
            setCurrentView('liked');
            setSelectedPlaylistId(null);
          }}
          className={`flex items-center gap-3 p-2 rounded-md text-right transition-colors ${
            currentView === 'liked' ? 'bg-[#232323]' : 'hover:bg-[#1a1a1a]'
          }`}
        >
          <div className="w-12 h-12 rounded-[4px] bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center text-white flex-shrink-0 shadow-sm">
            <Heart className="w-5 h-5 fill-white" />
          </div>
          <div className="flex flex-col min-w-0 flex-1 text-right">
            <span className={`text-[15px] font-semibold truncate ${currentView === 'liked' ? 'text-spotify-green' : 'text-white'}`}>
              שירים שאהבתם
            </span>
            <div className="flex items-center gap-1.5 text-xs text-[#b3b3b3] mt-0.5">
              <Pin className="w-3.5 h-3.5 fill-spotify-green text-spotify-green rotate-45 flex-shrink-0" />
              <span className="truncate">פלייליסט • {likedCount} שירים</span>
            </div>
          </div>
        </button>

        {/* Offline Downloads (if any or when active) */}
        {(downloadedCount > 0 || currentView === 'offline') && (
          <button
            onClick={() => {
              setCurrentView('offline');
              setSelectedPlaylistId(null);
            }}
            className={`flex items-center gap-3 p-2 rounded-md text-right transition-colors ${
              currentView === 'offline' ? 'bg-[#232323]' : 'hover:bg-[#1a1a1a]'
            }`}
          >
            <div className="w-12 h-12 rounded-[4px] bg-gradient-to-br from-emerald-700 to-teal-900 flex items-center justify-center text-spotify-green flex-shrink-0">
              <ArrowDownCircle className="w-6 h-6 fill-spotify-green text-black" />
            </div>
            <div className="flex flex-col min-w-0 flex-1 text-right">
              <span className={`text-[15px] font-semibold truncate ${currentView === 'offline' ? 'text-spotify-green' : 'text-white'}`}>
                הורדות אופליין
              </span>
              <span className="text-xs text-[#b3b3b3] truncate mt-0.5">
                שמורים במכשיר • {downloadedCount} שירים
              </span>
            </div>
          </button>
        )}

        {/* User & Imported Playlists with automatic 2x2 collage covers */}
        {filteredPlaylists.map((pl) => {
          const isSelected = selectedPlaylistId === pl.id && currentView === 'playlist';
          return (
            <button
              key={pl.id}
              onClick={() => {
                setSelectedPlaylistId(pl.id);
                setCurrentView('playlist');
              }}
              className={`flex items-center gap-3 p-2 rounded-md text-right transition-colors ${
                isSelected ? 'bg-[#232323]' : 'hover:bg-[#1a1a1a]'
              }`}
            >
              <PlaylistThumb playlist={pl} className="w-12 h-12 rounded-[4px]" />
              <div className="flex flex-col min-w-0 flex-1 text-right">
                <span className={`text-[15px] font-semibold truncate ${isSelected ? 'text-spotify-green' : 'text-white'}`}>
                  {pl.title}
                </span>
                <span className="text-xs text-[#b3b3b3] truncate mt-0.5">
                  {pl.type === 'album' ? 'אלבום' : 'פלייליסט'} • SpotiFree
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
