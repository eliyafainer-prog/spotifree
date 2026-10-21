const axios = require('axios');
const { spawn } = require('child_process');
const yts = require('yt-search');
const { cleanTitle, searchTracks } = require('./search');

/**
 * Extract Spotify ID and type from URL (supports intl-xx, queries, and URIs)
 */
function parseSpotifyUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:spotify\.com\/(?:intl-[a-zA-Z-]+\/)?|spotify:)(playlist|album|track)[:/]([a-zA-Z0-9]+)/);
  if (!match) return null;
  return {
    type: match[1],
    id: match[2]
  };
}

/**
 * Extract the highest resolution cover image from Spotify entity
 */
async function extractCoverArt(entity, rawUrl) {
  // 1. Try visualIdentity (new Spotify embed format: 640x640)
  if (entity?.visualIdentity?.image && Array.isArray(entity.visualIdentity.image) && entity.visualIdentity.image.length > 0) {
    const sorted = [...entity.visualIdentity.image].sort((a, b) => (b.maxWidth || 0) - (a.maxWidth || 0));
    if (sorted[0]?.url) return sorted[0].url;
  }

  // 2. Try coverArt.sources
  if (entity?.coverArt?.sources && Array.isArray(entity.coverArt.sources) && entity.coverArt.sources.length > 0) {
    const sorted = [...entity.coverArt.sources].sort((a, b) => (b.width || 0) - (a.width || 0));
    if (sorted[0]?.url) return sorted[0].url;
  }

  // 3. Try entity.images
  if (entity?.images && Array.isArray(entity.images) && entity.images.length > 0) {
    const sorted = [...entity.images].sort((a, b) => (b.width || 0) - (a.width || 0));
    if (sorted[0]?.url) return sorted[0].url;
  }

  // 4. Fallback: Spotify oEmbed API (guaranteed high-quality thumbnail)
  try {
    const oembedRes = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(rawUrl)}`, {
      timeout: 4000
    });
    if (oembedRes.data?.thumbnail_url) {
      return oembedRes.data.thumbnail_url;
    }
  } catch (e) {
    // Ignored
  }

  return '';
}

/**
 * Fetch tracks and artwork from Spotify URL (no API key required)
 */
async function importSpotify(url) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) {
    throw new Error('קישור ספוטיפיי אינו תקין. אנא ודא שהעתקת קישור לפלייליסט, אלבום או שיר.');
  }

  const embedUrl = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}`;
  let response;
  try {
    response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'he,en-US,en;q=0.9'
      },
      timeout: 10000,
      validateStatus: () => true
    });
  } catch (netErr) {
    throw new Error('שגיאת תקשורת מול ספוטיפיי. אנא בדוק את החיבור לרשת.');
  }

  if (response.status === 404) {
    throw new Error('התוכן לא נמצא בספוטיפיי. ייתכן שהקישור שגוי או שהפלייליסט הוגדר כפרטי.');
  }

  const html = response.data || '';
  const match = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);

  if (!match) {
    throw new Error('לא ניתן היה לפענח את תוכן הפלייליסט. נסה קישור אחר.');
  }

  let nextData;
  try {
    nextData = JSON.parse(match[1]);
  } catch (e) {
    throw new Error('שגיאה בקריאת המידע מספוטיפיי.');
  }

  const entity = nextData.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error('האלבום או הפלייליסט לא נמצא בספוטיפיי (בדוק את הקישור שהדבקת).');
  }

  const playlistTitle = entity.name || entity.title || 'אלבום מיובא';
  const playlistCover = await extractCoverArt(entity, url);

  let rawTracks = [];
  if (parsed.type === 'track') {
    rawTracks = [entity];
  } else if (entity.trackList && Array.isArray(entity.trackList)) {
    rawTracks = entity.trackList;
  }

  const tracks = rawTracks.map((t, index) => {
    const rawTitle = (t.title || t.name || 'שיר ללא שם').replace(/\u00a0/g, ' ').trim();
    const artist = (t.subtitle || (t.artists ? t.artists.map(a => a.name).join(', ') : 'Unknown Artist')).replace(/\u00a0/g, ' ').trim();
    const durationMs = t.duration || t.duration_ms || 0;
    const durationSec = Math.round(durationMs / 1000);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const trackSpecificCover = t.coverArt?.sources?.[0]?.url || t.images?.[0]?.url || t.album?.images?.[0]?.url || null;

    return {
      id: `sp_${parsed.id}_${index}`,
      spotifyId: t.id || t.uri?.split(':').pop() || null,
      title: rawTitle,
      originalTitle: rawTitle,
      artist: artist,
      album: playlistTitle,
      thumbnail: trackSpecificCover || playlistCover,
      hasCustomArtwork: Boolean(trackSpecificCover || parsed.type === 'album' || parsed.type === 'track'),
      duration: durationStr,
      durationSeconds: durationSec,
      source: 'spotify',
      query: `${artist} - ${rawTitle}`
    };
  });

  return {
    title: playlistTitle,
    cover: playlistCover,
    type: parsed.type,
    totalTracks: tracks.length,
    tracks: tracks
  };
}

