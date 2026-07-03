# rmm.rxf-sys.de

Schlankes selbst gehostetes RMM-Tool. Server (FastAPI + SQLite) + Dashboard
(Vite/React/TS) + Go-Agent (eine statische Binary für Windows/Linux/macOS).
Architektur- und Phasenplan: `docs/RMM-PLAN.md`.

## Architektur-Grundsätze

- **Agents verbinden sich ausgehend** (WSS → `/api/agent/ws`); der Server
  schickt Befehle über den offenen Socket zurück. Geräte brauchen nie
  offene Ports.
- **Geräte-Credentials**: Einmal-Enrollment-Token → `device_id` +
  `device_secret` (nur als Hash in der DB). Agents können ausschließlich
  eigene Daten melden — niemals andere Geräte oder den Server steuern.
- **Dashboard-Auth** wie admin.rxf-sys.de: Argon2id, httpOnly-Session-Cookie
  (`rmm_session`), Brute-Force-Throttle, Bootstrap-Admin via
  `BOOTSTRAP_ADMIN_USER`/`BOOTSTRAP_ADMIN_PASSWORD`.
- **SQLite** unter `/data/` (Volume `rxf-rmm-data`), WAL-Mode, kein externer
  DB-Server.
- **Secrets**: Niemals `.env` committen — nur `.env.example` ist versioniert.

## Konventionen

- Backend: FastAPI, structlog, Tests mit `pytest -v --cov=app --cov-fail-under=70`
- Agent: Go, CGO off, Cross-Compile via `agent/Makefile` (`make release`),
  `go vet ./...` + `go test ./...` müssen sauber sein
- Frontend: `npm run build` (tsc strict + vite) ist der CI-Gate
- Jobs/Befehle an Geräte werden IMMER im Audit-Log erfasst (ab Phase 3)

## Lokale Entwicklung

```bash
cd backend && pip install -e ".[dev]"
AUTH_ENABLED=false STORAGE_DB_PATH=./dev.db uvicorn app.main:app --reload --port 8080
cd frontend && npm ci && npm run dev   # proxied /api → :8080
cd agent && make build
```

## Deployment

Proxmox LXC CT 111 (`192.168.2.211`), Docker Compose, Cloudflare Tunnel
`rmm.rxf-sys.de → 192.168.2.211:80` (cloudflared läuft auf CT 104).
RustDesk (Phase 5) braucht zusätzlich Router-Portfreigaben
TCP 21115–21117 / UDP 21116 — geht nicht durch den Tunnel.
