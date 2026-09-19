import { useEffect, useRef } from 'react';

/**
 * Custom hook to bind HTML5 Audio to native MediaSession API
 * Supports headphone buttons (single click, double click, triple click),
 * lock-screen controls, smartwatch sync, and disconnect detection.
 */
export function useMediaSession({
  currentTrack,
  isPlaying,
  duration,
  currentTime,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onSeek
}) {
  // Keep handlers in a ref so action handlers are bound once and never dropped or missed
  const handlersRef = useRef({});
  handlersRef.current = {
    onPlay,
    onPause,
    onNext,
    onPrev,
    onSeek,
    currentTime,
    duration,
    isPlaying
  };

  // Update track metadata and artwork (absolute URLs for mobile OS lock screens)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    let artworkUrl = currentTrack.thumbnail || '/icons/music-icon.svg';
    try {
      artworkUrl = new URL(artworkUrl, window.location.href).href;
    } catch {
      // Fallback if URL parsing fails
    }

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: currentTrack.title || 'Unknown Title',
      artist: currentTrack.artist || 'Unknown Artist',
      album: currentTrack.album || 'SpotiFree',
      artwork: [
        { src: artworkUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '192x192', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '384x384', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }
      ]
    });
  }, [currentTrack]);

  // Update playback state
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // Update position state for lock screen scrub bar
  useEffect(() => {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    if (typeof duration !== 'number' || duration <= 0 || isNaN(currentTime)) return;

    try {
      navigator.mediaSession.setPositionState({
        duration: Math.max(duration, 0),
        playbackRate: 1.0,
        position: Math.min(Math.max(currentTime, 0), duration)
      });
    } catch (e) {
      // Ignored for slight race conditions
    }
  }, [currentTime, duration]);

  // Register action handlers ONCE - never drop connection during playback
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const actionHandlers = [
      ['play', () => handlersRef.current.onPlay?.()],
      ['pause', () => handlersRef.current.onPause?.()],
      ['stop', () => handlersRef.current.onPause?.()],
      ['previoustrack', () => handlersRef.current.onPrev?.()],
      ['nexttrack', () => handlersRef.current.onNext?.()],
      ['seekto', (details) => {
        if (details.seekTime !== undefined && handlersRef.current.onSeek) {
          handlersRef.current.onSeek(details.seekTime);
        }
      }],
      ['seekforward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = handlersRef.current.currentTime || 0;
        const dur = handlersRef.current.duration || 0;
        handlersRef.current.onSeek?.(Math.min(cur + offset, dur));
      }],
      ['seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = handlersRef.current.currentTime || 0;
        handlersRef.current.onSeek?.(Math.max(cur - offset, 0));
      }]
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) {}
    }

    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch (e) {}
      }
    };
  }, []);

  // Set audio session type for media playback
  useEffect(() => {
    if ('audioSession' in navigator) {
      try {
        navigator.audioSession.type = 'playback';
      } catch (e) {}
    }
  }, []);
}
