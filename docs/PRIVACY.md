# Was das Wartungsprogramm auf deinem Gerät tut

Stand: 07.09.2026.

Diese Seite ist für **dich als Nutzerin oder Nutzer eines betreuten Geräts**
geschrieben, nicht für Technikerinnen und Techniker. Sie beschreibt in
einfachen Worten, was das kleine Hintergrundprogramm („Agent") auf deinem
Computer macht, welche Daten es weitergibt und welche nicht.

Zum Weiterreichen gedacht: Wer ein Gerät betreut, sollte diese Seite der
betreuten Person geben, bevor der Agent installiert wird.

## Kurz gesagt

Auf dem Gerät läuft ein Programm, das alle 60 Sekunden meldet: „Ich bin da,
so voll ist die Festplatte, so ausgelastet ist der Rechner." Zusätzlich kann
die betreuende Person Wartungsaufgaben ausführen — Updates installieren,
etwas nachsehen, dir bei einem Problem über den Bildschirm helfen.

**Es liest nicht mit.** Nicht was du tippst, nicht was auf dem Bildschirm
steht, nicht welche Webseiten du besuchst, nicht was in deinen Dateien steht.

## Was regelmäßig übertragen wird

Alle 60 Sekunden, automatisch:

| Was | Beispiel |
|---|---|
| Auslastung von Prozessor und Arbeitsspeicher | 12 % CPU, 47 % RAM |
| Freier Platz auf den Laufwerken | C: zu 68 % voll |
| Netzwerkdurchsatz | 0,3 MB/s |
| Temperatur des Prozessors, Akkustand | 54 °C, 82 % (lädt) |
| **Benutzername** der gerade angemeldeten Person | `anna` |
| Ob ein Neustart aussteht | ja/nein |
| Version des Wartungsprogramms | 0.3.0 |

Alle 12 Stunden zusätzlich eine Bestandsaufnahme:

| Was | Beispiel |
|---|---|
| Gerätename, Betriebssystem und Version | `anna-laptop`, Windows 11 |
| Hardware-Eckdaten | Prozessortyp, Größe des Arbeitsspeichers |
| Netzwerkkarten mit IP- und MAC-Adresse | `192.168.2.42` |
| **Liste der installierten Programme** mit Versionsnummer | Firefox 141.0, LibreOffice 25.2 |
| Ausstehende Systemupdates | 3 Sicherheitsupdates |

Der angemeldete Benutzername und die Programmliste sind die beiden Punkte, die
am ehesten als persönlich empfunden werden. Beides ist Absicht: der
Benutzername zeigt, ob jemand gerade am Gerät sitzt, bevor ein Neustart
ausgelöst wird; die Programmliste ist nötig, um veraltete Software mit
bekannten Sicherheitslücken zu finden.

## Was ausdrücklich **nicht** übertragen wird

- Kein Bildschirminhalt, keine Screenshots, keine Aufzeichnung
- Keine Tastatureingaben
- Kein Browserverlauf, keine Lesezeichen, keine Suchanfragen
- Keine Datei- oder Ordnernamen, keine Dateiinhalte, keine Dokumente
- Keine E-Mails, Nachrichten oder Chatverläufe
- Kein Mikrofon, keine Kamera
- Keine Passwörter aus dem Gerät heraus
- Kein Standort

Das Programm hat diese Funktionen nicht — es geht nicht darum, dass sie
abgeschaltet wären.

## Was die betreuende Person zusätzlich tun kann

Diese Dinge passieren nicht automatisch, sondern wenn jemand sie auslöst:

| Aktion | Was das heißt |
|---|---|
| **Updates installieren** | Systemupdates einspielen, teils mit Neustart |
| **Ein Wartungsskript ausführen** | Ein vorbereiteter Befehl, z. B. Papierkorb leeren oder Festplatte prüfen |
| **Einen Befehl ausführen** | Wie ein Kommando in der Eingabeaufforderung, mit vollen Systemrechten |
| **Die letzten Protokollzeilen abrufen** | Nur die Meldungen des Wartungsprogramms selbst |
| **Das Gerät aufwecken** | Aus dem Ruhezustand, sofern im selben Netz |
| **Fernwartung starten** | Bildschirm sehen und steuern — siehe unten |

Der Punkt „Einen Befehl ausführen" ist der weitreichendste: damit kann die
betreuende Person auf dem Gerät technisch alles tun, was auch am Gerät selbst
möglich wäre. Genau dafür ist ein Wartungswerkzeug da — und genau deshalb
solltest du wissen, wer diesen Zugang hat.

**Jede dieser Aktionen wird protokolliert:** wer sie ausgelöst hat, wann, auf
welchem Gerät und mit welchem Ergebnis. Das Protokoll lässt sich nicht
nachträglich verändern. Du darfst jederzeit verlangen, es einzusehen.

## Fernwartung: dein Bildschirm

Für die Bildschirmfreigabe wird ein separates Programm verwendet
(RustDesk). Es läuft über einen eigenen Server im Heimnetz der betreuenden
Person, nicht über einen fremden Anbieter.

Wichtig: Es gibt zwei Betriebsarten.

1. **Mit Bestätigung** — es erscheint eine Abfrage auf deinem Bildschirm, und
   erst wenn du zustimmst, wird die Verbindung aufgebaut. *Das ist die
   empfohlene Einstellung für persönlich genutzte Geräte.*
2. **Ohne Bestätigung** (unbeaufsichtigter Zugriff) — die Verbindung kommt
   ohne Nachfrage zustande. Sinnvoll für einen Server im Keller, nicht für
   einen Familienlaptop.

Frag die Person, die dein Gerät betreut, welche Einstellung bei dir aktiv ist.
Wenn dir die Antwort nicht passt, lässt sie sich ändern.

Während einer Fernwartungssitzung siehst du in der Regel ein Hinweisfenster
oder ein Symbol. Wird dein Bildschirm gesteuert, merkst du es.

## Deine Rechte

- **Du darfst fragen**, was gespeichert ist, und Einsicht ins Protokoll deiner
  Geräteaktionen verlangen.
- **Du darfst widersprechen.** Das Wartungsprogramm lässt sich jederzeit
  deinstallieren — es ist ein normaler Systemdienst.
- **Du darfst einen eigenen Zugang bekommen.** Es gibt eine Nur-Lese-Rolle,
  die ausschließlich die eigenen Geräte zeigt. Damit siehst du dieselben
  Daten wie die betreuende Person, ohne etwas ändern zu können.
- **Du kannst das Gerät jederzeit ausschalten oder vom Netz nehmen.** Der
  Agent hat keinen Weg, das zu verhindern; er meldet dann schlicht nichts
  mehr.

## Wo die Daten liegen

Auf einem Server im Heimnetz der betreuenden Person, nicht bei einem
Cloud-Anbieter. Der Zugang von außen ist verschlüsselt.

Aufbewahrungsfristen im Auslieferungszustand:

| Daten | Wie lange |
|---|---|
| Detaillierte Messwerte (jede Minute) | 48 Stunden |
| Verdichtete Stundenwerte | 30 Tage |
| Bestandsaufnahme, Alarme, Aufgabenprotokolle | bis zum Löschen des Geräts |
| Aktionsprotokoll | dauerhaft |

Wird das Gerät im Dashboard gelöscht, verliert der Agent sofort seinen
Zugang und die zugehörigen Daten verschwinden mit.

## Deinstallieren

```bash
# Linux / macOS, im Terminal
sudo rmm-agent stop && sudo rmm-agent uninstall
sudo rm -f /usr/local/bin/rmm-agent /etc/rxf-rmm/agent.json
```

```powershell
# Windows, in einer PowerShell mit Administratorrechten
rmm-agent stop
rmm-agent uninstall
Remove-Item -Recurse -Force "$env:ProgramFiles\rxf-rmm", "$env:ProgramData\rxf-rmm"
```

Danach meldet das Gerät nichts mehr. Bereits übertragene Daten bleiben auf dem
Server, bis das Gerät dort gelöscht wird — bitte zusätzlich darum bitten.
