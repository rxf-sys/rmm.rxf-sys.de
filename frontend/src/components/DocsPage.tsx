import { useEffect, useState, type ReactNode } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { IconCopy, IconDownload, IconFileCode, IconKey, IconMonitor, IconShield, IconShieldCheck } from '../icons';
import type { RemoteConfig } from '../types';

const SERVER = window.location.origin;

/** Copyable code / command block. Mirrors the console styling used elsewhere
 * and offers a one-click copy so admins can paste commands straight onto a
 * target machine. */
function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user selects manually */
    }
  };
  return (
    <div style={{ position: 'relative' }}>
      <pre className="pre-box" style={{ whiteSpace: 'pre-wrap', paddingRight: 74 }}>
        {children}
      </pre>
      <button
        className="btn btn-sm"
        onClick={() => void copy()}
        style={{ position: 'absolute', top: 8, right: 8, display: 'inline-flex', gap: 5, alignItems: 'center' }}
      >
        <IconCopy size={12} /> {copied ? 'Kopiert' : 'Kopieren'}
      </button>
    </div>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-head">
        <span style={{ color: 'var(--accT)', display: 'inline-flex' }}>{icon}</span>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span className="card-title">{title}</span>
          {subtitle && <span className="muted" style={{ fontSize: 11 }}>{subtitle}</span>}
        </div>
      </div>
      <div className="card-pad card-col" style={{ gap: 12, lineHeight: 1.65, fontSize: 13 }}>
        {children}
      </div>
    </div>
  );
}

/** Ordered step with a number chip, so multi-step setups read as a checklist. */
function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
      <span
        className="badge badge-accent"
        style={{ flex: 'none', width: 22, height: 22, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}
      >
        {n}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>{title}</span>
        {children}
      </div>
    </div>
  );
}

/** In-app handbook: how to correctly generate/roll out the agent installer
 * (with the common Windows pitfalls) and how to wire RustDesk to the clients.
 * Read-only — pulls the live remote config so the RustDesk command shows the
 * real relay host/key instead of a placeholder. */
