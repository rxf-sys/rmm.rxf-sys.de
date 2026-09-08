# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/);
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
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

### Behoben
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
