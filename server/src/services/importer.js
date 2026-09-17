const axios = require('axios');
const { spawn } = require('child_process');
const yts = require('yt-search');
const { cleanTitle } = require('./search');

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

  return {
    title: playlistTitle,
    cover: playlistCover,
    type: parsed.type,
    totalTracks: tracks.length,
    tracks: tracks
  };
}

/**
 * Import a YouTube playlist
 */
async function importYouTubePlaylist(url) {
  return new Promise((resolve, reject) => {
    const pyProcess = spawn('python', [
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
 * Resolve a track to a streamable audio ID (matches Spotify track to YouTube videoId)
 */
async function resolveTrackToStreamableId(track) {
  if (track.source === 'youtube' && track.id && !track.id.startsWith('sp_')) {
    return track.id;
  }

  // Search with artist and title
  const query = track.query || `${track.artist} ${track.title}`;
  const results = await yts(query);
  if (results && results.videos && results.videos.length > 0) {
    // Return top video ID
    return results.videos[0].videoId;
  }

  // Fallback: search title only
  const fallbackResults = await yts(track.title);
  if (fallbackResults && fallbackResults.videos && fallbackResults.videos.length > 0) {
    return fallbackResults.videos[0].videoId;
  }

  throw new Error(`לא נמצא מקור שמע עבור: ${track.title}`);
}

module.exports = {
  parseSpotifyUrl,
  importSpotify,
  importYouTubePlaylist,
  universalImport,
  resolveTrackToStreamableId
};
