import os
import sys
import json
import threading
from concurrent.futures import ThreadPoolExecutor
import yt_dlp

# High-compatibility client mix: Android + Web provides coverage across YouTube catalog
ydl_opts_clean = {
    'format': '140/ba[protocol^=http][ext=m4a]/ba[protocol^=http]/ba/18/b/best',
    'quiet': True,
    'no_warnings': True,
    'no_color': True,
    'no_check_certificates': True,
    'socket_timeout': 4,
    'retries': 0,
    'extractor_retries': 0,
    'fragment_retries': 0,
    'noplaylist': True,
    'extract_flat': False,
    'skip_download': True,
    'extractor_args': {
        'youtube': {
            'player_client': ['android', 'web']
        }
    }
}

# Fast 1-request flat search for SoundCloud (returns durations & titles of 8 candidates in ~1s)
ydl_opts_sc_flat = {
    'quiet': True,
    'no_warnings': True,
    'no_color': True,
    'no_check_certificates': True,
    'socket_timeout': 4,
    'retries': 0,
    'extract_flat': True,
    'skip_download': True
}

# Single-track extractor for the chosen full-length SoundCloud track (~0.4s)
ydl_opts_sc = {
    'format': 'http_mp3_1_0/hls_aac_160k/hls_aac_96k/hls_mp3_1_0/ba/b',
    'quiet': True,
    'no_warnings': True,
    'no_color': True,
    'no_check_certificates': True,
    'socket_timeout': 4,
    'retries': 0,
    'noplaylist': True,
    'extract_flat': False,
    'skip_download': True
}

# Cookie detection (optional fallback)
cookie_candidates = [
    os.environ.get('COOKIE_FILE', ''),
    os.path.join(os.path.dirname(__file__), '../cookies.txt'),
    os.path.join(os.getcwd(), 'server/cookies.txt'),
    os.path.join(os.getcwd(), 'cookies.txt'),
    '/etc/secrets/cookies.txt'
]

ydl_clean = yt_dlp.YoutubeDL(ydl_opts_clean)
ydl_sc_flat = yt_dlp.YoutubeDL(ydl_opts_sc_flat)
ydl_sc = yt_dlp.YoutubeDL(ydl_opts_sc)
ydl_cookie = None

best_cookie = None
for cp in cookie_candidates:
    if cp and os.path.exists(cp):
        try:
            sz = os.path.getsize(cp)
            if sz > 100:
                best_cookie = cp
                break
        except Exception:
            pass

if best_cookie:
    try:
        ydl_opts_cookie = dict(ydl_opts_clean)
        ydl_opts_cookie['cookiefile'] = best_cookie
        ydl_opts_cookie['extractor_args'] = {'youtube': {'player_client': ['web', 'tv']}}
        ydl_cookie = yt_dlp.YoutubeDL(ydl_opts_cookie)
        sys.stderr.write(f"[Worker] Loaded optional cookie file: {best_cookie}\n")
    except Exception as e:
        sys.stderr.write(f"[Worker] Failed to initialize cookie YDL: {e}\n")
    sys.stderr.flush()

lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=8)

def safe_write(data):
    with lock:
        try:
            sys.stdout.write(json.dumps(data) + "\n")
            sys.stdout.flush()
        except Exception:
            pass

def is_preview_url(u, fid=''):
    if not u:
        return True
    u_low = u.lower()
    fid_low = (fid or '').lower()
    return '/preview/' in u_low or 'cf-preview-media' in u_low or 'preview' in fid_low

def extract_best_audio(info):
    if not info:
        return None
    dur = info.get('duration') or 0
    if 0 < dur <= 35:
        return None

    formats = info.get('formats', [])

    # Priority 0: Progressive HTTP MP3 (full track, never 30s preview, never .m3u8)
    for f in formats:
        u = f.get('url') or ''
        fid = (f.get('format_id') or '').lower()
        proto = (f.get('protocol') or '').lower()
        if u and not is_preview_url(u, fid):
            if 'http_mp3' in fid or (proto in ('http', 'https') and '.m3u8' not in u and 'hls' not in fid):
                return u

    # Priority 1: YouTube Audio-only M4A / AAC format 140
    for f in formats:
        u = f.get('url') or ''
        if u and (f.get('itag') == 140 or f.get('ext') == 'm4a') and f.get('vcodec') == 'none' and 'videoplayback' in u:
            return u

    # Priority 2: Any YouTube audio-only format with direct videoplayback URL
    for f in formats:
        u = f.get('url') or ''
        if u and f.get('acodec') != 'none' and f.get('vcodec') == 'none' and 'videoplayback' in u:
            return u

    # Priority 3: Combined format (e.g. format 18: mp4 with AAC audio)
    for f in formats:
        u = f.get('url') or ''
        if u and f.get('acodec') != 'none' and 'videoplayback' in u:
            return u

    # Priority 4: Any HTTP progressive URL (non-m3u8, non-preview)
    for f in formats:
        u = f.get('url') or ''
        fid = (f.get('format_id') or '').lower()
        if u and u.startswith('http') and '.m3u8' not in u and not is_preview_url(u, fid):
            return u

    # Priority 5: Full-length SoundCloud HLS AAC 160k / 96k / MP3 (remuxed by server ffmpeg at 0% CPU)
    for pref_fid in ('hls_aac_160k', 'hls_aac_96k', 'hls_mp3_1_0', 'hls_mp3_0_0'):
        for f in formats:
            u = f.get('url') or ''
            fid = (f.get('format_id') or '').lower()
            if u and fid == pref_fid and not is_preview_url(u, fid):
                return u

    for f in formats:
        u = f.get('url') or ''
        fid = (f.get('format_id') or '').lower()
        if u and u.startswith('http') and not is_preview_url(u, fid):
            return u

    url = info.get('url') or ''
    if url and not is_preview_url(url, info.get('format_id', '')):
        return url

    return None

