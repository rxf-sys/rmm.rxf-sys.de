# MDM für iPhones und iPads einrichten

Stand: 23.09.2026. Diese Anleitung führt von „nichts" bis zu einem
laufenden NanoMDM-Container mit gültigem Apple-Push-Zertifikat.

> **Was hier geprüft ist und was nicht.** Die Compose- und Caddy-Teile sind
> gegen die NanoMDM-Dokumentation geschrieben und der Caddyfile ist
> syntaktisch validiert; die Routen `/v1/*` → 404 und `/mdm` → Proxy sind
> gegen einen laufenden Caddy getestet. Der Zertifikatsweg über
> mdmcert.download ist aus der MicroMDM-Dokumentation übernommen und **nicht
> selbst durchlaufen** — Apple-Konto und Mailadresse kann nur der Betreiber
> beisteuern. Rechne mit kleinen Abweichungen in Dateinamen und im Wortlaut
> der Apple-Seite.

## Der Aufbau in einem Absatz

Drei Dinge reden miteinander. **NanoMDM** ist der Server, den Apple-Geräte
ansprechen und der Kommandos an sie schickt; er läuft als eigener Container
neben Backend und Web. **Apple Push Notification Service (APNs)** ist der
Weckruf: Vulpexa sagt NanoMDM „mach was", NanoMDM stupst das Gerät über
Apple an, das Gerät meldet sich daraufhin beim Server. Dafür braucht
NanoMDM ein **Push-Zertifikat**, das nur Apple ausstellt — das ist der
ganze Aufwand unten. **Caddy** entscheidet, was von außen erreichbar ist:
`/mdm` und `/checkin` ja, die Verwaltungs-API `/v1/*` niemals.

Dazu kommt ein **SCEP-Server**, der jedem Gerät sein Identitätszertifikat
ausstellt (Teil 4) — er läuft im selben Profil. Was danach noch fehlt, ist
das **Enrollment-Profil**, das die Geräte überhaupt erst zu diesem Server
schickt (Teil 6).

---

## Teil 1 — Voraussetzungen

**Eine Firmen-Apple-ID.** Kein privates Konto. Das Push-Zertifikat läuft
nach einem Jahr ab und wird nur über „Renew" **mit derselben Apple-ID**
verlängert. Mit einer anderen ID bekommst du ein neues Zertifikat — und
jedes Telefon müsste neu registriert werden. Wer in zwölf Monaten nicht
mehr an das Konto kommt, fängt von vorn an.

**Registrierung bei mdmcert.download.** Der Dienst stellt die Signatur
aus, die Apple sehen will, ohne dass du selbst MDM-Anbieter im
Apple-Developer-Enterprise-Programm wirst. Er gibt Zertifikate
ausdrücklich nur an „legally recognized businesses, institutions, and
organizations" aus. E-Mail dort registrieren und bestätigen, bevor du
weitermachst.

**`mdmctl`.** Das Werkzeug liegt im MicroMDM-Release-Archiv
(github.com/micromdm/micromdm → Releases). NanoMDM bringt keinen eigenen
mdmcert-Client mit und verweist für diesen Schritt selbst auf MicroMDM. Du
brauchst nur die eine Binary; der Rest des Archivs bleibt liegen.

---

## Teil 2 — Das Push-Zertifikat holen

Arbeite in einem **leeren Verzeichnis** und behalte alles, was dabei
entsteht, bis das Zertifikat von Apple in der Hand ist. Die Befehle legen
mehrere Dateien nebeneinander ab, und eine davon ist unersetzlich.

### Schritt 1 + 2: Verschlüsselungszertifikat und CSR — ein Befehl

Die Website zählt das getrennt auf, weil sie beschreibt, was technisch
passiert. `mdmctl` erledigt beides in einem Aufruf: es erzeugt das
Verschlüsselungszertifikat, mit dem mdmcert.download die Antwort-Mail
verschlüsselt, **und** den Push-CSR, und reicht beides zusammen mit deiner
Adresse ein.

