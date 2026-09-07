# RMM-Tool für rxf-sys.de — Plan von Anfang bis Ende

> **Archiviert am 07.09.2026.** Dieses Dokument beschreibt die Planung vor
> der Umsetzung; alle acht Phasen sind inzwischen abgeschlossen. Es bleibt als
> Entscheidungsdokumentation erhalten — für den aktuellen Stand gelten
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (Architektur und Datenmodell),
> [`../API.md`](../API.md) (Endpunkte und WS-Protokoll) und
> [`../ROADMAP.md`](../ROADMAP.md) (was noch offen ist).
>
> Die Liste unter „Roadmap nach v1" ist teilweise überholt: die `viewer`-Rolle
> und Wake-on-LAN sind umgesetzt.

Ein schlankes, selbst gehostetes RMM-Tool ("Remote Monitoring & Management") für
den Eigenbedarf: eigene Server, eigener PC, Geräte der Familie. Vorbild sind
Atera/NinjaOne — aber bewusst auf das reduziert, was ein Haushalt mit ~5–15
Geräten wirklich braucht.

**Getroffene Grundsatzentscheidungen** (abgestimmt am 2026-07-03):

| Entscheidung | Ergebnis |
|---|---|
| Ansatz | Eigenbau (Server + Agent), Remote Desktop über bestehende OSS |
| Agent-Plattformen | Windows, Linux, macOS |
| Funktionsumfang | Monitoring + Inventar, Remote-Shell + Skripte, Patch-Management, Remote Desktop |
| Projektform | Eigenes Repo + eigene Subdomain (`rmm.rxf-sys.de`), getrennt vom Admin-Dashboard |

---

## 1. Zielbild

Nach Abschluss aller Phasen existiert:

- **`rmm.rxf-sys.de`** — Web-Dashboard hinter Cloudflare Tunnel, Login mit
  derselben Auth-Philosophie wie das Admin-Dashboard (Argon2id, Session-Cookie,
  RBAC).
- **Ein Agent** (eine einzige Binary pro OS) auf jedem verwalteten Gerät, der
  sich **ausgehend** per WebSocket mit dem Server verbindet. Kein Gerät braucht
  offene Ports oder Portfreigaben — wichtig für Familien-Laptops in fremden
  Netzen.
- Pro Gerät sichtbar: Online-Status, Hardware/OS-Inventar, installierte
  Software, Live-Metriken (CPU/RAM/Disk), ausstehende Updates.
- Pro Gerät ausführbar: Ad-hoc-Befehle, Skripte aus einer Bibliothek,
  Update-Installation, Remote-Desktop-Sitzung (via RustDesk).
- Alerts (Gerät offline, Disk voll, Updates überfällig) via **ntfy** — wie
  bereits im Admin-Dashboard etabliert.

### Bewusst NICHT im Scope

Das hier ist die wichtigste Liste, damit das Projekt fertig wird:

- Kein Multi-Tenant / Mandantenfähigkeit (ein "Kunde": du)
- Kein Ticketing, keine Abrechnung, kein PSA
- Kein Mobile-Device-Management (Android/iOS)
- Kein SNMP / Netzwerkgeräte-Monitoring (macht dein Admin-Dashboard via UniFi)
- Kein eigenes Remote-Desktop-Protokoll (das übernimmt RustDesk)
- Keine Softwareverteilung à la Chocolatey-Repos (Skripte reichen dafür)

---

## 2. Architektur

```
                         Internet
                            │
              ┌─────────────┴──────────────┐
              │                            │
   Cloudflare Tunnel              Portfreigabe am Router
   (rmm.rxf-sys.de)              (nur für RustDesk-Relay)
              │                            │
   ┌──────────▼──────────────────────────────────────────┐
   │  Proxmox LXC CT 111 (rmm, 192.168.2.211)            │
   │                                                     │
   │  docker compose:                                    │
   │  ┌───────────────┐  ┌──────────────┐  ┌──────────┐  │
   │  │ web (Caddy +  │  │ backend      │  │ rustdesk │  │
   │  │ React-Build)  │──│ FastAPI      │  │ hbbs+hbbr│  │
   │  │ :80           │  │ REST + WSS   │  │ :21115-9 │  │
   │  └───────────────┘  │ SQLite /data │  └──────────┘  │
   │                     └──────▲───────┘                │
   └────────────────────────────┼────────────────────────┘
                                │ ausgehende WSS-Verbindung
        ┌───────────────┬───────┴────────┬───────────────┐
   ┌────▼─────┐   ┌─────▼────┐   ┌───────▼──┐   ┌────────▼─┐
   │ Server 1 │   │ Dein PC  │   │ Laptop   │   │ MacBook  │
   │ (Linux)  │   │ (Windows)│   │ Mama     │   │ (macOS)  │
   │ Agent    │   │ Agent    │   │ Agent    │   │ Agent    │
   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

**Kernprinzip:** Alle Agents verbinden sich *ausgehend* zum Server
(`wss://rmm.rxf-sys.de/api/agent/ws`). Der Server hält die Verbindungen offen
und schickt Befehle über den bestehenden Socket zurück. Damit funktioniert
alles hinter NAT, CGNAT, Hotel-WLAN etc. — und Cloudflare Tunnel kann bleiben,
weil WebSockets darüber problemlos laufen.

