## Was ändert sich

<!-- Ein bis drei Sätze. Was tut der PR, aus Sicht von jemandem, der den Code
     nicht gelesen hat. -->

## Warum

<!-- Das Problem, nicht die Lösung. Bei einem Bug: was ging schief und unter
     welchen Umständen. -->

## Wie geprüft

- [ ] `cd backend && ruff check . && pytest -v --cov=app --cov-fail-under=70`
- [ ] `cd frontend && npm run build`
- [ ] `cd agent && make vet test`
- [ ] Manuell geprüft: <!-- was genau, oder "entfällt" -->

## Auswirkungen

- [ ] Datenbankschema geändert (neue Spalte/Tabelle — nur additiv, es gibt kein Downgrade)
- [ ] Neue oder geänderte Umgebungsvariable → `docs/CONFIGURATION.md` und `.env.example` aktualisiert
- [ ] Neuer oder geänderter Endpunkt → `docs/API.md` aktualisiert
- [ ] Sicherheitsrelevant (Auth, Rollen, Secrets, Agent-Ausführung, Signaturkette)
- [ ] `CHANGELOG.md` ergänzt

## Offene Punkte

<!-- Was bewusst nicht in diesem PR erledigt wird, oder "keine". -->
