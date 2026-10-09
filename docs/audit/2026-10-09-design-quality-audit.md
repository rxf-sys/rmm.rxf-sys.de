# Design- und Qualitäts-Audit — 09.10.2026

Ausgangsstand `main` (`9541517`). Noch kein Branch, noch keine Codeänderung —
dieser Bericht ist die Grundlage für die Freigabe der Umsetzung.

Jede Aussage ist belegt: Fundstelle `Datei:Zeile`, Kommando mit Ergebnis oder
eine Messung gegen die laufende Anwendung. Pfade sind relativ zur
Repo-Wurzel; `app.css` steht für `frontend/src/styles/app.css`, `DD` für
`frontend/src/components/DeviceDetail.tsx`. Was nicht prüfbar war, steht
ausdrücklich dabei.

---

## 1. Executive Summary

### Ausgangslage

Backend und Agent sind solide: alle Gates grün, Backend-Coverage 90,03 %,
`go test -race` ohne Befund. Die Schwächen liegen fast vollständig in der
Oberfläche — und eine davon betrifft den laufenden Betrieb:

- **P0 — Endlos-Refetch nach dem Login.** Jeder angemeldete Browser-Tab ruft
  `/api/devices`, `/api/alerts`, `/api/patches/summary` und `/api/persons`
  ununterbrochen ab. Gemessen: **569 Abrufe je Endpunkt in 10 s Leerlauf**
  (≈ 228 Requests/s pro Tab) bei 11 Geräten. Ursache: `useFleet` gibt bei
  jedem Render eine neue `refresh`-Funktion zurück
  (`frontend/src/hooks/useFleet.ts:133`), und der Effekt in
  `frontend/src/App.tsx:139-142` hängt genau davon ab. Eingeführt mit
  `93ba197`. Auf dem Handy in Bereitschaft heißt das: Akku und Datenvolumen.