### 2.1 Technologie-Entscheidungen

| Komponente | Wahl | Begründung |
|---|---|---|
| **Server-Backend** | FastAPI (Python 3.11+) + SQLite | Exakt dein bestehender Stack — Auth-Code, structlog-Setup, ntfy-Anbindung und Test-Infrastruktur lassen sich aus `admin.rxf-sys.de` kopieren. FastAPI kann WebSockets nativ. SQLite reicht für <100 Geräte locker. |
| **Frontend** | Vite + React + TypeScript | Ebenfalls Stack-Wiederverwendung (Komponenten, Tab-Layout, API-Client-Muster). |
| **Agent** | **Go** | Eine statisch gelinkte Binary pro OS, Cross-Compiling aus einem einzigen Codebaum (`GOOS=windows/linux/darwin`), ~10–20 MB, kein Runtime-Dependency-Chaos auf Familien-PCs. `gopsutil` liefert Metriken/Inventar plattformübergreifend, `kardianos/service` installiert denselben Code als Windows-Dienst, systemd-Unit und launchd-Daemon. Python (PyInstaller) wäre auf Fremdgeräten fragil und riesig — Tactical RMM nutzt aus genau diesen Gründen auch einen Go-Agent. |
| **Remote Desktop** | **RustDesk (self-hosted: hbbs + hbbr)** | Beste UX für den "Mama, der Drucker geht nicht"-Fall: performant, E2E-verschlüsselt, unattended access. Läuft als zwei kleine Container mit auf dem RMM-LXC. |
| **Alerting** | ntfy (bestehende Instanz) | Bereits etabliert. |

### 2.2 Der eine Haken: RustDesk braucht offene Ports

Cloudflare Tunnel transportiert nur HTTP(S)/WebSocket. RustDesk-Clients
sprechen rohes TCP/UDP mit dem Relay — das geht **nicht** durch den Tunnel.
Dein Prinzip "kein direkter Port nach außen" bekommt also genau eine Ausnahme:

- **Empfehlung:** Portweiterleitung am Router auf CT 111 — TCP `21115–21117`,
  UDP `21116` (+ optional TCP `21118/21119` für Web-Clients). RustDesk ist
  dafür gebaut: der Relay sieht nur verschlüsselten Verkehr, und mit gesetztem
  Key (`-k <public key>`) akzeptiert er ausschließlich deine eigenen Clients.
  DNS dafür: `rd.rxf-sys.de` als **DNS-only**-Eintrag (grauer Wolke) auf deine
  öffentliche IP, ggf. per DynDNS-Update.
- **Fallback, falls Portfreigabe nicht in Frage kommt:** MeshCentral statt
  RustDesk — läuft komplett über HTTPS/WebSocket und damit durch den Tunnel,
  ist aber spürbar träger und wartungsintensiver. Entscheidung fällt in
  Phase 5; die restliche Architektur ist davon unabhängig.

---

## 3. Datenmodell (SQLite)

```
devices             id, hostname, os, os_version, arch, agent_version,
                    device_secret_hash, owner_label ("Mama", "Server"),
                    tags, created_at, last_seen_at, status
enrollment_tokens   id, token_hash, label, expires_at, used_at
inventory           device_id, kind (hardware|software), payload_json, updated_at
metrics             device_id, ts, cpu_pct, mem_pct, disk_json  (Ring: 30 Tage)
jobs                id, device_id, type (shell|script|patch_scan|patch_install),
                    payload, status (queued|running|done|failed|timeout),
                    exit_code, output, created_by, created_at, finished_at
scripts             id, name, shell (bash|powershell|zsh), content,
                    updated_by, updated_at
patches             device_id, patch_id, title, severity, status
                    (pending|installing|installed|failed), detected_at
alert_rules         id, kind (offline|disk|patch_age|cpu), threshold, device_filter
alerts              id, rule_id, device_id, fired_at, resolved_at, notified
audit_log           ts, account, action, device_id, detail   (append-only)
accounts, sessions  — 1:1 übernommen aus admin.rxf-sys.de
```

