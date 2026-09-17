import React from 'react';
import { Home, Search, Library, Heart, PlusCircle, Music2 } from 'lucide-react';

export function Sidebar({ currentView, setCurrentView, playlists, openImportModal, selectedPlaylistId, setSelectedPlaylistId }) {
  return (
    <aside className="hidden md:flex flex-col w-64 bg-black p-3 gap-2 select-none h-full">
      {/* Top Box: Brand & Primary Navigation */}
      <div className="bg-spotify-dark rounded-lg p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2.5 px-2 text-white font-bold text-xl tracking-tight">
          <div className="w-8 h-8 rounded-full bg-spotify-green flex items-center justify-center text-black font-black flex-shrink-0 shadow-md">
            <Music2 className="w-5 h-5 fill-black stroke-black" />
          </div>
          <span>SpotiFree</span>
        </div>

        <nav className="flex flex-col gap-1">
          <button
            onClick={() => {
              setCurrentView('home');
              setSelectedPlaylistId(null);
            }}
            className={`flex items-center gap-4 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors text-right ${
              currentView === 'home' ? 'text-white bg-spotify-highlight' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <Home className="w-5 h-5 flex-shrink-0" />
            <span>דף הבית</span>
          </button>

          <button
            onClick={() => {
              setCurrentView('search');
              setSelectedPlaylistId(null);
            }}
            className={`flex items-center gap-4 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors text-right ${
              currentView === 'search' ? 'text-white bg-spotify-highlight' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <Search className="w-5 h-5 flex-shrink-0" />
            <span>חיפוש</span>
          </button>
        </nav>
      </div>

      {/* Bottom Box: Library & Playlists */}
      <div className="bg-spotify-dark rounded-lg p-4 flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">
        <div className="flex items-center justify-between text-spotify-subtext hover:text-white transition-colors">
          <button
            onClick={() => {
              setCurrentView('library');
              setSelectedPlaylistId(null);
            }}
            className="flex items-center gap-3 font-semibold text-sm"
          >
            <Library className="w-5 h-5 flex-shrink-0" />
            <span>הספרייה שלך</span>
          </button>

          <button
            onClick={openImportModal}
            title="ייבוא פלייליסט מספוטיפיי או מיוטיוב"
            className="p-1 text-spotify-subtext hover:text-spotify-green transition-colors"
          >
            <PlusCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Access: Liked Songs & Import Button */}
        <div className="flex flex-col gap-1 pt-1 border-b border-spotify-border pb-3">
          <button
            onClick={() => {
              setCurrentView('liked');
              setSelectedPlaylistId(null);
            }}
            className={`flex items-center gap-3 p-2 rounded-md font-medium text-sm transition-colors text-right ${
              currentView === 'liked' ? 'bg-spotify-highlight text-white' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <div className="w-8 h-8 rounded bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-white flex-shrink-0 shadow">
              <Heart className="w-4 h-4 fill-white" />
            </div>
            <span>שירים שאהבתי</span>
          </button>

          <button
            onClick={openImportModal}
            className="flex items-center gap-3 p-2 rounded-md font-medium text-sm text-spotify-green hover:bg-spotify-highlight/40 transition-colors text-right"
          >
            <div className="w-8 h-8 rounded bg-spotify-highlight flex items-center justify-center text-spotify-green border border-spotify-green/30 flex-shrink-0">
              <PlusCircle className="w-4 h-4" />
            </div>
            <span>ייבוא פלייליסט חדש</span>
          </button>
        </div>

        {/* Playlists List */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-1">
          {playlists.length === 0 ? (
            <div className="text-xs text-spotify-subtext p-3 text-center leading-relaxed">
              אין עדיין פלייליסטים שמורים.<br />
              לחץ על <span className="text-spotify-green font-bold">ייבוא פלייליסט</span> כדי להוסיף אלבום או פלייליסט!
            </div>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => {
                  setSelectedPlaylistId(pl.id);
                  setCurrentView('playlist');
                }}
                className={`flex items-center gap-3 p-2 rounded-md text-sm text-right transition-colors ${
                  selectedPlaylistId === pl.id && currentView === 'playlist'
                    ? 'bg-spotify-highlight text-white'
                    : 'text-spotify-subtext hover:text-white hover:bg-spotify-highlight/20'
                }`}
              >
                {pl.cover ? (
                  <img src={pl.cover} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0 shadow-sm" />
                ) : (
                  <div className="w-9 h-9 rounded bg-spotify-elevated flex items-center justify-center text-spotify-subtext flex-shrink-0">
                    <Music2 className="w-4 h-4" />
                  </div>
                )}
                <div className="flex-1 truncate">
                  <div className="font-medium truncate text-white">{pl.title}</div>
                  <div className="text-xs text-spotify-subtext">{pl.tracks?.length || 0} שירים</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
