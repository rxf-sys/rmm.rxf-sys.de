# Konfiguration

Stand: 07.09.2026. Die Backend-Tabelle ist gegen
`backend/app/config.py` abgeglichen — Namen, Typen und Defaults stammen aus
`Settings.model_fields`, nicht aus dem Gedächtnis. Sie enthält alle **32**
Einstellungen.

## Woher die Werte kommen

| Ebene | Datei | Gilt für |
|---|---|---|
| Compose-Umgebung | `infrastructure/.env` (Vorlage: `.env.example`) | Backend-Container, plus `TRUSTED_PROXY_CIDR` für Caddy |
| Prozess-Umgebung | beliebige Env-Variablen | überschreibt alles, z. B. im lokalen Dev-Setup |
| Laufzeit-Overrides | Tabelle `app_settings` in der DB | derzeit nur die ntfy-Konfiguration, im Dashboard änderbar |
| Agent | `/etc/rxf-rmm/agent.json` bzw. `%ProgramData%\rxf-rmm\agent.json` | pro Gerät, beim Enrollment geschrieben |

Namen sind **nicht** case-sensitiv (`case_sensitive=False`,
`config.py:14`), unbekannte Variablen werden ignoriert (`extra="ignore"`).
Konvention in diesem Repo ist GROSSSCHREIBUNG.

`infrastructure/.env` darf nie committet werden — nur `.env.example` ist
versioniert (`.gitignore:2-3`).

## Backend

Legende Security: 🔴 Geheimnis oder Schutzmechanismus · 🟡 wirkt auf die
Angriffsfläche · ⚪ funktional.

### App

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `APP_ENV` | Alles außer `production` schaltet `/api/docs` und `/api/openapi.json` frei | `production` | nein | 🟡 |
| `LOG_LEVEL` | structlog-Level (`DEBUG`…`ERROR`) | `INFO` | nein | ⚪ |
| `CORS_ORIGINS` | Erlaubte Origins. Akzeptiert JSON-Liste, kommagetrennte Liste oder eine einzelne Origin. Muss die eigene Dashboard-URL enthalten | `["https://rmm.rxf-sys.de"]` | **ja** | 🔴 |
| `AUTH_ENABLED` | `false` macht **jeden** Request zu einem Admin-Request | `true` | nein | 🔴 |

> `AUTH_ENABLED=false` ist ausschließlich ein Entwicklungsschalter
> (`backend/app/auth.py:20`). In einer erreichbaren Installation entspricht
> das einem offenen Admin-Zugang ohne Passwort.

### Anmeldung und Sessions

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `BOOTSTRAP_ADMIN_USER` | Benutzername des Erst-Admins | `admin` | nein | 🟡 |
| `BOOTSTRAP_ADMIN_PASSWORD` | Passwort des Erst-Admins. **Leer = es wird kein Admin angelegt** | *(leer)* | **ja beim ersten Start** | 🔴 |
| `SESSION_TTL_HOURS` | Lebensdauer einer Session | `168` (7 Tage) | nein | 🟡 |
| `SESSION_COOKIE_NAME` | Cookie-Name | `rmm_session` | nein | ⚪ |
| `SESSION_COOKIE_SECURE` | `Secure`-Flag. Nur für `http://`-Dev auf `false` | `true` | nein | 🔴 |
| `TRUST_PROXY_HEADERS` | Client-IP aus `CF-Connecting-IP`/`X-Real-IP`/`X-Forwarded-For` lesen | `false` | nein | 🔴 |

> Der Bootstrap greift nur, solange die `users`-Tabelle leer ist. Danach ist
> die Variable wirkungslos und kann aus `.env` entfernt werden.
>
> `TRUST_PROXY_HEADERS=true` ist nur zusammen mit einem korrekt gesetzten
> `TRUSTED_PROXY_CIDR` sicher. Sonst kann jeder Client seine "IP" frei
> wählen und das Login-Rate-Limit ins Leere laufen lassen.

### Speicher

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `STORAGE_DB_PATH` | Pfad der SQLite-Datei. Der Fernet-Schlüssel `credentials.key` landet im selben Verzeichnis | `/data/rmm.db` | nein | 🔴 |
| `CLEANUP_INTERVAL_S` | Takt für Session-/Token-Aufräumen, Metrik-Rollup, hängende Jobs | `3600` | nein | ⚪ |

