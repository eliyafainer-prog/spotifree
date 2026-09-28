#!/bin/bash

# Termux SpotiFree Server Setup Script
echo "====================================="
echo "   SpotiFree Local Phone Server Setup"
echo "====================================="
echo ""

echo "[1/4] Updating packages and installing dependencies..."
pkg update -y
pkg install -y python nodejs ffmpeg git

echo "[2/4] Downloading SpotiFree Server..."
if [ -d "spotifree-server" ]; then
  echo "Updating existing installation..."
  cd spotifree-server
  git pull
else
  git clone https://github.com/eliyafainer-prog/spotifree.git spotifree-server
  cd spotifree-server
fi

echo "[3/4] Installing Python dependencies (yt-dlp)..."
pip install --upgrade yt-dlp || pip install --upgrade --break-system-packages yt-dlp

echo "[4/4] Installing Node.js dependencies..."
cd server
npm install

echo "[5/5] Acquiring WakeLock so server stays alive in background..."
termux-wake-lock

echo "====================================="
echo "Setup Complete!"
echo "Starting the server now..."
echo "To stop it, press CTRL+C."
echo "To start it again later, just type: ./start.sh"
echo "====================================="

cd ~
echo "#!/bin/bash" > start.sh
echo "termux-wake-lock" >> start.sh
echo "cd spotifree-server/server" >> start.sh
echo "node index.js" >> start.sh
chmod +x start.sh

cd spotifree-server/server
node index.js
