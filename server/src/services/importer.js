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
    const rawTitle = (t.title || t.name || 'שיר ללא שם').trim();
    const artist = (t.subtitle || (t.artists ? t.artists.map(a => a.name).join(', ') : 'Unknown Artist')).trim();
    const durationMs = t.duration || 0;
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
 * and rejects live stage clips (e.g. Festigal stage performances), medleys, covers, and remixes.
 */
function scoreCandidate(cand, track) {
  let score = 0;
  const candTitle = (cand.originalTitle || cand.title || '').toLowerCase();
  const candCleanTitle = (cand.title || '').toLowerCase();
  const candAuthor = (cand.rawAuthor || cand.artist || cand.author?.name || '').toLowerCase();
  const targetTitle = (track.title || track.originalTitle || '').toLowerCase();
  const targetArtist = (track.artist || '').toLowerCase();
  const targetAlbum = (track.album || '').toLowerCase();
  const candSec = cand.durationSeconds || cand.seconds || 0;
  const targetSec = track.durationSeconds || 0;
  const isTopic = Boolean(cand.isTopic || candAuthor.includes('- topic') || candAuthor.endsWith('topic'));

  // 1. Title word matching (MANDATORY: must actually be the requested song!)
  const titleWords = targetTitle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  let matchedWords = 0;
  for (const w of titleWords) {
    if (candTitle.includes(w) || candCleanTitle.includes(w)) matchedWords++;
  }
  const matchRatio = titleWords.length > 0 ? (matchedWords / titleWords.length) : 1;
  if (matchRatio < 0.5) {
    return -999; // Disqualify wrong songs immediately
  }
  score += Math.round(matchRatio * 55);

  // 2. Duration matching against Spotify studio master (Crucial for studio vs stage/live/extended versions!)
  if (targetSec > 0 && candSec > 0) {
    const diff = Math.abs(candSec - targetSec);
    if (diff <= 2) score += 95;       // Exact Spotify studio master length!
    else if (diff <= 5) score += 75;  // Studio release within 5s
    else if (diff <= 10) score += 45; // Close match
    else if (diff <= 20) score += 15;
    else if (diff <= 35) score -= 45;
    else if (diff <= 55) score -= 110;
    else score -= 220; // >55s difference = stage medley, full show, or short teaser
  }

  // 3. Strictly penalize Live / Stage / Festigal Stage Number / Dance Tutorial / Cover / Remix
  const stageAndLiveWords = [
    'מתוך המופע', 'מהמופע', 'במופע', 'המופע המלא', 'קטע מתוך', 'נאמבר',
    'מהבמה', 'על הבמה', 'במה', 'מהקהל', 'קהל', 'הופעה חיה', 'בהופעה', 'הופעה',
    'לייב', 'live', 'concert', 'חי באולפן', 'באולפן', 'חזרות', 'מאחורי הקלעים', 'ריאקשן', 'reaction',
    'איך לרקוד', 'הדרכת ריקוד', 'כוריאוגרפיה', 'ילדי הפסטיגל', 'אודישן', 'מחרוזת',
    'קאבר', 'cover', 'קריוקי', 'karaoke', 'פרודיה', 'parody',
    'אינסטרומנטלי', 'instrumental', 'ריאיון', 'ראיון',
    'רמיקס', 'רימיקס', 'remix', 'slowed', 'sped up', 'nightcore', '8d'
  ];
  for (const w of stageAndLiveWords) {
    if (candTitle.includes(w) && !targetTitle.includes(w)) {
      score -= 150;
    }
  }

  // 4. YouTube Music "- Topic" channel reward (Exact Spotify distributor studio master)
  if (isTopic) {
    score += 85;
  }

  // 5. Verified / Official Channel & Studio Audio rewards
  if (cand.isVerified) {
    score += 35;
  }
  const officialIndicators = [
    'official audio', 'אודיו רשמי', 'שיר רשמי', 'הערוץ הרשמי',
    'vevo', 'official', 'רשמי', 'אודיו', 'audio'
  ];
  for (const w of officialIndicators) {
    if (candTitle.includes(w) || candAuthor.includes(w)) {
      score += 35;
      break;
    }
  }

  // 6. Artist & Official Page verification (Ensure it comes from the same singer/official page)
  const isFestigalTrack = targetArtist.includes('פסטיגל') || targetAlbum.includes('פסטיגל') || targetTitle.includes('פסטיגל');
  let artistMatched = false;

  if (targetArtist) {
    const artistParts = targetArtist
      .split(/[,&•/]+/)
      .map(a => a.trim().toLowerCase())
      .filter(a => a.length > 1);

    for (const a of artistParts) {
      if (candAuthor.includes(a)) {
        score += 55; // Uploaded by the artist's own channel / Topic page!
        artistMatched = true;
        break;
      } else if (candTitle.includes(a)) {
        score += 30;
        artistMatched = true;
        break;
      }
    }
  }

  if (isFestigalTrack) {
    if (candAuthor.includes('פסטיגל') || candAuthor.includes('festigal')) {
      score += 65; // Official Festigal channel!
      artistMatched = true;
    } else if (candTitle.includes('פסטיגל') || candTitle.includes('festigal')) {
      score += 25;
      artistMatched = true;
    }
  }

  // Penalize uploads from random unrelated channels where neither artist nor Topic nor Festigal matches
  if (!artistMatched && !isTopic) {
    score -= 90;
  }

  return score;
}