Aufbewahrung: Metriken 30 Tage (Aggregation auf Stundenwerte nach 48 h),
Job-Outputs 90 Tage, Audit-Log unbegrenzt.

---

## 4. Agent ⇄ Server-Protokoll

### Enrollment (einmalig pro Gerät)

1. Im Dashboard: „Gerät hinzufügen" → erzeugt Einmal-Token (24 h gültig) und
   zeigt einen fertigen Install-Befehl pro OS an, z. B.
   `.\rmm-agent.exe install --server rmm.rxf-sys.de --token XYZ`.
2. Agent meldet sich per HTTPS mit Token, Hostname und OS-Infos an; Server
   entwertet das Token und gibt eine `device_id` + ein zufälliges
   `device_secret` (nur gehasht gespeichert) zurück.
3. Agent legt beides lokal ab (Windows: `%ProgramData%\rxf-rmm\`, Unix:
   `/etc/rxf-rmm/`, Dateirechte nur root/SYSTEM) und installiert sich als
   Dienst.

### Laufender Betrieb

- Agent hält eine WSS-Verbindung (`Authorization: Bearer <device_id>:<secret>`),
  Reconnect mit Exponential-Backoff + Jitter.
- **Heartbeat** alle 60 s mit Kurz-Metriken (CPU/RAM/Disk) — daraus speist sich
  Online-Status und Metrik-Historie.
- **Inventar** (Hardware, Software-Liste, OS-Details) beim Verbinden und danach
  alle 12 h.
- **Jobs** schickt der Server als JSON-Nachricht über den offenen Socket;
  der Agent streamt stdout/stderr in Chunks zurück (Live-Ausgabe im Dashboard),
  meldet Exit-Code, und erzwingt ein Timeout (Default 10 min).
- Nachrichtenformat: `{"type": "...", "id": "...", "payload": {...}}` mit
  Typen `heartbeat`, `inventory`, `job`, `job_output`, `job_result`,
  `patch_report`, `agent_update`.

### Patch-Erkennung/-Installation pro OS

| OS | Scan | Installation |
|---|---|---|
| Windows | Windows Update Agent COM-API (`Microsoft.Update.Session` via PowerShell) | dito, `IUpdateInstaller`; Reboot nur nach Bestätigung im Dashboard |
| Linux (Debian-basiert) | `apt-get -s dist-upgrade` / `apt list --upgradable` | `apt-get install -y --only-upgrade <pkgs>` bzw. `unattended-upgrade` |
| macOS | `softwareupdate -l` | `softwareupdate -i` (OS-Updates brauchen z. T. Interaktion → nur anzeigen + anstoßen) |

---

## 5. Sicherheit

Ein RMM ist per Definition ein Remote-Root-Zugang auf alle Geräte deiner
Familie — das ist die sicherheitskritischste Komponente deiner gesamten
Infrastruktur. Nicht verhandelbar:

1. **Transport:** ausschließlich `wss://` über Cloudflare (Zertifikat + WAF
   inklusive). Agent verifiziert TLS strikt, kein `InsecureSkipVerify`.
2. **Gerätidentität:** Einmal-Enrollment-Token + pro Gerät ein Secret, nur
   als Argon2id-Hash in der DB. Kompromittiertes Gerät → im Dashboard
   „widerrufen" (Secret invalidieren, Verbindung killen).
3. **Dashboard-Auth:** identisch zu admin.rxf-sys.de (Argon2id, httpOnly-
   Session-Cookie, Brute-Force-Throttle, RBAC). Jobs/Skripte/Patches nur für
   `admin`-Rolle; ggf. später eine `viewer`-Rolle.
4. **Audit-Log append-only:** jeder ausgeführte Befehl mit Account, Gerät,
   Inhalt und Zeitstempel. Bei Familien-Geräten auch eine Fairness-Frage.
5. **Kein Befehl vom Gerät zum Server:** Agents können nur Daten melden und
   Job-Ergebnisse liefern — niemals andere Geräte oder den Server steuern
   (ein gehacktes Familien-Laptop darf nicht lateral eskalieren).
6. **Agent-Updates nur signiert:** Update-Payload wird mit einem privaten
   Schlüssel signiert (z. B. minisign/ed25519), der Agent prüft die Signatur
   vor dem Selbst-Update. Sonst wäre der Update-Kanal ein perfekter Backdoor.
