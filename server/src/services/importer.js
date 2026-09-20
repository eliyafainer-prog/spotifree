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
    const title = t.title || t.name || 'שיר ללא שם';
    const artist = t.subtitle || (t.artists ? t.artists.map(a => a.name).join(', ') : 'Unknown Artist');
    const durationMs = t.duration || 0;
    const durationSec = Math.round(durationMs / 1000);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    return {
      id: `sp_${parsed.id}_${index}`,
      spotifyId: t.id || null,
      title: cleanTitle(title),
      originalTitle: title,
      artist: artist,
      album: playlistTitle,
      thumbnail: playlistCover,
      duration: durationStr,
      durationSeconds: durationSec,
      source: 'spotify',
      query: `${artist} - ${title}`
    };
  });

  // Parallel batch enrich album covers from Deezer (batches of 10 for blazing fast import)
  const chunkSize = 10;
  for (let i = 0; i < tracks.length; i += chunkSize) {
    const chunk = tracks.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (t) => {
        try {
          const q = `${t.artist} ${t.title}`.trim();
          const dRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(q)}`, { timeout: 2500 });
          const cover = dRes.data?.data?.[0]?.album?.cover_medium;
          if (cover) {
            t.thumbnail = cover;
          }
        } catch (e) {}
      })
    );
  }

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
 * Score how well a YouTube candidate matches the original Spotify track
 * Rewards: matching duration, official channel / topic, official audio, artist match.
 * Penalizes: live stage recordings, audience videos, fan covers, parodies, extended bootlegs.
 */
function scoreCandidate(cand, track) {
  let score = 0;
  const candTitle = (cand.title || cand.originalTitle || '').toLowerCase();
  const candAuthor = (cand.artist || cand.author?.name || '').toLowerCase();
  const targetTitle = (track.title || track.originalTitle || '').toLowerCase();
  const targetArtist = (track.artist || '').toLowerCase();
  const targetAlbum = (track.album || '').toLowerCase();
  const candSec = cand.durationSeconds || cand.seconds || 0;
  const targetSec = track.durationSeconds || 0;

  // 1. Duration matching (Extremely important for studio vs live/stage versions)
  if (targetSec > 0 && candSec > 0) {
    const diff = Math.abs(candSec - targetSec);
    if (diff <= 3) score += 50;
    else if (diff <= 7) score += 35;
    else if (diff <= 15) score += 20;
    else if (diff <= 30) score += 5;
    else if (diff <= 60) score -= 30;
    else if (diff <= 120) score -= 60;
    else score -= 90; // Over 2 minutes difference is almost certainly a live concert or full show
  }

  // 2. Penalize Live / Stage / Crowd / Bootlegs (unless the track itself requested live)
  const badWords = [
    'מהבמה', 'במה', 'מהקהל', 'קהל', 'הופעה חיה', 'הופעה', 'לייב', 'live', 'concert',
    'חזרות', 'מאחורי הקלעים', 'ריאקשן', 'reaction', 'קאבר', 'cover', 'קריוקי', 'karaoke',
    'פרודיה', 'parody', 'אינסטרומנטלי', 'instrumental', 'ריאיון', 'ראיון'
  ];
  for (const w of badWords) {
    if (candTitle.includes(w) && !targetTitle.includes(w) && !targetAlbum.includes(w)) {
      score -= 60;
    }
  }

  // 3. Official / Studio rewards
  const goodWords = [
    'official audio', 'אודיו רשמי', 'שיר רשמי', 'קליפ רשמי', 'official video',
    'official music video', 'topic', 'vevo', 'הערוץ הרשמי', 'audio', 'אודיו'
  ];
  for (const w of goodWords) {
    if (candTitle.includes(w) || candAuthor.includes(w)) {
      score += 30;
      break;
    }
  }

  // 4. Topic channel reward (YouTube Music auto-generated official releases)
  if (candAuthor.includes('topic')) {
    score += 40;
  }

  // 5. Artist matching
  if (targetArtist) {
    const artistParts = targetArtist.split(/[,&]+/).map(a => a.trim().toLowerCase()).filter(Boolean);
    for (const a of artistParts) {
      if (a.length > 2 && (candAuthor.includes(a) || candTitle.includes(a))) {
        score += 25;
        break;
      }
    }
  }

  // 6. Title word matching (MANDATORY: must actually be the song requested!)
  const titleWords = targetTitle
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(w => w.length > 1);
  let matchedWords = 0;
  for (const w of titleWords) {
    if (candTitle.includes(w)) matchedWords++;
  }
  const matchRatio = titleWords.length > 0 ? (matchedWords / titleWords.length) : 1;
  if (matchRatio < 0.5) {
    return -999; // Disqualify completely wrong songs
  }
  score += Math.round(matchRatio * 45);

  // 7. Album matching (e.g. Festigal year / name)
  if (targetAlbum && targetAlbum.length > 2) {
    const albumWords = targetAlbum.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(w => w.length > 2);
    for (const aw of albumWords) {
      if (candTitle.includes(aw)) {
        score += 15;
        break;
      }
    }
  }

  return score;
}

/**
 * Resolve a track to a streamable audio ID (matches Spotify track to exact YouTube studio version and artwork)
 */
async function resolveTrackToStreamableId(track) {
  if (track.source === 'youtube' && track.id && !track.id.startsWith('sp_')) {
    return {
      streamableId: track.id,
      thumbnail: track.thumbnail,
      durationSeconds: track.durationSeconds
    };
  }

  const query = track.query || `${track.artist} - ${track.title}`.trim();

  // 1. Fetch individual studio cover from Deezer in parallel
  let albumCover = null;
  try {
    const dRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(query)}`, { timeout: 2500 });
    albumCover = dRes.data?.data?.[0]?.album?.cover_medium || null;
  } catch (e) {}

  // 2. Multi-tier search: Target studio releases, official audio, and clean query
  const candidatesMap = new Map();

  const searchQueries = [
    `${track.artist} ${track.title} official audio`,
    query,
    `${track.title} ${track.album || ''}`.trim()
  ].filter(Boolean);

  for (const sq of searchQueries) {
    try {
      const results = await searchTracks(sq, 8);
      if (Array.isArray(results)) {
        for (const item of results) {
          const vidId = item.id || item.videoId;
          if (vidId && !candidatesMap.has(vidId)) {
            candidatesMap.set(vidId, item);
          }
        }
      }
      if (candidatesMap.size >= 12) break;
    } catch (e) {}
  }

  const allCandidates = Array.from(candidatesMap.values());

  if (allCandidates.length === 0) {
    throw new Error(`לא נמצא מקור שמע עבור: ${track.title}`);
  }

  // 3. Score candidates and pick highest scoring official studio match
  const scored = allCandidates.map(cand => ({
    cand,
    score: scoreCandidate(cand, track)
  })).sort((a, b) => b.score - a.score);

  const topMatch = scored[0].cand;

  return {
    streamableId: topMatch.id || topMatch.videoId,
    thumbnail: albumCover || topMatch.thumbnail || topMatch.image || `https://i.ytimg.com/vi/${topMatch.id}/hqdefault.jpg`,
    durationSeconds: topMatch.durationSeconds || track.durationSeconds || 0
  };
}

module.exports = {
  parseSpotifyUrl,
  importSpotify,
  importYouTubePlaylist,
  universalImport,
  resolveTrackToStreamableId
};
