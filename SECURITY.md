# Sicherheit

Stand: 07.09.2026.

## Schwachstelle melden

Bitte **kein öffentliches Issue** anlegen. Meldungen gehen an
<robinfrank1824@gmail.com>, gern mit „Vulpexa Security" im Betreff.

Hilfreich sind: betroffene Version oder Commit, betroffene Komponente
(Backend / Dashboard / Agent / Infrastruktur), Reproduktionsschritte und die
Auswirkung, die du siehst. Eine erste Rückmeldung kommt innerhalb weniger
Tage — das hier ist ein privat betriebenes Projekt ohne
Bereitschaftsdienst, kein SLA.

Unterstützte Version ist ausschließlich der aktuelle Stand von `main`.

## Bedrohungsmodell

Was das System schützen soll, in absteigender Wichtigkeit:

1. **Fernzugriff auf verwaltete Geräte.** Wer Jobs auslösen kann, hat root
   bzw. SYSTEM auf jedem Gerät der Flotte. Das ist das eigentliche Kronjuwel.
2. **Der Passwort-Tresor.** BitLocker-Recovery-Keys und Gerätepasswörter.
3. **Inventar- und Telemetriedaten.** Wer betreut wird, welche Software läuft,
   wann jemand am Rechner sitzt — für die betreuten Personen relevant.
4. **Verfügbarkeit.** Nachrangig; ein Ausfall kostet Monitoring, keine Daten.

### Angreifer, gegen die das System ausgelegt ist

| Angreifer | Kann | Abwehr |
|---|---|---|
| Internet, unauthentifiziert | Nur `/api/health`, `/api/auth/login` und die Agent-Endpunkte erreichen | Alle anderen Endpunkte hinter Session-Auth; Login rate-limitiert (5 Fehlversuche / 300 s pro IP), Enrollment- und Setup-Endpunkte ebenso (20 / 300 s) |
| Besitzer eines Enrollment-Tokens | Genau ein Gerät anmelden | Token ist einmalig, läuft ab, ist widerrufbar; Verbrauch ist ein bedingtes UPDATE, also race-fest |
| Kompromittierter Agent | Ausschließlich Daten für die eigene `device_id` melden | Bearer-Auth pro Gerät; kein Endpunkt erlaubt Zugriff auf fremde Geräte |
| Angemeldeter `viewer` | Nur Geräte der eigenen Person lesen | Rollenprüfung **plus** Datenfilterung pro Endpunkt (`person_scope`, `device_visible`) |
| Angemeldeter `techniker` | Geräte und Jobs verwalten | Kein Zugriff auf Konten, Personen, Passwort-Tresor, Automatisierung, Audit-Log |
| Dieb einer Backup-Datei | Die Datenbank lesen | Passwörter sind Fernet-verschlüsselt; der Schlüssel liegt in einer separaten Datei (0600) |
| LAN-Nachbar mit Zugriff auf Port 80 | Proxy-Header fälschen und so das Rate-Limit umgehen | Caddy strippt sie für jeden Peer außer `TRUSTED_PROXY_CIDR` |

### Ausdrücklich nicht abgedeckt

- **Ein kompromittierter Server ist ein kompromittiertes Netz.** Wer root im
  LXC hat, hat den Fernet-Schlüssel, die Datenbank und die offenen
  Agent-Sockets. Es gibt keine Verteidigung auf Anwendungsebene dagegen, und
  es wird auch keine vorgetäuscht.
- **Der Agent führt beliebige Befehle aus.** Das ist die Funktion, kein
  Fehler. Es gibt keine Kommando-Allowlist und keine Sandbox; die
  Sicherheitsgrenze ist die Autorisierung im Backend.
- **Kein Schutz gegen den Betreiber.** Ein Admin kann alles sehen und tun.
  Das Audit-Log macht es nachvollziehbar, nicht unmöglich.
- **Kein Multi-Tenant-Modell.** Die Viewer-Rolle trennt Sicht, nicht
  Vertrauensbereiche.
- **Kein DoS-Schutz** über die Rate-Limits auf Login und Enrollment hinaus.
- **RustDesk** bringt eigene Ports und ein eigenes Sicherheitsmodell mit, das
  hier nicht mitverantwortet wird.

## Secrets

| Secret | Wo | Schutz |
|---|---|---|
| Benutzerpasswörter | `users.password_hash` | Argon2id; unbekannte Benutzer laufen gegen einen Dummy-Hash, damit die Antwortzeit nichts verrät |
| Session-Token | `sessions.token_hash` | Nur SHA-256 gespeichert, plus 8-Zeichen-Präfix für die UI |
| TOTP-Secret und Backup-Codes | `users` | Backup-Codes als SHA-256; jeder ist einmal verwendbar |
| Enrollment-Token | `enrollment_tokens.token_hash` | Nur SHA-256; Klartext existiert genau einmal in der API-Antwort |
| Geräte-Secret | `devices.device_secret_hash` | Nur SHA-256; Vergleich mit `hmac.compare_digest` |
| Geräte-Passwörter | `device_credentials.secret_enc` | Fernet; Schlüssel in `credentials.key` neben der DB, Modus 0600 |
| ntfy-Token | `.env` oder `app_settings` | Wird in der API maskiert ausgeliefert |
| ed25519-Signierschlüssel | `infrastructure/.agent-sign.env` | Umask 077, gitignored, existiert nur auf der Build-Maschine |

