# Architektur

Stand: 21.10.2026. Bezugspunkt ist immer der Code — jede Aussage hier ist mit
`Datei:Zeile` belegt, damit die Abweichung auffällt, wenn sich etwas ändert.

## 1. Komponenten

| Komponente | Technik | Läuft wo | Aufgabe |
|---|---|---|---|
| Backend | FastAPI, Python 3.11+, SQLite (aiosqlite) | Container `rxf-rmm-backend` | REST-API, Agent-WebSocket, Job-Engine, Alarm-Engine, Audit-Log |
| Dashboard | Vite + React 19 + TypeScript | Container `rxf-rmm-web` (Caddy) | Bedienoberfläche, liefert außerdem statische Assets und proxyt `/api` |
| Agent | Go, CGO off, eine statische Binary | Auf jedem verwalteten Gerät als Systemdienst | Heartbeat, Inventar, Jobs, Patches, Selbst-Update |
| RustDesk | `rustdesk/rustdesk-server` (hbbs/hbbr) | Container, `network_mode: host` | Remote-Desktop-Relay |

Es gibt keinen externen Datenbankserver, keine Message-Queue und keinen
Cache. Der gesamte Zustand liegt in einer SQLite-Datei im Volume
`rxf-rmm-data` (`/data/rmm.db`, WAL-Mode).

## 2. Netzwerk und Datenfluss

```
Browser ──HTTPS──▶ Cloudflare Tunnel ──HTTP──▶ Caddy :80 ──┬──▶ /api/*  ──▶ backend:8080
  (rmm.rxf-sys.de)      (CT 104)                (CT 111)   └──▶ sonst   ──▶ statisches Dashboard

Agent ───────WSS ausgehend──────────────────────────────────────▶ /api/agent/ws
      ◀──────Befehle über denselben Socket──────────────────────
```

Wesentlich: **die Verbindung geht immer vom Agent aus.** Verwaltete Geräte
brauchen keine offenen Ports, keine feste IP und kein VPN. Der Server hält
pro Gerät genau einen Socket in einer In-Memory-Registry
(`backend/app/agents_ws.py:20`) und schickt Jobs, Patch-Scans, Log-Abfragen
und Update-Angebote darüber zurück.

Die einzige Ausnahme ist RustDesk: dessen Relay braucht eigene
Router-Portfreigaben (TCP 21115–21117, UDP 21116) und läuft nicht durch den
Tunnel. Begründung und Alternative in [`../infrastructure/RUSTDESK.md`](../infrastructure/RUSTDESK.md).

### Proxy-Header

Caddy strippt `CF-Connecting-IP`, `X-Real-IP` und `X-Forwarded-*` von jedem
Peer außer dem in `TRUSTED_PROXY_CIDR` konfigurierten
(`frontend/Caddyfile:10-15`). Ohne das könnte ein Angreifer im LAN das
Login-Rate-Limit pro "IP" beliebig umgehen. Das Backend wertet die Header nur
aus, wenn `TRUST_PROXY_HEADERS=true` gesetzt ist
(`backend/app/routers/auth.py:35`).

## 3. Auth- und Session-Modell

Es gibt **zwei getrennte Vertrauensketten**, die sich nirgends kreuzen.

### 3.1 Dashboard-Benutzer

1. `POST /api/auth/login` prüft Benutzername und Passwort gegen einen
   Argon2id-Hash (`backend/app/accounts.py:39`). Unbekannte Benutzer laufen
   gegen einen Dummy-Hash, damit die Antwortzeit nichts verrät
   (`accounts.py:144`).
2. Ist TOTP aktiv, verlangt der zweite Schritt einen Code oder einen
   Backup-Code (`accounts.py:327`, `valid_window=1`).
3. Erfolg erzeugt `secrets.token_urlsafe(32)` (`accounts.py:454`). In der DB
   landet nur der SHA-256-Hash plus ein 8-Zeichen-Präfix für die
   Sessionliste.
4. Das Token geht als Cookie `rmm_session` zurück: `httponly`,
   `samesite=lax`, `secure` gemäß `SESSION_COOKIE_SECURE`, `path=/`
   (`backend/app/routers/auth.py:85-94`).

Rollen (`backend/app/accounts.py:75`):

| Rolle | Darf |
|---|---|
| `admin` | alles, inkl. Konten, Personen, Passwort-Tresor, Automatisierung, Audit-Log |
| `techniker` | Geräte verwalten, Jobs und Skripte ausführen, Patches, Enrollment-Token |
| `viewer` | ausschließlich lesend, und nur die Geräte der eigenen Person |

