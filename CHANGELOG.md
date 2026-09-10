# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/);
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
- **Geräteliste neu:** Statuspunkt, Hostname, OS-Chip und eine Unterzeile
  `OS · Tag · Tag` bilden einen Block; die eigene Tags-Spalte entfällt. CPU,
  RAM und Disk sind beschriftete Balken, deren Farbe auf die Last reagiert —
  grün, ab 70/75/80 % gelb, ab 90 % rot. Die Disk-Schwellen sind identisch mit
  denen des Statuspunkts, damit beide nie widersprüchlich aussehen.
- **Segmentierte Filterleiste** mit Trefferzahlen (`components/FilterBar.tsx`)
  statt einer Reihe loser Buttons: eine Tab-Station, Pfeiltasten wechseln, und
  jede Zahl sagt vorab, was der Filter übrig lässt.
- **Blätterleiste für alle langen Listen** — Geräte, Alarme, Patches, Skripte,
  Konten, Job-Verlauf, Audit. 25 pro Seite als Default, 50/100/alle wählbar,
  Auswahl je Liste im Browser gemerkt. Die Liste „kürzlich behobene Alarme"
  verliert ihren harten Schnitt nach acht Einträgen.
- **Personen als Master-Detail:** links die Liste, rechts alles zu einer
  Person — Kennzahlen (Geräte, online, offene Alarme, offene Updates,
  Sicherheitsupdates), Notiz, zugewiesene Geräte samt Patch-Stand,
  Gerätezuweisung, das verknüpfte Konto (Rolle, letzter Login, Zwei-Faktor,
  Passwort zurücksetzen) und ein auf die Person gefilterter Aktivitätsverlauf.
- **Skript-Bibliothek:** Vorlagen haben eine eigene Galerie statt eines
  versteckten Auswahlfelds und sind von 4 auf 12 gewachsen (Temp-Cleanup,
  Paketcache, Drucker-Spooler, Netzwerk-Diagnose für Linux und Windows,
  Speicherplatz-Report, Windows-Update-Reset, Neustart). Skripte tragen eine
  Kategorie, lassen sich mit einem Stern markieren, als **destruktiv**
  kennzeichnen (Ausführen verlangt dann die Eingabe des Namens) und
  duplizieren.
- **Audit-Log ist ein Werkzeug geworden:** Filter nach Zeitraum, Kategorie,
  Akteur, Gerät und Freitext (auch im `detail`-Blob), ein Schnellfilter
  „Sicherheit", serverseitige Blätterung mit Gesamtzahl, farbige Kategorien,
  ausklappbare Zeilen mit allen Feldern des Ereignisses und Tagestrenner
  („Heute", „Gestern", Datum). Neuer Endpunkt `/api/audit/meta`.
- Optionale `.pre-commit-config.yaml` (ruff, gofmt, go vet, eslint, tsc, plus
  ein Riegel gegen versehentlich eingecheckte Secret-Dateien).
- Agent-Tests von 4 auf 17: apt-Ausgabe-Parser (dafür aus der
  Kommandoausführung herausgelöst), Log-Ringpuffer inkl. Nebenläufigkeit,
  Shell-Auswahl und Timeout-Deckelung, Rechte der Konfigurationsdatei.
- CI prüft jetzt auch Frontend-Lint und Frontend-Tests und hat einen eigenen
  Audit-Job (`pip-audit`, `npm audit`, `govulncheck`). Vorher gab es
  überhaupt kein Dependency-Gate.
- Dependabot für pip, npm, Go, GitHub Actions und die Basis-Images.
- `/api/ready`: Readiness-Endpunkt, der die Datenbank prüft und sonst 503
  liefert. `deploy.sh` gated darauf, nicht mehr nur auf den Liveness-Check.
- Beide Anwendungscontainer laufen als uid 10001, ohne Capabilities und mit
  `no-new-privileges`; der Web-Container hat jetzt ebenfalls einen
  Healthcheck. **Achtung:** ein bestehendes Volume `rxf-rmm-data` braucht
  einmalig einen `chown` — siehe `docs/OPERATIONS.md`.
- `rustdesk/rustdesk-server` ist auf 1.1.16 gepinnt statt `:latest`.
- Frontend-Lint-Gate (ESLint mit typescript-eslint, react-hooks und jsx-a11y)
  und Frontend-Tests (Vitest + Testing Library). Vorher gab es für das
  Dashboard weder das eine noch das andere.
- `components/Modal.tsx`: Dialoge mit Fokusfalle, Escape, Fokus-Rückgabe und
  `role="dialog"`.
- Echte URLs (react-router): Geräteseiten sind verlinkbar, der Zurück-Button
  funktioniert, ein Reload landet dort, wo man war.
- Bestätigungsdialoge für Patch-Installation, Ad-hoc-Befehl und Agent-Update —
  drei Aktionen, die vorher ohne Rückfrage liefen.
