# Deployment & Familien-Rollout

Vollständige Anleitung, um rmm.rxf-sys.de auf Proxmox LXC **CT 111
(192.168.2.211)** produktiv zu nehmen — inklusive Remote Desktop und
Familien-Rollout. Schritte, die nur du am Proxmox-Host / Router / Cloudflare
ausführen kannst, sind mit **[manuell]** markiert.

## Überblick

```
Internet ──► Cloudflare Tunnel (CT 104) ──► http://192.168.2.211:80  (Web/API)
Internet ──► Router-Portfreigabe        ──► 192.168.2.211:21115-21117 (RustDesk)
```

Das Web/API läuft komplett durch den Cloudflare Tunnel (WebSockets inklusive).
Nur RustDesk braucht die direkte Portfreigabe.

---

## 1. LXC aufsetzen [manuell, vom Proxmox-Host]

```bash
# Repo aufs Proxmox-Host holen (oder nur das Skript kopieren)
bash /pfad/zu/rmm.rxf-sys.de/infrastructure/setup-lxc.sh
```

Legt CT 111 an (Debian 12, 2 GB RAM, 16 GB Disk, `192.168.2.211/24`),
installiert Docker, klont das Repo nach `/opt/rxf-rmm` und legt `.env` aus
der Vorlage an.

## 2. Konfiguration [manuell, im LXC]

```bash
pct enter 111
nano /opt/rxf-rmm/infrastructure/.env
```

Mindestens setzen:

| Variable | Wert |
|---|---|
| `BOOTSTRAP_ADMIN_USER` | dein Admin-Login |
| `BOOTSTRAP_ADMIN_PASSWORD` | einmaliges Start-Passwort (nach erstem Login leeren) |
| `NTFY_BASE` / `NTFY_TOPIC` | deine ntfy-Instanz für Alerts (optional) |
| `RUSTDESK_RELAY_HOST` | `rd.rxf-sys.de` |
| `RUSTDESK_KEY` | wird in Schritt 3 ausgelesen |

## 3. Starten + RustDesk-Key [manuell, im LXC]

```bash
cd /opt/rxf-rmm/infrastructure
docker compose up -d --build

# RustDesk erzeugt beim ersten Start ein Schlüsselpaar:
docker exec rxf-rmm-hbbs cat /root/id_ed25519.pub
# -> in .env als RUSTDESK_KEY eintragen, dann Backend neu starten:
docker compose up -d backend
```

## 4. Cloudflare Tunnel [manuell, im cloudflared-LXC CT 104]

Public Hostname hinzufügen: `rmm.rxf-sys.de` → `http://192.168.2.211:80`.

**Kein Cloudflare Access davorschalten** — das RMM bringt seine eigene Auth
mit (Argon2id + Session-Cookies). Eine zweite Auth-Schicht würde nur die
Agent-WebSockets stören.

## 5. Router + DNS für RustDesk [manuell]

Portfreigaben auf `192.168.2.211`: **TCP 21115–21117, UDP 21116**
(+ 21118/21119 nur für Web-Clients). DNS: `rd.rxf-sys.de` als **DNS-only**
(graue Wolke) auf deine öffentliche IP. Vollständig: `RUSTDESK.md`.

## 6. CD-Pipeline [manuell, GitHub]

GitHub → Settings → Secrets and variables → Actions:

| Secret | Wert |
|---|---|
| `DEPLOY_HOST` | `192.168.2.211` oder Cloudflare-Tunnel-SSH-Hostname |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | privater ED25519-Schlüssel (öffentlicher Teil in `~/.ssh/authorized_keys` im LXC) |

Danach deployt jeder grüne CI-Lauf auf `main` automatisch per SSH
(`.github/workflows/cd.yml` → `deploy.sh`). Der Deploy schlägt fehl, wenn der
Backend-Healthcheck nicht grün wird — ein grüner Deploy heißt also, die API
antwortet wirklich.

## 7. Backup [manuell, im LXC]

```bash
ln -sf /opt/rxf-rmm/infrastructure/backup.sh /etc/cron.daily/backup-rxf-rmm
```

Tägliches konsistentes SQLite-Backup nach `/opt/backups/rxf-rmm`, 14 Tage
Rotation, RustDesk-Schlüssel inklusive.

**Restore** (mit `restore.sh` — bitte einmal proben, ein ungetestetes Backup
ist kein Backup):

```bash
# Backend stoppen, DB aus Backup einspielen (alte DB → rmm.db.pre-restore),
# Backend neu starten. Prüft vorher die SQLite-Integrität des Backups.
bash /opt/rxf-rmm/infrastructure/restore.sh /opt/backups/rxf-rmm/rmm-JJJJMMTT-HHMMSS.db
# optional RustDesk-Schlüssel mit-wiederherstellen:
bash restore.sh /opt/backups/.../rmm-….db /opt/backups/.../rustdesk-…
```

Empfehlung: nach dem Aufsetzen einmal ein Backup ziehen, `restore.sh` damit
laufen lassen und sich am Dashboard anmelden — dann weißt du, dass der Weg
funktioniert, bevor du ihn im Ernstfall brauchst.

## 8. Agent-Auto-Update scharfstellen [manuell, Build-Maschine]

Einmalig Schlüssel erzeugen, Public Key in `agent/update.go` pinnen (siehe
`agent/install/README.md`). Pro Release:

```bash
cd agent && make sign VERSION=0.2.0 AGENT_SIGN_KEY=<privkey>
# dist/ nach /opt/rxf-rmm/infrastructure/agent-releases/ auf dem LXC kopieren
docker compose up -d backend   # lädt das neue manifest.json
```

---

## 9. Familien-Rollout

Reihenfolge bewusst konservativ — erst eigene Geräte, dann ein Pilot, dann
der Rest:

1. **Eigene Server** (Linux-LXCs/VMs): enrollen, eine Woche beobachten.
2. **Eigener PC**: enrollen, Remote-Shell + Patch-Scan testen.
3. **Ein Familien-Gerät als Pilot**: kompletter Durchlauf inkl.
   RustDesk-Sitzung.
4. **Rest der Familie**.

Pro Gerät: im Dashboard „Gerät hinzufügen" → Token → Binary + Installer
aufs Gerät → `install.sh`/`install.ps1` (siehe `agent/install/README.md`).

**Transparenz gegenüber der Familie:** kurz erklären, was installiert ist und
was du sehen/tun kannst (Monitoring, Fernwartung mit Zustimmung, Updates).
Das append-only Audit-Log protokolliert jeden Befehl — nicht nur Technik,
auch eine Fairness-Frage.

## Fertig wenn

Alle Zielgeräte sind enrollt, melden sich stabil, du bekommst ntfy-Alerts bei
Problemen, und eine RustDesk-Sitzung lässt sich per Klick öffnen.
