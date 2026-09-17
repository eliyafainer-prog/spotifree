const axios = require('axios');
const fs = require('fs');

async function test() {
  const res = await axios.get('https://open.spotify.com/embed/album/6yHUnp4qcbHejfqqtPGCN1', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  const match = res.data.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);
  if (match) {
    fs.writeFileSync('next_data.json', match[1]);
    console.log('Saved next_data.json, size:', match[1].length);
  } else {
    fs.writeFileSync('page.html', res.data);
    console.log('Saved page.html, size:', res.data.length);
  }
}

test().catch(console.error);
