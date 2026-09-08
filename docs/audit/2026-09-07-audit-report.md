# Audit-Report — 07.09.2026

Branch `chore/audit-2026-09-07`, 16 Commits, ausgehend von `main` (`1a7bc32`).
Nicht gepusht.

Jede Aussage in diesem Bericht ist belegt: Behauptung links, Fundstelle
(`Datei:Zeile`) oder Commit-Hash rechts. Wo etwas nicht überprüfbar war, steht
das ausdrücklich dabei.

---

## 1. Executive Summary

### Ausgangslage

Das Repo war funktional deutlich weiter, als seine Dokumentation behauptete.
Alle acht geplanten Phasen waren real umgesetzt — kein einziges `TODO`,
`FIXME` oder `NotImplementedError` im Backend —, aber die Doku beschrieb
teilweise einen Stand von vor Monaten, und drei Bereiche hatten strukturelle
Lücken:

- **Das Lint-Gate war faktisch kaputt.** `ruff` war ungepinnt und ohne
  expliziten Regelsatz (`backend/pyproject.toml:23`). Ruff 0.16 hat den
  Default-Satz erweitert; `ruff check .` lieferte **137 Fehler**. Da
  `cd.yml` nur nach grünem CI deployt, hätte der nächste Push das
  Deployment blockiert — ohne dass sich am Code etwas geändert hätte.
- **Das Frontend hatte weder Linter noch einen einzigen Test** — bei
  8.485 Zeilen.
- **Es gab kein Dependency-Gate** in keinem der drei Ökosysteme;
  `npm ci --no-audit` schaltete npms eigene Prüfung sogar aktiv ab.

### Ergebnis

37 Findings bearbeitet, davon 34 behoben und 3 bewusst offengelassen. Alle
Gates laufen grün:

| Gate | Ergebnis |
|---|---|
| `ruff check .` | sauber |
| `pytest --cov=app --cov-fail-under=70` | 178 passed, Coverage 89,58 %, 1:54 min |
| `npm run lint` (neu) | sauber |
| `npm test` (neu) | 20 passed |
| `npm run build` | grün, 4,2 s |
| `npm audit` | 0 Schwachstellen |
| `pip-audit --strict .` | keine bekannten Schwachstellen |
| `go vet ./...` / `go test ./...` | sauber, 17 Testfunktionen |
| `make release` | 5 Targets gebaut |

### Live-Readiness: **Ready mit Auflagen**

Die Anwendung ist betriebsbereit. Die Auflagen sind keine Restarbeiten am
Code, sondern Schritte, die nur auf dem Zielsystem ausgeführt werden können
und die ich hier bewusst nicht angefasst habe:

