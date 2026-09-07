FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

COPY app ./app

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
