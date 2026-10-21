const axios = require('axios');
const yts = require('yt-search');

/**
 * Clean track title by removing unnecessary labels like (Official Music Video), [HD], etc.
 */
function cleanTitle(title) {
  if (!title) return '';
  const str = typeof title === 'string'
    ? title
    : (title.text || (Array.isArray(title.runs) ? title.runs.map(r => r.text || '').join('') : String(title)));
  return str
    .replace(/\s*[\(\[](official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer|hd|4k|audio|קליפ\s*רשמי|אודיו\s*רשמי)[\)\]]/gi, '')
    .replace(/\s*[\(\[]ft\.?.*?[\)\]]/gi, '')
    .trim();
}

// In-Memory Search Cache (TTL: 2 hours, max 1000 queries)
const searchCache = new Map();
const SEARCH_CACHE_TTL = 1000 * 60 * 60 * 2;
const MAX_SEARCH_CACHE = 1000;

function getCachedSearch(key) {
  const item = searchCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return item.data;
}

function setCachedSearch(key, data) {
  if (searchCache.size >= MAX_SEARCH_CACHE) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  searchCache.set(key, { data, timestamp: Date.now() });
}

// Unwanted noise keywords (penalized/filtered unless the user explicitly searched for them)
const UNWANTED_KEYWORDS = [
  'sped up', 'speed up', 'מואץ', 'גרסה מהירה', 'nightcore', 'slowed', 'reverb', 'bass boost',
  'רמיקס טיקטוק', 'טיקטוק', 'tiktok version', 'tik tok',
  'cover', 'קאבר', 'גרסת כיסוי', 'קריוקי', 'karaoke', 'אינסטרומנטלי', 'instrumental',
  'ריאקשן', 'reaction', 'מגיב ל', 'מגיבה ל', 'תגובה ל', 'reacts to',
  'dance studio', 'just dance', 'סטודיו לריקוד', 'הדרכת ריקוד', 'כוריאוגרפיה', 'choreography',
  'פודקאסט', 'podcast', 'ראיון', 'interview', 'מאחורי הקלעים', 'הצצה ל', 'פרק '
];

const SECONDARY_REMIX_KEYWORDS = [
  'remix', 'רימיקס', 'רמיקס', 'redrum', 'mashup', 'מאשאפ', 'משאפ', 'אדיט', 'edit'
];

/**
 * Score a search result based on query relevance, official channel badges, and penalize unofficial noise
 */
function scoreSearchResult(item, query) {
  if (!item) return -999;
  const qLower = String(query || '').toLowerCase().trim();
  const rawTitle = String(item.originalTitle || item.title || '').toLowerCase();
  const rawAuthor = String(item.rawAuthor || item.artist || '').toLowerCase();
  const combined = `${rawTitle} ${rawAuthor}`;

  let score = 100;

  // 1. Check user intent for remixes / covers
  const userWantsRemix = SECONDARY_REMIX_KEYWORDS.some(kw => qLower.includes(kw));
  const userWantsCover = UNWANTED_KEYWORDS.some(kw => qLower.includes(kw));

  // 2. Heavy penalty for unwanted spam/covers/sped-up versions
  for (const kw of UNWANTED_KEYWORDS) {
    if (combined.includes(kw) && !qLower.includes(kw)) {
      score -= 300;
      break;
    }
  }

  if (!userWantsRemix) {
    for (const kw of SECONDARY_REMIX_KEYWORDS) {
      if (rawTitle.includes(kw) && !qLower.includes(kw)) {
        score -= 200;
        break;
      }
    }
  }

  // 3. Query word relevance
  const genericWords = new Set(['שיר', 'של', 'את', 'עם', 'זה', 'the', 'in', 'of', 'and', 'official', 'video', 'audio']);
  const qWords = qLower
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !genericWords.has(w));

  if (qWords.length > 0) {
    let matched = 0;
    for (const w of qWords) {
      if (combined.includes(w)) matched++;
    }
    const ratio = matched / qWords.length;
    if (ratio === 1.0) {
      score += 150; // Exact match on all search terms!
    } else if (ratio < 0.5) {
      score -= 250;
    } else {
      score += Math.round(ratio * 90);
    }

    // Identify title-only words (words in query that are NOT part of the artist's name)
    const titleOnlyWords = qWords.filter(w => !rawAuthor.includes(w));
    if (titleOnlyWords.length > 0) {
      const matchedTitleWords = titleOnlyWords.filter(w => rawTitle.includes(w)).length;
      if (matchedTitleWords === 0) {
        // Completely different song by the same artist!
        score -= 320;
      } else {
        score += Math.round((matchedTitleWords / titleOnlyWords.length) * 120);
      }
    }
  }

  // 4. Strong boost for Verified channels and Official Topic releases
  if (item.isTopic) {
    score += 110;
  }
  if (item.isVerified) {
    score += 80;
  }

  // 5. Boost for official release titles
  if (/\b(official audio|אודיו רשמי|קליפ רשמי|official video|official music video)\b/i.test(rawTitle)) {
    score += 60;
  }

  // 6. Prefer standard song lengths (2-5 mins) over ultra long or ultra short
  if (item.durationSeconds >= 110 && item.durationSeconds <= 320) {
    score += 20;
  }

  return score;
}