7. **RustDesk:** eigener Server-Key, `MUST_LOGIN`-Äquivalent via Key-Pinning
   (Clients ohne deinen Public Key können den Relay nicht nutzen);
   unattended-Access-Passwörter pro Gerät einzeln, nicht geteilt.

---

## 6. Phasenplan

Aufwände sind ehrlich geschätzt (Feierabend-Projekt-Realität, inkl. Testen und
Fluchen). **Gesamtaufwand: grob 120–140 h.** Jede Phase endet mit etwas
Benutzbarem — nach Phase 2 hast du bereits täglichen Nutzen.

### Phase 0 — Projektfundament (~8 h)

- Neues Repo `rmm.rxf-sys.de` (Struktur wie admin: `backend/`, `frontend/`,
  `agent/`, `infrastructure/`).
- Backend-Skeleton: FastAPI + Auth/Sessions/Audit **aus admin.rxf-sys.de
  kopieren** und auf neues Schema anpassen.
- Frontend-Skeleton: Vite/React/TS, Login, leeres Tab-Layout (ebenfalls
  Copy-Basis admin).
- Agent-Skeleton: Go-Modul, `kardianos/service`-Gerüst, Cross-Compile-Makefile
  (`make agent-windows agent-linux agent-darwin`).
- CI: bestehende `ci.yml` adaptieren + Go-Build/`go vet`/`go test`-Job.
- **Fertig wenn:** CI grün, Login ins leere Dashboard funktioniert, Agent-Binary
  baut für alle drei OS.

### Phase 1 — MVP: Enrollment, Heartbeat, Inventar (~25 h)

- Enrollment-Flow komplett (Token-UI, Registrierung, Secret-Handling).
- WSS-Endpoint + ConnectionManager im Backend (Map `device_id → Socket`).
- Agent: Dienst-Installation, Reconnect-Logik, Heartbeat, Inventar via
  gopsutil (+ OS-spezifisch: installierte Software aus Registry / dpkg /
  `system_profiler`).
- UI: Geräteliste (online/offline, OS-Icon, letzte Meldung), Gerät-Detailseite
  mit Inventar, Gerät umbenennen/taggen/löschen.
- **Fertig wenn:** dein PC + ein Server + ein Testgerät dauerhaft verbunden
  sind und nach Reboot automatisch wiederkommen.

### Phase 2 — Metriken & Alerting (~15 h)

- Metrik-Persistenz + Aggregation, Sparklines/Charts in der Detailseite.
- Alert-Regeln (offline > X min, Disk > Y %, später Patch-Alter) + ntfy-Versand
  + Resolved-Erkennung.
- Dashboard-Startseite: Ampel-Übersicht aller Geräte.
- **Fertig wenn:** du eine ntfy-Push bekommst, wenn ein Server offline geht
  oder eine Platte vollläuft — ab hier ersetzt das Tool erste manuelle Checks.

### Phase 3 — Remote-Shell & Skript-Bibliothek (~20 h)

- Job-Engine (Queue, Timeout, Status-Lifecycle) + Live-Output-Streaming ins UI
  (WebSocket auch Richtung Browser).
- Ad-hoc-Terminal pro Gerät (PowerShell/bash/zsh je nach OS).
- Skript-Bibliothek: CRUD, Ausführen auf 1..n Geräten, Ergebnis-Historie.
  Startbestand: Temp-Cleanup, Neustart, Netzwerk-Diagnose, Drucker-Spooler-Reset.
- Audit-Log-Tab (wie im Admin-Dashboard).
- **Fertig wenn:** „Spooler-Reset auf Mamas Laptop" zwei Klicks ist und im
  Audit-Log steht.

### Phase 4 — Patch-Management (~20 h)

- Agent-Module für die drei OS (siehe Tabelle oben) — Windows ist hier der
  größte Einzelposten.
- Patch-Tab: ausstehende Updates pro Gerät, Severity, „Installieren"-Button,
  geplante Installationsfenster (z. B. „Familie: samstags 03:00"),
  Reboot-Handling mit Bestätigung.
- Alert-Regel „Gerät hat seit > 30 Tagen ausstehende Sicherheitsupdates".
- **Fertig wenn:** du Windows-Updates der Familie zentral siehst und anstoßen
  kannst, ohne jemanden anzurufen.

### Phase 5 — Remote Desktop (RustDesk) (~10 h)

- Entscheidung Portfreigabe (→ RustDesk) vs. strikt tunnel-only (→ MeshCentral);
  Plan geht von RustDesk aus.
- `hbbs`/`hbbr`-Container ins Compose, Key generieren, Router-Freigaben,
  `rd.rxf-sys.de` (DNS-only).
- Agent-Job „RustDesk installieren/konfigurieren" (Client-Deployment mit
  vorkonfiguriertem Server+Key als Skript aus der Bibliothek).