### Flotte

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `HEARTBEAT_INTERVAL_S` | Erwarteter Heartbeat-Takt | `60` | nein | ⚪ |
| `OFFLINE_AFTER_S` | Ab wann ein Gerät in der Liste als offline gilt | `180` | nein | ⚪ |
| `ENROLLMENT_TOKEN_TTL_HOURS` | Gültigkeit eines Einmal-Tokens | `24` | nein | 🔴 |
| `AGENT_RELEASE_DIR` | Verzeichnis mit `manifest.json` und den signierten Binaries | `/data/agent-releases` | nein | 🟡 |

> Kürzeres `ENROLLMENT_TOKEN_TTL_HOURS` verkleinert das Zeitfenster, in dem
> ein abhandengekommenes Token noch ein Gerät anmelden kann.

### Jobs

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `SHELL_JOB_TIMEOUT_S` | Timeout für Ad-hoc-Shell und Skripte | `1800` | nein | ⚪ |
| `JOB_TIMEOUT_S` | Timeout für sonstige Jobs | `900` | nein | ⚪ |
| `PATCH_JOB_TIMEOUT_S` | Timeout für Patch-Installationen | `4500` | nein | ⚪ |

> Der Agent deckelt jeden vom Server gelieferten Wert zusätzlich auf 4 h
> (`agent/jobs.go:19`).

### Metrik-Retention

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `METRICS_RAW_RETENTION_H` | Aufbewahrung der Roh-Heartbeats | `48` | nein | ⚪ |
| `METRICS_HOURLY_RETENTION_D` | Aufbewahrung des Stunden-Rollups | `30` | nein | ⚪ |

### Alarme

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `ALERT_INTERVAL_S` | Takt der Alarm-Auswertung | `60` | nein | ⚪ |
| `OFFLINE_ALERT_AFTER_S` | Ab wann ein offlines Gerät einen Alarm auslöst | `300` | nein | ⚪ |
| `DISK_ALERT_PCT` | Schwelle für "Platte voll" | `90.0` | nein | ⚪ |
| `DISK_ALERT_CLEAR_PCT` | Rückfallschwelle (Hysterese, muss < `DISK_ALERT_PCT` sein) | `85.0` | nein | ⚪ |
| `PATCH_ALERT_AGE_DAYS` | Ab wann ein offener Sicherheitspatch als überfällig gilt | `30` | nein | 🟡 |

### Update-Scans

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `PATCH_SCAN_ENABLED` | Täglicher Update-Scan über den Heartbeat | `true` | nein | 🟡 |
| `PATCH_SCAN_HOUR` | Stunde des Slots (lokale Zeit des Containers, 0–23) | `3` | nein | ⚪ |

> Der Scan hängt am Heartbeat, nicht an einem Cron: Der Server prüft bei jedem
> Heartbeat, ob das Gerät seinen heutigen Slot hinter sich hat. Damit holt ein
> Gerät, das zur Slot-Zeit aus war, den Scan beim nächsten Online-Heartbeat
> automatisch nach. Die Geräte verteilen sich über die Stunde (`ID % 60`), und
> als erledigt gilt erst der eingetroffene Bericht — ein Scan, der nie
> zurückkommt, wird nach einer Stunde erneut angefordert.
>
> **Lokale Zeit heißt Container-Zeit.** Ohne `TZ` im Compose-File ist das UTC.

### Benachrichtigung (ntfy)

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `NTFY_BASE` | Basis-URL des ntfy-Servers. Leer = kein Push | *(leer)* | nein | 🟡 |
| `NTFY_TOPIC` | Topic | `rxf-rmm` | nein | 🟡 |
| `NTFY_TOKEN` | Bearer-Token, falls der Server eines verlangt | *(leer)* | nein | 🔴 |

> Diese drei lassen sich zur Laufzeit im Dashboard überschreiben; der
> Override liegt in `app_settings` und gewinnt gegen die Umgebung
> (`backend/app/notify.py:23`).
>
> Ein öffentlich erratbares Topic auf einem öffentlichen ntfy-Server heißt:
> jeder, der den Namen kennt, liest die Alarme mit.

### Wake-on-LAN

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `WOL_BROADCAST` | Ziel für das Magic Packet | `255.255.255.255` | nein | ⚪ |

