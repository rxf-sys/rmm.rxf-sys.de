# Remote-Desktop einrichten (self-hosted RustDesk)

Das RMM lotst nur — die eigentliche Fernwartung läuft über einen selbst
gehosteten RustDesk-Relay (`hbbs` + `hbbr`) auf dem RMM-LXC. Der Server
proxyt die Sitzung nicht; das Dashboard übergibt deinem lokalen RustDesk-
Client per `rustdesk://<id>`-Link nur die Ziel-ID.

## Warum eine Portfreigabe nötig ist

RustDesk spricht rohes TCP/UDP. Das geht **nicht** durch den Cloudflare
Tunnel (der transportiert nur HTTP/WebSocket). Das ist die eine bewusste
Ausnahme vom Prinzip „kein direkter Port nach außen". Der Relay sieht nur
verschlüsselten Verkehr, und mit gesetztem Key akzeptiert er ausschließlich
deine eigenen Clients.

## 1. Relay starten

Die `hbbs`/`hbbr`-Container sind in `docker-compose.yml` aktiv. Beim ersten
Start erzeugt `hbbs` ein Schlüsselpaar im Volume `rxf-rmm-rustdesk`:

```bash
cd /opt/rxf-rmm/infrastructure
docker compose up -d rustdesk-hbbs rustdesk-hbbr
docker exec rxf-rmm-hbbs cat /root/id_ed25519.pub   # öffentlicher Schlüssel
```

Den ausgegebenen Public Key in die `.env` eintragen:

```
RUSTDESK_RELAY_HOST=rd.rxf-sys.de
RUSTDESK_KEY=<der public key von oben>
```

Danach Backend neu starten (`docker compose up -d backend`), damit das
Dashboard Remote-Sitzungen anbietet.

## 2. Router-Portfreigaben auf 192.168.2.211

| Protokoll | Port(s) | Zweck |
|---|---|---|
| TCP | 21115–21117 | NAT-Typ-Test, ID-Registrierung (hbbs), Relay (hbbr) |
| UDP | 21116 | ID-Registrierung (hbbs) |
| TCP | 21118, 21119 | optional, nur für RustDesk-Web-Clients |

## 3. DNS

`rd.rxf-sys.de` als **DNS-only**-Eintrag (graue Wolke, nicht proxied) auf
deine öffentliche IP. Bei wechselnder IP per DynDNS aktuell halten. Der
Relay muss unter diesem Namen von außen TCP/UDP-erreichbar sein — deshalb
DNS-only statt Cloudflare-Proxy.

## 4. Client auf einem Zielgerät einrichten

RustDesk installieren, dann einmalig (das Dashboard zeigt den fertigen
Befehl pro OS im Remote-Panel des Geräts an):

```bash
# Linux/macOS
rustdesk --config "host=rd.rxf-sys.de,key=<PUBKEY>"
# Windows
rustdesk.exe --config "host=rd.rxf-sys.de,key=<PUBKEY>"
```

### Zustimmung oder unbeaufsichtigter Zugriff

Diese Entscheidung fällt pro Gerät und gehört nicht nebenbei getroffen:

| Betriebsart | Wann | Wie |
|---|---|---|
| **Mit Zustimmung** (empfohlen für persönlich genutzte Geräte) | Familienlaptop, Arbeitsplatzrechner — auf dem Gerät erscheint eine Abfrage, die Verbindung kommt erst nach Bestätigung zustande | RustDesk → Einstellungen → Sicherheit: Zugriff nur nach Bestätigung zulassen |
| **Unbeaufsichtigt** | Server ohne Bildschirm, Geräte ohne Nutzer | Festes Passwort pro Gerät setzen (Einstellungen → Sicherheit → unbeaufsichtigter Zugriff) — pro Gerät einzeln, nie geteilt |

Die genaue Beschriftung der Optionen unterscheidet sich zwischen
RustDesk-Versionen; die entsprechenden Schalter liegen immer unter
Einstellungen → Sicherheit. Ob sich dasselbe über `--option` auf der
Kommandozeile setzen lässt, ist hier **nicht verifiziert** — der
GUI-Weg ist der belastbare.

Das Passwort für unbeaufsichtigten Zugriff gehört in den Passwort-Tresor des
Dashboards (Gerät → Passwörter), nicht in eine Notiz: dort ist es
verschlüsselt und jeder Zugriff steht im Audit-Log.

Was die betreute Person darüber wissen sollte, steht in
[`../docs/PRIVACY.md`](../docs/PRIVACY.md).

Der Agent liest die RustDesk-ID danach automatisch aus (`rustdesk --get-id`)
und meldet sie im Heartbeat; sie erscheint dann im Remote-Panel. Alternativ
lässt sich die ID dort manuell eintragen.

## 5. Sitzung öffnen

Auf deinem eigenen Rechner muss RustDesk installiert und mit demselben Relay
konfiguriert sein. Im Dashboard beim Gerät „Remote-Sitzung öffnen" klicken —
der `rustdesk://<id>`-Link öffnet deinen lokalen Client und verbindet.

## Fallback ohne Portfreigabe

Kommt eine Portfreigabe nicht in Frage, ist MeshCentral die tunnel-taugliche
Alternative (läuft komplett über HTTPS/WebSocket), aber träger und
wartungsintensiver. Die restliche RMM-Architektur ist davon unabhängig.
