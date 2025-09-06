# --- Build React client (bookworm, patched) ---
FROM node:20.18.0-bookworm-slim AS client-build
WORKDIR /app/client
RUN apt-get update && apt-get -y upgrade && rm -rf /var/lib/apt/lists/*

# Install client deps
COPY client/package.json client/vite.config.js ./
RUN npm install --no-audit --no-fund

# Build client
COPY client/index.html ./index.html
COPY client/src ./src
RUN npm run build


# --- Install server deps (with native builds) ---
FROM node:20.18.0-bookworm-slim AS server-build
WORKDIR /app

# Toolchain for native modules (e.g., bcrypt)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && apt-get -y upgrade \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Option 2 (fast, tolerant to lock drift) – skip lifecycle scripts:
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts


# --- Runtime image (Distroless, non-root) ---
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runner
ENV NODE_ENV=production
WORKDIR /app

# Copy server node_modules from build stage
COPY --from=server-build /app/node_modules ./node_modules

# Copy server source
COPY index.js ./index.js
COPY utils.js ./utils.js
COPY utils ./utils
COPY services ./services
COPY db ./db
COPY public ./public
COPY views ./views
COPY validation ./validation


# Copy built client
COPY --from=client-build /app/client/dist ./client/dist

# Default runtime env
ENV PORT=3000 \
    USE_REACT=true

EXPOSE 3000

# Exec-form healthcheck (no shell in distroless)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["index.js"]
