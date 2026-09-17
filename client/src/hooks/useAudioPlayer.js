import { useState, useEffect, useRef, useCallback } from 'react';
import { getPlayableAudioUrl, prefetchNextTracks } from '../services/api';
import { addRecentTrack } from '../services/storage';
import { getOfflineTrack } from '../services/offlineStorage';

export function useAudioPlayer() {
  const audioRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytTimerRef = useRef(null);
  const activeEngineRef = useRef('audio');
  const fallbackTimerRef = useRef(null);
  const nextTrackRef = useRef(null);

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

  // Initialize HTML5 Audio instance once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.volume = isMuted ? 0 : volume;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (activeEngineRef.current === 'audio') {
        setCurrentTime(audio.currentTime);
      }
    };

    const handleDurationChange = () => {
      if (activeEngineRef.current === 'audio' && audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleWaiting = () => {
      if (activeEngineRef.current === 'audio') setIsLoading(true);
    };

    const handleCanPlay = () => {
      if (activeEngineRef.current === 'audio') setIsLoading(false);
    };

    const handlePlay = () => {
      if (activeEngineRef.current === 'audio') {
        setIsPlaying(true);
        setIsLoading(false);
      }
    };

    const handlePause = () => {
      if (activeEngineRef.current === 'audio') {
        setIsPlaying(false);
      }
    };

    const handleEnded = () => {
      if (activeEngineRef.current === 'audio') {
        nextTrackRef.current?.();
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Sync volume changes to both players
  useEffect(() => {
    const vol = isMuted ? 0 : volume;
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
    if (ytPlayerRef.current && typeof ytPlayerRef.current.setVolume === 'function') {
      try {
        ytPlayerRef.current.setVolume(vol * 100);
      } catch (e) {}
    }
    localStorage.setItem('spotifree_volume', volume.toString());
  }, [volume, isMuted]);

  // Track timer polling when playing via YouTube
  useEffect(() => {
    if (isPlaying && activeEngineRef.current === 'yt') {
      ytTimerRef.current = setInterval(() => {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
          try {
            const cur = ytPlayerRef.current.getCurrentTime() || 0;
            const dur = ytPlayerRef.current.getDuration() || 0;
            setCurrentTime(cur);
            if (dur > 0) setDuration(dur);
          } catch (e) {}
        }
      }, 250);
    } else {
      if (ytTimerRef.current) clearInterval(ytTimerRef.current);
    }
    return () => {
      if (ytTimerRef.current) clearInterval(ytTimerRef.current);
    };
  }, [isPlaying]);

  // Initialize YouTube Player immediately on mount so it's warm and ready for instant playback
  useEffect(() => {
    let checkTimer = null;
    const initYT = () => {
      if (!window.YT || !window.YT.Player) {
        checkTimer = setTimeout(initYT, 200);
        return;
      }
      if (!ytPlayerRef.current) {
        try {
          ytPlayerRef.current = new window.YT.Player('spotifree-yt-player', {
            height: '100',
            width: '100',
            playerVars: {
              autoplay: 0,
              controls: 0,
              disablekb: 1,
              fs: 0,
              playsinline: 1,
              rel: 0
            },
            events: {
              onReady: (e) => {
                try {
                  e.target.setVolume(isMuted ? 0 : volume * 100);
                } catch (err) {}
              },
              onStateChange: (e) => {
                if (e.data === 1) { // PLAYING
                  setIsPlaying(true);
                  setIsLoading(false);
                } else if (e.data === 2) { // PAUSED
                  setIsPlaying(false);
                } else if (e.data === 0) { // ENDED
                  nextTrackRef.current?.();
                } else if (e.data === 3) { // BUFFERING
                  setIsLoading(true);
                }
              },
              onError: (err) => {
                console.warn('YouTube playback error:', err);
                setIsLoading(false);
              }
            }
          });
        } catch (e) {
          console.error('Failed to init YT player on mount:', e);
        }
      }
    };

    initYT();
    return () => {
      if (checkTimer) clearTimeout(checkTimer);
    };
  }, []);

  /**
   * Play track using client-side YouTube Player API (100% immune to cloud datacenter IP blocks!)
   */
  const playViaYouTubePlayer = useCallback((track) => {
    if (!track || !track.id) return;

    // Keep silent audio playing on HTML5 audio to keep mediaSession and background audio session active
    if (audioRef.current) {
      try {
        audioRef.current.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        audioRef.current.loop = true;
        audioRef.current.play().catch(() => {});
      } catch (e) {}
    }

    activeEngineRef.current = 'yt';
    setIsLoading(true);

    const onPlayerReady = (player) => {
      try {
        player.setVolume(isMuted ? 0 : volume * 100);
        player.loadVideoById(track.id);
        player.playVideo();
      } catch (e) {
        console.error('Error in YT play:', e);
        setIsLoading(false);
      }
    };

    if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
      onPlayerReady(ytPlayerRef.current);
    } else {
      let attempts = 0;
      const retry = setInterval(() => {
        attempts++;
        if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
          clearInterval(retry);
          onPlayerReady(ytPlayerRef.current);
        } else if (attempts > 25) {
          clearInterval(retry);
          setIsLoading(false);
        }
      }, 100);
    }
  }, [volume, isMuted]);

  /**
   * Play specific track from a given playlist or queue
   */
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);

    const currentQ = newQueue || queue;
    const targetIdx = indexInQueue >= 0 ? indexInQueue : currentQ.findIndex(t => t.id === track.id);

    if (newQueue) {
      setQueue(newQueue);
      setQueueIndex(targetIdx);
    } else if (indexInQueue >= 0) {
      setQueueIndex(indexInQueue);
    }

    setCurrentTrack(track);
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(track.durationSeconds || 0);

    // 1. Check Offline Storage first (0ms instant playback without internet!)
    try {
      const offlineRecord = await getOfflineTrack(track);
      if (offlineRecord && offlineRecord.audioBlob && audioRef.current) {
        activeEngineRef.current = 'audio';
        if (ytPlayerRef.current?.pauseVideo) {
          try { ytPlayerRef.current.pauseVideo(); } catch (e) {}
        }
        const localBlobUrl = URL.createObjectURL(offlineRecord.audioBlob);
        audioRef.current.src = localBlobUrl;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setIsPlaying(true);
        setIsLoading(false);
        addRecentTrack(track);

        if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
          prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
        }
        return;
      }
    } catch (e) {
      console.warn('Offline storage check skipped:', e);
    }

    // 2. Play immediately via native client YouTube Player (synchronous with user tap to satisfy mobile autoplay policies!)
    playViaYouTubePlayer(track);
    addRecentTrack(track);

    if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
      prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
    }
  }, [queue, playViaYouTubePlayer]);

  /**
   * Toggle play / pause
   */
  const togglePlay = useCallback(() => {
    if (!currentTrack) return;

    if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
      try {
        if (isPlaying) {
          ytPlayerRef.current.pauseVideo();
        } else {
          ytPlayerRef.current.playVideo();
        }
      } catch (e) {}
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(e => console.error('Play failed:', e));
      }
    }
  }, [isPlaying, currentTrack]);

  /**
   * Next track handler
   */
  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;

    if (repeatMode === 'one') {
      if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
        try {
          ytPlayerRef.current.seekTo(0, true);
          ytPlayerRef.current.playVideo();
          return;
        } catch (e) {}
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
        return;
      }
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
    if (currentTime > 3) {
      if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
        try { ytPlayerRef.current.seekTo(0, true); } catch (e) {}
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
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
    if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.seekTo(seconds, true);
        setCurrentTime(seconds);
      } catch (e) {}
    } else if (audioRef.current) {
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
