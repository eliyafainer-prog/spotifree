const axios = require('axios');
const https = require('https');
const {
  getAudioStreamUrl,
  evictStreamCache,
  buildUpstreamHeaders,
  fetchFromInvidious,
  patchInitMp4Duration,
  stripStypSidx
} = require('./stream');

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
        maxRedirects: 5,
        headers: buildUpstreamHeaders('https://soundcloud.com')
      });
      const scripts = [...String(home.data || '').matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
      for (const s of scripts.slice(-4).reverse()) {
        try {
          const js = await axios.get(s, {
            timeout: 4000,
            httpsAgent,
            maxRedirects: 5,
            headers: buildUpstreamHeaders(s)
          });
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

async function searchScTracks(query, limit = 20) {
  if (!query || !query.trim()) return [];
  const doSearch = async (cid) => {
    const res = await axios.get('https://api-v2.soundcloud.com/search/tracks', {
      params: { q: query.trim(), client_id: cid, limit },
      timeout: 4500,
      httpsAgent,
      maxRedirects: 5,
      headers: buildUpstreamHeaders('https://api-v2.soundcloud.com/search/tracks')
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

async function resolveScStreamUrl(item) {
  const transcodings = (item?.media?.transcodings || []).filter(
    t => t && t.url && !t.url.includes('preview') && !t.snipped
  );
  if (transcodings.length === 0) return null;

  // Priority 1: High-Efficiency 160kbps AAC (aac_160k fMP4 studio quality)
  // Priority 2: Progressive HTTP MP3 (128kbps MP3)
  // Priority 3: Other HLS streams (excluding multi-bitrate mpegurl master manifests)
  const ordered = [
    ...transcodings.filter(t => t.preset === 'aac_160k' || String(t.preset || '').includes('160k')),
    ...transcodings.filter(t => t.format?.protocol === 'progressive'),
    ...transcodings.filter(
      t =>
        t.format?.protocol === 'hls' &&
        t.preset !== 'aac_160k' &&
        !String(t.format?.mime_type || '').includes('mpegurl')
    ),
    ...transcodings.filter(t => t.format?.protocol === 'hls')
  ];

  for (const trans of ordered) {
    try {
      const res = await axios.get(trans.url, {
        params: {
          client_id: scClientId,
          ...(item.track_authorization ? { track_authorization: item.track_authorization } : {})
        },
        timeout: 3500,
        httpsAgent,
        maxRedirects: 5,
        headers: buildUpstreamHeaders(trans.url)
      });
      if (res.data?.url && !res.data.url.includes('/preview/') && !res.data.url.includes('_preview')) {
        return res.data.url;
      }
    } catch (e) {}
  }
  return null;
}

async function fetchYoutubeOembed(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await axios.get(oembedUrl, {
      timeout: 2200,
      httpsAgent,
      maxRedirects: 5,
      headers: buildUpstreamHeaders(oembedUrl)
    });
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
  ['רביד פלוטניק', 'נצ\'י נצ\'', 'נצ׳י נצ׳', 'נצי נצ', 'ravid plotnik', 'nechi nech'],
  ['טונה', 'tuna', 'tuna official'],
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
  ['נומי', 'numi'],
  ['עקיבא', 'akiva'],
  ['ששון איפרם שאולוב', 'ששון שאולוב', 'sasson efram shaulov', 'sasson shaulov'],
  ['סאבלימינל', 'subliminal'],
  ['נס וסטילה', 'סטילה', 'stilla', 'ness ve stilla'],
  ['שחר סאול', 'shahar saul'],
  ['פול טראנק', 'full trunk'],
  ['בניה ברבי', 'benaia barabi'],
  ['אמיר דדון', 'amir dadon']
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
      if (group.some(g => low === g || low.includes(g) || g.includes(low))) {
        group.forEach(g => expanded.add(g));
      }
    }
  }
  return [...expanded];
}

const HEB_PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'וה', 'וב', 'ול', 'שה', 'מה', 'וש'];
const FILLER_WORDS = new Set([
  'official', 'audio', 'video', 'music', 'lyrics', 'lyric', 'hd', 'hq', '4k', 'prod', 'by', 'feat', 'ft', 'featuring',
  'with', 'and', 'x', 'the', 'mp3', 'wav', 'm4a', 'kbps', '320k', '320', 'topic', 'new', 'single', 'version', 'original', 'mix', 'clip', 'visualizer', 'remaster', 'remastered', 'clean', 'edit',
  'אודיו', 'רשמי', 'רשמית', 'קליפ', 'מילים', 'עם', 'בהשתתפות', 'מארח', 'מארחת', 'את', 'של', 'הפקה', 'סינגל', 'חדש', 'השיר', 'שיר', 'גרסה', 'מקורית', 'המקורי', 'מתוך', 'אלבום'
]);

const HARD_REJECT_WORDS = [
  'karaoke', 'instrumental', 'reaction', 'reacts', 'parody', 'podcast', 'jingle', 'promo', 'teaser', 'trailer',
  'remix', 'rmx', 'rework', 'bootleg', 'cover', 'slowed', 'reverb', 'sped up', 'speed up', 'spedup', 'nightcore', 'mashup', 'mash up', 'acapella',
  'קריוקי', 'מגיב', 'מגיבה', 'תגובה', 'פרודיה', 'אינסטרומנטלי', 'פודקאסט', 'פרסומת', 'פרומו', 'טיזר', 'טריילר',
  'רמיקס', 'רימיקס', 'קאבר', 'מאשאפ', 'משאפ', 'מואץ', 'ווקאלי', 'אקפלה'
];

const SOFT_LIVE_WORDS = [
  'live', 'בהופעה', 'הופעה', 'מהבמה', 'לייב', 'מחרוזת', 'בביצוע'
];

const VERSION_SUFFIX_RE = /^(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|radio\s+edit|clean\s+edit|club\s+edit|edit|original\s+mix|extended(?:\s+mix)?|live(?:\s+.*)?|acoustic(?:\s+version)?|instrumental|version|mono|stereo|deluxe|bonus\s+track|אקוסטי|לייב|בהופעה.*|מתוך.*|רמיקס|רימיקס|גרסת\s+.*|גרסה\s+.*|שיר\s+הנושא.*)$/i;

function separateHebrewAndLatin(str) {
  return String(str || '')
    .replace(/([\u0590-\u05FF])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u0590-\u05FF])/g, '$1 $2');
}

function tokenize(str) {
  return separateHebrewAndLatin(str)
    .toLowerCase()
    .replace(/['׳’`]/g, '')
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

  const baseArtistsExpanded = expandArtistAliases(artistCandidates);
  const baseArtistTokens = new Set(baseArtistsExpanded.flatMap(a => tokenize(a)));

  let workingTitle = rawTitle;

  // Handle pipe '|' cases
  if (workingTitle.includes('|')) {
    const pipeParts = workingTitle.split('|').map(s => s.trim()).filter(Boolean);
    if (pipeParts[0] && /\s*-\s*/.test(pipeParts[0])) {
      workingTitle = pipeParts[0];
    } else if (pipeParts.length >= 2 && /\s*-\s*/.test(pipeParts[1])) {
      artistCandidates.push(pipeParts[0]);
      workingTitle = pipeParts.slice(1).join(' ');
    } else if (pipeParts.length === 2) {
      titleCandidates.push(pipeParts[0]);
      artistCandidates.push(pipeParts[1]);
      workingTitle = pipeParts[0];
    }
  }

  const isCatalogSource = ['spotify', 'deezer', 'itunes'].includes(String(meta?.source || '').toLowerCase());

  // Handle hyphen '-' cases ("Artist - Song", "Song - Remastered", or "Song - Artist")
  if (/\s+-\s+|\s*-\s+/.test(workingTitle)) {
    const dashParts = workingTitle.split(/\s+-\s+|\s*-\s+/).map(s => s.trim()).filter(Boolean);
    if (dashParts.length >= 2) {
      const left = dashParts[0];
      const right = dashParts.slice(1).join(' - ').trim();

      if (VERSION_SUFFIX_RE.test(right) || isCatalogSource) {
        // E.g. "Should I Stay or Should I Go - Remastered" or Spotify track with hyphen
        titleCandidates.push(left);
      } else {
        const leftTokens = tokenize(left);
        const rightTokens = tokenize(right);
        const leftMatchesArtist = leftTokens.some(t => baseArtistTokens.has(t));
        const rightMatchesArtist = rightTokens.some(t => baseArtistTokens.has(t));

        if (rightMatchesArtist && !leftMatchesArtist) {
          // Reversed "Song - Artist"
          titleCandidates.push(left);
        } else {
          // Standard "Artist - Song" (e.g. "עומר אדם - כשאת הולכת")
          titleCandidates.push(right);
          left.split(/[,&•/|]+|\s+ו(?=[א-ת])|\s+עם\s+|\s+מארח(?:ת)?(?:\s+את)?\s+/i)
            .map(s => s.trim())
            .filter(Boolean)
            .forEach(a => artistCandidates.push(a));
          if (!leftMatchesArtist) {
            titleCandidates.push(left);
          }
        }
      }
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

  // Add known bilingual title translations
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

function scoreOfflineCandidate(item, meta = {}, parsedMeta = null, allowLiveOrRemix = false) {
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

  // 1. Hard reject remixes, covers, karaoke, reactions, podcasts, sped-up/slowed (unless explicitly requested or fallback tier)
  for (const hw of HARD_REJECT_WORDS) {
    const inCand = hw.includes(' ') ? rawCandTitle.includes(hw) : hasWord(candFullTokens, hw);
    if (inCand && !rawTargetTitle.includes(hw)) {
      if (!allowLiveOrRemix || ['karaoke', 'podcast', 'reaction', 'parody', 'jingle', 'קריוקי', 'פודקאסט', 'תגובה', 'פרודיה'].includes(hw)) {
        return -999;
      }
    }
  }

  const { titles, artists } = parsedMeta || parseTrackMeta(meta);
  const candClean = rawCandTitle.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ');
  const candTokens = tokenize(candClean);
  const userTokens = tokenize(username);

  const candDashParts = candClean.split(/\s+-\s+|\s*-\s+/).map(s => tokenize(s)).filter(arr => arr.length > 0);
  const artistGroups = getArtistTokenGroups(artists);
  const artistWordSet = new Set(artistGroups.flat());

  let bestTitleMatchScore = -999;
  let matchedTitleTokens = [];

  for (const candTargetTitle of titles) {
    const rawWords = tokenize(candTargetTitle).filter(w => (w.length > 1 || /\p{N}/u.test(w)) && !FILLER_WORDS.has(w));
    const nonArtistWords = rawWords.filter(w => ![...artistWordSet].some(aw => wordMatches(w, aw)));
    const tWords = nonArtistWords.length > 0 ? nonArtistWords : rawWords;
    if (tWords.length === 0) continue;

    // Never allow a title candidate that consists solely of artist words to match!
    if (nonArtistWords.length === 0 && titles.length > 1) continue;

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

  // 3. Penalize Live / Stage versions so studio versions always win when available
  for (const sw of SOFT_LIVE_WORDS) {
    const inCand = sw.includes(' ') ? rawCandTitle.includes(sw) : hasWord(candFullTokens, sw);
    if (inCand && !rawTargetTitle.includes(sw)) {
      score -= 155;
    }
  }

  if (allowLiveOrRemix) {
    for (const hw of HARD_REJECT_WORDS) {
      const inCand = hw.includes(' ') ? rawCandTitle.includes(hw) : hasWord(candFullTokens, hw);
      if (inCand && !rawTargetTitle.includes(hw)) {
        score -= 180;
      }
    }
  }

  if (item.user?.verified) score += 40;
  const followers = Number(item.user?.followers_count) || 0;
  if (followers >= 10000) score += 25;
  else if (followers >= 1000) score += 10;

  // 4. Duration proximity bonus
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
      timeout: 2200,
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

function buildSearchQueriesFromParsed(parsed) {
  const queryList = [];
  for (const t of parsed.titles.slice(0, 3)) {
    for (const a of parsed.artists.slice(0, 3)) {
      if (!t.toLowerCase().includes(a.toLowerCase())) {
        queryList.push(`${a} ${t}`);
      }
    }
    queryList.push(t);
  }
  return [...new Set(
    queryList
      .map(q => q.replace(/[^\p{L}\p{N}\s\-']/gu, ' ').replace(/\s+/g, ' ').trim())
      .filter(q => q.length >= 2)
  )];
}

/**
 * Fast, high-accuracy Offline Stream Finder (~350-600ms, 0 child processes)
 */
async function findOfflineStreamUrl(videoId, fallbackQuery, meta = {}, forceFresh = false) {
  // 1. Primary fast stream engine (unless forceFresh retry after 403)
  if (!forceFresh) {
    try {
      const primaryUrl = await getAudioStreamUrl(videoId, fallbackQuery, true, meta);
      if (primaryUrl) return primaryUrl;
    } catch (e) {}
  }

  // 2. Immediate bilingual SoundCloud studio search (no slow YouTube/Deezer scraping before checking SoundCloud!)
  const parsed = parseTrackMeta(meta, fallbackQuery);
  const initialQueries = buildSearchQueriesFromParsed(parsed);
  const rawPool = new Map();

  // Run top 2 queries in parallel for ~350ms resolution
  const firstBatch = initialQueries.slice(0, 2);
  if (firstBatch.length > 0) {
    const lists = await Promise.all(firstBatch.map(q => searchScTracks(q, 20)));
    for (const items of lists) {
      for (const it of items) {
        if (it && it.id && !rawPool.has(it.id)) rawPool.set(it.id, it);
      }
    }
  }

  const scorePool = (allowFallback) => {
    const scored = [];
    for (const it of rawPool.values()) {
      const s = scoreOfflineCandidate(it, meta, parsed, allowFallback);
      if (s > 0) scored.push({ item: it, score: s });
    }
    return scored.sort((a, b) => b.score - a.score);
  };

  let bestCandidates = scorePool(false);

  // If top 2 queries didn't find a strong studio match, run remaining queries + oEmbed/Deezer enrichment
  if (!bestCandidates.length || bestCandidates[0].score < 240) {
    for (const q of initialQueries.slice(2, 5)) {
      const items = await searchScTracks(q, 20);
      for (const it of items) {
        if (it && it.id && !rawPool.has(it.id)) rawPool.set(it.id, it);
      }
      bestCandidates = scorePool(false);
      if (bestCandidates.length > 0 && bestCandidates[0].score >= 280) break;
    }
  }

  // 3. If still no studio match, enrich metadata with YouTube oEmbed & Deezer aliases
  if (!bestCandidates.length) {
    let effectiveVideoId = videoId;
    if (effectiveVideoId && /^[a-zA-Z0-9_-]{11}$/.test(effectiveVideoId)) {
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
    }

    const catAliases = await fetchCatalogMetadataAliases(meta);
    parsed.artists = expandArtistAliases([...parsed.artists, ...catAliases.artists]);

    const enrichedQueries = buildSearchQueriesFromParsed(parsed).filter(q => !initialQueries.includes(q));
    for (const q of enrichedQueries.slice(0, 3)) {
      const items = await searchScTracks(q, 20);
      for (const it of items) {
        if (it && it.id && !rawPool.has(it.id)) rawPool.set(it.id, it);
      }
    }

    bestCandidates = scorePool(false);
  }

  // 4. Last-resort fallback: allow live / edit versions from the pool if no studio version exists on SoundCloud
  if (!bestCandidates.length) {
    bestCandidates = scorePool(true);
  }

  for (const cand of bestCandidates.slice(0, 5)) {
    const streamUrl = await resolveScStreamUrl(cand.item);
    if (streamUrl) {
      return streamUrl;
    }
  }

  // 5. Fallback for YouTube videoIds if SoundCloud has no match: direct Invidious / googlevideo stream
  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId) && typeof fetchFromInvidious === 'function') {
    const invUrl = await fetchFromInvidious(videoId);
    if (invUrl) return invUrl;
  }

  throw new Error('לא נמצאה גרסה מקורית מלאה של השיר להורדה');
}

async function fetchSegmentWithRetry(segUrl) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const segRes = await axios.get(segUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        httpsAgent,
        maxRedirects: 5,
        headers: buildUpstreamHeaders(segUrl)
      });
      return Buffer.from(segRes.data);
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 300));
    }
  }
}

function detectAudioMime(buf) {
  if (!buf || buf.length < 4) return null;
  // MP4 / M4A: bytes 4..7 are 'ftyp'
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return 'audio/mp4';
  }
  // MP3 ID3 header: 'ID3' (0x49, 0x44, 0x33)
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return 'audio/mpeg';
  }
  // MP3 raw frame sync: 0xFF followed by bits 111 (0xE0)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) {
    return 'audio/mpeg';
  }
  // OGG: 'OggS'
  if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return 'audio/ogg';
  }
  return null;
}

