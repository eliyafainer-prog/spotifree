import { useState, useEffect, useRef, useCallback } from 'react';
import { getPlayableAudioUrl, fetchDirectStreamUrl, prefetchNextTracks, resolveTrack, getCachedTrackResolution, searchTracks } from '../services/api';
import { addRecentTrack, updateTrackInPlaylists, isSameTrack, getLastPlaybackState, saveLastPlaybackState } from '../services/storage';
import { getOfflineTrack, revokeOfflineObjectUrl } from '../services/offlineStorage';

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
  const silentAudioRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytTimerRef = useRef(null);
  const activeEngineRef = useRef('audio');
  const fallbackTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const activeBlobUrlRef = useRef(null);
  const isOfflinePlaybackRef = useRef(false);
  const nextTrackRef = useRef(null);
  const userPausedRef = useRef(false);
  const playViaYouTubePlayerRef = useRef(null);
  const playSessionIdRef = useRef(0);

  const revokeActiveBlobUrl = useCallback(() => {
    if (activeBlobUrlRef.current) {
      revokeOfflineObjectUrl(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
  }, []);

  const savedPlayback = useRef(getLastPlaybackState()).current;

  const [currentTrack, setCurrentTrack] = useState(() => savedPlayback?.currentTrack || null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(null);
  const clearPlaybackError = useCallback(() => setPlaybackError(null), []);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => savedPlayback?.currentTrack?.durationSeconds || 0);
  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = localStorage.getItem('spotifree_volume');
      if (saved !== null) {
        const parsed = parseFloat(saved);
        if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
      }
    } catch (e) {}
    return 0.8;
  });
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem('spotifree_muted') === 'true';
    } catch (e) {
      return false;
    }
  });

  // 3-state Shuffle: 'off' | 'standard' | 'smart'
  const [shuffleMode, setShuffleMode] = useState(() => {
    const m = savedPlayback?.shuffleMode;
    return (m === 'standard' || m === 'smart') ? m : 'off';
  });
  const isShuffle = shuffleMode !== 'off';
  const [repeatMode, setRepeatMode] = useState(() => {
    const r = savedPlayback?.repeatMode;
    return (r === 'all' || r === 'one') ? r : 'off';
  }); // 'off' | 'all' | 'one'

  const [queue, setQueue] = useState(() => Array.isArray(savedPlayback?.queue) ? savedPlayback.queue : []);
  const [queueIndex, setQueueIndex] = useState(() => Number.isInteger(savedPlayback?.queueIndex) ? savedPlayback.queueIndex : -1);

  // Smart Shuffle and history references
  const shuffledIndicesRef = useRef([]);
  const shufflePosRef = useRef(0);
  const historyStackRef = useRef([]);
  const isFetchingSmartRef = useRef(false);
  const isTransitioningRef = useRef(false);
  const retryCountRef = useRef(0);

  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);
  const currentTrackRef = useRef(currentTrack);
  const shuffleModeRef = useRef(shuffleMode);
  const repeatModeRef = useRef(repeatMode);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { shuffleModeRef.current = shuffleMode; }, [shuffleMode]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

  // Persist playback state to localStorage
  useEffect(() => {
    if (currentTrack) {
      saveLastPlaybackState({
        currentTrack,
        queue: queue.slice(0, 100),
        queueIndex,
        shuffleMode,
        repeatMode
      });
    }
  }, [currentTrack, queue, queueIndex, shuffleMode, repeatMode]);

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

    let silentAudio = document.getElementById('spotifree-silent-audio');
    if (!silentAudio) {
      silentAudio = document.createElement('audio');
      silentAudio.id = 'spotifree-silent-audio';
      silentAudio.src = '/silent.mp3';
      silentAudio.loop = true;
      silentAudio.playsInline = true;
      silentAudio.setAttribute('playsinline', 'true');
      silentAudio.setAttribute('webkit-playsinline', 'true');
      silentAudio.style.display = 'none';
      document.body.appendChild(silentAudio);
    }
    silentAudioRef.current = silentAudio;

    const handleTimeUpdate = () => {
      if (activeEngineRef.current === 'audio') {
        setCurrentTime(audio.currentTime || 0);
      }
    };

    const handleDurationChange = () => {
      if (activeEngineRef.current === 'audio' && audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        const knownDur = currentTrackRef.current?.durationSeconds || 0;
        if (audio.duration < 35 && knownDur > 40) {
          setDuration(knownDur);
        } else {
          setDuration(audio.duration);
        }
      }
    };

    const handleWaiting = () => {
      if (activeEngineRef.current === 'audio') setIsLoading(true);
    };

    const handleCanPlay = () => {
      if (activeEngineRef.current === 'audio') {
        isTransitioningRef.current = false;
        setIsLoading(false);
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      }
    };

    const handlePlay = () => {
      if (activeEngineRef.current === 'audio') {
        isTransitioningRef.current = false;
        setIsPlaying(true);
        setIsLoading(false);
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      }
    };

    const handlePause = () => {
      if (activeEngineRef.current === 'audio' && !isTransitioningRef.current) {
        setIsPlaying(false);
      }
    };

    const handleEnded = () => {
      if (activeEngineRef.current === 'audio') {
        nextTrackRef.current?.();
      }
    };

    const handleError = () => {
      if (activeEngineRef.current !== 'audio') return;
      const srcAttr = audio.getAttribute('src');
      if (!srcAttr) return; // Ignore empty src reset

      // If a local offline blob fails or is corrupted, fall back to streaming from network!
      if (isOfflinePlaybackRef.current || srcAttr.startsWith('blob:')) {
        console.warn('Local offline blob playback failed, falling back to network stream...');
        isOfflinePlaybackRef.current = false;
        if (activeBlobUrlRef.current) {
          revokeOfflineObjectUrl(activeBlobUrlRef.current);
          activeBlobUrlRef.current = null;
        }
        if (currentTrackRef.current && typeof navigator !== 'undefined' && navigator.onLine) {
          const networkUrl = getPlayableAudioUrl(currentTrackRef.current);
          audioRef.current.src = networkUrl;
          audioRef.current.load();
          audioRef.current.play().then(() => {
            setIsPlaying(true);
            setIsLoading(false);
          }).catch(() => {
            setIsLoading(false);
            setIsPlaying(false);
            setPlaybackError('שגיאה בניגון השיר');
          });
          return;
        }
        setIsLoading(false);
        setIsPlaying(false);
        setPlaybackError('שגיאה בניגון הקובץ השמור');
        return;
      }

      const err = audio.error;
      console.warn('Native HTML5 Audio error:', err ? `code=${err.code} msg=${err.message}` : 'unknown error');
      const activeSession = playSessionIdRef.current;

      if (currentTrackRef.current && !userPausedRef.current && retryCountRef.current < 3) {
        retryCountRef.current++;
        const attempt = retryCountRef.current;
        const savedPos = (audioRef.current?.currentTime > 2) ? audioRef.current.currentTime : 0;
        if (attempt <= 2) {
          // Retry 1 & 2: Re-request server stream proxy on native <audio> (preserves 100% background playback & zero ads!)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (
              playSessionIdRef.current !== activeSession ||
              userPausedRef.current ||
              isOfflinePlaybackRef.current ||
              !audioRef.current ||
              (audioRef.current.getAttribute('src') || '').startsWith('blob:')
            ) {
              return;
            }
            const retryUrl = `${getPlayableAudioUrl(currentTrackRef.current)}&retry=${Date.now()}`;
            audioRef.current.src = retryUrl;
            audioRef.current.load();
            audioRef.current.play().then(() => {
              if (savedPos > 0 && audioRef.current) {
                audioRef.current.currentTime = savedPos;
              }
            }).catch(() => {});
          }, attempt * 350);
          return;
        }
        if (attempt === 3) {
          // Retry 3: Try direct stream URL on native <audio> to preserve background playback
          fetchDirectStreamUrl(currentTrackRef.current).then(directUrl => {
            if (
              playSessionIdRef.current !== activeSession ||
              userPausedRef.current ||
              isOfflinePlaybackRef.current ||
              (audioRef.current?.getAttribute('src') || '').startsWith('blob:')
            ) {
              return;
            }
            if (directUrl && audioRef.current && activeEngineRef.current === 'audio') {
              audioRef.current.src = directUrl;
              audioRef.current.load();
              audioRef.current.play().catch(() => {});
            } else {
              setIsLoading(false);
            }
          }).catch(() => {
            if (playSessionIdRef.current !== activeSession || userPausedRef.current) return;
            setIsLoading(false);
          });
          return;
        }
      }
      setIsLoading(false);
      setIsPlaying(false);
      setPlaybackError('לא נמצא מקור שמע זמין לשיר זה');
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
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (activeBlobUrlRef.current) {
        revokeOfflineObjectUrl(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
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

  // Sync volume & mute changes to players and localStorage
  useEffect(() => {
    const safeVol = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
    const vol = isMuted ? 0 : safeVol;
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
    if (ytPlayerRef.current && typeof ytPlayerRef.current.setVolume === 'function') {
      try {
        ytPlayerRef.current.setVolume(vol * 100);
      } catch (e) {}
    }
    try {
      localStorage.setItem('spotifree_volume', safeVol.toString());
      localStorage.setItem('spotifree_muted', isMuted ? 'true' : 'false');
    } catch (e) {}
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
                if (activeEngineRef.current !== 'yt') {
                  try {
                    e.target.pauseVideo();
                    e.target.mute();
                  } catch (err) {}
                  return;
                }
                if (e.data === 1) { // PLAYING
                  isTransitioningRef.current = false;
                  setIsPlaying(true);
                  setIsLoading(false);
                } else if (e.data === 2) { // PAUSED
                  if (!userPausedRef.current && activeEngineRef.current === 'yt') {
                    console.log('System auto-paused YT player (background), forcing resume...');
                    setTimeout(() => {
                      if (!userPausedRef.current && activeEngineRef.current === 'yt') e.target.playVideo();
                    }, 100);
                  } else {
                    setIsPlaying(false);
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
    revokeActiveBlobUrl();
    isOfflinePlaybackRef.current = false;

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
        silentAudioRef.current?.play().catch(() => {});
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
  const playViaAudioElement = useCallback((track, sessionId) => {
    if (!track) return;

    const currentSession = sessionId || ++playSessionIdRef.current;
    retryCountRef.current = 0;
    isTransitioningRef.current = true;
    setCurrentTime(0);

    // Stop, mute, and pause YouTube player so it never overlaps or plays in background!
    if (ytPlayerRef.current) {
      try {
        if (typeof ytPlayerRef.current.mute === 'function') ytPlayerRef.current.mute();
        if (typeof ytPlayerRef.current.stopVideo === 'function') ytPlayerRef.current.stopVideo();
        if (typeof ytPlayerRef.current.pauseVideo === 'function') ytPlayerRef.current.pauseVideo();
      } catch (e) {}
    }

    activeEngineRef.current = 'audio';
    setActiveEngine('audio');
    setIsLoading(true);

    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      // Always revoke any previous Blob URL before creating or assigning a new src to prevent memory leaks!
      revokeActiveBlobUrl();

      let streamUrl;
      if (track.audioBlob) {
        isOfflinePlaybackRef.current = true;
        streamUrl = URL.createObjectURL(track.audioBlob);
        activeBlobUrlRef.current = streamUrl;
      } else {
        isOfflinePlaybackRef.current = false;
        streamUrl = getPlayableAudioUrl(track);
      }

      audio.src = streamUrl;
      audio.volume = isMuted ? 0 : (Number.isFinite(volume) ? volume : 0.8);

      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (playSessionIdRef.current !== currentSession) return;
            isTransitioningRef.current = false;
            setIsPlaying(true);
            setIsLoading(false);
            if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
          })
          .catch((err) => {
            // Ignore AbortError when interrupted by rapid Next/Prev or selecting a new song
            if (err?.name === 'AbortError' || playSessionIdRef.current !== currentSession) {
              return;
            }
            console.warn('Native audio play status:', err.name, err.message);
            if (err?.name === 'NotAllowedError') {
              isTransitioningRef.current = false;
              setIsPlaying(false);
              setIsLoading(false);
              return;
            }
            // Let the audio 'error' event listener handle progressive retry on <audio>
          });
      }
    } catch (err) {
      if (playSessionIdRef.current !== currentSession) return;
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
      const upcomingIndices = shuffledIndicesRef.current.slice(curPos + 1, curPos + 3);
      targetTracks = upcomingIndices.map(idx => q[idx]).filter(Boolean);
    } else if (currentIdx >= 0) {
      targetTracks = q.slice(currentIdx + 1, currentIdx + 3);
    }

    if (targetTracks.length === 0) return;

    const readyTracks = [];

    // 1. Proactively resolve upcoming tracks so their studio YouTube videoId & artwork are cached beforehand
    targetTracks.forEach(t => {
      const needsResolve = (!t.streamableId && (!t.id || t.id.startsWith('sp_'))) || t.hasCustomArtwork === false || t.studioResolvedV3 === false;
      if (needsResolve) {
        resolveTrack(t).then(res => {
          if (res && res.streamableId) {
            t.originalId = t.originalId || t.id;
            t.streamableId = res.streamableId;
            t.id = res.streamableId;
            t.hasCustomArtwork = true;
            t.studioResolvedV3 = true;
            if (res.thumbnail) t.thumbnail = res.thumbnail;
            if ((!t.durationSeconds || t.durationSeconds > 420) && res.durationSeconds) {
              t.durationSeconds = res.durationSeconds;
            }
            updateTrackInPlaylists(t);
            prefetchNextTracks([t]);
          }
        }).catch(() => {});
      } else {
        readyTracks.push(t);
      }
    });

    // 2. Prefetch audio stream URLs on the backend for already-resolved tracks
    if (readyTracks.length > 0) {
      prefetchNextTracks(readyTracks);
    }
  }, []);

  /**
   * Play specific track from a given playlist or queue
   */
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;
    const sessionId = ++playSessionIdRef.current;
    userPausedRef.current = false;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);

    const currentQ = newQueue || queueRef.current;
    const targetIdx = indexInQueue >= 0
      ? indexInQueue
      : currentQ.findIndex(t => isSameTrack(t, track));

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
    } else if (targetIdx >= 0) {
      setQueueIndex(targetIdx);
      queueIndexRef.current = targetIdx;
    }

    let playableTrack = { ...track, originalId: track.originalId || track.id };

    // Apply synchronous cache hit immediately if already resolved in memory/localStorage
    const syncResolved = getCachedTrackResolution(playableTrack);
    if (syncResolved && syncResolved.streamableId) {
      playableTrack.streamableId = syncResolved.streamableId;
      playableTrack.id = syncResolved.streamableId;
      playableTrack.hasCustomArtwork = true;
      playableTrack.studioResolvedV3 = true;
      if (syncResolved.thumbnail) playableTrack.thumbnail = syncResolved.thumbnail;
      if ((!playableTrack.durationSeconds || playableTrack.durationSeconds > 420) && syncResolved.durationSeconds) {
        playableTrack.durationSeconds = syncResolved.durationSeconds;
      }
    } else if (playableTrack.streamableId && !playableTrack.streamableId.startsWith('sp_')) {
      playableTrack.id = playableTrack.streamableId;
    }

    setCurrentTrack(playableTrack);
    currentTrackRef.current = playableTrack;
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(playableTrack.durationSeconds || 0);
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    addRecentTrack(playableTrack);

    // STRICT OFFLINE PRIORITY: Always check IndexedDB local offline storage BEFORE initiating any network stream!
    if (playableTrack.audioBlob) {
      playViaAudioElement(playableTrack, sessionId);
      prefetchUpcomingTracks(targetIdx, shuffleModeRef.current !== 'off');
    } else {
      const offlineRecord = await getOfflineTrack(playableTrack).catch(() => null);
      if (playSessionIdRef.current !== sessionId || userPausedRef.current) return;

      if (offlineRecord && offlineRecord.audioBlob) {
        const offlinePlayable = {
          ...playableTrack,
          audioBlob: offlineRecord.audioBlob,
          thumbnail: offlineRecord.thumbnail || playableTrack.thumbnail,
          durationSeconds: offlineRecord.durationSeconds || playableTrack.durationSeconds
        };
        setCurrentTrack(offlinePlayable);
        currentTrackRef.current = offlinePlayable;
        playViaAudioElement(offlinePlayable, sessionId);
        prefetchUpcomingTracks(targetIdx, shuffleModeRef.current !== 'off');
        return;
      }

      // Not saved in Offline DB -> stream from server
      playViaAudioElement(playableTrack, sessionId);
      prefetchUpcomingTracks(targetIdx, shuffleModeRef.current !== 'off');
    }

    // Background metadata/artwork enrichment for unresolved Spotify tracks
    const needsAsyncResolve = (!playableTrack.streamableId && (!playableTrack.id || playableTrack.id.startsWith('sp_'))) || playableTrack.hasCustomArtwork === false || playableTrack.studioResolvedV3 === false;
    if (needsAsyncResolve) {
      resolveTrack(playableTrack).then(resolved => {
        if (!resolved || !resolved.streamableId) return;
        const enriched = {
          ...playableTrack,
          originalId: track.originalId || track.id,
          streamableId: resolved.streamableId,
          id: resolved.streamableId,
          hasCustomArtwork: true,
          studioResolvedV3: true,
          thumbnail: resolved.thumbnail || playableTrack.thumbnail,
          durationSeconds: (playableTrack.durationSeconds && playableTrack.durationSeconds <= 420)
            ? playableTrack.durationSeconds
            : (resolved.durationSeconds || playableTrack.durationSeconds)
        };
        if (targetIdx >= 0 && queueRef.current[targetIdx]) {
          Object.assign(queueRef.current[targetIdx], enriched);
        }
        updateTrackInPlaylists(enriched);
        if (playSessionIdRef.current === sessionId) {
          setCurrentTrack(enriched);
          currentTrackRef.current = enriched;
          if (enriched.durationSeconds && (!audioRef.current?.duration || !isFinite(audioRef.current.duration))) {
            setDuration(enriched.durationSeconds);
          }
        }
      }).catch(() => {});
    }
  }, [playViaAudioElement, prefetchUpcomingTracks]);

  /**
   * Explicit Play handler (crucial for MediaSession lock-screen controls)
   */
  const play = useCallback(() => {
    userPausedRef.current = false;
    silentAudioRef.current?.play().catch(() => {});
    if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
      try {
        if (typeof ytPlayerRef.current.unMute === 'function') {
          ytPlayerRef.current.unMute();
        }
        ytPlayerRef.current.playVideo();
      } catch (e) {}
    } else if (audioRef.current) {
      if (!audioRef.current.getAttribute('src') && currentTrackRef.current) {
        playTrack(currentTrackRef.current);
        return;
      }
      audioRef.current.play().catch(() => {});
    }
  }, [playTrack]);

  /**
   * Explicit Pause handler
   */
  const pause = useCallback(() => {
    userPausedRef.current = true;
    silentAudioRef.current?.pause();
    if (activeEngineRef.current === 'yt' && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.pauseVideo();
      } catch (e) {}
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
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
    if (!Number.isFinite(seconds) || seconds < 0) return;
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
    if (!Number.isFinite(val)) return;
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

  const removeFromQueue = useCallback((index) => {
    setQueue(prev => prev.filter((_, idx) => idx !== index));
    setQueueIndex(prev => (index < prev ? prev - 1 : prev));
  }, []);

  const moveInQueue = useCallback((fromIndex, toIndex) => {
    setQueue(prev => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setQueueIndex(prev => {
      if (prev === fromIndex) return toIndex;
      if (fromIndex < prev && toIndex >= prev) return prev - 1;
      if (fromIndex > prev && toIndex <= prev) return prev + 1;
      return prev;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue(prev => (currentTrackRef.current ? [currentTrackRef.current] : []));
    setQueueIndex(0);
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
    addToQueue,
    removeFromQueue,
    moveInQueue,
    clearQueue,
    playbackError,
    clearPlaybackError
  };
}
