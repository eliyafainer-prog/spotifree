package com.spotifree.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {
    private static BackgroundAudioPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    public static void dispatchMediaAction(String action) {
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("action", action);
            instance.notifyListeners("mediaAction", ret);
        }
    }

    public static void dispatchProgress(long currentPositionSec) {
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("position", currentPositionSec);
            instance.notifyListeners("progress", ret);
        }
    }

    public static void dispatchDuration(long durationSec) {
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("duration", durationSec);
            instance.notifyListeners("duration", ret);
        }
    }

    public static void dispatchMediaError(String errorMsg) {
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("error", errorMsg);
            instance.notifyListeners("mediaError", ret);
        }
    }

    @PluginMethod
    public void playUrl(PluginCall call) {
        Context context = getContext();
        String url = call.getString("url");
        String title = call.getString("title", "SpotiFree");
        String artist = call.getString("artist", "Playing audio");
        String thumbnail = call.getString("thumbnail", "");

        Intent intent = new Intent(context, BackgroundAudioService.class);
        intent.setAction(BackgroundAudioService.ACTION_PLAY_URL);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);
        intent.putExtra("thumbnail", thumbnail);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }

        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, BackgroundAudioService.class);
        intent.setAction(BackgroundAudioService.ACTION_PAUSE);
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, BackgroundAudioService.class);
        intent.setAction(BackgroundAudioService.ACTION_RESUME);
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double pos = call.getDouble("position", 0.0);
        Context context = getContext();
        Intent intent = new Intent(context, BackgroundAudioService.class);
        intent.setAction(BackgroundAudioService.ACTION_SEEK);
        intent.putExtra("position", pos.longValue());
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        String title = call.getString("title", "SpotiFree");
        String artist = call.getString("artist", "Playing audio");
        String thumbnail = call.getString("thumbnail", "");

        Intent intent = new Intent(context, BackgroundAudioService.class);
        intent.setAction(BackgroundAudioService.ACTION_UPDATE_META);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);
        intent.putExtra("thumbnail", thumbnail);
        context.startService(intent);

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, BackgroundAudioService.class);
        intent.setAction(BackgroundAudioService.ACTION_STOP);
        context.startService(intent);
        call.resolve();
    }
}
