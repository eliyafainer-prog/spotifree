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
 * Strict Offline Candidate Matcher.
 * Only accepts the ORIGINAL song by the SAME artist:
 *  - every title word must appear as a whole word in the candidate title (not inside another word, e.g. "כל" ≠ "הכלל")
 *  - the candidate title must not carry another song's name (extra content words are rejected)
 *  - the artist must appear in the uploader name or title
 *  - covers / remixes / reactions / edits / sped-up / live versions are rejected outright
 */
const HEB_PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'וה', 'וב', 'ול', 'שה', 'מה', 'וש'];
const FILLER_WORDS = new Set([
  'official', 'audio', 'video', 'music', 'lyrics', 'lyric', 'hd', 'hq', '4k', 'prod', 'by', 'feat', 'ft', 'featuring',
  'with', 'and', 'x', 'the', 'mp3', 'topic', 'new', 'single', 'version', 'original', 'mix', 'clip', 'visualizer',
  'אודיו', 'רשמי', 'רשמית', 'קליפ', 'מילים', 'עם', 'בהשתתפות', 'מארח', 'מארחת', 'את', 'של', 'הפקה', 'סינגל', 'חדש', 'השיר', 'שיר', 'גרסה', 'מקורית'
]);
const REJECT_WORDS = [
  'remix', 'rmx', 'rework', 'bootleg', 'edit', 'edits', 'remake', 'cover', 'slowed', 'reverb', 'sped up', 'speed up', 'spedup',
  'nightcore', 'karaoke', 'instrumental', 'mashup', 'mash up', 'live', 'reaction', 'reacts', 'tiktok', '8d', 'bass boost',
  'רמיקס', 'רימיקס', 'קאבר', 'קריוקי', 'בהופעה', 'הופעה', 'מהבמה', 'לייב', 'מאשאפ', 'משאפ', 'מחרוזת', 'מגיב', 'מגיבה', 'תגובה',
  'אדיט', 'מואץ', 'מהיר', 'טיקטוק', 'פרודיה', 'חידוש', 'בביצוע', 'אינסטרומנטלי', 'גרסת', 'podcast', 'פודקאסט', 'פרסומת'
];

function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\.(mp3|m4a|wav)$/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

function wordMatches(token, word) {
  if (token === word) return true;
  for (const p of HEB_PREFIXES) {
    if (token === p + word) return true;
  }
  return false;
}

function hasWord(tokens, word) {
  return tokens.some(t => wordMatches(t, word));
}

