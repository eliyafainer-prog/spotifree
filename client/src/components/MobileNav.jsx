import React from 'react';
import { Home, Search, Library, Plus } from 'lucide-react';

export function MobileNav({ currentView, setCurrentView, openImportModal, setSelectedPlaylistId }) {
  const isLibraryActive = currentView === 'library' || currentView === 'liked' || currentView === 'playlist' || currentView === 'offline';

  return (
    <nav className="md:hidden flex items-center justify-around bg-black/95 backdrop-blur-xl border-t border-white/10 h-16 px-2 z-40 select-none w-full">
      <button
        onClick={() => {
          setCurrentView('home');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 active:scale-95 transition-all ${
          currentView === 'home' ? 'text-white' : 'text-[#b3b3b3]'
        }`}
      >
        <Home className={`w-6 h-6 ${currentView === 'home' ? 'fill-white stroke-[2]' : 'stroke-[1.75]'}`} />
        <span className={`text-[10px] ${currentView === 'home' ? 'font-bold text-white' : 'font-normal'}`}>
          מסך הבית
        </span>
      </button>

      <button
        onClick={() => {
          setCurrentView('search');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 active:scale-95 transition-all ${
          currentView === 'search' ? 'text-white' : 'text-[#b3b3b3]'
        }`}
      >
        <Search className={`w-6 h-6 ${currentView === 'search' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
        <span className={`text-[10px] ${currentView === 'search' ? 'font-bold text-white' : 'font-normal'}`}>
          חיפוש
        </span>
      </button>

      <button
        onClick={() => {
          setCurrentView('library');
          setSelectedPlaylistId(null);
        }}
        className={`flex flex-col items-center justify-center gap-1 w-16 py-1 active:scale-95 transition-all ${
          isLibraryActive ? 'text-white' : 'text-[#b3b3b3]'
        }`}
      >
        <Library className={`w-6 h-6 ${isLibraryActive ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
        <span className={`text-[10px] ${isLibraryActive ? 'font-bold text-white' : 'font-normal'}`}>
          הספרייה
        </span>
      </button>

      <button
        onClick={openImportModal}
        className="flex flex-col items-center justify-center gap-1 w-16 py-1 text-[#b3b3b3] active:text-white active:scale-95 transition-all"
      >
        <Plus className="w-6 h-6 stroke-[2]" />
        <span className="text-[10px] font-normal">יצירה</span>
      </button>
    </nav>
  );
}
