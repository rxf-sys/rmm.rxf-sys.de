# MDM für iPhones und iPads einrichten

Stand: 21.10.2026. Diese Anleitung führt von „nichts" bis zu einem
laufenden NanoMDM-Container mit gültigem Apple-Push-Zertifikat, einem
SCEP-Server und iPhones, die per QR-Code aus dem Dashboard registriert
werden.

> **Was hier geprüft ist und was nicht.** Die Compose- und Caddy-Teile sind
> gegen die NanoMDM-Dokumentation geschrieben; die Routen `/v1/*` → 404 und
> `/mdm` → Proxy sind gegen den laufenden Caddy getestet. Der
> Zertifikatsweg über mdmcert.download ist am 21.10.2026 einmal komplett
> durchlaufen. Der SCEP-Dienst ist mit `scepserver` und `scepclient` v2.3.0
> getestet (Ausstellung, Abweisung bei falscher Challenge, Zertifikatskette
> mit `ClientAuth`). Die Registrierung aus dem Dashboard (Teil 6) ist gegen
> den Quelltext von NanoMDM `sha-9ba4d95` und scep v2.3.0 geschrieben und mit
> Tests abgedeckt (Profil, Einmal-Challenge, Webhook, CSR-Verifier mit einem
> openssl-CSR); **auf einem echten iPhone ist sie noch nicht gelaufen** —
> der erste Lauf steht aus.

## Der Aufbau in einem Absatz

Drei Dinge reden miteinander. **NanoMDM** ist der Server, den Apple-Geräte
ansprechen und der Kommandos an sie schickt; er läuft als eigener Container
neben Backend und Web. **Apple Push Notification Service (APNs)** ist der
Weckruf: Vulpexa sagt NanoMDM „mach was", NanoMDM stupst das Gerät über
Apple an, das Gerät meldet sich daraufhin beim Server. Dafür braucht
NanoMDM ein **Push-Zertifikat**, das nur Apple ausstellt — das ist der
ganze Aufwand unten. Der **SCEP-Server** stellt jedem Gerät bei der
Registrierung sein Identitätszertifikat aus; NanoMDM prüft jede
Geräteanfrage gegen dessen CA. **Caddy** entscheidet, was von außen
erreichbar ist: `/mdm` und `/scep` ja, die Verwaltungs-API `/v1/*` niemals.

Was noch fehlt, ehrlich benannt: Kommandos aus dem Dashboard (Sperren,
Inventar auf Abruf, Richtlinien) und die Erneuerung der
Gerätezertifikate vor Ablauf (ROADMAP Etappe 1). Die Registrierung selbst
läuft über das Dashboard (Teil 6).

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

## Teil 4 — SCEP: CA und Server

Ein Apple-Gerät weist sich gegenüber dem MDM-Server mit einem eigenen
Client-Zertifikat aus. Das stellt der SCEP-Server aus, und NanoMDM prüft
die Geräte gegen dessen CA (`NANOMDM_CA=/mdm/ca.pem` im Compose-File).
**Ohne SCEP kann sich kein Gerät registrieren, und ohne `mdm/ca.pem`
startet NanoMDM gar nicht** — dieser Teil kommt deshalb vor dem ersten
Start.

`micromdm/scep` veröffentlicht kein Container-Image. Der Service `scep` im
Profil `mdm` baut deshalb das gepinnte Release v2.3.0 selbst
(`infrastructure/scep/`). Das Image läuft als uid `10001`, wie Backend und
Web.

**Zwei Verzeichnisse, mit Absicht getrennt.** `infrastructure/scep-depot/`
gehört dem SCEP-Container: dort liegen der private CA-Schlüssel `ca.key`
und jedes ausgestellte Gerätezertifikat. `infrastructure/mdm/` gehört
NanoMDM und bekommt nur die öffentliche `ca.pem`. So kann NanoMDM den
CA-Schlüssel nicht lesen. Beide sind gitignored.

### Schritt 1: Die CA — einmalig

