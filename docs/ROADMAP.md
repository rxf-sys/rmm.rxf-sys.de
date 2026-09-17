# Roadmap

Stand: 17.09.2026. Der ursprüngliche Phasenplan (Phasen 0–7) ist
abgeschlossen und liegt als Entscheidungsdokumentation unter
[`_archiv/RMM-PLAN.md`](_archiv/RMM-PLAN.md).

## Umgesetzt seit dem ursprünglichen Plan

Diese Punkte standen dort noch unter „nach v1 geparkt" und sind fertig:

- `viewer`-Rolle mit Beschränkung auf die Geräte der eigenen Person
- Wake-on-LAN aus dem Dashboard

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

**Befugnisse nach Besitzverhältnis.** Privat: Inventar, Sperren,
Verloren-Modus, Richtlinien. Firma: zusätzlich Komplett-Löschen und
erzwungene Updates. Die Grenze gehört in den Server, nicht in die Disziplin
dessen, der das Dashboard bedient — dieselbe Stelle, die heute schon die
agentgebundenen Befehle abweist.

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
