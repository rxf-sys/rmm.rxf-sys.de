# API-Referenz

Stand: 07.09.2026. Die Tabellen unten sind aus der laufenden Anwendung
erzeugt (`app.routes` inkl. der tatsächlich registrierten Dependencies), nicht
von Hand gepflegt. Sie umfassen **68 HTTP-Endpunkte und 3 WebSockets**.

Die maschinenlesbare Fassung mit allen Request-/Response-Schemata liefert
FastAPI selbst:

```bash
# lokal, mit APP_ENV=development
curl -s http://127.0.0.1:8080/api/openapi.json | jq .
# interaktiv
open http://127.0.0.1:8080/api/docs
```

In Produktion sind beide Endpunkte **abgeschaltet** (`backend/app/main.py:157`)
— der Routen- und Parameterbaum eines RMM-Servers ist unnötige
Aufklärungsfläche hinter einem öffentlichen Tunnel.

## Konventionen

- Alle Pfade beginnen mit `/api`.
- Dashboard-Aufrufe authentifizieren sich über das Cookie `rmm_session`
  (httpOnly). Es gibt keinen Header-Token für Browser-Clients.
- Agent-Aufrufe authentifizieren sich über
  `Authorization: Bearer <device_id>:<device_secret>`.
- Fehler kommen als `{"detail": "<Text>"}` mit passendem Statuscode.
  Validierungsfehler von Pydantic kommen als 422 mit FastAPIs Standardformat.
- Zeitstempel sind Unix-Sekunden (Integer, UTC).

### Auth-Spalte

| Kürzel | Bedeutung |
|---|---|
| — | keine Authentifizierung |
| Gerät | Enrollment-Token oder Geräte-Credentials (siehe Beschreibung) |
| Session | jede angemeldete Rolle; Viewer sehen nur eigene Geräte |
| Operator | `admin` oder `techniker` |
| Admin | nur `admin` |

## Öffentlich

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/health` | — | Liveness: der Prozess antwortet. Fasst die Datenbank bewusst nicht an; daran hängt der Docker-Healthcheck |
| GET | `/api/ready` | — | Readiness: Datenbank erreichbar und Kern-Tabellen vorhanden. 503 sonst. Daran hängt das Deploy-Gate |
| POST | `/api/auth/login` | — | Anmeldung. Rate-Limit: 5 Fehlversuche / 300 s pro IP → 429 |
| POST | `/api/auth/logout` | — | Widerruft die Session aus dem Cookie. Ohne Cookie ein No-op |

## Agent-Schnittstelle

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| POST | `/api/agent/enroll` | Enrollment-Token im Body | Tauscht das Einmal-Token gegen `device_id` + `device_secret`. 403 bei ungültigem, abgelaufenem oder bereits verbrauchtem Token; 429 nach 20 Fehlversuchen pro IP in 300 s |
| GET | `/api/agent/download/{target}` | Geräte-Credentials | Lädt die signierte Binary für `linux-amd64`, `windows-amd64` usw. |
| GET | `/api/agent/setup/{platform}` | Enrollment-Token | Liefert das Installer-Skript (bash bzw. PowerShell) mit eingebettetem Token |
| GET | `/api/agent/setup/download/{target}` | Enrollment-Token | Binary-Download für das Installer-Skript, Token verbraucht sich dabei nicht. Bevorzugt im Header `X-Enroll-Token`; die Query-Variante existiert nur noch als Notnagel und schreibt das Token in jedes Access-Log auf dem Weg |
| WS | `/api/agent/ws` | Geräte-Credentials | Dauerverbindung, siehe unten |

## Geräte

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/devices` | Session | Geräteliste, für Viewer auf die eigene Person gefiltert |
| GET | `/api/devices/{device_id}` | Session | Detail inkl. letztem Heartbeat und Inventar |
| GET | `/api/devices/{device_id}/history` | Session | Metrik-Historie (Roh + Stunden-Rollup) |
| GET | `/api/devices/{device_id}/alerts` | Session | Alarm-Historie des Geräts |
| PATCH | `/api/devices/{device_id}` | Operator | Label, Tags, Person, RustDesk-ID ändern |
| DELETE | `/api/devices/{device_id}` | Operator | Gerät entfernen; der Agent verliert damit den Zugang |
| GET | `/api/devices/{device_id}/agent-logs` | Operator | Holt die letzten Log-Zeilen live vom Agent. 409 ohne offene Verbindung, 504 wenn der Agent nicht innerhalb von 5 s antwortet |
| POST | `/api/devices/{device_id}/wake` | Operator | Wake-on-LAN an alle bekannten MACs. 422, wenn keine MAC bekannt ist |
| POST | `/api/devices/{device_id}/update-agent` | Operator | Bietet dem Agent sofort das aktuelle Release an. 409, wenn er schon aktuell oder nicht verbunden ist, 502 wenn das Senden scheitert |
| POST | `/api/devices/{device_id}/maintenance` | Operator | Wartungsfenster setzen; unterdrückt Alarme |
| POST | `/api/devices/enroll-tokens` | Operator | Neues Einmal-Token. Der Klartext wird **nur hier** zurückgegeben |
| GET | `/api/devices/enroll-tokens` | Operator | Offene Token auflisten |
| DELETE | `/api/devices/enroll-tokens/{token_id}` | Operator | Token widerrufen |