```bash
cd /opt/rxf-rmm/infrastructure
docker compose --profile mdm build scep

mkdir -p scep-depot
chown 10001:10001 scep-depot
chmod 700 scep-depot

read -rs -p 'Neues CA-Key-Passwort: ' KP; echo
docker compose --profile mdm run --rm scep ca -init -depot /depot \
  -key-password "$KP" -common_name "Vulpexa MDM SCEP CA" \
  -organization rxf-sys -country DE -years 10
unset KP

cp scep-depot/ca.pem mdm/ca.pem
chmod 600 mdm/ca.pem

# Pflicht: Key Encipherment ergänzen (gleicher Schlüssel, gleicher Name)
bash scep-ca-reissue.sh
```

**Warum der letzte Schritt.** `scepserver ca -init` stellt die CA nur für
Signieren aus (Key Usage: Digital Signature, Certificate Sign, CRL Sign).
iPhones verschlüsseln ihren Zertifikatsantrag aber an ein Zertifikat, das
für **Key Encipherment** freigegeben ist. Fehlt das Bit, bricht iOS die
Profilinstallation ab, noch bevor ein Antrag den Server erreicht: „Die
SCEP-Serverkonfiguration wird nicht unterstützt". `scepclient` verschlüsselt
ohne diese Prüfung und merkt davon nichts, deshalb fiel es beim Test mit
`scepclient` nicht auf. `scep-ca-reissue.sh` stellt das CA-Zertifikat mit
demselben Schlüssel, demselben Namen und demselben Key Identifier neu aus:
Bereits ausgestellte Gerätezertifikate bleiben gültig, niemand muss neu
registrieren. Die alten Dateien bleiben als `ca.pem.<Datum>.bak` liegen, und
das Skript startet `scep` und `nanomdm` neu. Der `scep`-Container startet
mit einer CA ohne dieses Bit gar nicht mehr und nennt das Skript.

Das CA-Key-Passwort gehört in den Passwortmanager — und in die `.env`
(Schritt 2), weil der Server den Schlüssel bei jedem Start lesen muss.
Läuft die CA ab (hier nach zehn Jahren), ist jedes Gerät neu zu
registrieren.

Gibt es die CA schon aus einem früheren Lauf (etwa unter
`/root/scep-depot`), wird sie nicht neu erzeugt, sondern übernommen:
`cp -a /root/scep-depot/. scep-depot/ && chown -R 10001:10001 scep-depot`.
Eine neue CA hieße: jedes bereits registrierte Gerät wird abgewiesen.

### Schritt 2: `.env`

```bash
SCEP_CA_PASS=...                                  # das Passwort aus Schritt 1
MDM_SCEP_VERIFY_TOKEN=$(openssl rand -hex 32)     # Einmal-Challenges, Teil 6
SCEP_CERT_VALID=365
```

**Eine Challenge-Prüfung ist Pflicht.** Ohne sie signiert `scepserver`
jeden CSR, der `/scep` erreicht — jeder im Internet bekäme ein Zertifikat,
dem NanoMDM vertraut. Der Container startet deshalb nur mit genau einem
von zwei Werten:

- `MDM_SCEP_VERIFY_TOKEN` (Normalbetrieb): Jedes Profil aus dem Dashboard
  trägt eine eigene Challenge, die genau einmal gilt. Der CSR-Verifier im
  Image fragt dafür das Backend.
- `SCEP_CHALLENGE_PASSWORD` (nur für das archivierte Test-Profil): eine
  statische Challenge für alle. Sie steht im Profil im Klartext, und jedes
  je ausgegebene Profil stellt damit weiter Zertifikate aus.

Beide gleichzeitig lehnt der Entrypoint ab. Bereits registrierte Geräte
betrifft ein Wechsel nicht — die Challenge zählt nur beim Ausstellen.

### Schritt 3: Starten und prüfen

```bash
docker compose --profile mdm up -d --build scep
docker compose --profile mdm logs --tail 20 scep
```