const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

/**
 * Import a YouTube playlist
 */
async function importYouTubePlaylist(url) {
  return new Promise((resolve, reject) => {
    const pyProcess = spawn(PYTHON_BIN, [
      '-m', 'yt_dlp',
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      url
    ]);

    let output = '';
    let errorOutput = '';

    pyProcess.stdout.on('data', d => output += d.toString());
    pyProcess.stderr.on('data', d => errorOutput += d.toString());

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Failed to import YouTube playlist: ${errorOutput}`));
      }

      try {
        const json = JSON.parse(output);
        const playlistTitle = json.title || 'YouTube Playlist';
        const entries = json.entries || [];

        const tracks = entries.map(v => {
          const durSec = v.duration || 0;
          const mins = Math.floor(durSec / 60);
          const secs = Math.round(durSec % 60);
          const durStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

          return {
            id: v.id,
            streamableId: v.id,
            title: cleanTitle(v.title) || v.title,
            originalTitle: v.title,
            artist: v.uploader || v.channel || 'YouTube Artist',
            album: playlistTitle,
            thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: durStr,
            durationSeconds: durSec,
            source: 'youtube',
            url: `https://www.youtube.com/watch?v=${v.id}`
          };
        });

        resolve({
          title: playlistTitle,
          cover: tracks[0]?.thumbnail || '',
          type: 'youtube',
          totalTracks: tracks.length,
          tracks: tracks
        });
      } catch (e) {
        reject(new Error('Failed to parse YouTube playlist output'));
      }
    });
  });
}

/**
 * Universal importer: handles Spotify, YouTube, or direct search queries
 */
async function universalImport(inputUrl) {
  const trimmed = inputUrl.trim();
  if (trimmed.includes('spotify.com') || trimmed.startsWith('spotify:')) {
    return await importSpotify(trimmed);
  } else if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
    return await importYouTubePlaylist(trimmed);
  } else {
    throw new Error('כתובת לא נתמכת. יש להדביק קישור תקין מ-Spotify או מ-YouTube.');
  }
}

/**
 * Score how well a YouTube candidate matches the original Spotify track.
 * Enforces strict Spotify studio duration, official - Topic / verified artist channels,
 * and rejects live stage clips (e.g. Festigal stage performances/remakes), medleys, covers, and remixes.
 */
