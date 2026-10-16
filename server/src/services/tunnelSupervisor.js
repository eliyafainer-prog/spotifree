const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const axios = require('axios');

const RENDER_CLOUD_URL = 'https://spotifree-h7s8.onrender.com';
const TUNNEL_URL_FILE = path.join(__dirname, '../../tunnel_url.txt');
const CLOUDFLARED_BIN = path.join(__dirname, '../../../cloudflared.exe');

let currentTunnelUrl = null;
let spawnedProcess = null;
let heartbeatInterval = null;

function getActiveTunnelUrl() {
  return currentTunnelUrl;
}

async function verifyTunnelHealthy(url) {
  if (!url || !url.startsWith('https://')) return false;
  try {
    const res = await axios.get(`${url}/health`, { timeout: 2500 });
    return res.status === 200 && res.data && res.data.status === 'ok';
  } catch (e) {
    return false;
  }
}

function setTunnelUrl(url) {
  if (!url || !url.startsWith('https://')) return;
  const cleanUrl = url.replace(/\/+$/, '');
  currentTunnelUrl = cleanUrl;
  try {
    fs.writeFileSync(TUNNEL_URL_FILE, cleanUrl, 'utf8');
  } catch (e) {}
  console.log(`[TunnelSupervisor] Active tunnel set to: ${cleanUrl}`);
  registerWithRender(cleanUrl, true);
  setTimeout(() => registerWithRender(cleanUrl), 5000);
  setTimeout(() => registerWithRender(cleanUrl), 12000);
}

async function registerWithRender(tunnelUrl, skipHealthCheck = false) {
  if (!tunnelUrl) return;
  try {
    if (!skipHealthCheck) {
      const healthy = await verifyTunnelHealthy(tunnelUrl);
      if (!healthy) return;
    }
    await axios.post(`${RENDER_CLOUD_URL}/api/tunnel/register`, {
      tunnelUrl: tunnelUrl,
      timestamp: Date.now()
    }, { timeout: 8000 });
    console.log(`[TunnelSupervisor] Successfully registered verified tunnel with Render: ${tunnelUrl}`);
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

async function ensureTunnelProcess() {
  if (isCloudflaredRunning()) {
    try {
      if (fs.existsSync(TUNNEL_URL_FILE)) {
        const saved = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
        if (await verifyTunnelHealthy(saved)) {
          currentTunnelUrl = saved;
          console.log(`[TunnelSupervisor] cloudflared is already running and healthy: ${currentTunnelUrl}`);
          registerWithRender(currentTunnelUrl);
          return;
        }
      }
    } catch (e) {}
  }

  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.warn(`[TunnelSupervisor] cloudflared binary not found at ${CLOUDFLARED_BIN}.`);
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
      currentTunnelUrl = null;
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
  if (process.env.RENDER || (process.env.NODE_ENV === 'production' && process.platform !== 'win32')) {
    console.log('[TunnelSupervisor] Running in cloud production environment. Supervisor daemon idle.');
    return;
  }

  console.log('[TunnelSupervisor] Initializing...');
  ensureTunnelProcess();

  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(sendKeepAlive, 2 * 60 * 1000);
  }

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
