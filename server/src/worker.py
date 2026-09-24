import os
import sys
import json
import threading
from concurrent.futures import ThreadPoolExecutor
import yt_dlp

ydl_opts = {
    'format': '140/ba[ext=m4a]/ba/b[height<=480]/best',
    'remote_components': ['ejs:github'],
    'quiet': True,
    'no_warnings': True,
    'no_color': True,
    'no_check_certificates': True,
    'socket_timeout': 8,
    'noplaylist': True,
    'extract_flat': False,
    'skip_download': True
}

# Auto-detect cookiefile (repo cookies, Render Secret File, local file, or env var)
cookie_candidates = [
    os.path.join(os.path.dirname(__file__), '../cookies.txt'),
    os.path.join(os.getcwd(), 'server/cookies.txt'),
    os.path.join(os.getcwd(), 'cookies.txt'),
    os.environ.get('COOKIE_FILE', ''),
    '/etc/secrets/cookies.txt'
]
def normalize_cookies(src_path, dst_path):
    with open(src_path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    clean_lines = ['# Netscape HTTP Cookie File\n']
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        parts = stripped.split()
        if len(parts) >= 7:
            domain = parts[0]
            flag = parts[1]
            path = parts[2]
            secure = parts[3]
            expiration = parts[4]
            name = parts[5]
            value = ' '.join(parts[6:])
            clean_lines.append(f"{domain}\t{flag}\t{path}\t{secure}\t{expiration}\t{name}\t{value}\n")
    with open(dst_path, 'w', encoding='utf-8') as f:
        f.writelines(clean_lines)

existing_cookies = []
for cp in cookie_candidates:
    if cp and os.path.exists(cp):
        try:
            sz = os.path.getsize(cp)
            if sz > 50:
                existing_cookies.append((os.path.getmtime(cp), cp, sz))
        except Exception:
            pass

if existing_cookies:
    # Priority order: Repo cookies always come first over old /etc/secrets!
    repo_cookies = [c for c in existing_cookies if '/etc/secrets' not in c[1]]
    best_cookie = repo_cookies[0][1] if repo_cookies else existing_cookies[0][1]
    try:
        target_cp = '/tmp/cookies.txt' if os.name != 'nt' else os.path.join(os.environ.get('TEMP', '.'), 'cookies.txt')
        normalize_cookies(best_cookie, target_cp)
        ydl_opts['cookiefile'] = target_cp
        sys.stderr.write(f"[Worker] Successfully normalized and loaded cookies from: {best_cookie} -> {target_cp} (size {os.path.getsize(target_cp)} bytes)\n")
    except Exception as e:
        ydl_opts['cookiefile'] = best_cookie
        sys.stderr.write(f"[Worker] Failed to normalize cookies, fallback: {e}\n")
    sys.stderr.flush()

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
