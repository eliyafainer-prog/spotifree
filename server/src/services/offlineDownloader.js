const axios = require('axios');
const https = require('https');
const { getAudioStreamUrl, pipeStream } = require('./stream');

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });

let scClientId = 'tHVbSbDP4TaoMbPppngv6Tdry83vNbMQ';
let scRefreshPromise = null;

async function refreshScClientId() {
  if (scRefreshPromise) return scRefreshPromise;
  scRefreshPromise = (async () => {
    try {
      const home = await axios.get('https://soundcloud.com', {
        timeout: 4500,
        httpsAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      });
      const scripts = [...String(home.data || '').matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
      for (const s of scripts.slice(-4).reverse()) {
        try {
          const js = await axios.get(s, { timeout: 4000, httpsAgent });
          const m =
            String(js.data || '').match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/) ||
            String(js.data || '').match(/client_id="([a-zA-Z0-9]{32})"/);
          if (m && m[1]) {
            scClientId = m[1];
            return scClientId;
          }
        } catch (e) {}
      }
    } catch (e) {} finally {
      scRefreshPromise = null;
    }
    return scClientId;
  })();
  return scRefreshPromise;
}

async function searchScTracks(query, limit = 15) {
  if (!query || !query.trim()) return [];
  const doSearch = async (cid) => {
    const res = await axios.get('https://api-v2.soundcloud.com/search/tracks', {
      params: { q: query.trim(), client_id: cid, limit },
      timeout: 5000,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    return res.data?.collection || [];
  };

  try {
    return await doSearch(scClientId);
  } catch (err) {
    if (err.response && (err.response.status === 401 || err.response.status === 403)) {
      const cid = await refreshScClientId();
      return await doSearch(cid);
    }
    return [];
  }
}

async function resolveScStreamUrl(item, allowSnipped = false) {
  const transcodings = (item?.media?.transcodings || []).filter(
    t => t && t.url && (allowSnipped || (!t.url.includes('preview') && !t.snipped))
  );
  if (transcodings.length === 0) return null;

  const ordered = [
    ...transcodings.filter(t => t.format?.protocol === 'progressive'),
    ...transcodings.filter(t => t.format?.protocol === 'hls' && !String(t.format?.mime_type || '').includes('mpegurl')),
    ...transcodings.filter(t => t.format?.protocol === 'hls')
  ];

  for (const trans of ordered) {
    try {
      const res = await axios.get(trans.url, {
        params: {
          client_id: scClientId,
          ...(item.track_authorization ? { track_authorization: item.track_authorization } : {})
        },
        timeout: 4000,
        httpsAgent
      });
      if (res.data?.url && (allowSnipped || (!res.data.url.includes('/preview/') && !res.data.url.includes('_preview')))) {
        return res.data.url;
      }
    } catch (e) {}
  }
  return null;
}

async function fetchYoutubeOembed(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const res = await axios.get(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { timeout: 2500, httpsAgent }
    );
    if (res.data?.title) {
      const author = String(res.data.author_name || '').replace(/\s*-\s*Topic$/i, '').trim();
      const rawTitle = String(res.data.title || '')
        .replace(/\s*[\(\[](official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer|hd|4k|audio|קליפ\s*רשמי|אודיו\s*רשמי)[\)\]]/gi, '')
        .trim();
      return { title: rawTitle, author };
    }
  } catch (e) {}
  return null;
}

/**
 * Smart Offline Candidate Scorer:
 * Ensures full-length studio audio while tolerating Hebrew/English transliterated artist usernames
 * (e.g. Spotify artist "נועה קירל" vs SoundCloud username "Noa Kirel") so valid songs never fail!
 */
function scoreOfflineCandidate(item, meta = {}, oembed = null) {
  if (!item || item.snipped || item.policy === 'SNIP' || item.policy === 'BLOCK') return -999;
  const dur = Math.round((item.duration || 0) / 1000);
  const fullDur = Math.round((item.full_duration || item.duration || 0) / 1000);
  if (dur <= 42 || dur > 720) return -999;
  if (fullDur > dur + 5) return -999;

  const transcodings = (item.media?.transcodings || []).filter(
    t => t && t.url && !t.url.includes('preview') && !t.snipped
  );
  if (transcodings.length === 0) return -999;

  const title = String(item.title || '').toLowerCase();
  const username = String(item.user?.username || '').toLowerCase();
  const combined = `${title} ${username}`;

  const adWords = [
    'podcast', 'פודקאסט', 'פרק ', 'פרסומת', 'חסות', 'jingle', 'commercial', 'teaser', 'trailer'
  ];
  for (const aw of adWords) {
    if (combined.includes(aw)) return -999;
  }

  const targetDur = Number(meta?.durationSeconds) || 0;
  const rawTargetTitle = String(meta?.title || '').toLowerCase().trim();
  const cleanTargetTitle = rawTargetTitle
    .replace(/\\/g, ' ')
    .replace(/\s*[\(\[][^)\]]*[\)\]]/g, '')
    .split(' - ')
    .pop()
    .trim() || rawTargetTitle;

  const targetArtist = String(meta?.artist || '').toLowerCase().trim();
  const oembedAuthor = String(oembed?.author || '').toLowerCase().trim();
  const oembedTitle = String(oembed?.title || '').toLowerCase().trim();

  // Extract meaningful words from target title (and oembed title if available)
  const titleWords = cleanTargetTitle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  const oembedWords = oembedTitle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  let score = 100;

  if (titleWords.length > 0) {
    const matchedPrimary = titleWords.filter(w => combined.includes(w)).length;
    const ratioPrimary = matchedPrimary / titleWords.length;

    let ratioOembed = 0;
    if (oembedWords.length > 0) {
      const matchedOembed = oembedWords.filter(w => combined.includes(w)).length;
      ratioOembed = matchedOembed / oembedWords.length;
    }

    const bestRatio = Math.max(ratioPrimary, ratioOembed);
    if (bestRatio < 0.45) return -999;
    score += Math.round(bestRatio * 90);
  }

  // Duration proximity against Spotify/YouTube target duration
  if (targetDur > 40) {
    const diff = Math.abs(dur - targetDur);
    if (diff <= 4) score += 150;
    else if (diff <= 10) score += 110;
    else if (diff <= 18) score += 65;
    else if (diff <= 30) score += 20;
    else if (diff <= 45) score -= 45;
    else score -= 140;
  } else if (dur >= 100 && dur <= 340) {
    score += 35;
  }

  // Penalize non-studio versions unless requested in target title
  const badWords = [
    'remix', 'rework', 'bootleg', 'cover', 'slowed', 'reverb', 'sped up',
    'nightcore', 'karaoke', 'instrumental', 'רמיקס', 'רימיקס', 'קאבר', 'קריוקי', 'בהופעה', 'מהבמה'
  ];
  for (const bw of badWords) {
    if (title.includes(bw) && !rawTargetTitle.includes(bw)) {
      score -= 130;
    }
  }

  // Artist match (checks both Spotify artist and YouTube oEmbed channel/author for bilingual match!)
  const artistTokens = `${targetArtist} ${oembedAuthor}`
    .replace(/[,&•/\-()]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !['topic', 'official', 'music', 'פסטיגל', 'משתתפי'].includes(w));

  if (artistTokens.length > 0) {
    if (artistTokens.some(w => username.includes(w))) {
      score += 75;
    } else if (artistTokens.some(w => title.includes(w))) {
      score += 55;
    } else if (targetDur > 40 && Math.abs(dur - targetDur) <= 8) {
      // Exact studio duration match even when uploader username is in English/transliterated!
      score += 35;
    } else {
      score -= 35;
    }
  }

  if (transcodings.some(t => t.format?.protocol === 'progressive')) {
    score += 25;
  }

  return score;
}