1. **Einmaliger `chown` des Datenvolumes.** Die Container laufen jetzt als
   uid 10001 (`backend/Dockerfile`, Commit `08f3b33`). Ein bestehendes
   `rxf-rmm-data` gehört root; ohne den einmaligen Besitzerwechsel startet
   das Backend in einer Neustartschleife. Kommando in
   [`../OPERATIONS.md`](../OPERATIONS.md#container-härtung) und in der
   Checkliste unten.
2. **Restore einmal wirklich durchspielen.** Die SQLite-Mechanik von
   `backup.sh` habe ich nachgestellt und verifiziert (Online-Backup bei
   offener Schreibtransaktion → `integrity_check = ok`, nur committete
   Zeilen). Die Container-Schritte drumherum sind **ungetestet**: in dieser
   Umgebung gibt es keinen Docker-Daemon.
3. **`TRUSTED_PROXY_CIDR` prüfen.** Steht der Default `127.0.0.1/32`, sieht
   das Backend nur die Container-IP und das Login-Rate-Limit gilt faktisch
   global statt pro Angreifer (`frontend/Caddyfile:10-15`).

Ohne diese drei Punkte ist der Zustand **nicht** „ready" — Punkt 1 würde den
nächsten Deploy zum Scheitern bringen.

---

## 2. Erledigt

Schweregrade: **K** kritisch · **H** hoch · **M** mittel · **N** niedrig.

### CI/CD und Werkzeuge

| ID | Rolle | Sev | Finding | Fix | Commit | Datei(en) |
|---|---|---|---|---|---|---|
| C-01 | CI/CD | **K** | `ruff>=0.7` ungepinnt, Regelsatz implizit → 137 Fehler mit ruff 0.16, CI und damit CD blockiert | Regelsatz explizit aufgeführt, Version auf `>=0.16.6,<0.17` gepinnt, alle 137 Findings einzeln behandelt | `abb3073` | `backend/pyproject.toml` |
| C-02 | CI/CD | **H** | Kein Dependency-Gate in keinem Ökosystem | Eigener `audit`-Job mit Matrix pip-audit / npm audit / govulncheck; blockiert über `cd.yml` auch den Deploy | `79fdba0` | `.github/workflows/ci.yml` |
| C-03 | CI/CD | **M** | Frontend nur durch `npm run build` geprüft | `npm run lint` und `npm test` als eigene CI-Schritte | `79fdba0` | `.github/workflows/ci.yml` |
| C-04 | CI/CD | **N** | Kein Dependabot, kein pip-Caching | Dependabot für pip/npm/Go/Actions/Docker; pip-Cache im Backend-Job | `79fdba0` | `.github/dependabot.yml` |
| C-05 | Neuer Dev | **N** | Kein Pre-Commit-Hook | Optionale `.pre-commit-config.yaml` (ruff, gofmt, go vet, eslint, tsc) inkl. Riegel gegen eingecheckte Secret-Dateien | `bb7d448` | `.pre-commit-config.yaml` |

### Security

| ID | Rolle | Sev | Finding | Fix | Commit | Datei(en) |
|---|---|---|---|---|---|---|
| S-01 | Security | **H** | `--forwarded-allow-ips "*"`: uvicorn übernahm `request.client` aus einem Header, den jeder Aufrufer setzen kann — genau der Wert, auf den das Login-Rate-Limit zurückfällt | Flags entfernt; die Anwendung liest Proxy-Header selbst und nur bei `TRUST_PROXY_HEADERS` | `6f45930` | `backend/Dockerfile:14` |
| S-02 | Security | **H** | Enroll- und Setup-Endpunkte unbegrenzt abfragbar — freies „gültig/ungültig"-Orakel für ein abhandengekommenes Token | Rate-Limit 20 Fehlversuche/300 s pro IP; Limiter aus dem Auth-Router extrahiert | `6f45930` | `backend/app/ratelimit.py`, `routers/agent.py` |
| S-03 | Security | **H** | Kopierbarer Download-Link trug ein aktives Enrollment-Token als URL-Query → Browser-History, Zwischenablage, Caddy- und Cloudflare-Logs | Ersetzt durch einen PowerShell-Einzeiler mit Token im Header | `6f45930` | `frontend/src/components/EnrollModal.tsx:93` |
| S-04 | Selbsthoster | **H** | Mindestpasswortlänge galt nur im Auth-Router; `BOOTSTRAP_ADMIN_PASSWORD=kurz` legte stillschweigend einen schwachen Admin an — auf einem Werkzeug, das auf jedem Gerät Befehle als root ausführt | `MIN_PASSWORD_LEN` in `accounts` verlegt, greift auf allen drei Wegen; Bootstrap lehnt ab und nennt den Grund | `c516d9e` | `backend/app/accounts.py:83,138` |
| S-05 | Familie | **M** | RUSTDESK.md beschrieb ausschließlich den unbeaufsichtigten Zugriff, also den Modus ohne Zustimmungsabfrage | Beide Betriebsarten mit Empfehlung dokumentiert; CLI-Weg als nicht verifiziert gekennzeichnet | `c8aabab` | `infrastructure/RUSTDESK.md:63` |
| S-06 | Familie | **M** | Kein Dokument, das der betreuten Person sagt, was gemeldet wird | `docs/PRIVACY.md` mit Positiv- und Negativliste, aus `agent/metrics.go` und `agent/inventory.go` abgeglichen | `c8aabab` | `docs/PRIVACY.md` |

### Backend

| ID | Rolle | Sev | Finding | Fix | Commit | Datei(en) |
|---|---|---|---|---|---|---|
| B-01 | Backend | **M** | `except (asyncio.CancelledError, Exception): pass` im Lifespan verschluckte einen abgestürzten Hintergrund-Loop | `asyncio.gather(..., return_exceptions=True)`, echte Exceptions werden geloggt | `abb3073` | `backend/app/main.py:140` |
| B-02 | Backend | **M** | Fremdschlüssel wurden nur von 2 von 12 Modulen eingeschaltet — SQLite schaltet sie pro Verbindung ab, `ON DELETE CASCADE` hing also davon ab, welches Modul das DELETE ausführte | Gemeinsamer `app/db.py:connect()` für alle elf Module, Busy-Timeout explizit | `9824759` | `backend/app/db.py` |
| B-03 | Backend | **M** | Löschen eines Geräts räumte seine Alarme nicht mit ab; vier andere Tabellen schon | `alerts.delete_for_device()` und Einbindung in den Löschpfad | `9824759` | `backend/app/alerts.py`, `routers/devices.py` |
| B-04 | Backend | **M** | `loop.create_task()` ohne gehaltene Referenz — asyncio hält nur eine schwache, ein Fleet-Broadcast konnte mitten im Senden weggeräumt werden | Task-Set mit Done-Callback | `abb3073` | `backend/app/fleet_ws.py:28` |
| B-05 | Backend | **M** | Neun `assert`-Invarianten in Produktionscode; unter `python -O` verschwinden sie und die Funktionen liefern `None` | Durch echte Fehlerpfade ersetzt; `_vault()`-Accessor für den Fernet-Schlüssel | `abb3073` | `accounts.py`, `automation.py`, `credentials.py`, `persons.py` |
| B-06 | Backend | **N** | Upsert im Passwort-Tresor scheiterte, wenn die Zeile zwischen SELECT und UPDATE gelöscht wurde | Fällt jetzt auf „neu anlegen" durch | `abb3073` | `backend/app/credentials.py:204` |
| B-07 | Backend | **N** | `except (TimeoutError, Exception)` gab jeden Fehler als „Agent antwortet nicht" aus | Nur noch `TimeoutError`, mit Log-Zeile | `abb3073` | `backend/app/agents_ws.py:38` |
| B-08 | SRE | **M** | Keine Schema-Version in der Datenbank — ein Rollback war von außen nicht erkennbar | `schema_meta` mit `SCHEMA_VERSION`; Warnung statt Startabbruch, weil die Migrationen additiv sind | `9824759` | `backend/app/db.py` |
| B-09 | Selbsthoster | **M** | `CORS_ORIGINS=https://…` (die naheliegende Schreibweise) brach den Start mit einem `SettingsError` ohne Hinweis ab | Feld nimmt JSON-Liste, kommagetrennte Liste und einzelne Origin | `c516d9e` | `backend/app/config.py:20` |

### Betrieb

| ID | Rolle | Sev | Finding | Fix | Commit | Datei(en) |
|---|---|---|---|---|---|---|
| O-01 | SRE | **H** | Kein Readiness-Endpunkt: ein Backend mit unerreichbarer Datenbank sah für Healthcheck und Deploy gesund aus | `/api/ready` prüft DB und Kern-Tabellen, 503 sonst; `deploy.sh` gated darauf | `08f3b33` | `backend/app/health.py`, `infrastructure/deploy.sh` |
| O-02 | SRE | **M** | Beide Anwendungscontainer liefen als root, ohne `cap_drop`, ohne `no-new-privileges` | uid 10001, `cap_drop: ALL`, `no-new-privileges`; Caddy auf unprivilegiertem Port 8080 | `08f3b33` | beide `Dockerfile`, `docker-compose.yml` |
| O-03 | SRE | **M** | `rustdesk/rustdesk-server:latest` konnte sich unter einer laufenden Flotte ändern | Gepinnt auf `1.1.16` — die Fassung, auf die `latest` heute zeigt (gegen die Registry geprüft) | `08f3b33` | `infrastructure/docker-compose.yml:87,97` |
| O-04 | SRE | **N** | Web-Container ohne Healthcheck — ein hängender Caddy sah von außen gesund aus | Healthcheck ergänzt | `08f3b33` | `infrastructure/docker-compose.yml` |

### Frontend und UX

| ID | Rolle | Sev | Finding | Fix | Commit | Datei(en) |
|---|---|---|---|---|---|---|
| F-01 | Frontend | **H** | Kein Linter, kein Test bei 8.485 Zeilen | ESLint (typescript-eslint, react-hooks, jsx-a11y) und Vitest + Testing Library | `d7b52a2` | `frontend/eslint.config.js`, `vite.config.ts` |
| F-02 | Frontend | **H** | Vier Dialoge mit `onClick` auf nicht-interaktiven `div`s: per Tastatur nicht schließbar, ohne `role="dialog"`, Fokus blieb dahinter | `components/Modal.tsx` mit Fokusfalle, Escape, Fokus-Rückgabe, `aria-modal` | `d7b52a2` | `frontend/src/components/Modal.tsx` |
| F-03 | Frontend | **H** | Drei Aktionen ohne jede Rückfrage: Patch-Installation, Ad-hoc-Shell-Befehl, Agent-Update | Bestätigungsdialoge, die die Folge benennen (der Shell-Dialog zeigt den Befehl im Wortlaut) | `93ba197` | `frontend/src/components/DeviceDetail.tsx` |
| F-04 | Frontend | **H** | Abgelaufene Session war eine Sackgasse: alle Poller liefen weiter gegen 401, das Dashboard stand hinter einem Banner, das nie aufging | Zentrales 401-Event im API-Client, `useAuth` fällt auf `anon` zurück | `b44a0dd` | `frontend/src/api/client.ts`, `hooks/useAuth.ts` |
| F-05 | Frontend | **M** | Kein Router: Reload landete auf der Übersicht, Zurück-Button verließ die Anwendung, Geräteseiten nicht verlinkbar | react-router mit BrowserRouter; `src/routes.ts` als einzige Pfad-Zuordnung; Rollenweiche für gesperrte Seiten | `93ba197` | `frontend/src/App.tsx`, `routes.ts` |
| F-06 | Frontend | **M** | Ein `<label>` und null `htmlFor` im gesamten Frontend | Acht `div.field` → `label.field` (implizite Zuordnung), übrige Eingaben mit `aria-label` | `d7b52a2` | diverse Komponenten |
| F-07 | Frontend | **M** | `useJobStream` ohne `onclose`/`onerror`: ein abgerissener Socket ließ die Ausgabe kommentarlos stehen — genau beim Beobachten eines Patch-Laufs | Reconnect mit Backoff 1–15 s solange der Job nicht terminal ist, plus `connected`-Flag | `d7b52a2` | `frontend/src/hooks/useJobStream.ts` |
| F-08 | Frontend | **M** | Fleet-Socket reconnectete mit festen 5 s ohne Obergrenze | Exponentiell 2 s → 60 s, Reset bei erfolgreicher Verbindung | `b44a0dd` | `frontend/src/hooks/useFleet.ts` |
| F-09 | Frontend | **M** | Kein Error Boundary: ein Renderfehler hinterließ eine weiße Seite | `ErrorBoundary` mit Meldung und Neu-laden-Knopf | `93ba197` | `frontend/src/components/ErrorBoundary.tsx` |
| F-10 | Frontend | **M** | `window.confirm` an acht Stellen: blockiert den Tab, vom Browser unterdrückbar, kein Platz für die Folge | `ConfirmDialog` + `useConfirm`-Hook (Promise-basiert, damit die Aufrufstellen lesbar bleiben) | `93ba197` | `frontend/src/hooks/useConfirm.tsx` |
| F-11 | Frontend | **N** | Erfolgsmeldung („Magic Packet gesendet") lief durch den Fehlerkanal und erschien rot als Fehler | Eigener Kanal mit `role="status"` | `93ba197` | `frontend/src/components/DeviceDetail.tsx:157` |
| F-12 | Frontend | **N** | Vier Ladevorgänge mit `.catch(() => {})` — eine fehlgeschlagene Abfrage sah aus wie ein leeres Ergebnis | Fehler werden gemeldet; die zwei bewusst leeren Catches haben jetzt eine Begründung | `b44a0dd` | `DeviceDetail.tsx`, `ScheduledScripts.tsx` |
| F-13 | Frontend | **N** | Drei `setState` synchron im Effect → ein Renderdurchlauf mit den Daten des vorherigen Geräts bzw. Jobs | Reset während des Renderings beim Prop-Wechsel | `d7b52a2` | `useJobStream.ts`, `DeviceDetail.tsx`, `DevicesPage.tsx` |
| F-14 | Frontend | **N** | `noUncheckedIndexedAccess` aus; acht ungeprüfte Indexzugriffe | Flag an, alle acht behoben | `d7b52a2` | `tsconfig.json` u. a. |

### Dokumentation

| ID | Rolle | Sev | Finding | Fix | Commit | Datei(en) |
|---|---|---|---|---|---|---|
| D-01 | Alle | **M** | README beschrieb ein SSH-Deployment mit drei Secrets, das es seit `cd.yml` nicht mehr gibt — dieselbe Aussage im Kopfkommentar von `deploy.sh` | Korrigiert, README nach dem üblichen Schema neu strukturiert | `ea30f9c` | `README.md:60`, `infrastructure/deploy.sh:5` |
| D-02 | Alle | **M** | Acht Modul-Docstrings widersprachen dem Code (TOTP „nicht portiert", „admin only" statt operator, Broadcast bei jedem Heartbeat) | Alle acht korrigiert | `6a1abea` | `accounts.py`, `auth.py`, `fleet_ws.py`, `routers/*` |
| D-03 | Alle | **M** | Kein Architektur-, API-, Konfigurations-, Betriebs- oder Troubleshooting-Dokument | Fünf neue Dokumente; die Endpunktliste ist aus der laufenden App erzeugt, die ENV-Tabelle gegen `Settings.model_fields` abgeglichen | `448c330`, `92f2848` | `docs/` |
| D-04 | Alle | **N** | `.env.example` fehlten vier Variablen, die `config.py` kennt | Ergänzt | `92f2848` | `infrastructure/.env.example` |
| D-05 | Alle | **N** | Kein LICENSE, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, keine Vorlagen | Ergänzt (Apache-2.0) | `5520777` | Wurzel, `.github/` |
| D-06 | Alle | **N** | `docs/RMM-PLAN.md` als maßgebliches Dokument, obwohl abgearbeitet und teils überholt | Nach `docs/_archiv/` mit Hinweisbanner; `docs/ROADMAP.md` für das, was offen ist | `6a1abea` | `docs/` |
| D-07 | Selbsthoster | **N** | Quickstart ohne `APP_ENV=development` → `/api/docs` antwortet lokal mit 404; ohne venv scheitert `pip install -e` an distributionsverwaltetem `cryptography` | Beides ergänzt, gegen einen laufenden Server verifiziert | `ea30f9c` | `README.md` |
| D-08 | Familie | **N** | Installer scheiterte beim zweiten Lauf unter Linux an „Text file busy" | Dienst wird vorher gestoppt (Windows-Installer machte das schon richtig) | `c8aabab` | `agent/install/install.sh`, `routers/agent.py` |
| D-09 | Neuer Dev | **M** | Agent hatte 4 Testfunktionen auf 2.699 Zeilen | 17 Testfunktionen: apt-Parser (dafür herausgelöst), Log-Ringpuffer inkl. Nebenläufigkeit, Shell-Auswahl, Timeout-Grenzen, Dateirechte | `bb7d448` | `agent/*_test.go` |

---

## 3. Offen

| ID | Rolle | Sev | Finding | Grund | Empfohlene Priorität |
|---|---|---|---|---|---|
| OP-01 | SRE | **M** | `read_only: true` für beide Container | Ohne laufenden Docker-Daemon lässt sich nicht prüfen, welche Schreibpfade Caddy und uvicorn tatsächlich brauchen. Ungetestet auszuliefern wäre schlechter als es zu lassen. | **hoch** — beim nächsten Deploy mit `docker compose up` einmal durchprobieren |
| OP-02 | Familie | **M** | Erstinstallation prüft die Binary nicht kryptografisch | Die Signaturkette greift erst ab dem ersten Update; für die Erstinstallation bräuchte es ein Code-Signing-Zertifikat (Kostenpunkt, externe Entscheidung). In `SECURITY.md` als Restrisiko benannt. | mittel |
| OP-03 | Frontend | **N** | localStorage-Schlüssel heißen noch `ryntra-theme` und `ryntra-favorites` | Umbenennen setzt bei allen Nutzern Theme und Favoriten zurück; ohne Migrationslesepfad nicht sinnvoll. `App.tsx:24`, `useTheme.ts:5` | niedrig |
| OP-04 | Backend | **N** | Deprecation-Warnung aus `starlette.testclient` (httpx → httpx2) | Dritt-Bibliothek, kein eigener Code. Beobachten, bis FastAPI nachzieht. | niedrig |
| OP-05 | CI/CD | **N** | ESLint ist auf der 9er-Reihe gepinnt | `eslint-plugin-jsx-a11y` unterstützt ESLint 10 noch nicht, und die A11y-Regeln sind der Grund für das Gate. In `CONTRIBUTING.md` begründet. | niedrig — beobachten |

---

## 4. Bewusst nicht geändert

| Thema | Begründung |
|---|---|
| Der Agent führt beliebige Befehle als root/SYSTEM aus | Das ist die Funktion eines RMM, kein Fehler. Die Sicherheitsgrenze ist die Autorisierung im Backend, nicht eine Allowlist im Agent. In `SECURITY.md` ausdrücklich als nicht abgedeckt benannt. |
| Kein Alembic, kein Schema-Downgrade | Additive Migrationen tragen den Umfang dieses Projekts. Ein Migrationsframework brächte mehr Betriebsaufwand als Nutzen; der Rückweg ist das Backup. |
| Der Query-Parameter `?token=` am Download-Endpunkt | Serverseitig als Notnagel für einen reinen Browser-Download erhalten und in `docs/API.md` als solcher gekennzeichnet. Entfernt ist nur der Weg, auf dem das Dashboard ihn anbot. |
| `--forwarded-allow-ips` nicht durch eine CIDR ersetzt, sondern ganz entfernt | Die Anwendung wertet die Header ohnehin selbst aus; eine zweite, unabhängig konfigurierte Vertrauensstelle wäre eine zusätzliche Fehlerquelle. |
| Login-Rate-Limit nicht konfigurierbar gemacht | Ein Limit, das man hochdrehen kann, wird hochgedreht. Steht so in `docs/CONFIGURATION.md`. |
| Prettier nicht eingeführt | Hätte den gesamten Frontend-Code umformatiert (Anführungszeichenstil) und jeden Diff dieses Audits unlesbar gemacht. |
| Schema-Version blockiert den Start nicht | Additive Migrationen bedeuten, dass älterer Code weiterläuft. Einen Rollback im Störfall zu blockieren würde mehr kosten als es bringt. |
| SIM118 an vier Stellen unterdrückt | Ruffs Autofix `"col" in row.keys()` → `"col" in row` ist für `sqlite3.Row` **falsch**: `__contains__` iteriert dort über die Werte, nicht über die Spaltennamen. Der Fix hätte vier Migrations-Fallbacks stillschweigend kaputtgemacht — nachgestellt und verifiziert. |

---

## 5. Vorher / Nachher

| Kennzahl | Vorher | Nachher | Beleg |
|---|---|---|---|
| `ruff check .` | **137 Fehler** | 0 | `abb3073` |
| Backend-Tests | 154 | **178** | `pytest -q` |
| Backend-Coverage | 89,45 % | 89,58 % | `--cov=app` |
| Frontend-Tests | **0** | **20** | `npx vitest run` |
| Frontend-Linter | keiner | ESLint + jsx-a11y, sauber | `frontend/eslint.config.js` |
| Agent-Testfunktionen | 4 | **17** | `agent/*_test.go` |
| Dependency-Gates in CI | **0** | 3 (pip-audit, npm audit, govulncheck) | `.github/workflows/ci.yml` |
| `npm audit` | 1 high, 1 moderate | **0** | `npm audit` |
| `pip-audit` | 0 in App-Deps | 0 | `pip-audit --strict .` |
| Unauthentifizierte Endpunkte ohne Rate-Limit | 6 | **2** (`/api/health`, `/api/ready` — beide ohne Nutzdaten) | Routen-Enumeration aus der laufenden App |
| Container als root | 2 von 2 | **0 von 2** | `08f3b33` |
| Ungepinnte Images | 1 (`rustdesk:latest`) | 0 | `docker-compose.yml` |
| `<label>` im Frontend | 1 | 12 | `git grep` |
| `aria-*`-Attribute | 6 | 15 | `git grep` |
| `window.confirm` | 8 | **0** | `git grep` |
| `autoFocus` | 8 | **0** (nur noch in Kommentaren) | `git grep` |
| Markdown-Dateien / Zeilen | 6 / 832 | **19 / 2.924** | `git ls-files '*.md'` |
| Backend-Testlaufzeit | 2:03 min | 1:54 min | `time pytest` |
| Frontend-Build | 5,2 s / 361,8 kB (102,0 kB gzip) | 4,2 s / **413,8 kB** (120,0 kB gzip) | `npm run build` |

Zum Bundle: die 52 kB Zuwachs sind react-router. Für Deep-Links, einen
funktionierenden Zurück-Button und bookmarkbare Geräteseiten ist das der
Preis; die Alternative wäre ein selbstgebautes Hash-Routing gewesen.

---

## 6. Go-Live-Checkliste

Was **du** noch manuell tun musst. Die ersten drei sind blockierend.

### Blockierend

- [ ] **Datenvolumen umschreiben**, bevor die neuen Images deployt werden —
      sonst startet das Backend in einer Neustartschleife
      (`attempt to write a readonly database`):
      ```bash
      cd /opt/rxf-rmm/infrastructure
      docker compose down
      docker volume ls --filter name=rxf-rmm-data      # Namen prüfen
      docker run --rm -v infrastructure_rxf-rmm-data:/data alpine \
        sh -c 'chown -R 10001:10001 /data && ls -lan /data'
      docker compose up -d --build
      ```
      Zwei Fallen, beide beim ersten Versuch zugeschnappt: das Volume trägt
      den Projektpräfix (`infrastructure_rxf-rmm-data`), und der Schritt darf
      **nicht** über `docker compose run` laufen, weil der Service
      `cap_drop: ALL` setzt und `chown` dann auch als root scheitert. Details
      in [`../OPERATIONS.md`](../OPERATIONS.md#container-härtung).
- [ ] **`TRUSTED_PROXY_CIDR`** in `infrastructure/.env` auf die IP des
      cloudflared-Hosts (CT 104) setzen. Beim Default `127.0.0.1/32` sieht das
      Backend nur die Container-IP und das Login-Rate-Limit greift faktisch
      global.
- [ ] **Restore einmal durchspielen** — auf einem Testvolume, nicht auf dem
      Produktivstand:
      ```bash
      bash /opt/rxf-rmm/infrastructure/restore.sh \
        /opt/backups/rxf-rmm/rmm-<stamp>.db \
        /opt/backups/rxf-rmm/credentials-<stamp>.key
      ```
      Danach anmelden, Gerätezahl prüfen und **ein Passwort aus dem Tresor
      testweise anzeigen** — schlägt das fehl, wurde der `credentials.key`
      nicht mitgestellt.

### Vor dem Live-Betrieb

- [ ] `BOOTSTRAP_ADMIN_PASSWORD` nach dem ersten Login aus `.env` entfernen.
- [ ] TOTP für **alle** Admin-Konten aktivieren (Admin → Sicherheit).
- [ ] ntfy einrichten und den Testversand auslösen (Admin → Push). Ohne
      `NTFY_BASE` bleiben Alarme nur im Dashboard sichtbar.
- [ ] `infrastructure/.agent-sign.env` außerhalb des Servers sichern. Verlust
      erzwingt eine Neuinstallation **aller** Agents, weil der Public Key in
      jede Binary eingebrannt ist.
- [ ] Backups verschlüsselt ablegen — sie enthalten die vollständige Datenbank.
- [ ] Docker-Log-Rotation setzen (`/etc/docker/daemon.json`, siehe
      [`../OPERATIONS.md`](../OPERATIONS.md#logs)) — `systemctl restart docker`
      startet alle Container neu, also in ein Wartungsfenster legen.
- [ ] `docs/PRIVACY.md` an die betreuten Personen weitergeben, bevor der Agent
      auf ihren Geräten installiert wird.
- [ ] Pro Familiengerät entscheiden: RustDesk **mit** Zustimmungsabfrage
      (empfohlen) oder unbeaufsichtigt. Siehe
      [`../../infrastructure/RUSTDESK.md`](../../infrastructure/RUSTDESK.md).
- [ ] Router-Portfreigaben für RustDesk prüfen (TCP 21115–21117, UDP 21116) —
      die laufen nicht durch den Tunnel.
- [ ] DNS für `rd.rxf-sys.de` als **DNS-only** (kein Cloudflare-Proxy).

### Nach dem ersten Deploy

- [ ] `curl -fsS https://rmm.rxf-sys.de/api/ready` → `{"status":"ready",…}`.
- [ ] `docker compose ps`: beide Anwendungscontainer `healthy` — der
      Web-Container hat jetzt ebenfalls einen Healthcheck.
- [ ] Einen CI-Lauf abwarten und den neuen `audit`-Job ansehen; govulncheck
      konnte hier nicht geprüft werden (Egress-Proxy blockt `vuln.go.dev`).
- [ ] Ein Gerät neu enrollen und den Live-Job-Stream einmal absichtlich
      unterbrechen (Netz kurz trennen), um den neuen Reconnect zu sehen.

---

## 7. Empfohlene nächste Schritte

1. **`read_only: true` verifizieren und aktivieren** (OP-01). Der einzige
   Härtungsschritt, der hier mangels Docker-Daemon offenbleiben musste.
   Aufwand: eine Deploy-Runde mit `docker compose up` und Logbeobachtung.
2. **Frontend-Tests auf die Seiten ausweiten.** Die 20 Tests decken Hooks und
   die Dialog-Mechanik ab, keine einzige Seite. Die lohnendsten wären
   `DeviceDetail` (1.450 Zeilen, acht Tabs) und die Rollenweichen.
3. **Agent-Integrationstest für den WebSocket-Lebenszyklus.** `connectAndServe`
   und `handleMessage` sind weiterhin ungetestet — genau die Stelle, an der
   Reconnect-Fehler entstehen.
4. **Metrik-Export (Prometheus)**, wenn ohnehin Monitoring existiert. Die
   Daten liegen bereits in `metrics_hourly`.
5. **Code-Signing-Zertifikate** (OP-02) beseitigen SmartScreen- und
   Gatekeeper-Warnungen und machen das `Unblock-File` im Windows-Installer
   überflüssig. Externe Kosten, deshalb bewusst nicht entschieden.

---

## 8. Anhang: Commits

| Hash | Betreff |
|---|---|
| `abb3073` | Lint-Gate reparieren: ruff-Regelsatz festschreiben und Findings beheben |
| `ea30f9c` | README neu strukturieren und CD-Beschreibung korrigieren |
| `448c330` | docs: Architektur- und API-Referenz ergänzen |
| `92f2848` | docs: Konfiguration, Betrieb und Troubleshooting dokumentieren |
| `5520777` | docs: Lizenz, Sicherheitsrichtlinie, Contributing, Changelog und Vorlagen |
| `6a1abea` | docs: CLAUDE.md aktualisieren, Phasenplan archivieren, Docstring-Drift beheben |
| `c516d9e` | Rolle Selbsthoster: Passwortregel auf allen Wegen, CORS_ORIGINS entschärfen |
| `c8aabab` | Rolle Familie: Transparenz-Dokument, Zustimmungsfrage bei Fernwartung, Installer |
| `d7b52a2` | Frontend: Lint- und Test-Gate einführen, gefundene Verstöße beheben |
| `93ba197` | Frontend: echte URLs, Bestätigungsdialoge, Error Boundary |
| `9824759` | Backend: gemeinsamer DB-Zugang, Alarm-Aufräumung, Schema-Version |
| `6f45930` | Security: Enrollment rate-limitieren, Proxy-Header entschärfen, Token aus URLs |
| `08f3b33` | SRE: Readiness-Endpunkt, Container ohne root, Image-Pin |
| `79fdba0` | CI: Frontend-Gates und Dependency-Audits ergänzen, Dependabot einrichten |
| `bb7d448` | Neuer Entwickler: Agent-Tests von 4 auf 17, optionaler Pre-Commit-Hook |
| `b44a0dd` | Frontend: abgelaufene Session, Reconnect-Backoff, verschluckte Ladefehler |
