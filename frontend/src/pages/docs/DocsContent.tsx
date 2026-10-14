import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { IconUpgrade } from '../../icons';
import { ErrorNote, KeyValue, Skeleton, SkeletonRows, StatusBadge } from '../../ui';
import { CodeBlock, FaqItem, Note, Path, Step, Steps } from './DocParts';
import { REMOTE_CONFIG_KEY, offlineInstall, rustdeskCommands, windowsOneLiner, type SectionId } from './docSections';

const ADMIN_PS = 'PowerShell als Administrator';

function WindowsAgent({ server }: { server: string }) {
  return (
    <>
      <p>
        Im Dashboard oben rechts auf <b>„Gerät hinzufügen“</b> klicken (auf dem Telefon im Menü <b>„Mehr“</b>), ein
        Einmal-Token erzeugen und die Plattform{' '}
        <b>Windows</b> wählen. Der angezeigte Befehl lädt den Agenten, meldet das Gerät an und installiert den Dienst in einem
        Rutsch:
      </p>
      <CodeBlock label={ADMIN_PS} code={windowsOneLiner(server)} />
      <p>Voraussetzungen, damit der Einzeiler wirklich durchläuft:</p>
      <ul className="dc-list">
        <li>
          <b>PowerShell als Administrator</b> starten: Rechtsklick auf das PowerShell-Symbol, dann{' '}
          <Path parts={['Als Administrator ausführen']} />. Der Dienst-Install braucht erhöhte Rechte — ohne sie bricht das
          Skript sofort mit einer klaren Meldung ab.
        </li>
        <li>
          Auf dem Server muss ein <b>signiertes Windows-Release</b> liegen (siehe{' '}
          <a href="#release">Installer und Release korrekt erzeugen</a>). Fehlt es, meldet der Download „kein Windows-Release
          hinterlegt“.
        </li>
        <li>
          Das <b>Token gilt nur einmal und nur so lange, wie beim Erzeugen gewählt</b> — zwischen 1 Stunde und 14 Tagen; „Standard
          des Servers“ folgt <code>ENROLLMENT_TOKEN_TTL_HOURS</code> (ab Werk 24 h). Nach dem Enrollment ist es verbraucht. Für
          ein weiteres Gerät ein neues Token erzeugen.
        </li>
      </ul>
      <Note title="SmartScreen und Defender">
        <p>
          Beim ersten Start warnt Windows SmartScreen oder Defender ggf. vor einer „unbekannten“ App, solange kein
          Code-Signing-Zertifikat eingebunden ist. Der Installer entfernt automatisch die „Mark of the Web“ (Unblock-File),
          damit der Dienst trotzdem startet. Erscheint dennoch ein Fenster: <Path parts={['Weitere Informationen', 'Trotzdem ausführen']} />.
        </p>
      </Note>
    </>
  );
}

function WindowsErrors({ server }: { server: string }) {
  return (
    <>
      <div className="dc-faq">
        <FaqItem title="„Bitte in einer PowerShell mit Administratorrechten ausführen“">
          <p>
            Die PowerShell läuft ohne erhöhte Rechte. Fenster schließen, PowerShell per Rechtsklick „Als Administrator
            ausführen“ neu öffnen und den Befehl erneut einfügen.
          </p>
        </FaqItem>
        <FaqItem title="„Download fehlgeschlagen“, TLS- oder Verbindungsfehler">
          <p>
            Alte Windows-PowerShell (5.1) verhandelt teils noch TLS 1.0/1.1. Das Setup-Skript erzwingt inzwischen TLS 1.2. Bei
            manueller Nutzung vorab setzen:
          </p>
          <CodeBlock label="PowerShell" code="[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12" />
        </FaqItem>
        <FaqItem title="„kein Windows-Release hinterlegt“ (HTTP 404)">
          <p>
            Auf dem Server liegt kein signiertes Binary. Release bauen und nach <code>AGENT_RELEASE_DIR</code> kopieren (
            <a href="#release">nächster Abschnitt</a>), danach Backend neu starten.
          </p>
        </FaqItem>
        <FaqItem title="„Token ungültig oder abgelaufen“ (HTTP 403)">
          <p>
            Das Token ist verbraucht, widerrufen oder abgelaufen. Wie lange es gilt, wird beim Erzeugen gewählt (Standard:{' '}
            <code>ENROLLMENT_TOKEN_TTL_HOURS</code>, ab Werk 24 h); die noch offenen Tokens stehen mit ihrer Restlaufzeit unter{' '}
            <b>„Gerät hinzufügen“</b>. Im Dashboard ein neues erzeugen.
          </p>
        </FaqItem>
        <FaqItem title="Datei ist gesperrt, „file in use“ bei Neuinstallation">
          <p>
            Ein laufender Dienst hält die alte <code>rmm-agent.exe</code>. Das Skript stoppt den Dienst jetzt automatisch vor dem
            Überschreiben. Manuell:
          </p>
          <CodeBlock label={ADMIN_PS} code="Stop-Service rxf-rmm-agent -Force" />
        </FaqItem>
      </div>
      <h3 className="dc-h3">Offline installieren</h3>
      <p>
        Alternativer Weg ohne Internet auf dem Zielgerät: Binary und <code>install.ps1</code> (aus <code>agent/install/</code>)
        per USB kopieren und in einer Admin-PowerShell ausführen:
      </p>
      <CodeBlock label={ADMIN_PS} code={offlineInstall(server)} />
    </>
  );
}

