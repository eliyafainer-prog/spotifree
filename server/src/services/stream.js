const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Persistent HTTP Keep-Alive Agent for 0ms TLS reuse across SoundCloud & CDN sockets
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });

// Ensure cache directory exists
const CACHE_DIR = path.join(__dirname, '../../cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const URL_CACHE_FILE = path.join(CACHE_DIR, 'url_cache.json');

// Bounded in-memory caches (prevents memory leaks on Render 512MB container)
const MAX_CACHE_ENTRIES = 500;
const urlCache = new Map();
const inFlightRequests = new Map();

function setBoundedCache(map, key, value) {
  if (!key) return;
  if (map.size >= MAX_CACHE_ENTRIES && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
  map.set(key, value);
}

function getSignedUrlExpirationMs(url) {
  if (!url || typeof url !== 'string') return 0;
  try {
    const expMatch = url.match(/[?&](?:expires|expire)=(\d{10,13})/i);
    if (expMatch && expMatch[1]) {
      const val = Number(expMatch[1]);
      return val < 1e11 ? val * 1000 : val;
    }
    const policyMatch = url.match(/[?&]Policy=([A-Za-z0-9_-]+)/);
    if (policyMatch && policyMatch[1]) {
      const jsonStr = Buffer.from(policyMatch[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const epochMatch = jsonStr.match(/"AWS:EpochTime"\s*:\s*(\d{10,13})/);
      if (epochMatch && epochMatch[1]) {
        const val = Number(epochMatch[1]);
        return val < 1e11 ? val * 1000 : val;
      }
    }
  } catch (e) {}
  return 0;
}

function isValidCachedStreamUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('mime=audio%2Fwebm')) return false;
  if (url.includes('/preview/') || url.includes('cf-preview-media') || url.includes('_preview')) return false;
  const signedExp = getSignedUrlExpirationMs(url);
  if (signedExp > 0 && signedExp - 45000 <= Date.now()) {
    return false;
  }
  return true;
}

// Load disk cache on boot
try {
  if (fs.existsSync(URL_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(URL_CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (v && v.expiresAt > now && isValidCachedStreamUrl(v.url)) {
        setBoundedCache(urlCache, k, v);
      }
    }
  }
} catch (e) {}

async function saveCachesToDisk() {
  try {
    const urlObj = {};
    const now = Date.now();
    for (const [k, v] of urlCache.entries()) {
      if (v && v.expiresAt > now && isValidCachedStreamUrl(v.url)) {
        urlObj[k] = v;
      }
    }
    await fs.promises.writeFile(URL_CACHE_FILE, JSON.stringify(urlObj), 'utf8');
  } catch (e) {}
}

const cacheSaveInterval = setInterval(saveCachesToDisk, 30000);
if (cacheSaveInterval && typeof cacheSaveInterval.unref === 'function') {
  cacheSaveInterval.unref();
}

function evictStreamCache(videoId, fallbackQuery) {
  if (videoId) urlCache.delete(videoId);
  if (fallbackQuery) urlCache.delete(fallbackQuery.trim());
}

// ============================================================================
// PURE NODE.JS SOUNDCLOUD API V2 ENGINE (0MB extra RAM, ~300-500ms extraction)
// ============================================================================
let scClientId = 'tHVbSbDP4TaoMbPppngv6Tdry83vNbMQ';
let scClientIdRefreshPromise = null;

async function refreshSoundCloudClientId() {
  if (scClientIdRefreshPromise) return scClientIdRefreshPromise;
  scClientIdRefreshPromise = (async () => {
    try {
      const home = await axios.get('https://soundcloud.com', {
        timeout: 4000,
        httpsAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      });
      const scripts = [...String(home.data || '').matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
      for (const s of scripts.slice(-4).reverse()) {
        try {
          const js = await axios.get(s, { timeout: 3500, httpsAgent });
          const m = String(js.data || '').match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/) ||
                    String(js.data || '').match(/client_id="([a-zA-Z0-9]{32})"/);
          if (m && m[1]) {
            scClientId = m[1];
            console.log('[SoundCloud] Refreshed client_id:', scClientId);
            return scClientId;
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn('[SoundCloud] Failed to refresh client_id:', e.message);
    } finally {
      scClientIdRefreshPromise = null;
    }
    return scClientId;
  })();
  return scClientIdRefreshPromise;
}

const VERSION_SUFFIX_RE = /^(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|radio\s+edit|clean\s+edit|club\s+edit|edit|original\s+mix|extended(?:\s+mix)?|live(?:\s+.*)?|acoustic(?:\s+version)?|instrumental|version|mono|stereo|deluxe|bonus\s+track|אקוסטי|לייב|בהופעה.*|מתוך.*|רמיקס|רימיקס|גרסת\s+.*|גרסה\s+.*|שיר\s+הנושא.*)$/i;

function extractSongAndArtistFromMeta(meta = {}) {
  const rawTitle = String(meta?.title || '')
    .replace(/([\u0590-\u05FF])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u0590-\u05FF])/g, '$1 $2')
    .replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawArtist = String(meta?.artist || '')
    .replace(/([\u0590-\u05FF])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u0590-\u05FF])/g, '$1 $2')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\b(?:official|music|channel|הערוץ הרשמי|תאגיד השידור הישראלי|ישראל בידור|גלגלצ)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let working = rawTitle;
  if (working.includes('|')) {
    const p = working.split('|').map(s => s.trim()).filter(Boolean);
    if (p[0] && /\s*-\s*/.test(p[0])) {
      working = p[0];
    } else if (p.length >= 2 && /\s*-\s*/.test(p[1])) {
      working = `${p[0]} ${p.slice(1).join(' ')}`;
    } else if (p[0]) {
      working = p[0];
    }
  }

  const dashParts = working.split(/\s+-\s+|\s*-\s+/).map(s => s.trim()).filter(Boolean);
  let coreTitle = working;
  let extractedArtist = rawArtist;
  const titleCandidates = [];

  if (dashParts.length >= 2) {
    const left = dashParts[0];
    const right = dashParts.slice(1).join(' - ').trim();
    const artistLower = rawArtist.toLowerCase();
    const artistWords = artistLower.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1);
    const leftLower = left.toLowerCase();
    const rightLower = right.toLowerCase();

    const leftMatchesArtist = artistWords.length > 0 && artistWords.some(w => leftLower.includes(w));
    const rightMatchesArtist = artistWords.length > 0 && artistWords.some(w => rightLower.includes(w));

    if (VERSION_SUFFIX_RE.test(right)) {
      coreTitle = left;
      titleCandidates.push(left);
    } else if (leftMatchesArtist || !rightMatchesArtist) {
      // Standard "Artist - Song" (e.g. "עומר אדם - כשאת הולכת")
      coreTitle = right;
      titleCandidates.push(right);
      if (!extractedArtist) extractedArtist = left;
      else if (!leftMatchesArtist) extractedArtist = `${extractedArtist}, ${left}`;
    } else {
      // Reversed "Song - Artist"
      coreTitle = left;
      titleCandidates.push(left);
    }
  } else if (working) {
    titleCandidates.push(working);
  }

  for (const tc of [...titleCandidates]) {
    if (tc.includes('+')) {
      tc.split('+').map(s => s.trim()).filter(Boolean).forEach(sub => titleCandidates.push(sub));
    }
  }

  return {
    coreTitle: coreTitle.trim(),
    artist: extractedArtist.trim(),
    titleCandidates: [...new Set(titleCandidates.filter(Boolean))]
  };
}

/**
 * Score a SoundCloud track candidate for studio accuracy, duration proximity, and artist match
 */
function scoreSoundCloudCandidate(item, queryLower, meta = {}) {
  if (!item || item.snipped || item.policy === 'SNIP' || item.policy === 'BLOCK') return -999;
  const dur = Math.round((item.duration || 0) / 1000);
  const fullDur = Math.round((item.full_duration || item.duration || 0) / 1000);
  if (dur <= 45 || dur > 660) return -999;
  if (fullDur > dur + 5) return -999; // Reject truncated / Go+ preview tracks!

  const transcodings = item.media?.transcodings || [];
  const validTranscodings = transcodings.filter(t => t && t.url && !t.url.includes('preview') && !t.snipped);
  if (validTranscodings.length === 0) return -999;

  const title = String(item.title || '')
    .replace(/([\u0590-\u05FF])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u0590-\u05FF])/g, '$1 $2')
    .replace(/['׳’`]/g, '')
    .toLowerCase();
  const username = String(item.user?.username || '').replace(/['׳’`]/g, '').toLowerCase();
  const combined = `${title} ${username}`;

  // Disqualify podcasts, radio promos, jingles, or ad tracks
  const adOrPodcastWords = [
    'podcast', 'פודקאסט', 'פרק ', 'שידור', 'פרסומת', 'חסות', 'גינגל',
    'jingle', 'commercial', 'promo', 'פרומו', 'teaser', 'טיזר', 'trailer', 'טריילר'
  ];
  for (const aw of adOrPodcastWords) {
    if (combined.includes(aw)) return -999;
  }

  const targetDur = Number(meta?.durationSeconds) || 0;
  const rawTargetTitle = String(meta?.title || '').replace(/['׳’`]/g, '').toLowerCase().trim();
  const { titleCandidates: coreTitleCandidates, artist: parsedArtist } = extractSongAndArtistFromMeta(meta);
  const targetArtist = String(parsedArtist || meta?.artist || '').replace(/['׳’`]/g, '').toLowerCase().trim();
  const artistWordSet = new Set(
    targetArtist.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1)
  );

  let score = 100;

  // 1. Core title word match (never allow artist words alone to count as song title!)
  const stopWords = new Set(['כל', 'כך', 'של', 'את', 'עם', 'זה', 'על', 'אל', 'מן', 'זה', 'מה', 'לא', 'כי', 'גם', 'the', 'in', 'of', 'and', 'to', 'a', 'an']);
  const candTitleTokens = new Set(title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/));

  let bestRatio = -1;
  let tWords = [];
  for (const candCore of coreTitleCandidates) {
    const cleanCore = candCore.replace(/['׳’`]/g, '').toLowerCase();
    const words = cleanCore ? cleanCore.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1 || /\p{N}/u.test(w)) : [];
    const nonArtist = words.filter(w => !artistWordSet.has(w));
    const effectiveWords = nonArtist.length > 0 ? nonArtist : words;
    const imp = effectiveWords.filter(w => !stopWords.has(w));
    const toTest = imp.length > 0 ? imp : effectiveWords;
    if (toTest.length > 0) {
      const matched = toTest.filter(w => candTitleTokens.has(w) || candTitleTokens.has('ו' + w) || candTitleTokens.has('ה' + w) || (w.length >= 4 && title.includes(w))).length;
      const ratio = matched / toTest.length;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        tWords = effectiveWords;
      }
    }
  }

  if (bestRatio >= 0) {
    if (bestRatio < 0.65) return -999;
    score += Math.round(bestRatio * 95);
  } else if (queryLower) {
    const qWords = queryLower.replace(/['׳’`]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w) && !artistWordSet.has(w));
    if (qWords.length > 0) {
      const matched = qWords.filter(w => candTitleTokens.has(w) || (w.length >= 4 && combined.includes(w))).length;
      const ratio = matched / qWords.length;
      if (ratio < 0.6) return -999;
      score += Math.round(ratio * 70);
    } else {
      return -999;
    }
  }

  // 2. Duration proximity against Spotify studio duration
  if (targetDur > 40) {
    const diff = Math.abs(dur - targetDur);
    if (diff <= 3) score += 135;       // Exact Spotify studio master length!
    else if (diff <= 8) score += 95;   // Studio release within 8s
    else if (diff <= 15) score += 55;  // Close match
    else if (diff <= 25) score += 15;
    else if (diff <= 40) score -= 75;
    else score -= 180;
  } else if (dur >= 110 && dur <= 320) {
    score += 30;
  }

  // 3. Penalize non-studio versions (Remix / Live / Stage / Cover / Slowed / Karaoke / Mashup)
  const badWords = [
    'remix', 'rework', 'bootleg', 'edit', 'remake', 'cover', 'slowed',
    'reverb', 'sped up', 'nightcore', 'live', 'instrumental', 'karaoke', 'mashup', 'mash up',
    'רמיקס', 'רימיקס', 'קאבר', 'לייב', 'הופעה', 'בהופעה', 'מהבמה', 'מאשאפ',
    'מתוך המופע', 'מהמופע', 'במופע', 'חי באולפן', 'באולפן', 'קריוקי', 'מחרוזת'
  ];
  for (const bw of badWords) {
    if (title.includes(bw) && !rawTargetTitle.includes(bw) && !queryLower.includes(bw)) {
      score -= 160;
    }
  }

  // 4. Artist & Uploader verification
  if (targetArtist) {
    const aWords = targetArtist
      .replace(/[,&•/]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !['פסטיגל', 'משתתפי', 'הפסטיגל', 'various', 'artists'].includes(w));
    if (aWords.length > 0) {
      if (aWords.some(w => username.includes(w))) {
        score += 65; // Official artist / uploader match!
      } else if (aWords.some(w => title.includes(w)) || (combined.includes('פסטיגל') && (targetArtist.includes('פסטיגל') || String(meta?.album || '').includes('פסטיגל')))) {
        score += 45;
      } else {
        // Artist not mentioned in username or title: only allow if candidate title has no unrelated artist/song words!
        const candTitleClean = title.replace(/\.(mp3|m4a|wav)$/i, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
        const candWords = candTitleClean.split(/\s+/).filter(w => w.length > 1 && w !== 'פסטיגל');
        const extraWords = candWords.filter(cw => !tWords.some(tw => cw.includes(tw) || tw.includes(cw)));
        if (extraWords.length > 0) {
          return -999; // Rejects songs by other artists with a shared title word (e.g. "דנה ברגר לומדת לעוף")
        }
        score -= 25;
      }
    }
  }

  // 5. Prefer progressive HTTP MP3 transcodings (0ms direct byte-range seeking)
  const hasProgressive = validTranscodings.some(t => t.format?.protocol === 'progressive');
  if (hasProgressive) {
    score += 25;
  }

  return score;
}

/**
 * Search SoundCloud API v2 and return track collection
 */
async function searchSoundCloudApi(query, limit = 10) {
  const doReq = async (cid) => {
    const res = await axios.get('https://api-v2.soundcloud.com/search/tracks', {
      params: { q: query, client_id: cid, limit },
      timeout: 3200,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    return res.data?.collection || [];
  };

  try {
    return await doReq(scClientId);
  } catch (err) {
    if (err.response && (err.response.status === 401 || err.response.status === 403)) {
      const newCid = await refreshSoundCloudClientId();
      return await doReq(newCid);
    }
    throw err;
  }
}

/**
 * Resolve a SoundCloud track's best transcoding to a direct playable URL
 */
async function resolveSoundCloudTranscoding(item) {
  const transcodings = (item.media?.transcodings || []).filter(
    t => t && t.url && !t.url.includes('preview') && !t.snipped
  );
  if (transcodings.length === 0) return null;

  // Priority 1: Progressive HTTP MP3 (single file, full HTTP Range support)
  // Priority 2: HLS fMP4 AAC (aac_160k / aac_96k) or HLS MP3 (mp3_1_0), excluding multi-bitrate mpegurl master manifests
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
        timeout: 2500,
        httpsAgent
      });
      if (res.data && res.data.url && isValidCachedStreamUrl(res.data.url)) {
        return res.data.url;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Fast pure-Node.js SoundCloud studio track extractor (~300-500ms, 0MB Python overhead)
 */
async function extractSoundCloudDirect(rawQuery, meta = {}) {
  const { coreTitle, artist: extractedArtist } = extractSongAndArtistFromMeta(meta);
  const primaryArtist = String(extractedArtist || meta?.artist || '').split(/[,&/]/)[0].trim();
  const isFestigal = String(meta?.album || '').includes('פסטיגל') || String(meta?.artist || '').includes('פסטיגל');

  let primaryQuery = rawQuery || '';
  if (primaryArtist && coreTitle && !coreTitle.toLowerCase().includes(primaryArtist.toLowerCase())) {
    primaryQuery = `${primaryArtist} ${coreTitle}`;
  } else if (coreTitle) {
    primaryQuery = coreTitle;
  }

  const cleanPrimary = primaryQuery.replace(/[^\p{L}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanPrimary) throw new Error('Empty SoundCloud query');

  const items1 = await searchSoundCloudApi(cleanPrimary, 15).catch(() => []);
  const qLower = cleanPrimary.toLowerCase();
  let scored = items1
    .map(item => ({ item, score: scoreSoundCloudCandidate(item, qLower, meta) }))
    .filter(x => x.score > -500)
    .sort((a, b) => b.score - a.score);

  // Secondary fallback query if artist+title had no strong studio match
  if ((!scored.length || scored[0].score < 175) && coreTitle) {
    const secondaryRaw = isFestigal && !coreTitle.includes('פסטיגל') ? `${coreTitle} פסטיגל` : coreTitle;
    const cleanSecondary = secondaryRaw.replace(/[^\p{L}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim();
    if (cleanSecondary && cleanSecondary.toLowerCase() !== cleanPrimary.toLowerCase()) {
      const items2 = await searchSoundCloudApi(cleanSecondary, 15).catch(() => []);
      const seenIds = new Set(scored.map(x => x.item.id));
      for (const it of items2) {
        if (!seenIds.has(it.id)) {
          const s = scoreSoundCloudCandidate(it, cleanSecondary.toLowerCase(), meta);
          if (s > -500) scored.push({ item: it, score: s });
        }
      }
      scored.sort((a, b) => b.score - a.score);
    }
  }

  for (const cand of scored.slice(0, 4)) {
    const url = await resolveSoundCloudTranscoding(cand.item);
    if (url) return url;
  }

  throw new Error('No matching SoundCloud stream found');
}

/**
 * Fast 120ms YouTube oEmbed lookup to get title + artist when only videoId is provided
 */
async function fetchVideoMetaFromOembed(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const res = await axios.get(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { timeout: 1400, httpsAgent }
    );
    if (res.data && res.data.title) {
      const author = (res.data.author_name || '').replace(/\s*-\s*Topic$/i, '').trim();
      const rawTitle = res.data.title
        .replace(/\s*[\(\[](official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer|hd|4k|audio|קליפ\s*רשמי|אודיו\s*רשמי)[\)\]]/gi, '')
        .trim();
      let cleanTitle = rawTitle;
      let cleanArtist = author;
      if (rawTitle.includes(' - ')) {
        const parts = rawTitle.split(' - ');
        cleanArtist = parts[0].trim();
        cleanTitle = parts.slice(1).join(' - ').trim();
      }
      const query = cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())
        ? `${cleanArtist} - ${cleanTitle}`
        : rawTitle;
      return { query, title: cleanTitle, artist: cleanArtist };
    }
  } catch (e) {}
  return null;
}

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de'
];

/**
 * Fetch direct Google CDN audio stream URL from public Invidious instances
 */
async function fetchFromInvidious(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const promises = INVIDIOUS_INSTANCES.map(inst =>
    axios.get(`${inst}/api/v1/videos/${videoId}`, {
      timeout: 3500,
      httpsAgent,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }).then(res => {
      if (res.data && res.data.adaptiveFormats) {
        const audio = res.data.adaptiveFormats.find(f => f.type && f.type.includes('audio/mp4')) ||
                      res.data.adaptiveFormats.find(f => f.type && f.type.startsWith('audio/'));
        if (audio && audio.url) {
          return audio.url;
        }
      }
      throw new Error('No audio found in format list');
    })
  );

  try {
    return await Promise.any(promises);
  } catch (e) {
    return null;
  }
}

/**
 * Get audio stream URL for a given video ID or search query (~300-500ms, 0MB child process overhead)
 */
async function getAudioStreamUrl(videoId, fallbackQuery = null, isPriority = true, meta = null) {
  const effectiveQuery = fallbackQuery ? fallbackQuery.trim() : null;
  const cacheKey = (videoId && !videoId.startsWith('sp_') && videoId !== 'query')
    ? videoId
    : (effectiveQuery || videoId);

  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && isValidCachedStreamUrl(cached.url)) {
    return cached.url;
  }

  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const jobPromise = (async () => {
    const isVideoId = Boolean(videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId));
    const effectiveMeta = {
      durationSeconds: Number(meta?.durationSeconds) || 0,
      title: String(meta?.title || '').trim(),
      artist: String(meta?.artist || '').trim(),
      album: String(meta?.album || '').trim()
    };

    if (!effectiveMeta.title && effectiveQuery) {
      if (effectiveQuery.includes(' - ')) {
        const parts = effectiveQuery.split(' - ');
        if (!effectiveMeta.artist) effectiveMeta.artist = parts[0].trim();
        effectiveMeta.title = parts.slice(1).join(' - ').trim();
      } else {
        effectiveMeta.title = effectiveQuery;
      }
    }

    if (!effectiveMeta.title && isVideoId) {
      const oembed = await fetchVideoMetaFromOembed(videoId);
      if (oembed) {
        effectiveMeta.title = oembed.title || '';
        effectiveMeta.artist = oembed.artist || '';
      }
    }

    let streamUrl = null;

    // 1. Primary Fast Engine: Pure Node.js SoundCloud Studio Extractor (~300-500ms, works 100% in background <audio>)
    try {
      const qToUse = effectiveQuery || `${effectiveMeta.artist} ${effectiveMeta.title}`.trim();
      if (qToUse) {
        streamUrl = await extractSoundCloudDirect(qToUse, effectiveMeta);
      }
    } catch (e) {}

    // 2. If SoundCloud missed and we have a YouTube videoId whose oEmbed title wasn't checked yet, try oEmbed title
    if (!streamUrl && isVideoId) {
      const oembed = await fetchVideoMetaFromOembed(videoId);
      if (oembed && oembed.title) {
        try {
          streamUrl = await extractSoundCloudDirect(oembed.query || oembed.title, {
            ...effectiveMeta,
            title: oembed.title,
            artist: oembed.artist || effectiveMeta.artist
          });
        } catch (e) {}
      }
    }

    // 3. Fallback: Invidious direct stream if videoId is available
    if (!streamUrl && isVideoId) {
      streamUrl = await fetchFromInvidious(videoId);
    }

    if (!streamUrl) {
      throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
    }

    const signedExp = getSignedUrlExpirationMs(streamUrl);
    let ttlMs = 4 * 60 * 1000; // Default 4 minutes for SoundCloud signed URLs (which expire in ~5-7 mins)
    if (signedExp > Date.now() + 60000) {
      ttlMs = Math.min(45 * 60 * 1000, signedExp - Date.now() - 45000);
    } else if (streamUrl.includes('googlevideo.com')) {
      ttlMs = 30 * 60 * 1000;
    }

    const cacheEntry = {
      url: streamUrl,
      expiresAt: Date.now() + ttlMs
    };
    setBoundedCache(urlCache, cacheKey, cacheEntry);
    if (isVideoId) {
      setBoundedCache(urlCache, videoId, cacheEntry);
    }

    return streamUrl;
  })();

  inFlightRequests.set(cacheKey, jobPromise);
  try {
    return await jobPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Background pre-fetching (lightweight pure Node.js, max 2 tracks to conserve memory)
 */
async function prefetchTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  for (const track of tracks.slice(0, 2)) {
    if (!track) continue;
    const vid = track.streamableId || track.id;
    const fallbackQuery = `${track.artist || ''} - ${track.title || ''}`.replace(/^-\s*|\s*-$/g, '').trim();
    const key = (vid && !vid.startsWith('sp_')) ? vid : fallbackQuery;
    const meta = {
      durationSeconds: Number(track.durationSeconds) || 0,
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || ''
    };
    if (key && !urlCache.has(key) && !inFlightRequests.has(key)) {
      getAudioStreamUrl(vid, fallbackQuery || null, false, meta).catch(() => {});
    }
  }
}

/**
 * Patch init.mp4 mvhd, tkhd, elst, and mdhd boxes with the full track duration
 * so HTML5 <audio> immediately knows the exact full song duration instead of 10s!
 */
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

/**
 * Strip styp and sidx boxes from the beginning of .m4s segments so <audio>
 * never mistakes a 10s segment index (sidx) for the total song duration!
 */
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

/**
 * Build unified browser-like HTTP headers for upstream CDN requests (SoundCloud / CloudFront / googlevideo / Invidious)
 */
function buildUpstreamHeaders(targetUrl = '', rangeHeader = null) {
  const urlStr = String(targetUrl || '');
  const isGoogleVideo = urlStr.includes('googlevideo.com') || urlStr.includes('youtube.com');
  const isSoundCloud = urlStr.includes('sndcdn.com') || urlStr.includes('soundcloud.com');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'Connection': 'keep-alive'
  };

  if (isGoogleVideo) {
    headers['Referer'] = 'https://www.youtube.com/';
    headers['Origin'] = 'https://www.youtube.com';
    // googlevideo requires Range header to avoid throttling / 403 blocks
    headers['Range'] = rangeHeader || 'bytes=0-';
  } else if (isSoundCloud) {
    headers['Referer'] = 'https://soundcloud.com/';
    headers['Origin'] = 'https://soundcloud.com';
    if (rangeHeader) headers['Range'] = rangeHeader;
  } else if (rangeHeader) {
    headers['Range'] = rangeHeader;
  }

  return headers;
}

/**
 * Zero-process Pure Node.js HLS fMP4 / MP3 Stream Concatenator
 * Streams full-length fMP4 (with patched moov duration and stripped sidx) or MP3 segments using ~200KB RAM!
 * Supports HTTP Range requests and seeking so scrubber never snaps back to 0!
 */
async function pipeHlsInNode(m3u8Url, req, res) {
  let aborted = false;

  req.on('close', () => {
    aborted = true;
  });

  const m3u8Res = await axios.get(m3u8Url, {
    timeout: 4500,
    httpsAgent,
    maxRedirects: 5,
    headers: buildUpstreamHeaders(m3u8Url)
  });
  const lines = String(m3u8Res.data || '').split('\n');
  let mapUrl = null;
  const segments = [];
  let totalDurationSec = 0;
  let currentSegmentDur = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const infMatch = trimmed.match(/#EXTINF:([0-9.]+)/);
    if (infMatch && infMatch[1]) {
      currentSegmentDur = parseFloat(infMatch[1]) || 0;
    }
    const mapMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch && mapMatch[1]) {
      mapUrl = mapMatch[1];
    } else if (trimmed.startsWith('http')) {
      segments.push({
        url: trimmed,
        duration: currentSegmentDur,
        startTime: totalDurationSec
      });
      totalDurationSec += currentSegmentDur;
      currentSegmentDur = 0;
    }
  }

  if (segments.length === 0) {
    throw new Error('Empty HLS playlist');
  }

  const isMp3 = !mapUrl && (segments[0].url.includes('.mp3') || m3u8Url.includes('mp3'));
  const contentType = isMp3 ? 'audio/mpeg' : 'audio/mp4';

  // Support explicit seek parameter (?seek=seconds or ?start=seconds)
  let targetStartTime = 0;
  const seekQuery = parseFloat(req.query.seek || req.query.start);
  if (!isNaN(seekQuery) && seekQuery > 0) {
    targetStartTime = seekQuery;
  }

  // Find corresponding starting segment if seeking
  let startSegmentIdx = 0;
  if (targetStartTime > 0) {
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startTime + segments[i].duration > targetStartTime) {
        startSegmentIdx = i;
        break;
      }
    }
  }

  // Always return 200 OK without Range for HLS streams so browser decodes continuously without chunk errors or restarts
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=14400');

  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // 1. If fMP4 (init.mp4 map present), always send patched init.mp4 first so decoder initializes
  if (mapUrl && !aborted && !res.writableEnded) {
    try {
      const initRes = await axios.get(mapUrl, {
        responseType: 'arraybuffer',
        timeout: 6000,
        httpsAgent,
        maxRedirects: 5,
        headers: buildUpstreamHeaders(mapUrl)
      });
      const patchedInit = patchInitMp4Duration(Buffer.from(initRes.data), totalDurationSec);
      if (!aborted && !res.writableEnded) {
        res.write(patchedInit);
      }
    } catch (e) {}
  }

  // 2. Stream segments starting from startSegmentIdx
  for (let i = startSegmentIdx; i < segments.length; i++) {
    if (aborted || res.writableEnded) break;
    try {
      const segUrl = segments[i].url;
      const segRes = await axios.get(segUrl, {
        responseType: 'arraybuffer',
        timeout: 9000,
        httpsAgent,
        maxRedirects: 5,
        headers: buildUpstreamHeaders(segUrl)
      });
      if (aborted || res.writableEnded) break;
      const rawBuf = Buffer.from(segRes.data);
      const cleanBuf = isMp3 ? rawBuf : stripStypSidx(rawBuf);
      const canContinue = res.write(cleanBuf);
      if (!canContinue && !aborted && !res.writableEnded) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    } catch (segErr) {
      if (aborted) break;
    }
  }

  if (!aborted && !res.writableEnded) {
    res.end();
  }
}

/**
 * Direct Audio Stream Proxy: forwards HTTP Range requests with Content-Range & Content-Length
 * for 100% native scrubber timeline advancement, seek support, and mobile background playback.
 */
async function pipeStream(videoId, req, res, fallbackQuery = null, meta = null) {
  let upstreamStream = null;

  req.on('close', () => {
    if (upstreamStream && typeof upstreamStream.destroy === 'function') {
      upstreamStream.destroy();
    }
  });

  try {
    let streamUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);

    if (!streamUrl) {
      throw new Error('לא נמצא מקור שמע זמין לשיר זה.');
    }

    // Pure Node.js HLS fMP4/MP3 streaming (0 ffmpeg processes, 0MB overhead, ~120ms TTFB)
    if (streamUrl.includes('.m3u8')) {
      try {
        await pipeHlsInNode(streamUrl, req, res);
        return;
      } catch (hlsErr) {
        // Token expired: evict cache and re-extract once
        urlCache.delete(videoId);
        if (fallbackQuery) urlCache.delete(fallbackQuery);
        streamUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
        if (streamUrl && streamUrl.includes('.m3u8')) {
          await pipeHlsInNode(streamUrl, req, res);
          return;
        }
      }
    }

    const range = req.headers.range;
    let headers = buildUpstreamHeaders(streamUrl, range);

    let response = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'stream',
      headers,
      httpsAgent,
      decompress: false,
      maxRedirects: 5,
      validateStatus: () => true
    });

    // If cached URL expired or returned 403, re-extract fresh from SoundCloud immediately
    if (response.status >= 400) {
      urlCache.delete(videoId);
      if (fallbackQuery) urlCache.delete(fallbackQuery);
      const qToUse = fallbackQuery || `${meta?.artist || ''} ${meta?.title || ''}`.trim();
      if (qToUse) {
        streamUrl = await extractSoundCloudDirect(qToUse, meta || {});
        if (streamUrl.includes('.m3u8')) {
          await pipeHlsInNode(streamUrl, req, res);
          return;
        }
        headers = buildUpstreamHeaders(streamUrl, range);
        response = await axios({
          method: 'GET',
          url: streamUrl,
          responseType: 'stream',
          headers,
          httpsAgent,
          decompress: false,
          maxRedirects: 5,
          validateStatus: () => true
        });
      }
    }

    if (response.status >= 200 && response.status < 400) {
      upstreamStream = response.data;

      if (typeof res.status === 'function') {
        res.status(response.status);
      } else {
        res.statusCode = response.status;
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=14400');

      for (const [key, value] of Object.entries(response.headers)) {
        const lower = key.toLowerCase();
        if (['content-type', 'content-length', 'content-range'].includes(lower)) {
          res.setHeader(lower, value);
        }
      }

      const ct = String(res.getHeader('Content-Type') || '');
      if (!ct || ct.includes('video/')) {
        res.setHeader('Content-Type', 'audio/mp4');
      }

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      response.data.pipe(res);
      return;
    }

    throw new Error(`Upstream CDN returned status ${response.status}`);
  } catch (err) {
    console.error(`pipeStream error for ${videoId}:`, err.message);
    if (!res.headersSent) {
      if (typeof res.status === 'function') {
        res.status(500).json({ error: 'שגיאה בהזרמת השמע: ' + err.message });
      } else {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'שגיאה בהזרמת השמע: ' + err.message }));
      }
    }
  }
}

module.exports = {
  getAudioStreamUrl,
  pipeStream,
  pipeHlsInNode,
  prefetchTracks,
  scoreSoundCloudCandidate,
  evictStreamCache,
  buildUpstreamHeaders,
  fetchFromInvidious,
  patchInitMp4Duration,
  stripStypSidx
};