async function pipeHlsDownload(m3u8Url, req, res) {
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  const m3u8Res = await axios.get(m3u8Url, {
    timeout: 6000,
    httpsAgent,
    maxRedirects: 5,
    headers: buildUpstreamHeaders(m3u8Url)
  });
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

  let firstBuf = null;
  let detectedType = null;

  if (mapUrl && !aborted && !res.writableEnded) {
    const initBuf = await fetchSegmentWithRetry(mapUrl);
    detectedType = detectAudioMime(initBuf) || 'audio/mp4';
    const isMp3 = detectedType === 'audio/mpeg';
    res.statusCode = 200;
    res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const patchedInit = isMp3 ? initBuf : patchInitMp4Duration(initBuf, totalDurationSec);
    if (!aborted && !res.writableEnded) {
      res.write(patchedInit);
    }
  } else if (mediaUrls.length > 0 && !aborted && !res.writableEnded) {
    // If no init map, fetch first media segment to sniff true magic bytes
    firstBuf = await fetchSegmentWithRetry(mediaUrls[0]);
    detectedType = detectAudioMime(firstBuf);
    const isMp3 = detectedType === 'audio/mpeg' || mediaUrls[0].includes('.mp3') || m3u8Url.includes('mp3');
    res.statusCode = 200;
    res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    if (firstBuf && !aborted && !res.writableEnded) {
      const cleanFirst = isMp3 ? firstBuf : stripStypSidx(firstBuf);
      res.write(cleanFirst);
    }
  }

  const isMp3Stream = (res.getHeader('Content-Type') || '').includes('mpeg');

  // Fetch remaining segments in parallel batches of 4 while writing in strict sequential order
  const BATCH_SIZE = 4;
  const startIndex = firstBuf ? 1 : 0;
  for (let i = startIndex; i < mediaUrls.length; i += BATCH_SIZE) {
    if (aborted || res.writableEnded) break;
    const batchUrls = mediaUrls.slice(i, i + BATCH_SIZE);
    const buffers = await Promise.all(batchUrls.map(u => fetchSegmentWithRetry(u)));

    for (const rawBuf of buffers) {
      if (aborted || res.writableEnded || !rawBuf) break;
      const cleanBuf = isMp3Stream ? rawBuf : stripStypSidx(rawBuf);
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
 * Uses the unified upstream browser headers, Range handling, and HLS fMP4/MP3 segment unpacking from stream.js,
 * and automatically evicts expired URLs & retries fresh on 403/404/500.
 */
async function pipeOfflineDownload(videoId, req, res, fallbackQuery = null, meta = null) {
  let upstreamStream = null;
  req.on('close', () => {
    if (upstreamStream && typeof upstreamStream.destroy === 'function') {
      upstreamStream.destroy();
    }
  });

  const tryStreamUrl = async (streamUrl) => {
    if (streamUrl.includes('.m3u8')) {
      await pipeHlsDownload(streamUrl, req, res);
      return true;
    }

    const range = req.headers?.range || null;
    const headers = buildUpstreamHeaders(streamUrl, range);

    const response = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'stream',
      timeout: 18000,
      httpsAgent,
      decompress: false,
      maxRedirects: 5,
      headers,
      validateStatus: () => true
    });

    if (response.status >= 200 && response.status < 400) {
      upstreamStream = response.data;
      res.statusCode = range && response.status === 206 ? 206 : 200;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');

      for (const [key, value] of Object.entries(response.headers)) {
        const lower = key.toLowerCase();
        if (['content-length', 'content-range'].includes(lower)) {
          res.setHeader(lower, value);
        }
      }

      // Sniff first chunk to accurately set Content-Type header based on true magic bytes
      let firstChunkHandled = false;
      const onFirstChunk = (chunk) => {
        if (firstChunkHandled) return;
        firstChunkHandled = true;
        const detected = detectAudioMime(chunk);
        const upstreamCt = String(response.headers['content-type'] || '').toLowerCase();
        let finalCt = detected;
        if (!finalCt) {
          if (upstreamCt.includes('mpeg') || upstreamCt.includes('mp3')) {
            finalCt = 'audio/mpeg';
          } else {
            finalCt = 'audio/mp4';
          }
        }
        res.setHeader('Content-Type', finalCt);
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        res.write(chunk);
        response.data.pipe(res);
      };

      response.data.once('data', onFirstChunk);
      response.data.once('error', () => {
        if (!res.headersSent) res.statusCode = 502;
        res.end();
      });
      return true;
    }

    if (response.data && typeof response.data.destroy === 'function') {
      response.data.destroy();
    }
    throw new Error(`Upstream status ${response.status}`);
  };

  try {
    let streamUrl = await findOfflineStreamUrl(videoId, fallbackQuery, meta || {}, false);
    if (!streamUrl) {
      throw new Error('No offline stream URL resolved');
    }

    try {
      await tryStreamUrl(streamUrl);
      return;
    } catch (firstErr) {
      if (res.headersSent) throw firstErr;
      // Evict stale cached URL and resolve fresh from SoundCloud
      if (typeof evictStreamCache === 'function') {
        evictStreamCache(videoId, fallbackQuery);
      }
      const freshUrl = await findOfflineStreamUrl(videoId, fallbackQuery, meta || {}, true);
      if (!freshUrl) throw firstErr;
      await tryStreamUrl(freshUrl);
      return;
    }
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
