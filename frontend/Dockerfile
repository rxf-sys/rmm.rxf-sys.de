# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app
# npm ci against the committed lockfile keeps builds reproducible.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- Serve stage (static via Caddy, proxies /api to backend) ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
