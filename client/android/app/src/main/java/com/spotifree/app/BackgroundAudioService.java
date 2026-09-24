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
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class BackgroundAudioService extends Service {
    public static final String CHANNEL_ID = "spotifree_playback_channel";
    public static final int NOTIFICATION_ID = 5050;

    public static final String ACTION_START = "com.spotifree.app.ACTION_START";
    public static final String ACTION_UPDATE = "com.spotifree.app.ACTION_UPDATE";
    public static final String ACTION_STOP = "com.spotifree.app.ACTION_STOP";
    public static final String ACTION_PLAY = "com.spotifree.app.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.spotifree.app.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.spotifree.app.ACTION_NEXT";
    public static final String ACTION_PREV = "com.spotifree.app.ACTION_PREV";

    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;
    private String currentTitle = "SpotiFree";
    private String currentArtist = "No song playing";
    private String currentThumbnailUrl = null;
    private Bitmap cachedArtwork = null;
    private boolean isPlaying = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SpotiFree:AudioPlayback");
            wakeLock.setReferenceCounted(false);
        }

        mediaSession = new MediaSessionCompat(this, "SpotiFreeMediaSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                BackgroundAudioPlugin.dispatchMediaAction("play");
            }

            @Override
            public void onPause() {
                BackgroundAudioPlugin.dispatchMediaAction("pause");
            }

            @Override
            public void onSkipToNext() {
                BackgroundAudioPlugin.dispatchMediaAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                BackgroundAudioPlugin.dispatchMediaAction("prev");
            }

            @Override
            public void onSeekTo(long pos) {
                BackgroundAudioPlugin.dispatchMediaAction("seek:" + (pos / 1000));
            }
        });
        mediaSession.setActive(true);
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
            case ACTION_START:
            case ACTION_UPDATE:
                String title = intent.getStringExtra("title");
                String artist = intent.getStringExtra("artist");
                String thumb = intent.getStringExtra("thumbnail");
                boolean playing = intent.getBooleanExtra("isPlaying", true);

                if (title != null) currentTitle = title;
                if (artist != null) currentArtist = artist;
                isPlaying = playing;

                if (thumb != null && !thumb.equals(currentThumbnailUrl)) {
                    currentThumbnailUrl = thumb;
                    loadArtworkAsync(currentThumbnailUrl);
                }

                if (wakeLock != null && isPlaying && !wakeLock.isHeld()) {
                    wakeLock.acquire();
                } else if (wakeLock != null && !isPlaying && wakeLock.isHeld()) {
                    wakeLock.release();
                }

                updateMediaSession();
                Notification notification = buildNotification();
                startForeground(NOTIFICATION_ID, notification);
                break;

            case ACTION_PLAY:
                BackgroundAudioPlugin.dispatchMediaAction("play");
                break;

            case ACTION_PAUSE:
                BackgroundAudioPlugin.dispatchMediaAction("pause");
                break;

            case ACTION_NEXT:
                BackgroundAudioPlugin.dispatchMediaAction("next");
                break;

            case ACTION_PREV:
                BackgroundAudioPlugin.dispatchMediaAction("prev");
                break;

            case ACTION_STOP:
                stopForeground(true);
                if (wakeLock != null && wakeLock.isHeld()) {
                    wakeLock.release();
                }
                stopSelf();
                break;
        }

        return START_STICKY;
    }

    private void updateMediaSession() {
        if (mediaSession == null) return;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(
                        PlaybackStateCompat.ACTION_PLAY |
                        PlaybackStateCompat.ACTION_PAUSE |
                        PlaybackStateCompat.ACTION_PLAY_PAUSE |
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(
                        isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                        1.0f
                );

        mediaSession.setPlaybackState(stateBuilder.build());

        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "SpotiFree");

        if (cachedArtwork != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, cachedArtwork);
        }

        mediaSession.setMetadata(metaBuilder.build());
    }

    private Notification buildNotification() {
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pContentIntent = PendingIntent.getActivity(
                this, 0, contentIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent prevIntent = new Intent(this, BackgroundAudioService.class).setAction(ACTION_PREV);
        PendingIntent pPrev = PendingIntent.getService(this, 1, prevIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent playPauseIntent = new Intent(this, BackgroundAudioService.class).setAction(isPlaying ? ACTION_PAUSE : ACTION_PLAY);
        PendingIntent pPlayPause = PendingIntent.getService(this, 2, playPauseIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent nextIntent = new Intent(this, BackgroundAudioService.class).setAction(ACTION_NEXT);
        PendingIntent pNext = PendingIntent.getService(this, 3, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setContentIntent(pContentIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(isPlaying)
                .setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_media_previous, "Previous", pPrev)
                .addAction(isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, isPlaying ? "Pause" : "Play", pPlayPause)
                .addAction(android.R.drawable.ic_media_next, "Next", pNext)
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
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

                updateMediaSession();
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(NOTIFICATION_ID, buildNotification());
                }
            } catch (Exception e) {
                // Keep existing or default artwork
            }
        }).start();
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