- `ErrorBoundary`: ein Renderfehler zeigt eine Meldung statt einer weißen
  Seite.
- `docs/PRIVACY.md`: was auf einem betreuten Gerät gemeldet wird und was
  nicht, in einfachem Deutsch für die betreute Person geschrieben.
- Dokumentation: `docs/ARCHITECTURE.md`, `docs/API.md`,
  `docs/CONFIGURATION.md`, `docs/OPERATIONS.md`, `docs/TROUBLESHOOTING.md`,
  `SECURITY.md`, `CONTRIBUTING.md`, dieses Changelog, `LICENSE` (Apache-2.0)
  und Issue-/PR-Vorlagen.
- `.env.example` enthält jetzt auch `CLEANUP_INTERVAL_S`, `ALERT_INTERVAL_S`,
  `METRICS_RAW_RETENTION_H` und `METRICS_HOURLY_RETENTION_D`.

### Geändert
- Alle Module öffnen die Datenbank über einen gemeinsamen Helfer
  (`app/db.py`), der Fremdschlüssel einschaltet. Vorher taten das zwei von
  zwölf, wodurch `ON DELETE CASCADE` davon abhing, welches Modul das DELETE
  ausführte.
- Die Schema-Version steht jetzt in der Datenbank (`schema_meta`). Läuft ein
  älterer Build gegen eine neuere Datei, gibt es eine Warnung im Log statt
  gar keines Hinweises.
- Der ruff-Regelsatz ist explizit in `pyproject.toml` aufgeführt und die
  ruff-Version auf die 0.16er-Reihe gepinnt. Vorher hätte eine neue
  ruff-Version das Lint-Gate ohne Codeänderung rot gemacht.
- README neu strukturiert; die Beschreibung der CD-Pipeline entsprach nicht
  mehr der Realität (SSH statt Self-hosted Runner).

### Sicherheit
- Go-Toolchain für den Agent von 1.25.0 auf 1.25.14 angehoben. `govulncheck`
  meldete 25 erreichbare Schwachstellen in der Standardbibliothek — betroffen
  waren TLS-Handshake, URL-Parsing und Cookie-Verarbeitung im WebSocket-Dialer,
  also Code, den jeder ausgelieferte Agent ausführt.
- Die Enrollment- und Setup-Endpunkte sind jetzt rate-limitiert (20
  Fehlversuche pro IP in 300 s). Vorher war der einzige unauthentifizierte
  Bereich neben dem Login unbegrenzt abfragbar.
- Das Backend startet nicht mehr mit `--proxy-headers --forwarded-allow-ips "*"`.
  Uvicorn hat damit `request.client` aus einem Header übernommen, den jeder
  Aufrufer setzen kann — also genau den Wert, auf den das Login-Rate-Limit
  zurückfällt, wenn `TRUST_PROXY_HEADERS` aus ist.
- Das Dashboard bietet keinen kopierbaren Download-Link mit Token in der URL
  mehr an. Beide verbleibenden Wege übergeben das Token im Header.

### Geändert
- Build und CI laufen auf **Node 24 (LTS)** statt 22 — und beide zusammen:
  der Major steht in `frontend/Dockerfile` und in `node-version` in `ci.yml`,
  ein Auseinanderlaufen zeigte sich sonst erst beim Deploy. Dependabot
  ignoriert den Node-Major deshalb; es sieht nur den Dockerfile.
- Dependabot ignoriert außerdem die Majors von `eslint`, `@eslint/js` und
  `typescript`: alle drei lassen sich derzeit nicht installieren
  (`eslint-plugin-jsx-a11y` hat als Peer nur eslint ≤ 9, `typescript-eslint@8`
  nur typescript < 6.1), und ohne die Regel legt Dependabot die PRs jede Woche
  neu an. Minor- und Patch-Updates dieser Pakete laufen weiter.

### Behoben
- Der `web`-Container startete nach der Härtung überhaupt nicht mehr:
  `exec /usr/bin/caddy: operation not permitted`, Exit 255, Neustartschleife,
  Port 80 tot. Ursache ist nicht ein Schreibrecht, sondern `execve` selbst:
  `/usr/bin/caddy` trägt die Datei-Capability `cap_net_bind_service=ep`, und
  ein gesetztes *effective*-Bit bei fehlender Capability im Bounding-Set lässt
  den Kernel den Exec verweigern. `cap_drop: ALL` allein macht den Container
  damit unstartbar. `cap_add: NET_BIND_SERVICE` bringt genau diese eine
  Capability ins Bounding-Set zurück; alles andere bleibt entzogen.
- `deploy.sh` meldete einen erfolgreichen Deploy, während der `web`-Container
  in `Restarting (255)` hing und Port 80 nichts beantwortete. Die Gates
  prüften nur das Backend — `web` ist aber der einzige Dienst mit Host-Port.
  Neues drittes Gate: `curl http://127.0.0.1/api/ready` über den
  veröffentlichten Port, also die Strecke, die Browser und Cloudflare Tunnel
  tatsächlich nehmen.
