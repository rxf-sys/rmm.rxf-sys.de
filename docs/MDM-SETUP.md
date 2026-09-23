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

Was noch fehlt, ehrlich benannt: ein **SCEP-Server**, der jedem Gerät sein
Identitätszertifikat ausstellt (siehe Teil 4), und das
**Enrollment-Profil**, das die Geräte überhaupt erst zu diesem Server
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

## Teil 4 — Der offene Punkt: SCEP

Ein Apple-Gerät weist sich gegenüber dem MDM-Server mit einem eigenen
Client-Zertifikat aus. Das stellt ein SCEP-Server aus, und NanoMDM prüft
die Geräte gegen dessen CA (`NANOMDM_CA=/mdm/ca.pem` im Compose-File).
**Ohne SCEP kann sich kein Gerät registrieren.**

Dafür gibt es bewusst noch keinen Compose-Service, weil die Entscheidung
noch aussteht: `micromdm/scep` veröffentlicht weder auf Docker Hub noch in
der GitHub Container Registry ein fertiges Image (beides am 23.09.2026
geprüft). Es bleiben zwei Wege — Release-Binary im LXC betreiben, oder das
Image einmal selbst bauen (`CGO_ENABLED=0 make docker`) und in die eigene
Registry legen. Die CA wird einmalig mit `scepserver ca -init` erzeugt; die
entstehende `ca.pem` gehört dann als `infrastructure/mdm/ca.pem` neben das
Push-Zertifikat.

Das ist der nächste Schritt, nicht dieser.

---

## Teil 5 — Starten und prüfen

Der Container läuft **nicht** im Normalbetrieb; er hängt am Compose-Profil
`mdm`. Ein `docker compose up` ohne Profil lässt ihn unangetastet.

```bash
cd /opt/rxf-rmm/infrastructure
docker compose --profile mdm up -d nanomdm
docker compose --profile mdm logs -f nanomdm
```

Push-Zertifikat und Schlüssel einspielen — NanoMDM nimmt beides als einen
Strom entgegen:

```bash
cat mdm/push.pem mdm/push.key | curl -T - -u nanomdm:$NANOMDM_API_KEY \
  'http://127.0.0.1:9000/v1/pushcert'
```

Das geht **nur aus dem LXC heraus**: der Container veröffentlicht Port 9000
ausschließlich auf `127.0.0.1`, und von außen liefert Caddy auf `/v1/*`
absichtlich 404. Gegenprobe, beides von einem anderen Rechner:

```bash
curl -s  https://rmm.rxf-sys.de/version          # NanoMDM meldet seine Version
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
schon. Der Container ist entsprechend konfiguriert
(`NANOMDM_CERT_HEADER=Mdm-Signature`).

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
| `/version` von außen liefert 502 | Das Profil läuft nicht (`docker compose --profile mdm ps`) |
| Geräte melden sich nie | Push-Zertifikat nicht hochgeladen, oder abgelaufen |
| Gerät wird beim Registrieren abgewiesen | `ca.pem` fehlt oder passt nicht zur SCEP-CA |
| `401` auf `/v1/*` im LXC | `NANOMDM_API_KEY` in `.env` weicht vom laufenden Container ab — Container neu starten |
| Container startet und beendet sich sofort, „permission denied" auf `/mdm/db` | Das Image läuft nicht als `root`. Besitzer des Verzeichnisses auf die uid des Containers setzen: `docker compose --profile mdm run --rm --entrypoint id nanomdm`, dann `chown -R <uid>:<gid> mdm` |
