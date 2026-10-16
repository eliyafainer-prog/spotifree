import React from 'react';
import { Home, Search, Library, Heart, Plus, Music2, BarChart3, ArrowDownCircle, Pin } from 'lucide-react';

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
  return (
    <aside className="hidden md:flex flex-col w-[280px] lg:w-[310px] bg-black p-2 pl-0 gap-2 select-none h-full">
      {/* Top Panel: Home & Search */}
      <div className="bg-[#121212] rounded-lg px-3 py-2 flex flex-col gap-1">
        <button
          onClick={() => {
            setCurrentView('home');
            setSelectedPlaylistId(null);
          }}
          className={`flex items-center gap-5 px-3 py-3 rounded-md font-bold text-[15px] transition-colors text-right ${
            currentView === 'home' ? 'text-white' : 'text-[#b3b3b3] hover:text-white'
          }`}
        >
          <Home className={`w-6 h-6 flex-shrink-0 ${currentView === 'home' ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
          <span>דף הבית</span>
        </button>

        <button
          onClick={() => {
            setCurrentView('search');
            setSelectedPlaylistId(null);
          }}
          className={`flex items-center gap-5 px-3 py-3 rounded-md font-bold text-[15px] transition-colors text-right ${
            currentView === 'search' ? 'text-white' : 'text-[#b3b3b3] hover:text-white'
          }`}
        >
          <Search className={`w-6 h-6 flex-shrink-0 ${currentView === 'search' ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
          <span>חיפוש</span>
        </button>
      </div>

      {/* Bottom Panel: Your Library (Spotify 2025/2026 style) */}
      <div className="bg-[#121212] rounded-lg flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Library Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <button
            onClick={() => {
              setCurrentView('library');
              setSelectedPlaylistId(null);
            }}
            className="flex items-center gap-3 text-[#b3b3b3] hover:text-white transition-colors font-bold text-[15px]"
          >
            <Library className="w-6 h-6 flex-shrink-0" />
            <span>הספרייה שלך</span>
          </button>

          <div className="flex items-center gap-1">
            {onCreatePlaylist && (
              <button
                onClick={onCreatePlaylist}
                title="צור פלייליסט חדש"
                className="p-2 rounded-full text-[#b3b3b3] hover:text-white hover:bg-[#1f1f1f] transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Filter Chips Row */}
        <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
          <button
            onClick={openImportModal}
            className="px-3 py-1.5 rounded-full bg-[#232323] hover:bg-[#2a2a2a] text-white text-xs font-semibold whitespace-nowrap transition-colors"
          >
            + ייבוא מספוטיפיי
          </button>
          <button
            onClick={() => {
              setCurrentView('offline');
              setSelectedPlaylistId(null);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              currentView === 'offline'
                ? 'bg-white text-black'
                : 'bg-[#232323] hover:bg-[#2a2a2a] text-white'
            }`}
          >
            הורדות
          </button>
          <button
            onClick={() => {
              setCurrentView('analytics');
              setSelectedPlaylistId(null);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              currentView === 'analytics'
                ? 'bg-white text-black'
                : 'bg-[#232323] hover:bg-[#2a2a2a] text-white'
            }`}
          >
            סטטיסטיקות
          </button>
        </div>

        {/* Scrollable Library Items */}
        <div className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5">
          {/* Pinned: Liked Songs */}
          <button
            onClick={() => {
              setCurrentView('liked');
              setSelectedPlaylistId(null);
            }}
            className={`flex items-center gap-3 p-2 rounded-md text-right transition-colors ${
              currentView === 'liked' ? 'bg-[#232323]' : 'hover:bg-[#1a1a1a]'
            }`}
          >
            <div className="w-12 h-12 rounded-[4px] bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] flex items-center justify-center text-white flex-shrink-0">
              <Heart className="w-5 h-5 fill-white" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className={`text-[15px] font-medium truncate ${currentView === 'liked' ? 'text-spotify-green' : 'text-white'}`}>
                שירים שאהבתי
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[#b3b3b3] mt-0.5">
                <Pin className="w-3 h-3 fill-spotify-green text-spotify-green rotate-45 flex-shrink-0" />
                <span className="truncate">פלייליסט • {likedCount} שירים</span>
              </div>
            </div>
          </button>

          {/* Offline Downloads Row */}
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
            <div className="flex flex-col min-w-0 flex-1">
              <span className={`text-[15px] font-medium truncate ${currentView === 'offline' ? 'text-spotify-green' : 'text-white'}`}>
                הורדות אופליין
              </span>
              <span className="text-xs text-[#b3b3b3] truncate mt-0.5">
                שמורים במכשיר • {downloadedCount} שירים
              </span>
            </div>
          </button>

          {/* User & Imported Playlists */}
          {playlists.map((pl) => {
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
                {pl.cover ? (
                  <img src={pl.cover} alt="" className="w-12 h-12 rounded-[4px] object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-[4px] bg-[#282828] flex items-center justify-center text-[#b3b3b3] flex-shrink-0">
                    <Music2 className="w-5 h-5" />
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={`text-[15px] font-medium truncate ${isSelected ? 'text-spotify-green' : 'text-white'}`}>
                    {pl.title}
                  </span>
                  <span className="text-xs text-[#b3b3b3] truncate mt-0.5">
                    {pl.type === 'album' ? 'אלבום' : 'פלייליסט'} • {pl.tracks?.length || 0} שירים
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
