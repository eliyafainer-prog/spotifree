import os
import sys
import json
import threading
from concurrent.futures import ThreadPoolExecutor
import yt_dlp

ydl_opts = {
    'format': '140/ba[ext=m4a]/ba/b[height<=480]/best',
    'quiet': True,
    'no_warnings': True,
    'no_color': True,
    'no_check_certificates': True,
    'socket_timeout': 6,
    'noplaylist': True,
    'extract_flat': False,
    'skip_download': True,
    'extractor_args': {'youtube': {'player_client': ['android', 'ios', 'web']}}
}

# Auto-detect cookiefile (Render Secret File, local file, or env var)
cookie_candidates = [
    os.environ.get('COOKIE_FILE', ''),
    '/etc/secrets/cookies.txt',
    os.path.join(os.path.dirname(__file__), '../cookies.txt'),
    os.path.join(os.getcwd(), 'cookies.txt'),
    os.path.join(os.getcwd(), 'server/cookies.txt')
]
for cp in cookie_candidates:
    if cp and os.path.exists(cp):
        ydl_opts['cookiefile'] = cp
        sys.stderr.write(f"[Worker] Successfully loaded cookies from: {cp}\n")
        sys.stderr.flush()
        break

ydl = yt_dlp.YoutubeDL(ydl_opts)
lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=4)

def safe_write(data):
    with lock:
        try:
            sys.stdout.write(json.dumps(data) + "\n")
            sys.stdout.flush()
        except Exception:
            pass

def get_audio_url(target):
    info = ydl.extract_info(target, download=False)
    formats = info.get('formats', [])
    
    # 1. Priority 1: M4A / AAC (format 140) - ultra-fast native hardware decoding on iOS & Android
    for f in formats:
        if (f.get('ext') == 'm4a' or f.get('itag') == 140 or 'mp4a' in f.get('acodec', '')) and f.get('url'):
            return f['url']
            
    # 2. Priority 2: Any audio-only format
    for f in formats:
        if f.get('acodec') != 'none' and f.get('vcodec') == 'none' and f.get('url'):
            return f['url']
            
    return info.get('url')

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
    except Exception as e:
        pass
