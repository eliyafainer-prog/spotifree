import React from 'react';
import {
  X,
  ListMusic,
  Trash2,
  ChevronUp,
  ChevronDown,
  Play,
  Music,
  Volume2
} from 'lucide-react';

export function QueueModal({
  isOpen,
  onClose,
  currentTrack,
  queue = [],
  queueIndex = 0,
  isPlaying = false,
  onPlayTrack,
  onRemoveFromQueue,
  onMoveInQueue,
  onClearQueue
}) {
  if (!isOpen) return null;

  // Upcoming items are those after queueIndex
  const upcomingTracks = queue.slice(queueIndex + 1);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fadeIn select-none">
      <div className="bg-[#121212] border border-white/10 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#181818]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center">
              <ListMusic className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">תור השמעה</h2>
              <p className="text-xs text-[#b3b3b3]">
                {upcomingTracks.length > 0 ? `${upcomingTracks.length} שירים נוספים בתור` : 'אין שירים ממתינים בתור'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {upcomingTracks.length > 0 && onClearQueue && (
              <button
                onClick={onClearQueue}
                title="נקה תור"
                className="text-xs text-[#b3b3b3] hover:text-red-400 px-2.5 py-1 rounded-full border border-white/10 hover:border-red-400/40 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>נקה תור</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-[#b3b3b3] hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
              aria-label="סגור"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 no-scrollbar">
          {/* Now Playing Section */}
          {currentTrack && (
            <div>
              <h3 className="text-xs font-bold text-spotify-green uppercase tracking-wider mb-2.5">
                מתנגן כעת
              </h3>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="w-12 h-12 rounded-md overflow-hidden bg-[#282828] flex-shrink-0 relative">
                  {currentTrack.thumbnail ? (
                    <img
                      src={currentTrack.thumbnail}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#b3b3b3]">
                      <Music className="w-6 h-6" />
                    </div>
                  )}
                  {isPlaying && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Volume2 className="w-5 h-5 text-spotify-green animate-pulse" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-spotify-green truncate">
                    {currentTrack.title}
                  </p>
                  <p className="text-xs text-[#b3b3b3] truncate mt-0.5">
                    {currentTrack.artist}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Up Next Section */}
          <div>
            <h3 className="text-xs font-bold text-[#b3b3b3] uppercase tracking-wider mb-2.5">
              הבאים בתור ({upcomingTracks.length})
            </h3>

            {upcomingTracks.length === 0 ? (
              <div className="py-8 text-center text-[#b3b3b3] text-sm bg-white/[0.02] rounded-xl border border-dashed border-white/10">
                <p>התור ריק כרגע.</p>
                <p className="text-xs text-[#727272] mt-1">
                  השירים ימשיכו להתנגן אוטומטית מהאלבום או הפלייליסט.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {upcomingTracks.map((track, idx) => {
                  const actualQueueIndex = queueIndex + 1 + idx;
                  const isFirstUpcoming = idx === 0;
                  const isLastUpcoming = idx === upcomingTracks.length - 1;

                  return (
                    <div
                      key={`${track.id || track.originalId || idx}-${idx}`}
                      className="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/5"
                    >
                      {/* Play directly */}
                      <button
                        onClick={() => onPlayTrack && onPlayTrack(track, null, actualQueueIndex)}
                        className="w-10 h-10 rounded-md overflow-hidden bg-[#282828] flex-shrink-0 relative group/cover flex items-center justify-center"
                        title="נגן עכשיו"
                      >
                        {track.thumbnail ? (
                          <img
                            src={track.thumbnail}
                            alt=""
                            className="w-full h-full object-cover group-hover/cover:opacity-40 transition-opacity"
                          />
                        ) : (
                          <Music className="w-5 h-5 text-[#b3b3b3]" />
                        )}
                        <Play className="w-4 h-4 text-white fill-white absolute opacity-0 group-hover/cover:opacity-100 transition-opacity" />
                      </button>

                      {/* Track Details */}
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => onPlayTrack && onPlayTrack(track, null, actualQueueIndex)}
                      >
                        <p className="font-semibold text-sm text-white group-hover:text-spotify-green transition-colors truncate">
                          {track.title}
                        </p>
                        <p className="text-xs text-[#b3b3b3] truncate mt-0.5">
                          {track.artist}
                        </p>
                      </div>

                      {/* Reorder Up/Down */}
                      <div className="flex flex-col items-center">
                        <button
                          disabled={isFirstUpcoming}
                          onClick={() => onMoveInQueue && onMoveInQueue(actualQueueIndex, actualQueueIndex - 1)}
                          className="p-1 text-[#b3b3b3] hover:text-white disabled:opacity-20 transition-colors"
                          title="הזז למעלה"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          disabled={isLastUpcoming}
                          onClick={() => onMoveInQueue && onMoveInQueue(actualQueueIndex, actualQueueIndex + 1)}
                          className="p-1 text-[#b3b3b3] hover:text-white disabled:opacity-20 transition-colors"
                          title="הזז למטה"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Remove from queue */}
                      {onRemoveFromQueue && (
                        <button
                          onClick={() => onRemoveFromQueue(actualQueueIndex)}
                          title="הסר מהתור"
                          className="p-2 text-[#b3b3b3] hover:text-red-400 hover:bg-white/5 rounded-full transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