Durchgesetzt wird das über drei Dependencies in `backend/app/auth.py`:
`verify_session` (:31), `require_operator` (:61), `require_admin` (:51).
Die Viewer-Einschränkung ist zusätzlich pro Endpunkt implementiert
(`person_scope` :74, `device_visible` :83) — eine Rolle allein reicht nicht,
die Datenmenge wird gefiltert.

`AUTH_ENABLED=false` ersetzt alle drei durch einen synthetischen Admin
(`auth.py:20`). Das ist ausschließlich ein Entwicklungsschalter.

### 3.2 Geräte

1. Ein Operator erzeugt ein Enrollment-Token:
   `"enr_" + secrets.token_urlsafe(24)` (`backend/app/devices.py:166`),
   gespeichert als SHA-256-Hash, mit Ablaufzeit aus
   `ENROLLMENT_TOKEN_TTL_HOURS`.
2. Der Agent tauscht es einmalig gegen dauerhafte Credentials:
   `POST /api/agent/enroll` liefert `device_id` und
   `"dev_" + secrets.token_urlsafe(32)` (`devices.py:257`). Auch davon
   speichert der Server nur den SHA-256-Hash.
3. Das Verbrauchen des Tokens ist ein bedingtes UPDATE mit anschließender
   Prüfung (`devices.py:272-275`) — zwei gleichzeitig startende Agents
   können sich nicht beide damit enrollen.
4. Jede weitere Agent-Anfrage authentifiziert sich mit
   `Authorization: Bearer <device_id>:<device_secret>`; verglichen wird mit
   `hmac.compare_digest` (`devices.py:309`).

Ein Agent kann damit ausschließlich Daten für die eigene `device_id` melden.
Es gibt keinen Endpunkt, über den ein Gerät Daten eines anderen Geräts lesen
oder einen Befehl absetzen könnte.

### 3.3 Geräteklassen

`devices.device_class` unterscheidet zwei Arten von Zeilen:

- **`agent`** — alles oben Beschriebene: enrollt, meldet Heartbeats, nimmt
  Befehle über den offenen Socket an.
- **`mobile`** — ein Telefon oder Tablet, von Hand über
  `POST /api/devices` angelegt. Es entsteht **kein** Zugang: gespeichert wird
  der Hash eines Geheimnisses, das nie jemand erfährt, und
  `authenticate_device()` lehnt die Klasse zusätzlich ab.

`backend/app/device_policy.py` hält fest, welche Aktionen einen Agent
voraussetzen (Shell, Skripte, Patch-Scan und -Installation, WoL,
Agent-Update, Agent-Logs, Fernwartung). Jeder dieser Endpunkte fragt
`ensure_supported()` und antwortet sonst mit 409 — die Oberfläche blendet
dieselben Knöpfe aus, aber die Grenze steckt im Server. Aus demselben Grund
überspringt der Alarm-Lauf Geräte ohne Agent: seine drei Regeln lesen
Heartbeat, Plattenbelegung und Patch-Stand, und ein Telefon hat davon nichts
— es stünde sonst dauerhaft als „offline" im Alarm.

`ownership` (`private` | `company`) beschreibt das Besitzverhältnis. Es
bestimmt die Rechte im MDM-Profil (3.4) und künftig den Umfang der
Verwaltungsbefehle — auf einem Privatgerät niemals Komplett-Löschen oder
erzwungene Updates.

### 3.4 Apple-Geräte (MDM)

Eine dritte Vertrauenskette, getrennt von den beiden oben. iPhone und iPad
sprechen nicht mit dem Backend, sondern mit NanoMDM (`/mdm`) und dem
SCEP-Server (`/scep`), beide im Compose-Profil `mdm`
([`MDM-SETUP.md`](MDM-SETUP.md)).

```
Admin ──POST …/mdm/enrollment──▶ Backend: Einmal-Link (nur Hash in der DB)
Telefon ──GET /api/mdm/enroll/mde_…──▶ Profil mit frischer Einmal-Challenge,
                                        ServerURL …/mdm?e=<ref>
Telefon ──SCEP-CSR──▶ scep ──scep-csr-verifier──▶ POST /api/mdm/scep/verify
                                        (Challenge + CN, genau einmal gültig)
Telefon ──Authenticate/TokenUpdate──▶ NanoMDM ──Webhook (HMAC)──▶ Backend
                                        bindet UDID ↔ Gerät über url_params e
Backend ──PUT /v1/enqueue/<UDID>──▶ NanoMDM ──APNs──▶ Telefon (DeviceInformation)
```

