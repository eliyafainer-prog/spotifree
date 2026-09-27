// Safe polyfills for third-party libraries (e.g. yt-search) when YouTube returns objects/runs instead of string primitives
if (!Object.prototype.trim) {
  Object.defineProperty(Object.prototype, 'trim', {
    value: function() {
      if (this.text) return String(this.text).trim();
      if (Array.isArray(this.runs)) return this.runs.map(r => r.text || '').join('').trim();
      return String(this).trim();
    },
    configurable: true,
    writable: true
  });
}
if (!Object.prototype.split) {
  Object.defineProperty(Object.prototype, 'split', {
    value: function(...args) {
      const s = this.text || (Array.isArray(this.runs) ? this.runs.map(r => r.text || '').join('') : String(this));
      return String(s).split(...args);
    },
    configurable: true,
    writable: true
  });
}
if (!Object.prototype.replace) {
  Object.defineProperty(Object.prototype, 'replace', {
    value: function(...args) {
      const s = this.text || (Array.isArray(this.runs) ? this.runs.map(r => r.text || '').join('') : String(this));
      return String(s).replace(...args);
    },
    configurable: true,
    writable: true
  });
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 5050;

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Authorization']
}));

app.use(express.json());

// Request logger
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - t0}ms)`);
  });
  next();
});

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'SpotiFree Server', version: '1.0.0' });
});

// Direct APK download route for mobile installation
const apkCandidates = [
  path.join(__dirname, '../../client/android/app/build/outputs/apk/debug/app-debug.apk'),
  path.join(__dirname, '../../SpotiFree.apk'),
  'C:\\Users\\elyas\\Downloads\\SpotiFree.apk'
];

app.get(['/spotifree.apk', '/download/apk', '/app.apk'], (req, res) => {
  for (const p of apkCandidates) {
    if (fs.existsSync(p)) {
      return res.download(p, 'SpotiFree.apk');
    }
  }
  res.status(404).send('APK not found. Please build the Android app first.');
});

// Serve production client build directly without dev proxy overhead
const distPath = path.join(__dirname, '../../client/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const { initTunnelSupervisor } = require('./services/tunnelSupervisor');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 SpotiFree Unified Server running on http://localhost:${PORT}`);
  console.log(`🌐 Available on your local network on port ${PORT}`);
  initTunnelSupervisor();
});
