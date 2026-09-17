import React from 'react';
import { Home, Search, Library, PlusCircle } from 'lucide-react';

export function MobileNav({ currentView, setCurrentView, openImportModal, setSelectedPlaylistId }) {
  return (
    <nav className="md:hidden flex items-center justify-around bg-spotify-dark/95 backdrop-blur-md border-t border-spotify-border h-16 px-2 z-40 select-none">
      <button
        onClick={() => {
          setCurrentView('home');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 transition-colors ${
          currentView === 'home' ? 'text-white' : 'text-spotify-subtext hover:text-white'
        }`}
      >
        <Home className="w-5 h-5" />
        <span className="text-[10px] font-medium">בית</span>
      </button>

      <button
        onClick={() => {
          setCurrentView('search');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 transition-colors ${
          currentView === 'search' ? 'text-white' : 'text-spotify-subtext hover:text-white'
        }`}
      >
        <Search className="w-5 h-5" />
        <span className="text-[10px] font-medium">חיפוש</span>
      </button>

      <button
        onClick={() => {
          setCurrentView('library');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 transition-colors ${
          currentView === 'library' || currentView === 'liked' || currentView === 'playlist' ? 'text-white' : 'text-spotify-subtext hover:text-white'
        }`}
      >
        <Library className="w-5 h-5" />
        <span className="text-[10px] font-medium">ספרייה</span>
      </button>

      <button
        onClick={openImportModal}
        className="flex flex-col items-center justify-center gap-1 w-16 py-1 text-spotify-green hover:text-spotify-green-hover transition-colors"
      >
        <PlusCircle className="w-5 h-5" />
        <span className="text-[10px] font-medium font-bold">ייבוא</span>
      </button>
    </nav>
  );
}
