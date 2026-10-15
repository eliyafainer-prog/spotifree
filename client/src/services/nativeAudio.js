import { registerPlugin, Capacitor } from '@capacitor/core';

// Dynamically register the native Android BackgroundAudio plugin
export const BackgroundAudio = registerPlugin('BackgroundAudio');

export const isNativeApp = Capacitor.isNativePlatform();

/**
 * Play audio stream URL directly in native Android ExoPlayer
 */
export async function playNativeStreamUrl({ url, title, artist, thumbnail }) {
  if (!isNativeApp) return;

  try {
    let resolvedThumbnail = thumbnail || '';
    if (resolvedThumbnail && resolvedThumbnail.startsWith('/')) {
      resolvedThumbnail = window.location.origin + resolvedThumbnail;
    }

    await BackgroundAudio.playUrl({
      url,
      title: title || 'SpotiFree',
      artist: artist || 'Playing music',
      thumbnail: resolvedThumbnail
    });
  } catch (err) {
    console.warn('Native playNativeStreamUrl error:', err);
  }
}

/**
 * Pause native Android playback
 */
export async function pauseNativeAudio() {
  if (!isNativeApp) return;
  try {
    await BackgroundAudio.pause();
  } catch (err) {
    console.warn('Native pauseNativeAudio error:', err);
  }
}

/**
 * Resume native Android playback
 */
export async function resumeNativeAudio() {
  if (!isNativeApp) return;
  try {
    await BackgroundAudio.resume();
  } catch (err) {
    console.warn('Native resumeNativeAudio error:', err);
  }
}

/**
 * Seek native Android playback
 */
export async function seekNativeAudio(positionSec) {
  if (!isNativeApp) return;
  try {
    await BackgroundAudio.seekTo({ position: positionSec });
  } catch (err) {
    console.warn('Native seekNativeAudio error:', err);
  }
}

/**
 * Update native Android foreground service notification and lock-screen metadata
 */
export async function updateNativePlayback({ title, artist, thumbnail, isPlaying }) {
  if (!isNativeApp) return;

  try {
    let resolvedThumbnail = thumbnail || '';
    if (resolvedThumbnail && resolvedThumbnail.startsWith('/')) {
      resolvedThumbnail = window.location.origin + resolvedThumbnail;
    }

    await BackgroundAudio.update({
      title: title || 'SpotiFree',
      artist: artist || 'Playing music',
      thumbnail: resolvedThumbnail,
      isPlaying: Boolean(isPlaying)
    });
  } catch (err) {
    console.warn('Native BackgroundAudio.update error:', err);
  }
}

/**
 * Stop native Android foreground service
 */
export async function stopNativePlayback() {
  if (!isNativeApp) return;

  try {
    await BackgroundAudio.stop();
  } catch (err) {
    console.warn('Native BackgroundAudio.stop error:', err);
  }
}

/**
 * Register listener for headphone controls, notification buttons, and player events
 */
export function registerNativeMediaListener(callback) {
  if (!isNativeApp) return () => {};

  try {
    const handle = BackgroundAudio.addListener('mediaAction', (event) => {
      if (event && event.action && typeof callback === 'function') {
        callback(event.action);
      }
    });

    return () => {
      handle.then(h => h.remove()).catch(() => {});
    };
  } catch (err) {
    console.warn('registerNativeMediaListener error:', err);
    return () => {};
  }
}

/**
 * Register listener for native progress updates
 */
export function registerNativeProgressListener(callback) {
  if (!isNativeApp) return () => {};

  try {
    const handle = BackgroundAudio.addListener('progress', (event) => {
      if (event && event.position !== undefined && typeof callback === 'function') {
        callback(event.position);
      }
    });

    return () => {
      handle.then(h => h.remove()).catch(() => {});
    };
  } catch (err) {
    console.warn('registerNativeProgressListener error:', err);
    return () => {};
  }
}

/**
 * Register listener for native duration updates
 */
export function registerNativeDurationListener(callback) {
  if (!isNativeApp) return () => {};

  try {
    const handle = BackgroundAudio.addListener('duration', (event) => {
      if (event && event.duration !== undefined && typeof callback === 'function') {
        callback(event.duration);
      }
    });

    return () => {
      handle.then(h => h.remove()).catch(() => {});
    };
  } catch (err) {
    console.warn('registerNativeDurationListener error:', err);
    return () => {};
  }
}
