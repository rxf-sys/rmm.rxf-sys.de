# Mitarbeit

## Setup in unter 15 Minuten

Voraussetzungen: Python ≥ 3.11, Node ≥ 22, Go ≥ 1.25, Git.

```bash
git clone https://github.com/rxf-sys/rmm.rxf-sys.de.git
cd rmm.rxf-sys.de

# Backend
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest -q                       # muss grün sein, bevor du irgendetwas änderst
APP_ENV=development AUTH_ENABLED=false STORAGE_DB_PATH=./dev.db \
  uvicorn app.main:app --reload --port 8080

# Frontend (zweites Terminal)
cd frontend && npm ci && npm run dev      # http://127.0.0.1:5173

# Agent (drittes Terminal)
cd agent && make build && ./rmm-agent version
```

`AUTH_ENABLED=false` macht jeden Request zu einem Admin-Request — praktisch
lokal, katastrophal überall sonst. Wer Auth testen will, lässt sie an und
setzt `BOOTSTRAP_ADMIN_PASSWORD` plus `SESSION_COOKIE_SECURE=false`
(das Cookie kommt sonst über `http://` nicht an).

### Einen Agent lokal anbinden

```bash
# Dashboard → Gerät hinzufügen → Token kopieren, dann:
sudo ./rmm-agent enroll -server http://127.0.0.1:8080 -token <TOKEN> -label dev
sudo ./rmm-agent run          # im Vordergrund, ohne Dienstinstallation
```

## Checks

Ein PR ist fertig, wenn diese Blöcke grün sind — es sind exakt die CI-Gates:

```bash
cd backend  && ruff check . && pytest -v --cov=app --cov-fail-under=70
cd frontend && npm run lint && npm test && npm run build
cd agent    && make vet test
```

Dazu laufen in CI die Dependency-Audits (`pip-audit`, `npm audit`,
`govulncheck`) als eigener Job. Lokal:

```bash
cd backend  && pip-audit --strict .
cd frontend && npm audit --audit-level=high
cd agent    && go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Die Coverage-Schwelle von 70 % ist eine Untergrenze, kein Ziel; der Ist-Stand
liegt deutlich darüber. Neue Backend-Logik ohne Test wird nicht gemergt.

### Optional: die schnellen Checks vor dem Commit

```bash
pip install pre-commit && pre-commit install
```

Führt ruff, gofmt, go vet, eslint und tsc auf den geänderten Dateien aus und
verhindert, dass eine `.env` oder der Signaturschlüssel versehentlich
eingecheckt wird. Alles läuft lokal, ohne Netz — ein Commit bleibt also auch
im Zug möglich. Verbindlich ist trotzdem CI.

## Konventionen

**Sprache.** Prosa (Doku, Commit-Bodies, UI-Texte, Fehlermeldungen für
Benutzer) auf Deutsch. Code, Bezeichner, Kommentare, Dateinamen und
Commit-Betreffzeilen auf Englisch bzw. in der jeweiligen Fachsprache.

**Commits.** Eine logische Änderung pro Commit. Die Betreffzeile sagt, *was*
sich ändert; der Body sagt, *warum* — nicht, was der Diff ohnehin zeigt.

**Backend.** FastAPI mit Dependency-Injection für Auth (`verify_session`,
`require_operator`, `require_admin`). Logging über structlog mit
Event-Namen im Schema `bereich.ereignis`. Jede Zustandsänderung an einem
Gerät gehört ins Audit-Log. Jedes Modul bringt sein eigenes Schema mit und
legt es in `ensure_schema()` an.

**Frontend.** TypeScript strict inklusive `noUncheckedIndexedAccess`, keine
`any`-Fluchten. API-Aufrufe ausschließlich über `src/api/client.ts`. Fehler
werden über `apiErrorMessage(e)` in Text übersetzt, nicht selbst
zusammengebaut. Dialoge laufen über `components/Modal.tsx` — der bringt
Fokusfalle, Escape und die ARIA-Rollen mit. Module exportieren entweder
Komponenten oder Hilfsfunktionen, nicht beides (sonst bricht Fast Refresh).

**Agent.** `CGO_ENABLED=0`, damit jedes Target eine einzelne statische Binary
bleibt. Plattformspezifisches gehört in `*_linux.go` / `*_windows.go` /
`*_darwin.go`, nicht in `runtime.GOOS`-Zweige mitten im Code.

## Fallstricke

Dinge, die hier schon einmal Zeit gekostet haben:

- **`ruff` ist auf die 0.16er-Reihe gepinnt und der Regelsatz ist explizit
  aufgeführt.** Beides gehört zusammen: Ruff hat den impliziten Default-Satz
  zwischen Releases erweitert und damit CI rot gemacht, ohne dass sich Code
  geändert hätte. Neue Regeln bewusst aufnehmen, nicht per Zufall erben.
- **`sqlite3.Row.__contains__` testet Werte, nicht Spaltennamen.** Für
  „Spalte vorhanden?" ist `"col" in row.keys()` korrekt. Ruffs SIM118-Autofix
  will das umschreiben und liegt hier falsch — deshalb stehen an vier Stellen
  begründete `# noqa: SIM118`.
