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
 * Fetch live real-time playlist tracks and 640x640 individual artwork from Spotify Pathfinder GraphQL API
 * (Bypasses Spotify's stale /embed/playlist/ snapshot cache so edited playlists update immediately!)
 */
async function fetchSpotifyPlaylistPathfinder(playlistId, accessToken) {
  if (!playlistId || !accessToken) return null;

  const allItems = [];
  let playlistName = '';
  let playlistCover = '';
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < 4; page++) {
    const pfRes = await axios.post(
      'https://api-partner.spotify.com/pathfinder/v1/query',
      {
        variables: {
          uri: `spotify:playlist:${playlistId}`,
          offset,
          limit,
          enableWatchFeedEntrypoint: false
        },
        operationName: 'fetchPlaylist',
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749'
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'App-Platform': 'WebPlayer',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        timeout: 8000
      }
    );

    const pl = pfRes.data?.data?.playlistV2;
    if (!pl) break;

    if (!playlistName && pl.name) playlistName = pl.name;
    if (!playlistCover && pl.images?.items?.[0]?.sources?.length) {
      const sortedImg = [...pl.images.items[0].sources].sort((a, b) => (b.width || 0) - (a.width || 0));
      playlistCover = sortedImg[0]?.url || '';
    }

    const items = pl.content?.items || [];
    allItems.push(...items);

    const totalCount = Number(pl.content?.totalCount) || items.length;
    offset += items.length;
    if (items.length === 0 || offset >= totalCount) break;
  }

  if (allItems.length === 0) return null;

  const tracks = [];
  for (let i = 0; i < allItems.length; i++) {
    const trackData = allItems[i]?.itemV2?.data;
    if (!trackData || trackData.__typename !== 'Track') continue;

    const rawTitle = String(trackData.name || 'שיר ללא שם').replace(/\u00a0/g, ' ').trim();
    const artistList = (trackData.artists?.items || [])
      .map(a => a.profile?.name)
      .filter(Boolean);
    const artist = (artistList.join(', ') || 'Unknown Artist').replace(/\u00a0/g, ' ').trim();
    const albumName = String(trackData.albumOfTrack?.name || playlistName || 'Spotify').replace(/\u00a0/g, ' ').trim();
    const durationMs = Number(trackData.trackDuration?.totalMilliseconds) || 0;
    const durationSec = Math.round(durationMs / 1000);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const coverSources = trackData.albumOfTrack?.coverArt?.sources || [];
    const sortedCovers = [...coverSources].sort((a, b) => (b.width || 0) - (a.width || 0));
    const trackSpecificCover = sortedCovers[0]?.url || null;

    const spotifyTrackId = trackData.uri ? trackData.uri.split(':').pop() : `${playlistId}_${i}`;

    tracks.push({
      id: `sp_${spotifyTrackId}`,
      originalId: `sp_${spotifyTrackId}`,
      spotifyId: spotifyTrackId,
      title: rawTitle,
      originalTitle: rawTitle,
      artist,
      album: albumName,
      thumbnail: trackSpecificCover || playlistCover,
      hasCustomArtwork: Boolean(trackSpecificCover),
      duration: durationStr,
      durationSeconds: durationSec,
      source: 'spotify',
      query: `${artist} - ${rawTitle}`
    });
  }

  if (tracks.length === 0) return null;

  return {
    sourceId: `pl_sp_${playlistId}`,
    spotifyPlaylistId: playlistId,
    title: playlistName || 'פלייליסט מיובא',
    cover: playlistCover || tracks[0]?.thumbnail || '',
    type: 'playlist',
    totalTracks: tracks.length,
    tracks
  };
}

/**
 * Fetch tracks and artwork from Spotify URL (no API key required)
 */