Von außen, über den Tunnel:

```bash
curl -s 'https://rmm.rxf-sys.de/scep?operation=GetCACaps'
# erwartet u. a.: POSTPKIOperation SHA-256 AES

curl -s 'https://rmm.rxf-sys.de/scep?operation=GetCACert' \
  | openssl x509 -inform DER -noout -fingerprint -sha256
openssl x509 -in mdm/ca.pem -noout -fingerprint -sha256
# beide Fingerprints müssen gleich sein
```

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
absichtlich 404.

Dass der Server lebt, zeigt sich deshalb auch nur von innen:

```bash
curl -s http://127.0.0.1:9000/version            # JSON mit der NanoMDM-Version
```

`https://rmm.rxf-sys.de/version` ist **nicht** diese Prüfung: `/version` ist
im Caddyfile keiner MDM-Route zugeordnet und landet im SPA-Catch-all — es
antwortet mit 200 und der Dashboard-Seite, egal ob NanoMDM läuft. Von außen
zählt genau eine Zeile, und zwar diese:

```bash
curl -si https://rmm.rxf-sys.de/v1/pushcert      # muss 404 sein
```

---

## Teil 6 — Geräte registrieren

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

**`ServerURL` und `CheckInURL` zeigen beide auf `/mdm`.** NanoMDM bedient
Check-ins und Kommandos standardmäßig auf demselben Endpunkt; `/checkin`
gibt es nur mit dem Schalter `-checkin`, und den setzt das Compose-File
nicht. Caddy leitet `/checkin` deshalb auch nicht mehr weiter.

Das Profil entsteht pro Gerät im Dashboard. Von Hand baut es niemand mehr;
das frühere Test-Skript liegt unter `infrastructure/_archiv/`.

### Einmalig: Umstellung am LXC

In dieser Reihenfolge — erst muss das Backend die neuen Endpunkte kennen,
dann dürfen NanoMDM und scep sie aufrufen.

1. **Backend deployen.** Das passiert mit dem Merge über den Runner
   (`deploy.sh` fasst die MDM-Container nicht an). Danach antwortet
   `/api/mdm/webhook` von außen mit 404 — das ist richtig so:

   ```bash
   curl -si -X POST https://rmm.rxf-sys.de/api/mdm/webhook | head -1   # 404
   ```

2. **`.env` ergänzen** (`/opt/rxf-rmm/infrastructure/.env`):

   ```bash
   # APNs-Topic aus dem Push-Zertifikat
   openssl x509 -in mdm/push.pem -noout -subject -nameopt RFC2253 \
     | sed -n 's/^subject=.*UID=\([^,]*\).*$/\1/p'
   ```

   ```bash
   MDM_APNS_TOPIC=com.apple.mgmt.External.…   # Ausgabe von oben
   MDM_WEBHOOK_SECRET=$(openssl rand -hex 32)
   MDM_SCEP_VERIFY_TOKEN=$(openssl rand -hex 32)
   ```

   `NANOMDM_API_KEY` steht schon drin; das Backend liest denselben Wert.
   **`SCEP_CHALLENGE_PASSWORD` entfernen** (oder leeren) — mit beiden Werten
   startet `scep` nicht.

3. **Neu starten**, damit alle drei Container die Werte sehen:

   ```bash
   cd /opt/rxf-rmm/infrastructure
   docker compose up -d backend
   docker compose --profile mdm up -d --build scep nanomdm
   docker compose --profile mdm logs --tail 20 scep nanomdm
   ```

   Der `scep`-Build führt die Tests des CSR-Verifiers aus; schlägt einer
   fehl, entsteht kein Image. Im Dashboard zeigt der Reiter „MDM“ eines
   iPhones danach „Nicht registriert“ statt „nicht eingerichtet“.

Bereits registrierte Geräte (das Testgerät) bleiben registriert, sind dem
Dashboard aber unbekannt — ihr Webhook wird als „unbound“ geloggt. Für die
Zuordnung das Testprofil am Gerät entfernen und das Gerät wie unten neu
registrieren.

