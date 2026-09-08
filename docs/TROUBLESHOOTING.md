# Troubleshooting

Stand: 07.09.2026. Sortiert nach dem, was in diesem Setup tatsächlich
schiefgeht. Jede Diagnose nennt, wo im Code das Verhalten herkommt.

## Agent verbindet sich nicht

### Symptom: Gerät bleibt nach dem Enrollment offline

Der Agent verbindet **ausgehend**. Wenn nichts ankommt, liegt es an einer von
vier Stellen: Dienst läuft nicht, Konfiguration falsch, Netzweg blockiert,
Credentials abgelehnt.

```bash
# 1. Läuft der Dienst?
systemctl status rxf-rmm-agent            # Linux
Get-Service rxf-rmm-agent                 # Windows
sudo launchctl list | grep rxf-rmm        # macOS

# 2. Was sagt er?
journalctl -u rxf-rmm-agent -n 50 --no-pager

# 3. Stimmt die Konfiguration?
sudo cat /etc/rxf-rmm/agent.json          # server_url, device_id gesetzt?

# 4. Kommt das Gerät überhaupt zum Server?
curl -fsS https://rmm.rxf-sys.de/api/health
```

| Logzeile | Bedeutung | Abhilfe |
|---|---|---|
| `config … is incomplete — re-run enroll` | `server_url` oder `device_secret` fehlen | Neu enrollen (`agent/config.go:44`) |
| Schließcode `4401` | Credentials werden abgelehnt | Gerät wurde im Dashboard gelöscht → neu enrollen |
| Schließcode `4403` | Gerät als widerrufen markiert | Neu enrollen |
| `unsupported scheme` | `server_url` ist weder `http://` noch `https://` | `agent.json` korrigieren (`agent/client.go:93-109`) |
| Wiederholte Dial-Timeouts | Netzweg blockiert | siehe nächster Abschnitt |

Der Reconnect ist exponentiell mit Jitter, von 2 s bis maximal 5 min
(`agent/client.go:64-89`). Nach dem Beheben also **bis zu fünf Minuten
warten**, bevor man weitersucht — oder den Dienst neu starten, das setzt den
Backoff sofort zurück.

### Symptom: „Enrollment fehlgeschlagen"

| Ursache | Erkennbar an |
|---|---|
| Token bereits verbraucht | Token ist Einmal-Gebrauch (`backend/app/devices.py:272`) |
| Token abgelaufen | Default 24 h, `ENROLLMENT_TOKEN_TTL_HOURS` |
| Token widerrufen | Im Dashboard unter „Gerät hinzufügen" nicht mehr gelistet |
| Falscher Server | Tippfehler in `-server` |

In allen Fällen: neues Token erzeugen. Ein Token lässt sich nicht
„zurücksetzen".

## WebSocket kommt nicht durch den Tunnel

Cloudflare Tunnel unterstützt WebSockets, aber nur, wenn der Ingress als
HTTP-Service konfiguriert ist. Symptom: REST funktioniert, aber die
Geräteliste aktualisiert sich nie live und kein Agent bleibt verbunden.

```bash
# Auf CT 104
cloudflared tunnel info <tunnel>
cat /etc/cloudflared/config.yml       # service: http://192.168.2.211:80
journalctl -u cloudflared -n 100 --no-pager | grep -i websocket
```

Gegenprobe direkt am LXC, am Tunnel vorbei:

```bash
curl -i -N -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  http://192.168.2.211/api/agent/ws
```

Erwartet ist **401/403** (die Credentials fehlen ja) oder ein
Upgrade — beides beweist, dass der Upgrade-Pfad steht. Ein **502/504** zeigt
auf Caddy oder das Backend, ein Timeout auf den Weg dorthin.

Häufige Ursache: ein zusätzlicher Reverse Proxy zwischen Tunnel und Caddy,
der `Connection`/`Upgrade` nicht weiterreicht. Caddys `reverse_proxy` tut das
von sich aus (`frontend/Caddyfile:17-19`).

## Login schlägt fehl

| Symptom | Ursache | Abhilfe |
|---|---|---|
| „Zugangsdaten ungültig" beim allerersten Login | `BOOTSTRAP_ADMIN_PASSWORD` war beim ersten Start leer → es wurde kein Konto angelegt | Variable setzen, **Datenbank muss noch leer sein**, dann `docker compose up -d backend`. Bei bereits angelegten Konten greift der Bootstrap nicht mehr |
| 429 „zu viele Versuche" | 5 Fehlversuche in 300 s pro IP (`backend/app/routers/auth.py:31`) | 5 Minuten warten. Der Zähler liegt im Speicher, ein Backend-Neustart setzt ihn zurück |
| Alle Benutzer gleichzeitig gesperrt | Alle laufen unter derselben „IP", weil `TRUSTED_PROXY_CIDR` falsch ist | CIDR des cloudflared-Hosts eintragen, siehe [`CONFIGURATION.md`](CONFIGURATION.md) |
| Login gelingt, aber jeder Folge-Request ist 401 | Cookie wird verworfen | `SESSION_COOKIE_SECURE=true` über eine `http://`-Verbindung. Entweder HTTPS nutzen oder für lokales Dev auf `false` |
| Ständiges Ausloggen | `CORS_ORIGINS` enthält die aufgerufene URL nicht | Origin ergänzen |

