# Roadmap

Stand: 21.10.2026. Der ursprüngliche Phasenplan (Phasen 0–7) ist
abgeschlossen und liegt als Entscheidungsdokumentation unter
[`_archiv/RMM-PLAN.md`](_archiv/RMM-PLAN.md).

## Umgesetzt seit dem ursprünglichen Plan

Diese Punkte standen dort noch unter „nach v1 geparkt" und sind fertig:

- `viewer`-Rolle mit Beschränkung auf die Geräte der eigenen Person
- Wake-on-LAN aus dem Dashboard
- Vormerken fürs nächste Online-Gehen (Updates, Skripte, Neustart falls
  nötig) und ein Patch-Fenster, das offline gewesene Geräte nachholen

Ebenfalls hinzugekommen, ohne im Plan zu stehen: TOTP mit Backup-Codes,
der Fernet-verschlüsselte Passwort-Tresor pro Gerät samt
`##RMM-CRED##`-Übernahme aus Skript-Ausgaben, Personen-Verwaltung,
Alarmregeln mit Scope, wöchentliches Patch-Fenster und geplante Skripte.

## Mobilgeräte

Telefone und Tablets sollen mit in die Übersicht — überwiegend Privatgeräte,
Firmengeräte aber ausdrücklich eingeschlossen. Der Weg dorthin in Etappen:

**Etappe 0 — Geräteklasse (fertig).** `devices.device_class` trennt `agent`
von `mobile`. Ein Gerät ohne Agent wird über `POST /api/devices` angelegt,
bekommt keinen Zugang und lehnt jeden agentgebundenen Befehl mit 409 ab
(`backend/app/device_policy.py`). Die Oberfläche zeigt für diese Klasse nur
Reiter, hinter denen etwas liegt, und pflegt Modell, OS-Version,
Seriennummer, IMEI, Notiz und Besitzverhältnis von Hand — mit dem Datum der
letzten Pflege daneben, damit eine alte Karteikarte nicht aussieht wie eine
frische.

**Etappe 1 — iOS über MDM.** NanoMDM als eigener Container hinter Caddy,
gesteuert aus Vulpexa; Auth über `SignMessage`-Header statt mTLS, weil mTLS
hinter dem Cloudflare-Tunnel nicht ankommt. Voraussetzung ist ein
APNs-Push-Zertifikat von Apple — ohne das läuft kein Kommando. Damit kommen
Inventar, Sperren, Verloren-Modus und Richtlinien.

Die Infrastruktur dafür steht: NanoMDM und der SCEP-Server hängen am
Compose-Profil `mdm`, Caddy kennt die Routen und sperrt die
Verwaltungs-API, das Push-Zertifikat ist eingespielt (gültig bis
21.10.2027). Registriert wird aus dem Dashboard: ein Admin erzeugt pro
Gerät einen Einmal-Link als QR-Code, das Profil trägt eine Challenge, die
genau einmal gilt, und der NanoMDM-Webhook ordnet das Telefon seiner
Karteikarte zu und füllt das Inventar (Anleitung in
[`MDM-SETUP.md`](MDM-SETUP.md), Teil 6). Seit Oktober 2026 dazu: Sperren,
Löschen und Code entfernen aus dem Dashboard, tägliche Inventar-Runden
(Geräteinformationen, Sicherheitsstatus, Profile, Zertifikate, Apps), der
iOS-Abgleich mit Apples Versionsliste, drei Alarmregeln für Telefone und die
automatische Erneuerung der Geräte-Identitäten vor ihrem Ablauf.

Offen für iOS: Konfigurationsprofile verteilen (WLAN, VPN, Mail,
Code-Richtlinie — alles ohne Betreuung möglich) und erzwungene iOS-Updates
über Declarative Device Management. Apples Schema erlaubt
`softwareupdate.enforcement.specific` ab iOS 17 auch für nicht betreute
Geräte; das gehört zuerst an einem echten Gerät ausprobiert.

**Betreuung (Supervision).** Per Profil registrierte Geräte sind nicht
betreut. Verloren-Modus (`EnableLostMode`) und erzwungene Updates
(`ScheduleOSUpdate`) setzen Betreuung voraus — auf Privatgeräten gibt es
den Verloren-Modus deshalb nicht; Sperren, Inventar und Löschen gehen. Für
Firmengeräte wäre die automatische Registrierung über Apple Business
Manager (NanoDEP) der Weg zu Betreuung und Zero-Touch: Gerät einschalten,
fertig. Bestandsgeräte kommen dorthin nur über Apple Configurator, und dabei
werden sie gelöscht.

**Befugnisse je Gerät (umgesetzt).** Statt am Besitzverhältnis hängt, was
an einem Telefon erlaubt ist, an seinen MDM-Befugnissen: Sperren, Code
entfernen, Löschen und App-Liste lassen sich je Gerät abschalten und wieder
einschalten. Jedes neue Profil trägt dafür alle Rechte — fehlende Rechte
ließen sich später nur mit einer neuen Registrierung ergänzen. Die Grenze
sitzt im Server (`app/mdm_commands.py`), nicht in der Oberfläche.

**Etappe 2 — Android.** Über die Android Management API mit Arbeitsprofil,
damit auf einem Privatgerät nur der dienstliche Teil verwaltet wird. Eigener
Zuschnitt, deshalb nach iOS.

## Offen

| Thema | Warum interessant | Aufwand |
|---|---|---|
| Software-Deployment-Presets (winget/apt/brew) | Der häufigste Handgriff nach dem Patchen | mittel |
| Read-only-Einbindung der Gerätedaten ins Admin-Dashboard | Ein Ort statt zwei | klein |
| Code-Signing-Zertifikate für die Agent-Binaries | Beseitigt SmartScreen/Gatekeeper-Warnungen bei der Erstinstallation und das `Unblock-File` im Windows-Installer | extern (Zertifikatskosten) |
| Schema-Versionierung | Heute wächst das Schema nur additiv; ein Downgrade gibt es nicht | mittel |
| Metrik-Export (Prometheus) | Anbindung an bestehendes Monitoring | klein |

## Bewusst außerhalb des Rahmens

Damit die Diskussion nicht jedes Mal neu geführt wird — aus dem
ursprünglichen Plan übernommen und weiterhin gültig:

- Multi-Tenant oder Mandantentrennung
- Ticketing, Abrechnung, Kundenportal
- Eigene Remote-Desktop-Implementierung
- Eigene mobile Apps für das Dashboard (die Verwaltung von Telefonen selbst steht oben)
