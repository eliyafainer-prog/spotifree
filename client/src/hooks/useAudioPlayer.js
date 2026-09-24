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
  const userPausedRef = useRef(false);
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
  const isTransitioningRef = useRef(false);

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

  const [activeEngine, setActiveEngine] = useState('audio');

  // Initialize HTML5 Audio instance once and attach permanently to DOM
  useEffect(() => {
    let audio = document.getElementById('spotifree-native-audio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'spotifree-native-audio';
      audio.preload = 'auto';
      audio.playsInline = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }
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

    const handleError = () => {
      if (activeEngineRef.current === 'audio') {
        const err = audio.error;
        console.warn('Native HTML5 Audio error:', err ? `code=${err.code} msg=${err.message}` : 'unknown error');
        setIsLoading(false);
        // Do NOT fall back to YouTube video player on mobile background playback!
        // Instead, if network error occurred, retry streaming once
        if (err && err.code === 2 && currentTrackRef.current && !userPausedRef.current) {
          setTimeout(() => {
            if (audioRef.current && activeEngineRef.current === 'audio' && !userPausedRef.current) {
              audioRef.current.load();
              audioRef.current.play().catch(() => {});
            }
          }, 1500);
        }
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
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
        if (isTransitioningRef.current) return;
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

  // Screen Wake Lock: Keep mobile device screen awake during active playback to prevent playback interruption
  useEffect(() => {
    let wakeLockSentinel = null;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isPlaying) {
        try {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
        } catch (err) {
          // Wake lock request may fail if battery saver is on or tab not visible
        }
      }
    };

    if (isPlaying) {
      requestWakeLock();
    } else if (wakeLockSentinel) {
      try {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
      } catch (e) {}
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockSentinel) {
        try {
          wakeLockSentinel.release();
        } catch (e) {}
      }
    };
  }, [isPlaying]);

  /**
   * Lazily initialize YouTube Player ONLY if user explicitly needs it
   */
  const ensureYTPlayer = useCallback((onReadyCallback) => {
    if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
      onReadyCallback(ytPlayerRef.current);
      return;
    }

    let container = document.getElementById('spotifree-yt-player-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'spotifree-yt-player-container';
      container.style.cssText = 'position:fixed;bottom:0;left:0;width:100px;height:100px;opacity:0.01;pointer-events:none;z-index:-1;overflow:hidden';
      const playerDiv = document.createElement('div');
      playerDiv.id = 'spotifree-yt-player';
      container.appendChild(playerDiv);
      document.body.appendChild(container);
    }

    const startPlayer = () => {
      if (!window.YT || !window.YT.Player) {
        if (!document.getElementById('yt-iframe-api-script')) {
          const tag = document.createElement('script');
          tag.id = 'yt-iframe-api-script';
          tag.src = 'https://www.youtube.com/iframe_api';
          document.body.appendChild(tag);
        }
        setTimeout(startPlayer, 200);
        return;
      }

      if (!ytPlayerRef.current) {
        try {
          ytPlayerRef.current = new window.YT.Player('spotifree-yt-player', {
            height: '300',
            width: '300',
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              fs: 0,
              playsinline: 1,
              rel: 0
            },
            events: {
              onReady: (e) => {
                try {
                  if (typeof e.target.unMute === 'function') e.target.unMute();
                  e.target.setVolume(isMuted ? 0 : volume * 100);
                } catch (err) {}
                onReadyCallback(e.target);
              },
              onStateChange: (e) => {
                if (e.data === 1) { // PLAYING
                  isTransitioningRef.current = false;
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
          console.error('Failed to init YT player:', e);
        }
      } else {
        onReadyCallback(ytPlayerRef.current);
      }
    };

    startPlayer();
  }, [volume, isMuted]);

  /**
   * Play track using client-side YouTube Player API
   */
  const playViaYouTubePlayer = useCallback((track) => {
    if (!track || !track.id) return;

    isTransitioningRef.current = true;
    setCurrentTime(0);

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch (e) {}
    }

    activeEngineRef.current = 'yt';
    setActiveEngine('yt');
    setIsLoading(true);

    ensureYTPlayer((player) => {
      try {
        if (typeof player.unMute === 'function') player.unMute();
        player.setVolume(isMuted ? 0 : volume * 100);
        player.loadVideoById({
          videoId: track.id,
          startSeconds: 0,
          suggestedQuality: 'small'
        });
        player.playVideo();
      } catch (e) {
        console.error('Error in YT play:', e);
        setIsLoading(false);
      }
    });
  }, [volume, isMuted, ensureYTPlayer]);

  playViaYouTubePlayerRef.current = playViaYouTubePlayer;

  /**
   * Play track via native HTML5 Audio element streaming from our server proxy.
   * Enables true background playback, lock-screen controls,
   * headphone buttons support, and continuous background playlist advancing.
   */
  const playViaAudioElement = useCallback((track) => {
    if (!track || !track.id) return;

    isTransitioningRef.current = true;
    setCurrentTime(0);

    // Stop and pause YouTube player so it doesn't conflict
    if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === 'function') {
      try { ytPlayerRef.current.pauseVideo(); } catch (e) {}
    }

    activeEngineRef.current = 'audio';
    setActiveEngine('audio');
    setIsLoading(true);

    const audio = audioRef.current;
    if (!audio) return;

    try {
      audio.pause();
      const streamUrl = getPlayableAudioUrl(track);
      audio.src = streamUrl;
      audio.volume = isMuted ? 0 : volume;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            isTransitioningRef.current = false;
            setIsPlaying(true);
            setIsLoading(false);
          })
          .catch((err) => {
            console.warn('Native audio play status:', err.name, err.message);
            isTransitioningRef.current = false;
            setIsLoading(false);
            if (err.name === 'NotAllowedError') {
              setIsPlaying(false);
            }
          });
      }
    } catch (err) {
      console.warn('Native audio exception:', err);
      setIsLoading(false);
    }
  }, [volume, isMuted]);

  /**
   * Proactively resolve & prefetch upcoming tracks for zero-latency instant playback
   */
  const prefetchUpcomingTracks = useCallback((currentIdx, isShuffle = false) => {
    const q = queueRef.current;
    if (!q || q.length === 0) return;

    let targetTracks = [];
    if (isShuffle && shuffledIndicesRef.current.length > 0) {
      const curPos = shufflePosRef.current;
      const upcomingIndices = shuffledIndicesRef.current.slice(curPos + 1, curPos + 4);
      targetTracks = upcomingIndices.map(idx => q[idx]).filter(Boolean);
    } else if (currentIdx >= 0) {
      targetTracks = q.slice(currentIdx + 1, currentIdx + 4);
    }

    if (targetTracks.length === 0) return;

    // 1. Proactively resolve upcoming tracks so their YouTube videoId is cached beforehand
    targetTracks.forEach(t => {
      const needsResolve = !t.streamableId && (!t.id || t.id.startsWith('sp_'));
      if (needsResolve) {
        resolveTrack(t).then(res => {
          if (res && res.streamableId) {
            t.originalId = t.id;
            t.streamableId = res.streamableId;
            t.id = res.streamableId;
            if (res.thumbnail) t.thumbnail = res.thumbnail;
            if (res.durationSeconds) t.durationSeconds = res.durationSeconds;
            updateTrackInPlaylists(t);
            prefetchNextTracks([t]);
          }
        }).catch(() => {});
      }
    });

    // 2. Prefetch audio stream URLs on the backend
    prefetchNextTracks(targetTracks);
  }, []);

  /**
   * Play specific track from a given playlist or queue
   */
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;
    userPausedRef.current = false;
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

        prefetchUpcomingTracks(targetIdx, shuffleModeRef.current !== 'off');
        return;
      }
    } catch (e) {
      console.warn('Offline storage check skipped:', e);
    }

    // 2. Play via native HTML5 Audio element (Background & Lock-Screen First)
    playViaAudioElement(playableTrack);
    addRecentTrack(playableTrack);

    prefetchUpcomingTracks(targetIdx, shuffleModeRef.current !== 'off');
  }, [queue, playViaAudioElement, prefetchUpcomingTracks]);

  /**
   * Explicit Play handler (crucial for MediaSession lock-screen controls)
   */
  const play = useCallback(() => {
    userPausedRef.current = false;
    if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
      try {
        if (typeof ytPlayerRef.current.unMute === 'function') {
          ytPlayerRef.current.unMute();
        }
        ytPlayerRef.current.playVideo();
      } catch (e) {}
    } else if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, []);

  /**
   * Explicit Pause handler
   */
  const pause = useCallback(() => {
    userPausedRef.current = true;
    if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.pauseVideo();
      } catch (e) {}
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  /**
   * Toggle play / pause
   */
  const togglePlay = useCallback(() => {
    if (!currentTrack) return;
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, currentTrack, play, pause]);

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
        // Continuous non-repeating loop: reshuffle smoothly so playback never abruptly dies
        shuffledIndicesRef.current = generateShuffledDeck(queueRef.current.length, -1);
        nextPos = 0;
      }

      shufflePosRef.current = nextPos;
      const targetQueueIdx = shuffledIndicesRef.current[nextPos];
      if (targetQueueIdx !== undefined && q[targetQueueIdx]) {
        setQueueIndex(targetQueueIdx);
        queueIndexRef.current = targetQueueIdx;
        playTrack(q[targetQueueIdx]);
        prefetchUpcomingTracks(targetQueueIdx, true);
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
    prefetchUpcomingTracks(nextIdx, false);
  }, [playTrack, fetchSmartRecommendations, prefetchUpcomingTracks]);

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
   * Dedicated instant non-repeating shuffle start with prefetching
   */
  const playShuffled = useCallback((trackList, startIdx = -1) => {
    if (!trackList || trackList.length === 0) return;

    const chosenIdx = startIdx >= 0 && startIdx < trackList.length
      ? startIdx
      : Math.floor(Math.random() * trackList.length);

    setShuffleMode('standard');
    shuffleModeRef.current = 'standard';

    const deck = generateShuffledDeck(trackList.length, chosenIdx);
    shuffledIndicesRef.current = deck;
    shufflePosRef.current = 0;

    setQueue(trackList);
    queueRef.current = trackList;
    setQueueIndex(chosenIdx);
    queueIndexRef.current = chosenIdx;

    playTrack(trackList[chosenIdx]);
    prefetchUpcomingTracks(chosenIdx, true);
  }, [playTrack, prefetchUpcomingTracks]);

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
    activeEngine,
    queue,
    queueIndex,
    playTrack,
    playShuffled,
    play,
    pause,
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
