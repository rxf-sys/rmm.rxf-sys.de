# --- Build stage ---
# Node-Major bewusst auf einer LTS-Linie (24 = "Krypton"). Er muss mit
# `node-version` in .github/workflows/ci.yml übereinstimmen: sonst baut CI
# gegen eine andere Laufzeit als das Image, und ein Fehler zeigt sich erst
# beim Deploy. Dependabot kann das nicht sicherstellen — es sieht nur diese
# Datei —, deshalb ist der Major-Bump dort ignoriert und wird von Hand
# gemacht.
FROM node:24-alpine AS build
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

# Caddy's state and config directories must be writable by the unprivileged
# user, so the container does not have to run as root.
#
# The base image declares `VOLUME /data` and `VOLUME /config` and points
# XDG_DATA_HOME/XDG_CONFIG_HOME at them. Docker discards whatever a later build
# step writes below a volume path inherited from a parent image, so a `chown`
# on those two paths is silently a no-op: at runtime Docker materialises the
# anonymous volumes from the image content — root-owned — and Caddy as uid
# 10001 cannot write there. Point the XDG directories at a path this image
# actually owns instead.
#
# Caddy listens on 8080 inside the container, not 80: binding a privileged port
# as a non-root user depends on the host's ip_unprivileged_port_start, which is
# not this repo's to assume. Compose maps host 80 -> container 8080.
ENV XDG_CONFIG_HOME=/caddyhome/config \
    XDG_DATA_HOME=/caddyhome/data
RUN adduser -S -u 10001 -D caddyrun \
    && mkdir -p /caddyhome/config/caddy /caddyhome/data/caddy \
    && chown -R 10001 /caddyhome /srv
USER 10001

EXPOSE 8080