- Der Link ist das einzige Credential des Telefons; er läuft nach
  `MDM_ENROLLMENT_TTL_HOURS` ab, gilt für höchstens fünf Abrufe und endet mit
  dem ausgestellten Zertifikat (`backend/app/mdm.py`).
- Jeder Abruf erzeugt eine neue Challenge und entwertet die vorige; das
  Backend speichert nur deren Hash. Ein CSR, dessen CN nicht zur Challenge
  passt, widerruft die Registrierung.
- Gebunden wird nur eine Registrierung, deren Zertifikat ausgestellt ist. Der
  `ref` ist zufällig und steht nur in diesem einen Profil.
- `AccessRights` ohne Lösch-Bit für alles außer Firmengeräten
  (`backend/app/mdm_profile.py`): iOS selbst lehnt das Löschen dann ab,
  zusätzlich zur Server-Grenze.
- Webhook und Verify-Endpunkt sind Container-zu-Container; Caddy antwortet
  auf beide von außen mit 404, beide prüfen trotzdem ihr eigenes Geheimnis.

## 4. WebSocket-Protokoll

Drei Sockets, alle unter `/api`. Details zu jedem Nachrichtentyp in
[`API.md`](API.md).

| Socket | Auth | Richtung |
|---|---|---|
| `/api/agent/ws` | `Authorization: Bearer <id>:<secret>` | Agent ⇄ Server |
| `/api/jobs/{job_id}/ws` | Session-Cookie, Rolle admin/techniker | Server → Browser |
| `/api/fleet/ws` | Session-Cookie, jede Rolle | Server → Browser |

Alle drei akzeptieren den Socket zuerst und schließen dann mit einem
anwendungsspezifischen Code (`4401` unauthentifiziert, `4403` verboten,
`4404` unbekannt). Grund: ein Handshake-Reject liefert dem Client keine
verwertbare Fehlermeldung (`backend/app/routers/agent.py:288`).

Der Fleet-Socket überträgt bewusst keine Nutzdaten, sondern nur Hinweise vom
Typ `{"type":"refresh","kind":…}`. Der Browser liest daraufhin die
REST-Endpunkte neu, die er ohnehin kennt — dadurch bleibt die Autorisierung
an genau einer Stelle, nämlich in der REST-Schicht
(`backend/app/fleet_ws.py:1-9`).

## 5. Job-Ausführung

```
Dashboard ──POST /api/devices/{id}/jobs──▶ jobs.create_job()  (Status "queued")
                                              │
                                     dispatch_payload → Agent-Socket
                                              ▼
Agent  ──job_started──▶ Status "running"
       ──job_output──▶ Chunk → job_secrets.extract() → DB + Live-Socket
       ──job_result──▶ Status "done"/"failed" + Exit-Code
```

- Der Agent führt das Kommando über eine Shell aus: `bash -c`, `zsh -c` oder
  `powershell -NoProfile -NonInteractive -Command`
  (`agent/jobs.go:66-84`). Ein unbekannter Shell-Wert wird abgelehnt, nicht
  interpoliert.
- Timeouts kommen vom Server, werden aber im Agent auf 4 h gedeckelt
  (`agent/jobs.go:19,32-41`).
- Job-Output läuft vor dem Speichern durch `job_secrets.extract`
  (`backend/app/job_secrets.py:246`): Ein Skript kann mit einem
  `##RMM-CRED##`-Marker ein Geheimnis melden, das dann verschlüsselt im
  Tresor landet und **nicht** im Job-Log. Vor dem Marker dürfen Leerraum,
  Steuerzeichen und unsichtbare Formatzeichen (BOM, Zero-Width-Space, Word
  Joiner …) stehen. Eine Marker-Zeile ist auf 64 Ki Zeichen begrenzt; eine
  längere wird durch einen Hinweis ersetzt und nicht gespeichert. Endet ein
  Job ohne Ergebnis (Timeout, Gerät gelöscht), wird ein noch
  zurückgehaltenes Fragment verworfen und nur seine Länge geloggt.
- Jobs an ein offline stehendes Gerät scheitern sofort, statt in der
  Warteschlange zu verfallen. Wer etwas fürs nächste Online-Gehen will,
  merkt es vor (`pending_actions`): Installation, Skript oder Neustart. Der
  nächste Heartbeat des Geräts führt es aus (`backend/app/action_runner.py`),
  ebenso der Eingang eines Update-Scans und das Vormerken für ein schon
  verbundenes Gerät. Eine Sperre je Gerät verhindert, dass Heartbeat und
  API-Aufruf dieselbe Vormerkung zweimal senden; ein Fehler dort wird
  geloggt und trennt den Agent nicht. Das Patch-Fenster legt für offline
  Geräte im Bereich eine Vormerkung mit `catch_up_days` Frist an — so holen
  sie das Fenster nach, statt eine Woche zu warten.

