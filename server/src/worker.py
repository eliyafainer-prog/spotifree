import os
import sys
import json
import threading
from concurrent.futures import ThreadPoolExecutor
import yt_dlp

# Base options: VisionOS + Web Safari clients bypass YouTube SABR experiments and provide direct M4A stream URLs
ydl_opts_clean = {
    'format': '140/ba[ext=m4a]/ba/best',
    'quiet': True,
    'no_warnings': True,
    'no_color': True,
    'no_check_certificates': True,
    'socket_timeout': 10,
    'noplaylist': True,
    'extract_flat': False,
    'skip_download': True,
    'extractor_args': {
        'youtube': {
            'player_client': ['visionos', 'web_safari', 'web']
        }
    }
}

# Cookie detection (only use if explicitly valid)
cookie_candidates = [
    os.environ.get('COOKIE_FILE', ''),
    os.path.join(os.path.dirname(__file__), '../cookies.txt'),
    os.path.join(os.getcwd(), 'server/cookies.txt'),
    os.path.join(os.getcwd(), 'cookies.txt'),
    '/etc/secrets/cookies.txt'
]

ydl_clean = yt_dlp.YoutubeDL(ydl_opts_clean)
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
        ydl_cookie = yt_dlp.YoutubeDL(ydl_opts_cookie)
        sys.stderr.write(f"[Worker] Loaded optional cookie file: {best_cookie}\n")
    except Exception as e:
        sys.stderr.write(f"[Worker] Failed to initialize cookie YDL: {e}\n")
    sys.stderr.flush()

lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=6)

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
    
    # Priority 1: Format 140 or direct M4A videoplayback stream (native hardware decoding)
    for f in formats:
        u = f.get('url')
        if not u:
            continue
        if (f.get('itag') == 140 or f.get('ext') == 'm4a') and 'videoplayback' in u:
            return u

    # Priority 2: Any audio-only format with direct videoplayback URL
    for f in formats:
        u = f.get('url')
        if not u:
            continue
        if f.get('acodec') != 'none' and f.get('vcodec') == 'none' and 'videoplayback' in u:
            return u

    # Priority 3: Any audio format
    for f in formats:
        u = f.get('url')
        if u and f.get('acodec') != 'none' and f.get('vcodec') == 'none':
            return u

    return info.get('url')

def get_audio_url(target):
    # Step 1: Clean extraction (no cookies) - works 100% reliably on residential/mobile IPs
    clean_err = None
    try:
        info = ydl_clean.extract_info(target, download=False)
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
