import { useState, useEffect, useRef, useCallback } from 'react';
import { getPlayableAudioUrl, prefetchNextTracks, resolveTrack } from '../services/api';
import { addRecentTrack, updateTrackInPlaylists } from '../services/storage';
import { getOfflineTrack } from '../services/offlineStorage';

/**
 * Intelligent Dual-Engine Audio Player for SpotiFree:
 * Engine 1 (Primary): Direct Native HTML5 Audio Stream for 100% background playback with screen locked.
 * Engine 2 (Fallback): Embedded YouTube Player for 100% cloud resilience when datacenter IPs are blocked.
 */
export function useAudioPlayer() {
  const audioRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytTimerRef = useRef(null);
  const activeEngineRef = useRef('audio');
  const fallbackTimerRef = useRef(null);
  const nextTrackRef = useRef(null);
  const userPausedRef = useRef(false);
  const currentTrackRef = useRef(null);
  const playViaYouTubePlayerRef = useRef(null);

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
      if (activeEngineRef.current === 'audio') {
        if (audio.currentTime !== undefined && !isNaN(audio.currentTime)) {
          setCurrentTime(audio.currentTime);
        }
        if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
      }
    };

    const handleDurationChange = () => {
      if (activeEngineRef.current === 'audio' && audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
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
        if (!userPausedRef.current && currentTrackRef.current) {
          // System / OS attempted to pause in background -> auto resume!
          audio.play().catch(() => {
            setIsPlaying(false);
          });
        } else {
          setIsPlaying(false);
        }
      }
    };

    const handleEnded = () => {
      if (activeEngineRef.current === 'audio') {
        nextTrackRef.current?.();
      }
    };

    const handleError = (e) => {
      if (activeEngineRef.current === 'audio') {
        console.warn('HTML5 Audio error, activating YouTube fallback:', e);
        if (currentTrackRef.current && playViaYouTubePlayerRef.current) {
          playViaYouTubePlayerRef.current(currentTrackRef.current);
        }
      }
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

  // Background Audio Guardian: keep playing through visibility changes, blur & app switching
  useEffect(() => {
    const handleWakeup = () => {
      if (!userPausedRef.current && currentTrackRef.current) {
        if (activeEngineRef.current === 'audio' && audioRef.current?.paused) {
          audioRef.current.play().catch(() => {});
        } else if (activeEngineRef.current === 'yt' && ytPlayerRef.current?.playVideo) {
          try { ytPlayerRef.current.playVideo(); } catch (e) {}
        }
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

  // Initialize YouTube Player immediately on mount so it's warm and ready
  useEffect(() => {
    let checkTimer = null;
    const initYT = () => {
      if (!window.YT || !window.YT.Player) {
        checkTimer = setTimeout(initYT, 200);
        return;
      }
      const el = document.getElementById('spotifree-yt-player');
      if (!el) {
        checkTimer = setTimeout(initYT, 200);
        return;
      }
      if (!ytPlayerRef.current) {
        try {
          ytPlayerRef.current = new window.YT.Player('spotifree-yt-player', {
            height: '200',
            width: '200',
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
                  userPausedRef.current = false;
                  setIsPlaying(true);
                  setIsLoading(false);
                } else if (e.data === 2) { // PAUSED
                  setIsPlaying(false);
                  if (!userPausedRef.current) {
                    try { e.target.playVideo(); } catch (err) {}
                  }
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
   * Play track using client-side YouTube Player API (100% resilient fallback)
   */
  const playViaYouTubePlayer = useCallback((track) => {
    if (!track || !track.id) return;

    userPausedRef.current = false;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);

    // Stop HTML5 audio so it doesn't conflict
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.removeAttribute('src');
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

  playViaYouTubePlayerRef.current = playViaYouTubePlayer;

  /**
   * Play specific track from queue or playlist
   */
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);

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
        addRecentTrack(playableTrack);

        if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
          prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
        }
        return;
      }
    } catch (e) {
      console.warn('Offline storage check skipped:', e);
    }

    // 2. Play via direct audio stream on HTML5 Audio (Native background audio on iOS/Android!)
    if (audioRef.current && playableTrack.id) {
      try {
        activeEngineRef.current = 'audio';
        if (ytPlayerRef.current?.pauseVideo) {
          try { ytPlayerRef.current.pauseVideo(); } catch (e) {}
        }
        const streamUrl = getPlayableAudioUrl(playableTrack);
        audioRef.current.src = streamUrl;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setIsPlaying(true);
        setIsLoading(false);
        addRecentTrack(playableTrack);

        // Health monitor: if stream stalls at 0:00 for more than 4 seconds, fallback to YouTube
        fallbackTimerRef.current = setTimeout(() => {
          if (activeEngineRef.current === 'audio' && audioRef.current && audioRef.current.currentTime === 0 && !audioRef.current.paused) {
            console.warn('Audio stream stalled at 0:00, falling back to YouTube engine...');
            playViaYouTubePlayer(playableTrack);
          }
        }, 4000);

        if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
          prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
        }
        return;
      } catch (err) {
        console.warn('Direct audio stream start failed, falling back to YouTube:', err);
      }
    }

    // 3. Fallback: Play via native client YouTube Player
    playViaYouTubePlayer(playableTrack);
    addRecentTrack(playableTrack);

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
        const state = typeof ytPlayerRef.current.getPlayerState === 'function'
          ? ytPlayerRef.current.getPlayerState()
          : (isPlaying ? 1 : 2);

        if (state === 1) { // Currently PLAYING -> pause
          userPausedRef.current = true;
          ytPlayerRef.current.pauseVideo();
          setIsPlaying(false);
        } else { // Currently PAUSED -> play
          userPausedRef.current = false;
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
        }
      } catch (e) {
        console.error('togglePlay error:', e);
      }
    } else if (audioRef.current) {
      if (!audioRef.current.paused) {
        userPausedRef.current = true;
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        userPausedRef.current = false;
        audioRef.current.play().catch(e => console.error('Play failed:', e));
        setIsPlaying(true);
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
        audioRef.current.play().catch(() => {});
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
      try {
        audioRef.current.currentTime = seconds;
        setCurrentTime(seconds);
      } catch (e) {}
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
