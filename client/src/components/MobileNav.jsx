import React from 'react';
import { Home, Search, Library, Plus, BarChart3 } from 'lucide-react';

export function MobileNav({ currentView, setCurrentView, openImportModal, setSelectedPlaylistId }) {
  const isLibraryActive = currentView === 'library' || currentView === 'liked' || currentView === 'playlist' || currentView === 'offline';

  return (
    <nav className="md:hidden flex items-center justify-around bg-gradient-to-t from-black via-black/95 to-black/85 backdrop-blur-lg h-16 px-2 z-40 select-none">
      <button
        onClick={() => {
          setCurrentView('home');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 transition-colors ${
          currentView === 'home' ? 'text-white' : 'text-[#b3b3b3]'
        }`}
      >
        <Home className={`w-6 h-6 ${currentView === 'home' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
        <span className={`text-[11px] ${currentView === 'home' ? 'font-bold text-white' : 'font-normal'}`}>
          דף הבית
        </span>
      </button>

      <button
        onClick={() => {
          setCurrentView('search');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 transition-colors ${
          currentView === 'search' ? 'text-white' : 'text-[#b3b3b3]'
        }`}
      >
        <Search className={`w-6 h-6 ${currentView === 'search' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
        <span className={`text-[11px] ${currentView === 'search' ? 'font-bold text-white' : 'font-normal'}`}>
          חיפוש
        </span>
      </button>

      <button
        onClick={() => {
          setCurrentView('library');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 transition-colors ${
          isLibraryActive ? 'text-white' : 'text-[#b3b3b3]'
        }`}
      >
        <Library className={`w-6 h-6 ${isLibraryActive ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
        <span className={`text-[11px] ${isLibraryActive ? 'font-bold text-white' : 'font-normal'}`}>
          הספרייה שלך
        </span>
      </button>

      <button
        onClick={openImportModal}
        className="flex flex-col items-center justify-center gap-1 w-16 py-1 text-[#b3b3b3] active:text-white transition-colors"
      >
        <Plus className="w-6 h-6 stroke-[2]" />
        <span className="text-[11px] font-normal">ייבוא</span>
      </button>
    </nav>
  );
}
