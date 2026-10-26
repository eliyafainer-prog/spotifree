package com.spotifree.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@UnstableApi
public class BackgroundAudioService extends Service {
    public static final String CHANNEL_ID = "spotifree_playback_channel";
    public static final int NOTIFICATION_ID = 5050;

    public static final String ACTION_PLAY_URL = "com.spotifree.app.ACTION_PLAY_URL";
    public static final String ACTION_PAUSE = "com.spotifree.app.ACTION_PAUSE";
    public static final String ACTION_RESUME = "com.spotifree.app.ACTION_RESUME";
    public static final String ACTION_SEEK = "com.spotifree.app.ACTION_SEEK";
    public static final String ACTION_STOP = "com.spotifree.app.ACTION_STOP";
    public static final String ACTION_UPDATE_META = "com.spotifree.app.ACTION_UPDATE_META";

    private ExoPlayer player;
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private String currentTitle = "SpotiFree";
    private String currentArtist = "No song playing";
    private String currentThumbnailUrl = null;
    private Bitmap cachedArtwork = null;
    private boolean isServicePlaying = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable progressRunnable;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SpotiFree:AudioPlayback");
            wakeLock.setReferenceCounted(false);
        }

        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifiManager != null) {
            int lockType = WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wifiManager.createWifiLock(lockType, "SpotiFree:WifiLock");
            wifiLock.setReferenceCounted(false);
        }

        initializeExoPlayer();
    }

    private void initializeExoPlayer() {
        // Setup AudioAttributes with audio focus and becoming noisy handling
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();

        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    acquireLocks();
                    startProgressTracker();
                } else {
                    stopProgressTracker();
                    if (player.getPlaybackState() != Player.STATE_BUFFERING) {
                        releaseLocks();
                    }
                }
                BackgroundAudioPlugin.dispatchMediaAction(isPlaying ? "play" : "pause");
                updateForegroundNotification();
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) {
                    BackgroundAudioPlugin.dispatchMediaAction("ended");
                } else if (playbackState == Player.STATE_READY) {
                    long durationSec = player.getDuration() > 0 ? (player.getDuration() / 1000) : 0;
                    BackgroundAudioPlugin.dispatchDuration(durationSec);
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                BackgroundAudioPlugin.dispatchMediaError(error.getMessage() != null ? error.getMessage() : "Playback error");
            }
        });

        // Wrap ExoPlayer in a ForwardingPlayer to force Next/Previous command availability
        ForwardingPlayer forwardingPlayer = new ForwardingPlayer(player) {
            @NonNull
            @Override
            public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .add(COMMAND_SEEK_TO_NEXT)
                        .add(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .add(COMMAND_SEEK_TO_PREVIOUS)
                        .add(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                if (command == COMMAND_SEEK_TO_NEXT ||
                    command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
                    command == COMMAND_SEEK_TO_PREVIOUS ||
                    command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                    return true;
                }
                return super.isCommandAvailable(command);
            }

            @Override
            public void seekToNext() {
                BackgroundAudioPlugin.dispatchMediaAction("next");
            }

            @Override
            public void seekToNextMediaItem() {
                BackgroundAudioPlugin.dispatchMediaAction("next");
            }

            @Override
            public void seekToPrevious() {
                BackgroundAudioPlugin.dispatchMediaAction("prev");
            }

            @Override
            public void seekToPreviousMediaItem() {
                BackgroundAudioPlugin.dispatchMediaAction("prev");
            }
        };

        mediaSession = new MediaSession.Builder(this, forwardingPlayer)
                .setId("SpotiFreeMediaSession")
                .setCallback(new MediaSession.Callback() {})
                .build();
    }

    private void acquireLocks() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire();
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    private void startProgressTracker() {
        stopProgressTracker();
        progressRunnable = new Runnable() {
            @Override
            public void run() {
                if (player != null && player.isPlaying()) {
                    long currentPosSec = player.getCurrentPosition() / 1000;
                    BackgroundAudioPlugin.dispatchProgress(currentPosSec);
                    mainHandler.postDelayed(this, 1000);
                }
            }
        };
        mainHandler.post(progressRunnable);
    }

    private void stopProgressTracker() {
        if (progressRunnable != null) {
            mainHandler.removeCallbacks(progressRunnable);
            progressRunnable = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "SpotiFree Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows active playback controls and track information");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_STICKY;
        }

        String action = intent.getAction();

        switch (action) {
            case ACTION_PLAY_URL:
                String url = intent.getStringExtra("url");
                String title = intent.getStringExtra("title");
                String artist = intent.getStringExtra("artist");
                String thumb = intent.getStringExtra("thumbnail");

                if (title != null) currentTitle = title;
                if (artist != null) currentArtist = artist;

                if (thumb != null && !thumb.equals(currentThumbnailUrl)) {
                    currentThumbnailUrl = thumb;
                    loadArtworkAsync(currentThumbnailUrl);
                }

                if (url != null && player != null) {
                    MediaMetadata metadata = new MediaMetadata.Builder()
                            .setTitle(currentTitle)
                            .setArtist(currentArtist)
                            .build();

                    MediaItem mediaItem = new MediaItem.Builder()
                            .setUri(Uri.parse(url))
                            .setMediaMetadata(metadata)
                            .build();

                    player.setMediaItem(mediaItem);
                    player.prepare();
                    player.play();
                }

                updateForegroundNotification();
                break;

            case "PREV_CLICK":
                BackgroundAudioPlugin.dispatchMediaAction("prev");
                break;

            case "NEXT_CLICK":
                BackgroundAudioPlugin.dispatchMediaAction("next");
                break;

            case ACTION_PAUSE:
                if (player != null && player.isPlaying()) {
                    player.pause();
                } else {
                    isServicePlaying = false;
                    releaseLocks();
                    BackgroundAudioPlugin.dispatchMediaAction("pause");
                    updateForegroundNotification();
                }
                break;

            case ACTION_RESUME:
                if (player != null && player.getMediaItemCount() > 0 && player.getPlaybackState() != Player.STATE_IDLE) {
                    player.play();
                } else {
                    isServicePlaying = true;
                    acquireLocks();
                    BackgroundAudioPlugin.dispatchMediaAction("play");
                    updateForegroundNotification();
                }
                break;

            case ACTION_SEEK:
                long seekPositionSec = intent.getLongExtra("position", 0);
                if (player != null) {
                    player.seekTo(seekPositionSec * 1000);
                }
                break;

            case ACTION_UPDATE_META:
                String metaTitle = intent.getStringExtra("title");
                String metaArtist = intent.getStringExtra("artist");
                String metaThumb = intent.getStringExtra("thumbnail");
                boolean metaIsPlaying = intent.getBooleanExtra("isPlaying", false);
                if (metaTitle != null) currentTitle = metaTitle;
                if (metaArtist != null) currentArtist = metaArtist;
                if (metaThumb != null && !metaThumb.equals(currentThumbnailUrl)) {
                    currentThumbnailUrl = metaThumb;
                    loadArtworkAsync(currentThumbnailUrl);
                }
                isServicePlaying = metaIsPlaying;
                if (isServicePlaying) {
                    acquireLocks();
                } else if (player == null || !player.isPlaying()) {
                    releaseLocks();
                }
                updateForegroundNotification();
                break;

            case ACTION_STOP:
                stopProgressTracker();
                if (player != null) {
                    player.stop();
                }
                isServicePlaying = false;
                releaseLocks();
                stopForeground(true);
                stopSelf();
                break;
        }

        return START_STICKY;
    }

    private void updateForegroundNotification() {
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
    }

    private Notification buildNotification() {
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pContentIntent = PendingIntent.getActivity(
                this, 0, contentIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean isCurrentlyPlaying = (player != null && player.isPlaying()) || isServicePlaying;

        Intent prevIntent = new Intent(this, BackgroundAudioService.class).setAction("PREV_CLICK");
        PendingIntent pPrev = PendingIntent.getService(this, 1, prevIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent playPauseIntent = new Intent(this, BackgroundAudioService.class).setAction(isCurrentlyPlaying ? ACTION_PAUSE : ACTION_RESUME);
        PendingIntent pPlayPause = PendingIntent.getService(this, 2, playPauseIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent nextIntent = new Intent(this, BackgroundAudioService.class).setAction("NEXT_CLICK");
        PendingIntent pNext = PendingIntent.getService(this, 3, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setContentIntent(pContentIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(isCurrentlyPlaying)
                .setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_media_previous, "Previous", pPrev)
                .addAction(isCurrentlyPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        isCurrentlyPlaying ? "Pause" : "Play", pPlayPause)
                .addAction(android.R.drawable.ic_media_next, "Next", pNext)
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setShowActionsInCompactView(0, 1, 2));

        if (cachedArtwork != null) {
            builder.setLargeIcon(cachedArtwork);
        }

        return builder.build();
    }

    private void loadArtworkAsync(String urlStr) {
        new Thread(() -> {
            try {
                URL url = new URL(urlStr);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setDoInput(true);
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.connect();
                InputStream input = connection.getInputStream();
                cachedArtwork = BitmapFactory.decodeStream(input);

                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(NOTIFICATION_ID, buildNotification());
                }
            } catch (Exception ignored) {}
        }).start();
    }

    @Override
    public void onDestroy() {
        stopProgressTracker();
        releaseLocks();
        if (player != null) {
            player.release();
            player = null;
        }
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
