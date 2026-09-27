const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const axios = require('axios');

const RENDER_CLOUD_URL = 'https://spotifree-h7s8.onrender.com';
const TUNNEL_URL_FILE = path.join(__dirname, '../../tunnel_url.txt');
const CLOUDFLARED_BIN = path.join(__dirname, '../../../cloudflared.exe');

let currentTunnelUrl = 'https://depending-lawyer-memories-gui.trycloudflare.com';
let spawnedProcess = null;
let heartbeatInterval = null;

// Read cached tunnel URL if available
try {
  if (fs.existsSync(TUNNEL_URL_FILE)) {
    const saved = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
    if (saved.startsWith('https://') && saved.includes('trycloudflare.com')) {
      currentTunnelUrl = saved;
    }
  }
} catch (e) {}

function getActiveTunnelUrl() {
  return currentTunnelUrl;
}

function setTunnelUrl(url) {
  if (!url || !url.startsWith('https://')) return;
  const cleanUrl = url.replace(/\/+$/, '');
  currentTunnelUrl = cleanUrl;
  try {
    fs.writeFileSync(TUNNEL_URL_FILE, cleanUrl, 'utf8');
  } catch (e) {}
  console.log(`[TunnelSupervisor] Active tunnel set to: ${cleanUrl}`);
  registerWithRender(cleanUrl);
}

async function registerWithRender(tunnelUrl) {
  if (!tunnelUrl) return;
  try {
    await axios.post(`${RENDER_CLOUD_URL}/api/tunnel/register`, {
      tunnelUrl: tunnelUrl,
      timestamp: Date.now()
    }, { timeout: 8000 });
    console.log(`[TunnelSupervisor] Successfully registered tunnel with Render: ${tunnelUrl}`);
  } catch (err) {
    // Render might be waking up; heartbeat will retry
  }
}

async function sendKeepAlive() {
  try {
    await axios.get(`${RENDER_CLOUD_URL}/health`, { timeout: 8000 });
    if (currentTunnelUrl) {
      await registerWithRender(currentTunnelUrl);
    }
  } catch (e) {
    // Silent catch
  }
}

function isCloudflaredRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const stdout = execSync('tasklist /FI "IMAGENAME eq cloudflared.exe"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return stdout.includes('cloudflared.exe');
  } catch (e) {
    return false;
  }
}

function ensureTunnelProcess() {
  // If cloudflared is already running (e.g. in background or another console), do not duplicate
  if (isCloudflaredRunning()) {
    console.log(`[TunnelSupervisor] cloudflared is already running. Using tunnel URL: ${currentTunnelUrl}`);
    return;
  }

  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.warn(`[TunnelSupervisor] cloudflared binary not found at ${CLOUDFLARED_BIN}. Using configured tunnel.`);
    return;
  }

  console.log('[TunnelSupervisor] Spawning autonomous cloudflared tunnel process...');
  try {
    spawnedProcess = spawn(CLOUDFLARED_BIN, ['tunnel', '--url', 'http://127.0.0.1:5050'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const handleData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && match[0]) {
        setTunnelUrl(match[0]);
      }
    };

    spawnedProcess.stdout.on('data', handleData);
    spawnedProcess.stderr.on('data', handleData);

    spawnedProcess.on('exit', (code) => {
      console.warn(`[TunnelSupervisor] cloudflared exited with code ${code}. Restarting in 5s...`);
      spawnedProcess = null;
      setTimeout(ensureTunnelProcess, 5000);
    });

    spawnedProcess.on('error', (err) => {
      console.error('[TunnelSupervisor] cloudflared process error:', err.message);
    });
  } catch (err) {
    console.error('[TunnelSupervisor] Failed to spawn cloudflared:', err.message);
  }
}

function initTunnelSupervisor() {
  // Only run tunnel management on local development machine, not on Render
  if (process.env.RENDER || (process.env.NODE_ENV === 'production' && process.platform !== 'win32')) {
    console.log('[TunnelSupervisor] Running in cloud production environment. Supervisor daemon idle.');
    return;
  }

  console.log(`[TunnelSupervisor] Initializing. Current tunnel URL: ${currentTunnelUrl}`);
  
  // Ensure tunnel is running
  ensureTunnelProcess();

  // Register initial tunnel immediately
  if (currentTunnelUrl) {
    registerWithRender(currentTunnelUrl);
  }

  // Set up periodic heartbeat every 2 minutes (keeps Render warm and maintains fresh registry)
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(sendKeepAlive, 2 * 60 * 1000);
  }

  // Clean shutdown
  const cleanup = () => {
    if (spawnedProcess) {
      try { spawnedProcess.kill(); } catch (e) {}
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

module.exports = {
  initTunnelSupervisor,
  getActiveTunnelUrl,
  setTunnelUrl,
  registerWithRender
};