async function importSpotify(url, forceRefresh = false) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) {
    throw new Error('קישור ספוטיפיי אינו תקין. אנא ודא שהעתקת קישור לפלייליסט, אלבום או שיר.');
  }

  const embedUrl = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}?_cb=${Date.now()}`;
  let response;
  try {
    response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'he,en-US,en;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
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

  // 1. For playlists, always query Spotify's real-time Pathfinder GraphQL API first so newly added/removed songs & individual 640x640 covers load immediately!
  const accessToken = nextData.props?.pageProps?.state?.settings?.session?.accessToken;
  if (parsed.type === 'playlist' && accessToken) {
    try {
      const livePlaylist = await fetchSpotifyPlaylistPathfinder(parsed.id, accessToken);
      if (livePlaylist && livePlaylist.tracks.length > 0) {
        return livePlaylist;
      }
    } catch (pfErr) {
      // Fallback to embed entity if Pathfinder fails
    }
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
    const spotifyTrackId = t.id || t.uri?.split(':').pop() || `${parsed.id}_${index}`;

    return {
      id: `sp_${spotifyTrackId}`,
      originalId: `sp_${spotifyTrackId}`,
      spotifyId: spotifyTrackId,
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
    sourceId: `pl_sp_${parsed.id}`,
    spotifyPlaylistId: parsed.id,
    title: playlistTitle,
    cover: playlistCover,
    type: parsed.type,
    totalTracks: tracks.length,
    tracks: tracks
  };
}

const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

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

function expandBilingualArtistParts(artistParts = []) {
  const expanded = new Set(artistParts.filter(Boolean));
  for (const a of [...expanded]) {
    const low = a.toLowerCase().trim();
    for (const grp of ARTIST_BILINGUAL_GROUPS) {
      if (grp.some(g => low === g || low.includes(g) || g.includes(low))) {
        grp.forEach(g => expanded.add(g));
      }
    }
  }
  return [...expanded];
}

function formatYtTrackEntry(v, playlistTitle) {
  const id = v.videoId || v.id;
  const durSec = Number(v.durationSeconds || v.seconds || v.duration) || 0;
  const mins = Math.floor(durSec / 60);
  const secs = Math.round(durSec % 60);
  const durStr = v.timestamp || `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  const rawTitle = String(v.title || 'YouTube Track').trim();
  const cleaned = cleanTitle(rawTitle) || rawTitle;
  let artist = String(v.author?.name || v.uploader || v.channel || 'YouTube Artist').replace(/\s*-\s*Topic$/i, '').trim();
  let finalTitle = cleaned;

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      artist = parts[0];
      finalTitle = parts.slice(1).join(' - ').split('|')[0].trim() || cleaned;
    }
  }

  return {
    id,
    streamableId: id,
    title: finalTitle,
    originalTitle: rawTitle,
    artist,
    album: playlistTitle,
    thumbnail: v.thumbnail || v.image || v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    hasCustomArtwork: true,
    duration: durStr,
    durationSeconds: durSec,
    source: 'youtube',
    url: `https://www.youtube.com/watch?v=${id}`
  };
}

/**
 * Import a YouTube playlist or single video (fast pure Node.js via yt-search with yt-dlp fallback)
 */
async function importYouTubePlaylist(url) {
  const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  const videoMatch = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);

  // 1. Fast Pure-Node.js Playlist Import via yt-search
  if (listMatch && listMatch[1]) {
    try {
      const pl = await yts({ listId: listMatch[1] });
      if (pl && Array.isArray(pl.videos) && pl.videos.length > 0) {
        const playlistTitle = pl.title || 'YouTube Playlist';
        const tracks = pl.videos.map(v => formatYtTrackEntry(v, playlistTitle));
        return {
          sourceId: `pl_yt_${listMatch[1]}`,
          title: playlistTitle,
          cover: pl.thumbnail || tracks[0]?.thumbnail || '',
          type: 'youtube',
          totalTracks: tracks.length,
          tracks
        };
      }
    } catch (e) {}
  }

  // 2. Fast Pure-Node.js Single Video Import via yt-search
  if (videoMatch && videoMatch[1] && !listMatch) {
    try {
      const v = await yts({ videoId: videoMatch[1] });
      if (v && (v.videoId || v.title)) {
        const track = formatYtTrackEntry(v, v.title);
        return {
          title: track.title,
          cover: track.thumbnail,
          type: 'track',
          totalTracks: 1,
          tracks: [track]
        };
      }
    } catch (e) {}
  }

  // 3. Fallback: yt-dlp subprocess
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
        const entries = Array.isArray(json.entries) ? json.entries : (json.id ? [json] : []);
        const tracks = entries.map(v => formatYtTrackEntry(v, playlistTitle));

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
async function universalImport(inputUrl, forceRefresh = false) {
  const trimmed = String(inputUrl || '').trim();
  let result;
  if (trimmed.includes('spotify.com') || trimmed.startsWith('spotify:')) {
    result = await importSpotify(trimmed, forceRefresh);
  } else if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
    result = await importYouTubePlaylist(trimmed, forceRefresh);
  } else {
    throw new Error('כתובת לא נתמכת. יש להדביק קישור תקין מ-Spotify או מ-YouTube.');
  }

  // When re-importing or forceRefresh is requested, evict cached resolutions for all tracks in the playlist
  if (forceRefresh && result && Array.isArray(result.tracks)) {
    for (const t of result.tracks) {
      const cleanArtist = String(t.artist || '').replace(/\u00a0/g, ' ').trim();
      const cleanTrackTitle = String(t.title || '').replace(/\u00a0/g, ' ').trim();
      const cacheKey = `v4:::${cleanArtist}:::${cleanTrackTitle}:::${t.durationSeconds || 0}`.toLowerCase();
      resolveMemCache.delete(cacheKey);
    }
  }

  return result;
}