> Nur wirksam, wenn der Server im selben Broadcast-Segment steht wie das
> Zielgerät. Über den Tunnel funktioniert WoL nicht.

### Remote-Desktop

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `RUSTDESK_RELAY_HOST` | Hostname des eigenen hbbs/hbbr | *(leer)* | nein | 🟡 |
| `RUSTDESK_KEY` | Public Key des Relays (`docker exec rxf-rmm-hbbs cat /root/id_ed25519.pub`) | *(leer)* | nein | 🔴 |

> Solange eine der beiden leer ist, meldet `/api/remote/config` die Funktion
> als nicht konfiguriert und das Remote-Panel bleibt aus.

## Caddy (Container `web`)

| Variable | Zweck | Default | Pflicht | Sec |
|---|---|---|---|---|
| `TRUSTED_PROXY_CIDR` | CIDR, dessen Proxy-Header durchgelassen werden. Alle anderen Peers bekommen `CF-Connecting-IP`, `X-Real-IP` und `X-Forwarded-*` gestrippt | `127.0.0.1/32` | **ja in Produktion** | 🔴 |

Der Default `127.0.0.1/32` bedeutet „niemandem vertrauen" und ist damit
sicher, aber falsch, sobald ein echter Reverse Proxy davorsteht: dann sieht
das Backend nur noch die Container-IP und das Login-Rate-Limit gilt faktisch
global statt pro Angreifer. Einzutragen ist die IP des cloudflared-Hosts
(CT 104).

## Agent

Der Agent liest **eine** Umgebungsvariable, `ProgramData` unter Windows
(`agent/config.go:22`), und ansonsten nur seine Konfigurationsdatei. Proxy-
Einstellungen kommen indirekt über `HTTP_PROXY`/`HTTPS_PROXY`, weil der
WebSocket-Dialer `http.ProxyFromEnvironment` nutzt (`agent/client.go:121`).

`/etc/rxf-rmm/agent.json` (Verzeichnis 0700, Datei 0600):

| Feld | Zweck |
|---|---|
| `server_url` | Basis-URL des Servers, z. B. `https://rmm.rxf-sys.de` |
| `device_id` | Beim Enrollment vergebene ID |
| `device_secret` | Das einzige Credential des Agents |

Die Datei wird beim Enrollment geschrieben. Sie von Hand zu bearbeiten ist
nur zum Umziehen auf eine andere Server-URL sinnvoll; ein neues
`device_secret` gibt es nur über ein erneutes Enrollment.

## Build-Zeit-Parameter des Agents

Diese sind keine Umgebungsvariablen zur Laufzeit, sondern werden per
`-ldflags` eingebrannt (`agent/Makefile:5-13`):

| Parameter | Zweck |
|---|---|
| `main.version` | Versionsstring, den der Agent im Heartbeat meldet |
| `main.updatePublicKey` | ed25519-Public-Key für die Update-Prüfung. Fehlt er, lehnt der Agent **jedes** Update ab |

Beim Signieren müssen `AGENT_SIGN_KEY` und `AGENT_UPDATE_PUBKEY` gesetzt
sein, sonst bricht `make sign` ab (`agent/Makefile:58-60`).

## Was nicht konfigurierbar ist

Bewusst hart kodiert, damit es keine unsicheren Kombinationen gibt:

| Wert | Wo | Warum |
|---|---|---|
| Login-Rate-Limit 5 Versuche / 300 s | `backend/app/routers/auth.py` | Ein konfigurierbares Limit wird erfahrungsgemäß hochgedreht |
| Enrollment-Rate-Limit 20 Fehlversuche / 300 s | `backend/app/routers/agent.py` | Weiter als beim Login, weil ein echter Rollout legitim wiederholt; nur Fehlversuche zählen |
| Mindestlänge Passwort 8 | `backend/app/routers/auth.py:25` | |
| Argon2id-Parameter | `backend/app/accounts.py:39` (Bibliotheks-Defaults) | |
| Cookie-Flags `httponly`, `samesite=lax` | `backend/app/routers/auth.py:85-94` | |
| Job-Timeout-Deckel 4 h | `agent/jobs.go:19` | Serverseitige Werte dürfen den Agent nicht dauerhaft blockieren |
| Log-Ringpuffer 200 Zeilen | `agent/logbuf.go` | |