/**
 * Multi-query SoundCloud + Piped/Invidious fallback extractor specifically for Offline Downloads
 */
async function findOfflineStreamUrl(videoId, fallbackQuery, meta = {}) {
  // 1. Try primary stream engine first (0ms if cached, or standard studio match)
  try {
    const primaryUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
    if (primaryUrl) return primaryUrl;
  } catch (e) {}

  // 2. Bilingual / Multi-Query SoundCloud Studio Fallback
  const oembed = await fetchYoutubeOembed(videoId);
  const rawTitle = String(meta?.title || '').trim();
  const rawArtist = String(meta?.artist || '').trim();
  const primaryArtist = rawArtist.split(/[,&•]/)[0].trim();

  const cleanTitle = rawTitle
    .replace(/\\/g, ' ')
    .replace(/\s*[\(\[][^)\]]*[\)\]]/g, '')
    .trim();

  const shortTitle = cleanTitle.includes(' - ')
    ? cleanTitle.split(' - ').pop().trim()
    : cleanTitle;

  const queries = [
    primaryArtist && shortTitle ? `${primaryArtist} ${shortTitle}` : '',
    shortTitle,
    cleanTitle,
    oembed ? `${oembed.author} ${oembed.title}`.trim() : '',
    oembed ? oembed.title : '',
    fallbackQuery || ''
  ]
    .map(q => q.replace(/[^\p{L}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const uniqueQueries = [...new Set(queries)];
  const allCandidates = new Map();
  const rawPool = new Map();

  for (const q of uniqueQueries.slice(0, 5)) {
    const items = await searchScTracks(q, 20);
    for (const it of items) {
      if (it && it.id) {
        if (!rawPool.has(it.id)) rawPool.set(it.id, it);
        if (!allCandidates.has(it.id)) {
          const s = scoreOfflineCandidate(it, meta, oembed);
          if (s > 30) {
            allCandidates.set(it.id, { item: it, score: s });
          }
        }
      }
    }
    const bestSoFar = [...allCandidates.values()].sort((a, b) => b.score - a.score)[0];
    if (bestSoFar && bestSoFar.score >= 220) break;
  }

  const sortedCandidates = [...allCandidates.values()].sort((a, b) => b.score - a.score);
  for (const cand of sortedCandidates.slice(0, 5)) {
    const streamUrl = await resolveScStreamUrl(cand.item, false);
    if (streamUrl) return streamUrl;
  }

  // 3. Relaxed Full-Length SoundCloud Fallback (accepts remixes/covers/live versions when studio upload is missing or geo-locked)
  const cleanWords = shortTitle
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  const relaxedPool = [...rawPool.values()]
    .filter(it => {
      const dur = Math.round((it.duration || 0) / 1000);
      const fullDur = Math.round((it.full_duration || it.duration || 0) / 1000);
      if (it.snipped || dur <= 42 || dur > 720 || fullDur > dur + 5) return false;
      const t = `${it.title || ''} ${it.user?.username || ''}`.toLowerCase();
      if (cleanWords.length === 0) return true;
      return cleanWords.some(w => t.includes(w));
    })
    .sort((a, b) => {
      const targetDur = Number(meta?.durationSeconds) || 195;
      const diffA = Math.abs(Math.round((a.duration || 0) / 1000) - targetDur);
      const diffB = Math.abs(Math.round((b.duration || 0) / 1000) - targetDur);
      return diffA - diffB;
    });

  for (const item of relaxedPool.slice(0, 4)) {
    const streamUrl = await resolveScStreamUrl(item, false);
    if (streamUrl) return streamUrl;
  }

  // 4. Fallback to Piped audio streams if videoId is a valid 11-char YouTube ID
  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    const pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.tokhmi.xyz',
      'https://pipedapi.moomoo.me'
    ];
    for (const inst of pipedInstances) {
      try {
        const res = await axios.get(`${inst}/streams/${videoId}`, { timeout: 3500, httpsAgent });
        const audioStreams = res.data?.audioStreams || [];
        const bestAudio =
          audioStreams.find(a => a.mimeType?.includes('audio/mp4') && a.url) ||
          audioStreams.find(a => a.url);
        if (bestAudio?.url) return bestAudio.url;
      } catch (e) {}
    }
  }

  // Intentionally no 30s-preview fallback: saving a clip as a "downloaded" song is worse than an honest failure.
  throw new Error('לא נמצא מקור שמע להורדה עבור שיר זה');
}