```bash
mkdir -p ~/mdm-cert && cd ~/mdm-cert
mdmctl mdmcert.download -new -email=deine@registrierte-adresse.de
```

Unter den entstandenen Dateien ist **`mdmcert.download.push.key`** die
wichtigste: der private Schlüssel zu dem Zertifikat, das Apple gleich
ausstellt. Ohne ihn ist das Zertifikat wertloses Papier, und niemand — auch
Apple nicht — kann ihn neu ausstellen. Sichere das Verzeichnis, bevor du
weitermachst.

### Schritt 3: Die Mail

Kommt an die registrierte Adresse, mit einer verschlüsselten, signierten
Anlage im Format `mdm_signed_request.<zeitstempel>.plist.b64.p7`.
Herunterladen, nicht öffnen.

### Schritt 4: Entschlüsseln

Im selben Verzeichnis wie Schritt 1 — die Schlüssel von dort werden
gebraucht:

```bash
mdmctl mdmcert.download -decrypt=~/Downloads/mdm_signed_request.20260923_101500_220.plist.b64.p7
```

Heraus kommt **`mdmcert.download.push.req`**: der signierte CSR für Apple.

### Schritt 5: Apple (steht so nicht auf der Website, ist aber Pflicht)

1. <https://identity.apple.com> mit der Firmen-Apple-ID anmelden
2. Grüner Knopf **„Create a Certificate"**
3. `mdmcert.download.push.req` hochladen
4. Das Zertifikat herunterladen — typisch `MDM_<Organisation>_Certificate.pem`
5. **Ablaufdatum sofort in den Kalender eintragen**, ein Jahr minus zwei
   Wochen. Abgelaufen heißt: die Geräte bleiben registriert, reagieren aber
   auf kein Kommando mehr.

Jetzt hast du das Paar, um das es geht:

| Datei | Was sie ist | Ersetzbar? |
|---|---|---|
| `MDM_<Organisation>_Certificate.pem` | Das Push-Zertifikat von Apple | ja, über „Renew" mit derselben Apple-ID |
| `mdmcert.download.push.key` | Der zugehörige private Schlüssel | **nein** |

---

## Teil 3 — Dateien im LXC ablegen

Alles, was NanoMDM braucht, liegt in **einem** Verzeichnis — damit klar
ist, was gesichert werden muss. Das Verzeichnis ist in `.gitignore`.

```bash
cd /opt/rxf-rmm/infrastructure
mkdir -p mdm/db
chmod 700 mdm

cp ~/mdm-cert/MDM_*_Certificate.pem  mdm/push.pem
cp ~/mdm-cert/mdmcert.download.push.key  mdm/push.key
chmod 600 mdm/push.pem mdm/push.key
```

Dazu in `infrastructure/.env`:

```bash
NANOMDM_TAG=sha-...        # ein konkretes sha-Tag, siehe unten
NANOMDM_API_KEY=$(openssl rand -hex 32)
```

Zum Tag: `ghcr.io/micromdm/nanomdm` veröffentlicht **keine** Versions-Tags,
nur `main` und `sha-<commit>` (geprüft am 23.09.2026). Ein gepinntes
sha-Tag ist der Unterschied zwischen „der Server bleibt, wie ich ihn
getestet habe" und „er ändert sich beim nächsten `docker compose pull`
still unter einer Flotte von Telefonen".

---

## Teil 4 — SCEP: die eigene CA und der Dienst

Ein Apple-Gerät weist sich gegenüber dem MDM-Server mit einem eigenen
Client-Zertifikat aus. Das stellt ein SCEP-Server aus, und NanoMDM prüft
die Geräte gegen dessen CA (`NANOMDM_CA=/mdm/ca.pem`). **Ohne SCEP kann
sich kein Gerät registrieren** — und ohne lesbare `ca.pem` startet NanoMDM
nicht einmal: `-ca` ist Pflicht, fehlt die Datei, beendet es sich sofort.
Dieser Teil kommt deshalb **vor** dem ersten Start.