export function DocsPage() {
  const [remote, setRemote] = useState<RemoteConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .remoteConfig(ctrl.signal)
      .then(setRemote)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(apiErrorMessage(e));
      });
    return () => ctrl.abort();
  }, []);

  const rdCmd =
    remote?.deploy_commands.windows ??
    'rustdesk.exe --config "host=<RELAY>,key=<PUBKEY>"  # erst nach Konfiguration verfügbar';

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Dokumentation</h1>
        <span className="muted">
          Agent-Installer erzeugen &amp; ausrollen · Agent aktualisieren · Secrets aus Skripten sichern · RustDesk verbinden
        </span>
      </div>

      {error && <p className="err">{error}</p>}

      {/* Two columns on wide screens, single column below ~1000px — the docs
       * fill the whole content area instead of a narrow strip. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(480px, 100%), 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* ----------------------------------------------------------------- */}
        <Section
          icon={<IconMonitor size={16} />}
          title="Windows-Agent installieren"
          subtitle="Der schnelle Weg — ein Einzeiler aus dem Dashboard"
        >
          <p style={{ margin: 0 }}>
            Im Dashboard oben rechts auf <b>„Gerät hinzufügen"</b> klicken, ein Einmal-Token
            erzeugen und die Plattform <b>Windows</b> wählen. Der angezeigte Befehl lädt den
            Agenten, meldet das Gerät an und installiert den Dienst in einem Rutsch:
          </p>
          <Code>{`irm -Headers @{'X-Enroll-Token'='<TOKEN>'} '${SERVER}/api/agent/setup/windows' | iex`}</Code>
          <p style={{ margin: 0 }}>
            Voraussetzungen, damit der Einzeiler wirklich durchläuft:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <b>PowerShell als Administrator</b> starten (Rechtsklick auf das PowerShell-Symbol →
              „Als Administrator ausführen"). Der Dienst-Install braucht erhöhte Rechte — ohne sie
              bricht das Skript sofort mit einer klaren Meldung ab.
            </li>
            <li>
              Auf dem Server muss ein <b>signiertes Windows-Release</b> liegen (siehe Abschnitt
              unten). Fehlt es, meldet der Download „kein Windows-Release hinterlegt".
            </li>
            <li>
              Das <b>Token ist 24 h gültig und nur einmal verwendbar</b> — nach dem Enrollment ist
              es verbraucht. Für ein weiteres Gerät ein neues Token erzeugen.
            </li>
          </ul>
          <div className="callout-note">
            Beim ersten Start warnt <b>Windows SmartScreen/Defender</b> ggf. vor einer
            „unbekannten" App, solange kein Code-Signing-Zertifikat eingebunden ist. Der Installer
            entfernt automatisch die „Mark of the Web" (Unblock-File), damit der Dienst trotzdem
            startet. Erscheint dennoch ein Fenster: „Weitere Informationen" → „Trotzdem
            ausführen".
          </div>
        </Section>

        {/* ----------------------------------------------------------------- */}
        <Section
          icon={<IconShield size={16} />}
          title="Häufige Fehler beim Windows-Installer"
          subtitle="Wenn der Einzeiler nicht durchläuft"
        >
          <div className="doc-faq">
            <div>
              <b>„Bitte in einer PowerShell mit Administratorrechten ausführen"</b>
              <p className="muted" style={{ margin: '3px 0 0' }}>
                Die PowerShell läuft ohne erhöhte Rechte. Fenster schließen, PowerShell per
                Rechtsklick „Als Administrator ausführen" neu öffnen und den Befehl erneut einfügen.
              </p>
            </div>
            <div>
              <b>„Download fehlgeschlagen" / TLS- oder Verbindungsfehler</b>
              <p className="muted" style={{ margin: '3px 0 0' }}>
                Alte Windows-PowerShell (5.1) verhandelt teils noch TLS 1.0/1.1. Das Setup-Skript
                erzwingt inzwischen TLS 1.2. Bei manueller Nutzung vorab setzen:
              </p>
              <Code>{`[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`}</Code>
            </div>
            <div>
              <b>„kein Windows-Release hinterlegt" (HTTP 404)</b>
              <p className="muted" style={{ margin: '3px 0 0' }}>
                Auf dem Server liegt kein signiertes Binary. Release bauen und nach
                <span className="mono"> AGENT_RELEASE_DIR</span> kopieren (nächster Abschnitt),
                danach Backend neu starten.
              </p>
            </div>
            <div>
              <b>„Token ungültig oder abgelaufen" (HTTP 403)</b>
              <p className="muted" style={{ margin: '3px 0 0' }}>
                Das Token wurde bereits verbraucht oder ist älter als 24 h. Im Dashboard ein neues
                erzeugen.
              </p>
            </div>
            <div>
              <b>Datei ist gesperrt / „file in use" bei Neuinstallation</b>
              <p className="muted" style={{ margin: '3px 0 0' }}>
                Ein laufender Dienst hält die alte <span className="mono">rmm-agent.exe</span>. Das
                Skript stoppt den Dienst jetzt automatisch vor dem Überschreiben. Manuell:
              </p>
              <Code>{`Stop-Service rxf-rmm-agent -Force`}</Code>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
            Alternativer Offline-Weg ohne Internet auf dem Zielgerät: Binary +
            <span className="mono"> install.ps1</span> (aus <span className="mono">agent/install/</span>)
            per USB kopieren und
            <span className="mono"> .\install.ps1 -Server {SERVER} -Token &lt;TOKEN&gt; -Label "Name"</span>
            in einer Admin-PowerShell ausführen.
          </p>
        </Section>

        {/* ----------------------------------------------------------------- */}
        <Section
          icon={<IconDownload size={16} />}
          title="Installer / Release korrekt erzeugen"
          subtitle="Signierte Binaries bauen und auf den Server legen"
        >
          <p style={{ margin: 0 }}>
            Das Dashboard liefert kein Binary aus, solange kein Release auf dem Server liegt. Das
            ist die Ursache, wenn der Download „Konnte nicht heruntergeladen werden – keine Datei"
            meldet.
          </p>
          <p style={{ margin: 0 }}>
            Auf dem Server ist <b>nur Docker</b> nötig (kein Go/Make/npm) —{' '}
            <span className="mono">build-agent.sh</span> erledigt alles im Container:
          </p>
          <Step n={1} title="Einmalig einen Signaturschlüssel erzeugen">
            <p className="muted" style={{ margin: 0 }}>
              Legt <span className="mono">infrastructure/.agent-sign.env</span> an (nur root
              lesbar, nie im Git). Der private Teil signiert künftige Updates, der öffentliche
              wird beim Build in die Agents gepinnt — ohne gültige Signatur installiert kein
              Agent ein Update. <b>Backup der Datei anlegen!</b>
            </p>
            <Code>{`cd /opt/rxf-rmm/infrastructure
./build-agent.sh keygen`}</Code>
          </Step>
          <Step n={2} title="Release bauen — ein Befehl, fertig signiert">
            <p className="muted" style={{ margin: 0 }}>
              Baut alle Ziele im Container, pinnt den Public Key, signiert das Manifest, kopiert
              alles nach <span className="mono">agent-releases/</span> und startet das Backend neu.
              Liegt (noch) kein Schlüssel vor, entsteht ein unsigniertes Release — Download und
              Einzeiler funktionieren dann trotzdem, nur Auto-Update bleibt aus.
            </p>
            <Code>{`./build-agent.sh 0.2.0`}</Code>
          </Step>
          <div className="callout-note">
            <b>Alternative — Build-Maschine mit Go/Make:</b>{' '}
            <span className="mono">cd agent &amp;&amp; make keygen</span>, dann{' '}
            <span className="mono">make sign VERSION=0.2.0 AGENT_SIGN_KEY=… AGENT_UPDATE_PUBKEY=…</span>{' '}
            und <span className="mono">dist/*</span> nach{' '}
            <span className="mono">/data/agent-releases/</span> auf den Server kopieren, Backend
            neu starten. Dabei die <b>Platzhalter durch die echten base64-Schlüssel ersetzen</b> —
            spitze Klammern wie <span className="mono">&lt;base64 key&gt;</span> sind nur
            Doku-Schreibweise; wörtlich eingefügt quittiert die Shell das mit{' '}
            <span className="mono">syntax error near unexpected token</span>.
          </div>
          <div className="callout-note">
            <b>Auto-Update:</b> Meldet ein verbundener Agent eine ältere Version als im Manifest,
            schickt der Server eine <span className="mono">update</span>-Nachricht mit URL, SHA-256
            und Signatur. Der Agent prüft SHA-256 <b>und</b> ed25519-Signatur gegen den gepinnten
            Public Key, tauscht sich atomar aus (alte Binary als <span className="mono">.bak</span>)
            und startet neu. Der Server ist nur Auslieferung, nie Vertrauensanker.
          </div>
        </Section>

        {/* ----------------------------------------------------------------- */}
        <Section
          icon={<IconShieldCheck size={16} />}
          title="Agent aktualisieren"
          subtitle="Neue Version ausrollen — automatisch oder per Klick im Dashboard"
        >
          <p style={{ margin: 0 }}>
            Liegt auf dem Server ein <b>signiertes Release mit höherer Version</b> als auf einem
            Gerät, zeigt das Dashboard das direkt an: In der Geräteliste erscheint ein{' '}
            <span className="badge badge-warn" style={{ fontSize: 10 }}>⬆</span>-Badge neben der
            Agent-Version, und auf der Geräteseite ein Hinweis-Banner „Neue Agent-Version …
            verfügbar" mit dem Button <b>„Jetzt aktualisieren"</b>.
          </p>
          <Step n={1} title="Neue Version bauen — ein Befehl auf dem Server">
            <p className="muted" style={{ margin: 0 }}>
              Baut im Docker-Container, signiert mit dem <b>vorhandenen Schlüssel</b> aus{' '}
              <span className="mono">.agent-sign.env</span> (die Agents prüfen jedes Update gegen
              den gepinnten Public Key), kopiert das Release nach{' '}
              <span className="mono">agent-releases/</span> und startet das Backend neu. Nur die
              Versionsnummer erhöhen:
            </p>
            <Code>{`cd /opt/rxf-rmm/infrastructure
./build-agent.sh 0.3.0`}</Code>
          </Step>
          <Step n={2} title="Im Dashboard aktualisieren">
            <p className="muted" style={{ margin: 0 }}>
              Beim Gerät auf <b>„Jetzt aktualisieren"</b> klicken (der Button ist nur bei
              verbundenem Agent aktiv). Der Agent lädt die neue Binary, prüft <b>SHA-256 und
              ed25519-Signatur</b>, tauscht sich atomar aus (alte Binary bleibt als{' '}
              <span className="mono">.bak</span> liegen) und verbindet sich mit der neuen Version
              neu — typisch unter einer Minute. Danach verschwindet der Hinweis von selbst.
            </p>
          </Step>
          <div className="callout-note">
            <b>Auch ohne Klick:</b> Jeder verbundene Agent bekommt das Update automatisch beim
            ersten Heartbeat einer Verbindung angeboten. Offline-Geräte holen es sich beim
            nächsten Verbinden — der Button ist nur die Abkürzung, um nicht darauf zu warten.
            Jedes manuell angestoßene Update landet im Audit-Log.
          </div>
          <div className="callout-note">
            <b>Kein Hinweis / „Kein Update verfügbar"?</b> Dann ist die Manifest-Version nicht
            höher als die des Agenten, es fehlt ein Target für dessen OS/Architektur — oder das
            Release ist <b>unsigniert</b> (gebaut ohne Signaturschlüssel): unsignierte Releases
            eignen sich nur für Erstinstallationen, nie für Updates. Und: Agents, die selbst noch
            aus einem unsignierten Build stammen, haben <b>keinen Public Key gepinnt</b> und
            lehnen jedes Update ab — solche Geräte einmal per Einzeiler neu installieren, danach
            greift Auto-Update. Nach jedem Manifest-Wechsel das Backend neu starten.
          </div>
        </Section>

        {/* ----------------------------------------------------------------- */}
        <Section
          icon={<IconFileCode size={16} />}
          title="Passwörter & Recovery-Keys aus Skripten sichern"
          subtitle="BitLocker-Keys, rotierte Admin-Passwörter — automatisch in den Passwort-Tresor"
        >
          <p style={{ margin: 0 }}>
            Skripte, die Secrets erzeugen oder auslesen (BitLocker aktivieren, Recovery-Keys
            abfragen, Notfall-Admin-Passwörter rotieren), sollen diese <b>nicht im Job-Log</b>{' '}
            hinterlassen — dort wären sie im Klartext lesbar. Stattdessen gibt das Skript eine
            Marker-Zeile aus:
          </p>
          <Code>{`##RMM-CRED## {"label":"BitLocker C: Recovery-Key","username":"","secret":"123456-…","notes":"…"}`}</Code>
          <p style={{ margin: 0 }}>
            Der Server fängt solche Zeilen ab, <b>bevor</b> sie im Job-Log oder Live-Stream
            landen, und legt sie <b>verschlüsselt in den Passwörtern des Geräts</b> ab
            (Tab „Passwörter"). Im Output erscheint nur{' '}
            <span className="mono">[✓ In Passwörtern gespeichert: …]</span>. Gleiche Labels werden
            aktualisiert statt dupliziert — ein wöchentlich geplanter Rotations-Lauf erzeugt also
            keine Duplikate. Jede Speicherung landet im Audit-Log.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <b>Fertige Vorlagen:</b> In der Skript-Bibliothek bei „+ Neues Skript" über
              „Vorlage einfügen…" — BitLocker aktivieren + Key sichern, alle Recovery-Keys
              auslesen, lokalen Notfall-Admin rotieren (Windows) und root-Passwort rotieren
              (Linux).
            </li>
            <li>
              <b>Pflichtfelder</b> sind <span className="mono">label</span> und{' '}
              <span className="mono">secret</span>; <span className="mono">username</span> und{' '}
              <span className="mono">notes</span> sind optional. Die Zeile muss gültiges JSON
              hinter dem Marker enthalten und für sich allein stehen.
            </li>
            <li>
              <b>Abrufen:</b> Gerät öffnen → Tab „Passwörter" → „Aufdecken" (nur Admins; jedes
              Aufdecken wird mit Benutzername im Audit-Log erfasst). So lässt sich z. B. ein
              vergessenes Passwort oder der BitLocker-Key jederzeit wieder mitteilen.
            </li>
          </ul>
          <div className="callout-note">
            <b>PowerShell-Tipp:</b> Das JSON am einfachsten mit{' '}
            <span className="mono">ConvertTo-Json -Compress</span> erzeugen — dann sind
            Sonderzeichen im Secret automatisch korrekt escaped:
            <div style={{ marginTop: 8 }}>
              <Code>{`$json = @{ label = 'Mein Secret'; secret = $pw } | ConvertTo-Json -Compress
Write-Output "##RMM-CRED## $json"`}</Code>
            </div>
          </div>
        </Section>

        {/* ----------------------------------------------------------------- */}
        <Section
          icon={<IconKey size={16} />}
          title="RustDesk mit den Clients verbinden"
          subtitle="Self-hosted Relay — das RMM übergibt nur die ID an deinen lokalen Client"
        >
          <p style={{ margin: 0 }}>
            Die Fernwartung läuft über einen selbst gehosteten RustDesk-Relay
            (<span className="mono">hbbs</span>/<span className="mono">hbbr</span>) auf dem RMM-LXC.
            Der Server proxyt die Sitzung nicht — er reicht deinem lokalen RustDesk-Client per{' '}
            <span className="mono">rustdesk://&lt;id&gt;</span> nur die Ziel-ID.
          </p>
          {remote && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge ${remote.enabled ? 'badge-ok' : 'badge-off'}`}>
                {remote.enabled ? 'Remote aktiv' : 'Remote nicht konfiguriert'}
              </span>
              {remote.relay_host && (
                <span className="badge badge-accent">Relay: {remote.relay_host}</span>
              )}
              <span className={`badge ${remote.has_key ? 'badge-ok' : 'badge-warn'}`}>
                {remote.has_key ? 'Key gesetzt' : 'kein Key'}
              </span>
            </div>
          )}

          <Step n={1} title="Relay starten & Key setzen (einmalig, auf dem LXC)">
            <Code>{`cd /opt/rxf-rmm/infrastructure
docker compose up -d rustdesk-hbbs rustdesk-hbbr
docker exec rxf-rmm-hbbs cat /root/id_ed25519.pub   # -> RUSTDESK_KEY

# In .env eintragen und Backend neu starten:
#   RUSTDESK_RELAY_HOST=rd.rxf-sys.de
#   RUSTDESK_KEY=<public key von oben>
docker compose up -d backend`}</Code>
          </Step>
          <Step n={2} title="Router-Portfreigaben (RustDesk geht nicht durch den Tunnel)">
            <p className="muted" style={{ margin: 0 }}>
              RustDesk spricht rohes TCP/UDP; der Cloudflare-Tunnel transportiert nur HTTP. Auf
              <span className="mono"> 192.168.2.211</span> freigeben: <b>TCP 21115–21117</b> und
              <b> UDP 21116</b> (optional TCP 21118/21119 für den Web-Client).
              <span className="mono"> rd.rxf-sys.de</span> als <b>DNS-only</b>-Eintrag (graue Wolke)
              auf die öffentliche IP.
            </p>
          </Step>
          <Step n={3} title="RustDesk-Client auf dem Zielgerät auf den Relay zeigen">
            <p className="muted" style={{ margin: 0 }}>
              RustDesk installieren, dann einmalig konfigurieren. Denselben Befehl zeigt auch das
              Remote-Panel jedes Geräts:
            </p>
            <Code>{rdCmd}</Code>
            <p className="muted" style={{ margin: 0 }}>
              Linux/macOS nutzen dieselbe Flag ohne <span className="mono">.exe</span>:
              <span className="mono"> rustdesk --config "host=…,key=…"</span>.
            </p>
          </Step>
          <Step n={4} title="Unbeaufsichtigten Zugriff einrichten">
            <p className="muted" style={{ margin: 0 }}>
              In RustDesk am Zielgerät ein <b>festes Passwort pro Gerät</b> setzen (Einstellungen →
              Sicherheit → unbeaufsichtigter Zugriff) — pro Gerät einzeln, nicht geteilt. Der Agent
              liest die RustDesk-ID danach automatisch aus (<span className="mono">rustdesk
              --get-id</span>) und meldet sie im Heartbeat; sie erscheint im Remote-Panel. Alternativ
              lässt sie sich dort manuell eintragen.
            </p>
          </Step>
          <Step n={5} title="Sitzung öffnen">
            <p className="muted" style={{ margin: 0 }}>
              Auf deinem eigenen Rechner muss RustDesk installiert und mit <b>demselben Relay</b>{' '}
              konfiguriert sein. Beim Gerät im Dashboard „Remote-Sitzung öffnen" klicken — der
              <span className="mono"> rustdesk://&lt;id&gt;</span>-Link öffnet deinen lokalen Client
              und verbindet.
            </p>
          </Step>
          {remote && !remote.enabled && (
            <div className="callout-note">
              Remote-Desktop ist aktuell nicht konfiguriert:
              <span className="mono"> RUSTDESK_RELAY_HOST</span> in der <span className="mono">.env</span>
              setzen und das Backend neu starten, damit das Dashboard Sitzungen anbietet.
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