function patchInitMp4Duration(buf, totalSec) {
  if (!totalSec || totalSec <= 0) return buf;
  let mvhdTs = 1000;
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'edts', 'dinf']);

  function walk(start, end) {
    let offset = start;
    while (offset + 8 <= end) {
      const size = buf.readUInt32BE(offset);
      if (size < 8 || offset + size > end) break;
      const type = buf.slice(offset + 4, offset + 8).toString('ascii');
      if (type === 'mvhd' || type === 'mdhd') {
        const ver = buf[offset + 8];
        if (ver === 0 && offset + 28 <= end) {
          const ts = buf.readUInt32BE(offset + 20);
          if (ts > 0) {
            if (type === 'mvhd') mvhdTs = ts;
            buf.writeUInt32BE(Math.round(totalSec * ts), offset + 24);
          }
        }
      } else if (type === 'tkhd') {
        const ver = buf[offset + 8];
        if (ver === 0 && offset + 32 <= end) {
          buf.writeUInt32BE(Math.round(totalSec * mvhdTs), offset + 28);
        }
      } else if (type === 'elst') {
        const ver = buf[offset + 8];
        if (ver === 0 && offset + 20 <= end) {
          const count = buf.readUInt32BE(offset + 12);
          if (count >= 1) {
            buf.writeUInt32BE(Math.round(totalSec * mvhdTs), offset + 16);
          }
        }
      }
      if (containers.has(type)) {
        walk(offset + 8, offset + size);
      }
      offset += size;
    }
  }

  try {
    walk(0, buf.length);
  } catch (e) {}
  return buf;
}

