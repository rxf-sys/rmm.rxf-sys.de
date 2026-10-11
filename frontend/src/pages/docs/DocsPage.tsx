import './docs.css';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { PageHeader, Panel } from '../../ui';
import { DocsToc } from './DocsToc';
import { SectionBody } from './DocsContent';
import { COMPACT_QUERY, SECTIONS, isSectionId } from './docSections';
import { useActiveSection } from './useActiveSection';

/**
 * The in-app handbook: rolling out and updating the agent (with the usual
 * Windows pitfalls), keeping secrets out of job logs, and wiring RustDesk to
 * the clients. Commands carry this server's address, and the RustDesk part
 * reads the live remote config, so what is shown can be pasted as it stands.
 */
export function DocsPage() {
  const compact = useMediaQuery(COMPACT_QUERY);
  const active = useActiveSection();
  const { hash } = useLocation();
  const [initialHash] = useState(hash);

  // The page arrives as a lazy chunk, after the browser has given up on the
  // fragment of a shared link like /doku#rustdesk. The next frame also comes
  // after the shell's scroll-to-top for a new page.
  useEffect(() => {
    const id = decodeURIComponent(initialHash.slice(1));
    if (!isSectionId(id)) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [initialHash]);

  const server = window.location.origin;

  return (
    <div className="screen dc">
      <PageHeader
        title="Dokumentation"
        subtitle="Agent ausrollen und aktualisieren, Secrets aus Skripten sichern, RustDesk mit den Clients verbinden."
      />
      <div className="dc-layout">
        <DocsToc active={active} compact={compact} />
        <div className="dc-article">
          {SECTIONS.map((s) => (
            <div key={s.id} id={s.id} className="dc-anchor">
              <Panel title={s.title} className="dc-section">
                <div className="dc-body">
                  <p className="dc-lead">{s.lead}</p>
                  <SectionBody id={s.id} server={server} />
                </div>
              </Panel>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
