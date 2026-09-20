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

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'SpotiFree Server', version: '1.0.0' });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 SpotiFree Unified Server running on http://localhost:${PORT}`);
  console.log(`🌐 Available on your local network on port ${PORT}`);
});
