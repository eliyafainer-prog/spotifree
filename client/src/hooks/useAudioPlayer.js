import { getPlayableAudioUrl, prefetchNextTracks } from '../services/api';
import { addRecentTrack } from '../services/storage';
import { getOfflineTrack } from '../services/offlineStorage';

export function useAudioPlayer() {
  const audioRef = useRef(null);

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
    audio.volume = volume;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  // Sync volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
      localStorage.setItem('spotifree_volume', volume.toString());
    }
  }, [volume, isMuted]);

  /**
   * Play specific track from a given playlist or queue
   */
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;

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

    try {
      // 1. Check Offline Storage first (0ms instant playback without internet!)
      const offlineRecord = await getOfflineTrack(track);
      if (offlineRecord && offlineRecord.audioBlob && audioRef.current) {
        const localBlobUrl = URL.createObjectURL(offlineRecord.audioBlob);
        audioRef.current.src = localBlobUrl;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setIsPlaying(true);
        setIsLoading(false);
        addRecentTrack(track);

        // Pre-fetch next track in queue
        if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
          prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
        }
        return;
      }

      // 2. Stream from network immediately
      const audioUrl = getPlayableAudioUrl(track);
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setIsPlaying(true);
        setIsLoading(false);
        addRecentTrack(track);

        // Pre-fetch next tracks in background to eliminate next song wait time
        if (targetIdx >= 0 && targetIdx + 1 < currentQ.length) {
          prefetchNextTracks(currentQ.slice(targetIdx + 1, targetIdx + 3));
        }
      }
    } catch (err) {
      console.error('Error playing track:', err);
      setIsLoading(false);
      setIsPlaying(false);
    }
  }, [queue]);

  /**
   * Toggle play / pause
   */
  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentTrack) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error('Play failed:', e));
    }
  }, [isPlaying, currentTrack]);

  /**
   * Next track handler
   */
  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;

    if (repeatMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
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

  /**
   * Previous track handler
   */
  const prevTrack = useCallback(() => {
    if (!audioRef.current) return;

    // If more than 3 seconds in, restart current track
    if (audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }

    if (queue.length === 0) return;

    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      prevIdx = repeatMode === 'all' ? queue.length - 1 : 0;
    }

    setQueueIndex(prevIdx);
    playTrack(queue[prevIdx]);
  }, [queue, queueIndex, repeatMode, playTrack]);

  // Handle track end event
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      nextTrack();
    };

    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('ended', handleEnded);
    };
  }, [nextTrack]);

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
