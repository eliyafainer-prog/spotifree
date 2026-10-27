# SpotiFree — Agent Guidelines, Testing Protocols & Quality Standards

This document establishes the mandatory rules, testing procedures, and quality-assurance protocols for the AI agent working on the SpotiFree codebase. Every task, refactor, and feature implementation must adhere strictly to these guidelines.

---

## 1. Core Architecture Principles

1. **100% Pure YouTube Ecosystem**:
   - SpotiFree relies exclusively on **YouTube** and **YouTube Music** (via direct InnerTube API, Web Remix API, and `worker.py` / `yt-dlp` fallback).
   - **Zero External Legacy Dependencies**: Do not reintroduce or query SoundCloud, Deezer, iTunes, or external audio scrapers.
   - Every song returned from search, charts, or playlists must resolve to an authentic 11-character YouTube video ID.

2. **Ultra-Snappy Performance Standards**:
   - **Search Latency**: Must complete in **under 700ms** on live server.
   - **Audio Start Time**: First chunk playback in **under 400ms**.
   - **Lightweight Server Footprint**: SpotiFree runs on a free Render tier (512MB RAM, shared CPU). Never fire multiple heavy scrapers or sequential continuation calls concurrently.

---

## 2. Mandatory Verification & Testing Protocol

Before considering any task complete, you MUST execute and pass all relevant verification steps below:

### Protocol A: Search Engine & Latency Verification
Whenever touching `server/src/services/search.js` or search UI components:
1. **Benchmark Search Latency**:
   - Run a benchmark script using `node -e` in `server/` testing 3 different queries (Hebrew query, English query, short artist name).
   - Ensure latency is **< 750ms** for fresh queries and **0ms** for cached queries.
2. **Verify Keep-Alive**:
   - Ensure all outbound Axios requests utilize `httpsAgent` with `{ keepAlive: true }` to avoid TLS handshake overhead.
3. **Verify Lazy Fallback Isolation**:
   - Ensure heavy scrapers (`yt-search`) and continuation page tokens are NEVER executed in parallel with primary fast APIs. They must only run if primary results yield `< 5` tracks.
4. **Typing Overhead Isolation**:
   - Ensure live search requires at least 2 characters.
   - Ensure client never prefetches audio streams (`prefetchNextTracks`) while the user is actively searching or typing.

### Protocol B: Audio Stream & Download Integrity Verification
Whenever touching `stream.js`, `offlineDownloader.js`, or `offlineStorage.js`:
1. **Audio File Integrity (> 50KB Rule)**:
   - Audio blobs/streams must be verified before saving to IndexedDB. Any payload under 50KB or empty is deemed corrupt.
   - Auto-purge corrupt records on retrieval in `offlineStorage.js` (`getOfflineTrack` and `getAllOfflineTracks`).
2. **Stream URL Reliability**:
   - Direct audio stream URLs must be validated with HTTP Range requests.
   - HLS stream fallback must pipe seamlessly without cutting off early.

### Protocol C: Android Native & WebView Playback Coexistence
Whenever touching `useAudioPlayer.js`, `nativeAudio.js`, or Android Java code (`BackgroundAudioService.java`):
1. **Audio Focus Harmony**:
   - Ensure the WebView `<audio>` tag and native Android `ExoPlayer` / `MediaSession` do not hijack each other's audio focus.
   - Playback must start immediately on user tap inside the app, and continue seamlessly when minimized or screen locked.
2. **State Synchronization**:
   - Track duration, position, pause, and play states must stay 100% in sync between React state and the Android notification controls.

### Protocol D: Client Build & Compilation Verification
Whenever modifying any file inside `client/src/`:
1. Run `npm run build` in the `client/` directory.
2. Confirm the Vite build completes with **0 errors**.

---

## 3. Continuous Improvement & Optimization Checklist

When inspecting the codebase or resolving user requests:
- [ ] **Can this network call be cached or kept alive?** (Check Map TTL caches, `httpsAgent`).
- [ ] **Is the user interface responsive and debounced appropriately?** (200-250ms debounce for live inputs).
- [ ] **Are error states handled gracefully?** (Silent fallbacks for network drops, visible toasts for user actions).
- [ ] **Is backward compatibility maintained?** (Users with existing stored playlists or downloaded offline tracks from earlier versions must experience self-healing migration, never crashes).
- [ ] **Are git commits clean and descriptive?** (Run `git status` and `git diff` before committing).

---

## 4. Quick Testing Commands Cheat-Sheet

```powershell
# 1. Test server search latency & result count
cd server; node -e "const { searchTracks } = require('./src/services/search'); const t = Date.now(); searchTracks('עומר אדם').then(r => console.log('Count:', r.length, 'Time:', Date.now() - t, 'ms', 'Top:', r[0]?.title));"

# 2. Test server health & cloud connectivity
cd server; node -e "const axios = require('axios'); axios.get('https://spotifree-h7s8.onrender.com/api/health').then(r => console.log('Cloud Health:', r.data));"

# 3. Build and test client bundle
cd client; npm run build
```
