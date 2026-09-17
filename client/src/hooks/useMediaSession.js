import { useEffect } from 'react';

/**
 * Custom hook to bind HTML5 Audio to native MediaSession API
 * Supports headphone buttons, lock-screen controls, smartwatch sync, and disconnect detection
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
  // Update track metadata and artwork
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    const artworkUrl = currentTrack.thumbnail || '/icons/music-icon.svg';

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

  // Set action handlers for headphone buttons and keyboard shortcuts
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const actionHandlers = [
      ['play', onPlay],
      ['pause', onPause],
      ['previoustrack', onPrev],
      ['nexttrack', onNext],
      ['seekto', (details) => {
        if (details.seekTime !== undefined && onSeek) {
          onSeek(details.seekTime);
        }
      }],
      ['seekforward', (details) => {
        const offset = details.seekOffset || 10;
        if (onSeek) onSeek(Math.min((currentTime || 0) + offset, duration || 0));
      }],
      ['seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        if (onSeek) onSeek(Math.max((currentTime || 0) - offset, 0));
      }]
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) {
        // Some actions might not be supported on all browsers
      }
    }

    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch (e) {}
      }
    };
  }, [onPlay, onPause, onNext, onPrev, onSeek, currentTime, duration]);

  // Handle Headphone / Bluetooth disconnect (devicechange event)
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) return;

    const handleDeviceChange = () => {
      // When audio devices change (e.g. headphones unplugged), pause playback automatically
      if (isPlaying && onPause) {
        console.log('Audio output device changed, auto-pausing playback.');
        onPause();
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [isPlaying, onPause]);
}
