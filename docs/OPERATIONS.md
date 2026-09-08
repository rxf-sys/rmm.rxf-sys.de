# Betrieb

Stand: 07.09.2026. Zielumgebung: Proxmox LXC CT 111 (`192.168.2.211`),
Docker Compose unter `/opt/rxf-rmm/infrastructure`.

Alles hier bezieht sich auf einen laufenden Betrieb. Die einmalige
Einrichtung steht in
[`../infrastructure/DEPLOYMENT.md`](../infrastructure/DEPLOYMENT.md).

> **Testabdeckung dieses Dokuments.** Die SQLite-Mechanik von `backup.sh`
> und `restore.sh` (Online-Backup bei offener Schreibtransaktion,
> `PRAGMA integrity_check`) ist nachgestellt und verifiziert. Die
> Container-Schritte drumherum — `docker exec`, `docker cp`,
> Volume-Austausch — sind **ungetestet in dieser Umgebung**, weil dafür ein
> laufender Docker-Daemon nötig ist. Sie sind gegen die Skripte gelesen, nicht
> ausgeführt. Ein Restore-Probelauf gehört deshalb in die Go-Live-Checkliste.

## Health und Zustand

| Prüfung | Kommando | Erwartung |
|---|---|---|
| Liveness | `curl -fsS https://rmm.rxf-sys.de/api/health` | `{"status":"ok"}` |
| Readiness | `curl -fsS https://rmm.rxf-sys.de/api/ready` | `{"status":"ready","checks":{"database":"ok"}}` |
| Container | `docker compose ps` | alle `Up`, Backend und Web `healthy` |
| Backend-Log | `docker compose logs --tail 100 backend` | keine Tracebacks |
| Agents online | Dashboard → Übersicht | erwartete Gerätezahl |

Die beiden Endpunkte beantworten unterschiedliche Fragen, und das ist Absicht:

- **`/api/health`** sagt nur, dass der Prozess antwortet, und fasst die
  Datenbank bewusst nicht an. Daran hängt der Compose-Healthcheck, also die
  Neustart-Automatik — und ein Neustart repariert keine gesperrte oder kaputte
  Datei. Ein Liveness-Check, der daran scheitert, erzeugt nur eine
  Neustartschleife.
- **`/api/ready`** prüft, ob die Datenbank erreichbar ist und die erwarteten
  Tabellen trägt, und antwortet sonst mit 503. Daran hängt das Deploy-Gate in
  `deploy.sh`: ein Container, der antwortet, aber seine eigene Datenbank nicht
  lesen kann, darf nicht als erfolgreicher Deploy durchgehen.

Für einen noch tieferen Test der Datei selbst:

```bash
docker exec rxf-rmm-backend python -c \
  "import sqlite3; print(sqlite3.connect('/data/rmm.db').execute('PRAGMA integrity_check').fetchone()[0])"
```

## Container-Härtung

Beide Anwendungscontainer laufen als uid 10001, ohne Capabilities
(`cap_drop: ALL`) und mit `no-new-privileges`. Caddy lauscht im Container auf
8080 statt 80, damit dafür keine privilegierte Portbindung nötig ist; Compose
bildet Host-80 darauf ab.

