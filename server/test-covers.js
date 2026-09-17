const axios = require('axios');

const urls = [
  'https://open.spotify.com/embed/album/4m2880jivSbbyEGAKfITCa',
  'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
  'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M'
];

async function check(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const match = res.data.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    const entity = json.props?.pageProps?.state?.data?.entity;
    console.log('\n--- Checking:', url);
    console.log('Type:', entity?.type);
    console.log('Name:', entity?.name || entity?.title);
    console.log('Images:', entity?.images);
    console.log('CoverArt:', entity?.coverArt);
    console.log('visualIdentity:', entity?.visualIdentity);
    if (entity?.trackList?.[0]) {
      console.log('Track 0 cover/images:', {
        images: entity.trackList[0].images,
        coverArt: entity.trackList[0].coverArt
      });
    }
  }
}

async function run() {
  for (const u of urls) {
    await check(u);
  }
}

run().catch(console.error);