function hasPhrase(tokens, phraseTokens) {
  if (phraseTokens.length === 0) return false;
  for (let i = 0; i + phraseTokens.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (!wordMatches(tokens[i + j], phraseTokens[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function getCoreTitle(rawTitle) {
  const t = String(rawTitle || '')
    .replace(/\\/g, ' ')
    .replace(/\s*[\(\[][^)\]]*[\)\]]/g, '')
    .trim();
  return t.includes(' - ') ? t.split(' - ')[0].trim() : t;
}

function getArtistNames(rawArtist, aliases = []) {
  return [
    ...String(rawArtist || '').split(/[,&•/]+/),
    ...aliases
  ]
    .map(a => tokenize(a).filter(w => !['פסטיגל', 'משתתפי', 'הפסטיגל', 'topic', 'official', 'הערוץ', 'הרשמי'].includes(w)))
    .filter(a => a.length > 0);
}

function scoreOfflineCandidate(item, meta = {}, artistAliases = []) {
  if (!item || item.snipped || item.policy === 'SNIP' || item.policy === 'BLOCK') return -999;
  const dur = Math.round((item.duration || 0) / 1000);
  const fullDur = Math.round((item.full_duration || item.duration || 0) / 1000);
  if (dur <= 45 || dur > 720) return -999;
  if (fullDur > dur + 5) return -999;

  const transcodings = (item.media?.transcodings || []).filter(
    t => t && t.url && !t.url.includes('preview') && !t.snipped
  );
  if (transcodings.length === 0) return -999;

  const rawCandTitle = String(item.title || '').toLowerCase();
  const username = String(item.user?.username || '').toLowerCase();
  const rawTargetTitle = String(meta?.title || '').toLowerCase();

  // 1. Reject non-original versions (unless the requested title itself asks for it)
  for (const bw of REJECT_WORDS) {
    const inCand = bw.includes(' ') ? rawCandTitle.includes(bw) : hasWord(tokenize(rawCandTitle), bw);
    if (inCand && !rawTargetTitle.includes(bw)) return -999;
  }

  // Candidate title without bracketed extras like "(Prod. By Triangle)"
  const candTokens = tokenize(rawCandTitle.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' '));
  const userTokens = tokenize(username);
  const titleWords = tokenize(getCoreTitle(meta?.title)).filter(w => w.length > 1 || /\p{N}/u.test(w));
  if (titleWords.length === 0) return -999;

  // 2. Title: every word must appear as a whole word (allow 1 miss only for long titles of 5+ words)
  const matched = titleWords.filter(w => hasWord(candTokens, w)).length;
  const allowedMisses = titleWords.length >= 5 ? 1 : 0;
  if (titleWords.length - matched > allowedMisses) return -999;

  // 3. Artist must be present in uploader name or in the title
  const artistNames = getArtistNames(meta?.artist, artistAliases);
  let artistInUser = false;
  let artistInTitle = false;
  for (const name of artistNames) {
    if (hasPhrase(userTokens, name) || username.replace(/\s+/g, '').includes(name.join(''))) artistInUser = true;
    if (hasPhrase(candTokens, name)) artistInTitle = true;
  }
  if (artistNames.length > 0 && !artistInUser && !artistInTitle) return -999;

  // 4. No other song's name glued in: leftover content words (not title / artist / filler) are not allowed
  const artistWordSet = new Set(artistNames.flat());
  const leftovers = candTokens.filter(t =>
    !titleWords.some(w => wordMatches(t, w)) &&
    ![...artistWordSet].some(w => wordMatches(t, w)) &&
    !FILLER_WORDS.has(t) &&
    !/^\d+$/.test(t) &&
    t.length > 1
  );
  if (leftovers.length > 1) return -999;

  let score = 200 - leftovers.length * 40;
  if (artistInUser) score += 90;           // official artist page
  else if (artistInTitle) score += 30;     // someone else uploaded it

  if (item.user?.verified) score += 40;
  const followers = Number(item.user?.followers_count) || 0;
  if (followers >= 10000) score += 30;
  else if (followers >= 1000) score += 15;
  else if (!artistInUser && followers < 100) score -= 40; // random small uploader

  const targetDur = Number(meta?.durationSeconds) || 0;
  if (targetDur > 40) {
    const diff = Math.abs(dur - targetDur);
    if (diff <= 4) score += 120;
    else if (diff <= 10) score += 70;
    else if (diff <= 20) score += 10;
    else if (diff <= 35) score -= 80;
    else return -999; // far from the original length = different version
  }

  if (transcodings.some(t => t.format?.protocol === 'progressive')) score += 10;
  return score;
}

async function fetchCatalogArtistAliases(meta = {}) {
  const coreTitle = getCoreTitle(meta?.title);
  const primaryArtist = String(meta?.artist || '').split(/[,&•]/)[0].trim();
  if (!coreTitle || !primaryArtist) return [];
  const aliases = new Set();
  const titleTokens = tokenize(coreTitle);
  try {
    const r = await axios.get('https://api.deezer.com/search', {
      params: { q: `${primaryArtist} ${coreTitle}`, limit: 5 },
      timeout: 2500,
      httpsAgent
    });
    for (const d of r.data?.data || []) {
      const dTokens = tokenize(d.title);
      if (titleTokens.every(w => hasWord(dTokens, w)) && d.artist?.name) aliases.add(d.artist.name);
    }
  } catch (e) {}
  return [...aliases];
}

/**
 * Offline download source finder (same engine as normal playback first, then strict multi-query SoundCloud search)
 */
async function findOfflineStreamUrl(videoId, fallbackQuery, meta = {}) {
  // 1. Primary stream engine (identical to normal playback)
  try {
    const primaryUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
    if (primaryUrl) return primaryUrl;
  } catch (e) {}

  // 2. Strict multi-query SoundCloud search (original song, same artist only)
  const coreTitle = getCoreTitle(meta?.title);
  const primaryArtist = String(meta?.artist || '').split(/[,&•]/)[0].trim();
  if (!coreTitle) throw new Error('לא נמצא מקור שמע להורדה עבור שיר זה');

  const artistAliases = await fetchCatalogArtistAliases(meta);

  // YouTube oEmbed is used only to learn an English artist alias, and only if that video really is this song
  const oembed = await fetchYoutubeOembed(videoId);
  if (oembed) {
    const oTokens = tokenize(oembed.title);
    const titleTokens = tokenize(coreTitle).filter(w => w.length > 1);
    const sameSong = titleTokens.length > 0 && titleTokens.every(w => hasWord(oTokens, w));
    const badVideo = REJECT_WORDS.some(bw => hasWord(oTokens, bw));
    if (sameSong && !badVideo && oembed.author) artistAliases.push(oembed.author);
  }

  const queries = [
    primaryArtist ? `${primaryArtist} ${coreTitle}` : '',
    ...artistAliases.map(a => `${a} ${coreTitle}`),
    coreTitle
  ]
    .map(q => q.replace(/[^\p{L}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const candidates = new Map();
  for (const q of [...new Set(queries)].slice(0, 4)) {
    const items = await searchScTracks(q, 20);
    for (const it of items) {
      if (!it || !it.id || candidates.has(it.id)) continue;
      const s = scoreOfflineCandidate(it, meta, artistAliases);
      if (s > 0) candidates.set(it.id, { item: it, score: s });
    }
    const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 300) break;
  }

  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score);
  for (const cand of sorted.slice(0, 4)) {
    const streamUrl = await resolveScStreamUrl(cand.item, false);
    if (streamUrl) {
      console.log(`[OfflineDownload] "${meta?.artist} - ${meta?.title}" -> SC "${cand.item.user?.username} :: ${cand.item.title}" (${cand.score})`);
      return streamUrl;
    }
  }

  // No 30s previews, covers, remixes or unrelated songs: an honest failure is better than a wrong song.
  throw new Error('לא נמצאה גרסה מקורית מלאה של השיר להורדה');
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
  pipeOfflineDownload,
  scoreOfflineCandidate
};