## Jobs und Skripte

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| POST | `/api/devices/{device_id}/jobs` | Operator | Shell-Kommando oder Skript ausführen. 404 bei unbekanntem Gerät, 422 bei leerem Befehl. Ist das Gerät offline, kommt **200** mit einem sofort auf `failed` gesetzten Job zurück — die Warteschlange läuft nicht voll |
| GET | `/api/devices/{device_id}/jobs` | Operator | Job-Historie des Geräts |
| GET | `/api/jobs/{job_id}` | Operator | Einzelner Job inkl. Output |
| WS | `/api/jobs/{job_id}/ws` | Operator | Live-Output, siehe unten |
| GET | `/api/scripts` | Operator | Skript-Bibliothek |
| POST | `/api/scripts` | Operator | Skript anlegen |
| PUT | `/api/scripts/{script_id}` | Operator | Skript ändern |
| DELETE | `/api/scripts/{script_id}` | Operator | Skript löschen |

## Patches

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/patches/summary` | Session | Flottenweite Übersicht, für Viewer gefiltert |
| GET | `/api/devices/{device_id}/patches` | Session | Ausstehende Patches eines Geräts |
| POST | `/api/devices/{device_id}/patches/scan` | Operator | Scan anstoßen. 409 ohne offene Agent-Verbindung |
| POST | `/api/devices/{device_id}/patches/install` | Operator | Installations-Job. 409 ohne Verbindung oder bei bereits laufender Installation, 422 wenn nichts aussteht |

## Alarme, Inventar, Audit

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/alerts` | Session | Offene und geschlossene Alarme, Viewer-gefiltert |
| POST | `/api/alerts/{alert_id}/ack` | Session | Alarm quittieren; Scope wird vorher geprüft |
| GET | `/api/inventory/search` | Session | Flottenweite Softwaresuche (`?q=`) |
| GET | `/api/audit` | Admin | Audit-Log (`?limit=`, `?device_id=`) |

## Automatisierung

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/automation` | Session | Patch-Fenster, Regeln und Zeitpläne |
| PUT | `/api/automation` | Admin | Patch-Fenster konfigurieren |
| POST | `/api/automation/rules` | Admin | Alarmregel anlegen |
| PUT | `/api/automation/rules/{rule_id}` | Admin | Alarmregel ändern |
| DELETE | `/api/automation/rules/{rule_id}` | Admin | Alarmregel löschen |
| POST | `/api/automation/schedules` | Admin | Skript-Zeitplan anlegen |
| PUT | `/api/automation/schedules/{sched_id}` | Admin | Zeitplan ändern |
| DELETE | `/api/automation/schedules/{sched_id}` | Admin | Zeitplan löschen |

## Konten, Personen, Passwörter

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/auth/me` | Session | Eigenes Konto und Rolle |
| POST | `/api/auth/totp/setup` | Session | TOTP-Secret + Provisioning-URI erzeugen |
| POST | `/api/auth/totp/confirm` | Session | TOTP aktivieren, liefert 8 Backup-Codes |
| POST | `/api/auth/totp/disable` | Session | TOTP abschalten |
| GET | `/api/auth/sessions` | Session | Eigene aktive Sessions (nur Präfixe) |
| DELETE | `/api/auth/sessions/{token_prefix}` | Session | Eine eigene Session beenden |
| POST | `/api/auth/sessions/revoke-others` | Session | Alle anderen eigenen Sessions beenden |
| GET | `/api/accounts` | Admin | Konten auflisten |
| POST | `/api/accounts` | Admin | Konto anlegen |
| PATCH | `/api/accounts/{user_id}` | Admin | Rolle, Passwort, Sperre, 2FA-Reset. Selbstaussperrung und "letzter Admin" sind blockiert |
| DELETE | `/api/accounts/{user_id}` | Admin | Konto löschen (gleiche Sperren) |
| GET | `/api/persons` | Session | Betreute Personen |
| POST | `/api/persons` | Admin | Person anlegen; legt optional ein Viewer-Konto mit an |
| PUT | `/api/persons/{person_id}` | Admin | Person ändern |
| DELETE | `/api/persons/{person_id}` | Admin | Person löschen; Geräte werden nur entkoppelt, nicht gelöscht |
| GET | `/api/devices/{device_id}/credentials` | Admin | Gespeicherte Geheimnisse — **ohne** Klartext |
| POST | `/api/devices/{device_id}/credentials` | Admin | Geheimnis speichern |
| PUT | `/api/devices/{device_id}/credentials/{cred_id}` | Admin | Geheimnis ändern |
| POST | `/api/devices/{device_id}/credentials/{cred_id}/reveal` | Admin | Klartext lesen — landet mit Benutzername im Audit-Log |
| DELETE | `/api/devices/{device_id}/credentials/{cred_id}` | Admin | Geheimnis löschen |