function Release() {
  return (
    <>
      <p>
        Das Dashboard liefert kein Binary aus, solange kein Release auf dem Server liegt. Das ist die Ursache, wenn der
        Download „Konnte nicht heruntergeladen werden – keine Datei“ meldet.
      </p>
      <p>
        Auf dem Server ist <b>nur Docker</b> nötig (kein Go, Make oder npm) — <code>build-agent.sh</code> erledigt alles im
        Container:
      </p>
      <Steps>
        <Step n={1} title="Einmalig einen Signaturschlüssel erzeugen">
          <p>
            Legt <code>infrastructure/.agent-sign.env</code> an (nur root lesbar, nie im Git). Der private Teil signiert künftige
            Updates, der öffentliche wird beim Build in die Agents gepinnt — ohne gültige Signatur installiert kein Agent ein
            Update. <b>Von der Datei ein Backup anlegen.</b>
          </p>
          <CodeBlock label="Shell auf dem Server" code={'cd /opt/rxf-rmm/infrastructure\n./build-agent.sh keygen'} />
        </Step>
        <Step n={2} title="Release bauen — ein Befehl, fertig signiert">
          <p>
            Baut alle Ziele im Container, pinnt den Public Key, signiert das Manifest, kopiert alles nach{' '}
            <code>agent-releases/</code> und startet das Backend neu. Liegt noch kein Schlüssel vor, entsteht ein unsigniertes
            Release — Download und Einzeiler funktionieren dann trotzdem, nur Auto-Update bleibt aus.
          </p>
          <CodeBlock label="Shell auf dem Server" code="./build-agent.sh 0.2.0" />
        </Step>
      </Steps>
      <Note title="Alternative: Build-Maschine mit Go und Make">
        <p>
          Schlüssel erzeugen, dann signiert bauen und <code>dist/*</code> nach <code>/data/agent-releases/</code> auf den Server
          kopieren, Backend neu starten:
        </p>
        <CodeBlock
          label="Shell auf der Build-Maschine"
          code={'cd agent && make keygen\nmake sign VERSION=0.2.0 AGENT_SIGN_KEY=… AGENT_UPDATE_PUBKEY=…'}
        />
        <p>
          Dabei die <b>Platzhalter durch die echten base64-Schlüssel ersetzen</b> — spitze Klammern wie{' '}
          <code>{'<base64 key>'}</code> sind nur Doku-Schreibweise; wörtlich eingefügt quittiert die Shell das mit{' '}
          <code>syntax error near unexpected token</code>.
        </p>
      </Note>
      <Note title="Auto-Update">
        <p>
          Meldet ein verbundener Agent eine ältere Version als im Manifest, schickt der Server eine <code>update</code>
          -Nachricht mit URL, SHA-256 und Signatur. Der Agent prüft SHA-256 <b>und</b> ed25519-Signatur gegen den gepinnten
          Public Key, tauscht sich atomar aus (alte Binary als <code>.bak</code>) und startet neu. Der Server ist nur
          Auslieferung, nie Vertrauensanker.
        </p>
      </Note>
    </>
  );
}

function AgentUpdate() {
  return (
    <>
      <p>
        Liegt auf dem Server ein <b>signiertes Release mit höherer Version</b> als auf einem Gerät, zeigt das Dashboard das
        direkt an: In der Geräteliste steht neben der Agent-Version das Update-Symbol{' '}
        <span className="dc-inline-ico">
          <IconUpgrade size={13} />
        </span>
        , und auf der Geräteseite erscheint der Hinweis „Agent-Version … ist verfügbar“ mit dem Knopf{' '}
        <b>„Jetzt aktualisieren“</b>.
      </p>
      <Steps>
        <Step n={1} title="Neue Version bauen — ein Befehl auf dem Server">
          <p>
            Baut im Docker-Container, signiert mit dem <b>vorhandenen Schlüssel</b> aus <code>.agent-sign.env</code> (die Agents
            prüfen jedes Update gegen den gepinnten Public Key), kopiert das Release nach <code>agent-releases/</code> und
            startet das Backend neu. Nur die Versionsnummer erhöhen:
          </p>
          <CodeBlock label="Shell auf dem Server" code={'cd /opt/rxf-rmm/infrastructure\n./build-agent.sh 0.3.0'} />
        </Step>
        <Step n={2} title="Im Dashboard aktualisieren">
          <p>
            Beim Gerät auf <b>„Jetzt aktualisieren“</b> klicken — der Knopf erscheint für Administratoren und Techniker, sobald
            der Agent verbunden ist. Der Agent lädt die neue Binary, prüft <b>SHA-256 und ed25519-Signatur</b>, tauscht sich
            atomar aus (alte Binary bleibt als <code>.bak</code> liegen) und verbindet sich mit der neuen Version neu — typisch
            unter einer Minute. Danach verschwindet der Hinweis von selbst.
          </p>
        </Step>
      </Steps>
      <Note title="Auch ohne Klick">
        <p>
          Jeder verbundene Agent bekommt das Update automatisch beim ersten Heartbeat einer Verbindung angeboten.
          Offline-Geräte holen es sich beim nächsten Verbinden — der Knopf ist nur die Abkürzung, um nicht darauf zu warten.
          Jedes manuell angestoßene Update landet im Audit-Log.
        </p>
      </Note>
      <Note title="Kein Hinweis oder „Kein Update verfügbar“?">
        <p>
          Dann ist die Manifest-Version nicht höher als die des Agenten, es fehlt ein Target für dessen OS und Architektur —
          oder das Release ist <b>unsigniert</b> (gebaut ohne Signaturschlüssel): Unsignierte Releases eignen sich nur für
          Erstinstallationen, nie für Updates.
        </p>
        <p>
          Agents, die selbst noch aus einem unsignierten Build stammen, haben <b>keinen Public Key gepinnt</b> und lehnen jedes
          Update ab — solche Geräte einmal per Einzeiler neu installieren, danach greift Auto-Update. Nach jedem
          Manifest-Wechsel das Backend neu starten.
        </p>
      </Note>
    </>
  );
}

function Secrets() {
  return (
    <>
      <p>
        Skripte, die Secrets erzeugen oder auslesen (BitLocker aktivieren, Recovery-Keys abfragen, Notfall-Admin-Passwörter
        rotieren), sollen diese <b>nicht im Job-Log</b> hinterlassen — dort wären sie im Klartext lesbar. Stattdessen gibt das
        Skript eine Marker-Zeile aus:
      </p>
      <CodeBlock
        label="Zeile in der Skriptausgabe"
        code={'##RMM-CRED## {"label":"BitLocker C: Recovery-Key","username":"","secret":"123456-…","notes":"…"}'}
      />
      <p>
        Der Server fängt solche Zeilen ab, <b>bevor</b> sie im Job-Log oder Live-Stream landen, und legt sie{' '}
        <b>verschlüsselt in den Passwörtern des Geräts</b> ab (Reiter „Passwörter“). Im Output erscheint nur{' '}
        <code>[✓ In Passwörtern gespeichert: …]</code>. Gleiche Labels werden aktualisiert statt dupliziert — ein wöchentlich
        geplanter Rotations-Lauf erzeugt also keine Duplikate. Jede Speicherung landet im Audit-Log.
      </p>
      <ul className="dc-list">
        <li>
          <b>Fertige Vorlagen:</b> In der Skript-Bibliothek unter „Vorlagen“ — BitLocker aktivieren und Key sichern, alle
          Recovery-Keys auslesen, lokalen Notfall-Admin rotieren (Windows) und root-Passwort rotieren (Linux).
        </li>
        <li>
          <b>Pflichtfelder</b> sind <code>label</code> und <code>secret</code>; <code>username</code> und <code>notes</code>{' '}
          sind optional. Die Zeile muss gültiges JSON hinter dem Marker enthalten und für sich allein stehen.
        </li>
        <li>
          <b>Abrufen:</b> <Path parts={['Gerät öffnen', 'Passwörter', 'Aufdecken']} /> — nur für Administratoren; jedes
          Aufdecken wird mit Benutzername im Audit-Log erfasst. So lässt sich z. B. ein vergessenes Passwort oder der
          BitLocker-Key jederzeit wieder mitteilen.
        </li>
      </ul>
      <Note title="PowerShell-Tipp">
        <p>
          Das JSON am einfachsten mit <code>ConvertTo-Json -Compress</code> erzeugen — dann sind Sonderzeichen im Secret
          automatisch korrekt escaped:
        </p>
        <CodeBlock
          label="PowerShell im Skript"
          code={"$json = @{ label = 'Mein Secret'; secret = $pw } | ConvertTo-Json -Compress\nWrite-Output \"##RMM-CRED## $json\""}
        />
      </Note>
    </>
  );
}

const RELAY_SETUP = `cd /opt/rxf-rmm/infrastructure
docker compose up -d rustdesk-hbbs rustdesk-hbbr
docker exec rxf-rmm-hbbs cat /root/id_ed25519.pub   # -> RUSTDESK_KEY

# In .env eintragen und Backend neu starten:
#   RUSTDESK_RELAY_HOST=rd.rxf-sys.de
#   RUSTDESK_KEY=<public key von oben>
docker compose up -d backend`;

function RustDesk() {
  // Same key as the remote tab of a device: one request serves both.
  const config = useQuery({
    queryKey: REMOTE_CONFIG_KEY,
    queryFn: ({ signal }) => api.remoteConfig(signal),
    staleTime: 5 * 60_000,
  });
  const cmds = rustdeskCommands(config.data);
  const c = config.data;

  return (
    <>
      <p>
        Die Fernwartung läuft über einen selbst gehosteten RustDesk-Relay (<code>hbbs</code>/<code>hbbr</code>) auf dem
        RMM-LXC. Der Server proxyt die Sitzung nicht — er reicht deinem lokalen RustDesk-Client per{' '}
        <code>{'rustdesk://<id>'}</code> nur die Ziel-ID.
      </p>

      <div className="dc-live">
        <p className="dc-live-title">Stand auf diesem Server</p>
        {config.isPending ? (
          <SkeletonRows rows={3} h={22} />
        ) : config.error ? (
          <ErrorNote error={config.error} onRetry={() => void config.refetch()} />
        ) : (
          <KeyValue
            rows={[
              [
                'Fernsteuerung',
                config.data.enabled ? (
                  <StatusBadge kind="ok" label="Eingerichtet" />
                ) : (
                  <StatusBadge kind="off" label="Nicht eingerichtet" />
                ),
              ],
              ['Relay', config.data.relay_host ? <code>{config.data.relay_host}</code> : '—'],
              [
                'Schlüssel',
                config.data.has_key ? (
                  <StatusBadge kind="ok" label="Gesetzt" />
                ) : config.data.enabled ? (
                  <StatusBadge kind="warn" label="Fehlt" />
                ) : (
                  <StatusBadge kind="off" label="Nicht gesetzt" />
                ),
              ],
            ]}
          />
        )}
      </div>

      <Steps>
        <Step n={1} title="Relay starten und Key setzen (einmalig, auf dem LXC)">
          <CodeBlock label="Shell auf dem LXC" code={RELAY_SETUP} />
        </Step>
        <Step n={2} title="Router-Portfreigaben (RustDesk geht nicht durch den Tunnel)">
          <p>
            RustDesk spricht rohes TCP/UDP; der Cloudflare-Tunnel transportiert nur HTTP. Auf <code>192.168.2.211</code>{' '}
            freigeben: <b>TCP 21115–21117</b> und <b>UDP 21116</b> (optional TCP 21118/21119 für den Web-Client).{' '}
            <code>rd.rxf-sys.de</code> als <b>DNS-only</b>-Eintrag (graue Wolke) auf die öffentliche IP.
          </p>
        </Step>
        <Step n={3} title="RustDesk-Client auf dem Zielgerät auf den Relay zeigen">
          <p>
            RustDesk installieren, dann einmalig konfigurieren. Denselben Befehl zeigt auch der Reiter „Fernzugriff“ jedes
            Geräts:
          </p>
          {config.isPending ? (
            <>
              <Skeleton h={64} />
              <Skeleton h={64} />
            </>
          ) : (
            <>
              <CodeBlock label="Windows" code={cmds.windows} />
              <p>
                Linux und macOS nutzen dieselbe Option ohne <code>.exe</code>:
              </p>
              <CodeBlock label="Linux und macOS" code={cmds.unix} />
              {cmds.placeholder && (
                <Note title="Noch mit Platzhaltern">
                  <p>
                    <code>{'<RELAY>'}</code> und <code>{'<PUBKEY>'}</code> stehen für Relay und Schlüssel. Sobald{' '}
                    <code>RUSTDESK_RELAY_HOST</code> und <code>RUSTDESK_KEY</code> gesetzt sind, steht hier der fertige Befehl.
                  </p>
                </Note>
              )}
              {c?.enabled && !c.has_key && (
                <Note title="Schlüssel fehlt">
                  <p>
                    Im Befehl steht noch kein Schlüssel: <code>RUSTDESK_KEY</code> aus Schritt 1 in die <code>.env</code>{' '}
                    eintragen und das Backend neu starten.
                  </p>
                </Note>
              )}
            </>
          )}
        </Step>
        <Step n={4} title="Unbeaufsichtigten Zugriff einrichten">
          <p>
            In RustDesk am Zielgerät ein <b>festes Passwort pro Gerät</b> setzen (
            <Path parts={['Einstellungen', 'Sicherheit', 'Unbeaufsichtigter Zugriff']} />) — pro Gerät einzeln, nicht geteilt.
            Der Agent liest die RustDesk-ID danach automatisch aus (<code>rustdesk --get-id</code>) und meldet sie im Heartbeat;
            sie erscheint im Reiter „Fernzugriff“. Alternativ lässt sie sich dort von Hand eintragen.
          </p>
        </Step>
        <Step n={5} title="Sitzung öffnen">
          <p>
            Auf deinem eigenen Rechner muss RustDesk installiert und mit <b>demselben Relay</b> konfiguriert sein. Beim Gerät
            im Reiter „Fernzugriff“ auf <b>„Sitzung öffnen“</b> klicken — der <code>{'rustdesk://<id>'}</code>-Link öffnet deinen
            lokalen Client und verbindet.
          </p>
        </Step>
      </Steps>

      {c && !c.enabled && (
        <Note title="Remote-Desktop ist nicht eingerichtet">
          <p>
            <code>RUSTDESK_RELAY_HOST</code> in der <code>.env</code> setzen und das Backend neu starten, damit das Dashboard
            Sitzungen anbietet.
          </p>
        </Note>
      )}
    </>
  );
}

/** The text of one section. `server` is the address the agents reach,
 *  which is the address this dashboard is served from. */
export function SectionBody({ id, server }: { id: SectionId; server: string }) {
  switch (id) {
    case 'windows-agent':
      return <WindowsAgent server={server} />;
    case 'windows-fehler':
      return <WindowsErrors server={server} />;
    case 'release':
      return <Release />;
    case 'agent-update':
      return <AgentUpdate />;
    case 'secrets':
      return <Secrets />;
    case 'rustdesk':
      return <RustDesk />;
  }
}