### Ein Gerät registrieren

1. Im Dashboard **Gerät hinzufügen → Telefon oder Tablet**, Typ iPhone oder
   iPad, Bezeichnung, Person, Besitzverhältnis. „Danach per MDM
   registrieren“ ist angehakt (nur für Admins sichtbar).
2. **Gerät anlegen** zeigt einen QR-Code. Bestehende Geräte: Reiter „MDM“
   → **Registrierungslink erzeugen**.
3. Am iPhone mit der Kamera scannen, den Link öffnen, „Zulassen“ tippen.
4. **Einstellungen** → oben „Profil geladen“ → *Installieren*, Gerätecode,
   nochmals *Installieren*, der Fernverwaltung vertrauen.

Der Status im Dashboard folgt von selbst: *Wartet auf das Gerät* →
*Profil geladen* → *Zertifikat ausgestellt* → *Registriert*. Danach fragt
das Backend die Geräteinformationen ab; Seriennummer, IMEI und iOS-Version
der Karteikarte füllen sich, der Reiter „MDM“ zeigt den Rest.

Was dabei gilt:

- Der Link gilt 24 Stunden (`MDM_ENROLLMENT_TTL_HOURS`), für höchstens fünf
  Abrufe und nur bis zum ausgestellten Zertifikat. Ein neuer Link widerruft
  den alten.
- Jeder Abruf erzeugt eine neue Challenge — **installiert wird immer das
  zuletzt geladene Profil**. Ein älteres scheitert beim Zertifikat.
- Privatgeräte bekommen ein Profil **ohne Löschrecht** (`AccessRights`
  8183); iOS zeigt das in den Profildetails. Wird ein Gerät später zum
  Firmengerät, sagt der Reiter „MDM“, dass dafür neu zu registrieren ist.
- Das Profil ist nicht signiert; iOS zeigt es als „Nicht überprüft“ an.
- Per Profil registrierte Geräte sind **nicht betreut** (*supervised*). Der
  Verloren-Modus und erzwungene Updates setzen Betreuung voraus und sind so
  nicht möglich; das geht nur über Apple Business Manager oder Apple
  Configurator (ROADMAP).

Kontrolle im LXC, falls etwas hängt:

```bash
docker compose --profile mdm logs nanomdm | grep -E 'Authenticate|TokenUpdate|webhook'
tail -n 3 scep-depot/index.txt
```

`scepserver` verwirft die Ausgabe des CSR-Verifiers und loggt bei einer
Ablehnung nur `exit status 1`. Den Grund nennt das Audit-Log
(`mdm.scep_rejected` mit `unknown` oder `cn_mismatch`). Steht dort nichts,
hat der Verifier das Backend nicht erreicht — dann
`docker compose --profile mdm exec scep wget -qO- http://backend:8080/api/health`.

---

## Betrieb danach

**Backup.** `infrastructure/mdm/` und `infrastructure/scep-depot/` sind
**nicht** in `backup.sh` enthalten, genauso wenig wie `.env` und
`.agent-sign.env`. Verschlüsselt und separat sichern — vor allem `push.key`
und `ca.key`: geht `ca.key` verloren, stellt SCEP keine Zertifikate mehr aus,
und eine neue CA heißt, jedes Gerät neu zu registrieren.

**Gerätezertifikate erneuern sich selbst.** Nach `SCEP_CERT_VALID` Tagen
(Default 365) wäre das Identitätszertifikat eines Geräts ungültig. Das
Backend schickt deshalb `MDM_RENEW_BEFORE_DAYS` (Default 30) vorher ein
frisches Profil per `InstallProfile`; das Telefon holt sich damit beim
nächsten Kontakt ein neues Zertifikat, am Gerät ist nichts zu tun. Dafür
setzt das Compose-File `SCEP_CERT_RENEW=0` — sonst lehnte `scepserver` ein
zweites Zertifikat mit gleichem Namen ab, solange das erste gilt. Im Reiter
„MDM“ steht „Zertifikat gültig bis“, Admins können mit „Zertifikat
erneuern“ sofort anstoßen; kommt die Erneuerung nicht durch, meldet die
Alarmregel „MDM-Zertifikat läuft ab“ (Standard 14 Tage vorher). Erst ein
abgelaufenes Zertifikat heißt: neu registrieren.

