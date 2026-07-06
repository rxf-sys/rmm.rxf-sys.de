# rmm.rxf-sys.de

Schlankes, selbst gehostetes RMM-Tool (Remote Monitoring & Management) für
eigene Server, den eigenen PC und die Geräte der Familie. Vorbild
Atera/NinjaOne — reduziert auf das, was ~5–15 Geräte wirklich brauchen.

Der vollständige Plan (Architektur, Phasen, Sicherheitsmodell) liegt unter
[`docs/RMM-PLAN.md`](docs/RMM-PLAN.md).

## Komponenten

```
├── backend/          # FastAPI (Python 3.11+) — REST-API + Agent-WSS + SQLite
├── frontend/         # Vite + React + TypeScript — Dashboard
├── agent/            # Go — eine statische Binary für Windows/Linux/macOS
└── infrastructure/   # docker-compose, LXC-Bootstrap, Deploy-Script
```

Alle Agents verbinden sich **ausgehend** per WebSocket mit dem Server —
verwaltete Geräte brauchen keine offenen Ports.

## Lokale Entwicklung

```bash
# Backend (http://127.0.0.1:8080)
cd backend && pip install -e ".[dev]"
AUTH_ENABLED=false STORAGE_DB_PATH=./dev.db uvicorn app.main:app --reload --port 8080

# Frontend (http://127.0.0.1:5173, proxied /api → :8080)
cd frontend && npm ci && npm run dev

# Agent
cd agent && make build && ./rmm-agent version
```

Tests: `cd backend && pytest -v --cov=app --cov-fail-under=70` ·
`cd agent && make vet test` · Frontend: `npm run build`.

## Agent-Rollout (ab Phase 1)

```bash
# Im Dashboard: Gerät hinzufügen → Einmal-Token erzeugen, dann auf dem Gerät:
rmm-agent enroll -server https://rmm.rxf-sys.de -token <TOKEN> -label "Mama"
sudo rmm-agent install && sudo rmm-agent start
```

Konfiguration liegt unter `/etc/rxf-rmm/agent.json` (Unix) bzw.
`%ProgramData%\rxf-rmm\agent.json` (Windows), Rechte 0600.

## Deployment (Proxmox LXC CT 111, 192.168.2.211)

```bash
# Einmalig: LXC aufsetzen (vom Proxmox Host)
bash infrastructure/setup-lxc.sh

# Manueller Deploy (im LXC)
bash /opt/rxf-rmm/infrastructure/deploy.sh
```

Automatisierter CD via `.github/workflows/cd.yml` — nach jedem grünen CI auf
`main` deployt GitHub Actions per SSH (Secrets `DEPLOY_HOST`/`DEPLOY_USER`/
`DEPLOY_SSH_KEY`). Cloudflare Tunnel (cloudflared auf CT 104):
`rmm.rxf-sys.de → http://192.168.2.211:80`. WebSockets laufen durch den
Tunnel; nur RustDesk braucht eigene Portfreigaben.

**Vollständige Schritt-für-Schritt-Anleitung inkl. RustDesk, Backup und
Familien-Rollout: [`infrastructure/DEPLOYMENT.md`](infrastructure/DEPLOYMENT.md).**

## Phasenstand

- [x] **Phase 0** — Fundament: Auth (Argon2id + Session-Cookies, Bootstrap-Admin),
      Geräte-Schema, Dashboard-Skeleton mit Login + Tabs, Agent-Skeleton
      (Dienst-Installation, WSS-Reconnect, Heartbeat-Metriken, Enroll-Client), CI
- [x] **Phase 1** — Enrollment (Einmal-Token → Geräte-Credentials), Agent-WSS
      `/api/agent/ws` + ConnectionManager, Heartbeat + Hardware-/Software-Inventar,
      Geräteliste live mit Detailseite (Metriken, Inventar, umbenennen/taggen/löschen)
- [x] **Phase 2** — Metrik-Historie (Raw 48 h → Stunden-Rollup 30 Tage) mit
      Verlaufschart, Alert-Engine (offline / Disk voll, mit Hysterese und
      Resolved-Erkennung) + ntfy-Push, Ampel-Übersichtsseite
- [x] **Phase 3** — Job-Engine mit Live-Output (Agent → Server → Browser via
      WebSocket), Ad-hoc-Remote-Shell + Skript-Bibliothek (bash/zsh/powershell),
      persistenter Audit-Log
- [x] **Phase 4** — Patch-Management: Scan + Installation pro OS (apt / Windows
      Update COM-API / softwareupdate), Patch-Panel pro Gerät + flottenweite
      Übersicht, Alarm bei überfälligen Sicherheitsupdates
- [x] **Phase 5** — Remote Desktop: self-hosted RustDesk (hbbs/hbbr im Compose),
      Agent meldet RustDesk-ID, Remote-Panel mit Deploy-Kommando + Deep-Link-
      Sitzung (`rustdesk://`), Doku in infrastructure/RUSTDESK.md
- [x] **Phase 6** — Installer pro OS (install.sh / install.ps1), ed25519-
      signiertes Agent-Auto-Update (Server bietet an, Agent prüft Signatur +
      SHA-256, ersetzt sich atomar), Signing-Toolchain (make keygen/sign)
- [x] **Phase 7** — Deployment: setup-lxc.sh (CT 111), CD-Pipeline (Auto-Deploy
      per SSH nach grünem CI), deploy.sh mit Health-Gate, tägliches Backup,
      vollständige Rollout-Anleitung infrastructure/DEPLOYMENT.md
