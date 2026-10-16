import yt_dlp
import json

ydl_opts_clean = {
    'format': '140/ba[protocol^=http][ext=m4a]/ba[protocol^=http]/ba/18/b/best',
    'quiet': True,
    'no_warnings': True,
}
with yt_dlp.YoutubeDL(ydl_opts_clean) as ydl:
    info = ydl.extract_info('scsearch1:Eyal Golan', download=False)
    formats = info['entries'][0]['formats'] if 'entries' in info else info.get('formats', [])
    for f in formats:
        print(f"{f.get('format_id')} : {f.get('url')[:30]} : vcodec={f.get('vcodec')} acodec={f.get('acodec')}")