**Befehle und Befugnisse.** Im Reiter „MDM“: Inventar aktualisieren und
Sperren (Techniker und Admins), Code entfernen, Löschen und Zertifikat
erneuern (nur Admins). Unter „MDM-Befugnisse“ lässt sich je Gerät
abschalten, was dort nicht gehen soll — Sperren, Code entfernen, Löschen,
App-Liste. Das gilt sofort, ändert am Gerät nichts und lässt sich jederzeit
zurückdrehen. Seit Oktober 2026 trägt jedes neue Profil alle Rechte;
Geräte, die vorher als privat registriert wurden, haben kein Löschrecht im
Profil — das geht nur mit einer neuen Registrierung.

**Profile, Apps, iOS-Update.** Unter Administration → „MDM-Profile“ liegen
Vorlagen für WLAN, Code-Pflicht, Web-Clips und Mail-, Kalender- oder
Kontakte-Konten; zugewiesen werden sie im Reiter „MDM“ eines Geräts, eine
geänderte Vorlage geht sofort an alle Geräte, die sie haben. Apps lassen
sich aus dem Gerätemenü per App-Store-Link anbieten — das Telefon fragt den
Nutzer. „iOS-Update erzwingen“ nutzt Declarative Device Management: NanoMDM
leitet die Anfragen der Telefone an `/api/mdm/ddm/` weiter
(`NANOMDM_DM` im Compose-File, signiert mit `MDM_WEBHOOK_SECRET`). Ab iOS 17;
ob es ohne Betreuung greift, zeigt der gemeldete Update-Stand.

**Erreichbarkeit.** Das Backend schickt jedem Telefon stündlich einen Push
ohne Befehl; ein eingeschaltetes Telefon meldet sich darauf binnen Sekunden.
Wer sich in den letzten 2 Stunden gemeldet hat, steht im Dashboard auf „OK“,
sonst auf „Offline“.

**Nach dem Update auf diese Version, einmalig im LXC:**
`docker compose --profile mdm up -d nanomdm` — damit `NANOMDM_DM` gilt.

**Was ohne Betreuung (Supervision) nicht geht.** Per Profil registrierte
Geräte sind nicht betreut. Verloren-Modus mit Ortung, Neustart aus der
Ferne, erzwungene iOS-Updates und stille App-Installationen verlangt Apple
nur von betreuten Geräten (Apple Business Manager oder Apple Configurator).
Fernsteuerung des Bildschirms gibt es auf iOS gar nicht — auch nicht mit
RustDesk; TeamViewer QuickSupport kann den Bildschirm nur zeigen.

**Nach dem Update auf diese Version, einmalig im LXC:**
`docker compose --profile mdm up -d --build scep` — damit `SCEP_CERT_RENEW=0`
gilt. Bereits registrierte Geräte bekommen ihre Erneuerung dann rechtzeitig
von selbst.

**Verlängerung.** Ein Jahr nach Ausstellung. Auf <https://identity.apple.com>
mit **derselben** Apple-ID anmelden und beim bestehenden Zertifikat „Renew"
wählen, nicht „Create a Certificate". Der private Schlüssel bleibt
derselbe; das neue `.pem` wie oben hochladen.

**Wenn etwas nicht geht.**