## Passwort-Tresor: „Entschlüsselung fehlgeschlagen"

Die Datenbank wurde ohne den passenden `credentials.key` wiederhergestellt.
Der Schlüssel liegt neben der Datenbank (`/data/credentials.key`) und wird
beim ersten Start **neu erzeugt**, wenn er fehlt — die alten Werte lassen
sich damit nicht mehr lesen.

```bash
docker exec rxf-rmm-backend ls -l /data/credentials.key
ls -l /opt/backups/rxf-rmm/credentials-*.key
```

Passenden Schlüssel aus dem Backup nachziehen (Restore mit `.key`-Argument,
siehe [`OPERATIONS.md`](OPERATIONS.md#restore)). Gibt es ihn nicht mehr, sind
die gespeicherten Geheimnisse verloren; die Einträge müssen gelöscht und neu
angelegt werden.

## RustDesk-ID fehlt

Das Remote-Panel bleibt leer oder meldet „Für dieses Gerät ist keine
RustDesk-ID hinterlegt" (409).

Der Agent liest die ID, indem er `rustdesk --get-id` aufruft
(`agent/rustdesk.go:21`) und meldet sie im Heartbeat. Fehlt sie, ist meist
eines davon der Grund:

1. **RustDesk ist auf dem Gerät nicht installiert** — das ist der Normalfall
   direkt nach dem Rollout. Installieren, dann bis zum nächsten Heartbeat
   warten (bis zu 60 s).
2. **Die Binary liegt an einem unerwarteten Ort.** Gesucht wird nur an festen
   Pfaden (`agent/rustdesk_unix.go`, `agent/rustdesk_windows.go`).
3. **RustDesk läuft nicht als Dienst**, sondern nur als Benutzer-App — dann
   liefert `--get-id` nichts.
4. **Das Relay ist serverseitig gar nicht konfiguriert.** Dann meldet
   `GET /api/remote/config` die Funktion als aus, unabhängig vom Gerät:

```bash
docker exec rxf-rmm-backend env | grep RUSTDESK
docker exec rxf-rmm-hbbs cat /root/id_ed25519.pub
```

Als Notlösung lässt sich die ID im Dashboard von Hand eintragen
(Gerät → Remote → ID setzen).

Prüfen, ob das Gerät das Relay erreicht:

```bash
nc -vz rd.rxf-sys.de 21116
```

Scheitert das, fehlen die Router-Portfreigaben — RustDesk läuft **nicht**
durch den Cloudflare Tunnel, siehe
[`../infrastructure/RUSTDESK.md`](../infrastructure/RUSTDESK.md).

## Patch-Scan schlägt fehl

Zuerst `409 Gerät ist nicht verbunden` ausschließen — ein Scan braucht eine
offene Agent-Verbindung, er wird nicht in eine Warteschlange gelegt.

Danach ist der Job-Output die Fehlerquelle (Gerät → Patches, bzw. der
zugehörige Job).

| OS | Typischer Fehler | Ursache |
|---|---|---|
| Linux | `Could not get lock /var/lib/dpkg/lock` | `unattended-upgrades` oder ein anderes apt läuft. Später erneut |
| Linux | leeres Ergebnis trotz bekannter Updates | Paketlisten veraltet — `apt-get update` läuft nicht im Scan (`agent/patches_linux.go:23`) |
| Windows | `0x8024402C` o. ä. | Windows-Update-Agent erreicht seine Quelle nicht (WSUS/Proxy) |
| Windows | Scan hängt | Die COM-API kann mehrere Minuten brauchen; Timeout ist 5 min (`agent/patches.go`) |
| macOS | leeres Ergebnis | `softwareupdate -l` liefert nur Systemupdates, keine App-Store-Apps |

Der Agent läuft als root bzw. SYSTEM; fehlende Rechte scheiden als Ursache
aus. Zum Gegenprüfen dasselbe Kommando manuell auf dem Gerät ausführen:

```bash
apt-get -s dist-upgrade          # Linux
softwareupdate -l                # macOS
```

## Agent aktualisiert sich nicht

| Symptom | Ursache | Abhilfe |
|---|---|---|
| Kein Update wird angeboten | Kein `manifest.json` in `AGENT_RELEASE_DIR` | `./build-agent.sh <version>` |
| Update wird angeboten, aber abgelehnt | Der Agent wurde ohne eingebrannten Public Key gebaut — dann lehnt er **jedes** Update ab (`agent/update.go:29`) | Signiertes Release bauen und die betroffenen Agents **einmal** neu installieren |
| Signaturprüfung schlägt fehl | Release mit einem anderen Schlüssel signiert als dem eingebrannten | Mit dem passenden Schlüssel neu signieren |
| Update läuft, Agent kommt nicht wieder | Der Dienst startet nach dem Selbst-Beenden nicht neu | `Restart: always` (systemd) bzw. `sc.exe failure` (Windows) prüfen; im Zweifel liegt die vorherige Binary als `<exe>.bak` daneben |
| `409 Agent ist bereits aktuell` | Gemeldete Version = Release-Version | Kein Fehler |

## Alarme kommen nicht an

```bash
docker exec rxf-rmm-backend env | grep NTFY
```

Achtung: Die Laufzeit-Konfiguration aus dem Dashboard liegt in der Datenbank
und **überschreibt** die Umgebungsvariablen (`backend/app/notify.py:23`). Was
tatsächlich gilt, steht unter Admin → Push. Dort gibt es auch einen
Testversand (`POST /api/settings/ntfy/test`).

Weitere Gründe für ausbleibende Alarme:

- Das Gerät steht in einem **Wartungsfenster** — dann werden Alarme bewusst
  unterdrückt.
- Die Regel ist per Tag oder Person eingeschränkt und trifft das Gerät nicht.
- Bei Disk-Alarmen greift eine Hysterese: der Alarm feuert bei
  `DISK_ALERT_PCT` und löst erst unter `DISK_ALERT_CLEAR_PCT` wieder auf. Ein
  Wert dazwischen erzeugt keinen neuen Alarm.
- Ein Alarm feuert **einmal**, nicht wiederholt, solange er offen ist.

## Dashboard aktualisiert sich nicht live

Der Browser hält einen Socket auf `/api/fleet/ws`. Bricht er ab, verbindet
das Frontend nach 5 s neu; zwischenzeitlich greift der 30-Sekunden-Poll, die
Anzeige ist also veraltet, aber nicht tot.

Prüfen: Browser-DevTools → Netzwerk → WS → `fleet/ws`. Schließcode `4401`
heißt abgelaufene Session — neu anmelden.

## Deploy schlägt fehl

`deploy.sh` endet mit Exit 1, wenn das Backend nicht binnen ~60 s gesund
wird, und gibt dann `docker compose ps` und die letzten 50 Logzeilen aus.

Häufigste Ursachen in dieser Reihenfolge:

1. **Fehler in `.env`** — Pydantic bricht beim Start ab; im Log steht ein
   `ValidationError` mit dem Feldnamen. `CORS_ORIGINS` ist bewusst tolerant
   und nimmt JSON-Liste, kommagetrennte Liste und einzelne Origin gleichermaßen.
2. **Disk voll** — Build schlägt fehl. `df -h`, dann `docker system prune -a`
   (Vorsicht: entfernt ungenutzte Images).
3. **Port 80 belegt** — nur `web` published einen Host-Port.
4. **Datenbank defekt** — der Container startet in einer Neustartschleife.
   `integrity_check` fahren (siehe oben), im Zweifel Restore.
5. **`attempt to write a readonly database`** — das Datenvolumen gehört noch
   root, der Container läuft aber als uid 10001. Der einmalige
   Besitzerwechsel steht in
   [`OPERATIONS.md`](OPERATIONS.md#container-härtung). Zwei Details, an denen
   er scheitert: der echte Volumename trägt den Projektpräfix
   (`infrastructure_rxf-rmm-data`), und der `chown` muss über ein einfaches
   `docker run` laufen — über `docker compose run` erbt er `cap_drop: ALL`
   und scheitert mit „Operation not permitted".

## Nichts hilft: Zustand sammeln

```bash
cd /opt/rxf-rmm/infrastructure
docker compose ps
docker compose logs --tail 200 backend > /tmp/backend.log
docker compose logs --tail 100 web     > /tmp/web.log
docker exec rxf-rmm-backend python -c \
  "import sqlite3; print(sqlite3.connect('/data/rmm.db').execute('PRAGMA integrity_check').fetchone()[0])"
git -C /opt/rxf-rmm log --oneline -5
df -h /
```

Das deckt die vier Fragen ab, die fast immer die Antwort enthalten: Laufen
die Container, was sagt das Backend, ist die Datenbank in Ordnung, und welcher
Stand ist überhaupt deployt.
