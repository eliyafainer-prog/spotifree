package com.spotifree.app;

import android.os.Bundle;
import android.os.PowerManager;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            
            // Override Page Visibility API so JS in WebView thinks it is always in foreground
            String js = "Object.defineProperty(document, 'visibilityState', {get: function () { return 'visible'; }});" +
                        "Object.defineProperty(document, 'hidden', {get: function () { return false; }});" +
                        "document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);";
            webView.evaluateJavascript(js, null);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Prevent WebView from freezing JavaScript execution and timers in background
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume(); // Keep JS loop active so next track triggers cleanly
        }
    }
}
