const express = require('express');
const cors = require('cors');
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 SpotiFree Backend running on http://localhost:${PORT}`);
  console.log(`🌐 Available on your local network on port ${PORT}`);
});
