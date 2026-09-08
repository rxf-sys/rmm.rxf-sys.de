---
name: Fehler melden
about: Etwas verhält sich nicht wie erwartet
labels: bug
---

> Sicherheitslücken bitte **nicht** hier melden, sondern nach dem Weg in
> SECURITY.md.

## Was passiert

## Was erwartet wäre

## Reproduktion

1.
2.
3.

## Umgebung

- Komponente: Backend / Dashboard / Agent / Infrastruktur
- Version oder Commit:
- Betriebssystem des betroffenen Geräts (bei Agent-Themen):
- Browser (bei Dashboard-Themen):

## Logs

<details>
<summary>Ausgabe</summary>

```
# Backend:  docker compose logs --tail 100 backend
# Agent:    journalctl -u rxf-rmm-agent -n 50 --no-pager
```

</details>

## Schon geprüft

- [ ] `docs/TROUBLESHOOTING.md` durchgesehen
- [ ] `curl -fsS <server>/api/health` antwortet
