import { registerPlugin, Capacitor } from '@capacitor/core';

// Dynamically register the native Android BackgroundAudio plugin
export const BackgroundAudio = registerPlugin('BackgroundAudio');

export const isNativeApp = Capacitor.isNativePlatform();

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
 * Register listener for headphone controls, notification buttons, and lock-screen controls
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
