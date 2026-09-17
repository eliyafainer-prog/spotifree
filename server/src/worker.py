import sys
import json
import yt_dlp

ydl = yt_dlp.YoutubeDL({
    'format': 'ba/b[height<=480]/best',
    'quiet': True,
    'no_warnings': True,
    'no_color': True,
    'no_check_certificates': True,
    'socket_timeout': 6,
})

def get_audio_url(target):
    info = ydl.extract_info(target, download=False)
    formats = info.get('formats', [])
    best_audio = None
    for f in formats:
        if f.get('acodec') != 'none' and f.get('vcodec') == 'none' and f.get('url'):
            best_audio = f['url']
    if best_audio:
        return best_audio
    return info.get('url')

# Signal to Node that worker is initialized and ready
sys.stdout.write("READY\n")
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req_id = None
    try:
        data = json.loads(line)
        req_id = data.get("id")
        target = data.get("target")
        url = get_audio_url(target)
        res = json.dumps({"id": req_id, "url": url})
        sys.stdout.write(res + "\n")
        sys.stdout.flush()
    except Exception as e:
        res = json.dumps({"id": req_id, "error": str(e)})
        sys.stdout.write(res + "\n")
        sys.stdout.flush()