> **Einmalig vor dem ersten Deploy dieser Images.** Ein bereits bestehendes
> Datenvolumen gehört root — der nicht privilegierte Prozess kann darin nicht
> schreiben. Das Backend bricht dann beim Start mit
> `sqlite3.OperationalError: attempt to write a readonly database` ab und
> läuft in eine Neustartschleife; `web` startet mangels gesundem Backend gar
> nicht erst. Vorher auf dem Host:
>
> ```bash
> cd /opt/rxf-rmm/infrastructure
> docker compose down
>
> # Kontrolle: genau ein Treffer, und zwar mit Projektpräfix
> docker volume ls --filter name=rxf-rmm-data
>
> docker run --rm -v infrastructure_rxf-rmm-data:/data alpine \
>   sh -c 'chown -R 10001:10001 /data && ls -lan /data'
>
> docker compose up -d --build
> ```
>
> Die `ls -lan`-Ausgabe zeigt vor dem Start, ob `rmm.db` und
> `credentials.key` jetzt `10001 10001` gehören.
>
> **Zwei Fallen, beide real aufgetreten:**
>
> 1. **Das Volume heißt nicht `rxf-rmm-data`.** Compose stellt Volume- und
>    Netzwerknamen den Projektnamen voran; weil das Compose-File in
>    `infrastructure/` liegt, heißt es `infrastructure_rxf-rmm-data` — zu
>    sehen auch am Netzwerk `infrastructure_rmm`. Ein
>    `docker run -v rxf-rmm-data:/data …` legt ein **neues, leeres** Volume
>    an und ändert dessen Rechte; das echte bleibt unberührt, und der Fehler
>    sieht danach aus wie vorher.
> 2. **Nicht über `docker compose run` gehen.** Das erbt `cap_drop: ALL` aus
>    der Service-Definition, und `chown` scheitert dann mit
>    „Operation not permitted" — auch als uid 0, weil `CAP_CHOWN` fehlt. Ein
>    einfaches `docker run` behält die Default-Capabilities. Nebenbei ist
>    dabei auch der read-only Bind-Mount `agent-releases` nicht eingehängt,
>    der sonst zusätzliche (harmlose) Fehlermeldungen erzeugt.
>
> Bei einem frisch angelegten Volume entfällt der ganze Schritt: ein neues
> Named Volume übernimmt die Rechte von `/data` aus dem Image.

## Logs

Alle Container loggen nach stdout; es gibt keine Logdateien im Container und
damit auch nichts zu rotieren. Die Rotation macht der Docker-Logging-Treiber
des Hosts. Sinnvolle Obergrenze in `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
```

Nach dem Ändern `systemctl restart docker` — das startet alle Container neu,
also in ein Wartungsfenster legen.

Das Backend loggt strukturiert (structlog). Log-Level über `LOG_LEVEL`,
siehe [`CONFIGURATION.md`](CONFIGURATION.md).

Fachliche Ereignisse — Anmeldungen, Job-Starts, Passwort-Zugriffe,
Enrollments, Alarme — stehen unabhängig davon im Audit-Log in der Datenbank
und überleben einen Container-Neustart. Dashboard → Audit, oder
`GET /api/audit` als Admin.

## Backup

`infrastructure/backup.sh` läuft täglich als Cronjob:

```bash
ln -sf /opt/rxf-rmm/infrastructure/backup.sh /etc/cron.daily/backup-rxf-rmm
```

Gesichert wird nach `${BACKUP_DEST:-/opt/backups/rxf-rmm}`, Rotation nach
`${KEEP_DAYS:-14}` Tagen:

| Datei | Inhalt | Ohne sie |
|---|---|---|
| `rmm-<stamp>.db` | Die komplette Datenbank | nichts geht |
| `credentials-<stamp>.key` | Fernet-Schlüssel des Passwort-Tresors | Die DB ist nutzbar, aber **alle gespeicherten Passwörter sind unentschlüsselbar** |
| `rustdesk-<stamp>/` | RustDesk-Relay-Schlüssel | Alle RustDesk-Clients müssten neu gepinnt werden |

Das Datenbank-Backup nutzt SQLites Online-Backup-API
(`Connection.backup()`), nicht `cp`. Das ist der Unterschied zwischen einem
konsistenten und einem kaputten Backup: Bei aktivem WAL enthält ein
kopiertes `rmm.db` ohne die `-wal`-Datei einen unvollständigen Stand.
Nachgestellt und verifiziert: bei offener Schreibtransaktion liefert das
Online-Backup `integrity_check = ok` und ausschließlich committete Zeilen.