`micromdm/scep` veröffentlicht kein Container-Image (weder Docker Hub noch
GHCR, geprüft am 19.10.2026). Das Compose-File baut es deshalb selbst aus
`infrastructure/scep/Dockerfile`, mit auf `v2.3.0` gepinnter Version.

**Depot anlegen.** Dort liegen CA-Schlüssel, Seriennummern und jedes
ausgestellte Gerätezertifikat. Es muss der uid des Containers gehören,
sonst startet der Dienst nicht:

```bash
cd /opt/rxf-rmm/infrastructure
mkdir -p scep-depot && chmod 700 scep-depot && chown 10001:10001 scep-depot
```

**CA erzeugen.** Einmalig, mit demselben Image — kein Go auf dem LXC nötig.
Das Passwort schützt den CA-Schlüssel im Depot; es gehört in den
Passwortmanager und später als `SCEP_CA_PASS` in die `.env`:

```bash
read -rs -p 'CA-Key-Passwort: ' KP; echo
docker compose --profile mdm run --rm scep ca -init -depot /depot \
  -key-password "$KP" -common_name "Vulpexa MDM SCEP CA" \
  -organization rxf-sys -country DE -years 10
unset KP
ls -l scep-depot            # ca.key und ca.pem
openssl x509 -in scep-depot/ca.pem -noout -subject -enddate
```

**Die öffentliche CA zu NanoMDM kopieren.** Nur `ca.pem`, niemals `ca.key`
— das Verzeichnis `mdm/` wird in den NanoMDM-Container gemountet:

```bash
mkdir -p mdm/db && chmod 700 mdm
cp scep-depot/ca.pem mdm/ca.pem
```

**Challenge setzen.** In `infrastructure/.env`:

```bash
SCEP_CA_PASS=<das Passwort von oben>
SCEP_CHALLENGE_PASSWORD=<openssl rand -hex 24>
```

Das Challenge-Passwort ist die einzige Hürde vor dem Dienst: ohne es stellt
er jedem ein Zertifikat aus, der die URL kennt — und wer ein Zertifikat
hat, gilt bei NanoMDM als Gerät. Es gehört später ins Enrollment-Profil.

`ca.key` zusammen mit `push.key` sichern. Geht er verloren, müssen alle
Geräte neu registriert werden.

---

## Teil 5 — Starten und prüfen

Der Container läuft **nicht** im Normalbetrieb; er hängt am Compose-Profil
`mdm`. Ein `docker compose up` ohne Profil lässt ihn unangetastet.

```bash
cd /opt/rxf-rmm/infrastructure
docker compose --profile mdm up -d --build scep nanomdm
docker compose --profile mdm logs --tail 30 scep nanomdm
```

Push-Zertifikat und Schlüssel einspielen — NanoMDM nimmt beides als einen
Strom entgegen:

```bash
cat mdm/push.pem mdm/push.key | curl -T - -u nanomdm:$NANOMDM_API_KEY \
  'http://127.0.0.1:9000/v1/pushcert'
```

Das geht **nur aus dem LXC heraus**: der Container veröffentlicht Port 9000
ausschließlich auf `127.0.0.1`, und von außen liefert Caddy auf `/v1/*`
absichtlich 404.

Dass der Server lebt, zeigt sich deshalb auch nur von innen:

```bash
curl -s http://127.0.0.1:9000/version                  # JSON mit der NanoMDM-Version
docker compose --profile mdm ps scep                   # Up, nicht Restarting
```

Und von einem anderen Rechner muss der SCEP-Pfad antworten — ohne ihn kommt
kein Enrollment zustande:

```bash
curl -si https://rmm.rxf-sys.de/scep?operation=GetCACert | head -1
```

`https://rmm.rxf-sys.de/version` ist **nicht** diese Prüfung: `/version` ist
im Caddyfile keiner MDM-Route zugeordnet und landet im SPA-Catch-all — es
antwortet mit 200 und der Dashboard-Seite, egal ob NanoMDM läuft. Von außen
zählt genau eine Zeile, und zwar diese:

