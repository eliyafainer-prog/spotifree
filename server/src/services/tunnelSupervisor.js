const path = require('path');
const fs = require('fs');
const axios = require('axios');

const RENDER_CLOUD_URL = 'https://spotifree-h7s8.onrender.com';
const TUNNEL_URL_FILE = path.join(__dirname, '../../tunnel_url.txt');

let currentTunnelUrl = 'https://depending-lawyer-memories-gui.trycloudflare.com';
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
    const res = await axios.post(`${RENDER_CLOUD_URL}/api/tunnel/register`, {
      tunnelUrl: tunnelUrl,
      timestamp: Date.now()
    }, { timeout: 8000 });
    console.log(`[TunnelSupervisor] Successfully registered tunnel with Render: ${tunnelUrl}`);
  } catch (err) {
    console.warn(`[TunnelSupervisor] Register with Render note:`, err.message);
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

function initTunnelSupervisor() {
  // Only run keepalive/registry on local development machine, not on Render
  if (process.env.RENDER || (process.env.NODE_ENV === 'production' && process.platform !== 'win32')) {
    console.log('[TunnelSupervisor] Running in cloud production environment. Supervisor daemon idle.');
    return;
  }

  console.log(`[TunnelSupervisor] Initializing. Current tunnel URL: ${currentTunnelUrl}`);
  
  // Register initial tunnel immediately
  if (currentTunnelUrl) {
    registerWithRender(currentTunnelUrl);
  }

  // Set up periodic heartbeat every 2 minutes (keeps Render warm and maintains fresh registry)
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(sendKeepAlive, 2 * 60 * 1000);
  }
}

module.exports = {
  initTunnelSupervisor,
  getActiveTunnelUrl,
  setTunnelUrl,
  registerWithRender
};
