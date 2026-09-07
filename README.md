# Vulpexa — rmm.rxf-sys.de

Schlankes, selbst gehostetes RMM-Tool (Remote Monitoring & Management) für
eigene Server, den eigenen PC und die Geräte der Familie. Vorbild
Atera/NinjaOne — reduziert auf das, was 5–15 Geräte wirklich brauchen.

> **Vulpexa** ist der Produktname (Dashboard-Branding, API-Titel, TOTP-Issuer);
> `rmm.rxf-sys.de` ist die Domain dieser Installation.

## Was es kann

| Bereich | Umfang |
|---|---|
| Monitoring | Heartbeat alle 60 s, CPU/RAM/Disk, Netzdurchsatz, Temperatur, Akku, angemeldeter Benutzer, Reboot-Pending |
| Historie | Rohdaten 48 h, Stunden-Rollup 30 Tage, Verlaufschart pro Gerät |
| Inventar | Hardware, NICs/MACs, installierte Software (fleetweite Suche) |
| Alarme | Offline, Disk voll (mit Hysterese), überfällige Sicherheitsupdates → ntfy-Push |
| Fernsteuerung | Ad-hoc-Shell und Skript-Bibliothek mit Live-Output, Wake-on-LAN |
| Patches | Scan + Installation für apt, Windows Update (COM-API), `softwareupdate` |
| Remote Desktop | self-hosted RustDesk, Deep-Link aus dem Dashboard |
| Passwörter | Pro Gerät, Fernet-verschlüsselt, jeder Zugriff im Audit-Log |
| Automatisierung | Wöchentliches Patch-Fenster, geplante Skripte, Alarmregeln pro Tag/Person |
| Betrieb | Audit-Log, Rollen (admin/techniker/viewer), TOTP, signiertes Agent-Auto-Update |

## Für wen

Selbsthoster mit Linux- und Docker-Grundkenntnissen, die eine überschaubare
Gerätezahl betreuen — typischerweise die eigene Infrastruktur plus Familie.
Kein Multi-Tenant-SaaS: eine Installation, eine Flotte.

Für die betreuten Personen selbst ist nichts zu tun außer einer einmaligen
Installation; sie können optional einen `viewer`-Zugang bekommen, der
ausschließlich ihre eigenen Geräte zeigt.

## Architektur

```
├── backend/          # FastAPI (Python 3.11+) — REST-API + Agent-WSS + SQLite
├── frontend/         # Vite + React + TypeScript — Dashboard
├── agent/            # Go — eine statische Binary für Windows/Linux/macOS
├── infrastructure/   # docker-compose, LXC-Bootstrap, Deploy-/Backup-Skripte
└── docs/             # Architektur, Konfiguration, API, Betrieb, Sicherheit
```

Alle Agents verbinden sich **ausgehend** per WebSocket (`wss://…/api/agent/ws`)
mit dem Server — verwaltete Geräte brauchen keine offenen Ports und keine
feste IP. Befehle laufen über denselben offenen Socket zurück.

Details, Datenfluss und Datenmodell: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quickstart (lokale Entwicklung)

Voraussetzungen: Python ≥ 3.11, Node ≥ 22, Go ≥ 1.25.

```bash
# Backend auf http://127.0.0.1:8080
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
APP_ENV=development AUTH_ENABLED=false STORAGE_DB_PATH=./dev.db \
  uvicorn app.main:app --reload --port 8080
```

`APP_ENV=development` schaltet die interaktive API-Doku unter
<http://127.0.0.1:8080/api/docs> frei — in Produktion ist sie bewusst aus.
`AUTH_ENABLED=false` macht jeden Request zu einem Admin-Request; **nur** für
lokale Entwicklung.

```bash
# Dashboard auf http://127.0.0.1:5173, /api wird auf :8080 geproxyt
cd frontend && npm ci && npm run dev
```

```bash
# Agent bauen und lokal gegen den Dev-Server enrollen
cd agent && make build && ./rmm-agent version
```

### Checks

```bash
cd backend  && ruff check . && pytest -v --cov=app --cov-fail-under=70
cd frontend && npm run build   # tsc -b (strict) + vite build
cd agent    && make vet test
```

Genau diese Kommandos laufen auch in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Konfiguration