**Ein Backup, das nie zurückgespielt wurde, ist kein Backup.** Prüfen:

```bash
sqlite3 /opt/backups/rxf-rmm/rmm-20260907-030000.db "PRAGMA integrity_check; SELECT COUNT(*) FROM devices;"
```

Liegt kein `sqlite3`-CLI vor, geht dasselbe über den Container:

```bash
docker cp /opt/backups/rxf-rmm/rmm-20260907-030000.db rxf-rmm-backend:/tmp/check.db
docker exec rxf-rmm-backend python -c \
  "import sqlite3; d=sqlite3.connect('/tmp/check.db'); print(d.execute('PRAGMA integrity_check').fetchone()[0]); print(d.execute('SELECT COUNT(*) FROM devices').fetchone()[0])"
docker exec rxf-rmm-backend rm -f /tmp/check.db
```

### Was das Backup nicht enthält

- `infrastructure/.env` — enthält Secrets und liegt nur im LXC. Separat und
  verschlüsselt sichern.
- `infrastructure/.agent-sign.env` — der private ed25519-Signaturschlüssel.
  Verlust bedeutet: alle Agents müssen einmal neu installiert werden, weil
  der eingebrannte Public Key nicht mehr passt.
- Die Agent-Binaries unter `infrastructure/agent-releases/` — jederzeit neu
  baubar, solange der Signaturschlüssel existiert.

## Restore

```bash
# Nur die Datenbank
bash /opt/rxf-rmm/infrastructure/restore.sh /opt/backups/rxf-rmm/rmm-20260907-030000.db

# Mit Passwort-Tresor und RustDesk-Schlüsseln
bash /opt/rxf-rmm/infrastructure/restore.sh \
  /opt/backups/rxf-rmm/rmm-20260907-030000.db \
  /opt/backups/rxf-rmm/credentials-20260907-030000.key \
  /opt/backups/rxf-rmm/rustdesk-20260907-030000
```

Das Skript prüft zuerst `PRAGMA integrity_check` auf dem Backup, stoppt dann
das Backend, sichert die aktuelle Datenbank als `rmm.db.pre-restore`, tauscht
die Datei im Volume (samt Entfernen der `-wal`/`-shm`-Reste) und startet neu.
Der Rückweg ist damit `rmm.db.pre-restore`.

Nach dem Restore:

1. `curl -fsS https://rmm.rxf-sys.de/api/health`
2. Anmelden und die Gerätezahl prüfen.
3. Die Agents kommen von selbst zurück — sie reconnecten mit Backoff bis
   maximal 5 Minuten (`agent/client.go:64-89`).
4. Ein Passwort aus dem Tresor testweise anzeigen. Schlägt das fehl, wurde
   der `credentials.key` nicht mitgestellt.

## Update

Der normale Weg ist CD: Merge auf `main` → CI grün → der Self-hosted Runner
im LXC startet `deploy.sh`. Manuell derselbe Ablauf:

```bash
bash /opt/rxf-rmm/infrastructure/deploy.sh
```

`deploy.sh` holt `origin/main`, validiert das Compose-File, baut neu und
**wartet bis zu 60 s auf einen gesunden Backend-Container**; wird er nicht
gesund, endet das Skript mit Exit 1 und gibt `docker compose ps` sowie die
letzten 50 Logzeilen aus. Ein grüner Deploy heißt damit, dass die API
tatsächlich antwortet, nicht nur, dass Container gestartet wurden.

Kurze Nichtverfügbarkeit während `docker compose up -d --build` ist
eingeplant und für diesen Anwendungsfall akzeptiert. Agents überbrücken sie
durch ihren Reconnect ohne Datenverlust; Heartbeats in dem Fenster fehlen in
der Historie.

## Rollback

```bash
cd /opt/rxf-rmm
git log --oneline -10
git reset --hard <commit-vor-dem-problem>
cd infrastructure && docker compose up -d --build
```

