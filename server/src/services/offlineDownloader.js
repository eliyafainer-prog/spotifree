const axios = require('axios');
const https = require('https');
const { execFile } = require('child_process');
const { getAudioStreamUrl } = require('./stream');

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

async function searchScTracks(query, limit = 18) {
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

// Bilingual Hebrew <-> English artist aliases for high-accuracy cross-language matching
const ARTIST_BILINGUAL_GROUPS = [
  ['עומר אדם', 'omer adam'],
  ['אושר כהן', 'osher cohen', 'osher cohen music'],
  ['נועה קירל', 'noa kirel'],
  ['פאר טסי', 'peer tasi'],
  ['אייל גולן', 'eyal golan'],
  ['איתי לוי', 'itay levi'],
  ['עדן חסון', 'eden hason'],
  ['עדן בן זקן', 'eden ben zaken'],
  ['רביד פלוטניק', 'נצ\'י נצ\'', 'נצ׳י נצ׳', 'נצי נצ', 'ravid plotnik', 'nechi nech', 'tuna'],
  ['טונה', 'tuna'],
  ['הדג נחש', 'hadag nahash'],
  ['מועדון הקצב של אביהו פנחסוב', 'אביהו פנחסוב', 'the avihu pinhasov rhythm club', 'avihu pinhasov'],
  ['הפרויקט של עידן רייכל', 'עידן רייכל', 'the idan raichel project', 'idan raichel'],
  ['יסמין מועלם', 'jasmin moallem'],
  ['חנן בן ארי', 'hanan ben ari'],
  ['אודיה', 'odeya'],
  ['אגם בוחבוט', 'agam buhbut'],
  ['מרגי', 'יהונתן מרגי', 'mergui'],
  ['סטטיק', 'static', 'סטטיק ובן אל', 'static and ben el'],
  ['משה פרץ', 'moshe peretz'],
  ['שרית חדד', 'sarit hadad'],
  ['ליאור נרקיס', 'lior narkis'],
  ['דודו אהרון', 'dudu aharon'],
  ['עידן עמדי', 'idan amedi'],
  ['נתן גושן', 'nathan goshen'],
  ['ישי ריבו', 'ishay ribo'],
  ['אביב גפן', 'aviv geffen'],
  ['שלמה ארצי', 'shlomo artzi'],
  ['אריק איינשטיין', 'arik einstein'],
  ['משינה', 'mashina'],
  ['היהודים', 'hayehudim'],
  ['מוניקה סקס', 'monica sex'],
  ['כוורת', 'kaveret'],
  ['זוהר ארגוב', 'zohar argov'],
  ['נומי', 'numi']
];

const SONG_TITLE_TRANSLATIONS = {
  "she'eriot shel ha'chaim": 'שאריות של החיים',
  'sheeriot shel hachaim': 'שאריות של החיים',
  'יוניקורן': 'unicorn',
  'unicorn': 'יוניקורן'
};

function expandArtistAliases(artists = []) {
  const expanded = new Set(artists.filter(Boolean));
  for (const a of [...expanded]) {
    const low = a.toLowerCase().trim();
    for (const group of ARTIST_BILINGUAL_GROUPS) {
      if (group.some(g => low.includes(g) || g.includes(low))) {
        group.forEach(g => expanded.add(g));
      }
    }
  }
  return [...expanded];
}

const HEB_PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'וה', 'וב', 'ול', 'שה', 'מה', 'וש'];
const FILLER_WORDS = new Set([
  'official', 'audio', 'video', 'music', 'lyrics', 'lyric', 'hd', 'hq', '4k', 'prod', 'by', 'feat', 'ft', 'featuring',
  'with', 'and', 'x', 'the', 'mp3', 'wav', 'm4a', 'kbps', '320k', '320', 'topic', 'new', 'single', 'version', 'original', 'mix', 'clip', 'visualizer',
  'אודיו', 'רשמי', 'רשמית', 'קליפ', 'מילים', 'עם', 'בהשתתפות', 'מארח', 'מארחת', 'את', 'של', 'הפקה', 'סינגל', 'חדש', 'השיר', 'שיר', 'גרסה', 'מקורית', 'המקורי', 'מתוך', 'אלבום'
]);
const HARD_REJECT_WORDS = [
  'karaoke', 'instrumental', 'reaction', 'reacts', 'parody', 'podcast', 'jingle', 'promo', 'teaser', 'trailer',
  'קריוקי', 'מגיב', 'מגיבה', 'תגובה', 'פרודיה', 'אינסטרומנטלי', 'פודקאסט', 'פרסומת', 'פרומו', 'טיזר', 'טריילר'
];
const SOFT_PENALTY_WORDS = [
  'remix', 'rmx', 'rework', 'bootleg', 'edit', 'edits', 'remake', 'cover', 'slowed', 'reverb', 'sped up', 'speed up', 'spedup',
  'nightcore', 'mashup', 'mash up', 'live',
  'רמיקס', 'רימיקס', 'קאבר', 'בהופעה', 'הופעה', 'מהבמה', 'לייב', 'מאשאפ', 'משאפ', 'מחרוזת', 'אדיט', 'מואץ', 'חידוש', 'בביצוע'
];