Alle Einstellungen kommen aus Umgebungsvariablen; `infrastructure/.env.example`
ist die versionierte Vorlage, `infrastructure/.env` die reale Datei (nie
committen). Die vollständige Tabelle — Name, Zweck, Default, Pflicht,
Security-Relevanz — steht in [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

Das absolute Minimum für einen Start:

| Variable | Warum |
|---|---|
| `BOOTSTRAP_ADMIN_PASSWORD` | Ohne sie wird kein Admin angelegt und niemand kann sich einloggen |
| `CORS_ORIGINS` | Muss die eigene Dashboard-URL enthalten |
| `TRUSTED_PROXY_CIDR` | IP des Reverse Proxy; sonst greift das Login-Rate-Limit ins Leere |

## Agent-Rollout

Im Dashboard **Gerät hinzufügen** → Einmal-Token erzeugen. Der Dialog zeigt
den fertigen Einzeiler pro Plattform; er lädt die Binary token-authentifiziert
vom Server, enrollt sie und installiert den Dienst:

```bash
# Linux/macOS, auf dem Zielgerät, als root
curl -fsSL -H 'X-Enroll-Token: <TOKEN>' 'https://rmm.rxf-sys.de/api/agent/setup/linux' | sudo bash
```

Manuell, wenn die Binary bereits lokal liegt:

```bash
sudo rmm-agent enroll -server https://rmm.rxf-sys.de -token <TOKEN> -label "Mama"
sudo rmm-agent install && sudo rmm-agent start
```

Die Agent-Konfiguration liegt unter `/etc/rxf-rmm/agent.json` (Unix) bzw.
`%ProgramData%\rxf-rmm\agent.json` (Windows), Verzeichnis 0700, Datei 0600.

## Deployment

Zielumgebung: Proxmox LXC CT 111 (`192.168.2.211`), Docker Compose,
Cloudflare Tunnel `rmm.rxf-sys.de → http://192.168.2.211:80` (cloudflared läuft
auf CT 104). WebSockets laufen durch den Tunnel; nur RustDesk braucht eigene
Portfreigaben.

```bash
# Einmalig, vom Proxmox-Host: LXC anlegen, Docker installieren, Repo klonen
bash infrastructure/setup-lxc.sh

# Deploy im LXC (Fetch + Rebuild + Health-Gate)
bash /opt/rxf-rmm/infrastructure/deploy.sh
```

CD läuft über [`.github/workflows/cd.yml`](.github/workflows/cd.yml): nach
grünem CI auf `main` startet ein **Self-hosted Runner im LXC** (Label `rmm`)
genau dieses `deploy.sh`. Es gibt keine SSH-Secrets in GitHub.

Vollständige Schritt-für-Schritt-Anleitung inkl. RustDesk, Backup und
Familien-Rollout: [`infrastructure/DEPLOYMENT.md`](infrastructure/DEPLOYMENT.md).
Laufender Betrieb (Backup/Restore, Update, Rollback, Health):
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Troubleshooting

Die häufigen Fehlerbilder — Agent verbindet nicht, WSS durch den Tunnel,
fehlende RustDesk-ID, fehlschlagender Patch-Scan, Login-Rate-Limit — sind
in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) mit Diagnosekommandos
beschrieben.

Schnellster erster Blick:

```bash
docker compose -f /opt/rxf-rmm/infrastructure/docker-compose.yml ps
docker compose -f /opt/rxf-rmm/infrastructure/docker-compose.yml logs --tail 100 backend
curl -fsS https://rmm.rxf-sys.de/api/health
```

## Sicherheit

- Dashboard-Auth: Argon2id, httpOnly-Session-Cookie, optional TOTP,
  Brute-Force-Throttle pro IP.
- Geräte-Credentials: Einmal-Enrollment-Token → `device_id` + `device_secret`
  (nur als SHA-256-Hash gespeichert). Ein Agent kann ausschließlich eigene
  Daten melden.
- Agent-Auto-Update: ed25519-signiertes Manifest, der Agent prüft Signatur und
  SHA-256 gegen einen zur Build-Zeit eingebrannten Public Key.
- Passwort-Tresor: Fernet-verschlüsselt, Schlüssel neben der DB mit Rechten
  0600; jeder Reveal landet im Audit-Log.

Bedrohungsmodell, Secrets-Handling, Key-Rotation und Meldeweg:
[`SECURITY.md`](SECURITY.md).

## Mitarbeit

[`CONTRIBUTING.md`](CONTRIBUTING.md) beschreibt Setup, Konventionen und die
Checks, die vor einem PR grün sein müssen. Änderungen werden in
[`CHANGELOG.md`](CHANGELOG.md) festgehalten.

## Lizenz

Apache License 2.0 — siehe [`LICENSE`](LICENSE).