| Symptom | Wahrscheinliche Ursache |
|---|---|
| `curl http://127.0.0.1:9000/version` im LXC schlägt fehl | Das Profil läuft nicht (`docker compose --profile mdm ps`) |
| Container startet nicht, Log sagt „must supply CA cert path flag" oder nennt `/mdm/ca.pem` | `-ca` ist bei NanoMDM Pflicht: ohne lesbare `mdm/ca.pem` beendet es sich sofort. Erst die SCEP-CA erzeugen (Teil 4), dann starten |
| `-decrypt` meldet „error decoding hex" | Die `.p7` ist Hex-Text und verträgt kein abschließendes Zeilenende: `tr -d '\r\n \t' < datei.p7 > datei.hex` und die bereinigte Datei verwenden |
| Geräte melden sich nie | Push-Zertifikat nicht hochgeladen, oder abgelaufen |
| iPhone: „Profilinstallation fehlgeschlagen — Die SCEP-Serverkonfiguration wird nicht unterstützt" | Das CA-Zertifikat hat kein Key Encipherment (so erzeugt es `ca -init`). `bash scep-ca-reissue.sh` im LXC, danach einen neuen Link erzeugen. Prüfen: `openssl x509 -in scep-depot/ca.pem -noout -ext keyUsage` muss „Key Encipherment" zeigen |
| `scep` beendet sich mit „… lacks Key Usage Key Encipherment …" | Absicht, siehe Zeile darüber: `bash scep-ca-reissue.sh` |
| Gerät wird beim Registrieren abgewiesen | `mdm/ca.pem` ist nicht dieselbe Datei wie `scep-depot/ca.pem` (Fingerprints vergleichen, Teil 4), oder es wurde ein älteres Profil installiert als das zuletzt geladene (SCEP-Log: „CSR verify failed", Audit-Log: `mdm.scep_rejected`). Neuen Link erzeugen, nur das neue Profil installieren |
| Dashboard: „MDM ist nicht eingerichtet — es fehlt: …" | Die genannten Werte fehlen in `.env` oder das Backend wurde danach nicht neu gestartet (Teil 6) |
| Status bleibt bei „Zertifikat ausgestellt" | NanoMDM erreicht den Webhook nicht oder signiert falsch: `docker compose --profile mdm logs nanomdm` nach `webhook` durchsuchen; `MDM_WEBHOOK_SECRET` muss für `nanomdm` und `backend` derselbe sein (beide neu starten) |
| `scep` beendet sich sofort mit „neither MDM_SCEP_VERIFY_TOKEN nor SCEP_CHALLENGE_PASSWORD" oder „SCEP_CA_PASS is empty" | Absicht: ohne Challenge-Prüfung startet der Server nicht. In `.env` setzen (Teil 4, Schritt 2), dann `docker compose --profile mdm up -d scep` |
| `scep` meldet „both MDM_SCEP_VERIFY_TOKEN and SCEP_CHALLENGE_PASSWORD are set" | `SCEP_CHALLENGE_PASSWORD` aus `.env` entfernen (Teil 6) |
| `scep` meldet „ca.key missing or not readable for uid 10001" | `scep-depot` gehört nicht uid 10001: `chown -R 10001:10001 scep-depot` |
| Erneuerung bleibt bei „läuft seit …“ oder meldet einen Fehler | `scep` läuft ohne `SCEP_CERT_RENEW=0` (SCEP-Log: „DN … already exists"): `docker compose --profile mdm up -d --build scep`, dann im Reiter „MDM“ erneut „Zertifikat erneuern“ |
| Patch-Seite: iPhones „ohne Abgleich“ | Apples Versionsliste war nicht erreichbar (Backend-Log `ios_versions.fetch_failed`) oder `MDM_IOS_VERSION_CHECK=false`; der Server versucht es stündlich neu |
| `401` auf `/v1/*` im LXC | `NANOMDM_API_KEY` in `.env` weicht vom laufenden Container ab — Container neu starten |
| Container startet und beendet sich sofort, „permission denied" auf `/mdm/db` | Das Image läuft nicht als `root`. Besitzer des Verzeichnisses auf die uid des Containers setzen: `docker compose --profile mdm run --rm --entrypoint id nanomdm`, dann `chown -R <uid>:<gid> mdm` |