const resolveMemCache = new Map();
const MAX_RESOLVE_CACHE = 1000;

/**
 * Resolve a track to a streamable audio ID (matches Spotify track to exact YouTube studio version and artwork)
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

  const cacheKey = `${track.artist || ''}:::${track.title || ''}:::${track.durationSeconds || 0}`.trim().toLowerCase();
  if (resolveMemCache.has(cacheKey)) {
    return resolveMemCache.get(cacheKey);
  }

  const isFestigal = (track.album || '').includes('פסטיגל') && !(track.artist || '').includes('פסטיגל') && !(track.title || '').includes('פסטיגל');
  const baseQuery = isFestigal
    ? `${track.artist} - ${track.title} פסטיגל`.trim()
    : (track.query || `${track.artist} - ${track.title}`.trim());

  const hasHebrew = /[\u0590-\u05FF]/.test(baseQuery);
  const studioQuery = hasHebrew ? `${baseQuery} אודיו` : `${baseQuery} official audio`;

  const needsIndividualCover = !track.hasCustomArtwork || !track.thumbnail || track.thumbnail.includes('default') || track.thumbnail.includes('spotifree');

  // 1. Fetch individual studio cover in parallel from Deezer & iTunes (non-blocking, fast 1400ms timeout)
  const coverPromise = !needsIndividualCover
    ? Promise.resolve(track.thumbnail)
    : Promise.any([
        axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(baseQuery)}`, { timeout: 1400 })
          .then(dRes => {
            const c = dRes.data?.data?.[0]?.album?.cover_big || dRes.data?.data?.[0]?.album?.cover_medium;
            if (c) return c;
            throw new Error('No Deezer cover');
          }),
        axios.get('https://itunes.apple.com/search', {
          params: { term: baseQuery, entity: 'song', limit: 1 },
          timeout: 1400
        }).then(iRes => {
          const art = iRes.data?.results?.[0]?.artworkUrl100;
          if (art) return art.replace('100x100bb', '600x600bb');
          throw new Error('No iTunes cover');
        })
      ]).catch(() => null);

  // 2. High-accuracy parallel search: search both base query AND explicit studio/audio query simultaneously
  const searchPromise = (async () => {
    const [res1, res2] = await Promise.all([
      searchTracks(baseQuery, 12).catch(() => []),
      searchTracks(studioQuery, 8).catch(() => [])
    ]);
    const combined = [...(res2 || []), ...(res1 || [])];
    const seen = new Set();
    const deduped = [];
    for (const item of combined) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        deduped.push(item);
      }
    }
    if (deduped.length === 0) {
      return (await searchTracks(`${track.title} ${track.artist}`.trim(), 10).catch(() => [])) || [];
    }
    return deduped;
  })();

  const [albumCover, allCandidates] = await Promise.all([coverPromise, searchPromise]);

  if (allCandidates.length === 0) {
    throw new Error(`לא נמצא מקור שמע עבור: ${track.title}`);
  }

  // 3. Score candidates and pick highest scoring official studio match
  const scored = allCandidates.map(cand => ({
    cand,
    score: scoreCandidate(cand, track)
  })).sort((a, b) => b.score - a.score);

  const topMatch = scored[0].cand;
  const resolvedId = topMatch.id || topMatch.videoId;
  const ytThumb = topMatch.thumbnail || topMatch.image || (resolvedId ? `https://i.ytimg.com/vi/${resolvedId}/hqdefault.jpg` : '');

  const resolutionResult = {
    streamableId: resolvedId,
    thumbnail: albumCover || ytThumb || track.thumbnail || '',
    hasCustomArtwork: true,
    durationSeconds: track.durationSeconds || topMatch.durationSeconds || 0
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
  resolveTrackToStreamableId
};
