# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/);
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
- Dokumentation: `docs/ARCHITECTURE.md`, `docs/API.md`,
  `docs/CONFIGURATION.md`, `docs/OPERATIONS.md`, `docs/TROUBLESHOOTING.md`,
  `SECURITY.md`, `CONTRIBUTING.md`, dieses Changelog, `LICENSE` (Apache-2.0)
  und Issue-/PR-Vorlagen.
- `.env.example` enthält jetzt auch `CLEANUP_INTERVAL_S`, `ALERT_INTERVAL_S`,
  `METRICS_RAW_RETENTION_H` und `METRICS_HOURLY_RETENTION_D`.

### Geändert
- Der ruff-Regelsatz ist explizit in `pyproject.toml` aufgeführt und die
  ruff-Version auf die 0.16er-Reihe gepinnt. Vorher hätte eine neue
  ruff-Version das Lint-Gate ohne Codeänderung rot gemacht.
- README neu strukturiert; die Beschreibung der CD-Pipeline entsprach nicht
  mehr der Realität (SSH statt Self-hosted Runner).

### Behoben
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

---

Für den Weg zum ersten vollständigen Funktionsumfang (Phasen 0–7) siehe
[`docs/_archiv/RMM-PLAN.md`](docs/_archiv/RMM-PLAN.md).