Regeln:

- **Niemals eine echte `.env` committen.** Versioniert ist nur
  `.env.example`; `.gitignore` deckt `.env`, `infrastructure/.env` und
  `infrastructure/.agent-sign.env` ab.
- Geheimnisse gehören nicht in Logs. Job-Output wird vor dem Speichern durch
  die `##RMM-CRED##`-Extraktion geschickt — was ein Skript so markiert, landet
  verschlüsselt im Tresor und **nicht** im Job-Log.
- Jeder Klartext-Zugriff auf den Tresor wird mit Benutzername im Audit-Log
  festgehalten.

## Schlüsselrotation

### ed25519-Update-Signaturschlüssel

Der Public Key ist zur Build-Zeit in jede Agent-Binary eingebrannt. Eine
Rotation ist deshalb **kein reiner Serverschritt**: Agents mit dem alten Key
akzeptieren kein Release, das mit dem neuen signiert ist.

```bash
cd /opt/rxf-rmm/infrastructure
mv .agent-sign.env .agent-sign.env.old      # alten Schlüssel aufheben
./build-agent.sh keygen                     # neues Paar
./build-agent.sh 0.4.0                      # signiert mit dem neuen Schlüssel
```

Danach müssen **alle bestehenden Agents einmal manuell neu installiert
werden** (der Einzeiler aus dem Dashboard genügt). Bis dahin bleiben sie auf
ihrer Version stehen — sie melden weiter Daten, aktualisieren sich aber nicht
mehr. Das ist genau das gewollte Fail-safe-Verhalten.

Rotieren, wenn: der private Schlüssel abhandengekommen sein könnte, die
Build-Maschine kompromittiert war, oder er versehentlich veröffentlicht wurde.

### Fernet-Schlüssel des Passwort-Tresors

Es gibt **keine automatische Rotation**. Wird `credentials.key` ersetzt, sind
alle vorhandenen Einträge unlesbar. Der Ablauf ist deshalb: Werte über die
Reveal-Funktion sichern, Einträge löschen, Schlüssel ersetzen, Backend neu
starten (der Schlüssel wird beim ersten Zugriff neu erzeugt), Werte neu
anlegen.

### Geräte-Secrets

Ein neues Secret gibt es nur über ein erneutes Enrollment. Bei Verdacht: Gerät
im Dashboard löschen — das kappt den Zugang sofort, laufende Sockets werden
mit `4403` geschlossen — und mit einem frischen Token neu anmelden.

### Session-Token und Passwörter

- Eigene Sessions: Admin → Sessions → einzeln oder „alle anderen beenden".
- Fremdes Konto: Passwort ändern oder Konto sperren; beides löscht dessen
  Sessions.
- TOTP zurücksetzen ist Admin-Funktion und im Audit-Log sichtbar.

## Härtung, die der Betreiber leisten muss

Diese Punkte kann das Repo nicht für sich selbst erledigen:

| Punkt | Warum |
|---|---|
| `BOOTSTRAP_ADMIN_PASSWORD` nach dem ersten Login leeren | Sonst steht ein Passwort dauerhaft in `.env` |
| `TRUSTED_PROXY_CIDR` korrekt setzen | Sonst ist das Login-Rate-Limit faktisch wirkungslos |
| Port 80 des LXC nicht ins offene Netz hängen | Der Tunnel ist der einzige vorgesehene Weg von außen |
| TOTP für alle Admin-Konten aktivieren | Passwort allein schützt Fernzugriff auf die ganze Flotte |
| `.agent-sign.env` außerhalb des Servers sichern | Verlust erzwingt eine Neuinstallation aller Agents |
| Backups verschlüsselt ablegen | Sie enthalten die vollständige Datenbank |
| Docker-Gruppenmitgliedschaft des CI-Runners begrenzen | Docker-Gruppe ist faktisch root; in `DEPLOYMENT.md` als bewusstes Restrisiko benannt |

## Bekannte Restrisiken

| Risiko | Bewertung | Warum es so bleibt |
|---|---|---|
| Agent führt beliebige Befehle als root/SYSTEM aus | Nach Design | Das ist die Funktion eines RMM |
| Kein Kommando-Audit auf dem Gerät selbst | Mittel | Der serverseitige Audit-Log deckt es ab, solange der Server integer ist |
| Installer entfernt unter Windows die Mark-of-the-Web (`Unblock-File`) | Mittel | Ohne Code-Signing-Zertifikat blockiert SmartScreen sonst den Dienststart. Dokumentiert in `agent/install/README.md` |
| Erstinstallation prüft die Binary nicht kryptografisch | Mittel | Der Download läuft über HTTPS mit Token-Auth; die Signaturkette greift ab dem ersten Update |
| RustDesk braucht offene Router-Ports | Mittel | Der Tunnel unterstützt das Protokoll nicht; Alternative in `infrastructure/RUSTDESK.md` |
| Kein DoS-Schutz jenseits des Login-Limits | Niedrig | Interne Installation hinter Cloudflare |
