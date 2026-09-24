# Stage 1: Build Client (Vite)
FROM node:18-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Production Unified Server (Node + Python yt-dlp)
FROM node:18-slim
WORKDIR /app

# Install Python 3, pip, ffmpeg, and certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    ca-certificates \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno (official JS runtime for yt-dlp signature solving)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

# Install latest yt-dlp
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp || pip3 install --no-cache-dir yt-dlp

# Pre-fetch and cache yt-dlp EJS challenge solver
RUN python3 -m yt_dlp --remote-components ejs:github --version || true

# Install server dependencies
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --production

# Copy server source
COPY server/ ./

# Copy compiled frontend from Stage 1
COPY --from=client-builder /app/client/dist /app/client/dist

# Environment configuration
EXPOSE 5050
ENV PORT=5050
ENV NODE_ENV=production
ENV PYTHON_BIN=python3

# Start unified SpotiFree server
CMD ["node", "src/index.js"]
