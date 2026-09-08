FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

COPY app ./app

# Run as an unprivileged user. The uid is fixed rather than auto-assigned so
# the data volume's ownership stays predictable across rebuilds.
#
# A FRESH named volume inherits the ownership of /data from this image. An
# EXISTING volume does not — it stays root-owned, and the backend then fails
# with "attempt to write a readonly database". One-time fix on the host,
# before the first deploy of this image:
#
#   docker run --rm -v infrastructure_rxf-rmm-data:/data alpine \
#     sh -c 'chown -R 10001:10001 /data && ls -lan /data'
#
# Two traps, both hit in practice:
#   * The volume is NOT called rxf-rmm-data. Compose prefixes volume names
#     with the project, so the real name is infrastructure_rxf-rmm-data.
#     `-v rxf-rmm-data:/data` quietly creates a NEW empty volume and chowns
#     that, leaving the real one untouched. Check with
#     `docker volume ls --filter name=rxf-rmm-data`.
#   * Do NOT route this through `docker compose run`: that inherits the
#     service's `cap_drop: ALL`, and chown then fails with "Operation not
#     permitted" even as uid 0. A plain `docker run` keeps the default
#     capabilities.
#
# See docs/OPERATIONS.md.
RUN useradd --system --uid 10001 --create-home --home-dir /home/rmm rmm \
    && mkdir -p /data \
    && chown -R 10001:10001 /data /app
USER 10001:10001

EXPOSE 8080
# Deliberately WITHOUT --proxy-headers.
#
# `--forwarded-allow-ips "*"` told uvicorn to trust X-Forwarded-* from any
# peer, so request.client was whatever the caller claimed. That is the value
# the login rate limiter falls back to when TRUST_PROXY_HEADERS is off — the
# fail-safe default was therefore not safe: anyone able to reach the container
# could pick a fresh "IP" per attempt.
#
# The application reads the proxy headers itself, gated by
# TRUST_PROXY_HEADERS, and Caddy strips them for every peer outside
# TRUSTED_PROXY_CIDR. Letting uvicorn rewrite request.client on top of that
# only removes the honest fallback.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