Anschließend `git reset` nicht vergessen rückgängig zu machen bzw. den
nächsten CD-Lauf zu berücksichtigen — `deploy.sh` macht selbst
`git reset --hard origin/main` und überschreibt einen manuellen Rollback beim
nächsten Deploy. Für einen dauerhaften Rollback gehört der Revert nach
`main`.

Reicht ein Code-Rollback nicht, weil sich Daten geändert haben, kommt
zusätzlich der Restore-Weg oben dazu. Ein Schema-Downgrade gibt es nicht;
das Schema wächst nur additiv (siehe
[`ARCHITECTURE.md`](ARCHITECTURE.md#7-datenmodell)).

## Agent-Release ausrollen

```bash
cd /opt/rxf-rmm/infrastructure
./build-agent.sh 0.3.0        # baut alle 5 Targets, signiert, Backend-Neustart
```

Der Server bietet das Update jedem Agent beim ersten Heartbeat einer
Verbindung an; der Agent prüft SHA-256 und ed25519-Signatur, tauscht sich
atomar aus und beendet sich. Der Dienst startet ihn neu (`Restart: always`
bzw. `sc.exe failure`).

Sofort für ein einzelnes Gerät: Dashboard → Gerät → Updates →
„Agent aktualisieren".

Ohne Signaturschlüssel gebaute Releases lehnen die Agents ab — das ist so
gewollt. Der Schlüssel wird mit `./build-agent.sh keygen` einmalig erzeugt.

## Wenn Agents offline sind

Zuerst unterscheiden: **ein** Gerät oder **alle**.

**Alle offline** → das Problem ist serverseitig.

```bash
curl -fsS https://rmm.rxf-sys.de/api/health     # Backend erreichbar?
docker compose ps                                # Container oben?
docker compose logs --tail 100 backend
```

Läuft alles, ist der Weg dorthin verdächtig: Cloudflare Tunnel auf CT 104,
DNS, Caddy. Details in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

Kommt der Server zurück, verbinden sich die Agents von selbst — der Backoff
ist gedeckelt und wird nach 30 s stabiler Verbindung zurückgesetzt, ein
Serverneustart kostet also keine Minuten.

**Ein Gerät offline** → sehr wahrscheinlich ist das Gerät aus. Wenn es an
sein sollte:

```bash
# Auf dem Gerät (Linux)
systemctl status rxf-rmm-agent
journalctl -u rxf-rmm-agent -n 50
```

Aus dem Dashboard heraus stehen zwei Wege offen, solange das Gerät noch
irgendwie erreichbar ist: **Wake** (Magic Packet, nur im selben
Broadcast-Segment) und **Agent-Logs** (holt die letzten 200 Zeilen live —
setzt allerdings eine bestehende Verbindung voraus).

Geplante Ausfälle nicht mit Alarmen quittieren, sondern vorher ein
**Wartungsfenster** setzen (Gerät → Wartung). Das unterdrückt Alarme für
dieses Gerät, ohne Regeln anzufassen.

## Ressourcenbedarf

`setup-lxc.sh` legt CT 111 mit 16 GB Disk, 2 GB RAM und 2 Kernen an
(`infrastructure/setup-lxc.sh:20-26`). Für 5–15 Geräte ist das reichlich; der
begrenzende Faktor ist die Disk, weil dort Docker-Images, die Datenbank, die
Agent-Releases und die Backups liegen.

Grober Datenanfall: ein Heartbeat pro Gerät und Minute, Roh-Retention 48 h,
danach Stundenwerte für 30 Tage. Bei 15 Geräten sind das ~43.000 Rohzeilen
und ~11.000 Stundenzeilen — einige Megabyte. Job-Output ist gekappt; der
Audit-Log wächst dauerhaft und ist der einzige unbegrenzte Posten.

Platz prüfen:

```bash
df -h /
du -sh /opt/backups/rxf-rmm /var/lib/docker
docker system df
```
