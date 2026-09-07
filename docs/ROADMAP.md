# Roadmap

Stand: 07.09.2026. Der ursprüngliche Phasenplan (Phasen 0–7) ist
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
- Mobile Apps