function scoreCandidate(cand, track, extraArtistAliases = []) {
  let score = 0;
  const candTitle = String(cand.originalTitle || cand.title || '').replace(/\u00a0/g, ' ').toLowerCase();
  const candCleanTitle = String(cand.title || '').replace(/\u00a0/g, ' ').toLowerCase();
  const candAuthor = String(cand.rawAuthor || cand.artist || cand.author?.name || '').replace(/\u00a0/g, ' ').toLowerCase();
  const rawTargetTitle = String(track.title || track.originalTitle || '').replace(/\u00a0/g, ' ').toLowerCase();
  const coreTargetTitle = rawTargetTitle.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').split(' - ')[0].trim() || rawTargetTitle;
  const targetArtist = String(track.artist || '').replace(/\u00a0/g, ' ').toLowerCase();
  const targetAlbum = String(track.album || '').replace(/\u00a0/g, ' ').toLowerCase();
  const candSec = Number(cand.durationSeconds || cand.seconds) || 0;
  const targetSec = Number(track.durationSeconds) || 0;
  const isTopic = Boolean(cand.isTopic || candAuthor.includes('- topic') || candAuthor.endsWith('topic'));

  // Reject very short teasers/clips (< 45s) unless the Spotify track itself is short
  if (candSec > 0 && candSec < 45 && (targetSec === 0 || targetSec >= 45)) {
    return -999;
  }

  // 1. Core Title word matching (MANDATORY: must actually be the requested song!)
  const titleWords = coreTargetTitle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  let matchedWords = 0;
  for (const w of titleWords) {
    if (candTitle.includes(w) || candCleanTitle.includes(w)) matchedWords++;
  }
  const matchRatio = titleWords.length > 0 ? (matchedWords / titleWords.length) : 1;
  if (matchRatio < 0.6) {
    return -999; // Disqualify wrong songs immediately
  }
  score += Math.round(matchRatio * 60);

  // 2. Duration matching against Spotify studio master (Crucial for studio vs stage/live/extended versions!)
  if (targetSec > 0 && candSec > 0) {
    const diff = Math.abs(candSec - targetSec);
    if (diff <= 2) score += 140;       // Exact Spotify studio master length!
    else if (diff <= 5) score += 105;  // Studio release within 5s
    else if (diff <= 9) score += 55;   // Close match
    else if (diff <= 15) score += 10;
    else if (diff <= 25) score -= 65;
    else if (diff <= 40) score -= 145;
    else score -= 280; // >40s difference = stage medley, live speech, or wrong version
  }

  // 3. Strictly penalize Live / Stage / Festigal Remake / Dance Tutorial / Cover / Remix / Mashup
  const stageAndLiveWords = [
    'מתוך המופע', 'מהמופע', 'במופע', 'המופע המלא', 'קטע מתוך', 'נאמבר',
    'מהבמה', 'על הבמה', 'במה', 'מהקהל', 'קהל', 'הופעה חיה', 'בהופעה', 'הופעה',
    'לייב', 'live', 'concert', 'חי באולפן', 'באולפן', 'גלגלצ', 'חזרות', 'מאחורי הקלעים', 'ריאקשן', 'reaction',
    'איך לרקוד', 'הדרכת ריקוד', 'כוריאוגרפיה', 'ילדי הפסטיגל', 'אודישן', 'מחרוזת',
    'קאבר', 'cover', 'קריוקי', 'karaoke', 'פרודיה', 'parody', 'משאפ', 'מאשאפ', 'mashup', 'mash up',
    'אינסטרומנטלי', 'instrumental', 'ריאיון', 'ראיון', 'הצצה ל', 'מתוך פרק', 'בטקס ',
    'רמיקס', 'רימיקס', 'remix', 'slowed', 'sped up', 'nightcore', '8d',
    '#myפסטיגל', 'my פסטיגל', 'my festigal', 'חידוש', 'מחווה', 'גיבוי', 'תרגום',
    'מגיב', 'מגיבה', 'תגובה', 'reacts', 'edits', 'אדיט', 'speed up', 'spedup', 'מואץ', 'גרסה מהירה', 'bass boost', 'tiktok', 'טיקטוק'
  ];
  for (const w of stageAndLiveWords) {
    if (candTitle.includes(w) && !rawTargetTitle.includes(w) && !targetAlbum.includes(w)) {
      score -= 180;
    }
  }

  // 4. Penalize unrequested remakes/duets ("בביצוע ...", "X ...") where another singer performs the song
  if ((candTitle.includes('בביצוע') || candTitle.includes(' x ')) && !rawTargetTitle.includes('בביצוע') && !rawTargetTitle.includes(' x ')) {
    score -= 160;
  }

  // 5. Artist & Official Page verification (Ensure it comes from the same singer/official page)
  const isFestigalTrack = targetArtist.includes('פסטיגל') || targetAlbum.includes('פסטיגל') || rawTargetTitle.includes('פסטיגל');
  let artistMatched = false;
  let primarySingerMatched = false;

  const genericFestigalWords = new Set(['פסטיגל', 'משתתפי', 'הפסטיגל', 'כוכבי', 'ילדי', 'various', 'artists']);
  const artistParts = [
    ...targetArtist
      .split(/[,&•/]+/)
      .map(a => a.trim().toLowerCase())
      .filter(a => a.length > 1),
    ...extraArtistAliases.map(a => String(a || '').trim().toLowerCase()).filter(a => a.length > 1)
  ];

  const specificSigners = artistParts.filter(a => {
    const words = a.split(/\s+/);
    return !words.every(w => genericFestigalWords.has(w));
  });

  for (const a of specificSigners) {
    if (candAuthor.includes(a)) {
      score += 75; // Uploaded directly by the singer's own official channel / Topic page!
      artistMatched = true;
      primarySingerMatched = true;
      break;
    } else if (candTitle.includes(a)) {
      score += 45;
      artistMatched = true;
      primarySingerMatched = true;
      break;
    }
  }

  if (isFestigalTrack || candTitle.includes('פסטיגל') || candAuthor.includes('פסטיגל')) {
    if (candAuthor.includes('מוזיקה ישראלית ו-פסטיגל') || candAuthor.includes('פסטיגל - הערוץ הרשמי') || candAuthor.includes('festigal')) {
      score += 60; // Official Festigal / Israeli Music channel
      artistMatched = true;
    } else if (candTitle.includes('פסטיגל') || candTitle.includes('festigal')) {
      score += 20;
      if (specificSigners.length === 0) artistMatched = true;
    }
  }

  // 6. YouTube Music "- Topic" channel reward ONLY if artist matches (or official Release/Various Artists Topic with matching duration!)
  if (isTopic) {
    const isGenericTopic = candAuthor.startsWith('release - topic') || candAuthor.startsWith('various artists - topic');
    if (primarySingerMatched || (isGenericTopic && (targetSec === 0 || Math.abs(candSec - targetSec) <= 15))) {
      score += 95;
      artistMatched = true;
    } else if (!isGenericTopic && specificSigners.length > 0 && !primarySingerMatched) {
      // A "- Topic" channel belonging to a DIFFERENT artist (e.g., cover/lullaby/tribute artist)!
      score -= 180;
    } else {
      score += 40;
    }
  }

  // 7. Verified / Official Channel & Studio Audio rewards
  if (cand.isVerified && artistMatched) {
    score += 35;
  }
  const officialStudioWords = [
    'official audio', 'אודיו רשמי', 'שיר רשמי', 'אודיו', 'audio', 'הערוץ הרשמי', 'vevo', 'official'
  ];
  for (const w of officialStudioWords) {
    if (candTitle.includes(w) || candAuthor.includes(w)) {
      score += 30;
      break;
    }
  }

  // Strongly penalize uploads from unrelated channels where the requested singer does not match
  if (specificSigners.length > 0 && !primarySingerMatched && !artistMatched) {
    score -= 160;
  } else if (!artistMatched) {
    score -= 110;
  }

  return score;
}