function rankAndFilterSearchResults(results, query) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const scored = results.map(item => ({
    item,
    score: scoreSearchResult(item, query)
  }));

  // Filter out completely disqualified junk (score < -150) unless that leaves too few results
  let filtered = scored.filter(x => x.score > -150);
  if (filtered.length < 3) {
    filtered = scored.filter(x => x.score > -350);
  }
  if (filtered.length === 0) {
    filtered = scored;
  }

  filtered.sort((a, b) => b.score - a.score);
  return filtered.map(x => x.item);
}

/**
 * 1. Ultra-fast direct YouTube InnerTube Search API (~0.8-1.2s response, up to 40 results)
 */
async function searchInnerTube(query, limit = 40) {
  try {
    const response = await axios.post(
      'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
      {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'he',
            gl: 'IL'
          }
        },
        query: query
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 4500
      }
    );

    const data = response.data;
    const rawResults = [];
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        if (item.videoRenderer) {
          const v = item.videoRenderer;
          if (!v.videoId) continue;

          const rawTitle = v.title?.runs?.[0]?.text || '';
          const rawAuthor = v.ownerText?.runs?.[0]?.text || 'Unknown Artist';
          const isTopic = /\s*-\s*Topic$/i.test(rawAuthor);
          const isVerified = Boolean(v.ownerBadges && v.ownerBadges.length > 0);
          const durStr = v.lengthText?.simpleText || '0:00';
          const parts = durStr.split(':').map(Number);
          let sec = 0;
          if (parts.length === 2) sec = (parts[0] || 0) * 60 + (parts[1] || 0);
          else if (parts.length === 3) sec = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);

          // Skip ultra-short teasers (< 40s) and long DJ mixes / full albums (> 11 mins)
          if ((sec > 0 && sec < 40) || sec > 660) continue;

          const thumbs = v.thumbnail?.thumbnails || [];
          const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

          rawResults.push({
            id: v.videoId,
            streamableId: v.videoId,
            title: cleanTitle(rawTitle) || rawTitle,
            originalTitle: rawTitle,
            artist: rawAuthor.replace(/\s*-\s*Topic$/i, ''),
            rawAuthor: rawAuthor,
            isTopic: isTopic,
            isVerified: isVerified,
            duration: durStr,
            durationSeconds: sec,
            thumbnail: thumb,
            views: v.viewCountText?.simpleText || '',
            source: 'youtube',
            url: `https://youtube.com/watch?v=${v.videoId}`
          });
        }
      }
    }

    const ranked = rankAndFilterSearchResults(rawResults, query);
    return ranked.slice(0, limit);
  } catch (err) {
    return [];
  }
}

/**
 * 2. Secondary fallback: yt-search library (up to 40 results)
 */
async function searchYts(query, limit = 40) {
  try {
    const r = await Promise.race([
      yts(query),
      new Promise((_, reject) => setTimeout(() => reject(new Error('yts timeout')), 5500))
    ]);

    const videos = r?.videos || [];
    let filtered = videos.filter(v => !v.seconds || (v.seconds >= 40 && v.seconds <= 660));
    if (filtered.length === 0) filtered = videos;

    const rawList = filtered.map(v => {
      const thumbnail = v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
      const rawAuthor = typeof v.author === 'string' ? v.author : (v.author?.name ? String(v.author.name) : 'Unknown Artist');
      const isTopic = /\s*-\s*Topic$/i.test(rawAuthor);
      const artistName = rawAuthor.replace(/\s*-\s*Topic$/i, '');
      const rawTitle = typeof v.title === 'string' ? v.title : (v.title?.text || String(v.title || ''));

      return {
        id: v.videoId,
        streamableId: v.videoId,
        title: cleanTitle(rawTitle) || rawTitle,
        originalTitle: rawTitle,
        artist: artistName,
        rawAuthor: rawAuthor,
        isTopic: isTopic,
        duration: v.timestamp || '0:00',
        durationSeconds: v.seconds || 0,
        thumbnail: thumbnail,
        views: v.views,
        source: 'youtube',
        url: v.url
      };
    });

    const ranked = rankAndFilterSearchResults(rawList, query);
    return ranked.slice(0, limit);
  } catch (e) {
    return [];
  }
}