/**
 * Score how well a YouTube candidate matches the original Spotify track.
 * Enforces strict Spotify studio duration, official - Topic / verified artist channels,
 * and rejects live stage clips (e.g. Festigal stage performances/remakes), medleys, covers, and remixes.
 */
function scoreCandidate(cand, track, extraArtistAliases = []) {
  let score = 0;
  const candTitle = String(cand.originalTitle || cand.title || '').replace(/\u00a0/g, ' ').replace(/['׳’`]/g, '').toLowerCase();
  const candCleanTitle = String(cand.title || '').replace(/\u00a0/g, ' ').replace(/['׳’`]/g, '').toLowerCase();
  const candAuthor = String(cand.rawAuthor || cand.artist || cand.author?.name || '').replace(/\u00a0/g, ' ').replace(/['׳’`]/g, '').toLowerCase();
  const rawTargetTitle = String(track.title || track.originalTitle || '').replace(/\u00a0/g, ' ').replace(/['׳’`]/g, '').toLowerCase();
  const coreTargetTitle = rawTargetTitle.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').split(' - ')[0].trim() || rawTargetTitle;
  const targetArtist = String(track.artist || '').replace(/\u00a0/g, ' ').replace(/['׳’`]/g, '').toLowerCase();
  const targetAlbum = String(track.album || '').replace(/\u00a0/g, ' ').replace(/['׳’`]/g, '').toLowerCase();
  const candSec = Number(cand.durationSeconds || cand.seconds) || 0;
  const targetSec = Number(track.durationSeconds) || 0;
  const isTopic = Boolean(cand.isTopic || candAuthor.includes('- topic') || candAuthor.endsWith('topic'));

  // Reject very short teasers/clips (< 45s) unless the Spotify track itself is short
  if (candSec > 0 && candSec < 45 && (targetSec === 0 || targetSec >= 45)) {
    return -999;
  }

  // 1. Core Title word matching (MANDATORY: must actually be the requested song!)
  const stopWords = new Set(['כל', 'כך', 'של', 'את', 'עם', 'זה', 'על', 'אל', 'מן', 'זה', 'מה', 'לא', 'כי', 'גם', 'the', 'in', 'of', 'and', 'to', 'a', 'an']);
  const titleWords = coreTargetTitle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 || /\p{N}/u.test(w));

  const importantTitleWords = titleWords.filter(w => !stopWords.has(w));
  const wordsToTest = importantTitleWords.length > 0 ? importantTitleWords : titleWords;

  const candTokens = new Set(candTitle.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/));
  const candCleanTokens = new Set(candCleanTitle.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/));

  let matchedWords = 0;
  for (const w of wordsToTest) {
    if (
      candTokens.has(w) ||
      candCleanTokens.has(w) ||
      candTokens.has('ו' + w) ||
      candTokens.has('ה' + w) ||
      (w.length >= 4 && (candTitle.includes(w) || candCleanTitle.includes(w)))
    ) {
      matchedWords++;
    }
  }

  if (wordsToTest.length > 0 && matchedWords === 0) {
    return -999;
  }

  const matchRatio = wordsToTest.length > 0 ? (matchedWords / wordsToTest.length) : 1;
  if (matchRatio < 0.6) {
    return -999;
  }
  score += Math.round(matchRatio * 90);

  // Build artist aliases early so we don't penalize official bilingual titles that contain the artist's name!
  const genericFestigalWords = new Set(['פסטיגל', 'משתתפי', 'הפסטיגל', 'כוכבי', 'ילדי', 'various', 'artists', 'tel', 'aviv']);
  const rawArtistParts = [
    ...targetArtist
      .split(/[,&•/]+|\s+x\s+/i)
      .map(a => a.trim().toLowerCase())
      .filter(a => a.length > 1),
    ...extraArtistAliases.map(a => String(a || '').replace(/['׳’`]/g, '').trim().toLowerCase()).filter(a => a.length > 1)
  ];
  const artistParts = expandBilingualArtistParts(rawArtistParts);
  const artistWordTokens = new Set(
    artistParts
      .join(' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
  );

  const candNonStopTokens = [...candCleanTokens].filter(w => w.length > 2 && !stopWords.has(w) && w !== 'x');
  const extraUnknownWords = candNonStopTokens.filter(
    cw =>
      !artistWordTokens.has(cw) &&
      !titleWords.some(tw => cw === tw || (cw.length >= 4 && tw.includes(cw)))
  );
  if (extraUnknownWords.length >= 3 && !candAuthor.includes(extraUnknownWords[0])) {
    score -= 110;
  }

  // 2. Duration matching against Spotify studio master
  if (targetSec > 0 && candSec > 0) {
    const diff = Math.abs(candSec - targetSec);
    if (diff <= 2) score += 140;
    else if (diff <= 5) score += 105;
    else if (diff <= 9) score += 60;
    else if (diff <= 15) score += 15;
    else if (diff <= 25) score -= 50;
    else if (diff <= 40) score -= 120;
    else score -= 220;
  }

  // 3. Strictly penalize Live / Stage / Club / Date-stamped concert recordings / Vocal-only / Cover / Remix / Mashup
  const stageAndLiveWords = [
    'מתוך המופע', 'מהמופע', 'במופע', 'המופע המלא', 'קטע מתוך', 'נאמבר',
    'מהבמה', 'על הבמה', 'במה', 'מהקהל', 'קהל', 'הופעה חיה', 'בהופעה', 'הופעה',
    'לייב', 'live', 'concert', 'חי באולפן', 'באולפן', 'חי מ', 'גלגלצ', 'חזרות', 'מאחורי הקלעים', 'ריאקשן', 'reaction',
    'איך לרקוד', 'הדרכת ריקוד', 'כוריאוגרפיה', 'ילדי הפסטיגל', 'אודישן', 'מחרוזת',
    'קאבר', 'cover', 'קריוקי', 'karaoke', 'פרודיה', 'parody', 'משאפ', 'מאשאפ', 'mashup', 'mash up',
    'אינסטרומנטלי', 'instrumental', 'ווקאלי', 'ווקאלים', 'אקפלה', 'acapella', 'ריאיון', 'ראיון', 'הצצה ל', 'מתוך פרק', 'בטקס ',
    'רמיקס', 'רימיקס', 'remix', 'rmx', 'bootleg', 'slowed', 'sped up', 'nightcore', '8d',
    '#myפסטיגל', 'my פסטיגל', 'my festigal', 'חידוש', 'מחווה', 'גיבוי', 'תרגום',
    'מגיב', 'מגיבה', 'תגובה', 'reacts', 'edits', 'אדיט', 'speed up', 'spedup', 'מואץ', 'גרסה מהירה', 'bass boost', 'tiktok', 'טיקטוק',
    'מארח את', 'מארחת את', 'אורח ב', 'אורחת ב', 'מועדון ה', 'מועדון גריי', 'בארבי', 'זאפה', 'כולי עלמא', 'בצוללת',
    'פסטיבל ', 'מצעד הגאווה', 'גירסת רוק', 'גרסת רוק', 'דיבוב', 'זומבה', 'zumba', 'rave mix'
  ];
  for (const w of stageAndLiveWords) {
    if ((candTitle.includes(w) || candAuthor.includes(w)) && !rawTargetTitle.includes(w) && !targetAlbum.includes(w)) {
      score -= 220;
    }
  }

  // Penalize date-stamped amateur concert recordings (e.g. "26.11.22", "11/2023", "17.2.2024")
  if (/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{1,2}\/20\d{2}\b/.test(candTitle) && !/\b\d{1,2}[./]\d{1,2}\b/.test(rawTargetTitle)) {
    score -= 240;
  }

  // 4. Penalize unrequested remakes ("בביצוע ...")
  if (candTitle.includes('בביצוע') && !rawTargetTitle.includes('בביצוע')) {
    score -= 180;
  }

  // 5. Artist & Official Channel verification (strongly prefer when the YouTube CHANNEL itself is the artist!)
  const isFestigalTrack = targetArtist.includes('פסטיגל') || targetAlbum.includes('פסטיגל') || rawTargetTitle.includes('פסטיגל');
  let artistMatched = false;
  let primarySingerMatched = false;
  let channelIsOfficialArtist = false;

  const specificSigners = artistParts.filter(a => {
    const words = a.split(/\s+/);
    return !words.every(w => genericFestigalWords.has(w));
  });

  const candAuthorClean = candAuthor.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/official$/i, '').trim();

  for (const a of specificSigners) {
    if (candAuthor.includes(a) || (candAuthorClean.length >= 3 && a.includes(candAuthorClean))) {
      score += 155; // Strong reward: the YouTube channel itself belongs to the official artist!
      artistMatched = true;
      primarySingerMatched = true;
      channelIsOfficialArtist = true;
      break;
    }
  }

  if (!channelIsOfficialArtist) {
    for (const a of specificSigners) {
      if (candTitle.includes(a)) {
        score += 30; // Artist is only mentioned in the video title, not the channel name
        artistMatched = true;
        break;
      }
    }
  }

  const officialLabelChannels = ['helicon', 'הליקון', 'mobile1', 'p.i.l', 'nmc', 'קמע', 'עננה', 'unicell', 'יוניסל'];
  const isKnownLabelChannel = officialLabelChannels.some(lbl => candAuthor.includes(lbl));
  if (isKnownLabelChannel) {
    score += 75;
    artistMatched = true;
  }

  if (isFestigalTrack || candTitle.includes('פסטיגל') || candAuthor.includes('פסטיגל')) {
    if (candAuthor.includes('מוזיקה ישראלית ו-פסטיגל') || candAuthor.includes('פסטיגל - הערוץ הרשמי') || candAuthor.includes('festigal')) {
      score += 85; // Official Festigal / Israeli Music channel
      artistMatched = true;
      channelIsOfficialArtist = true;
    } else if (candTitle.includes('פסטיגל') || candTitle.includes('festigal')) {
      score += 20;
      if (specificSigners.length === 0) artistMatched = true;
    }
  }

  // 6. YouTube Music "- Topic" channel reward ONLY if artist matches (or official Release/Various Artists Topic with matching duration!)
  if (isTopic) {
    const isGenericTopic = candAuthor.startsWith('release - topic') || candAuthor.startsWith('various artists - topic');
    if (primarySingerMatched || (isGenericTopic && (targetSec === 0 || Math.abs(candSec - targetSec) <= 15))) {
      score += 110;
      artistMatched = true;
      channelIsOfficialArtist = true;
    } else if (!isGenericTopic && specificSigners.length > 0 && !primarySingerMatched) {
      // A "- Topic" channel belonging to a DIFFERENT artist (e.g., cover/lullaby/tribute artist)!
      score -= 220;
    } else {
      score += 40;
    }
  }

  // 7. Verified / Official Channel & Studio Audio rewards
  if (cand.isVerified && (channelIsOfficialArtist || isKnownLabelChannel)) {
    score += 45;
  }
  const officialStudioWords = [
    'official audio', 'אודיו רשמי', 'שיר רשמי', 'אודיו', 'audio', 'הערוץ הרשמי', 'vevo', 'official visualizer'
  ];
  for (const w of officialStudioWords) {
    if (candTitle.includes(w) || candAuthor.includes(w)) {
      score += 35;
      break;
    }
  }

  // Penalize third-party random user channels when the artist has an official channel
  if (specificSigners.length > 0 && !channelIsOfficialArtist && !isKnownLabelChannel) {
    score -= 85;
  }
  if (!artistMatched) {
    score -= 120;
  }

  return score;
}

const resolveMemCache = new Map();
const MAX_RESOLVE_CACHE = 1000;

/**
 * Resolve a track to a streamable audio ID (matches Spotify track to exact studio version, duration, and artwork)
 */
async function resolveTrackToStreamableId(track, forceRefresh = false) {
  const shouldBypassCache = Boolean(forceRefresh || track?.forceRefresh || track?.refresh);

  if (!shouldBypassCache && track.source === 'youtube' && track.id && !track.id.startsWith('sp_') && track.hasCustomArtwork !== false) {
    return {
      streamableId: track.id,
      thumbnail: track.thumbnail,
      hasCustomArtwork: true,
      durationSeconds: track.durationSeconds
    };
  }

  const cleanArtist = String(track.artist || '').replace(/\u00a0/g, ' ').trim();
  const cleanTrackTitle = String(track.title || '').replace(/\u00a0/g, ' ').trim();
  const cacheKey = `v5:::${cleanArtist}:::${cleanTrackTitle}:::${track.durationSeconds || 0}`.toLowerCase();
  if (shouldBypassCache) {
    resolveMemCache.delete(cacheKey);
  } else if (resolveMemCache.has(cacheKey)) {
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

    function isCatalogTitleMatch(candTitle, tgtTitle) {
      if (!candTitle || !tgtTitle) return false;
      const clean1 = String(candTitle).toLowerCase().replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').replace(/[^\p{L}\p{N}]/gu, '').trim();
      const clean2 = String(tgtTitle).toLowerCase().replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').replace(/[^\p{L}\p{N}]/gu, '').trim();
      if (clean1 === clean2) return true;

      const words1 = String(candTitle).toLowerCase().replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1);
      const words2 = String(tgtTitle).toLowerCase().replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1);

      if (words1.length === 0 || words2.length === 0) return false;
      if (words1.length === 1 || words2.length === 1) {
        return clean1 === clean2;
      }
      const matched = words1.filter(w => words2.includes(w)).length;
      return (matched / Math.max(words1.length, words2.length)) >= 0.75;
    }

    let bestCover = !needsIndividualCover ? track.thumbnail : null;
    let catalogDuration = Number(track.durationSeconds) || 0;
    const artistAliases = [];

    for (const d of deezerItems) {
      const dTitle = String(d.title || '');
      if (isCatalogTitleMatch(dTitle, cleanTrackTitle)) {
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
      const itTitle = String(it.trackName || '');
      const itDur = Math.round((it.trackTimeMillis || 0) / 1000);
      if (isCatalogTitleMatch(itTitle, cleanTrackTitle)) {
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

  const topEntry = scored[0];
  const topMatch = topEntry.cand;
  const isAcceptableScore = topEntry.score >= -150;
  const resolvedId = isAcceptableScore
    ? (topMatch.id || topMatch.videoId)
    : (track.streamableId || track.id || topMatch.id || topMatch.videoId);
  const ytThumb = isAcceptableScore
    ? (topMatch.thumbnail || topMatch.image || (resolvedId ? `https://i.ytimg.com/vi/${resolvedId}/hqdefault.jpg` : ''))
    : '';
  const finalDurationSec = effectiveTrack.durationSeconds || (isAcceptableScore ? topMatch.durationSeconds : 0) || 0;

  const resolutionResult = {
    streamableId: resolvedId,
    thumbnail: bestCover || track.thumbnail || ytThumb || '',
    hasCustomArtwork: true,
    studioResolvedV3: true,
    studioResolvedV4: true,
    studioResolvedV5: true,
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
