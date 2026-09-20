import { useState, useEffect, useRef, useCallback } from 'react';
import { getPlayableAudioUrl, prefetchNextTracks, resolveTrack, searchTracks } from '../services/api';
import { addRecentTrack, updateTrackInPlaylists } from '../services/storage';
import { getOfflineTrack } from '../services/offlineStorage';

// Fisher-Yates shuffle helper: produces a non-repeating permutation of indices
function generateShuffledDeck(length, startingIndex = -1) {
  if (length <= 1) return [0];
  const indices = [];
  for (let i = 0; i < length; i++) {
    if (i !== startingIndex) indices.push(i);
  }
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return startingIndex >= 0 ? [startingIndex, ...indices] : indices;
}

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

  // 3-state Shuffle: 'off' | 'standard' | 'smart'
  const [shuffleMode, setShuffleMode] = useState('off');
  const isShuffle = shuffleMode !== 'off';
  const [repeatMode, setRepeatMode] = useState('off'); // 'off' | 'all' | 'one'

  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);

  // Smart Shuffle and history references
  const shuffledIndicesRef = useRef([]);
  const shufflePosRef = useRef(0);
  const historyStackRef = useRef([]);
  const isFetchingSmartRef = useRef(false);

  const queueRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const currentTrackRef = useRef(null);
  const shuffleModeRef = useRef('off');
  const repeatModeRef = useRef('off');

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { shuffleModeRef.current = shuffleMode; }, [shuffleMode]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

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

    const currentQ = newQueue || queueRef.current;
    const targetIdx = indexInQueue >= 0
      ? indexInQueue
      : currentQ.findIndex(t => t.id === track.id || (t.title === track.title && t.artist === track.artist));

    if (newQueue) {
      setQueue(newQueue);
      queueRef.current = newQueue;
      setQueueIndex(targetIdx);
      queueIndexRef.current = targetIdx;
      if (shuffleModeRef.current !== 'off') {
        shuffledIndicesRef.current = generateShuffledDeck(newQueue.length, targetIdx);
        shufflePosRef.current = 0;
      }
    } else if (indexInQueue >= 0) {
      setQueueIndex(indexInQueue);
      queueIndexRef.current = indexInQueue;
    }

    let playableTrack = { ...track };
    const isUnresolved = !playableTrack.streamableId && (!playableTrack.id || playableTrack.id.startsWith('sp_'));

    setCurrentTrack(playableTrack);
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(playableTrack.durationSeconds || 0);

    if (isUnresolved) {
      try {
        const resolved = await resolveTrack(playableTrack);
        if (resolved && resolved.streamableId) {
          playableTrack.originalId = track.id;
          playableTrack.streamableId = resolved.streamableId;
          playableTrack.id = resolved.streamableId;
          if (resolved.thumbnail) {
            playableTrack.thumbnail = resolved.thumbnail;
          }
          if (resolved.durationSeconds) {
            playableTrack.durationSeconds = resolved.durationSeconds;
            setDuration(resolved.durationSeconds);
          }
          setCurrentTrack({ ...playableTrack });
          updateTrackInPlaylists(playableTrack);
        }
      } catch (err) {
        console.error('Failed to resolve track to streamable source:', err);
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

    // 2. Play immediately via native client YouTube Player
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
   * Fetch similar tracks by artist for Smart Shuffle ✨
   */
  const fetchSmartRecommendations = useCallback(async (artistName) => {
    if (isFetchingSmartRef.current || !artistName) return;
    isFetchingSmartRef.current = true;
    try {
      const candidates = await searchTracks(artistName);
      const existing = new Set(queueRef.current.map(t => (t.id || t.title).toLowerCase()));
      const filtered = candidates
        .filter(c => !existing.has((c.id || c.title).toLowerCase()))
        .slice(0, 4)
        .map(c => ({ ...c, isRecommendation: true }));

      if (filtered.length > 0) {
        setQueue(prev => {
          const updated = [...prev, ...filtered];
          queueRef.current = updated;
          const newIndices = [];
          for (let i = prev.length; i < updated.length; i++) {
            newIndices.push(i);
          }
          for (let i = newIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newIndices[i], newIndices[j]] = [newIndices[j], newIndices[i]];
          }
          shuffledIndicesRef.current = [...shuffledIndicesRef.current, ...newIndices];
          return updated;
        });
      }
    } catch (e) {
      console.warn('Smart shuffle recommendations failed:', e);
    } finally {
      isFetchingSmartRef.current = false;
    }
  }, []);

  /**
   * Next track handler (Supports Standard Non-Repeating Shuffle + Smart Shuffle ✨ Autoplay)
   */
  const nextTrack = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;

    if (repeatModeRef.current === 'one') {
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

    // Push played song to history stack for accurate previous navigation
    if (currentTrackRef.current) {
      historyStackRef.current.push({
        track: currentTrackRef.current,
        index: queueIndexRef.current
      });
      if (historyStackRef.current.length > 50) historyStackRef.current.shift();
    }

    // 1. SHUFFLE PLAYBACK (Standard non-repeating OR Smart ✨)
    if (shuffleModeRef.current !== 'off') {
      let nextPos = shufflePosRef.current + 1;

      // Smart Shuffle: fetch recommendations when nearing end
      if (shuffleModeRef.current === 'smart' && nextPos >= shuffledIndicesRef.current.length - 2) {
        if (currentTrackRef.current?.artist) {
          fetchSmartRecommendations(currentTrackRef.current.artist);
        }
      }

      if (nextPos >= shuffledIndicesRef.current.length) {
        if (shuffleModeRef.current === 'smart' || repeatModeRef.current === 'all') {
          // Autoplay & loop: reshuffle and continue without silence!
          shuffledIndicesRef.current = generateShuffledDeck(queueRef.current.length, -1);
          nextPos = 0;
        } else {
          return; // End of queue in regular shuffle
        }
      }

      shufflePosRef.current = nextPos;
      const targetQueueIdx = shuffledIndicesRef.current[nextPos];
      if (targetQueueIdx !== undefined && q[targetQueueIdx]) {
        setQueueIndex(targetQueueIdx);
        queueIndexRef.current = targetQueueIdx;
        playTrack(q[targetQueueIdx]);
      }
      return;
    }

    // 2. SEQUENTIAL PLAYBACK
    let nextIdx = queueIndexRef.current + 1;
    if (nextIdx >= q.length) {
      if (repeatModeRef.current === 'all') {
        nextIdx = 0;
      } else {
        return; // End of playlist
      }
    }

    setQueueIndex(nextIdx);
    queueIndexRef.current = nextIdx;
    playTrack(q[nextIdx]);
  }, [playTrack, fetchSmartRecommendations]);

  nextTrackRef.current = nextTrack;

  /**
   * Previous track handler (navigates backward in played history)
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

    // Return to previous song in history
    if (historyStackRef.current.length > 0) {
      const prevItem = historyStackRef.current.pop();
      if (prevItem && prevItem.track) {
        if (shuffleModeRef.current !== 'off') {
          shufflePosRef.current = Math.max(0, shufflePosRef.current - 1);
        }
        if (prevItem.index >= 0) {
          setQueueIndex(prevItem.index);
          queueIndexRef.current = prevItem.index;
        }
        playTrack(prevItem.track);
        return;
      }
    }

    // Fallback: previous index in queue
    const q = queueRef.current;
    if (q.length === 0) return;

    let prevIdx = queueIndexRef.current - 1;
    if (prevIdx < 0) {
      prevIdx = repeatModeRef.current === 'all' ? q.length - 1 : 0;
    }

    setQueueIndex(prevIdx);
    queueIndexRef.current = prevIdx;
    playTrack(q[prevIdx]);
  }, [playTrack, currentTime]);

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
   * Toggle shuffle mode (off -> standard -> smart -> off)
   */
  const toggleShuffle = useCallback(() => {
    setShuffleMode(prev => {
      let next = 'off';
      if (prev === 'off') next = 'standard';
      else if (prev === 'standard') next = 'smart';
      else next = 'off';

      if (next !== 'off') {
        const q = queueRef.current;
        const curIdx = queueIndexRef.current >= 0 ? queueIndexRef.current : 0;
        if (q.length > 0) {
          shuffledIndicesRef.current = generateShuffledDeck(q.length, curIdx);
          shufflePosRef.current = 0;
        }
        if (next === 'smart' && currentTrackRef.current?.artist) {
          fetchSmartRecommendations(currentTrackRef.current.artist);
        }
      }

      return next;
    });
  }, [fetchSmartRecommendations]);

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
    shuffleMode,
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