- **Kein Design-System, sondern gewachsene Werte.** 19 Schriftgrößen,
  72 verschiedene `padding`-Werte, 14 Radien, 528 Inline-Style-Objekte; die
  Danger-Farbe ist die Markenfarbe (#b4182d), die Sekundärserie `--violet`
  liegt mit 1,08:1 praktisch auf Danger.
- **Kontrast verfehlt WCAG AA in beiden Themes.** axe-core: 88 (dunkel) bzw.
  126 (hell) Kontrastverstöße über zehn Seiten; Hauptursache ist ein
  einziges Token, `--tx3`.
- **Mobil ist der Bereitschaftspfad gebrochen.** Auf 390 px liegen
  „Terminal“ und das „⋯“-Menü der Gerätedetailseite bei x = 416 bzw. 523 px —
  außerhalb des sichtbaren Bereichs. Keines der Bedienelemente erreicht 44 px.
- **Status nur über Farbe** an acht Stellen, darunter die Geräteliste.

### Audit Health Score (impeccable `audit`)

| # | Dimension | Score | Wichtigster Befund |
|---|---|---|---|
| 1 | Barrierefreiheit | 2 | Kein `<main>`/`<nav>`, Status nur über Farbe, AA-Kontrast verfehlt |
| 2 | Performance | 1 | Endlos-Refetch (P0); „alle“ bei 10.000 Geräten: 8,9 s, 343.498 DOM-Knoten |
| 3 | Theming | 2 | Tokens vorhanden, aber 528 Inline-Styles, 25 Farbliterale, kein System-Theme |
| 4 | Responsive | 1 | Aktionen auf 390 px unerreichbar, 0 Touch-Ziele ≥ 44 px, kein `pointer`-Query |
| 5 | Implementierungs-Integrität | 2 | 11 tote Klassen, 2 Klassenkollisionen, 2 ungültige Deklarationen |
| **Summe** | | **8/20** | **Poor — Umbau nötig** |

Die Bewertung gilt der Oberflächenschicht. Funktionsumfang, Routing,
Fehlergrenzen und Tests aus dem Audit vom 07.09.2026 tragen weiter.

### Befunde nach Priorität

| Priorität | Anzahl | Bedeutung |
|---|---|---|
| **P0** | 1 | Betrifft den laufenden Betrieb — sofort beheben |
| **P1** | 14 | WCAG-AA-Verstoß, gebrochener Bereitschaftspfad, Sicherheits-/Audit-Lücke |
| **P2** | 19 | Spürbare Schwäche mit Umweg |
| **P3** | 9 | Feinschliff |

Aufwand: **S** ≤ ½ Tag · **M** 1–2 Tage · **L** 3–5 Tage.

### Baseline der Gates (09.10.2026)

| Gate | Ergebnis |
|---|---|
| `ruff check .` | sauber (ruff 0.16.10) |
| `pytest --cov=app --cov-fail-under=70` | 221 passed, Coverage 90,03 %, 2:15 min |
| `npm run lint` | sauber |
| `npm test` | 152 Tests in 23 Dateien grün |
| `npm run build` | grün; Haupt-Chunk 315,4 kB (98,8 kB gzip), CSS 37,4 kB (7,8 kB gzip), `DeviceDetail` 57,8 kB (14,9 kB gzip) |
| `go vet ./...`, `go test ./...` | sauber |
| `go test -race -count=1 ./...` | grün, keine Races |
| Go-Coverage | 11,7 % (`agent`), 14,5 % (`tools/sign`) |

---

## 2. Methode

| Werkzeug | Zweck | Anmerkung |
|---|---|---|
| Playwright (Chromium 1194) | Screenshots Desktop 1440 px und 390 px, hell und dunkel, 12 Routen + 5 Reiter | gegen Dev-Backend **mit** Auth (`AUTH_ENABLED=true`) |
| axe-core 4.14 | Automatische A11y-Prüfung je Seite | nur im Scratchpad installiert, keine Projekt-Dependency |
| Seed-Skript (Scratchpad) | Demo-Daten mit Worst Cases: 61-stelliger Hostname, Umlaute, Emoji, fehlende Heartbeats, 16-TB-Platte | Datenbank außerhalb des Repos |
| Stresstest | 10.001 Geräte, leere Datenbank | `break-ui`-Katalog: 0, 1, 10.000 |
| `dataviz`-Validator | Serienfarben der Charts gegen CVD und Kontrast | `validate_palette.js --pairs all` |
| WCAG-Rechner | Kontrast der neuen Palette | alle 64 Paare ≥ 4,5:1 (Abschnitt 7) |
| ruff, mypy 2.4, golangci-lint 2.14 | Trockenläufe für Regel-Erweiterungen | ohne Änderung an `pyproject.toml` |
| esbuild | gzip-Größe der Dependency-Kandidaten | gemessen mit Tree-Shaking, React extern |

**Nicht gelaufen:** der Detektor von `impeccable` (`scripts/impeccable detect`).
Das Starten des mitgelieferten Binärprogramms wurde in dieser Umgebung
blockiert; die Prüfungen der Dimension „Implementierungs-Integrität“ sind
deshalb von Hand und per grep erhoben. Kein echtes Gerät, kein
Screenreader-Test — Touch ist per Playwright-Emulation (`hasTouch`) geprüft,
nicht auf Hardware.

---

## 3. Befunde

### P0

| ID | Bereich | Befund | Beleg | Aufwand |
|---|---|---|---|---|
| P0-01 | Daten | Endlos-Refetch nach Login: 4 Endpunkte je ≈ 57×/s, solange ein Tab offen ist | `frontend/src/hooks/useFleet.ts:133` (neue Closure je Render), `frontend/src/App.tsx:139-142` (Effekt mit `refresh` als Abhängigkeit); Messung: 569 Abrufe je Endpunkt in 10 s; Backend-Log wuchs in 13 min auf 6,3 MB | S |

### P1

| ID | Bereich | Befund | Beleg | Aufwand |
|---|---|---|---|---|
| P1-01 | Kontrast | `--tx3` verfehlt AA: 4,34:1 auf `--panel` (dunkel), 3,06–3,25:1 (hell); trifft Breadcrumb, Untertitel, Zähler, KPI-Labels | `app.css:29`, `app.css:64`; axe: 88 Verstöße dunkel, 126 hell | S (mit Token-PR) |
| P1-02 | Kontrast | Weitere Token-Paare unter 4,5:1: Warn-Badge hell 3,09:1, Akzent-Text auf Akzent-Fläche hell 3,91:1, OK-Grün hell 3,39:1, `--danger` als Text dunkel 2,53:1 | `app.css:74` (Warn hell), `app.css:70` (Akzent-Text hell), `app.css:72` (OK hell), `app.css:45` (Danger); Textverwendung `app.css:1851`, `DD:355` | S |
| P1-03 | Responsive | Gerätedetail auf 390 px: „Terminal“ und „⋯“-Menü außerhalb des Viewports, nur durch seitliches Scrollen in `.content` erreichbar; Tags abgeschnitten | `DD:271-362`; Messung: x = 416 px und 523 px bei 390 px Breite | M |
| P1-04 | Responsive | Kein Bedienelement erreicht 44 px; 20–40 zu kleine Ziele je Seite; keine `pointer`/`hover`-Media-Queries, kein `:active` | `app.css:427` (`.btn` ≈ 32 px), `app.css:270` (`.nav-item` 36 px), `app.css:535` (`.segment` ≈ 28 px); Probe je Seite | M |
| P1-05 | A11y | Status nur über Farbe: `Dot` ohne Text, Rolle oder Label; u. a. Geräteliste, Sidebar-Favoriten, Kopf der Detailseite | `frontend/src/ui.tsx:5-12`; `frontend/src/components/DevicesPage.tsx:326`, `Sidebar.tsx:148-151`, `DD:276`, `Header.tsx:40` | M |
| P1-06 | A11y | Keine Landmarks: kein `<main>`, `<nav>`, `<header>`; Navigation besteht aus `<button>` ohne `aria-current` und ohne `href` — nichts lässt sich in neuem Tab öffnen | `frontend/src/App.tsx:216`, `Header.tsx:25`, `Sidebar.tsx:101,118,128-131`; axe `landmark-one-main` auf allen Seiten | S |
| P1-07 | A11y | `ConfirmDialog` fokussiert beim Öffnen den Bestätigen-Knopf; ohne Eingabefeld bestätigt ein einziges Enter eine destruktive Aktion | `frontend/src/components/Modal.tsx:50-55` (erstes fokussierbares Element), `ConfirmDialog.tsx:61-68` (Bestätigen steht vor Abbrechen) | S |
| P1-08 | A11y | Fokusring entfernt an Terminal- und Palette-Eingabe, ohne Ersatz | `app.css:1278`, `app.css:1525` | S |
| P1-09 | A11y | Admin: drei `<select>` ohne zugänglichen Namen (axe `select-name`, kritisch) | `frontend/src/components/AdminPage.tsx` (Tabellenzeilen, axe-Selektor `.tbl-row > span:nth-child(3) > select`) | S |
| P1-10 | Design-System | Danger = Markenfarbe #b4182d; `--violet` (Sekundärserie, Audit-Badges, Avatar) hat 1,08:1 zu Danger — normale Ereignisse wie „Anmeldung“ sehen aus wie Fehler | `app.css:8,45,48`; `frontend/src/auditText.ts:197-198`; Screenshot leere Übersicht | M (mit Token-PR) |
| P1-11 | Theme | System-Einstellung wird ignoriert, Standard ist dunkel; `theme-color` (#0c0e15) passt zu keinem Token | `frontend/src/hooks/useTheme.ts:11-18`, `frontend/index.html:13` | S |
| P1-12 | Rechte | 22 von 33 schreibenden admin/operator-Endpunkten ohne 403-Test, darunter `DELETE /api/devices/{id}`, `POST …/wake`, `POST …/update-agent`, `PATCH/DELETE /api/accounts/{id}`, alle Credential-Schreibpfade | Liste in Abschnitt 5; Guards `backend/app/auth.py:55,65` | M |
| P1-13 | Audit-Log | Zwei Befehle an Geräte ohne Audit-Eintrag — verletzt den Grundsatz aus `CLAUDE.md`: automatischer `update`-Push und `get_logs` | `backend/app/routers/agent.py:401-402` (nur `log.info`), `backend/app/agents_ws.py:44` (ausgelöst über `backend/app/routers/devices.py:207`) | S |
| P1-14 | Daten | Alarm-Sturm erzeugt Refetch-Sturm: jeder Alarm sendet einen Fleet-Broadcast, das Frontend entprellt nur 300 ms. Bei 1.517 gleichzeitig offline gegangenen Geräten: 1.098 `alert.fired`, 55 Abrufe der 6,9-MB-Geräteliste in 65 s | `backend/app/alerts.py:98`, `frontend/src/hooks/useFleet.ts:96-98`; Messung 10k-Seed | S |

### P2

| ID | Bereich | Befund | Beleg | Aufwand |
|---|---|---|---|---|
| P2-01 | Design-System | Kein Token für Typo, Abstand, Radius, z-Index, Bewegung; 19 Schriftgrößen (9–26 px), 72 `padding`-Werte, 14 Radien, 6 Schatten | `app.css:11-81`; Zählung über `app.css` und 143 Inline-`fontSize` | L |
| P2-02 | Design-System | 528 Inline-`style={{}}`, davon 157 in `DD` — widerspricht dem Kopfkommentar von `app.css` | `app.css:3-5`; grep über `frontend/src` | L (schrittweise) |
| P2-03 | Design-System | Verläufe als Oberfläche: `--card`, `.btn-primary`, Avatar, Rollout-Balken, Lastkurve | `app.css:24,59,367,450`; `Sidebar.tsx:168`; `OverviewPage.tsx:142-145` | S |
| P2-04 | Implementierung | Klassenkollisionen: `.script-body` zweimal definiert (Zeilentext erbt Konsolen-Optik), `.kv` als Grid und als Flex | `app.css:1010` vs. `app.css:1087` (`ScriptsPage.tsx:150,204`); `app.css:1771` vs. `app.css:1816` | S |
| P2-05 | Implementierung | Ungültige Deklarationen `font: … inherit` werden verworfen; 11 nie verwendete Klassen | `app.css:2377`, `app.css:2511`; z. B. `.minibar` `app.css:753`, `.cell-bar` `app.css:814` | S |
| P2-06 | Gerätedetail | Label „Sicherheitsupdates“ überlappt den Wert: `.kv .k` hat feste 92 px | `app.css:1821-1826`; `DD:997`; Screenshots Desktop und mobil | S |
| P2-07 | Architektur | `DeviceDetail.tsx` 2.134 Zeilen, 12 Komponenten, 54 `useState`, 15 `useEffect`; drei fast gleiche Job-Konsolen; `devicePatches` doppelt geladen | `DD:111-432` (Container), `DD:1731-1815`, `2058-2068`, `2126-2131`; `DD:968-987` und `DD:1934-1945` | L |
| P2-08 | Architektur | Kein gemeinsames Datenladen: jede Seite `useEffect` + `api.*`; keine Deduplizierung, kein Cache, kein `visibilityState` — Polling läuft im Hintergrund-Tab weiter | `frontend/src/hooks/useFleet.ts:70`; `DD:165`, `DD:2093`; `AuditPage.tsx:142` | M |
| P2-09 | Architektur | Keine Laufzeitvalidierung der API-Antworten; Inventardaten (`unknown`) werden gecastet und können die Seite abstürzen lassen | `frontend/src/api/client.ts:71,86`; `DD:881-887`, `DD:958`, `DD:1483-1484` | M |
| P2-10 | Resilienz | Nur ein globales Error Boundary — ein Renderfehler nimmt auch die Navigation mit | `frontend/src/main.tsx:25-27` | S |
| P2-11 | Tabellen | Keine `<table>`; keine Sortierung, kein `aria-sort`, kein Sticky Header, Kürzung ohne `title`; `tabular-nums` in nur 5 Regeln | `DevicesPage.tsx:286`, `PatchesPage.tsx:356`, `AdminPage.tsx:150`; `app.css:775-782` | M |
| P2-12 | Tabellen | Keine Mehrfachauswahl; Massenaktionen nur „Alle quittieren“ und „N Geräte scannen“, sequenziell | `AlertsPage.tsx:147`, `PatchesPage.tsx:331` | M |
| P2-13 | Performance | Seitengröße „alle“ bei 10.001 Geräten: 8,9 s bis zum Rendern, 343.498 DOM-Knoten, 368 MB Heap; `/api/devices` liefert 6,9 MB | `frontend/src/hooks/usePagination.ts:5-7`; Messung | M |
| P2-14 | Charts | Serienfarben scheitern am Validator (dunkel: Helligkeitsband; hell: Normalsicht-ΔE 13,8 < 15); Disk nutzt die Statusfarbe `--warn`; Legende zeigt Disk durchgezogen statt gestrichelt | `frontend/src/components/MetricChart.tsx:8-12`; `DD:1323-1333` | M |
| P2-15 | Charts | Tooltip nur per Maus (kein Touch, keine Tastatur); Achsenbeschriftung skaliert mit der `viewBox` und ist auf 390 px unleserlich klein; 7-Tage-Tooltip zeigt nur HH:MM | `MetricChart.tsx:96-97,102,150,158`; Screenshot `mobile-dark-devices_5?tab=history` | M |
| P2-16 | A11y | Job-Konsolen ohne `aria-live`; `stream.connected` wird nirgends angezeigt; Ausgabe wächst unbegrenzt | `DD:1747,2064,2129`; `frontend/src/hooks/useJobStream.ts:9,86` | M |
| P2-17 | A11y | CommandPalette ohne Combobox-/Listbox-Semantik, Auswahl wird nicht ins Bild gescrollt; „⋯“-Menü ohne `role="menu"`, schließt bei Mouse-Leave | `CommandPalette.tsx:109-120,151`; `DD:324,333` | M |
| P2-18 | Agent | `ReadJSON` ohne `SetReadLimit`; möglicher Goroutine-Leak über ungepufferten Kanal; `handleMessage` dekodiert und führt im selben Schritt aus | `agent/client.go:147,150,197-222` | M |
| P2-19 | Tests | Agent-Coverage 11,7 %; Frontend ohne Tests für `DeviceDetail`, `App.tsx`, `useFleet`, 7 weitere Seiten — der P0-Befund blieb deshalb unentdeckt | `go test -cover`; Testliste `frontend/src/**/__tests__` | L |

### P3

| ID | Bereich | Befund | Beleg | Aufwand |
|---|---|---|---|---|
| P3-01 | Bewegung | `prefers-reduced-motion` nur an zwei Stellen; Seiten-Einblendung, Overlays, Endlos-Pulse und Drawer bleiben; Drawer animiert `left` | `app.css:1064-1069`, `app.css:2363-2367`; `app.css:207,1892` | S |
| P3-02 | Typo | Mono-Versalien mit Sperrung als Etiketten (9–9,5 px) über KPI-Zahlen und Tabellenköpfen; IBM Plex Mono 700 wird nur synthetisch gefettet | `app.css:318-320,778,884`; `frontend/src/main.tsx:12-17` | S |
| P3-03 | Zahlen | Keine Tausendertrennung: „10001“, „6703“, „10000 von 10001 Geräten aktuell“ | Screenshot 10k-Liste; `Sidebar.tsx` Rollout-Karte | S |
| P3-04 | Logik | Neueste Agent-Version per Textsortierung: „0.9.0“ gilt als neuer als „0.10.0“ | `frontend/src/components/Sidebar.tsx:96` | S |
| P3-05 | Backend | DST-Fehler: `last_slot` liefert in der Zeitumstellungslücke einen Zeitpunkt in der Zukunft (nur bei `PATCH_SCAN_HOUR=2`) | `backend/app/patch_scan.py:42`; nachgestellt für 29.03.2026 | S |
| P3-06 | Backend | 4 mypy-Fehler, davon einer echt (Rückgabetyp) | `backend/app/notify.py:34`; `backend/app/alerts.py:203,240,261` | S |
| P3-07 | Agent | golangci-lint: errcheck 5 (Linux), u. a. ungeprüftes `Close`; `execOut` unter Windows ungenutzt | `agent/client.go:131`, `agent/enroll.go:45`, `agent/update.go:117`; `agent/hostinfo.go:13` | S |
| P3-08 | CI | Kein `-race`, kein E2E, kein mypy/golangci-lint; `go vet` und govulncheck nur für Linux | `.github/workflows/ci.yml:78-80,139-142` | S |
| P3-09 | Doku | `CLAUDE.md` nennt vier `# noqa: SIM118`, es sind sechs | `backend/app/devices.py:150,176,179,184,191`, `backend/app/persons.py:64` | S |

---

## 4. Break-UI: Worst-Case-Daten

Eingespeist über die Datenschicht (Seed in die Datenbank), nicht über
Markup — so wie echte Daten ankommen.

| # | Schwere | Feld | Wert | Was passiert | Fix |
|---|---|---|---|---|---|
| 1 | Broken | Kopf Gerätedetail | beliebiger Hostname + 2 Tags auf 390 px | Aktionen außerhalb des Viewports (P1-03) | Kopf als Grid: Titelzeile umbrechen lassen, Aktionen in eigene Zeile, `min-width: 0` |
| 2 | Broken | Seitengröße | „alle“ bei 10.001 Geräten | 8,9 s eingefroren, 368 MB Heap (P2-13) | Virtualisieren oder „alle“ ab 500 Zeilen abschalten (Entscheidung, Abschnitt 9) |
| 3 | Ugly | `owner_label` / Person | „Gisela Großmutter-Überlänge von und zu Hohenzollern-Sigmaringen“ | Besitzerspalte bricht auf 6 Zeilen, Zeilenhöhe springt | Auf 2 Zeilen klemmen, voller Wert per `title` |
| 4 | Ugly | Hostname | `srv-backup-offsite-hetzner-fsn1-dc14-storagebox-replica-0001` (61 Zeichen) | Liste: Ende-Kürzung ohne `title`; Übersicht „Zu tun“: Name doppelt (Titel und Kontext) | Mitte kürzen (Unterschiede stehen am Ende), `title`, Kontextzeile nicht wiederholen |
| 5 | Ugly | Hostname | `nas-keller` auf 390 px | Bricht am Bindestrich in „nas-“ / „keller“ | `overflow-wrap: anywhere` nur als letzter Ausweg, Titel darf die Zeile füllen |
| 6 | Ugly | Reiter | 8 Reiter auf 390 px | Brechen in zwei Zeilen um | Eine Zeile, horizontal scrollbar mit Rand-Fade |
| 7 | Ugly | Personenfilter | langer Personenname | `<select>` ragt auf 390 px bis x = 472 px | `max-width: 100%`, volle Breite unter dem Suchfeld |
| 8 | Ugly | Zahlen | 10.001 Geräte | ohne Tausendertrennung (P3-03) | `Intl.NumberFormat('de-DE')` zentral in `format.ts` |
| 9 | Fragile | Disk-Größe | 16 TB | „14 TB / 15 TB“ bricht in der Metrikzeile um | `white-space: nowrap` für Werte, Label darf kürzen |
| 10 | Fragile | `owner_label` | 120 Zeichen erlaubt (`backend/app/devices.py:335`) | Frontend kennt das Limit nicht | `maxLength` im Formular angleichen |

**Hielt stand:** Emoji im Besitzernamen („Hosting 🚀“), Umlaute in Hostname
und Tags, fehlende Heartbeats (Striche statt `NaN`), leere Datenbank (die
Übersicht hat einen echten Leerzustand mit Handlungsaufforderung), 10.001
Geräte bei Seitengröße 25 (1,4 s bis Inhalt).

---

## 5. Backend und Agent im Detail

### Rollen-Matrix — schreibende Endpunkte ohne 403-Test

| Endpunkt | Guard |
|---|---|
| `PATCH`, `DELETE /api/accounts/{id}` (`backend/app/routers/accounts_admin.py:82,129`) | admin |
| `PUT`, `DELETE` Alarmregeln; `POST`, `PUT`, `DELETE` Zeitpläne (`backend/app/routers/automation.py:144,162,170,185,204`) | admin |
| `POST`, `PUT`, `DELETE` Credentials (`backend/app/routers/credentials.py:46,68,111`) | admin |
| `PUT`, `DELETE /api/persons/{id}` (`backend/app/routers/persons.py:90,103`) | admin |
| `PUT /api/settings/ntfy`, `POST …/test` (`backend/app/routers/settings.py:30,44`) | admin |
| `DELETE` Enroll-Token, `PATCH` Gerät, `POST wake`, `POST update-agent`, `POST maintenance`, `DELETE` Gerät (`backend/app/routers/devices.py:149,243,288,313,359,377`) | operator |
| `PUT`, `DELETE` Skripte (`backend/app/routers/scripts.py:52,75`) | operator |

Dazu: Job-WebSocket sendet 4403 an Nicht-Operatoren
(`backend/app/routers/jobs.py:133`), getestet ist nur 4401; Fleet-WebSocket
ohne Test (`backend/app/routers/fleet.py:22`); Viewer-Scoping für
`/api/fleet/metrics` und `/api/inventory/search` ungetestet
(`backend/app/routers/fleet.py:55`, `backend/app/routers/inventory.py:20`).

### Regel-Erweiterungen (Trockenlauf)

- **ruff:** `S`, `B` und `UP` sind bereits aktiv (`backend/pyproject.toml:43-56`)
  — die im Auftrag vorgeschlagene Erweiterung ist schon erledigt. Mit
  `--ignore-noqa` bleiben 9 × S608, alle geprüft und unbedenklich (nur
  Spaltenliterale und `?`). Lohnende Kandidaten: `DTZ` (3 Treffer, einer davon
  der echte DST-Fehler P3-05) und `TRY400` (2 Treffer, verlorener Traceback:
  `backend/app/accounts.py:633`, `backend/app/credentials.py:235`).
- **mypy 2.4:** 4 Fehler im Normalmodus, 129 mit `--strict` (121 davon
  `type-arg`). Ein schrittweiser Einstieg ohne `--strict` ist sofort grün zu
  bekommen.
- **golangci-lint 2.14** (gosec, errcheck, staticcheck): Linux 25 Treffer
  (gosec 20, errcheck 5), staticcheck 0. Die gosec-Treffer sind überwiegend
  gewollt (Shell-Jobs G204, signierte Binary 0o755 G306) und brauchen
  begründete Ausnahmen statt Code-Änderungen.

### Fuzz- und Property-Kandidaten

- Agent: Dekodier-Schritt aus `handleMessage` herauslösen (`agent/client.go:197-222`),
  dazu `parseAptSimulate` (`agent/patches_linux.go:40`), `parseTabSeparated`
  (`agent/software_linux.go:44`), `parseResolvConf` (`agent/netinfo_unix.go:13`),
  `verifyPayload` (`agent/update.go:42`).
- Backend (hypothesis): `last_slot`/`is_due` mit Invariante „Slot ≤ jetzt“
  (`backend/app/patch_scan.py:36,51`); `job_secrets.extract`/`flush` —
  Ergebnis darf nicht von der Chunk-Grenze abhängen
  (`backend/app/job_secrets.py:96,123`); `releases._parse`/`is_newer`
  (`backend/app/releases.py:56`); `normalize_mac` (`backend/app/wol.py:25`).
- schemathesis: machbar, `app.openapi()` liefert 55 Pfade/72 Operationen auch
  im Produktionsmodus (`backend/app/main.py:163,171`).

---

## 6. Positive Befunde

- Routing mit tiefen Links, Reiter in der URL (`DD:129-133`), Code-Splitting
  für acht Routen (`frontend/src/App.tsx:24-41`).
- `Modal` mit Fokusfalle, Escape und Fokus-Rückgabe
  (`frontend/src/components/Modal.tsx:50-76`); `DeviceTabs` mit Pfeiltasten
  und Roving-Tabindex (`frontend/src/components/DeviceTabs.tsx:30-74`).
- `MetricChart` lässt Messlücken bewusst offen statt sie zu überzeichnen
  (`frontend/src/components/MetricChart.tsx:66-68`) und spannt die x-Achse über
  das gewählte Fenster.
- Die Übersicht hat einen echten Leerzustand mit Handlungsaufforderung.
- Typen sind streng: 0 × `any`, 0 × `@ts-ignore`, `noUncheckedIndexedAccess` an.
- Alle Job-Erzeugungen landen im Audit-Log (bis auf die zwei Befehle in P1-13).
- Backend-Coverage 90 %, `go test -race` grün, ruff mit `S`/`B`/`UP` sauber.

---

## 7. Designrichtung: neue Palette

Entscheidung vom 09.10.2026: **neue Palette**, Theme folgt dem System
(Fallback dunkel), **adaptive Dichte**, Reihenfolge der Bereiche wie im
Auftrag. Die Vorschau zeigt zwei Varianten; beide teilen Struktur,
Typo-Skala, Statusfarben und Chart-Serien und unterscheiden sich nur in
Akzent und Neutraltönen.

| | Variante A „Petrol“ | Variante B „Tinte“ |
|---|---|---|
| Akzent hell / dunkel | #0b6e78 / #4fb3bc | #3f4bc9 / #8d96f5 |
| Neutrale | kühles Schiefer | warmes Papiergrau (hell), Tintenblau (dunkel) |
| Navigationsleiste | tiefes Petrol in beiden Themes | Tinte in beiden Themes |
| Fuchs-Orange | bleibt Markenzeichen im Logo, nicht mehr UI-Akzent | ebenso |

Gemeinsam für beide:

- **Akzent außerhalb des Statusbands.** Rot, Bernstein, Grün und Grau sind
  ausschließlich Status; der Akzent markiert Auswahl, Primäraktion und Fokus.
- **Status immer mit Icon und Text** (OK, Warnung, Kritisch, Offline, Ohne
  Agent).
- **Kontrast:** alle 64 geprüften Text/Fläche-Paare beider Varianten in beiden
  Themes ≥ 4,5:1 (kleinster Wert 4,66:1).
- **Chart-Serien:** CPU, RAM, Disk aus den validierten Slots 1–3 der
  dataviz-Referenz (Blau, Orange, Aqua); `--pairs all` besteht hell und
  dunkel auf beiden Varianten. Aqua liegt hell bei 2,82:1 zur Fläche — daher
  Legende plus direkte Beschriftung.
- **Typo:** Manrope bleibt, Mono nur noch für Code, IPs, Versionen und IDs.
  Skala in `rem` mit Basis 13 px (Desktop) bzw. 15 px (Touch/≤ 720 px),
  Verhältnis ≈ 1,15.
- **Keine Verläufe, kein farbiger Rand-Balken** an Listenelementen; Flächen
  flach mit 1-px-Linie, Schatten nur für Overlays.
- **Signatur: das Lagebild.** Jedes Gerät eine Zelle, nach Zustand gruppiert
  und beschriftet — Status auf einen Blick, bei 10 Geräten wie bei 10.000.

---

## 8. Umsetzungsplan

Jeder PR hat einen eigenen Branch, wird erst nach Freigabe gepusht und ist
erst „fertig“, wenn `ruff check . && pytest`, `npm run lint && npm test &&
npm run build` und `make vet test` grün sind. Sichtbare PRs bringen
Playwright-Screenshots vorher/nachher mit (1440 px und 390 px, hell und
dunkel). `docs/` und `CHANGELOG.md` wandern mit jedem PR mit.

| # | Branch | Inhalt | Betroffene Dateien | Verifikation | Aufwand |
|---|---|---|---|---|---|
| 0 | `fix/fleet-refetch-loop` | **P0 sofort:** stabile `refresh`-Referenz, In-Flight-Guard, WS-Refresh drosseln (höchstens 1 Abruf je 2 s), Polling pausiert bei verstecktem Tab | `frontend/src/hooks/useFleet.ts`, `frontend/src/App.tsx`, neuer Test `useFleet.test.ts` | Vitest zählt Abrufe; Playwright: ≤ 1 Abruf je Endpunkt in 10 s Leerlauf | S |
| 1 | `fix/fleet-broadcast-coalescing` | Fleet-Broadcasts serverseitig bündeln (P1-14) | `backend/app/fleet_ws.py`, Test | pytest: 1.000 Alarme → ≤ wenige Broadcasts | S |
| 2 | `chore/session-start-hook` | Cloud-Sessions installieren venv, `npm ci`, Go-Module | `.claude/settings.json`, `.claude/hooks/session-start.sh` | Hook-Lauf in frischer Session | S |
| 3 | `test/e2e-playwright` | E2E-Smoke (Login, Geräteliste, Gerätedetail, Skript ausführen, Rollen) + axe gegen Dev-Backend mit Auth; Screenshot-Harness; Seed-Skript mit Worst Cases | `frontend/e2e/`, `frontend/playwright.config.ts`, `backend/tests/fixtures/seed_demo.py`, `ci.yml` | neuer CI-Job grün; axe-Baseline als Ausnahmeliste | M |
| 4 | `refactor/css-structure` | `app.css` aufteilen (tokens, base, components, pages), tote Klassen raus, Kollisionen und ungültige Deklarationen beheben — **ohne** neue Optik | `frontend/src/styles/*` | Screenshot-Diff ≈ 0 außer den bewusst behobenen Kollisionen | M |
| 5 | `feat/design-tokens` | Neue Palette (gewählte Variante), Typo-/Abstands-/Radius-/z-Index-/Motion-Tokens, Theme System/Hell/Dunkel, adaptive Dichte, `theme-color`, reduzierte Bewegung, Verläufe raus | `frontend/src/styles/tokens.css`, `useTheme.ts`, `index.html`, `Sidebar.tsx` | axe: 0 Kontrastverstöße; Screenshots | L |
| 6 | `feat/ui-primitives` | `StatusBadge` (Icon + Text) statt `Dot`, `PageHeader`, `EmptyState`, `ErrorState` (`role="alert"`), `DataTable` (semantisch, sortierbar, Sticky Header, Kürzung mit `title`, `tabular-nums`, optionale Auswahl), Menü, Landmarks, Skip-Link, Navigation als Links mit `aria-current`, `ConfirmDialog` fokussiert „Abbrechen“ | `frontend/src/ui.tsx` → `frontend/src/ui/*`, `App.tsx`, `Sidebar.tsx`, `ConfirmDialog.tsx` | Vitest je Primitive; axe ohne `region`/`landmark`-Verstöße | L |
| 7 | `refactor/data-layer` | Einheitliches Datenladen (react-query **oder** eigener Hook, Entscheidung D-01), Fleet-WS → Invalidierung, Laufzeitvalidierung kritischer Antworten (D-10), Error Boundary pro Route | `frontend/src/api/*`, `hooks/*`, `App.tsx` | Tests für Dedup und Invalidierung; E2E grün | M |
| 8 | `feat/overview` | Übersicht: Lagebild, Zu-tun-Liste ohne Rand-Balken, Kennzahlen ohne Mono-Etiketten, Lastkurve nach dataviz (Legende, Touch-/Tastatur-Tooltip, HTML-Achsen) | `OverviewPage.tsx`, `overviewTasks.ts`, `fleetChart.ts` | Screenshots; Vitest; axe | M |
| 9 | `feat/device-list` | Geräteliste: `DataTable`, Sortierung, Statusspalte mit Text, Kartenlayout ≤ 720 px, Zahlenformat, Mehrfachauswahl mit Bestätigung (jede Aktion läuft über die bestehenden, auditierten Endpunkte), „alle“ nach D-05 | `DevicesPage.tsx`, `FilterBar.tsx`, `usePagination.ts` | Screenshots inkl. 10k-Seed; E2E Massenaktion | M–L |
| 10 | `refactor/device-detail-split` | `DeviceDetail.tsx` in Reiter-Dateien und Hooks zerlegen, eine `JobConsole` mit `aria-live`, Status und Exit-Code — keine Optikänderung | `frontend/src/components/device/*` | Bestehende Tests + neue Reiter-Tests; Screenshot-Diff ≈ 0 | L |
| 11 | `feat/device-detail` | Gerätedetail: responsiver Kopf mit Neustart/Terminal/Menü, scrollbare Reiterleiste, `kv`-Grid, MetricChart nach dataviz | `frontend/src/components/device/*`, `MetricChart.tsx` | Screenshots 390 px: alle Aktionen sichtbar | M |
| 12 | `feat/scripts-automation` | Skripte und Automatisierung im neuen System | `ScriptsPage.tsx`, `AutomationPage.tsx`, `ScheduledScripts.tsx` | Screenshots; E2E Skript ausführen | M |
| 13 | `feat/alerts` | Alarme: mobil quittieren, Ladezustand statt „leer“, Fehlerpfad beim Quittieren | `AlertsPage.tsx` | Screenshots; Vitest | M |
| 14 | `feat/patches` | Patches im neuen System, `DataTable` | `PatchesPage.tsx` | Screenshots | M |
| 15 | `feat/admin-audit` | Admin und Audit-Log, `select-name`-Fix, semantische Tabelle | `AdminPage.tsx`, `AdminExtras.tsx`, `AuditPage.tsx` | axe 0 kritisch | M |
| 16 | `test/backend-role-matrix` | Parametrisierte 403-Tests für alle 33 Endpunkte mit `AUTH_ENABLED=true`, Viewer-Scoping für Fleet-Metriken und Inventarsuche, WS-4403, Audit für `update`-Push und `get_logs` | `backend/tests/test_role_matrix.py`, `backend/app/routers/agent.py`, `backend/app/agents_ws.py` | pytest, Coverage ≥ heutigem Stand | M |
| 17 | `chore/backend-quality` | mypy (normal) in CI, 4 Fehler beheben, `DTZ` + DST-Fix, `TRY400`, hypothesis-Tests | `backend/pyproject.toml`, `patch_scan.py`, `notify.py`, Tests | ruff, mypy, pytest grün | M |
| 18 | `chore/agent-quality` | `-race` in CI, golangci-lint mit begründeten Ausnahmen, `SetReadLimit`, Goroutine-Leak, Dekodierung herauslösen + Fuzz-Tests, vet für Windows/macOS | `agent/client.go`, `agent/*_test.go`, `.golangci.yml`, `ci.yml` | `make vet test`, Fuzz 60 s je Ziel | M |
| 19 | `docs/design-system` | `DESIGN.md` aus dem gebauten System, `CLAUDE.md`-Fallstricke ergänzen | `DESIGN.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md` | Gegenlesen | S |

Reihenfolge: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 →
15; 16–18 laufen unabhängig und können dazwischen eingeschoben werden.
Vor jedem PR laufen `code-review`, `simplify` und `security-review`.

---

## 9. Dependency-Entscheidungstabelle

Größen gemessen am 09.10.2026 mit esbuild (minifiziert, Tree-Shaking, gzip -9,
React extern) für den typischen Import. „Letztes Release“ laut npm-Registry.
Versionen, die jünger als zwei Wochen sind, würde ich beim Einbau auf die
Vorversion pinnen.

| ID | Paket | Zweck | gzip | Version / letztes Release / Releases gesamt | Alternative „selbst bauen / behalten“ | Empfehlung |
|---|---|---|---|---|---|---|
| D-01 | `@tanstack/react-query` | Server-State: Cache, Dedup, `refetchInterval`, Fokus-/Sichtbarkeits-Refetch; WS `refresh` → `invalidateQueries` | 10,4 kB | 5.104.1 / 02.10.2026 / 541 | Eigener `useResource`-Hook mit Dedup und Sichtbarkeit (≈ 150 Zeilen) | **Ja** — behebt die Fehlerklasse hinter P0-01 und P2-08 an einer Stelle |
| D-02 | `@base-ui/react` | Zugängliche Primitives | Dialog + AlertDialog 23,8 kB; Menu + Popover + Tooltip 68,8 kB; alle sechs 87,6 kB | 1.9.0 / 09.10.2026 / 13 | `Modal` behalten (nur Initialfokus fixen), Menü/Popover mit nativer Popover-API + Roving-Focus wie in `DeviceTabs` (≈ 120 Zeilen) | **Nein** — 69 kB für Menü/Tooltip übersteigen den Nutzen; der vorhandene Fokus-Code ist gut |
| D-03 | `cmdk` | CommandPalette | 17,8 kB | 1.1.1 / 14.03.2025 / 39 | Eigene Palette um Combobox/Listbox-ARIA, `aria-activedescendant`, `scrollIntoView` ergänzen (≈ 50 Zeilen) | **Nein** — seit 19 Monaten kein Release, Lücke ist klein |
| D-04 | `sonner` | Toasts für Job-, Skript- und Befehlsergebnisse, mit `aria-live` | 9,6 kB | 2.0.8 / 09.08.2026 / 65 | Eigene Toast-Region (≈ 100 Zeilen) | **Ja** — klein, zugänglich, gepflegt |
| D-05 | `react-virtuoso` | Virtualisierte Tabellen | 20,1 kB | 4.18.16 / 29.09.2026 / 317 | Pagination behalten, „alle“ ab 500 Zeilen ausblenden | **Nein, vorerst** — mit Pagination reicht die Messung (1,4 s bei 10.001 Geräten); nur nötig, wenn „alle“ bleiben soll |
| D-06 | `@tanstack/react-table` | Sortieren, Filtern, Spaltenwahl | 28,4 kB (v9, Standard-Features) | 9.2.8 / 08.10.2026 / 336 | Typisierte `DataTable` mit Spaltenkonfiguration, Sortierung, Auswahl (≈ 200 Zeilen) | **Nein** — v9 ist eine frische Major-Version, unser Bedarf ist klein |
| D-07 | `recharts` | Allgemeine Charts | 110,1 kB | 3.10.1 / 25.07.2026 / 295 | Eigene SVG-Charts nach dataviz überarbeiten | **Nein** — größer als der heutige Haupt-Chunk |
| D-08 | `liveline` | Live-Kurven | nicht gemessen | 0.0.7 / 12.03.2026 | Eigene Charts | **Nein** — Version 0.0.x |
| D-09 | `@number-flow/react` | Animierte Kennzahlen | 6,2 kB | 0.6.2 / 18.07.2026 / 40 | `tabular-nums` ohne Animation | **Nein** — Bewegung ohne Zustandsinformation in einem Ops-Dashboard |
| D-10 | `zod` | Laufzeitvalidierung in `api/client.ts` | `zod/mini` 4,8–5,8 kB; klassisch ≥ 21,9 kB | 4.6.5 / 13.09.2026 / 1.011 | Handgeschriebene Type Guards für Inventar und Geräte (≈ 100 Zeilen) | **Ja, als `zod/mini`** — nur für Geräte, Gerätedetail, Alarme |
| D-11 | `motion` | Layout-/Exit-Animationen | 43,2 kB (`LazyMotion` 29,2 kB) | 14.1.0 / 09.10.2026 / 458 | CSS-Transitions + View Transitions API | **Nein** |
| D-12 | `clsx` | Klassenbedingungen | 0,25 kB | 2.1.1 / 23.04.2024 / 15 | `cx()`-Helfer, 3 Zeilen | **Nein** — selbst bauen |
| D-13 | `@playwright/test` (dev) | E2E, Screenshots | 0 (dev) | 1.64.0 / 09.10.2026 | — | **Ja** (auf 1.63.x pinnen) |
| D-14 | `@axe-core/playwright` (dev) | A11y in E2E | 0 (dev) | 4.13.0 / 09.10.2026; Lizenz MPL-2.0 | — | **Ja** (Vorversion pinnen) |
| D-15 | `msw` (dev) | API-Mocks in Vitest | 0 (dev) | 3.0.2 / 03.10.2026 | Fetch-Mocks wie heute | **Später** — erst mit D-01 sinnvoll |
| D-16 | `knip` (dev) | Ungenutzte Dateien, Exporte, Deps | 0 (dev) | 6.41.0 / 09.10.2026 | grep von Hand (hier: 11 tote CSS-Klassen) | **Ja**, zunächst nicht blockierend |
| D-17 | `mypy` (dev, pip) | Typprüfung Backend | — | 2.4.0 | — | **Ja**, ohne `--strict` |
| D-18 | `hypothesis` (dev, pip) | Property-Tests | — | — | Tabellentests | **Ja** — fand mit dem Trockenlauf bereits den DST-Fehler |
| D-19 | `schemathesis` (dev, pip) | OpenAPI-Fuzzing | — | — | Rollen-Matrix-Tests (PR 16) | **Später**, optional als manueller Lauf |
| D-20 | golangci-lint (Tool) | gosec, errcheck, staticcheck | — | 2.14.0 | `go vet` | **Ja**, als CI-Tool, keine Modul-Dependency |

---

## 10. Anhang: Messwerte

| Messung | Wert |
|---|---|
| Abrufe je Endpunkt in 10 s Leerlauf (11 Geräte) | 569 (`/api/devices`, `/api/alerts`, `/api/patches/summary`, `/api/persons`) |
| `/api/devices` bei 10.001 Geräten | 6,9 MB, 292 ms |
| Geräteliste bei 10.001 Geräten, Seitengröße 25 | 1,4 s bis Inhalt, 1.043 DOM-Knoten |
| Geräteliste bei 10.001 Geräten, „alle“ | 8,9 s, 343.498 DOM-Knoten, 368 MB Heap |
| Übersicht bei 10.001 Geräten | 1,2 s bis Inhalt |
| axe-Verstöße Kontrast (alle Seiten, Desktop) | dunkel 88, hell 126 |
| axe `region` / `landmark-one-main` | jede Seite |
| Touch-Ziele < 44 px auf 390 px | 20–40 je Seite |
| Validator Serienfarben heute | dunkel FAIL (Helligkeitsband), hell FAIL (Normalsicht ΔE 13,8) |
| Validator Serienfarben neu (Slots 1–3) | hell und dunkel PASS, `--pairs all` |
