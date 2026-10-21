# Vulpexa — Design-System

Stand: 10.10.2026. Dieses Dokument beschreibt das gebaute System, nicht ein
Wunschbild: jede Regel hier hat eine Stelle im Code, auf die sie zeigt. Wer
eine Seite baut, liest zuerst diesen Text und dann eine der
Referenzseiten (`frontend/src/pages/devices/`, `pages/device/`,
`pages/scripts/`, `pages/automation/`).

## 1. Grundsätze

- **Lage vor Zahl.** Eine Seite beantwortet zuerst die Frage, mit der man
  sie öffnet („Muss ich etwas tun?"), dann die Details. Die Übersicht führt
  deshalb mit „Zu tun", die Geräteliste sortiert Befunde nach oben.
- **Ruhig, solange nichts ist.** Farbe ist ein Signal. Eine gesunde Flotte
  sieht neutral aus; Gelb und Rot erscheinen erst, wenn eine Schwelle
  überschritten ist.
- **Status nie nur als Farbe.** Jeder Zustand trägt ein Symbol mit eigener
  Form und ein Wort (`StatusBadge`).
- **Jede Aktion sagt vorher, was sie tut.** Bestätigungen nennen Gerät,
  Umfang und was übersprungen wird; destruktive Schritte verlangen ein
  getipptes Wort; Ergebnisse kommen als Toast.
- **Tastatur und Telefon sind gleichwertig.** Alles ist per Tastatur
  erreichbar, nichts hängt an Hover, und jede Seite läuft bei 390 px ohne
  seitliches Scrollen.

## 2. Farbe — Palette „Tinte"

Definiert in `frontend/src/styles/tokens.css`. Hell steht auf `:root`, Dunkel
zweimal mit gleichem Inhalt: unter `prefers-color-scheme` (Einstellung
„System") und unter `:root[data-theme='dark']` (ausdrückliche Wahl).

| Rolle | Hell | Dunkel | Verwendung |
|---|---|---|---|
| Hintergrund `--bg` | #f6f5f2 | #111219 | Seitenfläche |
| Fläche `--surface` | #ffffff | #181a23 | Panels, Tabellen, Dialoge |
| Text `--tx` / `--tx-2` / `--tx-3` | #16181f / #4a4d57 / #676a73 | hell abgestuft | Primär, sekundär, Hinweis — alle ≥ 4,5:1 |
| Akzent `--accent` | #3f4bc9 | #8d96f5 | Auswahl, Hauptaktion, Fokus — **nie Status** |
| Navigation `--shell` | #1c1f33 | #0c0d13 | Rail, Bulk-Leiste |
| OK / Warnung / Kritisch / Aus | #2f9e55 / #e0a100 / #d92d20 / #8b8e98 | angepasst | nur Zustand |
| Reihen `--s1` `--s2` `--s3` | #2a78d6 / #eb6834 / #1baf7a | angepasst | nur Diagramme |

Regeln:

- Zu jeder Statusfarbe gibt es drei Varianten: der nackte Token für Flächen
  und Marken, `-tx` für Text, `-soft` für Hintergründe.
- Diagrammreihen sind keine Statusfarben und umgekehrt. Die Reihen sind mit
  dem dataviz-Validator gegen Farbfehlsichtigkeit geprüft; die dritte Reihe
  ist zusätzlich gestrichelt.
- Das Fuchs-Orange gehört dem Logo, nicht der Oberfläche.
- Keine Farbwerte im Komponenten-CSS — nur Tokens.

## 3. Typografie, Raster, Form

- Schrift: Manrope Variable für alles, IBM Plex Mono nur für Code, Befehle,
  Kennungen und Hashes — nie als Dekoration.
- Größen als `rem` auf einer 13-px-Wurzel (15 px bei Touch oder ≤ 720 px):
  `--fs-xs` … `--fs-3xl`, Verhältnis ≈ 1,15. Zahlen in Tabellen und
  Kennzahlen tragen die Klasse `num` (tabellarische Ziffern).
- Abstände auf einem 4-px-Raster: `--sp-1` (4 px) bis `--sp-12` (48 px).
- Radien `--r-xs` (4 px) bis `--r-xl` (16 px), `--r-pill`.
- Trefferflächen `--hit`: 32 px mit Maus, 44 px auf Touch-Geräten.
- Ebenen `--z-sticky` < `--z-rail` < `--z-popover` < `--z-modal` <
  `--z-toast` < `--z-boot`.

## 4. Bewegung

- Kurven: `--ease-out` für fast alles, `--ease-drawer` für Schubladen.
  Dauern `--dur-1` (120 ms) bis `--dur-3` (240 ms); nichts in der Bedienung
  dauert länger als 300 ms.
- Knöpfe geben beim Drücken nach (`scale(0.97)`); Popover und Menüs wachsen
  aus ihrem Auslöser. Die Befehlspalette öffnet ohne Animation — sie wird
  Hunderte Male am Tag geöffnet.
- `prefers-reduced-motion`: alle Übergänge entfallen; die Startsequenz
  springt auf das Endbild.
- **Startsequenz** (`frontend/src/boot/`): Beim ersten Laden je Sitzung
  zeichnet sich der Fuchs als Netzwerk aus Punkten, pingt die Flotte in ihren
  echten Statusfarben an und fliegt auf das Logo (`[data-boot-target]`) —
  das Zeichen, dass die Daten da sind. Danach nur noch die Kurzfassung; jede
  Taste überspringt.

## 5. Bausteine

Alle unter `frontend/src/ui/`, exportiert über `ui/index.ts`.

| Baustein | Wofür |
|---|---|
| `PageHeader` | Die eine `h1` einer Seite, Zähler, Untertitel, Hauptaktionen |
| `Panel` | Betitelter Bereich (`h2`), flach mit einer Haarlinie; `padded={false}` für Listen und Tabellen |
| `StatusBadge` | Zustand als Symbol + Wort; Arten `ok`, `warn`, `danger`, `off`, `noagent`, `info`, `neutral` |
| `KeyValue` | Beschriftung/Wert als Definitionsliste; Beschriftungen nehmen die Breite der längsten |
| `Meter` | Auslastung mit Schwellenmarken; Farbe erst ab Schwelle |
| `LineChart` | Zeitreihe: eine y-Achse, Legende mit aktuellem Wert, Fadenkreuz per Maus, Finger und Pfeiltasten (ARIA-Slider) |
| `Menu` | Überlauf-Aktionen nach dem WAI-ARIA-Menümuster |
| `Popover` | Freier Inhalt am Auslöser (z. B. gespeicherte Ansichten) |
| `Switch` | Ein/Aus mit `role="switch"` |
| `QrCode` | QR-Code als reines SVG (`role="img"`, Beschriftung Pflicht); dunkel auf hell in beiden Themes (`--qr-fg`/`--qr-bg`) |
| `EmptyState`, `ErrorNote`, `Skeleton`, `SkeletonRows` | Leer, Fehler (mit „Erneut versuchen"), Laden — Laden sieht nie aus wie leer |
| `Modal` (`components/`) | Dialog mit Fokusfalle; rendert per Portal in `<body>` |
| `ConfirmDialog` / `useConfirm` | Bestätigung; Fokus startet auf „Abbrechen", destruktiv optional mit getipptem Wort |
| `FilterBar` (`components/`) | Sich ausschließende Filter als Segment mit Zählern (Tablist-Tastaturmodell) |
| `JobConsole` (`pages/device/`) | Live-Ausgabe eines Auftrags; sagt Statuswechsel an, liest die Ausgabe nicht zeilenweise vor |
| `notify`, `trackJob`, `trackJobs` (`ui/toast.tsx`) | Rückmeldungen; ein Toast folgt einem Auftrag bis zum Ende, ein einziger Toast folgt vielen |

## 6. Muster

- **Breite**: Der Inhalt nimmt die ganze Breite neben der Seitenleiste;
  Raster füllen sie mit `auto-fit`/`auto-fill`, Fließtext behält sein Maß
  (`max-width: …ch`). Zwischen 721 und 1100 px schrumpft die Seitenleiste
  auf Icons (`--rail-w-compact`), darunter übernimmt die Leiste unten. Kein
  Bildschirm zwischen 390 und 2560 px scrollt seitwärts
  (`e2e/layout.spec.ts`).
- **Datentabelle** (`.dt` in `styles/components.css`): echtes `<table>`,
  Kopf klebt unter der Topbar, sortierbare Köpfe als Knöpfe mit
  `aria-sort`, Zeilenklick als Komfort für die Maus — der eigentliche Weg ist
  der Link in der Zeile. Spalten verschwinden über Container-Queries in der
  Reihenfolge ihres Werts; unter 1000 px wird aus der Tabelle eine
  Kartenliste.
- **Liste und Detail** (Skripte, Personen): Liste links, Auswahl rechts, die
  Auswahl steht in der Adresse (`?script=`), auf schmalen Bildschirmen
  jeweils eins von beiden mit Zurück-Link.
- **Massenaktionen**: Auswahl per Kästchen (Umschalt für Bereiche); die
  Leiste dockt unten an. Jede Aktion läuft über den Endpunkt des einzelnen
  Geräts — Rechteprüfung und Audit-Eintrag bleiben je Gerät — und nennt
  vorab, was sie überspringt.
- **Zustand in der Adresse**: Filter, Sortierung, Reiter und Auswahl stehen
  in den Query-Parametern, damit Neuladen, Lesezeichen und geteilte Links
  dieselbe Ansicht zeigen. Freitext-Eingaben halten eigenen State und
  schreiben nur in die Adresse (React Router aktualisiert sie in einer
  Transition).
- **Einstellungen als Satz** (Patch-Fenster): Die Auswahlfelder stehen im
  Text, damit man liest, was passieren wird.
- **Daten**: `@tanstack/react-query`; Schlüssel in `api/queryClient.ts`.
  Alles unter `['fleet', …]` und `['device', id, …]` frischt der
  Flotten-WebSocket auf (er überträgt nur `{"type": "refresh"}`).
  Antworten kritischer Endpunkte prüft `zod/mini` nachsichtig.

## 7. Sprache

- Deutsch, Satzanfang groß, ruhig und konkret: „Noch 12 GB frei auf /."
  statt „Warnung!". Keine Ausrufezeichen.
- Typografische Anführungszeichen („…") und Gedankenstriche (—).
- Daten als TT.MM.JJJJ; „vor 5 min", „gestern", „vor 3 Tagen", danach das
  Datum (`formatAgo`). Das genaue Datum steht im `title`.
- Zahlen mit Tausenderpunkt (`Intl.NumberFormat('de-DE')`).

## 8. Barrierefreiheit

- Landmarks (`header`, `nav`, `main`), Skip-Link, eine `h1` je Seite.
- Navigation aus echten Links mit `aria-current`; Reiter mit
  `aria-controls`/`aria-labelledby` am Panel.
- Fokus immer sichtbar (`--focus`), auch in Konsole und Palette.
- Jedes Eingabefeld hat eine Beschriftung, notfalls `.sr-only`.
- Live-Bereiche nur für Statuswechsel, nicht für Datenströme.
- Prüfung: `jsx-a11y` im Lint-Gate; Kontraste aller Token-Paare ≥ 4,5:1 für
  Text.

## 9. Verboten

Aus dem Audit (`docs/audit/2026-10-09-design-quality-audit.md`) und der
Handwerks-Untergrenze, die das System einhalten soll:

- Farbige Randstreifen breiter als 1 px als Kategorie- oder Statusmarke.
- Verläufe als Oberfläche, Schatten auf Panels.
- Monospace oder Versalien mit Sperrung als Etikett.
- Emoji und Sonderzeichen als Symbole (→, ⚠, ✓, ★) — es gibt `icons.tsx`.
- Inline-`style` außer für berechnete Werte (eine Breite in Prozent).
- `Date.now()` im Render — dafür gibt es `useNow()`.

## 10. Dateien

```
frontend/src/
  styles/tokens.css      Tokens (Farbe, Typo, Raster, Bewegung, Ebenen)
  styles/base.css        Reset, Fokus, Zahlen, reduzierte Bewegung
  styles/components.css  Knöpfe, Formulare, Chips, Status, Tabelle, Konsole, Dialoge
  styles/shell.css       Rail, Topbar, Panels, Menüs, Benachrichtigungen, Toasts
  styles/boot.css        Startsequenz
  ui/                    Bausteine
  shell/                 Rahmen der App
  pages/<bereich>/       eine Seite: Komponenten, <bereich>.css mit eigenem
                         Klassenpräfix, reine Logik in .ts, Tests in __tests__/
```