```bash
curl -si https://rmm.rxf-sys.de/v1/pushcert      # muss 404 sein
```

---

## Teil 6 — Was dann noch fehlt

Ein registriertes Gerät braucht ein **Enrollment-Profil**: ein
`.mobileconfig`, das auf `https://rmm.rxf-sys.de/mdm` zeigt, die SCEP-Payload
enthält und — wichtig für diesen Aufbau — `SignMessage = true` setzt. Damit
schickt das Gerät sein Identitätszertifikat als `Mdm-Signature`-Header
statt über mTLS. Das ist kein Detail, sondern der Grund für diesen Aufbau:
TLS-Client-Zertifikate überleben den Cloudflare-Tunnel nicht, der Header
schon.

Dafür darf `NANOMDM_CERT_HEADER` **nicht** gesetzt sein — auch nicht auf
`Mdm-Signature`. NanoMDM entscheidet umgekehrt, als der Name nahelegt: mit
gesetztem `-cert-header` erwartet es ein PEM-Zertifikat in diesem Header,
und nur mit leerem Flag prüft es die CMS-Signatur. Das Compose-File lässt
die Variable deshalb bewusst weg.

Dieses Profil zu erzeugen und die Kommandos aus dem Dashboard
abzuschicken — abgestuft nach Besitzverhältnis, auf einem Privatgerät
niemals Komplett-Löschen — ist der Code-Teil von Etappe 1 und steht in
[`ROADMAP.md`](ROADMAP.md).

---

## Betrieb danach

**Backup.** `infrastructure/mdm/` ist **nicht** in `backup.sh` enthalten,
genauso wenig wie `.env` und `.agent-sign.env`. Verschlüsselt und separat
sichern — vor allem `push.key`.

**Verlängerung.** Ein Jahr nach Ausstellung. Auf <https://identity.apple.com>
mit **derselben** Apple-ID anmelden und beim bestehenden Zertifikat „Renew"
wählen, nicht „Create a Certificate". Der private Schlüssel bleibt
derselbe; das neue `.pem` wie oben hochladen.

**Wenn etwas nicht geht.**

| Symptom | Wahrscheinliche Ursache |
|---|---|
| `curl http://127.0.0.1:9000/version` im LXC schlägt fehl | Das Profil läuft nicht (`docker compose --profile mdm ps`) |
| SCEP-Container startet nicht oder schreibt „permission denied" auf `/depot` | Das Depot gehört nicht der uid 10001: `chown -R 10001:10001 scep-depot` |
| Gerät bekommt beim Registrieren kein Zertifikat | Challenge im Profil stimmt nicht mit `SCEP_CHALLENGE_PASSWORD` überein |
| Container startet nicht, Log sagt „must supply CA cert path flag" oder nennt `/mdm/ca.pem` | `-ca` ist bei NanoMDM Pflicht: ohne lesbare `mdm/ca.pem` beendet es sich sofort. Erst die SCEP-CA erzeugen (Teil 4), dann starten |
| `-decrypt` meldet „error decoding hex" | Die `.p7` ist Hex-Text und verträgt kein abschließendes Zeilenende: `tr -d '\r\n \t' < datei.p7 > datei.hex` und die bereinigte Datei verwenden |
| Geräte melden sich nie | Push-Zertifikat nicht hochgeladen, oder abgelaufen |
| Gerät wird beim Registrieren abgewiesen | `ca.pem` fehlt oder passt nicht zur SCEP-CA |
| `401` auf `/v1/*` im LXC | `NANOMDM_API_KEY` in `.env` weicht vom laufenden Container ab — Container neu starten |
| Container startet und beendet sich sofort, „permission denied" auf `/mdm/db` | Das Image läuft nicht als `root`. Besitzer des Verzeichnisses auf die uid des Containers setzen: `docker compose --profile mdm run --rm --entrypoint id nanomdm`, dann `chown -R <uid>:<gid> mdm` |