## 6. Update-Signaturkette

```
Build-Maschine                      Server                        Agent
──────────────                      ──────                        ─────
make keygen  → ed25519-Keypair
make sign    → manifest.json  ──▶  releases.load()          ──▶  update-Nachricht
  (Signatur über die Binary)        liefert version/url/       ──▶  Download über
  Public Key per -ldflags in            sha256/sig                 Bearer-Auth
  die Binaries gepinnt                                        ──▶  verifyPayload():
                                                                   SHA-256 + ed25519
                                                              ──▶  atomarer Tausch
```

- Der Server prüft **nichts**; er reicht nur das Manifest weiter
  (`backend/app/releases.py:91-96`). Die Sicherheitsgrenze liegt vollständig
  im Agent: `agent/update.go:42-59`, verifiziert wird über die rohen Bytes.
- Der Public Key wird zur Build-Zeit eingebrannt
  (`agent/Makefile:11-13`). Bleibt der Platzhalter stehen
  (`agent/update.go:29`), lehnt der Agent **jedes** Update ab — ausgefallen,
  aber sicher.
- `make sign` scheitert hart, wenn nicht beide Schlüssel gesetzt sind
  (`agent/Makefile:58-60`); ein signiertes Release ohne passenden
  Verifikationsschlüssel kann also nicht entstehen.
- Der Server verhindert Path-Traversal beim Ausliefern der Binary
  (`backend/app/releases.py:99-113`).

## 7. Datenmodell

Alle Tabellen liegen in einer SQLite-Datei. Jedes Modul bringt sein eigenes
Schema mit und legt es beim Start an; aufgerufen wird das gesammelt im
Lifespan (`backend/app/main.py:115-126`).

| Tabelle | Zweck | Definiert in |
|---|---|---|
| `users` | Konten, Rolle, Argon2-Hash, TOTP-Secret, Backup-Codes, `person_id` | `accounts.py:42` |
| `sessions` | Session-Hash, Präfix, Ablauf; FK auf `users` mit CASCADE | `accounts.py:53` |
| `app_settings` | Laufzeit-Einstellungen (z. B. ntfy-Override) und der zufällige Schlüssel für die Skript-Fingerabdrücke im Audit-Log (`content_hmac`) | `accounts.py:64` |
| `devices` | Gerät, OS, Agent-Version, Secret-Hash, letzter Heartbeat, `person_id`, Wartungsfenster, letzter Update-Scan, Geräteklasse, Besitzverhältnis, Modell/Seriennummer/IMEI/Notiz (nur ohne Agent) | `devices.py:30` |
| `enrollment_tokens` | Einmal-Token: Hash, Ablauf, Verbrauchszeitpunkt | `devices.py:46` |
| `inventory` | Inventar je Gerät und Art (Hardware/Software/Netz) | `devices.py:55` |
| `jobs` | Auftrag, Kommando, Status, Exit-Code, gekappter Output | `jobs.py:32` |
| `pending_actions` | Vorgemerkt fürs nächste Online-Gehen: Art, Optionen (nur Sicherheit, Neustart, Skript), Herkunft, Ablauf, Zustand, zugehöriger Job | `pending_actions.py` |
| `metrics` | Roh-Heartbeats (Retention 48 h) | `metrics.py:24` |
| `metrics_hourly` | Stunden-Rollup (Retention 30 Tage) | `metrics.py:33` |
| `alerts` | Alarme mit `resolved_at`/`acked_at`; Partial-Index auf offene | `alerts.py:33` |
| `audit_log` | Append-only: Zeit, Event, Akteur, Gerät, Detail-JSON | `audit.py:29` |
| `patches` | Ausstehende Patches je Gerät, mit Schweregrad | `patches.py:31` |
| `scripts` | Skript-Bibliothek: Name, Shell, OS, Inhalt | `scripts.py:30` |
| `automation` | Patch-Fenster und globale Automatisierungs-Konfiguration | `automation.py:39` |
| `alert_rules` | Alarmregeln mit Scope (global/Tag/Person) | `automation.py:44` |
| `script_schedules` | Wöchentliche Skript-Läufe | `automation.py:54` |
| `persons` | Betreute Personen ("Kunden"); Geräte hängen über `person_id` daran | `persons.py:24` |
| `device_credentials` | Fernet-verschlüsselte Geheimnisse je Gerät | `credentials.py:31` |
| `mdm_enrollments` | MDM-Registrierungslinks: Link- und Challenge-Hash, `ref`, Rechte, Ablauf, Zeitpunkte von Abruf, Zertifikat und Registrierung | `mdm.py` |
| `mdm_devices` | Gebundene Apple-Geräte: UDID, Rechte im Profil, letzter Kontakt, Abmeldung; die letzten Antworten auf Geräteinformationen, Sicherheitsstatus, App-, Profil- und Zertifikatsliste; Entsperr-Token (mit dem Tresor-Schlüssel verschlüsselt); Ausstellung, Ablauf und Erneuerung der Identität | `mdm.py` |
| `mdm_commands` | Jeder MDM-Befehl an ein Telefon mit CommandUUID, Anstoß und Ergebnis (`queued`, `acknowledged`, `error`, `notnow`, `failed`); 90 Tage | `mdm.py` |
| `mdm_policies` | Je Telefon abgeschaltete Befugnisse (`lock`, `erase`, `clear_passcode`, `apps`, `profiles`, `install_apps`, `os_update`) | `mdm.py` |
| `mdm_configs` | Profil-Vorlagen (WLAN, Code-Pflicht, Web-Clip, Mail-, Kalender-, Kontakte-Konto): Einstellungen, Passwort verschlüsselt mit dem Tresor-Schlüssel, Version | `mdm_configs.py` |
| `mdm_device_configs` | Welche Vorlage auf welchem Telefon ist: `installing`, `installed`, `removing`, `error`, installierte Version | `mdm_configs.py` |
| `mdm_os_updates` | Erzwungenes iOS-Update je Telefon (Version, Frist in Ortszeit) und der zuletzt gemeldete Update-Stand (DDM) | `mdm_ddm.py` |
| `schema_meta` | Schema-Version der Datei (nur informativ) | `db.py` |

