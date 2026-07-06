# Agent-Installation & Auto-Update

## Release bauen und signieren (auf der Build-Maschine)

Einmalig einen Signaturschlüssel erzeugen und den **öffentlichen** Teil in
`agent/update.go` (`updatePublicKey`) eintragen; den privaten Teil geheim
halten:

```bash
cd agent
make keygen
# → private (AGENT_SIGN_KEY) + public (in update.go pinnen)
```

Für jedes Release die Binaries bauen und signieren:

```bash
make sign VERSION=0.2.0 AGENT_SIGN_KEY=<base64 private key>
# erzeugt dist/rmm-agent-<os>-<arch>[.exe] + dist/manifest.json
```

Den Inhalt von `dist/` in das Server-Verzeichnis `AGENT_RELEASE_DIR`
(Default `/data/agent-releases`) legen. Der Server liest `manifest.json` beim
Start; bei einem neuen Release also Backend neu starten (oder Dateien vor dem
Deploy ablegen).

## Erstinstallation auf einem Gerät

Im Dashboard „Gerät hinzufügen" → Einmal-Token erzeugen. Dann die passende
Binary **und** das Install-Skript aufs Zielgerät bringen (USB, scp, …) und
ausführen:

```bash
# Linux / macOS
sudo ./install.sh --server https://rmm.rxf-sys.de --token <TOKEN> --label "Mama"
```

```powershell
# Windows (elevated PowerShell)
.\install.ps1 -Server https://rmm.rxf-sys.de -Token <TOKEN> -Label "Mama"
```

Der Installer legt die Binary ab, enrollt das Gerät und installiert den
Dienst mit Auto-Restart.

## Auto-Update

Beim Verbinden meldet der Agent seine Version. Ist im Server-Manifest eine
neuere hinterlegt, schickt der Server eine `update`-Nachricht mit
Download-URL, SHA-256 und Signatur. Der Agent lädt die Binary
(geräte-authentifiziert), **prüft SHA-256 und ed25519-Signatur gegen den
gepinnten Public Key**, ersetzt sich atomar (alte Binary bleibt als `.bak`)
und beendet sich — der Dienst startet die neue Version.

Ohne gültige Signatur wird nichts installiert: Wer den Update-Kanal
kontrolliert, aber nicht den privaten Schlüssel, kann keinen bösartigen Agent
ausliefern. Rollback bei Problemen: die `.bak`-Datei zurückkopieren und den
Dienst neu starten.

## Code-Signing-Zertifikate (bewusst nicht dabei)

Ohne Code-Signing-Zertifikat warnen **Windows SmartScreen/Defender** und
**macOS Gatekeeper** beim ersten Start vor einer „unbekannten" Anwendung.
Für den Familienkreis ist das vertretbar — du installierst persönlich:

- **Windows:** „Weitere Informationen" → „Trotzdem ausführen".
- **macOS:** Rechtsklick → „Öffnen", oder Quarantäne-Flag entfernen:
  `xattr -d com.apple.quarantine /usr/local/bin/rmm-agent`.

Wer die Warnungen loswerden will: Windows-Code-Signing-Zertifikat bzw. Apple
Developer Account (99 €/Jahr) und in den Build einbinden. Die interne
ed25519-Signatur des Auto-Updates ist davon unabhängig und immer aktiv.
