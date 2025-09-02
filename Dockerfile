# --- Build React client ---
FROM node:20-slim AS client-build
WORKDIR /app/client

# Install client deps
COPY client/package.json client/vite.config.js ./
RUN npm install --no-audit --no-fund

# Build client
COPY client/index.html ./index.html
COPY client/src ./src
RUN npm run build


# --- Install server deps (with native builds) ---
FROM node:20-slim AS server-build
WORKDIR /app

# Build tools for native modules (bcrypt, hnswlib-node)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Use npm install (not ci) so the lock can be regenerated in-image
RUN npm install --omit=dev --no-audit --no-fund


# --- Runtime image ---
FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# Copy server node_modules from build stage
COPY --from=server-build /app/node_modules ./node_modules

# Copy server source
COPY index.js ./
COPY cron.js ./
COPY utils.js ./
COPY services ./services
COPY db ./db
COPY public ./public
COPY views ./views

# Copy built client
COPY --from=client-build /app/client/dist ./client/dist

# Default runtime env
ENV PORT=3000 \
    USE_REACT=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1

CMD ["node", "index.js"]
