# Multi-stage build for Your Own Personal DJ
# Stage 1: Builder
FROM node:22.12.0-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev

# Copy package files
COPY package*.json ./

# Install dependencies (including electron which is required)
RUN npm ci

# Copy application source
COPY . .

# Stage 2: Runtime
FROM node:22.12.0-alpine

WORKDIR /app

# Install runtime dependencies (audio analysis, metadata parsing)
RUN apk add --no-cache \
    ffmpeg \
    libstdc++ \
    cairo \
    jpeg \
    pango \
    giflib \
    pixman

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy application files
COPY main.js preload.js renderer.js audio-renderer.js audio-analysis-worker.js ./
COPY index.html audio.html styles.css ./
COPY icon.png LICENSE NOTICE ./

# Create directory for library cache and music files
RUN mkdir -p /app/data /app/music

# Set environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV MUSIC_DIR=/app/music

# Expose port for API/web interface
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "main.js"]
