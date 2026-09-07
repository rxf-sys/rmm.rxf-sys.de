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

# Caddy needs writable state and config directories; hand them to the
# unprivileged user so the container does not run as root.
#
# It listens on 8080 inside the container, not 80: binding a privileged port
# as a non-root user depends on the host's ip_unprivileged_port_start, which
# is not this repo's to assume. Compose maps host 80 -> container 8080.
RUN adduser -S -u 10001 -D caddyrun \
    && mkdir -p /data/caddy /config/caddy \
    && chown -R 10001 /data /config /srv
USER 10001

EXPOSE 8080