def score_sc_entry(e, query_lower):
    dur = e.get('duration') or 0
    if dur <= 45 or dur > 660:
        return -999
    title = (e.get('title') or '').lower()
    score = 100
    # Prefer tracks around 2 to 5 minutes (standard song length)
    if 120 <= dur <= 330:
        score += 40
    # Penalize remixes/covers/slowed unless requested in query
    bad_words = ['remix', 'rework', 'bootleg', 'edit', 'remake', 'cover', 'slowed', 'reverb', 'sped up', 'nightcore', 'live', 'instrumental', 'karaoke']
    for bw in bad_words:
        if bw in title and bw not in query_lower:
            score -= 35
    # Reward matching words from query
    q_words = [w for w in query_lower.replace('-', ' ').split() if len(w) > 1]
    matched = sum(1 for w in q_words if w in title)
    if q_words:
        score += int((matched / len(q_words)) * 50)
    return score

def extract_soundcloud_fast(target):
    query = target.split(':', 1)[1] if ':' in target else target
    query_lower = query.lower()
    flat_target = f"scsearch8:{query}"
    flat_info = ydl_sc_flat.extract_info(flat_target, download=False)
    entries = (flat_info or {}).get('entries') or []
    valid = [e for e in entries if e and (e.get('url') or e.get('id'))]
    if not valid:
        raise RuntimeError("No SoundCloud search results")

    scored = sorted(valid, key=lambda e: score_sc_entry(e, query_lower), reverse=True)
    # Try top 2 best-scoring full-length candidates
    for cand in scored[:2]:
        if score_sc_entry(cand, query_lower) < 0:
            continue
        cand_url = cand.get('url') or f"https://api.soundcloud.com/tracks/{cand.get('id')}"
        try:
            track_info = ydl_sc.extract_info(cand_url, download=False)
            url = extract_best_audio(track_info)
            if url:
                return url
        except Exception:
            continue

    raise RuntimeError("No full-length SoundCloud stream found")

def pick_best_entry(entries):
    if not entries:
        return None
    valid = [e for e in entries if e]
    for e in valid:
        dur = e.get('duration') or 0
        if 55 <= dur <= 660:
            best = extract_best_audio(e)
            if best:
                return best
    for e in valid:
        best = extract_best_audio(e)
        if best:
            return best
    return None

def get_audio_url(target):
    # Fast 2-step path for SoundCloud queries (~1.5s total instead of 7s)
    if target.startswith('scsearch'):
        return extract_soundcloud_fast(target)

    # Step 1: Clean YouTube extraction
    clean_err = None
    try:
        info = ydl_clean.extract_info(target, download=False)
        if info and 'entries' in info and len(info['entries']) > 0:
            url = pick_best_entry(info['entries'])
        else:
            url = extract_best_audio(info)
        if url:
            return url
    except Exception as e:
        clean_err = str(e)
        sys.stderr.write(f"[Worker] Clean extract for {target}: {clean_err}\n")

    # Step 2: Fallback to cookie extractor only if clean failed and cookie instance is ready
    if ydl_cookie:
        try:
            info = ydl_cookie.extract_info(target, download=False)
            if info and 'entries' in info and len(info['entries']) > 0:
                url = pick_best_entry(info['entries'])
            else:
                url = extract_best_audio(info)
            if url:
                return url
        except Exception as e:
            sys.stderr.write(f"[Worker] Cookie fallback for {target}: {e}\n")

    raise RuntimeError(clean_err or "No playable audio stream found")

def process_job(req_id, target):
    try:
        url = get_audio_url(target)
        if url:
            safe_write({"id": req_id, "url": url})
        else:
            safe_write({"id": req_id, "error": "No playable audio stream found"})
    except Exception as e:
        safe_write({"id": req_id, "error": str(e)})

sys.stdout.write("READY\n")
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        data = json.loads(line)
        req_id = data.get("id")
        target = data.get("target")
        executor.submit(process_job, req_id, target)
    except Exception:
        pass
