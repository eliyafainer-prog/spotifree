import os
import sys
import json
import threading
from concurrent.futures import ThreadPoolExecutor
import yt_dlp

# High-compatibility client mix: Android + VisionOS + Web provides coverage across YouTube catalog
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

# Dedicated fast extractor for SoundCloud progressive HTTP MP3 streams (avoids HLS .m3u8)
ydl_opts_sc = {
    'format': 'http_mp3_1_0/ba[protocol^=http]/ba/b',
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

def extract_best_audio(info):
    if not info:
        return None
    formats = info.get('formats', [])

    # Priority 0: SoundCloud progressive HTTP MP3 (never HLS .m3u8 or 30s preview)
    for f in formats:
        u = f.get('url') or ''
        fid = (f.get('format_id') or '').lower()
        proto = (f.get('protocol') or '').lower()
        if u and ('http_mp3' in fid or (proto in ('http', 'https') and '.m3u8' not in u and 'hls' not in fid)):
            if '/preview/' not in u and 'cf-preview-media' not in u:
                return u

    # Priority 1: Audio-only M4A / AAC format 140 (pure audio stream)
    for f in formats:
        u = f.get('url')
        if u and (f.get('itag') == 140 or f.get('ext') == 'm4a') and f.get('vcodec') == 'none' and 'videoplayback' in u:
            return u

    # Priority 2: Any audio-only format with direct videoplayback URL
    for f in formats:
        u = f.get('url')
        if u and f.get('acodec') != 'none' and f.get('vcodec') == 'none' and 'videoplayback' in u:
            return u

    # Priority 3: Combined format (e.g. format 18: mp4 with AAC audio - plays natively in HTML5 audio element)
    for f in formats:
        u = f.get('url')
        if u and f.get('acodec') != 'none' and 'videoplayback' in u:
            return u

    # Priority 4: Any format with a valid videoplayback URL
    for f in formats:
        u = f.get('url')
        if u and 'videoplayback' in u:
            return u

    # Priority 5: Any HTTP progressive URL (exclude m3u8 and 30s previews)
    for f in formats:
        u = f.get('url')
        if u and u.startswith('http') and '.m3u8' not in u and '/preview/' not in u:
            return u

    # Priority 6: Any non-m3u8 HTTP URL
    for f in formats:
        u = f.get('url')
        if u and u.startswith('http') and '.m3u8' not in u:
            return u

    url = info.get('url')
    if url and '.m3u8' not in url:
        return url

    return None

def pick_best_entry(entries):
    if not entries:
        return None
    valid = [e for e in entries if e]
    if not valid:
        return None
    # Prefer full-length tracks (> 55s and not a 30s SoundCloud Go+ preview) over snippets
    for e in valid:
        dur = e.get('duration') or 0
        direct_url = e.get('url') or ''
        if dur >= 55 and dur <= 660 and '/preview/' not in direct_url and 'cf-preview-media' not in direct_url:
            best = extract_best_audio(e)
            if best and '/preview/' not in best and 'cf-preview-media' not in best:
                return best
    # Fallback to first entry that yields a non-m3u8 URL
    for e in valid:
        best = extract_best_audio(e)
        if best:
            return best
    return None

def get_audio_url(target):
    # Fast path for SoundCloud queries
    if target.startswith('scsearch'):
        info = ydl_sc.extract_info(target, download=False)
        if info and 'entries' in info:
            url = pick_best_entry(info['entries'])
            if url:
                return url
        url = extract_best_audio(info)
        if url:
            return url
        raise RuntimeError("No full SoundCloud stream found")

    # Step 1: Clean extraction
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
