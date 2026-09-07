# rmm.rxf-sys.de — Projektkonventionen

Vulpexa: schlankes, selbst gehostetes RMM-Tool. Backend (FastAPI + SQLite) +
Dashboard (Vite/React/TS) + Go-Agent (eine statische Binary für
Windows/Linux/macOS) + Infrastruktur (LXC, Compose, Cloudflare Tunnel,
RustDesk).

Alle acht ursprünglichen Phasen sind abgeschlossen. Maßgeblich sind:
`docs/ARCHITECTURE.md` (Architektur, Datenmodell), `docs/API.md`
(Endpunkte, WS-Protokoll), `docs/CONFIGURATION.md` (alle ENV-Variablen),
`docs/OPERATIONS.md` (Betrieb), `docs/ROADMAP.md` (was offen ist). Der
ursprüngliche Phasenplan liegt archiviert unter `docs/_archiv/RMM-PLAN.md`.

## Architektur-Grundsätze

- **Agents verbinden sich ausgehend** (WSS → `/api/agent/ws`); der Server
  schickt Befehle über den offenen Socket zurück. Geräte brauchen nie
  offene Ports.
- **Geräte-Credentials**: Einmal-Enrollment-Token → `device_id` +
  `device_secret` (nur als SHA-256-Hash in der DB). Agents können
  ausschließlich eigene Daten melden — niemals andere Geräte oder den Server
  steuern.
- **Dashboard-Auth**: Argon2id, httpOnly-Session-Cookie (`rmm_session`),
  optional TOTP mit Backup-Codes, Brute-Force-Throttle,
  Bootstrap-Admin via `BOOTSTRAP_ADMIN_USER`/`BOOTSTRAP_ADMIN_PASSWORD`.
- **Drei Rollen**: `admin` (alles), `techniker` (Geräte, Jobs, Patches),
  `viewer` (nur lesend, nur die Geräte der eigenen Person). Rolle **und**
  Datenfilterung — `person_scope`/`device_visible` in `app/auth.py`.
- **SQLite** unter `/data/` (Volume `rxf-rmm-data`), WAL-Mode, kein externer
  DB-Server. Kein Alembic: das Schema wächst additiv über
  `CREATE TABLE IF NOT EXISTS` plus `PRAGMA table_info` → `ALTER TABLE`.
  Es gibt kein Downgrade.
- **Secrets**: Niemals `.env` committen — nur `.env.example` ist versioniert.
  Ebenso wenig `infrastructure/.agent-sign.env`.
- **Jobs und Befehle an Geräte werden immer im Audit-Log erfasst.**

## Kommandos

```bash
# Backend
cd backend && ruff check . && pytest -v --cov=app --cov-fail-under=70

# Frontend (tsc -b strict + vite build ist das CI-Gate)
cd frontend && npm run build

# Agent
cd agent && make vet test && make release   # CGO off, 5 Targets
```

## Lokale Entwicklung

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
APP_ENV=development AUTH_ENABLED=false STORAGE_DB_PATH=./dev.db \
  uvicorn app.main:app --reload --port 8080

cd frontend && npm ci && npm run dev   # proxied /api → :8080
cd agent && make build
```

`APP_ENV=development` schaltet `/api/docs` frei — ohne die Variable greift
der Default `production` und die Doku antwortet lokal mit 404.

## Fallstricke

- **`ruff` ist auf `>=0.16.6,<0.17` gepinnt und der Regelsatz steht explizit
  in `pyproject.toml`.** Beides gehört zusammen: Ruff hat den impliziten
  Default-Satz zwischen Releases erweitert und damit CI ohne Codeänderung rot
  gemacht. Neue Regeln bewusst aufnehmen.
- **`sqlite3.Row.__contains__` prüft Werte, nicht Spaltennamen.** Für
  „Spalte vorhanden?" ist `"col" in row.keys()` richtig; Ruffs
  SIM118-Autofix liegt hier falsch. Deshalb vier begründete
  `# noqa: SIM118` in `devices.py` und `persons.py`.
- **`app/main.py` ist von der Coverage ausgenommen** — neue Logik gehört
  deshalb nicht dorthin.
- **Tests fahren den Lifespan nicht.** `tests/conftest.py` ruft alle
  `ensure_schema()` von Hand auf. Ein neues Modul mit eigenem Schema muss
  dort **und** in `main.py` registriert werden, sonst: „no such table".
- **`AUTH_ENABLED=false` verdeckt Autorisierungsfehler** — alles mit
  Rollenbezug gegen laufende Auth testen.
- **Der Fleet-WebSocket überträgt keine Nutzdaten**, nur
  `{"type":"refresh"}`. Das hält die Autorisierung vollständig in der
  REST-Schicht; bitte keine Daten durchschieben.
- **Lokal gebaute Agents (`make build`) haben keinen eingebrannten Public
  Key** und lehnen deshalb jedes Update ab. Das ist kein Fehler.
- **`make sign` scheitert absichtlich hart**, wenn nicht beide Schlüssel
  gesetzt sind — ein signiertes Release ohne passenden Verifikationsschlüssel
  soll nicht entstehen können.

## Deployment

Proxmox LXC CT 111 (`192.168.2.211`), Docker Compose, Cloudflare Tunnel
`rmm.rxf-sys.de → 192.168.2.211:80` (cloudflared läuft auf CT 104).
CD über einen **Self-hosted Runner im LXC** (Label `rmm`), der nach grünem CI
`infrastructure/deploy.sh` startet — keine SSH-Secrets in GitHub.

RustDesk braucht zusätzlich Router-Portfreigaben TCP 21115–21117 /
UDP 21116 — geht nicht durch den Tunnel.
