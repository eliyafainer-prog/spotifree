import { useState, useEffect, useRef, useCallback } from 'react';
import { getPlayableAudioUrl, prefetchNextTracks, resolveTrack } from '../services/api';
import { addRecentTrack, updateTrackInPlaylists } from '../services/storage';
import { getOfflineTrack } from '../services/offlineStorage';

/**
 * 100% Native HTML5 Audio Engine for SpotiFree
 * Streams directly from backend Audio Stream Proxy with full MediaSession & background support.
 */
export function useAudioPlayer() {
  const audioRef = useRef(null);
  const nextTrackRef = useRef(null);
  const userPausedRef = useRef(false);
  const currentTrackRef = useRef(null);

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    const saved = localStorage.getItem('spotifree_volume');
    return saved !== null ? parseFloat(saved) : 0.8;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off'); // 'off' | 'all' | 'one'

  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);

  // Initialize Native HTML5 Audio once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.volume = isMuted ? 0 : volume;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (audio.currentTime !== undefined && !isNaN(audio.currentTime)) {
        setCurrentTime(audio.currentTime);
      }
      if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handlePause = () => {
      if (!userPausedRef.current && currentTrackRef.current) {
        // System / OS attempted to pause in background -> auto resume!
        audio.play().catch(() => {
          setIsPlaying(false);
        });
      } else {
        setIsPlaying(false);
      }
    };

    const handleEnded = () => {
      nextTrackRef.current?.();
    };

    const handleError = (e) => {
      console.warn('HTML5 Audio error:', e);
      setIsLoading(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('loadedmetadata', handleDurationChange);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadedmetadata', handleDurationChange);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  // Sync volume changes
  useEffect(() => {
    const vol = isMuted ? 0 : volume;
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
    localStorage.setItem('spotifree_volume', volume.toString());
  }, [volume, isMuted]);

  // Background Audio Guardian: keep playing through visibility changes, blur & app switching
  useEffect(() => {
    const handleWakeup = () => {
      if (!userPausedRef.current && currentTrackRef.current && audioRef.current?.paused) {
        audioRef.current.play().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleWakeup);
    window.addEventListener('pagehide', handleWakeup);
    window.addEventListener('blur', handleWakeup);
    window.addEventListener('focus', handleWakeup);

    return () => {
      document.removeEventListener('visibilitychange', handleWakeup);
      window.removeEventListener('pagehide', handleWakeup);
      window.removeEventListener('blur', handleWakeup);
      window.removeEventListener('focus', handleWakeup);
    };
  }, []);

  /**
   * Play specific track from queue or playlist
   */
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track || !audioRef.current) return;

    userPausedRef.current = false;

    const currentQ = newQueue || queue;
    const targetIdx = indexInQueue >= 0 ? indexInQueue : currentQ.findIndex(t => t.id === track.id);

    if (newQueue) {
      setQueue(newQueue);
      setQueueIndex(targetIdx);
    } else if (indexInQueue >= 0) {
      setQueueIndex(indexInQueue);
    }

    let playableTrack = { ...track };
    const isUnresolved = !playableTrack.streamableId && (!playableTrack.id || playableTrack.id.startsWith('sp_'));

    setCurrentTrack(playableTrack);
    currentTrackRef.current = playableTrack;
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(playableTrack.durationSeconds || 0);

    // Resolve Spotify tracks to streamable ID if needed
    if (isUnresolved) {
      try {
        const resolved = await resolveTrack(playableTrack);
        if (resolved && resolved.streamableId) {
          playableTrack.originalId = track.id;
          playableTrack.streamableId = resolved.streamableId;
          playableTrack.id = resolved.streamableId;
          if (resolved.thumbnail) playableTrack.thumbnail = resolved.thumbnail;
          if (resolved.durationSeconds) {
            playableTrack.durationSeconds = resolved.durationSeconds;
            setDuration(resolved.durationSeconds);
          }
          setCurrentTrack({ ...playableTrack });
          currentTrackRef.current = { ...playableTrack };
          updateTrackInPlaylists(playableTrack);
        }
      } catch (err) {
        console.error('Failed to resolve track:', err);
        setIsLoading(false);
        return;
      }
    } else if (playableTrack.streamableId) {
      playableTrack.id = playableTrack.streamableId;
    }

    // 1. Check Offline Storage first (0ms instant playback without internet!)
    try {
      const offlineRecord = await getOfflineTrack(playableTrack);
      if (offlineRecord && offlineRecord.audioBlob && audioRef.current) {
        const localBlobUrl = URL.createObjectURL(offlineRecord.audioBlob);
        audioRef.current.src = localBlobUrl;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setIsPlaying(true);
        setIsLoading(false);
        addRecentTrack(playableTrack);

        if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
          prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
        }
        return;
      }
    } catch (e) {
      console.warn('Offline storage check skipped:', e);
    }

    // 2. Play via Server Audio Stream Proxy (pure HTML5 Audio)
    try {
      const streamUrl = getPlayableAudioUrl(playableTrack);
      audioRef.current.src = streamUrl;
      audioRef.current.currentTime = 0;
      await audioRef.current.play();
      setIsPlaying(true);
      setIsLoading(false);
      addRecentTrack(playableTrack);

      if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
        prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
      }
    } catch (err) {
      console.error('Playback failed:', err);
      setIsLoading(false);
    }
  }, [queue]);

  /**
   * Toggle play / pause
   */
  const togglePlay = useCallback(() => {
    if (!currentTrack || !audioRef.current) return;

    if (!audioRef.current.paused) {
      userPausedRef.current = true;
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      userPausedRef.current = false;
      audioRef.current.play().catch(e => console.error('Play failed:', e));
      setIsPlaying(true);
    }
  }, [currentTrack]);

  /**
   * Next track handler
   */
  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;

    if (repeatMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }

    let nextIdx = queueIndex + 1;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else if (nextIdx >= queue.length) {
      if (repeatMode === 'all') {
        nextIdx = 0;
      } else {
        return; // End of queue
      }
    }

    setQueueIndex(nextIdx);
    playTrack(queue[nextIdx]);
  }, [queue, queueIndex, isShuffle, repeatMode, playTrack]);

  nextTrackRef.current = nextTrack;

  /**
   * Previous track handler
   */
  const prevTrack = useCallback(() => {
    if (currentTime > 3 && audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    if (queue.length === 0) return;

    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      prevIdx = repeatMode === 'all' ? queue.length - 1 : 0;
    }

    setQueueIndex(prevIdx);
    playTrack(queue[prevIdx]);
  }, [queue, queueIndex, repeatMode, playTrack, currentTime]);

  /**
   * Seek to timestamp in seconds
   */
  const seek = useCallback((seconds) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      setCurrentTime(seconds);
    }
  }, []);

  /**
   * Set volume (0.0 to 1.0)
   */
  const setVolume = useCallback((val) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
    }
  }, [isMuted]);

  /**
   * Toggle mute
   */
  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  /**
   * Toggle shuffle
   */
  const toggleShuffle = useCallback(() => {
    setIsShuffle(prev => !prev);
  }, []);

  /**
   * Toggle repeat mode (off -> all -> one -> off)
   */
  const toggleRepeat = useCallback(() => {
    setRepeatMode(prev => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, []);

  /**
   * Add track to end of queue
   */
  const addToQueue = useCallback((track) => {
    setQueue(prev => [...prev, track]);
  }, []);

  return {
    currentTrack,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    isMuted,
    isShuffle,
    repeatMode,
    queue,
    queueIndex,
    playTrack,
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    addToQueue
  };
}