- Caddys `XDG_DATA_HOME`/`XDG_CONFIG_HOME` liegen jetzt unter `/caddyhome`.
  Das Basis-Image `caddy:2-alpine` deklariert `VOLUME /data` und
  `VOLUME /config` und legt die beiden Verzeichnisse dorthin; Docker verwirft
  aber, was ein späterer Build-Schritt unterhalb eines vom Basis-Image
  deklarierten Volumes schreibt, sodass der `chown` im `frontend/Dockerfile`
  wirkungslos blieb und Caddy als uid 10001 seinen Zustand nicht hätte
  schreiben können. (Der Ausfall des Web-Containers kam **nicht** daher — das
  war die fehlende Capability, siehe oben. Diese Änderung ist trotzdem
  richtig: der wirkungslose `chown` war ein echter Defekt.)
- Der dokumentierte Besitzerwechsel für das Datenvolumen war an zwei Stellen
  falsch und hat den ersten Deploy nach der Umstellung auf uid 10001
  scheitern lassen. Erstens nannte er den Compose-Schlüssel statt des
  Volumenamens — Compose stellt den Projektnamen voran
  (`infrastructure_rxf-rmm-data`), sodass ein neues leeres Volume angelegt und
  das echte nicht angefasst wurde. Zweitens lief der Ersatzbefehl über
  `docker compose run` und erbte damit `cap_drop: ALL`, worauf `chown` auch
  als root an fehlendem `CAP_CHOWN` scheiterte. Beides korrigiert, mit
  Prüfschritt und Begründung in `docs/OPERATIONS.md`.
- Der Live-Job-Stream blieb nach einem Verbindungsabbruch stumm stehen. Er
  verbindet jetzt mit Backoff neu und zeigt den Abbruch an.
- Dialoge waren für Tastatur und Screenreader nicht bedienbar: Klick-Handler
  auf `div`s, keine `role="dialog"`, Fokus blieb hinter dem Dialog.
- Formularfelder hatten Beschriftungen ohne Zuordnung (`span` statt `label`).
- Eine Erfolgsmeldung („Magic Packet gesendet") wurde als Fehler in Rot
  ausgegeben, weil sie durch den Fehlerkanal lief.
- Eine abgelaufene Session ließ das Dashboard hinter einem Fehlerbanner
  stehen, das nie aufging: die Poller liefen weiter gegen 401. Jeder 401
  führt jetzt zurück zur Anmeldung.
- Der Fleet-WebSocket verband sich mit festen 5 s neu — ein länger nicht
  erreichbares Backend bekam damit von jedem offenen Tab zwölf Versuche pro
  Minute. Jetzt exponentiell bis 60 s.
- Vier Ladevorgänge verschluckten ihren Fehler kommentarlos; eine nicht
  geladene Skript- oder Personenliste sah damit aus wie „es gibt keine".
- Das Löschen eines Geräts räumte seine Alarme nicht mit ab. Die Zeilen
  blieben in der Historie stehen und verwiesen auf eine Geräte-ID, die es
  nicht mehr gab.
- Ein Fehler in einem der beiden Hintergrund-Loops wurde beim Herunterfahren
  stillschweigend verschluckt; er wird jetzt geloggt.
- Fleet-Broadcasts konnten von der Garbage Collection abgeräumt werden, bevor
  sie gesendet waren — der Task wird jetzt referenziert gehalten.
- `assert`-Invarianten in Produktionscode (die unter `python -O` verschwinden)
  durch echte Fehlerpfade ersetzt.
- Die Mindestpasswortlänge galt nur im Auth-Router. Ein zu kurzes
  `BOOTSTRAP_ADMIN_PASSWORD` legte damit stillschweigend ein Admin-Konto mit
  schwachem Passwort an. Die Regel gilt jetzt in `accounts`, also auf jedem
  Weg; der Bootstrap lehnt ab und sagt warum.
- `CORS_ORIGINS` akzeptiert jetzt auch eine kommagetrennte Liste oder eine
  einzelne Origin. Vorher brach der Start mit einem `SettingsError` ohne
  Hinweis auf die erwartete JSON-Schreibweise ab.
- Der Passwort-Tresor legt einen Eintrag jetzt neu an, wenn er zwischen
  Suche und Aktualisierung gelöscht wurde, statt einen Fehler zu liefern.
- Die Installer stoppen einen bereits laufenden Dienst, bevor sie die Binary
  überschreiben. Unter Linux scheiterte ein zweiter Lauf sonst mit
  „Text file busy"; der Windows-Installer machte das schon richtig.
- `install.sh` bricht bei einer nicht unterstützten Architektur mit einer
  aussagekräftigen Meldung ab statt mit „no matching agent binary".

---

Für den Weg zum ersten vollständigen Funktionsumfang (Phasen 0–7) siehe
[`docs/_archiv/RMM-PLAN.md`](docs/_archiv/RMM-PLAN.md).