/**
 * 3. Deezer Official Studio Catalog Search (~200ms response, rich Hebrew & Global catalog)
 */
async function searchDeezer(query, limit = 30) {
  try {
    const res = await axios.get('https://api.deezer.com/search', {
      params: { q: query, limit },
      timeout: 2800
    });
    const items = res.data?.data || [];
    return items
      .filter(t => t && t.duration >= 45 && t.duration <= 600)
      .map((t, idx) => {
        const durSec = Number(t.duration) || 0;
        const mins = Math.floor(durSec / 60);
        const secs = durSec % 60;
        const artwork = t.album?.cover_big || t.album?.cover_medium || t.artist?.picture_big || '';
        const title = String(t.title || 'Unknown Title').trim();
        const artist = String(t.artist?.name || 'Unknown Artist').trim();

        return {
          id: `sp_dz_${t.id || idx}`,
          title,
          originalTitle: title,
          artist,
          album: t.album?.title || 'Single',
          duration: `${mins}:${secs < 10 ? '0' : ''}${secs}`,
          durationSeconds: durSec,
          thumbnail: artwork,
          hasCustomArtwork: Boolean(artwork),
          source: 'deezer',
          query: `${artist} - ${title}`
        };
      });
  } catch (e) {
    return [];
  }
}

/**
 * 4. iTunes Official Catalog Search (~250ms response)
 */
async function searchItunes(query, limit = 30) {
  try {
    const res = await axios.get('https://itunes.apple.com/search', {
      params: {
        term: query,
        entity: 'song',
        country: 'IL',
        limit: limit
      },
      timeout: 2800
    });

    const items = res.data?.results || [];
    return items
      .filter(t => t && (t.trackTimeMillis || 0) >= 45000 && (t.trackTimeMillis || 0) <= 600000)
      .map((t, idx) => {
        const durSec = Math.round((t.trackTimeMillis || 0) / 1000);
        const mins = Math.floor(durSec / 60);
        const secs = durSec % 60;
        const artwork = (t.artworkUrl100 || '').replace('100x100bb', '600x600bb');

        return {
          id: `sp_it_${t.trackId || idx}`,
          title: t.trackName || 'Unknown Title',
          originalTitle: t.trackName || 'Unknown Title',
          artist: t.artistName || 'Unknown Artist',
          album: t.collectionName || 'Single',
          duration: `${mins}:${secs < 10 ? '0' : ''}${secs}`,
          durationSeconds: durSec,
          thumbnail: artwork,
          hasCustomArtwork: Boolean(artwork),
          source: 'itunes',
          query: `${t.artistName} - ${t.trackName}`
        };
      });
  } catch (e) {
    return [];
  }
}

/**
 * Deduplicate and merge multi-source tracks while preserving all distinct videos & studio songs
 */
function mergeAndDeduplicateTracks(lists, limit = 60) {
  const seenIds = new Set();
  const seenSignatures = new Set();
  const merged = [];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !item.id) continue;
      if (seenIds.has(item.id)) continue;

      const normTitle = String(item.title || '')
        .toLowerCase()
        .replace(/\s*[\(\[][^)\]]*[\)\]]/g, '')
        .replace(/[^\p{L}\p{N}]/gu, '');
      const normArtist = String(item.artist || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
      const sig = `${normArtist}:::${normTitle}`;

      // For catalog entries (sp_dz_ / sp_it_), skip if an identical artist+title video is already present
      if (String(item.id).startsWith('sp_') && normTitle && seenSignatures.has(sig)) {
        continue;
      }

      seenIds.add(item.id);
      if (normTitle) seenSignatures.add(sig);
      merged.push(item);

      if (merged.length >= limit) return merged;
    }
  }

  return merged;
}

/**
 * Main Search Function with multi-source aggregation (YouTube InnerTube + Deezer + yt-search + iTunes)
 */
async function searchTracks(query, limit = 60) {
  if (!query || !query.trim()) return [];
  const trimmed = query.trim();
  const normalizedKey = `${trimmed.toLowerCase()}:::${limit}`;

  // 1. Instant in-memory cache hit (0ms)
  const cached = getCachedSearch(normalizedKey);
  if (cached && cached.length > 0) {
    return cached.slice(0, limit);
  }

  // For small internal resolution queries (limit <= 15), keep ultra-fast single-source YouTube lookup
  if (limit <= 15) {
    let fastResults = await searchInnerTube(trimmed, limit);
    if (fastResults.length === 0) {
      fastResults = await searchYts(trimmed, limit);
    }
    if (fastResults.length > 0) {
      setCachedSearch(normalizedKey, fastResults);
    }
    return fastResults;
  }

  // 2. Full user search / category browse: query YouTube InnerTube + Deezer + iTunes in parallel for a huge, rich catalog!
  const [ytInner, deezerRes, itunesRes] = await Promise.all([
    searchInnerTube(trimmed, 40),
    searchDeezer(trimmed, 25),
    searchItunes(trimmed, 20)
  ]);

  let ytsRes = [];
  if (ytInner.length < 15) {
    ytsRes = await searchYts(trimmed, 35);
  }

  const results = mergeAndDeduplicateTracks([ytInner, ytsRes, deezerRes, itunesRes], limit);

  if (results.length > 0) {
    setCachedSearch(normalizedKey, results);
  }

  return results;
}