- Dashboard: „Remote-Sitzung"-Button pro Gerät (RustDesk-ID gespeichert,
  `rustdesk://`-Deep-Link).
- **Fertig wenn:** ein Klick im Dashboard eine Remote-Sitzung auf einem
  Familien-PC öffnet.

### Phase 6 — Packaging, Installer, Agent-Auto-Update (~15 h)

- Windows: Install-Skript/MSI (Dienst + Firewall-Regel + ProgramData-Layout).
  **Realität ohne Code-Signing-Zertifikat:** SmartScreen/Defender wird warnen —
  für den Familienkreis okay (du installierst selbst), dokumentieren.
- macOS: ohne Apple-Developer-Account (99 €/Jahr) blockt Gatekeeper die Binary;
  Workaround `xattr -d com.apple.quarantine` dokumentieren oder Account holen.
- Linux: `install.sh` + systemd-Unit, optional .deb.
- Auto-Update: Server bietet Version + signierte Binary an, Agent prüft beim
  Verbinden, ersetzt sich selbst, Dienst-Neustart. (Ohne das wirst du nie
  wieder alle Geräte aktuell bekommen — Pflicht, nicht Kür.)
- **Fertig wenn:** ein neues Agent-Release sich innerhalb von 24 h auf allen
  Geräten selbst verteilt hat.

### Phase 7 — Deployment & Familien-Rollout (~8 h)

- `setup-lxc.sh` adaptieren: CT 111, Hostname `rmm`, `192.168.2.211/24`,
  2 GB RAM (RustDesk-Relay braucht etwas Puffer), Disk 16 GB.
- Cloudflare Tunnel auf CT 104 um `rmm.rxf-sys.de → http://192.168.2.211:80`
  ergänzen; CD-Workflow von admin übernehmen.
- Backup: SQLite-`.backup`-Cron wie beim Admin-Dashboard + RustDesk-Keys
  sichern.
- Rollout in Reihenfolge: eigene Server → eigener PC → 1 Familien-Gerät als
  Pilot → Rest. Kurze „Was ist da installiert und was kann Robin sehen"-Info
  an die Familie (Transparenz!).
- **Fertig wenn:** alle Zielgeräte enrollt sind und eine Woche stabil melden.

---

## 7. Risiken & Stolpersteine (vorab einkalkuliert)

| Risiko | Gegenmaßnahme |
|---|---|
| **Scope Creep** — RMMs sind Featurelisten-Fässer ohne Boden | Not-in-Scope-Liste (Abschnitt 1) ist bindend; neue Ideen erst nach Phase 7 in eine Roadmap |
| Windows-Update-API ist zäh und schlecht dokumentiert | Größter Einzelpuffer liegt in Phase 4; Fallback: nur Anzeigen + `Install-WindowsUpdate` via PSWindowsUpdate-Modul |
| Unsignierte Binaries → Defender/SmartScreen/Gatekeeper-Warnungen | Bekannt & dokumentiert; du installierst persönlich; optional später Signing-Zertifikat |
| Cloudflare trennt idle WebSockets (~100 s ohne Traffic) | Heartbeat 60 s hält die Verbindung aktiv; Reconnect-Logik ist ohnehin Pflicht |
| RustDesk-Ports = Angriffsfläche | Key-Pinning, aktuelle Images, Relay isoliert im Container; Alternative MeshCentral dokumentiert |
| Ein Bug im Auto-Update legt alle Agents lahm | Staged Rollout (erst eigene Geräte), alte Binary bleibt als `.bak` für manuellen Rollback |
| SQLite-Schreiblast durch Metriken | 60-s-Intervall × 15 Geräte ist trivial; WAL-Mode an, Aggregation nach 48 h |

## 8. Roadmap nach v1 (bewusst geparkt)

- `viewer`-Rolle fürs Familien-Mitschauen des eigenen Geräts
- Wake-on-LAN für Geräte im Heimnetz (via Server-Agent als Relais)
- Software-Deployment-Presets (winget/apt/brew-Wrapper-Skripte)
- Read-only-Integration der RMM-Gerätedaten als Tab im Admin-Dashboard