function stripStypSidx(buf) {
  try {
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset);
      if (size < 8 || offset + size > buf.length) break;
      const type = buf.slice(offset + 4, offset + 8).toString('ascii');
      if (type === 'moof' || type === 'ftyp') {
        return offset > 0 ? buf.slice(offset) : buf;
      }
      offset += size;
    }
  } catch (e) {}
  return buf;
}

async function pipeHlsDownload(m3u8Url, req, res) {
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  const m3u8Res = await axios.get(m3u8Url, { timeout: 6000, httpsAgent });
  const lines = String(m3u8Res.data || '').split('\n');
  let mapUrl = null;
  const mediaUrls = [];
  let totalDurationSec = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const infMatch = trimmed.match(/#EXTINF:([0-9.]+)/);
    if (infMatch && infMatch[1]) {
      totalDurationSec += parseFloat(infMatch[1]) || 0;
    }
    const mapMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch && mapMatch[1]) {
      mapUrl = mapMatch[1];
    } else if (trimmed.startsWith('http')) {
      mediaUrls.push(trimmed);
    }
  }

  if (mediaUrls.length === 0) {
    throw new Error('Empty HLS playlist');
  }

  const isMp3 = !mapUrl && (mediaUrls[0].includes('.mp3') || m3u8Url.includes('mp3'));
  res.statusCode = 200;
  res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'audio/mp4');
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  if (mapUrl && !aborted && !res.writableEnded) {
    const initRes = await axios.get(mapUrl, { responseType: 'arraybuffer', timeout: 8000, httpsAgent });
    const patchedInit = patchInitMp4Duration(Buffer.from(initRes.data), totalDurationSec);
    if (!aborted && !res.writableEnded) {
      res.write(patchedInit);
    }
  }

  for (const segUrl of mediaUrls) {
    if (aborted || res.writableEnded) break;
    let segRes = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        segRes = await axios.get(segUrl, { responseType: 'arraybuffer', timeout: 10000, httpsAgent });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
    if (aborted || res.writableEnded || !segRes) break;
    const rawBuf = Buffer.from(segRes.data);
    const cleanBuf = isMp3 ? rawBuf : stripStypSidx(rawBuf);
    const canContinue = res.write(cleanBuf);
    if (!canContinue && !aborted && !res.writableEnded) {
      await new Promise(resolve => res.once('drain', resolve));
    }
  }

  if (!aborted && !res.writableEnded) {
    res.end();
  }
}

/**
 * Dedicated Offline Download Stream Handler:
 * Uses longer timeouts, segment retries, and multi-query bilingual fallbacks so batch downloads achieve ~100% success!
 */
async function pipeOfflineDownload(videoId, req, res, fallbackQuery = null, meta = null) {
  let upstreamStream = null;
  req.on('close', () => {
    if (upstreamStream && typeof upstreamStream.destroy === 'function') {
      upstreamStream.destroy();
    }
  });

  try {
    const streamUrl = await findOfflineStreamUrl(videoId, fallbackQuery, meta || {});
    if (!streamUrl) {
      throw new Error('No offline stream URL resolved');
    }

    if (streamUrl.includes('.m3u8')) {
      await pipeHlsDownload(streamUrl, req, res);
      return;
    }

    const response = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'stream',
      timeout: 15000,
      httpsAgent,
      decompress: false,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      validateStatus: () => true
    });

    if (response.status >= 200 && response.status < 400) {
      upstreamStream = response.data;
      res.statusCode = 200;
      const ct = String(response.headers['content-type'] || '');
      res.setHeader('Content-Type', (!ct || ct.includes('video/')) ? 'audio/mp4' : ct);
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      response.data.pipe(res);
      return;
    }

    throw new Error(`Upstream status ${response.status}`);
  } catch (err) {
    console.error(`[OfflineDownload] Failed for ${videoId} (${meta?.title || fallbackQuery}):`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = {
  findOfflineStreamUrl,
  pipeOfflineDownload
};