// Cached rich home catalog (refreshes every 30 minutes)
let cachedHomeCatalog = null;
let cachedHomeCatalogTime = 0;
const HOME_CATALOG_TTL = 1000 * 60 * 30;

const CATALOG_SECTION_DEFS = [
  {
    id: 'israeli_hits',
    title: 'להיטי ישראל — הכי חמים עכשיו',
    subtitle: 'השירים והקליפים הכי מושמעים בישראל',
    queries: [
      'עומר אדם נועה קירל אושר כהן פאר טסי',
      'עדן חסון אודיה יסמין מועלם כפיר צפריר'
    ]
  },
  {
    id: 'hiphop_groove',
    title: 'היפ-הופ, ראפ וגרוב ישראלי',
    subtitle: 'טונה, רביד פלוטניק, נס וסטילה ועוד',
    queries: [
      'רביד פלוטניק טונה שחר סאול',
      'נס וסטילה הדג נחש פול טראנק'
    ]
  },
  {
    id: 'mizrahit',
    title: 'ים-תיכוני ומזרחית',
    subtitle: 'קלאסיקות ולהיטים חדשים מהז׳אנר הים-תיכוני',
    queries: [
      'אייל גולן עדן בן זקן משה פרץ איתי לוי',
      'שרית חדד דודו אהרון ליאור נרקיס זוהר ארגוב'
    ]
  },
  {
    id: 'festigal_nostalgia',
    title: 'קלאסיקות פסטיגל ונוסטלגיה ישראלית',
    subtitle: 'השירים הגדולים של הפסטיגל והמוזיקה הישראלית',
    queries: [
      'הראל סקעת רן דנקר פסטיגל שירים',
      'שלמה ארצי אריק איינשטיין כוורת משינה'
    ]
  },
  {
    id: 'global_pop',
    title: 'להיטים בינלאומיים — Global Top Hits',
    subtitle: 'הלהיטים הגדולים בעולם ברגע זה',
    queries: [
      'The Weeknd Dua Lipa Bruno Mars Billie Eilish',
      'Taylor Swift Sabrina Carpenter Post Malone Coldplay'
    ]
  },
  {
    id: 'party_electronic',
    title: 'מסיבה, דאנס ואנרגיה גבוהה',
    subtitle: 'ביטים, אלקטרוני ומוזיקה לאימונים',
    queries: [
      'David Guetta Calvin Harris Tiesto Avicii',
      'Travis Scott Drake Kendrick Lamar Metro Boomin'
    ]
  }
];

/**
 * Build rich multi-section catalog & expanded trending tracks (100+ tracks across 6 categories)
 */
async function getHomeCatalog() {
  if (cachedHomeCatalog && (Date.now() - cachedHomeCatalogTime < HOME_CATALOG_TTL)) {
    return cachedHomeCatalog;
  }

  const sectionPromises = CATALOG_SECTION_DEFS.map(async (def) => {
    const queryLists = await Promise.all(
      def.queries.map(q =>
        Promise.all([
          searchInnerTube(q, 18),
          searchDeezer(q, 12)
        ]).then(([yt, dz]) => mergeAndDeduplicateTracks([yt, dz], 22))
      )
    );
    const tracks = mergeAndDeduplicateTracks(queryLists, 24);
    return {
      id: def.id,
      title: def.title,
      subtitle: def.subtitle,
      tracks
    };
  });

  const sections = await Promise.all(sectionPromises);
  const allTrending = mergeAndDeduplicateTracks(sections.map(s => s.tracks), 60);

  cachedHomeCatalog = {
    tracks: allTrending,
    sections: sections.filter(s => s.tracks && s.tracks.length > 0)
  };
  cachedHomeCatalogTime = Date.now();

  return cachedHomeCatalog;
}

/**
 * Get trending / popular tracks for home feed (returns 60+ tracks)
 */
async function getTrendingTracks() {
  const catalog = await getHomeCatalog();
  return catalog.tracks;
}

module.exports = {
  searchTracks,
  getTrendingTracks,
  getHomeCatalog,
  cleanTitle
};