function separateHebrewAndLatin(str) {
  return String(str || '')
    .replace(/([\u0590-\u05FF])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u0590-\u05FF])/g, '$1 $2');
}

function tokenize(str) {
  return separateHebrewAndLatin(str)
    .toLowerCase()
    .replace(/\.(mp3|m4a|wav|flac)$/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

function wordMatches(token, word) {
  if (token === word) return true;
  for (const p of HEB_PREFIXES) {
    if (token === p + word || word === p + token) return true;
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
      if (!wordMatches(tokens[i + j], phraseTokens[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Clean YouTube / Spotify title and extract all candidate song titles and artist names
 * Properly handles "Artist - Song", "Song - Artist", "Artist | Artist - Song", "Song | Artist", and medleys ("Song A + Song B")
 */
function parseTrackMeta(meta = {}, fallbackQuery = '') {
  const rawTitle = separateHebrewAndLatin(meta?.title || fallbackQuery || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ')
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ')
    .replace(/\b(?:next\s*202\d|next|נקסט|היכל מנורה מבטחים|היכל מנורה|לייב פארק[^\s|]*|ישראל מיוזיק)\b/gi, ' ')
    .replace(/\b(?:19\d\d|20[0-2]\d)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawArtist = separateHebrewAndLatin(meta?.artist || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\b(?:official|music|channel|תאגיד השידור הישראלי|הערוץ הרשמי|ישראל בידור|גלגלצ)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleCandidates = [];
  const artistCandidates = [];

  if (rawArtist) {
    rawArtist.split(/[,&•/|]+|\s+ו(?=[א-ת])|\s+עם\s+|\s+מארח(?:ת)?(?:\s+את)?\s+/i)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(a => artistCandidates.push(a));
  }

  let workingTitle = rawTitle;

  // Handle pipe '|' cases
  if (workingTitle.includes('|')) {
    const pipeParts = workingTitle.split('|').map(s => s.trim()).filter(Boolean);
    if (pipeParts[0] && /\s*-\s*/.test(pipeParts[0])) {
      // Case A: "רביד פלוטניק וטונה - יום חדש | ההופעה המשותפת..." -> before '|' is "Artist - Song"
      workingTitle = pipeParts[0];
    } else if (pipeParts.length >= 2 && /\s*-\s*/.test(pipeParts[1])) {
      // Case B: "טונה | רביד פלוטניק - אני כאן לשבור" -> pipe separates artists before '-'
      artistCandidates.push(pipeParts[0]);
      workingTitle = pipeParts.slice(1).join(' ');
    } else if (pipeParts.length === 2) {
      // Case C: "יוניקורן | עדן גולן ונועה קירל" -> part 0 is title, part 1 is artist
      titleCandidates.push(pipeParts[0]);
      artistCandidates.push(pipeParts[1]);
      workingTitle = pipeParts[0];
    }
  }

  // Handle hyphen '-' cases ("Artist - Song" or "Song - Artist")
  if (/\s+-\s+|\s*-\s+/.test(workingTitle)) {
    const dashParts = workingTitle.split(/\s+-\s+|\s*-\s+/).map(s => s.trim()).filter(Boolean);
    if (dashParts.length >= 2) {
      const left = dashParts[0];
      const right = dashParts.slice(1).join(' - ').trim();
      // In Hebrew/YouTube titles, "Artist - Song" puts the song in `right` and artist in `left`
      titleCandidates.push(right);
      left.split(/[,&•/|]+|\s+ו(?=[א-ת])|\s+עם\s+|\s+מארח(?:ת)?(?:\s+את)?\s+/i)
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(a => artistCandidates.push(a));
    }
  } else if (workingTitle) {
    titleCandidates.push(workingTitle);
  }

  // If any candidate has '+' (e.g. "דו קרב+ רק שלך"), add individual parts too
  for (const tc of [...titleCandidates]) {
    if (tc.includes('+')) {
      tc.split('+').map(s => s.trim()).filter(Boolean).forEach(sub => titleCandidates.unshift(sub));
    }
  }

  // Add known bilingual title translations (e.g. "She'eriot Shel Ha'Chaim" -> "שאריות של החיים", "יוניקורן" -> "Unicorn")
  for (const tc of [...titleCandidates]) {
    const low = tc.toLowerCase().trim();
    if (SONG_TITLE_TRANSLATIONS[low]) {
      titleCandidates.push(SONG_TITLE_TRANSLATIONS[low]);
    }
  }

  const uniqueTitles = [...new Set(titleCandidates.map(t => t.trim()).filter(t => t.length >= 2))];
  const uniqueArtists = expandArtistAliases(artistCandidates);

  return {
    titles: uniqueTitles.length > 0 ? uniqueTitles : [rawTitle].filter(Boolean),
    artists: uniqueArtists
  };
}

function getArtistTokenGroups(artists = []) {
  return artists
    .map(a => tokenize(a).filter(w => !['פסטיגל', 'משתתפי', 'הפסטיגל', 'topic', 'official', 'הערוץ', 'הרשמי', 'music'].includes(w)))
    .filter(a => a.length > 0);
}

function scoreOfflineCandidate(item, meta = {}, parsedMeta = null) {
  if (!item || item.snipped || item.policy === 'SNIP' || item.policy === 'BLOCK') return -999;
  const dur = Math.round((item.duration || 0) / 1000);
  const fullDur = Math.round((item.full_duration || item.duration || 0) / 1000);
  if (dur <= 45 || dur > 780) return -999;
  if (fullDur > dur + 5) return -999;

  const transcodings = (item.media?.transcodings || []).filter(
    t => t && t.url && !t.url.includes('preview') && !t.snipped
  );
  if (transcodings.length === 0) return -999;

  const rawCandTitle = separateHebrewAndLatin(item.title || '').toLowerCase();
  const username = separateHebrewAndLatin(item.user?.username || '').toLowerCase();
  const rawTargetTitle = String(meta?.title || '').toLowerCase();

  const candFullTokens = tokenize(rawCandTitle);

  // 1. Hard reject karaoke / podcasts / reactions / promos
  for (const hw of HARD_REJECT_WORDS) {
    const inCand = hw.includes(' ') ? rawCandTitle.includes(hw) : hasWord(candFullTokens, hw);
    if (inCand && !rawTargetTitle.includes(hw)) return -999;
  }

  const { titles, artists } = parsedMeta || parseTrackMeta(meta);
  const candClean = rawCandTitle.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ');
  const candTokens = tokenize(candClean);
  const userTokens = tokenize(username);

  // Also split candidate title by ' - ' so we can evaluate just the song part without counting the Hebrew/English artist prefix as leftovers
  const candDashParts = candClean.split(/\s+-\s+|\s*-\s+/).map(s => tokenize(s)).filter(arr => arr.length > 0);
  const artistGroups = getArtistTokenGroups(artists);
  const artistWordSet = new Set(artistGroups.flat());

  let bestTitleMatchScore = -999;
  let matchedTitleTokens = [];

  for (const candTargetTitle of titles) {
    // Strip artist words from target title tokens so an artist name alone never counts as a song title match
    const rawWords = tokenize(candTargetTitle).filter(w => (w.length > 1 || /\p{N}/u.test(w)) && !FILLER_WORDS.has(w));
    const nonArtistWords = rawWords.filter(w => ![...artistWordSet].some(aw => wordMatches(w, aw)));
    const tWords = nonArtistWords.length > 0 ? nonArtistWords : rawWords;
    if (tWords.length === 0) continue;

    const matched = tWords.filter(w => hasWord(candTokens, w)).length;
    const allowedMisses = tWords.length >= 4 ? 1 : 0;
    if (tWords.length - matched <= allowedMisses) {
      const ratio = matched / tWords.length;
      const s = Math.round(ratio * 150);
      if (s > bestTitleMatchScore) {
        bestTitleMatchScore = s;
        matchedTitleTokens = tWords;
      }
    }
  }

  if (bestTitleMatchScore < 0) return -999;

  // 2. Artist verification (must match one of the Hebrew/English artist aliases in username or title)
  let artistInUser = false;
  let artistInTitle = false;
  for (const grp of artistGroups) {
    if (hasPhrase(userTokens, grp) || username.replace(/\s+/g, '').includes(grp.join(''))) artistInUser = true;
    if (hasPhrase(candTokens, grp) || grp.every(w => hasWord(candTokens, w))) artistInTitle = true;
  }

  if (artistGroups.length > 0 && !artistInUser && !artistInTitle) {
    return -999;
  }

  // Check leftover words on the best matching segment of the SoundCloud title
  const tokenPoolsToCheck = [candTokens, ...candDashParts];
  let minLeftovers = 999;
  for (const pool of tokenPoolsToCheck) {
    if (!matchedTitleTokens.every(w => hasWord(pool, w))) continue;
    const lf = pool.filter(t =>
      !matchedTitleTokens.some(w => wordMatches(t, w)) &&
      ![...artistWordSet].some(w => wordMatches(t, w)) &&
      !FILLER_WORDS.has(t) &&
      !/^\d+$/.test(t) &&
      t.length > 1
    );
    if (lf.length < minLeftovers) minLeftovers = lf.length;
  }
  if (minLeftovers === 999) {
    const lf = candTokens.filter(t =>
      !matchedTitleTokens.some(w => wordMatches(t, w)) &&
      ![...artistWordSet].some(w => wordMatches(t, w)) &&
      !FILLER_WORDS.has(t) &&
      !/^\d+$/.test(t) &&
      t.length > 1
    );
    minLeftovers = lf.length;
  }

  if (minLeftovers > 3) {
    return -999;
  }

  let score = 150 + bestTitleMatchScore - minLeftovers * 22;

  if (artistInUser) score += 95;
  else if (artistInTitle) score += 55;

  // 3. Soft penalty for Remix / Live / Cover so original studio version always wins when available,
  //    but if only a Live / Remix exists on SoundCloud, it still has a positive fallback score!
  for (const sw of SOFT_PENALTY_WORDS) {
    const inCand = sw.includes(' ') ? rawCandTitle.includes(sw) : hasWord(candFullTokens, sw);
    if (inCand && !rawTargetTitle.includes(sw)) {
      score -= 165;
    }
  }

  if (item.user?.verified) score += 40;
  const followers = Number(item.user?.followers_count) || 0;
  if (followers >= 10000) score += 25;
  else if (followers >= 1000) score += 10;

  // 4. Duration proximity bonus (never hard-reject a studio 180-260s track just because the YouTube video was a 350s live clip)
  const targetDur = Number(meta?.durationSeconds) || 0;
  if (targetDur > 40) {
    const diff = Math.abs(dur - targetDur);
    if (diff <= 5) score += 110;
    else if (diff <= 12) score += 70;
    else if (diff <= 25) score += 30;
    else if (diff <= 45) score += 0;
    else if (dur >= 120 && dur <= 310) score -= 25;
    else score -= 90;
  }

  if (transcodings.some(t => t.format?.protocol === 'progressive')) score += 15;
  return score;
}

async function fetchCatalogMetadataAliases(meta = {}) {
  const parsed = parseTrackMeta(meta);
  const coreTitle = parsed.titles[0] || '';
  const primaryArtist = parsed.artists[0] || '';
  if (!coreTitle) return { artists: [], titles: [] };

  const extraArtists = new Set();
  const titleTokens = tokenize(coreTitle);

  try {
    const q = `${primaryArtist} ${coreTitle}`.trim();
    const r = await axios.get('https://api.deezer.com/search', {
      params: { q, limit: 5 },
      timeout: 2500,
      httpsAgent
    });
    for (const d of r.data?.data || []) {
      const dTokens = tokenize(d.title_short || d.title || '');
      if (titleTokens.length > 0 && titleTokens.every(w => hasWord(dTokens, w)) && d.artist?.name) {
        extraArtists.add(d.artist.name);
      }
    }
  } catch (e) {}

  return {
    artists: [...extraArtists],
    titles: []
  };
}

/**
 * Tier-3 Fallback: Extract direct audio stream URL from YouTube via yt-dlp when a track does not exist on SoundCloud
 */
async function extractYoutubeDirectFallback(videoId, meta = {}) {
  let targetVid = videoId;
  if (!targetVid || !/^[a-zA-Z0-9_-]{11}$/.test(targetVid)) {
    try {
      const { resolveTrackToStreamableId } = require('./importer');
      const resolved = await resolveTrackToStreamableId({
        id: videoId,
        title: meta?.title || '',
        artist: meta?.artist || '',
        durationSeconds: meta?.durationSeconds || 0
      });
      if (resolved?.streamableId && /^[a-zA-Z0-9_-]{11}$/.test(resolved.streamableId)) {
        targetVid = resolved.streamableId;
      }
    } catch (e) {}
  }

  if (!targetVid || !/^[a-zA-Z0-9_-]{11}$/.test(targetVid)) return null;

  const pyBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const ytUrl = `https://www.youtube.com/watch?v=${targetVid}`;

  return new Promise((resolve) => {
    execFile(
      pyBin,
      [
        '-m',
        'yt_dlp',
        '-f',
        '140/bestaudio[ext=m4a]/bestaudio',
        '-g',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        ytUrl
      ],
      { timeout: 12000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const line = String(stdout).trim().split('\n')[0]?.trim();
        if (line && line.startsWith('http')) {
          return resolve(line);
        }
        resolve(null);
      }
    );
  });
}

/**
 * Offline download source finder:
 * Tier 1: Primary stream engine
 * Tier 2: Multi-query bilingual SoundCloud search (handles "Artist - Song", Hebrew<->English aliases, YouTube oEmbed title resolution)
 * Tier 3: Direct YouTube m4a extraction via yt-dlp for YouTube-exclusive tracks
 */
async function findOfflineStreamUrl(videoId, fallbackQuery, meta = {}) {
  // 1. Primary stream engine
  try {
    const primaryUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
    if (primaryUrl) return primaryUrl;
  } catch (e) {}

  // 2. If videoId is an unresolved stub (sp_...), resolve it to a real YouTube ID so oEmbed can reveal Hebrew/English titles
  let effectiveVideoId = videoId;
  if (!effectiveVideoId || String(effectiveVideoId).startsWith('sp_') || effectiveVideoId === 'query') {
    try {
      const { resolveTrackToStreamableId } = require('./importer');
      const resolved = await resolveTrackToStreamableId({
        id: videoId,
        title: meta?.title || fallbackQuery || '',
        artist: meta?.artist || '',
        durationSeconds: meta?.durationSeconds || 0
      });
      if (resolved?.streamableId && /^[a-zA-Z0-9_-]{11}$/.test(resolved.streamableId)) {
        effectiveVideoId = resolved.streamableId;
      }
    } catch (e) {}
  }

  const parsed = parseTrackMeta(meta, fallbackQuery);

  // Enrich with YouTube oEmbed title & author if available
  const oembed = await fetchYoutubeOembed(effectiveVideoId);
  if (oembed) {
    const oParsed = parseTrackMeta({ title: oembed.title, artist: oembed.author });
    for (const t of oParsed.titles) {
      if (!parsed.titles.includes(t)) parsed.titles.push(t);
    }
    for (const a of oParsed.artists) {
      if (!parsed.artists.includes(a)) parsed.artists.push(a);
    }
  }

  // Enrich with Deezer catalog aliases
  const catAliases = await fetchCatalogMetadataAliases(meta);
  for (const t of catAliases.titles) {
    if (!parsed.titles.includes(t)) parsed.titles.push(t);
  }
  parsed.artists = expandArtistAliases([...parsed.artists, ...catAliases.artists]);

  // Build prioritized SoundCloud search queries
  const queryList = [];
  for (const t of parsed.titles.slice(0, 3)) {
    for (const a of parsed.artists.slice(0, 3)) {
      if (!t.toLowerCase().includes(a.toLowerCase())) {
        queryList.push(`${a} ${t}`);
      }
    }
    queryList.push(t);
  }

  const cleanQueries = [...new Set(
    queryList
      .map(q => q.replace(/[^\p{L}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim())
      .filter(q => q.length >= 2)
  )];

  const candidates = new Map();
  for (const q of cleanQueries.slice(0, 6)) {
    const items = await searchScTracks(q, 18);
    for (const it of items) {
      if (!it || !it.id || candidates.has(it.id)) continue;
      const s = scoreOfflineCandidate(it, meta, parsed);
      if (s > -100) candidates.set(it.id, { item: it, score: s });
    }
    const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 310) break;
  }

  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score);
  for (const cand of sorted.slice(0, 5)) {
    const streamUrl = await resolveScStreamUrl(cand.item, false);
    if (streamUrl) {
      console.log(`[OfflineDownload] "${meta?.artist} - ${meta?.title}" -> SC "${cand.item.user?.username} :: ${cand.item.title}" (score: ${cand.score})`);
      return streamUrl;
    }
  }

  // 3. Tier-3 Fallback: Direct YouTube audio extraction for YouTube-exclusive songs
  const ytDirectUrl = await extractYoutubeDirectFallback(effectiveVideoId, meta);
  if (ytDirectUrl) {
    console.log(`[OfflineDownload] "${meta?.artist} - ${meta?.title}" -> YouTube Direct m4a (${effectiveVideoId})`);
    return ytDirectUrl;
  }

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

async function fetchSegmentWithRetry(segUrl) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const segRes = await axios.get(segUrl, { responseType: 'arraybuffer', timeout: 10000, httpsAgent });
      return Buffer.from(segRes.data);
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 300));
    }
  }
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
    const initBuf = await fetchSegmentWithRetry(mapUrl);
    const patchedInit = patchInitMp4Duration(initBuf, totalDurationSec);
    if (!aborted && !res.writableEnded) {
      res.write(patchedInit);
    }
  }

  // Fetch segments in parallel batches of 4 while writing in strict sequential order for 4x faster offline downloads
  const BATCH_SIZE = 4;
  for (let i = 0; i < mediaUrls.length; i += BATCH_SIZE) {
    if (aborted || res.writableEnded) break;
    const batchUrls = mediaUrls.slice(i, i + BATCH_SIZE);
    const buffers = await Promise.all(batchUrls.map(u => fetchSegmentWithRetry(u)));

    for (const rawBuf of buffers) {
      if (aborted || res.writableEnded || !rawBuf) break;
      const cleanBuf = isMp3 ? rawBuf : stripStypSidx(rawBuf);
      const canContinue = res.write(cleanBuf);
      if (!canContinue && !aborted && !res.writableEnded) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
  }

  if (!aborted && !res.writableEnded) {
    res.end();
  }
}

/**
 * Dedicated Offline Download Stream Handler:
 * Uses longer timeouts, parallel segment batching, and 3-tier bilingual + YouTube fallbacks for ~100% download reliability.
 */
async function pipeOfflineDownload(videoId, req, res, fallbackQuery = null, meta = null) {
  let upstreamStream = null;
  req.on('close', () => {
    if (upstreamStream && typeof upstreamStream.destroy === 'function') {
      upstreamStream.destroy();
    }
  });

  try {
    let streamUrl = await findOfflineStreamUrl(videoId, fallbackQuery, meta || {});
    if (!streamUrl) {
      throw new Error('No offline stream URL resolved');
    }

    if (streamUrl.includes('.m3u8')) {
      try {
        await pipeHlsDownload(streamUrl, req, res);
        return;
      } catch (hlsErr) {
        if (!res.headersSent) {
          // Evict stale cached URL and re-resolve fresh
          const { evictStreamCache } = require('./stream');
          if (typeof evictStreamCache === 'function') evictStreamCache(videoId, fallbackQuery);
          streamUrl = await findOfflineStreamUrl(videoId, fallbackQuery, meta || {});
          if (streamUrl && streamUrl.includes('.m3u8')) {
            await pipeHlsDownload(streamUrl, req, res);
            return;
          }
        } else {
          throw hlsErr;
        }
      }
    }

    const response = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'stream',
      timeout: 20000,
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
  scoreOfflineCandidate,
  parseTrackMeta
};