**Verbindungen**: Alle Module öffnen die Datenbank über
`app/db.py:connect()`. Das ist kein Selbstzweck — SQLite schaltet
Fremdschlüssel **pro Verbindung** ab, und solange jedes Modul sein eigenes
`_connect` hatte, hing es davon ab, welches Modul das DELETE ausführte, ob ein
`ON DELETE CASCADE` überhaupt griff.

**Migrationen**: Es gibt kein Alembic. Das Schema wächst über
`CREATE TABLE IF NOT EXISTS` plus additive `PRAGMA table_info(...)` →
`ALTER TABLE ... ADD COLUMN`-Prüfungen an vier Stellen (`accounts.py`,
`devices.py`, `alerts.py`, `scripts.py`). Spalten werden nie entfernt oder
umbenannt.

`app/db.py:SCHEMA_VERSION` wird beim Start in der Tabelle `schema_meta`
festgehalten. Der Wert blockiert nichts: Ist die Datei von einem neueren Build
geschrieben worden — so sieht ein Rollback von hier aus —, gibt es eine
Warnung im Log, aber keinen Startabbruch. Additive Migrationen bedeuten, dass
der ältere Code weiterläuft und die zusätzlichen Spalten ignoriert; einen
Rollback im Störfall zu blockieren würde mehr kosten als es bringt. Ein echtes
Downgrade des Schemas gibt es nicht — dafür gibt es das Backup
([`OPERATIONS.md`](OPERATIONS.md)).

## 8. Hintergrundprozesse

Zwei Tasks laufen im Lifespan (`backend/app/main.py:132-135`):

| Task | Intervall | Tut |
|---|---|---|
| `cleanup_loop` | `CLEANUP_INTERVAL_S` (1 h) | abgelaufene Sessions und Enrollment-Token löschen, Metrik-Rollup und -Retention, hängende Jobs abräumen |
| `alert_loop` | `ALERT_INTERVAL_S` (60 s) | Alarmregeln auswerten, ntfy-Push, Patch-Fenster und Skript-Zeitpläne starten |

Beide werden beim Herunterfahren gecancelt; eine Exception aus einem Loop
wird geloggt statt verschluckt (`main.py:140-153`).

## 9. Historie

Der ursprüngliche Planungs- und Phasenplan liegt unter
[`_archiv/RMM-PLAN.md`](_archiv/RMM-PLAN.md). Er beschreibt den Weg zum
heutigen Stand und ist als Entscheidungsdokumentation weiterhin nützlich,
aber nicht mehr der maßgebliche Architekturtext — das ist diese Datei.
