import { useEffect, useState, type ReactNode } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { IconCopy, IconDownload, IconKey, IconMonitor, IconShield } from '../icons';
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
    <div className="screen" style={{ maxWidth: 960 }}>
      <div className="page-head">
        <h1 className="page-title">Dokumentation</h1>
        <span className="muted">Agent-Installer erzeugen &amp; ausrollen · RustDesk mit Clients verbinden</span>
      </div>

      {error && <p className="err">{error}</p>}

      <div className="card-col" style={{ gap: 16 }}>
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
          <div className="callout-note">
            <b>Schnellweg — nur Docker auf dem Server nötig</b> (kein Go/Make/npm). Baut alle Ziele
            in einem Container, legt ein unsigniertes Manifest nach{' '}
            <span className="mono">agent-releases/</span> und startet das Backend neu — Download und
            Einzeiler funktionieren danach sofort:
            <div style={{ marginTop: 8 }}>
              <Code>{`cd /opt/rxf-rmm/infrastructure
./build-agent.sh 0.1.0`}</Code>
            </div>
            Auf einer Build-Maschine <b>mit</b> Go/Make geht es auch direkt:
            <span className="mono"> cd agent &amp;&amp; make dev-manifest VERSION=0.1.0</span>, dann
            <span className="mono"> dist/*</span> nach <span className="mono">agent-releases/</span>{' '}
            kopieren und das Backend neu starten. Auto-Update bleibt bei beiden aus.
          </div>
          <p style={{ margin: 0 }}>
            Für Produktion mit <b>Auto-Update</b> die Binaries signieren (Go + Make erforderlich):
          </p>
          <Step n={1} title="Einmalig einen Signaturschlüssel erzeugen">
            <p className="muted" style={{ margin: 0 }}>
              Den <b>öffentlichen</b> Teil in <span className="mono">agent/update.go</span>{' '}
              (<span className="mono">updatePublicKey</span>) pinnen, den privaten Teil geheim
              halten. Er signiert die Auto-Updates — ohne gültige Signatur installiert kein Agent
              ein Update.
            </p>
            <Code>{`cd agent
make keygen`}</Code>
          </Step>
          <Step n={2} title="Alle Ziele bauen und signieren">
            <p className="muted" style={{ margin: 0 }}>
              Erzeugt <span className="mono">dist/rmm-agent-&lt;os&gt;-&lt;arch&gt;[.exe]</span> plus
              <span className="mono"> dist/manifest.json</span>. CGO ist aus — jede Binary ist
              statisch.
            </p>
            <Code>{`make sign VERSION=0.2.0 AGENT_SIGN_KEY=<base64 privater key>`}</Code>
          </Step>
          <Step n={3} title="Release auf den Server kopieren">
            <p className="muted" style={{ margin: 0 }}>
              Den Inhalt von <span className="mono">dist/</span> nach
              <span className="mono"> AGENT_RELEASE_DIR</span> (Default
              <span className="mono"> /data/agent-releases</span>) legen. Der Server liest
              <span className="mono"> manifest.json</span> beim Start.
            </p>
            <Code>{`scp dist/* root@192.168.2.211:/data/agent-releases/
# danach Backend neu starten, damit das Manifest geladen wird:
docker compose -f /opt/rxf-rmm/infrastructure/docker-compose.yml up -d backend`}</Code>
          </Step>
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