const resolveMemCache = new Map();
const MAX_RESOLVE_CACHE = 1000;

/**
 * Resolve a track to a streamable audio ID (matches Spotify track to exact studio version, duration, and artwork)
 */
async function resolveTrackToStreamableId(track) {
  if (track.source === 'youtube' && track.id && !track.id.startsWith('sp_') && track.hasCustomArtwork !== false) {
    return {
      streamableId: track.id,
      thumbnail: track.thumbnail,
      hasCustomArtwork: true,
      durationSeconds: track.durationSeconds
    };
  }

  const cleanArtist = String(track.artist || '').replace(/\u00a0/g, ' ').trim();
  const cleanTrackTitle = String(track.title || '').replace(/\u00a0/g, ' ').trim();
  const cacheKey = `v4:::${cleanArtist}:::${cleanTrackTitle}:::${track.durationSeconds || 0}`.toLowerCase();
  if (resolveMemCache.has(cacheKey)) {
    return resolveMemCache.get(cacheKey);
  }

  const primaryArtist = cleanArtist.split(',')[0].trim();
  const isFestigal = (track.album || '').includes('פסטיגל') || cleanArtist.includes('פסטיגל') || cleanTrackTitle.includes('פסטיגל');
  const baseQuery = isFestigal && !cleanTrackTitle.includes('פסטיגל') && !primaryArtist.includes('פסטיגל')
    ? `${primaryArtist} - ${cleanTrackTitle} פסטיגל`.trim()
    : `${primaryArtist || cleanArtist} - ${cleanTrackTitle}`.trim();

  const hasHebrew = /[\u0590-\u05FF]/.test(baseQuery);
  const studioQuery = hasHebrew ? `${primaryArtist || cleanArtist} ${cleanTrackTitle} אודיו` : `${baseQuery} official audio`;

  const needsIndividualCover = !track.hasCustomArtwork || !track.thumbnail || track.thumbnail.includes('default') || track.thumbnail.includes('spotifree');

  // 1. Fetch official studio catalog metadata (cover, exact studio duration, English artist alias) from Deezer & iTunes in parallel
  const catalogQuery = `${primaryArtist || cleanArtist} ${cleanTrackTitle}`.trim();
  const catalogPromise = (async () => {
    const [deezerItems, itunesItems] = await Promise.all([
      axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(catalogQuery)}`, { timeout: 1500 })
        .then(r => r.data?.data || [])
        .catch(() => []),
      axios.get('https://itunes.apple.com/search', {
        params: { term: catalogQuery, entity: 'song', limit: 5 },
        timeout: 1500
      }).then(r => r.data?.results || [])
        .catch(() => [])
    ]);

    let bestCover = !needsIndividualCover ? track.thumbnail : null;
    let catalogDuration = Number(track.durationSeconds) || 0;
    const artistAliases = [];

    const coreLower = cleanTrackTitle.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').toLowerCase().trim();

    for (const d of deezerItems) {
      const dTitle = String(d.title || '').toLowerCase();
      if (coreLower && (dTitle.includes(coreLower) || coreLower.includes(dTitle))) {
        if (d.artist?.name) artistAliases.push(d.artist.name);
        if (!bestCover) {
          bestCover = d.album?.cover_big || d.album?.cover_medium || null;
        }
        if (!catalogDuration && d.duration >= 45 && d.duration <= 500) {
          catalogDuration = d.duration;
        }
        if (track.durationSeconds && Math.abs((d.duration || 0) - track.durationSeconds) <= 5) {
          if (needsIndividualCover && (d.album?.cover_big || d.album?.cover_medium)) {
            bestCover = d.album?.cover_big || d.album?.cover_medium;
          }
          break;
        }
      }
    }

    for (const it of itunesItems) {
      const itTitle = String(it.trackName || '').toLowerCase();
      const itDur = Math.round((it.trackTimeMillis || 0) / 1000);
      if (coreLower && (itTitle.includes(coreLower) || coreLower.includes(itTitle))) {
        if (it.artistName) artistAliases.push(it.artistName);
        const art = it.artworkUrl100 ? it.artworkUrl100.replace('100x100bb', '600x600bb') : null;
        if (!bestCover && art) bestCover = art;
        if (!catalogDuration && itDur >= 45 && itDur <= 500) {
          catalogDuration = itDur;
        }
      }
    }

    return { bestCover, catalogDuration, artistAliases };
  })();

  // 2. Search YouTube candidates (run baseQuery and studioQuery in parallel when needed for maximum studio accuracy)
  const searchPromise = (async () => {
    const res1 = await searchTracks(baseQuery, 12).catch(() => []);
    if (res1 && res1.length > 0) {
      const bestBaseScore = Math.max(...res1.map(c => scoreCandidate(c, track)));
      if (bestBaseScore >= 185) {
        return res1;
      }
    }
    const res2 = await searchTracks(studioQuery, 10).catch(() => []);
    const combined = [...(res1 || []), ...(res2 || [])];
    const seen = new Set();
    const deduped = [];
    for (const item of combined) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        deduped.push(item);
      }
    }
    return deduped;
  })();

  const [{ bestCover, catalogDuration, artistAliases }, allCandidates] = await Promise.all([catalogPromise, searchPromise]);

  if (allCandidates.length === 0) {
    throw new Error(`לא נמצא מקור שמע עבור: ${track.title}`);
  }

  const effectiveTrack = {
    ...track,
    title: cleanTrackTitle,
    artist: cleanArtist,
    durationSeconds: Number(track.durationSeconds) || catalogDuration || 0
  };

  // 3. Score candidates with full catalog duration + English/Hebrew artist aliases and pick highest scoring official studio match
  const scored = allCandidates.map(cand => ({
    cand,
    score: scoreCandidate(cand, effectiveTrack, artistAliases)
  })).sort((a, b) => b.score - a.score);

  const topMatch = scored[0].cand;
  const resolvedId = topMatch.id || topMatch.videoId;
  const ytThumb = topMatch.thumbnail || topMatch.image || (resolvedId ? `https://i.ytimg.com/vi/${resolvedId}/hqdefault.jpg` : '');
  const finalDurationSec = effectiveTrack.durationSeconds || topMatch.durationSeconds || 0;

  const resolutionResult = {
    streamableId: resolvedId,
    thumbnail: bestCover || track.thumbnail || ytThumb || '',
    hasCustomArtwork: true,
    studioResolvedV3: true,
    studioResolvedV4: true,
    durationSeconds: finalDurationSec
  };

  if (resolveMemCache.size >= MAX_RESOLVE_CACHE) {
    const oldestKey = resolveMemCache.keys().next().value;
    resolveMemCache.delete(oldestKey);
  }
  resolveMemCache.set(cacheKey, resolutionResult);

  return resolutionResult;
}

module.exports = {
  parseSpotifyUrl,
  importSpotify,
  importYouTubePlaylist,
  universalImport,
  resolveTrackToStreamableId,
  scoreCandidate
};