- **Der Coverage-Lauf ignoriert `app/main.py`** (`pyproject.toml`), weil der
  ASGI-Einstiegspunkt ohne Lifespan nicht sinnvoll unittestbar ist. Neue
  Logik gehört deshalb nicht nach `main.py`.
- **Tests fahren den Lifespan nicht.** `tests/conftest.py` ruft alle
  `ensure_schema()` von Hand auf. Ein neues Modul mit eigenem Schema muss
  dort **und** in `main.py` eingetragen werden, sonst schlagen Tests mit
  „no such table" fehl.
- **`AUTH_ENABLED=false` verdeckt Autorisierungsfehler.** Alles, was mit
  Rollen zu tun hat, gegen laufende Auth testen.
- **Der Fleet-WebSocket überträgt keine Nutzdaten**, nur
  `{"type":"refresh"}`-Hinweise. Das ist Absicht: die Autorisierung bleibt
  damit vollständig in der REST-Schicht. Bitte nicht anfangen, Daten
  durchzuschieben.
- **Der Agent lehnt jedes Update ab, wenn kein Public Key eingebrannt ist.**
  Lokale Builds über `make build` haben keinen — das ist kein Fehler.
- **ESLint ist auf der 9er-Reihe gepinnt.** `eslint-plugin-jsx-a11y` hat noch
  keine ESLint-10-Unterstützung, und die Accessibility-Regeln sind der Grund,
  warum es das Gate überhaupt gibt.

## Struktur

| Pfad | Inhalt |
|---|---|
| `backend/app/` | Fachlogik pro Modul (Speicher + Regeln), jeweils mit eigenem Schema |
| `backend/app/routers/` | HTTP-/WS-Schicht: Validierung, Auth-Dependency, Audit-Aufruf |
| `backend/tests/` | pytest, `asyncio_mode = auto`, Fixtures in `conftest.py` |
| `frontend/src/components/` | Eine Datei pro Seite, Unterkomponenten daneben |
| `frontend/src/hooks/` | `useAuth`, `useFleet` (Poll + Fleet-Socket), `useJobStream`, `useTheme` |
| `agent/` | Ein Paket, plattformspezifisches über Build-Tags in den Dateinamen |
| `infrastructure/` | Compose, LXC-Bootstrap, Deploy-/Backup-/Restore-/Build-Skripte |
| `docs/` | Architektur, API, Konfiguration, Betrieb, Troubleshooting |

## Pull Requests

1. Branch von `main`.
2. Die drei Check-Blöcke lokal grün.
3. PR gegen `main`; die Vorlage fragt nach dem, was für den Review zählt.
4. CI muss grün sein. Ein Merge auf `main` deployt automatisch nach
   Produktion — ein roter Build ist deshalb kein Formalismus.

## Sicherheitsrelevantes

Schwachstellen bitte nicht als Issue, sondern nach dem Weg in
[`SECURITY.md`](SECURITY.md) melden.