## Remote-Desktop und Einstellungen

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/remote/config` | Session | Relay-Host und Public Key, oder "nicht konfiguriert" |
| GET | `/api/remote/devices/{device_id}/session` | Operator | `rustdesk://`-Deep-Link für das Gerät. 409, wenn Remote-Desktop nicht konfiguriert ist oder keine RustDesk-ID vorliegt |
| GET | `/api/settings/ntfy` | Admin | ntfy-Konfiguration (Token maskiert) |
| PUT | `/api/settings/ntfy` | Admin | ntfy zur Laufzeit umkonfigurieren |
| POST | `/api/settings/ntfy/test` | Admin | Testnachricht senden |
| WS | `/api/fleet/ws` | Session | Refresh-Hinweise, siehe unten |

---

# WebSocket-Protokoll

Alle Nachrichten sind JSON-Objekte mit einem `type`-Feld. Nicht-Objekte
werden ignoriert; ungültiges JSON schließt den Socket mit Code `1003`.

## `/api/agent/ws` — Agent ⇄ Server

Auth über `Authorization: Bearer <device_id>:<device_secret>`. Der Socket
wird zuerst angenommen und dann mit `4401` geschlossen, wenn die Credentials
nicht stimmen; `4403`, wenn das Gerät zwischenzeitlich entfernt wurde.

Verbindet sich ein Gerät erneut, während noch ein alter Socket registriert
ist, wird der alte mit `1000` abgelöst.

### Agent → Server

| `type` | Payload | Wirkung |
|---|---|---|
| `heartbeat` | `cpu_pct`, `mem_pct`, `disks[]`, `agent_version`, Netz/Temperatur/Akku/Benutzer | Aktualisiert das Gerät, schreibt ein Metrik-Sample. Beim ersten Heartbeat einer Verbindung bietet der Server ggf. ein Update an |
| `inventory` | `kind` + Nutzdaten | Speichert Hardware-, Software- oder Netzinventar |
| `job_started` | `job_id` | Status → `running` |
| `job_output` | `job_id`, `chunk` | Chunk läuft durch die Geheimnis-Extraktion, dann in DB und Live-Socket |
| `job_result` | `job_id`, `status`, `exit_code` | Schließt den Job ab |
| `patch_report` | `patches[]` | Ersetzt die ausstehenden Patches des Geräts, sendet Fleet-Hinweis |
| `agent_logs` | `lines[]` | Antwort auf eine `get_logs`-Anfrage |
| `ping` | — | Server antwortet mit `pong` |
| `pong` | — | wird ignoriert |

Unbekannte Typen werden geloggt und ignoriert.

### Server → Agent

| `type` | Payload | Wann |
|---|---|---|
| `job` | `job_id`, `kind`, `command`, `shell`, optional `patch_ids`, `timeout_s` | Beim Anlegen eines Jobs |
| `patch_scan` | — | `POST /api/devices/{id}/patches/scan` |
| `get_logs` | — | `GET /api/devices/{id}/agent-logs` |
| `update` | `version`, `url`, `sha256`, `sig` | Einmal pro Verbindung beim ersten Heartbeat, oder auf Anforderung |
| `pong` | — | Antwort auf `ping` |

## `/api/jobs/{job_id}/ws` — Server → Browser

Auth über das Session-Cookie; `4401` unauthentifiziert, `4403` für Rollen
außer `admin`/`techniker`, `4404` bei unbekanntem Job.

| `type` | Inhalt |
|---|---|
| `snapshot` | Der Job wie er gerade ist — auch bei bereits beendeten Jobs |
| `status` | `running` |
| `output` | `chunk` |
| `done` | `status`, `exit_code`; danach wird der Socket geschlossen |
| `ping` | Keepalive alle 30 s ohne Verkehr |

## `/api/fleet/ws` — Server → Browser

Auth über das Session-Cookie, jede Rolle; `4401` unauthentifiziert.

| `type` | Inhalt |
|---|---|
| `refresh` | `kind` ∈ `device_online`, `device_offline`, `patches`, `alert` |
| `ping` | Keepalive alle 30 s ohne Verkehr |

Die Hinweise tragen keine Nutzdaten. Der Browser liest daraufhin die
REST-Endpunkte neu — Autorisierung bleibt damit ausschließlich in der
REST-Schicht.
